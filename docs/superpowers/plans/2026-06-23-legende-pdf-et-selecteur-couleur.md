# Édition de légende persistée en PDF + sélecteur de couleur 2D — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Faire en sorte que les éditions de légende (couleur/nom/style) soient conservées à l'export PDF, et ajouter un sélecteur de couleur 2D (carré S/V + bande de teinte + hex) dans le mode avancé de l'éditeur de légende.

**Architecture:** Deux volets indépendants. (A) PDF : l'extension marque `fig.edited` (persisté automatiquement via `storage.save` qui sérialise l'objet entier) et passe un signal `allowNative` au webview, qui bascule alors sur le PDF raster de l'élément Plotly vivant. (B) Sélecteur : conversions HSV pures ajoutées à `media/legend_edit.js` (testées sous Node), glue DOM (carré/bande/hex + pointer events, aperçu live) dans `media/panel.html`.

**Tech Stack:** JavaScript pur (pas de build, pas de `npm install`). Modules webview en UMD (`self.X` / `require`). Tests Node sans dépendance (`node test/...js`). Syntaxe JS vérifiée par `node --check`. Plotly.js bundlé.

## Global Constraints

- Langue de travail **française** : UI, commentaires, messages de commit, descriptions de config.
- **Aucune dépendance** ajoutée (ni npm, ni Python). Backend Python : matplotlib/numpy uniquement.
- Modules purs en **UMD** : `module.exports` sous Node, `self.X` dans le webview.
- Pas de build : vérifier la syntaxe avec `node --check <fichier.js>`.
- Couplage JS/Python = contrat `/figure` + env `VSCODE_PLOTS_*` uniquement ; ici on ne touche pas au Python.
- `media/panel.html` est la **source unique** de l'UI ; tout module pur référencé doit avoir son URI injectée dans `extension.js:webviewHtml()` et un placeholder dans `panel.html` + `test/check_panel_html.js`. (Ici on **étend** `legend_edit.js`, déjà câblé — aucun nouveau placeholder.)
- Commits fréquents, un par tâche. Terminer chaque message de commit par :
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`
- `docs/` est gitignoré : committer les fichiers de `docs/` avec `git add -f`.

---

### Task 1 : Conversions HSV dans `legend_edit.js`

Fonctions pures de conversion d'espace colorimétrique, base du sélecteur 2D du volet B. Aucune dépendance DOM.

**Files:**
- Modify: `media/legend_edit.js` (ajout de 4 fonctions + export dans l'objet retourné)
- Test: `test/test_legend_edit.js` (ajout de cas)

**Interfaces:**
- Consumes: `toHexColor(color, fallback)` existant dans le même module.
- Produces :
  - `rgbToHsv(r, g, b) → {h, s, v}` — `r,g,b` ∈ [0,255] ; `h` ∈ [0,360), `s,v` ∈ [0,1].
  - `hsvToRgb(h, s, v) → {r, g, b}` — entiers 0–255.
  - `hexToHsv(hex) → {h, s, v}` — normalise l'entrée via `toHexColor`.
  - `hsvToHex(h, s, v) → "#rrggbb"`.

- [ ] **Step 1 : Écrire les tests qui échouent**

Ajouter dans `test/test_legend_edit.js`, **avant** la ligne finale `if (process.exitCode) { process.exit(process.exitCode); }` :

```javascript
check("hsvToHex: primaires", function () {
  assert.strictEqual(LE.hsvToHex(0, 1, 1), "#ff0000");
  assert.strictEqual(LE.hsvToHex(120, 1, 1), "#00ff00");
  assert.strictEqual(LE.hsvToHex(240, 1, 1), "#0000ff");
});
check("hsvToHex: gris (s=0) et noir (v=0)", function () {
  assert.strictEqual(LE.hsvToHex(0, 0, 0.5), "#808080");
  assert.strictEqual(LE.hsvToHex(123, 0.7, 0), "#000000");
});
check("rgbToHsv: rouge et gris", function () {
  const red = LE.rgbToHsv(255, 0, 0);
  assert.strictEqual(red.h, 0);
  assert.strictEqual(red.s, 1);
  assert.strictEqual(red.v, 1);
  const gray = LE.rgbToHsv(128, 128, 128);
  assert.strictEqual(gray.s, 0);
});
check("hexToHsv -> hsvToHex : aller-retour exact sur BASE_COLORS", function () {
  LE.BASE_COLORS.forEach(function (c) {
    const hsv = LE.hexToHsv(c.value);
    const back = LE.hsvToHex(hsv.h, hsv.s, hsv.v);
    // tolerance +/-1 par canal (arrondis flottants)
    for (let i = 1; i < 7; i += 2) {
      const a = parseInt(c.value.slice(i, i + 2), 16);
      const b = parseInt(back.slice(i, i + 2), 16);
      assert.ok(Math.abs(a - b) <= 1, c.value + " -> " + back);
    }
  });
});
```

- [ ] **Step 2 : Lancer les tests pour vérifier l'échec**

Run: `node test/test_legend_edit.js`
Expected: FAIL — `LE.hsvToHex is not a function` (ou `process.exitCode` à 1).

- [ ] **Step 3 : Implémenter les conversions**

Dans `media/legend_edit.js`, **après** la fonction `hexToRgba` (avant `compareLegendPrefix`), ajouter :

```javascript
  function rgbToHsv(r, g, b) {
    const rn = r / 255, gn = g / 255, bn = b / 255;
    const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
    const d = max - min;
    let h = 0;
    if (d !== 0) {
      if (max === rn) { h = ((gn - bn) / d) % 6; }
      else if (max === gn) { h = (bn - rn) / d + 2; }
      else { h = (rn - gn) / d + 4; }
      h *= 60;
      if (h < 0) { h += 360; }
    }
    const s = max === 0 ? 0 : d / max;
    return { h: h, s: s, v: max };
  }

  function hsvToRgb(h, s, v) {
    const hh = ((h % 360) + 360) % 360;
    const c = v * s;
    const x = c * (1 - Math.abs((hh / 60) % 2 - 1));
    const m = v - c;
    let r1 = 0, g1 = 0, b1 = 0;
    if (hh < 60) { r1 = c; g1 = x; }
    else if (hh < 120) { r1 = x; g1 = c; }
    else if (hh < 180) { g1 = c; b1 = x; }
    else if (hh < 240) { g1 = x; b1 = c; }
    else if (hh < 300) { r1 = x; b1 = c; }
    else { r1 = c; b1 = x; }
    return {
      r: Math.round((r1 + m) * 255),
      g: Math.round((g1 + m) * 255),
      b: Math.round((b1 + m) * 255)
    };
  }

  function hsvToHex(h, s, v) {
    const c = hsvToRgb(h, s, v);
    return "#" + [c.r, c.g, c.b].map(function (n) {
      return Math.max(0, Math.min(255, n)).toString(16).padStart(2, "0");
    }).join("");
  }

  function hexToHsv(hex) {
    const h = toHexColor(hex, "#1f77b4");
    const r = parseInt(h.slice(1, 3), 16);
    const g = parseInt(h.slice(3, 5), 16);
    const b = parseInt(h.slice(5, 7), 16);
    return rgbToHsv(r, g, b);
  }
