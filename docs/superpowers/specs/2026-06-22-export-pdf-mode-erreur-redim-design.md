# Design — Redimensionnement, PDF encart/erreurs/comparaison, sélection des courbes en mode erreur

Date : 2026-06-22
Extension : Chaz Plots (`spyder-plots/`, npm `chaz-plots`)
Langue de travail : français (UI, commentaires, commits).

## Contexte

Quatre demandes regroupées (les trois dernières partagent une racine technique :
produire des sorties depuis l'état Plotly vivant du webview) :

1. Bug de redimensionnement de la vue liste lors d'un changement d'écran / d'une
   maximisation : la largeur du graphe ne suit pas, et une séquence
   agrandir → réduire → agrandir laisse une image rétrécie.
2. À la sauvegarde **PDF**, l'encart de zoom doit toujours être présent.
3. Pouvoir sauvegarder en **PDF** (et PNG/SVG) les vues **erreurs** et
   **comparaisons**, via la **même barre d'actions** qu'une figure normale.
4. En **mode erreur**, choisir au clic la courbe de référence et les courbes à
   comparer (au lieu de calculer l'erreur de toutes les courbes contre une
   référence choisie dans un menu déroulant).

## Décisions validées

- **PDF** : approche **hybride**. Figure simple sans encart → on garde le
  `fig.pdf` matplotlib natif (vectoriel fidèle). Dès qu'il y a encart / erreurs /
  comparaison → PDF **raster** généré côté webview (PNG haute résolution enrobé
  dans un PDF minimal), **sans aucune dépendance bundlée**.
- **Mode erreur** : sélection **au clic sur le tracé** (pas de liste/menu).
- **Overlay comparaison** : reçoit la **barre d'export complète** (Enregistrer
  PNG/SVG/PDF, Copier, CSV, Bundle) ; Tags / Supprimer / Agrandir sont omis (vue
  transitoire non persistée).

## Volet 1 — Bug de redimensionnement (vue liste)

### Cause

La vue liste ne réagit qu'à l'événement global `window resize`
(`panel.html` ~ligne 1665) et ne recalcule que la **hauteur** via
`Plotly.relayout(el, { height })`. La largeur dépend de l'autosize Plotly, qui
n'est pas recalculé de façon fiable lors d'un déplacement entre écrans / d'une
maximisation. De plus la largeur peut être mesurée à 0 quand le panneau est
transitoirement masqué (`retainContextWhenHidden`), figeant une taille
minuscule (symptôme « agrandir → réduire → agrandir »).

### Correction

