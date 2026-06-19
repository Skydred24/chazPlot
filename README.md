# Spyder Plots — panneau de graphes matplotlib pour VS Code

Reproduit le volet **Graphes** de Spyder dans VS Code : chaque `plt.show()`
envoie la figure dans un panneau unique et scrollable, sans ouvrir de fenêtre
et sans bloquer le script. Les figures deviennent des **graphes Plotly
interactifs** (zoom, survol, export), les **animations** sont rejouées dans un
lecteur intégré, et tout est **persisté** d'une session à l'autre.

## Fonctionnalités

- **`plt.show()` inchangé** : le backend matplotlib est remplacé
  automatiquement dans les terminaux VS Code.
- **Graphes interactifs** (Plotly) : zoom, pan, valeurs au survol, autoscale,
  double-clic pour réinitialiser. Repli automatique en **SVG** (toujours net)
  pour les figures non convertibles, et **PNG** haute résolution toujours
  généré pour l'enregistrement.
- **Animations** matplotlib (`FuncAnimation` / `ArtistAnimation`) détectées
  automatiquement et rejouées : lecture/pause, navigation frame par frame,
  barre de navigation, vitesse 0.25×–4×.
- **Agrandir** : overlay plein panneau qui re-rend en vectoriel (net à toute
  taille), avec redimensionnement automatique.
- **Copier** : met l'image de la figure dans le presse-papiers (collable dans
  Word, un mail, un chat…).
- **Enregistrer / Tout enregistrer** (PNG ou SVG), **Supprimer / Tout
  supprimer**.
- **Export LaTeX (PGF/TikZ)** : copie ou enregistre le code de la figure.
- **Comparaison** : sélection de plusieurs graphes pour les superposer.
- **Tags & recherche** : étiquetez les figures et filtrez par titre ou tag.
- **Persistance** : les figures (et leurs tags) réapparaissent après un Reload
  Window — pile propre à chaque workspace.
- Option **« Ajuster à la largeur »** (sinon taille native + scroll horizontal).

## Installation

### Paquet .vsix (recommandé)
```bash
npx @vscode/vsce package          # produit spyder-plots-0.5.0.vsix
code --install-extension spyder-plots-0.5.0.vsix
```

### Sans droits administrateur (Windows)
Aucune compilation, aucun `npm install` (extension en JavaScript pur) :
1. Copiez le dossier dans
   `%USERPROFILE%\.vscode\extensions\hugo.spyder-plots-0.5.0`.
2. Rechargez VS Code (`Ctrl+Shift+P` → « Reload Window »).
3. Ouvrez un **nouveau terminal** (les variables d'environnement ne sont
   injectées que dans les terminaux créés après l'activation).
4. Lancez `python test/test_plots.py` : le panneau **Graphes** s'ouvre.

### Mode développement
Ouvrez le dossier dans VS Code et appuyez sur `F5` (« Run Extension »).

## Commandes (Ctrl+Shift+P)

- `Spyder Plots : ouvrir le panneau`
- `Spyder Plots : tout enregistrer`
- `Spyder Plots : supprimer tous les graphes`

## Réglages (settings.json)

- `spyderPlots.port` (défaut `53210`) — port local d'écoute (incrémenté si occupé).
- `spyderPlots.dpi` (défaut `200`) — résolution des PNG.
- `spyderPlots.animationDpi` (défaut `130`) — résolution de chaque frame d'animation.
- `spyderPlots.animationMaxFrames` (défaut `600`) — plafond de frames par animation ; **0 = illimité**.
- `spyderPlots.saveFormat` (défaut `png`) — format proposé par défaut.
- `spyderPlots.autoReveal` (défaut `true`) — afficher le panneau à chaque figure.
- `spyderPlots.maxPersistedFigures` (défaut `200`) — figures conservées entre sessions ; **0 = illimité**.

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

## Limites connues

- **Artistes non gérés → rendu SVG** (net mais non interactif) : `fill_between`,
  `errorbar`, `contour`/`contourf`, `quiver`/`streamplot`, axes polaires, 3D,
  `pie`, et toute figure contenant des `text()`/`annotate()`.
- **boxplot** : converti en lignes (`Line2D`) ; utilisez
  `plt.boxplot(..., patch_artist=True)` pour un meilleur rendu.
- **Légende** : la position suit le `loc` matplotlib ; `bbox_to_anchor`
  (légende hors-axes) n'est pas reproduit.
- **twiny** (double axe X) non géré (twinx l'est : axe Y secondaire en overlay).
- Au-delà de ~500 000 points, ou si le SVG dépasse 8 Mo, repli automatique en PNG.
- **Multi-fenêtres** : un fichier de port temporaire sert de repli au backend ;
  il est partagé (la dernière fenêtre démarrée « gagne »). L'injection des
  variables d'environnement reste correcte par fenêtre.
- Les terminaux ouverts **avant** l'activation ne sont pas affectés : ouvrez-en
  un nouveau. Pour forcer le backend classique :
  `set MPLBACKEND=TkAgg` (cmd) ou `$env:MPLBACKEND="TkAgg"` (PowerShell).

## Architecture

```
spyder-plots/
├── package.json                         manifeste de l'extension
├── extension.js                         serveur HTTP local + panneau webview
├── storage.js                           persistance des figures (disque + index)
├── media/
│   ├── panel.html                       interface du panneau (UI + lecteur)
│   └── plotly.min.js                    Plotly.js embarqué
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
`VSCODE_PLOTS_ANIM_MAX_FRAMES`. À chaque `plt.show()`, le backend convertit la
figure (Plotly → SVG → PNG, ou frames d'animation) et l'envoie en POST au
panneau. Aucune dépendance Python hors matplotlib/numpy.

## Tests

```bash
python test/test_convert.py    # tests d'assertion du convertisseur (unittest)
node --check extension.js storage.js
```

## Nouveautés v0.5.0

- Persistance des figures sur disque (par workspace), chargement asynchrone.
- Convertisseur : axes temporels (`date`), position de légende (`loc`), `twinx`.
- Bouton **Copier** (image → presse-papiers).
- Fiabilisation du port (fichier de repli côté backend).
- Corrections : recherche par tags, redimensionnement de l'overlay « Agrandir ».
