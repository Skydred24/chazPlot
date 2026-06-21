# Rendu visuel « pro » du panneau (polissage natif-thème) — Design

Date : 2026-06-21
Statut : validé, prêt pour le plan d'implémentation

## Objectif

Relever le niveau de finition visuelle du webview (`media/panel.html`) pour qu'il
lise comme un « produit fini » et non comme une extension VS Code par défaut.

Direction retenue : **polissage natif-thème**. Les couleurs continuent de
dériver du thème VS Code de l'utilisateur (variables `--vscode-*`) ; on ne crée
PAS de palette de marque indépendante. Le gain « pro » vient de la hiérarchie
typographique, des espacements, des composants soignés et des micro-interactions.

Ton retenu : **calme et aéré** (espace généreux, séparateurs discrets, ombres
légères).

## Périmètre

Surfaces traitées (par ordre de priorité) :

1. **Toolbar + cartes** de la liste principale ;
2. **Mode comparaison** (grille côte-à-côte, superposition, sous-barre « Erreur »,
   contrôle d'opacité) ;
3. **Overlay « agrandir » + encart** (zoom-inset).

Hors périmètre pour cette passe : lecteur d'animation et état vide — **non
retouchés**, mais laissés cohérents (ils héritent des tokens, pas de régression).

## Contraintes (frontière de l'intervention)

- **CSS + micro-balisage uniquement.** Aucune modification de la logique JS, du
  protocole `postMessage` (webview ⇄ extension), du serveur HTTP, ni du Python.
- Le seul balisage autorisé à changer : ajouts de classes/wrappers purement
  présentationnels (ex. envelopper les deux boutons compare dans un groupe
  segmenté). Aucun `id` utilisé par le JS ne change ; aucun handler n'est touché.
- Tout reste **dérivé du thème** ; les `var(--vscode-*, <fallback>)` conservent
  leurs fallbacks actuels.
- Aucune dépendance ni ressource réseau ajoutée (la CSP du webview interdit
  `connect-src` ; Plotly.js reste le seul script bundlé).

## 1. Couche de tokens sémantiques

Problème actuel : des couleurs **en dur** supposent un thème sombre et jurent sur
un thème clair :

- `.coords` / `.compare-pane-title` : `rgba(15,23,42,…)` + texte `#f4f1e8` ;
- `.tag` : `rgba(55,148,255,.32)` + texte `#f4f1e8` ;
- `.badge` : `rgba(177,128,215,.28)`.

Solution : un bloc de variables sémantiques dans `:root`, dérivées du thème, que
tout le reste du CSS consomme. Définition (valeurs indicatives, fallbacks
conservés) :

```
--sp-surface    : var(--vscode-editorWidget-background, #252526)   /* cartes */
--sp-surface-2  : var(--vscode-sideBar-background, #252526)        /* barres */
--sp-border     : var(--vscode-panel-border, #3c3c3c)
--sp-text       : var(--vscode-foreground, #cccccc)
--sp-text-dim   : color-mix(in srgb, var(--vscode-foreground, #ccc) 60%, transparent)
--sp-accent     : var(--vscode-focusBorder, var(--vscode-charts-blue, #3794ff))
--sp-accent-soft: color-mix(in srgb, var(--sp-accent) 18%, transparent)
--sp-shadow-1   : 0 1px 2px rgba(0,0,0,.16)
--sp-shadow-2   : 0 4px 12px rgba(0,0,0,.22)
--sp-pad        : 16px
--sp-gap        : 20px            /* remplace 16px */
--sp-radius     : 10px            /* cartes ; contrôles 6px ; pills 999px */
```

Règles :

- `color-mix` est supporté par le moteur Chromium du webview VS Code (récent) ;
  si on veut une sécurité maximale, `--sp-text-dim` peut retomber sur
  `opacity:.6` appliqué localement. **Décision : utiliser `color-mix`**, avec
  `opacity` comme repli implicite déjà présent à plusieurs endroits.
- Les chips lisibles (coords, tags, titres de volets) n'utilisent plus de texte
  `#f4f1e8` en dur : texte = `--sp-text`, fond = `--sp-surface-2` ou
  `--sp-accent-soft`, bordure = `--sp-border`. Elles deviennent correctes sur
  thème clair comme sombre.
- **Un seul accent** (`--sp-accent`) pour : point de marque, focus, états actifs,
  poignées d'encart, slider, pills d'action. On supprime le mélange bleu + navy.

## 2. Toolbar + cartes

### Toolbar

- Regroupement logique de gauche à droite : marque (point + « Graphes ») ·
  compteur · recherche · `spacer` · **groupe segmenté** « Côte à côte /
  Superposer » · « Ajuster à la largeur » · bouton primaire « Tout enregistrer ».
- Le groupe segmenté = wrapper `.segmented` autour des deux boutons compare
  existants (mêmes `id`, mêmes handlers) : coins arrondis aux extrémités,
  séparateur interne 1px, état `:disabled` cohérent.
- Hauteur et padding légèrement augmentés ; `gap` régularisé.
- `:focus-visible` : anneau `--sp-accent` (2px) sur boutons, recherche, toggles.

### Cartes

- `#list` : `gap: var(--sp-gap)` (20px), padding cohérent.
- `.card` : `border-radius: var(--sp-radius)`, `border: 1px var(--sp-border)`,
  fond `--sp-surface`, `box-shadow: var(--sp-shadow-1)`.
- **Survol** : `transform: translateY(-1px)` + `box-shadow: var(--sp-shadow-2)` +
  `border-color` légèrement accentuée ; transition 150ms.
- `.card-head` : titre `14px/600` (`--sp-text`), ligne méta `11px`
  (`--sp-text-dim`) au format `HH:MM · TYPE`. Padding aéré.
- **Badge de type** (SVG / PNG / PLOTLY / ANIM) : pill `999px`, fond
  `--sp-accent-soft`, texte `--sp-text`, `font-size:10px`, casse/letter-spacing
  conservés. Une seule couleur (accent), la distinction reste le label.
- Boutons d'action de la carte (`.iconbtn`) : restent visibles ; au survol de la
  carte ils gagnent un peu d'opacité/contraste. États `active`/`has-inset`
  re-basés sur `--sp-accent`.
- `.tagrow` / `.tag` : pills sur tokens (`--sp-accent-soft` + `--sp-text`).
- Zone graphe (`.imgwrap` / `.plotwrap`) : fond blanc conservé (lisibilité des
  figures), padding interne régularisé, léger filet `--sp-border` en haut pour
  séparer du header sans trait dur.

## 3. Mode comparaison

- `.compare-pane-title` : passe sur tokens (`--sp-surface-2` + `--sp-text`),
  fin filet bas `--sp-border` au lieu du bandeau navy opaque.
- `.compare-grid` : `gap` régularisé, fond `--sp-border` (lignes de grille fines)
  conservé mais cohérent avec le reste.
- **Sous-barre « Erreur »** (`.error-panel`) : alignée visuellement sur la
  toolbar (`--sp-surface-2`, padding cohérent). Les cases de type d'erreur
  (`.error-type`) regroupées en **chips** cliquables (label + case), espacement
  régulier. Boutons « Appliquer / Masquer » en style compact cohérent.
- **Contrôle d'opacité** (`.opacity-control`) : libellé + slider avec
  `accent-color: var(--sp-accent)`, largeur et alignement soignés.
- `.error-warn` : conserve la couleur d'avertissement du thème
  (`--vscode-charts-yellow`).

## 4. Overlay « agrandir » + encart

- `.overlay .obar` : même grammaire visuelle que la toolbar (`--sp-surface-2`,
  filet `--sp-border`, titre `13px/600`).
- `.coords` (pill de coordonnées) : retravaillée sur tokens (monospace conservé,
  fond `--sp-surface-2`, bordure `--sp-border`, ombre `--sp-shadow-1`),
  `:empty` toujours transparent.
- **Encart** (`media/inset_layout.js` ne change pas — seulement le CSS dans
  `panel.html`) :
  - `.inset-overlay` : inchangé fonctionnellement (capte les pointer events) ;
  - `.inset-handle` : poignées un peu plus fines, fond clair, bordure
    `--sp-accent`, `--sp-shadow-1` léger ;
  - la bordure colorée visible reste la **shape Plotly** (présente dans les
    exports PNG) — non modifiée ici, on ne touche qu'au chrome HTML.
- `.sp-inset-armed` : contour pointillé re-basé sur `--sp-accent`.

## Micro-interactions (transverses)

- Transitions homogènes : `120–150ms ease` sur `background`, `box-shadow`,
  `transform`, `border-color`.
- `button:active { transform: translateY(1px) }` conservé/généralisé.
- `:focus-visible` cohérent (anneau accent) sur tous les contrôles interactifs.
- Aucune animation décorative lourde (rien qui distraie de la figure).

## Tests / vérification

Pas de test automatisé sur le CSS. Vérification manuelle dans l'Extension
Development Host :

- `node --check` impossible sur du HTML ; on valide que `panel.html` reste un
  document bien formé (ouverture du dev host sans erreur console).
- `extension.js:webviewHtml()` substitue toujours `{{nonce}}`, `{{cspSource}}`,
  `{{plotlyUri}}`, `{{errorMathUri}}`, `{{insetLayoutUri}}` — **ne pas renommer
  ni retirer ces placeholders**.
- Scénario visuel : lancer `test/test_plots.py` (7 figures + 1 animation) et
  `test/test_stress.py`, puis vérifier :
  1. liste principale (cartes, badges, survol, recherche, tags) ;
  2. comparaison côte-à-côte ET superposition + bouton « Erreur » + opacité ;
  3. overlay « agrandir » + création/déplacement/redimensionnement d'un encart ;
  4. exports PNG/SVG inchangés (la bordure d'encart reste dans le PNG) ;
  5. **basculer un thème clair et un thème sombre** : aucune zone illisible
     (les anciens chips navy étaient le risque principal).

## Hors périmètre (YAGNI pour ce lot)

- Refonte du lecteur d'animation et de l'état vide.
- Palette de marque indépendante du thème (écartée : direction native retenue).
- Changement de structure des cartes (anatomie conservée).
- Toute modification de logique JS/Python ou du protocole de messages.
