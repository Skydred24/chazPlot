# Spyder Plots — Robustesse, convertisseur & copier-image

Date : 2026-06-19
Périmètre : parties 1 & 2 du plan d'amélioration + ajout « copier la figure ».

## Objectif

Fiabiliser l'extension (persistance des figures, découverte de port), corriger
trois limites du convertisseur matplotlib→Plotly (axes dates, position de
légende, twinx), réduire la dette de code (HTML dupliqué), ajouter des tests
d'assertion, et permettre de copier une figure dans le presse-papiers.

Langue de travail : **français** (UI, commentaires, descriptions de réglages),
conforme au reste du projet.

## Contraintes invariantes

- Le backend Python ne dépend de **rien hors matplotlib/numpy** (il tourne dans
  l'interpréteur de l'utilisateur). Aucune nouvelle dépendance Python.
- Le contrat réseau `/figure` (clés `plotly`/`pgf`/`svg`/`png`/`frames`) et les
  variables `VSCODE_PLOTS_*` restent compatibles : un ancien backend doit
  continuer à fonctionner avec la nouvelle extension, et inversement.
- L'extension reste du JavaScript pur, sans étape de build.

---

## A. Persistance des figures (disque + index, par workspace)

**Problème.** `figures[]` vit en mémoire dans `extension.js`. Après un Reload
Window, le `WebviewPanelSerializer` restaure le panneau mais pas les figures :
elles sont perdues.

**Conception.**

- Nouveau module **`storage.js`** (extrait de `extension.js`, déjà volumineux),
  responsabilité unique : persister les figures.
  - Répertoire de stockage : `context.storageUri` (spécifique au workspace).
    Fallback `context.globalStorageUri` si aucun workspace n'est ouvert. Les
    figures sont écrites une par fichier : `<storage>/figures/<id>.json`
    (l'objet figure complet, base64 inclus).
  - Index léger dans `context.workspaceState`, clé `spyderPlots.index` :
    `{ nextId: number, figures: [{ id, title, tags, ts }] }`. L'index sert à
    restaurer l'ordre, les titres/tags/horodatage et `nextId` sans relire tous
    les fichiers.
  - API du module : `init(context)`, `loadAll() -> fig[]`, `save(fig)`,
    `remove(id)`, `removeAll()`, `updateTags(id, tags)`, `nextId()`.
  - Garde-fou disque : réglage **`spyderPlots.maxPersistedFigures`** (défaut
    `200`, `0` = illimité). À `save()`, si le nombre dépasse le plafond, éviction
    des plus anciennes (suppression fichier + entrée d'index).
  - Tolérance aux pannes : toute erreur d'E/S est journalisée (console) et
    n'interrompt jamais l'affichage en mémoire (la persistance est un bonus, pas
    un point de défaillance).

- **Câblage `extension.js`** :
  - `activate()` : `storage.init(context)`, puis `figures = storage.loadAll()` et
    `nextId = storage.nextId()`. Le panneau reçoit l'état restauré via le message
    `reset` déjà déclenché par `ready`.
  - `addFigure()` → `storage.save(fig)` après ajout en mémoire.
  - `deleteOne()`/`deleteAll()` → `storage.remove(id)` / `storage.removeAll()`.
  - `updateTags()` → `storage.updateTags(id, tags)`.

**Critères de réussite.** Lancer un script, faire Reload Window : les figures
(et leurs tags) réapparaissent dans le panneau. Supprimer une figure puis Reload
: elle reste supprimée. Deux workspaces distincts ne partagent pas leurs piles.

---

## B. Fiabilisation du port (fichier + fallback env)

**Problème.** Le port est figé dans `VSCODE_PLOTS_PORT` à la création du
terminal. Si l'extension redémarre sur un autre port (auto-incrément après
`EADDRINUSE`), les terminaux déjà ouverts pointent vers un port mort.

**Conception.**

- `extension.js` : à chaque `server.listen()` réussi, écrire
  `os.tmpdir()/spyder-plots-port.json` = `{ port, pid, ts }` (en plus de
  l'injection env actuelle, **inchangée**). Best-effort (erreur d'écriture
  ignorée).
- `vscode_spyder_plots_backend.py` : dans `_send_figure`, conserver l'envoi sur
  le port env. **Sur échec** (`URLError`/`OSError`), relire le fichier de port
  (`tempfile.gettempdir()/spyder-plots-port.json`), et si un port différent y
  est lu, **réessayer une fois** sur ce port. Le message d'aide stderr n'est émis
  qu'après échec des deux tentatives.
- Rétrocompatibilité : sans fichier de port, comportement strictement actuel.

**Limite assumée (documentée).** Multi-fenêtres = dernier écrivain gagne sur le
fichier ; il ne sert que de repli, l'injection env reste correcte par fenêtre
pour les nouveaux terminaux.

**Critères de réussite.** Avec un terminal ouvert, forcer un changement de port
de l'extension (occuper le port puis recharger) : un nouveau `plt.show()` depuis
le terminal existant atteint quand même le panneau.

---

## C. Convertisseur `_mpl_to_plotly.py`

### C1. Axes temporels (dates)

- Détecter un axe date : `matplotlib.dates` — l'axe a un converter de type
  `DateConverter`/`ConciseDateConverter` (via `axis.get_converter()` si présent,
  sinon `axis.converter`). Helper `_is_date_axis(axis) -> bool`.
- Si l'axe X (resp. Y) est un axe date : `layout[axis]["type"] = "date"`, et les
  valeurs numériques (datenum) des traces rattachées à cet axe sont converties en
  chaînes ISO via `matplotlib.dates.num2date`.
- Implémentation localisée : dans la boucle par axe, mémoriser `start = len(data)`
  avant d'ajouter les traces de l'axe, puis après, si axe date, convertir
  `data[start:]` (champ `x` ou `y`, `None` préservés). Ne pas appliquer
  `_custom_ticks` numériques sur un axe date.

### C2. Position de légende

- Lire `legend._loc` (code entier mpl, stable). Helper `_legend_position(loc)`
  retournant `{x, y, xanchor, yanchor}` pour les codes 1–10
  (`upper right`…`center`). Code `0` (`best`) → garder le défaut actuel
  (haut-droite).
- Fusionner ce positionnement dans le `layout["legend"]` existant (style cadre /
  fond / police conservé).
- Hors périmètre (noté en limite) : `bbox_to_anchor` hors-axes.

### C3. twinx

- Avant la boucle, classer les axes : un axe est un **twin** s'il partage l'axe X
  avec un axe précédent (même groupe `get_shared_x_axes()`) **et** occupe la même
  position (`get_position()` quasi identique, tolérance epsilon). Les vrais
  sous-graphes (positions différentes) ne sont **pas** des twins.
- L'axe hôte (premier d'un groupe superposé) est rendu normalement. Chaque twin :
  - ne crée pas de nouveau X ni de domaine ;
  - définit `layout["yaxis"+N] = { overlaying: "y"+hostSuffix, side: "right",
    anchor: "x"+hostSuffix, title, range, ... }` ;
  - ses traces utilisent `xaxis = "x"+hostSuffix`, `yaxis = "y"+N`.
