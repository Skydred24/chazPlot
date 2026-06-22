# Design — Taille automatique des graphes + améliorations de légende

Date : 2026-06-22
Extension : Chaz Plots (`spyder-plots/`, npm `chaz-plots`)
Langue de travail : français (UI, commentaires, commits).
Branche : se greffe sur `feat/export-pdf-mode-erreur-redim` (non mergée ; la taille
est une conséquence directe du correctif de redimensionnement de cette branche).

## Contexte

Suite à la recette dev-host du correctif de redimensionnement : la vue liste
est correcte sauf que, sur grand écran, les graphes deviennent **trop grands**.
Plus trois demandes d'amélioration de la légende. Quatre volets :

- **A — Taille automatique + contrôle.** Plafonner la largeur des graphes (vue
  liste) avec un défaut confortable et un curseur pour ajuster.
- **B — Légende de comparaison plus claire.** Remplacer le préfixe « A / B » par
  le titre de la figure source.
- **C — Glisser de légende.** Activer le déplacement natif Plotly de la légende.
- **D — Éditeur d'entrée de légende.** Clic (en mode armé) sur une entrée →
  éditer nom, couleur, trait, marqueur ; persisté sur disque en vue liste.

## Volet A — Taille automatique + contrôle

### Cause

`listPlotHeight(el, fig)` calcule `height = clamp(clientWidth × aspect, 300,
0.92 × innerHeight)`. Aucun plafond de **largeur** n'existe sur les cartes, donc
sur une fenêtre maximisée le graphe prend toute la largeur et sa hauteur tend
vers 92 % du viewport.

### Solution

- **Défaut automatique** : plafond de largeur sur le conteneur de graphe de la
  vue liste, via une variable CSS `--sp-plot-maxw` (défaut **900 px**),
  appliquée en `max-width` + centrage (`margin-inline: auto`). Comme
  `listPlotHeight` lit `clientWidth`, plafonner la largeur **borne
  automatiquement la hauteur** ; le `ResizeObserver` par graphe (déjà en place)
  recalcule la hauteur quand la largeur effective change.
- **Contrôle** : un curseur (`<input type="range">`) dans la barre d'outils
  règle `--sp-plot-maxw` de **520 px** (compact) à **« aucun plafond »**
  (pleine largeur, valeur max = sentinelle `none`). Étiquette « Taille ».