Passer la vue liste sur un **`ResizeObserver` par graphe** (comme le fait déjà
l'overlay comparaison, `panel.html` ~ligne 2404) :

- Observer le conteneur de chaque graphe de la liste.
- À chaque notification : si `clientWidth === 0` → **ignorer** (panneau masqué,
  pas de mesure parasite). Sinon appeler `Plotly.Plots.resize(el)` (recalcule la
  largeur), puis relayout de la hauteur (`listPlotHeight(el, fig)`), puis
  repositionner l'overlay d'encart si `el._spHasInset`.
- Débounce léger (cohérent avec l'existant, ~120 ms).
- Déconnecter l'observer quand le graphe est retiré du DOM (cf. nettoyage déjà
  présent pour `listPlots`).

L'écouteur `window resize` global peut être retiré pour la liste (remplacé) ;
on conserve le déclenchement `resizeComparePlots()` pour l'overlay.

### Critère de réussite

Déplacer la fenêtre VS Code d'un écran à l'autre, maximiser/restaurer, et
masquer/réafficher le panneau : la largeur du graphe suit toujours la largeur
disponible, sans état rétréci persistant.

## Volet 2 — Encart toujours présent à la sauvegarde PDF

### État actuel

- PNG / SVG : sauvegardés via `Plotly.toImage` sur l'élément vivant → l'encart
  (traces + shapes + axes ajoutés par `applyZoomInset`) **y est déjà**.
- PDF : écrit directement depuis `fig.pdf` (rendu matplotlib backend), qui
  **ignore** l'encart.

### Correction (hybride)

À la sauvegarde PDF, la décision native-vs-webview se prend **dans le webview**
(seul détenteur de l'état d'encart `el._spHasInset`), pour éviter de
synchroniser cet état vers l'extension :

- Le flux de sauvegarde PDF d'une figure passe désormais par un aller-retour
  webview (réutilise le mécanisme `exportPlotly` / `exportResult` à `requestId`).
- Le webview répond :
  - encart présent (`el._spHasInset`) → un **PDF raster** (`data:application/pdf;base64,…`) ;
  - sinon → un sentinel `{ useNative: true }` ; l'extension écrit alors `fig.pdf`
    comme aujourd'hui.

### Génération du PDF raster

Nouveau module pur **`media/pdf_export.js`** exposant `PdfExport` (UMD :
`self.PdfExport` côté webview, `require` sous Node) :

- `PdfExport.buildPdf({ imageBytes, width, height, filter, colorComponents })`
  assemble un **PDF minimal d'une page** contenant une image plein cadre
  (objet XObject image) et renvoie un `Uint8Array`. `filter` vaut
  `"FlateDecode"` (image lossless dégonflée) ou `"DCTDecode"` (JPEG). Fonction
  **pure et testable sous Node** (`test/test_pdf_export.js` : vérifie l'en-tête
  `%PDF`, la présence de la table xref, du trailer, et des dimensions du
  MediaBox).

La **glue** dans `panel.html` prépare les octets image (hors module pur, car
dépend des API navigateur) :

- `Plotly.toImage(el, { format: "png", scale: 3, width, height })` →
  dessin sur `<canvas>` → `getImageData` → octets RGB.
- Compression **lossless** via `CompressionStream("deflate")` (disponible dans
  le webview Chromium) → `filter: "FlateDecode"`.
- **Repli** si `CompressionStream` indisponible : `Plotly.toImage(..., { format:
  "jpeg" })` et embarquement direct via `filter: "DCTDecode"`.

Enregistrement de l'URI du nouveau module : `extension.js:webviewHtml()`
(placeholder `{{pdfExportUri}}`), déclaration dans `panel.html`, et ajout au
contrôle `test/check_panel_html.js`.

## Volet 3 — Barre d'export complète dans l'overlay comparaison

L'overlay comparaison reçoit, dans sa barre (`obar`, `panel.html` ~ligne 362),
la même barre d'actions qu'une figure : **Enregistrer** (PNG/SVG/PDF),
**Copier**, **CSV**, **Bundle**.

### Pseudo-figure

La comparaison est traitée comme une **pseudo-figure** identifiée par une
sentinelle (`id = "compare"`), dont l'élément vivant est le graphe comparaison
fusionné (`currentComparePlotEl()`). Les chemins d'export existants résolvent
cet élément quand l'id vaut la sentinelle :

- côté webview, `exportPlotly` (et la copie) résolvent
  `el = currentComparePlotEl()` au lieu de `document.getElementById("plot-"+id)` ;
- côté extension, les handlers `save` / `saveCsv` / `saveBundle` acceptent la
  sentinelle (pas de figure stockée derrière) et n'utilisent pas de
  représentation native.

### Comportement par bouton

- **Enregistrer** : même sélection de format que pour une figure (PNG/SVG/PDF).
  La comparaison n'ayant aucune représentation native, **les 3 formats sont
  rendus depuis le webview** (`Plotly.toImage` pour PNG/SVG ; chemin raster du
  Volet 2 pour le PDF).
- **Copier** : `Plotly.toImage(el, png)` → `Blob` → presse-papiers (variante
  « copier depuis l'élément vivant », car pas de `fig.png` stocké).
- **CSV** : déjà basé sur l'élément vivant (`plotSeriesForCsv(el)`) → exporte la
  superposition **et** les courbes d'erreur visibles, en respectant la plage X.
- **Bundle** : `BundleMeta` avec métadonnées synthétisées (titre dérivé des
  figures comparées, provenance **combinée** des sources) ; contient
  `figure.png` + `figure.svg` + le **PDF raster** + `figure.tex`.

### Métadonnées synthétisées

Un descripteur léger de pseudo-figure fournit `title` (ex. « comparaison A·B·C »)
et une provenance combinée (liste des provenances des figures sources). Pas de
`png` / `svg` / `pdf` natifs : `exportBundle` emprunte donc sa branche
« `fig.plotly && el` » (rendu via `Plotly.toImage`).

### Omissions assumées

Tags, Supprimer, Agrandir ne sont pas repris (la comparaison n'est pas une carte
persistée et l'overlay est déjà la vue agrandie).

## Volet 4 — Mode erreur : sélection des courbes au clic

### État actuel

Panneau « Erreur » : un menu déroulant `errorRef` (référence) + cases de type
d'erreur. `mergedPlotlyFigureWithErrors(figs, refKey, typeIds)` calcule l'erreur
de **toutes** les courbes (sauf la référence) contre la référence. Un clic sur
une courbe change la référence (`bindRefClick`).

### Nouveau modèle (sélection au clic)

État de sélection : `errorSelect = { refKey, comparedKeys }` (`comparedKeys` =
ensemble). Sur le graphe de l'overlay, panneau « Erreur » ouvert (mode
sélection) :

- **1er clic** sur une courbe → devient la **référence**.
- **Clic suivant** sur une autre courbe → l'**ajoute/retire** de l'ensemble
  « comparées » (re-clic = retire).
- **Re-clic sur la référence** → efface la référence (le prochain clic sur une
  courbe non sélectionnée la redéfinit comme référence).

Règle unifiée du clic sur une courbe de clé `k` :
- si `k === refKey` → `refKey = null` ;
- sinon si `k ∈ comparedKeys` → retirer `k` de `comparedKeys` ;
- sinon (non sélectionnée) → si `refKey === null` alors `refKey = k`, sinon
  ajouter `k` à `comparedKeys`.

### UI du panneau

- Suppression du menu déroulant `errorRef`.
- Bouton **« Réinitialiser »** (vide `refKey` et `comparedKeys`).
- Résumé texte : « Réf : B • Comparées : A, D » (ou invite si incomplet).
- Cases de **type d'erreur** conservées.
- **« Appliquer »** : exige une référence et au moins une courbe comparée (sinon
  message d'avertissement). Trace **une courbe d'erreur par courbe comparée**,
  toutes contre la même référence, pour chaque type coché.

### Retour visuel

Pendant la sélection, retour visuel par `Plotly.restyle` sur les traces taguées
`_curveKey` :
- référence : pleine opacité + ligne épaissie (mise en avant) ;
- comparées : pleine opacité ;
- non sélectionnées : atténuées (opacité réduite).

### Calcul

`mergedPlotlyFigureWithErrors(figs, refKey, typeIds, comparedKeys)` gagne le
paramètre `comparedKeys` et n'itère que sur les courbes dont la clé y figure
(au lieu de « toutes sauf la référence »). Le marquage `_curveKey` des traces de
la superposition (déjà présent dans `mergedPlotlyFigure`) sert au clic et au
restyle.

### Après application

La vue fusionnée (avec sous-graphe d'erreur) est affichée. Pour ajuster la
sélection, l'utilisateur rouvre le panneau via le bouton « Erreur » (retour en
mode sélection, état pré-rempli). Le re-choix de la référence par clic
post-application (`bindRefClick` actuel) est remplacé par ce retour en mode
sélection.

## Protocole de messages (webview ⇄ extension)

Ajouts / extensions :

- `exportPlotly` (ext → webview) : accepte `format: "pdf"` et la sentinelle
  `id: "compare"`. Le webview résout l'élément (figure ou compare) et renvoie un
  `exportResult` dont `dataUrl` est un PDF raster, ou `{ useNative: true }`
  quand le PDF natif matplotlib doit être utilisé (figure sans encart).
- Les handlers extension `save` / `saveCsv` / `saveBundle` acceptent
  `id: "compare"` (pas de figure stockée ; formats rendus côté webview).

Aucune nouvelle dépendance ; cohérent avec la contrainte « pas de build,
pas de npm install ».

## Modules touchés

- `media/panel.html` — les 4 volets (ResizeObserver, glue PDF raster, barre
  d'export de l'overlay, sélection d'erreur au clic).
- `extension.js` — routage PDF (aller-retour webview + repli natif), prise en
  charge de la sentinelle `compare`, injection de `{{pdfExportUri}}`.
- `media/pdf_export.js` — **nouveau** module pur `PdfExport.buildPdf`.
- `test/test_pdf_export.js` — **nouveau** harnais Node.
- `test/check_panel_html.js` — déclarer le placeholder `{{pdfExportUri}}`.
- `README.md` — documenter PDF encart/erreurs/comparaison, barre d'export de
  l'overlay, sélection d'erreur au clic ; ajuster « Limites connues ».

## Tests & vérification

- `node test/test_pdf_export.js` — structure du PDF minimal (en-tête, xref,
  trailer, MediaBox, filtres FlateDecode/DCTDecode).
- `node test/check_panel_html.js` — placeholders à jour.
- `node --check extension.js && node --check media/pdf_export.js`.
- Vérif manuelle dans l'Extension Development Host (`test/test_plots.py`,
  `test/test_stress.py`) : redimensionnement multi-écran, sauvegarde PDF avec
  encart, barre d'export de l'overlay (PDF/PNG/SVG/Copier/CSV/Bundle), sélection
  d'erreur au clic avec 3+ courbes.

## Hors périmètre

- PDF vectoriel pour les cas encart/erreurs/comparaison (raster assumé).
- Persistance de la comparaison comme figure stockée.
- Reprise de Tags / Supprimer / Agrandir dans l'overlay.
