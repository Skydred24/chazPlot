# Spyder Plots — panneau de graphes matplotlib pour VS Code

Reproduit le volet **Graphes** de Spyder dans VS Code : chaque `plt.show()`
envoie la figure dans un panneau unique et scrollable, sans ouvrir de fenetre,
sans bloquer le script.

## Fonctionnalites

- `plt.show()` inchange dans vos scripts — le backend matplotlib est remplace
  automatiquement dans les terminaux VS Code.
- Panneau unique, scroll vertical, les nouvelles figures s'ajoutent en bas
  (avec defilement automatique vers la derniere).
- **Enregistrer** (par figure, boite de dialogue PNG), **Tout enregistrer**
  (choix d'un dossier, fichiers numerotes), **Supprimer** (par figure),
  **Tout supprimer**.
- **Copier** : met l'image de la figure dans le presse-papiers (collable
  dans Word, un mail, un chat...).
- Option "Ajuster a la largeur" (sinon taille native + scroll horizontal).
- Le panneau garde les figures meme si on le masque (`retainContextWhenHidden`),
  et **les figures sont persistees sur disque** : elles reapparaissent apres
  un Reload Window (pile propre a chaque workspace).
- Titre de figure repris de `fig.canvas.manager.set_window_title(...)` si defini.

## Architecture

```
spyder-plots/
├── package.json                      manifeste de l'extension
├── extension.js                      serveur HTTP local + panneau webview
├── storage.js                        persistance des figures (disque + index)
├── media/
│   ├── panel.html                    interface du panneau (UI + lecteur)
│   └── plotly.min.js                 Plotly.js embarque
├── python/
│   ├── vscode_spyder_plots_backend.py   backend matplotlib (module://)
│   └── _mpl_to_plotly.py             conversion figure -> Plotly
└── test/
    ├── test_convert.py               tests d'assertion du convertisseur (unittest)
    ├── test_plots.py                 demo (figures + 1 animation)
    ├── test_stress.py                banc de torture (25 cas limites)
    ├── test_capture.py               test capture de frames d'animation
    └── test_show.py                  test de routage show()
```

Fonctionnement : au demarrage, l'extension ouvre un serveur HTTP sur
`127.0.0.1:53210` (ou le port libre suivant) et injecte dans les **nouveaux**
terminaux :

- `MPLBACKEND=module://vscode_spyder_plots_backend`
- `PYTHONPATH` += dossier `python/` de l'extension
- `VSCODE_PLOTS_PORT`, `VSCODE_PLOTS_DPI`, `VSCODE_PLOTS_ANIM_DPI`

A chaque `plt.show()`, le backend rend les figures en PNG (Agg, hors ecran),
les envoie en POST a l'extension, puis les ferme — exactement le comportement
inline de Spyder. Aucune dependance Python autre que matplotlib.

## Installation sans droits administrateur (Windows)

Aucune compilation, aucun `npm install` : l'extension est en JavaScript pur.

1. Copiez le dossier `spyder-plots` dans :
   `%USERPROFILE%\.vscode\extensions\hugo.spyder-plots-0.1.0`
   (creez le dossier s'il n'existe pas ; le nom doit suivre le format
   `editeur.nom-version`).