- twiny (partage Y) : hors périmètre, reste noté comme limite.

**Risque.** C3 est le seul changement à risque de régression sur des figures
multi-sous-graphes. Verrouillé par les tests E (un cas twinx + un cas 2
sous-graphes séparés qui doivent rester 2 subplots distincts).

---

## D. Suppression du HTML dupliqué

- Retirer le fallback HTML inline (~150 lignes) de `extension.js:webviewHtml()`.
  `panel.html` étant livré dans le `.vsix`, en cas d'absence improbable du
  fichier, renvoyer un HTML minimal d'erreur (« interface introuvable,
  réinstallez l'extension ») au lieu d'une UI divergente.
- Effet de bord : règle le constat « tags à moitié câblés » — le vrai panneau
  (`panel.html`) gère déjà tags + filtre ; seul le fallback ne les avait pas.

---

## E. Tests d'assertion

- Nouveau **`test/test_convert.py`**, `unittest` stdlib, exécutable via
  `python -m unittest test.test_convert` (aucune dépendance hors
  matplotlib/numpy ; backend Agg forcé).
- Cas couverts pour `convert_figure(fig)` :
  - plot simple → 1 trace `scatter` mode `lines` ;
  - scatter avec colormap → `marker.colorscale`/`showscale` ;
  - bar → trace `bar`, barh → `orientation:'h'` ;
  - échelle log → `xaxis.type == 'log'` ;
  - ticks catégoriels → `tickvals`/`ticktext` ;
  - artistes non supportés → `None` : `fill_between`, `contour`, présence de
    `ax.text()` ;
  - **axe date** → `xaxis.type == 'date'` et `x` non numérique ;
  - **légende** `loc='lower left'` → `legend.x`≈0, `legend.y`≈0,
    `xanchor=='left'`, `yanchor=='bottom'` ;
  - **twinx** → un seul axe X, présence de `yaxis2.overlaying == 'y'` ;
  - **2 sous-graphes séparés** (`subplots(1,2)`) → 2 paires d'axes distinctes,
    aucun `overlaying` (non-régression de C3).

---

## F. Copier la figure dans le presse-papiers

**Problème.** `vscode.env.clipboard` ne copie que du texte ; pas d'image.

**Conception (webview, aucun Python).**

- `panel.html` : bouton **« Copier »** sur chaque carte (et dans l'overlay
  agrandi), à côté des boutons existants.
- Obtenir un `Blob` PNG :
  - figure Plotly → `Plotly.toImage(plotDiv, { format: 'png', scale: 2 })` puis
    `fetch(dataUrl).then(r => r.blob())` ;
  - figure raster/vectorielle → `fig.png` (toujours fourni par le backend) décodé
    en blob `image/png` ;
  - animation → frame actuellement affichée (PNG).
- `await navigator.clipboard.write([ new ClipboardItem({ 'image/png': blob }) ])`.
- Retour utilisateur via message webview→extension :
  - `{ type: 'copied' }` → `vscode.window.showInformationMessage('Figure copiée
    dans le presse-papiers.')` ;
  - `{ type: 'copyFailed', error }` → `showWarningMessage` invitant à utiliser
    « Enregistrer » si le navigateur refuse l'écriture.
- `extension.js` : ajouter ces deux cas dans `onDidReceiveMessage`.

**Critères de réussite.** Clic sur « Copier » d'une figure Plotly puis d'une
figure SVG, puis collage dans une application externe : l'image apparaît.

---

## Mise à jour de la documentation

- `README.md` « Limites connues » : retirer dates / position de légende / twinx
  (résolus), ajouter la note multi-fenêtres du fichier de port.
- `CLAUDE.md` : persistance (storage.js + index workspaceState), fichier de port
  + fallback, fin du fallback HTML inline, nouveau réglage
  `spyderPlots.maxPersistedFigures`, bouton Copier.
- `package.json` : déclarer `spyderPlots.maxPersistedFigures` dans
  `contributes.configuration`. Bump de version.

## Ordre d'implémentation suggéré

1. E (tests convertisseur) en premier pour C1/C2 — TDD.
2. C1, C2, puis C3 (avec son test de non-régression).
3. A (storage.js + câblage).
4. B (fichier de port + fallback backend).
5. D (suppression fallback HTML).
6. F (bouton Copier).
7. Docs + bump version.