- **Persistance** : la valeur est envoyée à l'extension (message `setPlotMaxw
  {value}`) et stockée dans `workspaceState` (clé `chazPlots.plotMaxw`) ;
  restaurée au chargement et appliquée avant le premier rendu (message
  `plotMaxw {value}` extension → webview, ou inclus dans l'init).
- **Portée** : vue liste uniquement. L'overlay comparaison (plein écran) est
  inchangé.

### Critère de réussite

Sur écran large, les graphes ne s'étalent plus au-delà du plafond et restent
centrés ; le curseur change la taille immédiatement ; la valeur survit à un
Reload Window.

## Volet B — Légende de comparaison plus claire

### État

`overlayTrace(trace, label, index)` fait `out.name = label + " - " + name` où
`label` vient de `compareLabel(index)` (« A », « B », …). La légende lit
« A - sin(x) » sans indiquer la figure source.

### Solution

Préfixer par le **titre de la figure source** au lieu de la lettre :
`out.name = prefix + " : " + name`, où `prefix` = titre de la figure tronqué à
~18 caractères. Repli sur la lettre (`compareLabel(index)`) si la figure n'a pas
de titre exploitable (vide ou non alphanumérique). `mergedPlotlyFigure` passe le
titre de la figure à `overlayTrace` (la figure est disponible dans la boucle
`figs.forEach`). La logique de préfixe (troncature + repli) est une petite
fonction pure `compareLegendPrefix(title, index)` réutilisable et testable.

## Volet C — Glisser de légende

Ajouter `edits: { legendPosition: true }` à l'objet retourné par
`plotlyConfig(fig)`. La légende devient déplaçable au glisser (natif Plotly) ; la
position (`layout.legend.x/y`) part dans les exports `Plotly.toImage`. Pas de
nouvelle UI, pas de persistance de la position (hors périmètre, choix
utilisateur).

## Volet D — Éditeur d'entrée de légende

### Déclencheur

Bouton dédié dans la modebar (« éditer la légende »,
`config.modeBarButtonsToAdd`, même schéma que l'encart et la mesure), qui bascule
un drapeau `gd._spLegendEditArmed` et un retour visuel. Quand armé, le handler
`plotly_legendclick` **ouvre l'éditeur** pour la trace cliquée et **retourne
`false`** (empêche le masquage natif). Désarmé : comportement Plotly normal
(clic légende = masquer/afficher). Exclusif avec encart/mesure (désarme les
autres, comme ces modes le font déjà entre eux).

### Éditeur

Petit panneau HTML (même famille que `error-panel` / panneau mesure) :
- **Nom** : `<input type="text">`.
- **Couleur** : `<input type="color">`.
- **Style de trait** : `<select>` plein / tirets / points / tiret-point.
- **Épaisseur** : `<input type="number">` (ou range), bornée.
- **Marqueur** : `<select>` forme (aucun / cercle / carré / triangle / croix /
  losange) + **taille** (`<input type="number">`).
- Boutons **Appliquer** / **Fermer**.

À l'ouverture, les champs sont pré-remplis depuis la trace courante
(`el.data[curveNumber]`). « Appliquer » applique le patch via `Plotly.restyle(el,
patch, [curveNumber])`.

### Module pur

`media/legend_edit.js` (`LegendEdit`, UMD : `self.LegendEdit` côté webview,
`require` sous Node) :
- `LegendEdit.LINE_DASHES`, `LegendEdit.MARKER_SYMBOLS` — listes d'options
  (libellé FR → valeur Plotly).
- `LegendEdit.readTrace(trace) → valeurs` — extrait les valeurs courantes
  (nom, couleur, dash, épaisseur, symbole, taille) d'une trace, avec défauts.
- `LegendEdit.buildRestyle(valeurs) → patch` — construit l'objet `Plotly.restyle`
  (`{ name, "line.color", "line.dash", "line.width", "marker.color",
  "marker.symbol", "marker.size" }`), en omettant les champs vides/invalides.
Testé par `test/test_legend_edit.js` (Node). La glue (panneau, ouverture au
clic, persistance) reste dans `panel.html`.

### Persistance (vue liste)

Après « Appliquer » sur un graphe de la **vue liste** :
- mettre à jour `figStore[id].plotly.data[curveNumber]` (miroir mémoire) ;
- envoyer `updateFigure { id, traceIndex, patch }` à l'extension, qui applique le
  patch à `figures[].plotly.data[traceIndex]` et **ré-écrit** la figure via
  `storage.add(fig)` (best-effort, comme la persistance existante).
L'édition survit au Reload Window et figure dans tous les exports (PNG/SVG/PDF/
bundle/CSV, qui partent de l'élément vivant ou de la figure stockée).

En **comparaison**, l'éditeur marche aussi (même `renderPlotly`) mais l'édition
est **de session** (la vue comparaison n'est pas persistée) : on applique le
`restyle` sans message `updateFigure`.

### Identification de la trace persistée

`plotly_legendclick` fournit `curveNumber` = index dans `el.data`. En vue liste,
`el.data` correspond 1:1 à `figStore[id].plotly.data` (même ordre), donc
`traceIndex = curveNumber`. (En comparaison, pas de persistance, donc pas de
correspondance à garantir.)

## Protocole de messages (webview ⇄ extension)

Ajouts :
- `setPlotMaxw { value }` (webview → ext) : persiste la taille dans
  `workspaceState` (`chazPlots.plotMaxw`).
- `plotMaxw { value }` (ext → webview) : valeur restaurée au chargement.
- `updateFigure { id, traceIndex, patch }` (webview → ext) : applique le patch à
  la figure stockée et ré-écrit via `storage.add`.

## Modules touchés

- `media/panel.html` — les 4 volets (CSS `--sp-plot-maxw` + curseur ; préfixe de
  légende ; `edits.legendPosition` ; bouton modebar + panneau éditeur + glue +
  persistance).
- `extension.js` — `setPlotMaxw`/`plotMaxw` (workspaceState), `updateFigure`
  (mise à jour `figures[]` + `storage.add`), injection de `{{legendEditUri}}`.
- `media/legend_edit.js` — **nouveau** module pur `LegendEdit` + petite fonction
  `compareLegendPrefix` (peut vivre dans ce module ou un util ; regroupées ici
  car toutes « présentation de légende »).
- `test/test_legend_edit.js` — **nouveau** harnais Node (buildRestyle, readTrace,
  compareLegendPrefix).
- `test/check_panel_html.js` — placeholder `{{legendEditUri}}` + nouveaux ids
  (curseur taille, champs de l'éditeur).
- `storage.js` — réutilise `add(fig)` ; pas de nouvelle API attendue (à
  confirmer au plan).
- `README.md` / `CLAUDE.md` — documenter les 4 volets.

## Tests & vérification

- `node test/test_legend_edit.js` — `buildRestyle`, `readTrace`,
  `compareLegendPrefix` (troncature, repli sur lettre).
- `node test/check_panel_html.js` — placeholders + ids à jour.
- `node --check extension.js && node --check media/legend_edit.js`.
- Recette manuelle dev-host : plafond + curseur de taille (et persistance au
  Reload) ; légende compare préfixée par le titre ; glisser de légende ; éditeur
  (nom/couleur/trait/marqueur) en vue liste avec persistance, et en comparaison
  (session).

## Hors périmètre

- Persistance de la **position** de la légende déplacée (volet C) — exports
  seulement.
- Édition multi-traces simultanée ; thèmes de palette globaux.
- Contrôle de taille pour l'overlay comparaison (vue liste uniquement).
