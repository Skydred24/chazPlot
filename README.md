# Chaz Plots — panneau de graphes matplotlib pour VS Code

Reproduit le volet **Graphes** de Spyder dans VS Code : chaque `plt.show()`
envoie la figure dans un panneau unique et scrollable, sans ouvrir de fenêtre
et sans bloquer le script. Les figures deviennent des **graphes Plotly
interactifs** (zoom, survol, export), les **animations** sont rejouées dans un
lecteur intégré, et tout est **persisté** d'une session à l'autre.

> **Nom de l'extension : « Chaz Plots »** (anciennement « Spyder Plots »).
> Dans cette doc, « Spyder » désigne uniquement l'IDE dont on reproduit le
> volet *Graphes* — ce n'est pas le nom de l'extension.

## Fonctionnalités

- **`plt.show()` inchangé** : le backend matplotlib est remplacé
  automatiquement dans les terminaux VS Code.
- **Graphes interactifs** (Plotly) : zoom, pan, valeurs au survol, autoscale,
  double-clic pour réinitialiser. Repli automatique en **SVG** (toujours net)
  pour les figures non convertibles, et **PNG** haute résolution toujours
  généré pour l'enregistrement.
- **Navigation à la souris** : **Ctrl/Cmd + molette** zoome autour du curseur,
  **clic-molette (bouton du milieu) maintenu** fait un pan. Fonctionne aussi sur
  les axes log et date, les sous-graphes, l'axe `twinx` et le sous-graphe
  d'erreur.
- **Cartes de champ** : `imshow`, `pcolormesh` et nuages de points colorés
  conservent leur **colorbar avec son titre/unité** (le label passé à
  `colorbar(..., label=…)` est repris).
- **Animations** matplotlib (`FuncAnimation` / `ArtistAnimation`) détectées
  automatiquement et rejouées : lecture/pause, navigation frame par frame,
  barre de navigation, vitesse 0.25×–4×.
- **Agrandir** : overlay plein panneau qui re-rend en vectoriel (net à toute
  taille), avec redimensionnement automatique.
- **Taille automatique en vue liste** : les graphes gardent une largeur
  confortable selon la place disponible, le ratio de la figure et la hauteur de
  fenetre. En plein ecran, ils ne deviennent plus demesures ; en panneau etroit,
  ils remplissent naturellement la carte.
- **Zoom encarté** : armez le bouton dédié de la modebar puis tracez une zone —
  elle s'affiche en encart sur le graphe original (en plus du zoom Plotly
  standard). L'encart se **déplace** (corps) et se **redimensionne** (poignées de
  coin) ; **clic droit** pour l'effacer. Marche aussi en mode comparaison.
- **Mesures** : bouton « règle » de la modebar, puis deux clics figent deux
  curseurs A et B. Lecture immédiate de Δx, Δy et **pente** ; si les deux
  points sont sur la même courbe, **aire sous la courbe** (trapèzes) et
  **min/max/moyenne** sur la plage [xA, xB]. Clic droit pour effacer.
- **Legende et textes editables** : bouton crayon dans la modebar. Cliquez une
  entree de legende pour modifier nom, couleur, style/epaisseur de trait et
  marqueur ; cliquez un titre, un titre de sous-graphe ou un label d'axe pour
  modifier uniquement le texte, la taille de police, le gras et l'italique.
  Quelques commandes LaTeX usuelles dans les textes (`$\delta$`, `$\Delta$`,
  etc.) sont converties en symboles Unicode. Les edits sont persistants en vue
  liste et temporaires en comparaison ; la legende peut aussi etre deplacee a la
  souris.
- **Style publication** : bouton dedie dans la modebar pour appliquer un preset
  global a la figure (**Article**, **Presentation**, **Rapport** ou
  **Colorblind**). Le choix est previsualise immediatement ; **Appliquer** le
  persiste, **Fermer** restaure l'etat precedent. Les presets ajustent palette,
  tailles de police, epaisseurs, marqueurs, grille et fond pour obtenir une
  figure prete a exporter sans retoucher le script Python. Des **presets
  personnalises** peuvent etre ajoutes au menu via le reglage
  `chazPlots.customPlotStyles`.
