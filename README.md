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
- Option "Ajuster a la largeur" (sinon taille native + scroll horizontal).
- Le panneau garde les figures meme si on le masque (`retainContextWhenHidden`).
- Titre de figure repris de `fig.canvas.manager.set_window_title(...)` si defini.

## Architecture (3 fichiers)

```
spyder-plots/
├── package.json                      manifeste de l'extension
├── extension.js                      serveur HTTP local + panneau webview
├── python/
│   └── vscode_spyder_plots_backend.py   backend matplotlib (module://)
└── test/
    └── test_plots.py                 script de validation (3 figures)
```

Fonctionnement : au demarrage, l'extension ouvre un serveur HTTP sur
`127.0.0.1:53210` (ou le port libre suivant) et injecte dans les **nouveaux**
terminaux :

- `MPLBACKEND=module://vscode_spyder_plots_backend`
- `PYTHONPATH` += dossier `python/` de l'extension
- `VSCODE_PLOTS_PORT`, `VSCODE_PLOTS_DPI`

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
- `spyderPlots.dpi` (defaut 144) — augmentez pour des PNG plus fins
- `spyderPlots.autoReveal` (defaut true) — afficher le panneau a chaque figure

## Limites connues

- Les figures sont des images statiques (comme Spyder en mode inline) :
  pas de zoom/pan interactif matplotlib. Le toggle "Ajuster a la largeur"
  permet de voir la taille native.
- Les terminaux deja ouverts avant l'activation ne sont pas affectes :
  ouvrez-en un nouveau.
- Si vous lancez Python **hors** de VS Code, le backend n'est pas actif
  (MPLBACKEND n'est pas defini) : comportement matplotlib normal.
- Pour forcer le backend classique dans un terminal VS Code :
  `set MPLBACKEND=TkAgg` (cmd) ou `$env:MPLBACKEND="TkAgg"` (PowerShell).
