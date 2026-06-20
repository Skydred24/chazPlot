# Plus de types de tracé en interactif (errorbar / fill_between / text) — Design

Date : 2026-06-20
Statut : validé, prêt pour le plan d'implémentation

## Objectif

Étendre le convertisseur matplotlib→Plotly (`python/_mpl_to_plotly.py`) pour
rendre **interactifs** (au lieu de retomber en SVG) trois types très courants :

1. `ax.errorbar(...)` — barres d'erreur ;
2. `ax.fill_between(...)` — aires remplies / bandes de confiance ;
3. `ax.text(...)` / `ax.annotate(...)` — texte et annotations fléchées.

Périmètre limité au convertisseur Python et à ses tests (`test/test_convert.py`)
+ la doc. Pas de changement au protocole `/figure`, à `extension.js`, ni au
webview.

## Principe transverse : la frontière de correction reste

Comportement existant **conservé** : si un artiste précis ne peut pas être
converti fidèlement, `convert_figure()` renvoie `None` → repli **SVG de toute la
figure**. On ne produit jamais un rendu interactif faux.

- Chaque nouveau `_convert_*` renvoie `None` (ou un sentinel équivalent) dès
  qu'il rencontre un cas non géré.
- `_has_unsupported_artist()` n'échoue plus que sur les artistes réellement
  inconnus ; il laisse désormais passer les `PolyCollection` (fill_between) et
  les `LineCollection` appartenant à un `ErrorbarContainer`.

## Refactor du garde-fou + suivi des artistes « réclamés »

`ax.errorbar` crée plusieurs artistes pour un seul tracé : une `Line2D` de
données, des caplines (`Line2D`) et des barres (`LineCollection`). Sans
précaution, la boucle `ax.get_lines()` compterait la ligne de données et les
caps comme des courbes séparées (doublons), en plus de la trace errorbar.

Solution, calquée sur le `bar_rectangles` déjà utilisé pour les barres :

- avant les boucles de conversion, parcourir `ax.containers` pour collecter les
  `ErrorbarContainer` et bâtir un **ensemble d'artistes réclamés** (ligne de
  données + caplines + barlinecols) ;
- la boucle `for line in ax.get_lines()` **saute** toute ligne présente dans cet
  ensemble ;
- `_has_unsupported_artist()` reçoit l'info nécessaire pour **laisser passer**
  les `LineCollection` réclamées par un errorbar et les `PolyCollection`
  (fill_between) ; toute autre `Collection` continue de provoquer le repli SVG.

## 1. errorbar → `scatter` + `error_x` / `error_y`

- Itère `ax.containers`, ne traite que les `ErrorbarContainer`.
- La ligne de données fournit `x`, `y`, le mode (`lines` / `markers` /
  `lines+markers` selon `linestyle`/`marker`), la couleur — réutilise la logique
  de `_convert_line` autant que possible.
- Magnitudes d'erreur reconstruites depuis les segments des `barlinecols`
  (`LineCollection`) :
  - pour chaque point, le segment va de `bas` à `haut` ; `err_minus = y − bas`,
    `err_plus = haut − y` ;
  - **symétrique** (`err_minus ≈ err_plus`) → `error_y = {type:'data', array:[…]}` ;
  - **asymétrique** → `error_y = {type:'data', symmetric:false, array:[err_plus],
    arrayminus:[err_minus]}` ;
  - même logique pour `error_x` (segments horizontaux).
- Orientation (x vs y) déterminée par la direction des segments (x constant →
  barres verticales → `error_y` ; y constant → `error_x`).
- Appariement segment↔point par l'abscisse (resp. ordonnée) du segment.
- **Limite mineure assumée** : la taille des caps (`capsize`) utilise le rendu
  Plotly par défaut, pas de calage pixel-perfect.

## 2. fill_between → 2 traces `fill:'tonexty'`

- `ax.fill_between` produit une `PolyCollection`. On la convertit par path :
  - **chaque** path (gère `where=` qui crée plusieurs polygones disjoints) est
    découpé en frontière haute (`y1`) et basse (`y2`) à partir de ses sommets
    (parcours aller le long de `y1`, retour le long de `y2`) ;
  - on émet une trace **basse** d'abord (`mode:'lines'`, `showlegend:false`,
    ligne transparente ou fine) puis une trace **haute** avec `fill:'tonexty'` ;
  - `fillcolor` = couleur de face de la collection avec son alpha
    (`get_facecolor()`), `line.color` éventuellement = couleur de bord.