- **Import CSV / DAT** : glissez un `.csv`, `.dat` ou `.txt` sur une figure pour
  superposer des mesures, ou sur la zone vide pour creer un nouveau graphe. Le
  bouton **Importer CSV** accepte plusieurs fichiers et ouvre le meme assistant
  de mapping X/Y sans glisser-deposer. Les gros fichiers (>= 50 Mo) passent en
  mode apercu + lecture par blocs : Chaz Plots parcourt le fichier complet mais
  ne garde qu'un echantillon borne pour preserver l'interactivite.
- **Image -> graphe + code matplotlib** : les PNG/SVG exportes embarquent leurs
  donnees Plotly ; redeposez l'image dans Chaz Plots (ou bouton « Image -> graphe
  + code ») pour **retracer la figure** dans le panneau *et* obtenir le script
  matplotlib qui la reproduit.
- **Digitalisation d'une image quelconque** : extraire les courbes d'une image
  PNG/SVG quelconque (graphe public, photographie, scan). Via le bouton
  « Digitaliser », ou simplement en **glissant l'image dans le panneau avec
  Shift** — si elle ne contient pas de données Chaz Plots, l'outil de
  digitalisation s'ouvre (une image auto-portée part, elle, en « Image → code »).
  Détection automatique par couleur et style de trait ; calibration par 4 nombres
  (min/max des axes X et Y) ; brosse-guide et mode manuel par clics pour les cas
  ambigus ; revue interactive avec cases à cocher. Les courbes extraites
  deviennent une nouvelle figure, peuvent être exportées en CSV ou converties en
  code matplotlib. **Plusieurs images à la fois** sont traitées à la suite (file
  d'attente avec compteur « k/N » et bouton « Suivante »).
- **Planche multi-panneaux** : composez plusieurs figures selectionnees en une
  planche `(a)`, `(b)`, `(c)` avec grille, ordre, largeur cible et legende partagee.
- **Copier-coller de figures** : copiez une figure dans une fenetre VS Code et
  recollez-la dans une autre, provenance incluse.
- **Undo par figure** : `Ctrl/Cmd+Z` annule les editions du graphe survole
  (style, traces ajoutees, textes, encarts, vignettes, zoom/pan).
- **Lignes et annotations ajoutables** : depuis le menu **Ajouter courbe**, creez
  des `hline`/`vline`, puis deplacez-les, raccourcissez-les et modifiez couleur,
  style et epaisseur avec l'editeur de legende.
- **Copier** : met l'image de la figure dans le presse-papiers (collable dans
  Word, un mail, un chat…).
