# Erreur entre courbes (comparaison auto) — Design

Date : 2026-06-20
Statut : validé, prêt pour le plan d'implémentation

## Objectif

Dans la vue **Superposition** de la comparaison, permettre de calculer et
d'afficher l'**erreur entre N courbes** par rapport à une courbe de
référence choisie. Pour `N` courbes superposées on obtient jusqu'à `N−1`
courbes d'erreur (par type d'erreur coché), chacune clairement étiquetée.

Exemple : 4 courbes cochées, référence = A, type « relative % » →
3 courbes d'erreur `B−A`, `C−A`, `D−A`.

## Périmètre

- **100 % côté webview** : tout se passe dans `media/panel.html`.
- **Aucun changement** au backend Python, au protocole `/figure`, ni à
  `extension.js`.
- Fonctionne uniquement sur les figures **fusionnables en Plotly**
  (`canMergePlotly` : traces `scatter`/`bar` avec données `x`/`y`
  numériques). En repli image (SVG/PNG), pas de données exploitables → le
  bouton est **désactivé** avec une infobulle explicative.

### Définition d'une « courbe »

- Chaque **tracé** (trace Plotly) est une courbe. On **aplatit** toutes les
  traces de toutes les figures cochées en une liste plate de courbes.
- Seules les traces de type `scatter` (lignes/points) sont éligibles au
  calcul d'erreur. Les traces `bar` restent affichées dans la superposition
  mais ne sont **ni** proposées comme référence **ni** comme cible.
- Étiquetage : les courbes gardent les lettres de la superposition
  (`A`, `B`, `C`, … via `compareLabel`) plus le nom du tracé.

## UI & workflow

1. Dans la barre de l'overlay de comparaison (`compareOverlay`), un bouton
   **« Erreur »** apparaît en mode superposition Plotly. Désactivé (avec
   infobulle) si la superposition est en repli image ou s'il y a moins de
   2 courbes `scatter`.
2. Au clic, un panneau de réglages s'affiche :
   - **Référence** : menu déroulant listant les courbes éligibles
     (`A — <nom>`, `B — <nom>`, …). Défaut : `A`.
   - **Types d'erreur** : 4 cases à cocher (sélection multiple) —
     Différence signée / Erreur absolue / Erreur relative / Erreur relative %.
   - Boutons **Appliquer** et **Masquer**.
3. **Appliquer** → le sous-graphe résiduel apparaît sous la superposition
   (re-rendu de la figure Plotly). **Masquer** → retour à la superposition
   seule.
4. Si plusieurs types sont cochés : pour chaque courbe cible × chaque type,
   une courbe d'erreur (le type figure dans le label, donc distinguable).

## Calcul des erreurs

Helpers en **fonctions pures** (testables hors DOM) :

- `interpLinear(xRef, xi, yi)` : interpolation linéaire de `(xi, yi)` aux
  abscisses `xRef`. Hors de la plage `[min(xi), max(xi)]` → `null`.
- `commonXRange(xRef, xi)` : restreint au recouvrement
  `[max(min(xRef), min(xi)), min(max(xRef), max(xi))]` ; les `xRef` hors de
  cette plage donnent `null`.
- `computeError(type, yRef, yI, opts)` : applique la formule.

Référence `r`, cible `i` (après interpolation sur la grille X de `r`) :

| Type              | Formule                       | Unité          |
|-------------------|-------------------------------|----------------|
| Différence signée | `eᵢ = yᵢ − yᵣ`                | unité de `y`   |
| Erreur absolue    | `eᵢ = |yᵢ − yᵣ|`             | unité de `y`   |
| Erreur relative   | `eᵢ = (yᵢ − yᵣ) / yᵣ`        | fraction       |
| Erreur relative % | `eᵢ = (yᵢ − yᵣ) / yᵣ × 100`  | %              |

### Garde-fous

- **Relative / relative %** : si `|yᵣ| < ε` → point `null` (évite
  l'explosion près de zéro). `ε = 1e-12` (valeur fixe, suffisante en
  pratique).
- **Axes dates** : les X sont des timestamps numériques ; interpolation et
  formules fonctionnent sans cas particulier.
- **NaN / valeurs manquantes** existants → propagés en `null`.
- Hors plage X commune → `null` (la ligne Plotly est coupée).

### Unité de l'axe Y résidu

- Si **tous** les types cochés sont « relative % » → axe résidu libellé `%`.
- Sinon → libellé générique « erreur » (on ne convertit pas les unités).

## Construction Plotly (approche A : 2 axes Y empilés, X partagé)

Une **seule** spec Plotly (un seul `Plotly.newPlot`), produite par une
variante de `mergedPlotlyFigure()` (ex. `mergedPlotlyFigureWithErrors(figs,
refId, types)`), qui :

- garde **un seul `xaxis`** pour les deux panneaux → zoom X lié nativement,
  rien à synchroniser ;
- `yaxis` : `domain: [0.32, 1]` — la superposition (traces existantes via
  `overlayTrace`) ;
- `yaxis2` : `domain: [0, 0.26]`, `anchor: 'x'` — les courbes d'erreur ;
- une `shape` ligne `y=0` sur le panneau d'erreur (repère visuel) ;
- traces d'erreur : `xaxis: 'x'`, `yaxis: 'y2'`, label
  **« B−A : <nom> (<type abrégé>) »** (ex. `B−A : vitesse_v2 (rel. %)`),
  couleur reprise de la courbe cible.

Réutilise `renderPlotly()` / `resizeComparePlots()` inchangés (le div ne
change pas). Le bouton **Masquer** réaffiche la superposition simple via
`mergedPlotlyFigure()`.

## Gestion d'erreurs (UX)

Messages clairs dans le panneau, aucun crash :

- moins de 2 courbes `scatter` éligibles ;
- aucune plage X commune entre la référence et une cible (cette cible est
  ignorée, un avertissement liste les courbes ignorées) ;
- référence sans points exploitables.

## Tests

Le calcul est isolé en fonctions pures, donc testable sans DOM.

- Nouveau harnais Node : `test/test_error_curves.js`, lancé via
  `node test/test_error_curves.js` (assertions maison, pas de dépendance).
- Cas couverts :
  - `interpLinear` : grilles identiques, grille plus fine/grossière,
    extrapolation hors plage → `null` ;
  - recouvrement X partiel → trous aux bons endroits ;
  - les 4 types de formule sur un cas connu ;
  - garde-fou `|yᵣ| < ε` → `null` ;
  - axe date (X = timestamps) ;
  - propagation des `NaN`.
- Les fonctions pures vivent dans un bloc JS extractible ; `node --check`
  valide leur syntaxe.

## Hors périmètre (YAGNI pour cette version)

- Tableau de statistiques (RMS, erreur max, biais) — extension possible
  plus tard.
- Erreur sur les traces `bar` ou les histogrammes.
- Erreur entre courbes issues de figures en repli image (SVG/PNG).
- Choix de la méthode d'interpolation (spline, etc.) — linéaire uniquement.