- Si la géométrie d'un path n'est pas une bande exploitable (nombre de sommets
  inattendu, pas de structure aller/retour) → `None` → SVG.
- `fill_betweenx` (bandes verticales) **non géré** dans ce lot → SVG.

## 3. text() / annotate() → `layout.annotations`

- On **retire** le garde-fou `if len(ax.texts) > 0: return None`
  (`_mpl_to_plotly.py:556`).
- Pour chaque `Text` non vide de `ax.texts` :
  - position via `get_position()` ;
  - **détection du transform** : `transData` → référence axe
    (`xref:'x'+suffix`, `yref:'y'+suffix`) ; `transAxes` → référence papier
    restreinte au domaine de l'axe n'est pas triviale, donc `transAxes` →
    `xref:'paper'`/`yref:'paper'` (0–1) en première version ; tout autre
    transform → `None` → SVG ;
  - police (taille, couleur via `get_color()`), rotation (`get_rotation()`),
    alignements (`get_ha()`/`get_va()` → `xanchor`/`yanchor`).
- `Annotation` avec flèche (`arrowprops` non nul) : `xy` = cible de la flèche,
  `xytext`/position = ancrage du texte → annotation Plotly avec `showarrow:true`
  et `ax`/`ay` (décalage). Sans `arrowprops` → `showarrow:false`.
- Les annotations sont ajoutées à `layout["annotations"]` (déjà initialisé à
  `[]`). Si l'axe hôte est un axe date, l'abscisse est convertie en ISO comme
  pour les traces.

## Câblage dans `convert_figure()`

Ordre dans la boucle `_classify_axes` (par axe) :

1. construire l'ensemble des artistes réclamés (errorbar) ;
2. `_has_unsupported_artist(ax, bar_rectangles, claimed)` — repli si artiste
   inconnu ;
3. boucle `get_lines()` en sautant les lignes réclamées ;
4. boucle `get_children()` : ajoute `PolyCollection` → `_convert_fill_between`
   (peut renvoyer plusieurs traces) ;
5. boucle `ax.containers` : `BarContainer` (existant) + `ErrorbarContainer` →
   `_convert_errorbar` ;
6. boucle `ax.texts` → `_convert_text` → `layout["annotations"]` ;
7. conversion ISO des axes date appliquée aux traces **et** aux annotations
   ajoutées pour cet axe.

## Gestion d'erreurs (résumé)

Aucun crash : tout cas non géré renvoie `None` et déclenche le SVG. Cas
explicitement repliés en SVG : `fill_betweenx`, géométrie de bande inattendue,
text/annotate avec transform exotique, et tous les types hors périmètre
(contour, quiver/streamplot, polaire, 3D, pie).

## Tests

Fichier : `test/test_convert.py` (`unittest`). Nouvelles classes / cas :

- **errorbar** : symétrique (`yerr` scalaire), asymétrique (`yerr=[lo, hi]`),
  `xerr` ; vérifie `error_y`/`error_x` (`array`, `arrayminus`, `symmetric`) et
  l'absence de doublons (la ligne de données n'apparaît pas deux fois).
- **fill_between** : région simple (2 traces, la 2ᵉ `fill:'tonexty'`),
  multi-régions via `where=` (paires de traces), géométrie inattendue → `None`.
- **text/annotate** : `text()` en coordonnées données (annotation `xref:'x'`),
  `annotate()` avec flèche (`showarrow:true`, `ax`/`ay`), `text()` en
  `transAxes` (`xref:'paper'`).
- **non-régression du repli** : une figure avec un artiste non supporté (ex.
  `quiver`) renvoie toujours `None`.

## Documentation

- `README.md` « Limites connues » : retirer errorbar, fill_between,
  text/annotate de la liste des artistes non gérés ; préciser que restent en
  SVG contour/contourf, quiver/streamplot, polaire, 3D, pie, `fill_betweenx`.
- `CLAUDE.md` : mettre à jour la liste des artistes supportés et des lacunes
  connues du convertisseur.

## Hors périmètre (YAGNI pour ce lot)

- `fill_betweenx` (orientation verticale).
- contour/contourf, quiver/streamplot, axes polaires, 3D, pie.
- Calage pixel-perfect des caps d'errorbar.
- `transAxes` restreint au sous-domaine exact d'un axe (on utilise `paper`).