- **Export CSV** : bouton « CSV » sur les figures interactives — exporte les
  données visibles (format *tidy* `serie,x,y[,z]`, respecte le zoom courant sur
  l'axe X). Lignes, points, barres, heatmaps et axes polaires gérés.
- **Enregistrer / Tout enregistrer** (PNG, SVG ou **PDF**), **Supprimer / Tout
  supprimer**. Les images exportées peuvent être incluses dans LaTeX/Overleaf
  avec `\includegraphics`. Le PDF est vectoriel (rendu matplotlib natif) pour les
  figures simples, et **raster haute résolution** (généré par le webview) pour
  les vues avec encart, vue erreurs et vue comparaison.
- **Bundle publication** : bouton « Bundle » → un dossier prêt pour Overleaf
  contenant `figure.png`, `figure.svg`, **`figure.pdf`**, `metadata.json` et
  `figure.tex` (`\includegraphics` sans extension : pdflatex prend le PDF).
- **Export GIF / MP4 des animations** : le backend pré-encode un GIF (via
  PillowWriter, par défaut) et optionnellement un MP4 (via ffmpeg + libx264
  image2pipe, opt-in via `chazPlots.includeMp4`). Les cartes d'animation
  exposent des boutons « Enregistrer GIF » et « Enregistrer MP4 » quand
  l'asset est disponible. **MP4 nécessite ffmpeg** sur le PATH (vérifié à
  l'exécution ; un message d'erreur clair s'affiche sinon).
- **Live update opt-in** : nouveau réglage `chazPlots.replaceOnSameProvenance`
  (défaut **OFF**). Quand il est activé, un rerun du même script au même
  `plt.show()` (et même titre) met à jour la carte existante au lieu d'en
  empiler une nouvelle — vos tags, ts et id sont préservés. **Pour vos études
  paramétriques en boucle `for`, laissez ce réglage OFF** (et utilisez
  `plt.title(f"p={p}")` pour des titres dynamiques, sécurité supplémentaire).
- **Comparaison** : sélection de plusieurs graphes pour les superposer ou les
  afficher côte à côte.
  - **Legendes explicites** : en superposition, les traces sont prefixees par le
    titre de leur figure source, plus lisible que A/B quand plusieurs graphes
    sont compares.
  - **Zoom synchronisé** en côte à côte : zoomer/réinitialiser un graphe applique
    la même plage d'axes aux autres.
  - **Sous-graphes préservés** : des figures de même structure multi-sous-graphes
    se superposent grille par grille (au lieu du repli image).
  - **Erreur entre courbes** : en superposition, bouton « Erreur » pour tracer
    l'écart de N courbes par rapport à une référence (différence signée, absolue,
    relative, relative %), dans un sous-graphe lié à axe X partagé. Interpolation
    linéaire sur la grille de la référence ; courbes non superposables en Plotly
    (repli image) exclues. **Sélection au clic** : premier clic sur une courbe =
    référence, clics suivants = courbes à comparer (une courbe d'erreur par
    comparée vs la référence).
  - **Barre d'export complète en vue comparaison** : Enregistrer PNG / SVG /
    PDF, Copier, CSV et Bundle disponibles pour la vue superposée, comme pour
    les figures individuelles.
- **Provenance** : chaque figure mémorise d'où elle vient — script + ligne du
  `plt.show()`, dossier, interpréteur, ligne de commande, commit git (+ branche
  et état modifié) et date complète. Affiché sous le titre (détail en infobulle)
  et inclus dans le `metadata.json` du bundle.
- **Tags & recherche** : étiquetez les figures ; la recherche couvre titre, tags
  **et provenance** (nom de script, fonction, branche/commit). **Tags cliquables**
  (clic = filtre) et **tri** par arrivée / titre / type / script / date.
- **Persistance** : les figures (et leurs tags) réapparaissent après un Reload
  Window — pile propre à chaque workspace.
- Option **« Ajuster à la largeur »** (sinon taille native + scroll horizontal).

## Installation

### Paquet .vsix (recommandé)
```bash
npx @vscode/vsce package          # produit chaz-plots-0.13.0.vsix
code --install-extension chaz-plots-0.13.0.vsix
```

### Sans droits administrateur (Windows)
Aucune compilation, aucun `npm install` (extension en JavaScript pur) :
1. Copiez le dossier dans
   `%USERPROFILE%\.vscode\extensions\hugo.chaz-plots-0.13.0`.