```

Puis ajouter les 4 noms dans l'objet retourné (le `return { ... }` final), par exemple après `toHexColor: toHexColor,` :

```javascript
    rgbToHsv: rgbToHsv,
    hsvToRgb: hsvToRgb,
    hsvToHex: hsvToHex,
    hexToHsv: hexToHsv,
```

- [ ] **Step 4 : Lancer les tests pour vérifier le succès**

Run: `node test/test_legend_edit.js`
Expected: PASS — tous les `ok   - ...` y compris les 4 nouveaux, et `N tests OK`.

- [ ] **Step 5 : Vérifier la syntaxe**

Run: `node --check media/legend_edit.js`
Expected: aucune sortie (exit 0).

- [ ] **Step 6 : Commit**

```bash
git add media/legend_edit.js test/test_legend_edit.js
git commit -m "feat(legende): conversions HSV pour le selecteur de couleur

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2 : PDF raster pour une figure dont la légende a été éditée

Marquer `fig.edited` à la persistance des éditions, ne plus proposer le PDF natif périmé, et faire basculer le webview sur le PDF raster (qui rend l'élément vivant, donc édité). Logique cross-process : pas de test unitaire, vérification par `node --check` + recette dev-host.

**Files:**
- Modify: `extension.js` — `updateFigureTrace` (≈ ligne 257), `saveOne` (≈ lignes 416–422)
- Modify: `media/panel.html` — `exportPlotly`, branche PDF (≈ ligne 2960)
- (Aucun changement à `storage.js` : `save(fig)` fait `JSON.stringify(fig)` et `loadAll` fait `JSON.parse`, donc `fig.edited` round-trip déjà.)

**Interfaces:**
- Consumes: rien de neuf (utilise `storage.save`, `pendingExports`, `postToWebview` existants).
- Produces: le message `exportPlotly` porte désormais `options.allowNative` (booléen) ; `pendingExports[requestId].nativePdf` n'est non-nul que si l'export vectoriel reste fidèle.

- [ ] **Step 1 : Marquer `fig.edited` à l'édition de trace**

Dans `extension.js`, fonction `updateFigureTrace` (≈ ligne 251). Remplacer :

```javascript
  LegendEdit.applyPatch(trace, patch);
  try { storage.save(fig); } catch (e) { /* best-effort */ }
```

par :

```javascript
  LegendEdit.applyPatch(trace, patch);
  // Le PDF vectoriel natif (rendu par le backend a la creation) ne reflete pas
  // cette edition : on marque la figure pour basculer l'export PDF en raster.
  fig.edited = true;
  try { storage.save(fig); } catch (e) { /* best-effort */ }
```

- [ ] **Step 2 : Ne proposer le PDF natif que si la figure n'est pas éditée**

Dans `extension.js`, fonction `saveOne`, bloc `pendingExports[requestId] = { ... }` (≈ ligne 416). Remplacer le bloc complet :

```javascript
    const requestId = String(nextExportRequestId++);
    pendingExports[requestId] = {
      filePath: uri.fsPath,
      title: fig.title,
      // Repli si le webview renvoie useNative (figure sans encart) : PDF matplotlib.
      nativePdf: (isPdf && fig.pdf && fig.id !== "compare") ? fig.pdf : null
    };
    postToWebview({ type: "exportPlotly", id: fig.id, requestId: requestId, options: options });
    return;
```

par :

```javascript
    const requestId = String(nextExportRequestId++);
    // PDF vectoriel natif disponible seulement si rien n'a ete edite dans le
    // webview (sinon fig.pdf est perime). Le webview respecte ce signal.
    const allowNative = !!(isPdf && fig.pdf && fig.id !== "compare" && !fig.edited);
    pendingExports[requestId] = {
      filePath: uri.fsPath,
      title: fig.title,
      nativePdf: allowNative ? fig.pdf : null
    };
    options.allowNative = allowNative;
    postToWebview({ type: "exportPlotly", id: fig.id, requestId: requestId, options: options });
    return;
```

- [ ] **Step 3 : Respecter `allowNative` dans le webview**

Dans `media/panel.html`, fonction `exportPlotly`, branche PDF (≈ ligne 2959). Remplacer :

```javascript
    if (options.format === "pdf"){
      if (!isCompare && !el._spHasInset){
        postExportResult(msg.requestId, true, null, null, true);
        return;
      }
```

par :

```javascript
    if (options.format === "pdf"){
      // PDF natif vectoriel seulement si l'extension l'autorise (figure non
      // editee) et sans encart. Sinon -> PDF raster de l'element vivant (edite).
      if (!isCompare && !el._spHasInset && options.allowNative !== false){
        postExportResult(msg.requestId, true, null, null, true);
        return;
      }
```

- [ ] **Step 4 : Vérifier la syntaxe**

Run: `node --check extension.js`
Expected: aucune sortie (exit 0).

(Note : `panel.html` n'est pas vérifiable par `node --check` ; la modif est confinée à une condition booléenne.)

- [ ] **Step 5 : Recette dev-host (vérification manuelle)**

Ouvrir le dossier dans VS Code, F5 (« Run Extension »). Dans un terminal neuf du dev-host :

```bash
python test/test_plots.py
```

1. Dans le panneau Graphes, sur une figure simple (courbe avec légende), cliquer le bouton **crayon** de la modebar, cliquer une entrée de légende, changer la **couleur**, Appliquer.
2. Enregistrer la figure en **PDF**. Ouvrir le PDF → la courbe doit avoir la **nouvelle** couleur (avant ce correctif : l'ancienne).
3. Vérifier qu'une figure **non éditée** s'exporte toujours en PDF **vectoriel** (texte sélectionnable dans le PDF).
4. **Reload Window** (Ctrl+R dans le dev-host), ré-exporter la figure éditée en PDF → la couleur éditée doit **toujours** être conservée (vérifie la persistance de `fig.edited`).

- [ ] **Step 6 : Commit**

```bash
git add extension.js media/panel.html
git commit -m "fix(pdf): conserver les editions de legende a l'export PDF (raster)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3 : Sélecteur de couleur 2D dans le mode avancé

Carré saturation/luminosité + bande de teinte verticale + champ hex, dans la section avancée de l'éditeur de légende. Aperçu live pendant le drag (restyle continu), persistance au relâcher. Glue DOM : pas de test unitaire, recette dev-host.

**Files:**
- Modify: `media/panel.html` — markup dans `#leAdvancedColors` (≈ lignes 436–443), styles CSS (bloc `<style>`), glue JS (près des helpers de légende, ≈ lignes 1560–1690)

**Interfaces:**
- Consumes (Task 1) : `LegendEdit.hsvToHex(h,s,v)`, `LegendEdit.hexToHsv(hex)`, `LegendEdit.toHexColor`, `LegendEdit.buildRestyle`.
- Consumes (existant) : `legendEditTarget` (`{el, idx}`), `persistLegendPatch(el, idx, patch)`, `setLegendColor(color)`, `openLegendEditor(el, idx)`.
- Produces : aucune API externe ; pilote `#leColor` (porteur de valeur du flux « Appliquer » existant).

- [ ] **Step 1 : Ajouter le markup du sélecteur**

Dans `media/panel.html`, dans `.le-advanced-body` (≈ ligne 438), **avant** `<label>Palette ...`, insérer :

```html
        <div class="le-picker">
          <div class="le-sv" id="leSvSquare"><span class="le-sv-thumb" id="leSvThumb"></span></div>
          <div class="le-hue" id="leHueStrip"><span class="le-hue-thumb" id="leHueThumb"></span></div>
        </div>
        <label>Hex <input id="leHex" type="text" maxlength="7" spellcheck="false" value="#1f77b4"></label>
```

- [ ] **Step 2 : Ajouter les styles CSS**

Dans le bloc `<style>` de `media/panel.html`, à côté des autres règles `.le-*`, ajouter :

```css
    .le-picker { display: flex; gap: 8px; margin: 6px 0; }
    .le-sv {
      position: relative; width: 160px; height: 110px; border-radius: 6px;
      background-image:
        linear-gradient(to top, #000, rgba(0, 0, 0, 0)),
        linear-gradient(to right, #fff, rgba(255, 255, 255, 0));
      background-color: #ff0000; cursor: crosshair; touch-action: none;
    }
    .le-sv-thumb {
      position: absolute; width: 12px; height: 12px; border-radius: 50%;
      border: 2px solid #fff; box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.5);
      transform: translate(-50%, -50%); pointer-events: none;
    }
    .le-hue {
      position: relative; width: 16px; height: 110px; border-radius: 6px;
      background: linear-gradient(to bottom,
        #f00 0%, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, #f00 100%);
      cursor: ns-resize; touch-action: none;
    }
    .le-hue-thumb {
      position: absolute; left: -2px; right: -2px; height: 4px;
      border: 1px solid #fff; box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.5);
      transform: translateY(-50%); pointer-events: none;
    }
```

- [ ] **Step 3 : Ajouter la glue JS du sélecteur**

Dans `media/panel.html`, **après** la fonction `setLegendColor` (≈ ligne 1579), ajouter le bloc suivant. Il gère l'état HSV, le rendu des curseurs, l'aperçu live (restyle sans persistance) et la persistance au relâcher.

```javascript
  // ---- Selecteur de couleur 2D (mode avance) ----
  let pickerHsv = { h: 0, s: 1, v: 1 };

  // Restyle la trace ciblee en direct, SANS persister (apercu pendant le drag).
  function livePreviewColor(hex){
    const t = legendEditTarget;
    if (!t.el || t.idx < 0 || typeof LegendEdit === "undefined"){ return; }
    try { Plotly.restyle(t.el, LegendEdit.buildRestyle({ color: hex }), [t.idx]); } catch (e) {}
  }

  function renderPicker(){
    if (typeof LegendEdit === "undefined"){ return; }
    const sv = document.getElementById("leSvSquare");
    const svThumb = document.getElementById("leSvThumb");
    const hueThumb = document.getElementById("leHueThumb");
    const hex = LegendEdit.hsvToHex(pickerHsv.h, pickerHsv.s, pickerHsv.v);
    if (sv){ sv.style.backgroundColor = LegendEdit.hsvToHex(pickerHsv.h, 1, 1); }
    if (svThumb){
      svThumb.style.left = (pickerHsv.s * 100) + "%";
      svThumb.style.top = ((1 - pickerHsv.v) * 100) + "%";
    }
    if (hueThumb){ hueThumb.style.top = ((pickerHsv.h / 360) * 100) + "%"; }
    const hexInput = document.getElementById("leHex");
    if (hexInput){ hexInput.value = hex; }
    setLegendColor(hex);
    return hex;
  }

  // Initialise le selecteur depuis une couleur hex (ex. a l'ouverture).
  function setPickerFromHex(hex){
    if (typeof LegendEdit === "undefined"){ return; }
    pickerHsv = LegendEdit.hexToHsv(hex);
    renderPicker();
  }

  function clamp01(x){ return x < 0 ? 0 : (x > 1 ? 1 : x); }

  // Drag generique : appelle update(fraction) puis apercu live ; persiste au relacher.
  function bindPickerDrag(el, update){
    if (!el){ return; }
    function move(ev){
      const r = el.getBoundingClientRect();
      update(clamp01((ev.clientX - r.left) / r.width), clamp01((ev.clientY - r.top) / r.height));
      livePreviewColor(renderPicker());
    }
    el.addEventListener("pointerdown", function(ev){
      el.setPointerCapture(ev.pointerId);
      move(ev);
      ev.preventDefault();
    });
    el.addEventListener("pointermove", function(ev){
      if (el.hasPointerCapture(ev.pointerId)){ move(ev); }
    });
    el.addEventListener("pointerup", function(ev){
      try { el.releasePointerCapture(ev.pointerId); } catch (e) {}
      // Persiste l'edition (couleur courante) une seule fois.
      const t = legendEditTarget;
      const hex = LegendEdit.hsvToHex(pickerHsv.h, pickerHsv.s, pickerHsv.v);
      if (t.el && t.idx >= 0){ persistLegendPatch(t.el, t.idx, LegendEdit.buildRestyle({ color: hex })); }
    });
  }

  (function initColorPicker(){
    bindPickerDrag(document.getElementById("leSvSquare"), function(fx, fy){
      pickerHsv.s = fx;
      pickerHsv.v = 1 - fy;
    });
    bindPickerDrag(document.getElementById("leHueStrip"), function(fx, fy){
      pickerHsv.h = fy * 360;
    });
    const hexInput = document.getElementById("leHex");
    if (hexInput){
      hexInput.addEventListener("change", function(){
        setPickerFromHex(hexInput.value);
        livePreviewColor(LegendEdit.hsvToHex(pickerHsv.h, pickerHsv.s, pickerHsv.v));
      });
    }
    const colorInput = document.getElementById("leColor");
    if (colorInput){
      colorInput.addEventListener("input", function(){ setPickerFromHex(colorInput.value); });
    }
  })();
```

- [ ] **Step 4 : Initialiser le sélecteur à l'ouverture de l'éditeur**

Dans `media/panel.html`, fonction `openLegendEditor` (≈ ligne 1622), **après** la ligne :

```javascript
    document.getElementById("leColor").value = LegendEdit.toHexColor(v.color, "#1f77b4");
```

ajouter :

```javascript
    setPickerFromHex(LegendEdit.toHexColor(v.color, "#1f77b4"));
```

- [ ] **Step 5 : Vérifier que les placeholders du panneau restent cohérents**

Run: `node test/check_panel_html.js`
Expected: PASS (aucun nouveau module → aucun placeholder ajouté ; le test reste vert).

- [ ] **Step 6 : Recette dev-host (vérification manuelle)**

F5, terminal neuf, `python test/test_plots.py`. Sur une figure :
1. Crayon → cliquer une entrée de légende → ouvrir **Avancé**.
2. Le carré S/V et la bande de teinte affichent la couleur **actuelle** de la courbe (curseurs bien placés).
3. **Glisser** dans le carré → la courbe change de couleur **en direct**. Glisser la bande de teinte → la teinte du carré et la courbe suivent.
4. Relâcher → la couleur est **appliquée** (vérifier : changer d'entrée puis revenir, la couleur tient).
5. Taper un hex dans le champ → curseurs et courbe se mettent à jour.
6. Modifier le `<input type=color>` natif → curseurs se repositionnent.

- [ ] **Step 7 : Commit**

```bash
git add media/panel.html
git commit -m "feat(legende): selecteur de couleur 2D (teinte + sat/lum) avec apercu live

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4 : Documentation

Noter le comportement « PDF raster pour figure éditée » et combler les deux modules absents de `CLAUDE.md`.

**Files:**
- Modify: `README.md` (section « Génération PDF » / limites)
- Modify: `CLAUDE.md` (section « Génération PDF » + liste « Modules purs du webview »)

- [ ] **Step 1 : README — note PDF raster**

Dans `README.md`, dans la partie traitant de l'export/PDF, ajouter une phrase :

```markdown
> Une figure dont la légende a été modifiée dans le panneau (couleur, nom,
> style) est exportée en **PDF raster** haute résolution au lieu du PDF
> vectoriel natif, car le rendu vectoriel matplotlib d'origine ne reflète pas
> ces modifications. Les figures non modifiées restent en PDF vectoriel.
```

- [ ] **Step 2 : CLAUDE.md — note PDF + flag `edited`**

Dans `CLAUDE.md`, section « Génération PDF », à la fin, ajouter :

```markdown
Une **édition de légende** (panneau `legendEditor`) marque la figure
`fig.edited` (persisté par `storage.save` qui sérialise l'objet entier). Dès
lors, `saveOne` ne fournit plus de `nativePdf` et passe `options.allowNative =
false` au webview, qui bascule sur le **PDF raster** (le PDF vectoriel natif,
rendu à la création, ne reflète pas l'édition).
```

- [ ] **Step 3 : CLAUDE.md — documenter `plot_nav.js` et `figure_filter.js`**

Dans `CLAUDE.md`, section « Modules purs du webview », ajouter deux entrées à la liste (même format que les autres) :

```markdown
- **`plot_nav.js`** (`PlotNav`) — math pure de navigation : `zoomRange`
  (zoom molette Ctrl/Cmd centré sur le curseur), `panRange` (pan au clic-molette
  maintenu). Travaille en espace linéaire de l'axe ; la glue (`panel.html`)
  convertit via les helpers Plotly `r2l`/`l2r` (correct pour log/date). Testé par
  `test/test_plot_nav.js`.
- **`figure_filter.js`** (`FigureFilter`) — recherche/tri des figures :
  `figKind`, `matchesQuery` (plein-texte titre + tags + provenance), `sortFigures`
  (arrivée/titre/type/script/date). Glue dans `panel.html` (barre de recherche).
  Testé par `test/test_figure_filter.js`.
```

Et compléter la phrase « Outre `error_math.js` et `inset_layout.js` : » pour
inclure aussi `plot_nav.js`/`figure_filter.js` si l'énumération les omet.

- [ ] **Step 4 : Commit**

```bash
git add README.md CLAUDE.md
git commit -m "docs: PDF raster pour figure editee + documenter plot_nav/figure_filter

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Notes de revue (self-review)

- **Couverture spec** : Volet A → Task 2 (+ doc Task 4). Volet B logique → Task 1 ; glue → Task 3. Documentation `plot_nav`/`figure_filter` → Task 4. Tous les éléments « Fichiers touchés » de la spec sont couverts, **sauf** `storage.js` : vérifié inutile car `save`/`loadAll` round-trippent l'objet entier (à signaler à la revue).
- **Type consistency** : `fig.edited` (booléen) écrit en Task 2 Step 1, lu en Task 2 Step 2 ; `options.allowNative` produit en Task 2 Step 2, consommé en Task 2 Step 3. Sélecteur : `pickerHsv {h,s,v}`, `renderPicker()`, `setPickerFromHex(hex)`, `livePreviewColor(hex)`, `bindPickerDrag(el, update)` cohérents au sein de Task 3.
- **Aperçu live vs persistance** : pendant le drag `livePreviewColor` (restyle sans message) ; au `pointerup` `persistLegendPatch` (message `updateFigure` → `fig.edited`). Conforme à la spec.