2. Redemarrez VS Code (`Ctrl+Shift+P` → "Reload Window" suffit).
3. Ouvrez un **nouveau terminal** (important : les variables d'environnement
   ne sont injectees que dans les terminaux crees apres l'activation).
4. Lancez `python test/test_plots.py` : le panneau **Graphes** s'ouvre a cote
   de l'editeur avec les 3 figures.

### Alternative : mode developpement

Ouvrez le dossier `spyder-plots` dans VS Code et appuyez sur `F5`
("Run Extension"). Une fenetre VS Code de test se lance avec l'extension active.

### Alternative : paquet .vsix

Si vous avez Node.js : `npx @vscode/vsce package` dans le dossier, puis
`code --install-extension spyder-plots-0.1.0.vsix`.

## Commandes (Ctrl+Shift+P)

- `Spyder Plots : ouvrir le panneau`
- `Spyder Plots : tout enregistrer`
- `Spyder Plots : supprimer tous les graphes`

## Reglages (settings.json)

- `spyderPlots.port` (defaut 53210)
- `spyderPlots.dpi` (defaut 200) — augmentez pour des PNG plus fins
- `spyderPlots.animationDpi` (defaut 130) — resolution de chaque frame
  d'animation (plus bas = plus leger/fluide ; plus haut = plus net)
- `spyderPlots.animationMaxFrames` (defaut 600) — plafond de frames par
  animation (garde-fou memoire) ; **0 = illimite**
- `spyderPlots.saveFormat` (defaut png) — format propose par defaut
- `spyderPlots.autoReveal` (defaut true) — afficher le panneau a chaque figure
- `spyderPlots.maxPersistedFigures` (defaut 200) — nombre max de figures
  conservees entre les sessions (persistance disque) ; **0 = illimite**,
  au-dela les plus anciennes sont evincees

## Limites connues

Conversion Plotly (revelees par `test/test_stress.py`) :

- **Artistes non geres -> rendu SVG** (toujours net, mais non interactif) :
  fill_between, errorbar, contour/contourf, quiver/streamplot, axes
  polaires, 3D, pie, et toute figure contenant des `text()`/`annotate()`
  utilisateur (pour ne pas perdre l'annotation).
- **boxplot** : les boites etant des `Line2D` par defaut, le graphe est
  converti en de multiples traces de lignes (lisible mais brouillon).
  Pour un vrai rendu, utilisez `plt.boxplot(..., patch_artist=True)` ou
  forcez le SVG.
- **Legende** : la *position* suit desormais le `loc` de matplotlib
  (`upper left`, `lower right`...). `loc='best'` reste place en haut a
  droite, et `bbox_to_anchor` (legende hors-axes) n'est pas reproduit.
- **twinx (double axe Y)** : l'axe Y secondaire est desormais trace en
  *overlay* a droite avec sa propre echelle. `twiny` (double axe X)
  n'est pas encore gere.
- **Dates** : les axes temporels matplotlib sont convertis en axes `date`
  Plotly (valeurs ISO).
- Au-dela de ~500 000 points, ou si le SVG depasse 8 Mo, repli automatique
  vers le PNG.

Autres :

- Les terminaux deja ouverts avant l'activation ne sont pas affectes :
  ouvrez-en un nouveau.
- **Multi-fenetres** : le port actif est aussi ecrit dans un fichier
  temporaire (`spyder-plots-port.json`) servant de repli au backend ;
  ce fichier est partage, donc la derniere fenetre demarree « gagne ».
  L'injection des variables d'environnement reste correcte par fenetre.
- Si vous lancez Python **hors** de VS Code, le backend n'est pas actif
  (MPLBACKEND n'est pas defini) : comportement matplotlib normal.
- Pour forcer le backend classique dans un terminal VS Code :
  `set MPLBACKEND=TkAgg` (cmd) ou `$env:MPLBACKEND="TkAgg"` (PowerShell).

## v0.2 — Graphes interactifs (vrai graphe)

Les figures sont desormais converties en **graphes Plotly interactifs**
directement dans le panneau : zoom (molette ou rectangle), pan, valeurs
au survol, double-clic pour reinitialiser, autoscale, export PNG via la
barre d'outils du graphe. L'interactivite persiste apres la fin du script.

Pipeline : a chaque plt.show(), le backend tente de convertir la figure
matplotlib en specification Plotly (`python/_mpl_to_plotly.py`). Plotly.js
est embarque dans l'extension (`media/plotly.min.js`) : aucun acces
reseau, aucune dependance Python supplementaire.

Artistes convertis : plot/courbes (styles, marqueurs, legendes),
scatter (couleurs, tailles, colormaps), bar/barh (y compris etiquettes
categorielles), imshow, pcolormesh, sous-graphes, echelles log,
limites d'axes, grilles, titres.

Fallback automatique en SVG (toujours net) si la figure contient un
artiste non convertible : fill_between, errorbar, contour, patches
libres, 3D... Le PNG haute resolution reste genere dans tous les cas
pour Enregistrer / Tout enregistrer.

Installation : pensez a copier le nouveau dossier `media/` avec le reste
(`%USERPROFILE%\.vscode\extensions\hugo.spyder-plots-0.2.0`).

## v0.3 — Animations + refonte visuelle

### Animations matplotlib (FuncAnimation / ArtistAnimation)

Les animations sont detectees automatiquement : a `plt.show()` (ou
`anim.save()`), toutes les frames sont capturees et envoyees au panneau,
qui affiche un **vrai lecteur d'animation** :

- boutons **premiere frame, frame precedente, lecture/pause, frame
  suivante, derniere frame** ;
- **barre de navigation (scrubber)** pour sauter directement a une frame ;
- compteur `frame / total` et selecteur de **vitesse** (0.25× a 4×) ;
- badge `ANIM · Nf` sur la carte ;
- **Enregistrer** sauvegarde la frame actuellement affichee en PNG.

Cote Python, un writer (`AbstractMovieWriter`) capture chaque frame sans
ecrire de fichier video. Par defaut le nombre de frames est plafonne a
600 (garde-fou memoire), **reglable via `spyderPlots.animationMaxFrames`
— 0 pour illimite** ; la resolution est reglable via
`spyderPlots.animationDpi`.

Conservez votre code matplotlib habituel :

```python
import matplotlib.pyplot as plt
from matplotlib.animation import FuncAnimation
# ... fig, update ...
anim = FuncAnimation(fig, update, frames=60, interval=40)
plt.show()   # le lecteur apparait dans le panneau Graphes
```

> Gardez une reference a l'objet `anim` (comme avec matplotlib classique),
> sinon le ramasse-miettes peut le supprimer avant la capture.

### Refonte visuelle

- Cartes redessinees (coins arrondis, ombre legere, en-tete clair) et
  barre d'outils plus lisible, entierement basees sur le theme VS Code.
- Bouton **Agrandir** sur chaque graphe : ouvre un overlay plein panneau
  qui **re-rend en vectoriel** (Plotly responsive / SVG), donc net a toute
  taille — fini le flou en grand. Les animations s'y rejouent en grand.
- **Legende** retravaillee (cadre, fond semi-transparent, police plus
  grande) pour rester lisible par-dessus les courbes.
- **Coordonnees au survol deportees** : plus d'info-bulle flottante sur le
  graphe ; les coordonnees `x / y (/ z)` s'affichent discretement dans
  l'en-tete de la carte (et dans la barre de l'overlay agrandi).
- Hauteur des graphes Plotly proportionnelle a la largeur (donc plus
  haute en plein ecran), recalculee au redimensionnement.

### Tester les limites

`python test/test_stress.py` envoie 25 figures volontairement tordues
(legendes surchargees, twinx, dates, contour, 3D, pie, scatter 120k,
animations a titre/legende dynamiques...). Chaque titre est prefixe par
le rendu attendu (`[PLOTLY?]`, `[SVG]`, `[ANIM]`, `[LIMITE]`) pour reperer
d'un coup d'oeil les ecarts. Voir « Limites connues » plus bas.

L'interface du panneau est desormais dans `media/panel.html` (plus simple
a personnaliser). Pensez a copier ce fichier lors de l'installation.