2. Rechargez VS Code (`Ctrl+Shift+P` → « Reload Window »).
3. Ouvrez un **nouveau terminal** (les variables d'environnement ne sont
   injectées que dans les terminaux créés après l'activation).
4. Lancez `python test/test_plots.py` : le panneau **Graphes** s'ouvre.

### Mode développement
Ouvrez le dossier dans VS Code et appuyez sur `F5` (« Run Extension »).

## Commandes (Ctrl+Shift+P)

- `Chaz Plots : ouvrir le panneau`
- `Chaz Plots : tout enregistrer`
- `Chaz Plots : supprimer tous les graphes`

## Réglages (settings.json)

- `chazPlots.port` (défaut `53210`) — port local d'écoute (incrémenté si occupé).
- `chazPlots.dpi` (défaut `200`) — résolution des PNG.
- `chazPlots.animationDpi` (défaut `130`) — résolution de chaque frame d'animation.
- `chazPlots.animationMaxFrames` (défaut `600`) — plafond de frames par animation ; **0 = illimité**.
- `chazPlots.saveFormat` (défaut `png`) — format proposé par défaut.
- `chazPlots.includePdf` (défaut `true`) — générer aussi un PDF vectoriel
  (rendu matplotlib) pour la sauvegarde PDF et le bundle publication.
- `chazPlots.preRenderPlotlyPng` (défaut `false`) — pré-rendre un PNG matplotlib
  même pour les figures déjà interactives Plotly. Désactivé par défaut pour
  accélérer `plt.show()` (l'export PNG reste possible via le webview).
- `chazPlots.preRenderPlotlyPdf` (défaut `false`) — idem pour un PDF matplotlib
  natif des figures Plotly (l'export PDF raster reste possible via le webview).
- `chazPlots.customPlotStyles` (défaut `{}`) — presets de style personnalisés
  ajoutés au menu **Style publication** (cf. ci-dessous).
- `chazPlots.autoDetachWindow` (defaut `false`) - ouvrir automatiquement le
  panneau Graphes dans une fenetre VS Code separee, pratique en double ecran.
- `chazPlots.embedFigureData` (defaut `true`) - embarquer les donnees Plotly dans
  les PNG/SVG exportes pour permettre **Image -> code**.
- `chazPlots.embedFigureDataMaxKB` (defaut `2048`) - taille maximale des donnees
  embarquees dans une image.
- `chazPlots.includeGif` (defaut `true`) - pre-encoder un GIF en plus des
  frames PNG pour chaque animation (cout negligeable, ~150-300 ms).
- `chazPlots.includeMp4` (defaut `false`) - pre-encoder un MP4 (ffmpeg
  + libx264). ATTENTION : bloque plt.show() plusieurs secondes par animation
  ; n'activez que si ffmpeg est installe.
- `chazPlots.refreshIdenticalReruns` (defaut `false`) - opt-in : rafraichit une
  carte seulement si le rerun produit exactement le meme rendu (meme provenance
  + meme contenu). OFF pour toujours empiler les reruns.
- `chazPlots.replaceOnSameProvenance` (defaut `false`) - opt-in : remplace la
  carte en place quand le rerun vient du meme script, de la meme ligne et du
  meme titre. OFF pour preserver les etudes parametriques en boucle.
- `chazPlots.persistFigures` (défaut `true`) — conserver les figures entre
  sessions. Désactivez pour un mode ultra rapide sans écriture disque.
- `chazPlots.autoReveal` (défaut `true`) — afficher le panneau à chaque figure.
- `chazPlots.maxPersistedFigures` (défaut `200`) — figures conservées entre sessions ; **0 = illimité**.

## Exemple

```python
import matplotlib.pyplot as plt
from matplotlib.animation import FuncAnimation

plt.plot([0, 1, 2], [3, 1, 4])
plt.show()                      # apparaît dans le panneau Graphes

fig, ax = plt.subplots()
line, = ax.plot([], [])
anim = FuncAnimation(fig, update, frames=60, interval=40)  # gardez la référence
plt.show()                      # lecteur d'animation dans le panneau
```

## Mini-demos

Ces exemples montrent les fonctionnalites visibles en quelques lignes. Lancez-les
depuis un **nouveau terminal VS Code** apres activation de l'extension.

### 1. Historique interactif et provenance

```python
import numpy as np
import matplotlib.pyplot as plt
x = np.linspace(0, 2*np.pi, 300)
plt.plot(x, np.sin(x), label="sin(x)")
plt.plot(x, np.cos(x), label="cos(x)")
plt.title("Deux courbes interactives")
plt.xlabel("x"); plt.ylabel("amplitude"); plt.legend(); plt.show()
```

A voir : zoom, coordonnees, provenance `script:ligne`, recherche, export PNG/SVG/PDF.

### 2. Sous-graphes, annotations et lignes de repere

```python
import numpy as np
import matplotlib.pyplot as plt
x = np.linspace(0, 6, 250)
fig, (ax1, ax2) = plt.subplots(2, 1, sharex=True)
ax1.plot(x, np.exp(-x/4)*np.sin(3*x), label="signal")
ax1.axhline(0, color="0.4", linestyle="--", label="zero")
ax1.annotate("maximum local", xy=(0.55, 0.75), xytext=(1.25, 0.95), arrowprops={"arrowstyle": "->"})
ax1.legend()
ax2.plot(x, np.gradient(np.sin(x), x), color="tab:orange", label="derivee")
ax2.axvline(3, color="tab:red", linestyle=":", label="repere")
ax2.legend(); plt.show()
```

A voir : `axhline` / `axvline` interactives, annotations, edition des courbes,
titres, axes et lignes de repere.

### 3. Comparer plusieurs runs

```python
import numpy as np
import matplotlib.pyplot as plt
x = np.linspace(0, 10, 400)
for damping in [0.05, 0.12, 0.2]:
    plt.figure()
    plt.plot(x, np.exp(-damping*x)*np.sin(2*x), label=f"damping={damping}")
    plt.title(f"Run damping={damping}"); plt.legend(); plt.show()
```

Cochez plusieurs graphes : **Cote a cote**, **Superposer**, puis **Erreur** pour
tracer les ecarts par rapport a une reference choisie au clic.

### 4. Importer des mesures CSV sur un modele

```python
import numpy as np
import matplotlib.pyplot as plt
x = np.linspace(0, 5, 250)
plt.plot(x, np.sin(x), label="modele")
plt.title("Modele + mesures importees"); plt.legend(); plt.show()
```

Ensuite utilisez **Importer CSV** dans la barre d'outils, ou dans le menu d'une
figure pour superposer un fichier `.csv`, `.dat` ou `.txt`. Le glisser-deposer
fonctionne aussi avec **Shift** maintenu.

### 5. Exporter puis regenerer le code depuis l'image

Exportez une figure en PNG/SVG, puis utilisez **Image -> code** sur cette image :
Chaz Plots ouvre un script matplotlib reconstruit depuis les donnees embarquees.

### 6. Planche de publication

Generez plusieurs figures, cochez-les, puis cliquez **Planche** pour composer une
figure `(a)`, `(b)`, `(c)` avec ordre, grille, largeur cible et legende partagee.

> Pour une page Marketplace plus parlante, ajoutez ensuite 2 ou 3 GIF dans
> `docs/media/` : `demo-show.gif`, `demo-compare.gif`, `demo-image-to-code.gif`,
> puis inserez-les avec `![Comparaison](docs/media/demo-compare.gif)`.
## Style SciencePlots

Les styles `science`, `ieee` et `nature` (issus de
[SciencePlots](https://github.com/garrettj403/SciencePlots), vendorisés dans
`python/styles/`) sont disponibles **sans installer le package** : le backend
les enregistre dans matplotlib à l'import. On choisit le style **par figure**,
dans le code, avec le mécanisme matplotlib standard :

```python
import matplotlib.pyplot as plt

with plt.style.context('science'):           # une figure science
    fig, ax = plt.subplots()
    ax.plot(x, y, label='données'); ax.legend()
    plt.show()

with plt.style.context(['science', 'ieee']): # empiler IEEE sur science
    ...
    plt.show()

plt.plot(x, y); plt.show()                    # figure normale
```

Les **exports** (PNG/SVG/PDF) d'une figure produite ainsi sont du vrai
SciencePlots, identiques aux images de référence. L'**aperçu interactif** Plotly
reste volontairement **brut** (pas d'approximation du style science) — il sert à
explorer/zoomer, pas à publier.

Une figure tracée sous `plt.style.context('science')` (ou `ieee`/`nature`) est
**détectée automatiquement** : son bouton d'export bascule sur « Export :
matplotlib » et la sauvegarde PNG/SVG/PDF puise dans le rendu matplotlib propre
plutôt que dans le rendu Plotly. Le bouton se clique pour forcer l'un ou l'autre.

> Note : `text.usetex` est forcé à `False` (pas de dépendance LaTeX) ; les polices
> serif passent par mathtext. La seule différence visible avec les images de
> référence est le moteur de texte mathématique.

## Limites connues

Chaque figure porte un **badge de rendu** : vert *INTERACTIF* (Plotly), ambre
*SVG* ou orange *PNG* en cas de repli. Survolez le badge pour la raison exacte
(artiste non géré, trop de points, SVG trop volumineux…), ce qui indique quoi
ajuster dans le code pour récupérer l'interactivité.

- **Interactif Plotly** : lignes, scatter, barres, heatmaps, `pcolormesh`,
  `contour`/`contourf`, `quiver`, `fill_between`, `errorbar`,
  `text()`/`annotate()`, subplots simples, `twinx`/`twiny` et axes polaires simples.
- **Artistes non gérés → rendu SVG/PNG** : `streamplot`, axes polaires avancés
  (barres, images, contours polaires), 3D, `pie`, et patches libres complexes.
- **boxplot** : moustaches et médianes sont converties en lignes ;
  `plt.boxplot(..., patch_artist=True)` conserve aussi les boîtes remplies.
- **Légende** : `loc` et `bbox_to_anchor` sont reproduits ; les légendes
  très personnalisées peuvent encore différer légèrement.
- Au-delà de ~500 000 points, ou si le SVG dépasse 8 Mo, repli automatique en PNG.
- **PDF raster pour les vues composées** : le PDF des figures avec encart, en
  mode erreurs et en mode comparaison est **raster** (capture PNG haute résolution
  encapsulée), pas vectoriel — l'option vectorielle (svg2pdf + jsPDF) n'a pas été
  retenue. Le PDF vectoriel matplotlib reste disponible pour les figures simples.
  Une figure modifiee dans le panneau (legende, textes/titres, style
  publication) est exportee en **PDF raster** haute resolution au lieu du PDF
  vectoriel natif, car le rendu vectoriel matplotlib d'origine ne reflete pas
  ces modifications. Les figures non modifiees restent en PDF vectoriel.
- **Multi-fenêtres** : un fichier de port temporaire sert de repli au backend ;
  il est partagé (la dernière fenêtre démarrée « gagne »). L'injection des
  variables d'environnement reste correcte par fenêtre.
- Les terminaux ouverts **avant** l'activation ne sont pas affectés : ouvrez-en
  un nouveau. Pour forcer le backend classique :
  `set MPLBACKEND=TkAgg` (cmd) ou `$env:MPLBACKEND="TkAgg"` (PowerShell).
- **Digitalisation (PNG/SVG quelconques)** : la détection automatique des courbes
  repose sur la couleur et le style de trait ; si deux courbes ont la même couleur
  **ET** le même style, elles sont fusionnées → utilisez le mode manuel (clics de
  points de départ) pour les cas litigieux. La légende ou du texte **dans la zone
  graphe** peuvent être mal interprétés → décochez-les dans la revue interactive.
  La détection de la boîte graphe suppose des **spines pleins** ; un graphe
  dépourvu de spines ou avec des styles particuliers peut nécessiter un ajustement
  manuel du rectangle. Pas d'OCR : les min/max d'axes se saisissent à la main
  (4 nombres) ; cases log optionnelles pour les échelles logarithmiques. Les axes
  secondaires, les axes cassés et les échelles polaires ne sont pas gérés. Les
  courbes très fines ou de faible contraste peuvent être manquées.

## Architecture

```
chaz-plots/
├── package.json                         manifeste de l'extension
├── extension.js                         serveur HTTP local + panneau webview
├── storage.js                           persistance des figures (disque + index)
├── media/
│   ├── panel.html                       interface du panneau (UI + lecteur)
│   ├── plotly.min.js                    Plotly.js embarqué
│   ├── plot_nav.js                      zoom molette + pan clic-milieu (pur)
│   ├── error_math.js                    écart entre courbes (pur)
│   ├── inset_layout.js                  placement/géométrie de l'encart (pur)
│   ├── measure_math.js                  mesures : pente, aire, stats (pur)
│   ├── csv_export.js                    export CSV tidy (pur)
│   ├── compare_util.js                  zoom sync + sous-graphes (pur)
│   ├── bundle_meta.js                   bundle publication (pur)
│   ├── pdf_export.js                    génération PDF raster webview (pur)
│   ├── data_import.js                   import CSV/DAT/TXT + mapping X/Y (pur)
│   ├── figure_codec.js                  donnees embarquees PNG/SVG (pur)
│   ├── plotly_to_py.js                  generation de code matplotlib (pur)
│   ├── board_layout.js                  planche multi-panneaux (pur)
│   ├── legend_edit.js                  edition/prefixes de legende (pur)
│   └── figure_filter.js                 recherche + tri des figures (pur)
├── python/
│   ├── vscode_spyder_plots_backend.py   backend matplotlib (module://)
│   └── _mpl_to_plotly.py                conversion figure → Plotly
└── test/
    ├── test_convert.py                  tests d'assertion du convertisseur (unittest)
    ├── test_plots.py                    démo (figures + 1 animation)
    ├── test_stress.py                   banc de torture (25 cas limites)
    ├── test_capture.py                  capture de frames d'animation
    └── test_show.py                     routage de show()
```

Au démarrage, l'extension ouvre un serveur HTTP sur `127.0.0.1:53210` (ou le
port libre suivant) et injecte dans les **nouveaux** terminaux :
`MPLBACKEND=module://vscode_spyder_plots_backend`, `PYTHONPATH` += le dossier
`python/`, `VSCODE_PLOTS_PORT`, `VSCODE_PLOTS_DPI`, `VSCODE_PLOTS_ANIM_DPI`,
`VSCODE_PLOTS_ANIM_MAX_FRAMES`, `VSCODE_PLOTS_PDF`, `VSCODE_PLOTS_PLOTLY_PNG`,
`VSCODE_PLOTS_PLOTLY_PDF`. À chaque `plt.show()`, le backend convertit la
figure (Plotly → SVG → PNG, ou frames d'animation) et l'envoie en POST au
panneau. Aucune dépendance Python hors matplotlib/numpy.

## Tests

```bash
python test/test_convert.py      # tests d'assertion du convertisseur (unittest)
node test/test_error_curves.js   # calcul d'erreur entre courbes (assertions)
node test/test_measure_math.js   # mesures sur courbe (pente, aire, stats)
node test/test_csv_export.js     # construction du CSV tidy
node test/test_compare_util.js   # synchro zoom + superposition de sous-graphes
node test/test_bundle_meta.js    # bundle publication (metadata.json, figure.tex)
node test/test_figure_filter.js  # recherche (provenance) + tri des figures
node test/test_inset_layout.js   # placement de l'encart de zoom
node test/test_pdf_export.js     # génération PDF raster webview
node test/test_legend_edit.js    # edition/prefixes de legende
node test/test_data_import.js   # import CSV/DAT/TXT + mapping X/Y
node test/test_figure_codec.js  # donnees embarquees dans PNG/SVG
node test/test_plotly_to_py.js  # regeneration de code matplotlib
node test/test_board_layout.js  # composition de planche multi-panneaux
node test/check_panel_html.js    # garde-fou structurel du webview
node test/test_replace_policy.js # politique de remplacement live update
node --check extension.js storage.js media/legend_edit.js media/replace_policy.js
```

## Nouveautes v0.13.0

- **Import CSV / DAT** : bouton dedie et glisser-deposer avec mapping X/Y pour
  creer un graphe ou superposer des mesures a une figure existante.
- **Image -> code** : les PNG/SVG exportes peuvent embarquer la spec Plotly ;
  l'extension peut ensuite regenerer un script matplotlib depuis l'image.
- **Planche multi-panneaux** : composition de figures selectionnees en grille
  `(a)`, `(b)`, `(c)` avec ordre modifiable, largeur cible et legende partagee.
- **Copier-coller entre fenetres** : une figure copiee peut etre recollee dans
  une autre fenetre VS Code.
- **Undo par figure** : `Ctrl/Cmd+Z` annule les editions du graphe survole.
- **Lignes de repere et annotations enrichies** : hline/vline, texte, fleches,
  couleurs, epaisseurs et positions editables depuis le panneau.
- **Fenetre detachee optionnelle** : `chazPlots.autoDetachWindow` ouvre le
  panneau Graphes dans sa propre fenetre VS Code.

## Nouveautes v0.10.0

- **`plt.show()` plus rapide** : pour les figures déjà interactives Plotly, le
  backend ne pré-rend plus systématiquement les PNG/PDF matplotlib (gros gain de
  temps à l'affichage). Les exports PNG/PDF restent disponibles via le webview ;
  réactivables avec `chazPlots.preRenderPlotlyPng` / `preRenderPlotlyPdf`. Les
  figures sous style science continuent de porter leurs assets matplotlib propres.
- **Persistance débouncée** : les écritures disque des figures sont regroupées
  (flush différé + flush au déchargement), et désactivables via
  `chazPlots.persistFigures` pour un mode ultra rapide.
- **Menu d'actions par carte** : les actions secondaires (CSV, bundle, LaTeX,
  source d'export, suppression…) sont regroupées dans un menu « ⋯ » ; la carte
  reste lisible avec Tags, Copier, Agrandir et Enregistrer en accès direct.
- **Presets de style personnalisés** : ajoutez vos propres styles au menu
  *Style publication* via `chazPlots.customPlotStyles`.
- **État vide repensé** et infobulles enrichies sur l'ensemble des boutons.

## Nouveautes v0.9.0

- **Taille automatique de la vue liste** : les graphes se recalibrent selon la
  largeur disponible, la hauteur de fenetre et le ratio matplotlib, sans curseur
  manuel obligatoire.
- **Legende de comparaison plus lisible** : les traces superposees sont prefixees
  par le titre de la figure source, avec troncature propre si le titre est long.
- **Legende deplacable et editable** : bouton crayon de modebar pour modifier nom,
  couleur, trait, epaisseur et marqueur ; choix rapide par couleurs de base ou
  palettes avancees ; persistance en vue liste, edition de session en comparaison.

## Nouveautés v0.8.0

- **PDF hybride** : figures simples → PDF vectoriel matplotlib (inchangé) ;
  figures avec encart, vue erreurs et vue comparaison → **PDF raster** haute
  résolution généré côté webview (`media/pdf_export.js` / `PdfExport.buildPdf`).
- **Barre d'export complète en vue comparaison** : Enregistrer PNG / SVG / PDF,
  Copier, CSV et Bundle disponibles pour la vue superposée.
- **Sélection d'erreur au clic** : en mode erreurs, cliquer une courbe la désigne
  comme référence ; les clics suivants désignent les courbes à comparer. Remplace
  l'ancien menu déroulant.
- **Correctif redimensionnement multi-écran** : la vue liste utilise désormais un
  `ResizeObserver` pour corriger les décalages de largeur lors de changements
  d'échelle (DPR variable, multi-écran).

## Nouveautés v0.7.0

- **Convertisseur** : `contour`/`contourf`, `quiver`, `twiny`, axes polaires
  simples, `boxplot(patch_artist=True)`, légendes `bbox_to_anchor`, et **titres
  de colorbar** (unités) pour `imshow`/`pcolormesh`/scatter coloré.
- **Diagnostic de rendu** : badge par figure (interactif / SVG / PNG) avec la
  raison du repli en infobulle.
- **Mesures sur graphe** : deux curseurs → Δx, Δy, pente, aire et stats.
- **Export CSV** des données visibles (respecte le zoom).
- **Comparaison** : zoom synchronisé côte à côte, sous-graphes préservés,
  référence d'erreur au clic.
- **Bundle publication** + **export PDF** vectoriel (rendu matplotlib natif).
- **Provenance** : script/ligne, env, git, date — affichée et exportée.
- **Recherche/tri** élargis à la provenance ; tags cliquables.
- **Navigation** : Ctrl/Cmd + molette (zoom), clic-milieu (pan).

## Nouveautés v0.5.0

- Persistance des figures sur disque (par workspace), chargement asynchrone.
- Convertisseur : axes temporels (`date`), position de légende (`loc`), `twinx`.
- Bouton **Copier** (image → presse-papiers).
- Fiabilisation du port (fichier de repli côté backend).
- Corrections : recherche par tags, redimensionnement de l'overlay « Agrandir ».
