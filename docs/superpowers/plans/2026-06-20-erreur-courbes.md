# Erreur entre courbes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajouter à la vue Superposition de la comparaison un bouton « Erreur » qui calcule et affiche l'erreur entre N courbes par rapport à une référence choisie, dans un sous-graphe résiduel à axe X partagé.

**Architecture:** Le calcul (interpolation linéaire + formules d'erreur) vit dans un nouveau module pur `media/error_math.js` (wrapper UMD : global dans le webview, `require` sous Node), testé par un harnais Node sans dépendance. La glue UI/Plotly (aplatissement des courbes, contrôles, construction de la figure à 2 axes Y empilés) vit dans `media/panel.html`. Aucune touche au backend Python ni au protocole `/figure`.

**Tech Stack:** JavaScript pur (Node + webview VS Code), Plotly.js (déjà embarqué), pas de build, pas de dépendances.

## Global Constraints

- Langue de travail **française** : libellés UI, commentaires, messages de commit, descriptions.
- Le module Python n'est **pas** touché ; aucune dépendance ajoutée.
- Le webview a une **CSP stricte** (`panel.html:5`) : `script-src 'nonce-{{nonce}}' {{cspSource}};` — tout script externe doit passer par `webview.asWebviewUri` (comme `plotly.min.js`), pas de `connect-src`.
- `media/panel.html` est **l'unique source de l'UI** ; l'extension y substitue `{{nonce}}`, `{{cspSource}}`, `{{plotlyUri}}` (et désormais `{{errorMathUri}}`).
- Courbe = un **tracé** (`scatter`) ; les traces `bar` sont exclues du calcul.
- `EPS = 1e-12` pour le garde-fou de l'erreur relative.
- Vérif JS : `node --check <fichier.js>`. `panel.html` (HTML) n'est pas vérifiable par `node --check` ; il se teste dans l'Extension Development Host (F5).

---

### Task 1: Module `error_math.js` + harnais de test + `interpLinear`

**Files:**
- Create: `media/error_math.js`
- Create: `test/test_error_curves.js`

**Interfaces:**
- Produces: `interpLinear(xRef, xs, ys) -> Array<number|null>` — interpole `(xs, ys)` (supposés triés par x croissant) aux abscisses `xRef`. Renvoie `null` pour tout `xRef[k]` hors de `[xs[0], xs[n-1]]`, ou si une borne d'interpolation est `null`/`NaN`. Module exporté à la fois via `module.exports` (Node) et `self.ErrorMath` (webview).

- [ ] **Step 1: Écrire le harnais de test (échec attendu : module absent)**

Create `test/test_error_curves.js` :

```js
// Harnais de test sans dependance pour media/error_math.js
// Lancer : node test/test_error_curves.js
"use strict";
const assert = require("assert");
const EM = require("../media/error_math.js");

let passed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log("ok   - " + name); }
  catch (e) { console.error("FAIL - " + name + " : " + e.message); process.exitCode = 1; }
}
function approx(a, b, eps) { return Math.abs(a - b) <= (eps == null ? 1e-9 : eps); }

// --- interpLinear ---
check("interpLinear: grille identique renvoie les memes y", function () {
  const r = EM.interpLinear([0, 1, 2], [0, 1, 2], [10, 20, 30]);
  assert.deepStrictEqual(r, [10, 20, 30]);
});
check("interpLinear: point milieu interpole", function () {
  const r = EM.interpLinear([0.5], [0, 1], [0, 10]);
  assert.ok(approx(r[0], 5), "attendu 5, recu " + r[0]);
});
check("interpLinear: hors plage -> null", function () {
  const r = EM.interpLinear([-1, 3], [0, 1, 2], [0, 1, 2]);
  assert.deepStrictEqual(r, [null, null]);
});
check("interpLinear: borne y null -> null", function () {
  const r = EM.interpLinear([0.5], [0, 1], [null, 10]);
  assert.strictEqual(r[0], null);
});

console.log("\n" + passed + " tests passes");
```

- [ ] **Step 2: Lancer le test, vérifier l'échec**

Run: `node test/test_error_curves.js`
Expected: erreur `Cannot find module '../media/error_math.js'`.

- [ ] **Step 3: Créer `media/error_math.js` avec le wrapper UMD et `interpLinear`**

```js
// ============================================================
// error_math.js
// Calcul d'erreur entre courbes (fonctions pures, sans DOM).
// Charge a la fois dans le webview (self.ErrorMath) et sous
// Node (require). Aucune dependance.
// ============================================================
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) { module.exports = api; }
  else { root.ErrorMath = api; }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // Interpole (xs, ys) — supposes tries par x croissant — aux abscisses xRef.
  // null hors de [xs[0], xs[n-1]] ou si une borne est null/NaN.
  function interpLinear(xRef, xs, ys) {
    const n = xs.length;
    const out = new Array(xRef.length);
    for (let k = 0; k < xRef.length; k++) {
      const xq = xRef[k];
      if (xq == null || isNaN(xq) || n === 0 || xq < xs[0] || xq > xs[n - 1]) {
        out[k] = null;
        continue;
      }
      if (n === 1) { out[k] = (xq === xs[0]) ? ys[0] : null; continue; }
      let i = 0;
      while (i < n - 1 && xs[i + 1] < xq) { i++; }
      const x0 = xs[i], x1 = xs[i + 1], y0 = ys[i], y1 = ys[i + 1];
      if (y0 == null || y1 == null || isNaN(y0) || isNaN(y1)) { out[k] = null; continue; }
      out[k] = (x1 === x0) ? y0 : y0 + ((xq - x0) / (x1 - x0)) * (y1 - y0);
    }
    return out;
  }

  return { interpLinear: interpLinear };
});
```

- [ ] **Step 4: Lancer le test, vérifier le succès**

Run: `node test/test_error_curves.js`
Expected: `4 tests passes`, exit 0.

- [ ] **Step 5: Vérifier la syntaxe**

Run: `node --check media/error_math.js`
Expected: aucune sortie (OK).

- [ ] **Step 6: Commit**

```bash
git add media/error_math.js test/test_error_curves.js
git commit -m "feat(erreur): interpolation lineaire + harnais de test Node"
```

---

### Task 2: `computeError` + `ERROR_TYPES` + `EPS`

**Files:**
- Modify: `media/error_math.js`
- Modify: `test/test_error_curves.js`

**Interfaces:**
- Consumes: rien de nouveau.
- Produces:
  - `EPS = 1e-12` (constante exportée).
  - `ERROR_TYPES` : objet `{ signed, abs, rel, relpct }`, chaque entrée `{ id, label, abbr }`.
  - `computeError(typeId, yRef, yI, eps) -> number|null` — un point. `null` si `yRef`/`yI` est `null`/`NaN`, ou si type relatif et `|yRef| < eps`.

- [ ] **Step 1: Ajouter les tests (échec attendu : fonctions absentes)**

Ajouter dans `test/test_error_curves.js`, avant la ligne `console.log("\n" + passed ...)` :

```js
// --- computeError ---
check("computeError: difference signee", function () {
  assert.strictEqual(EM.computeError("signed", 10, 12), 2);
});
check("computeError: erreur absolue", function () {
  assert.strictEqual(EM.computeError("abs", 10, 8), 2);
});
check("computeError: erreur relative", function () {
  assert.ok(approx(EM.computeError("rel", 10, 11), 0.1));
});
check("computeError: erreur relative %", function () {
  assert.ok(approx(EM.computeError("relpct", 10, 11), 10));
});
check("computeError: yRef ~ 0 en relatif -> null", function () {
  assert.strictEqual(EM.computeError("rel", 0, 5), null);
  assert.strictEqual(EM.computeError("relpct", 1e-15, 5), null);
});
check("computeError: yRef ~ 0 en signe reste defini", function () {
  assert.strictEqual(EM.computeError("signed", 0, 5), 5);
});
check("computeError: entree null -> null", function () {
  assert.strictEqual(EM.computeError("signed", null, 5), null);
  assert.strictEqual(EM.computeError("abs", 5, NaN), null);
});
check("ERROR_TYPES: 4 types avec label et abbr", function () {
  ["signed", "abs", "rel", "relpct"].forEach(function (id) {
    assert.ok(EM.ERROR_TYPES[id], "type manquant : " + id);
    assert.ok(EM.ERROR_TYPES[id].label, "label manquant : " + id);
    assert.ok(EM.ERROR_TYPES[id].abbr, "abbr manquant : " + id);
  });
});
```

- [ ] **Step 2: Lancer le test, vérifier l'échec**

Run: `node test/test_error_curves.js`
Expected: les nouveaux `check` échouent (`EM.computeError is not a function`).

- [ ] **Step 3: Implémenter dans `media/error_math.js`**

Juste avant `return { interpLinear: interpLinear };`, insérer :

```js
  const EPS = 1e-12;

  const ERROR_TYPES = {
    signed: { id: "signed", label: "Difference signee", abbr: "diff" },
    abs:    { id: "abs",    label: "Erreur absolue",    abbr: "abs" },
    rel:    { id: "rel",    label: "Erreur relative",   abbr: "rel" },
    relpct: { id: "relpct", label: "Erreur relative %", abbr: "rel %" }
  };

  function computeError(typeId, yRef, yI, eps) {
    if (yRef == null || yI == null || isNaN(yRef) || isNaN(yI)) { return null; }
    const e = (eps == null) ? EPS : eps;
    const diff = yI - yRef;
    switch (typeId) {
      case "signed": return diff;
      case "abs": return Math.abs(diff);
      case "rel": return (Math.abs(yRef) < e) ? null : diff / yRef;
      case "relpct": return (Math.abs(yRef) < e) ? null : (diff / yRef) * 100;
      default: return null;
    }
  }
```

Et remplacer la ligne de retour par :

```js
  return {
    interpLinear: interpLinear,
    computeError: computeError,
    ERROR_TYPES: ERROR_TYPES,
    EPS: EPS
  };
```

- [ ] **Step 4: Lancer le test, vérifier le succès**

Run: `node test/test_error_curves.js`
Expected: tous les tests passent, exit 0.

- [ ] **Step 5: Vérifier la syntaxe**

Run: `node --check media/error_math.js`
Expected: aucune sortie (OK).

- [ ] **Step 6: Commit**

```bash
git add media/error_math.js test/test_error_curves.js
git commit -m "feat(erreur): formules d'erreur (signee/abs/rel/rel%) + garde-fou EPS"
```

---

### Task 3: `buildErrorSeries` (tri + interpolation + erreur point par point)

**Files:**
- Modify: `media/error_math.js`
- Modify: `test/test_error_curves.js`

**Interfaces:**
- Consumes: `interpLinear`, `computeError`, `EPS`.
- Produces: `buildErrorSeries(typeId, xRef, yRef, xI, yI, opts) -> { x: Array<number>, y: Array<number|null> }`. Trie `(xI, yI)` par x croissant, interpole sur `xRef`, applique `computeError` point par point. `opts.eps` optionnel (défaut `EPS`). `x` est une copie de `xRef`.

- [ ] **Step 1: Ajouter les tests (échec attendu)**

Ajouter dans `test/test_error_curves.js` avant le `console.log` final :

```js
// --- buildErrorSeries ---
check("buildErrorSeries: grilles identiques, difference signee", function () {
  const s = EM.buildErrorSeries("signed", [0, 1, 2], [0, 10, 20], [0, 1, 2], [0, 12, 19]);
  assert.deepStrictEqual(s.x, [0, 1, 2]);
  assert.deepStrictEqual(s.y, [0, 2, -1]);
});
check("buildErrorSeries: grille cible plus fine, interpole", function () {
  // ref aux x 0,2 ; cible echantillonnee 0,1,2,3,4 -> valeur a x=2 interpolee
  const s = EM.buildErrorSeries("signed", [0, 2], [0, 0], [0, 1, 2, 3, 4], [0, 5, 10, 15, 20]);
  assert.ok(Math.abs(s.y[0] - 0) < 1e-9);
  assert.ok(Math.abs(s.y[1] - 10) < 1e-9);
});
check("buildErrorSeries: cible non triee est triee avant interpolation", function () {
  const s = EM.buildErrorSeries("signed", [1], [0], [2, 0], [20, 0]);
  assert.ok(Math.abs(s.y[0] - 10) < 1e-9, "attendu 10, recu " + s.y[0]);
});
check("buildErrorSeries: recouvrement partiel -> trous (null)", function () {
  // cible couvre [1,2] ; ref demande x=0 (hors) et x=1.5 (dedans)
  const s = EM.buildErrorSeries("signed", [0, 1.5], [0, 0], [1, 2], [10, 20]);
  assert.strictEqual(s.y[0], null);
  assert.ok(Math.abs(s.y[1] - 15) < 1e-9);
});
check("buildErrorSeries: axe date (timestamps) fonctionne", function () {
  const t0 = Date.parse("2020-01-01"), t1 = Date.parse("2020-01-02");
  const s = EM.buildErrorSeries("signed", [t0, t1], [1, 2], [t0, t1], [1, 5]);
  assert.deepStrictEqual(s.y, [0, 3]);
});
check("buildErrorSeries: NaN cible propage en null", function () {
  const s = EM.buildErrorSeries("abs", [0, 1], [0, 0], [0, 1], [NaN, 4]);
  assert.strictEqual(s.y[0], null);
  assert.strictEqual(s.y[1], 4);
});
```

- [ ] **Step 2: Lancer le test, vérifier l'échec**

Run: `node test/test_error_curves.js`
Expected: les `buildErrorSeries` échouent (`EM.buildErrorSeries is not a function`).

- [ ] **Step 3: Implémenter dans `media/error_math.js`**

Avant le `return { ... }` final, ajouter :

```js
  function buildErrorSeries(typeId, xRef, yRef, xI, yI, opts) {
    const eps = (opts && opts.eps != null) ? opts.eps : EPS;
    const pairs = [];
    for (let k = 0; k < xI.length; k++) { pairs.push([xI[k], yI[k]]); }
    pairs.sort(function (a, b) { return a[0] - b[0]; });
    const xs = pairs.map(function (p) { return p[0]; });
    const ys = pairs.map(function (p) { return p[1]; });
    const yiOnRef = interpLinear(xRef, xs, ys);
    const ey = new Array(xRef.length);
    for (let k = 0; k < xRef.length; k++) {
      ey[k] = computeError(typeId, yRef[k], yiOnRef[k], eps);
    }
    return { x: xRef.slice(), y: ey };
  }
```

Et ajouter `buildErrorSeries: buildErrorSeries,` dans l'objet de retour.

- [ ] **Step 4: Lancer le test, vérifier le succès**

Run: `node test/test_error_curves.js`
Expected: tous les tests passent, exit 0.

- [ ] **Step 5: Vérifier la syntaxe**

Run: `node --check media/error_math.js`
Expected: aucune sortie (OK).

- [ ] **Step 6: Commit**

```bash
git add media/error_math.js test/test_error_curves.js
git commit -m "feat(erreur): buildErrorSeries (tri + interpolation + erreur point a point)"
```

---

### Task 4: Brancher `error_math.js` dans le webview

**Files:**
- Modify: `extension.js:526-540` (fonction `webviewHtml`)
- Modify: `media/panel.html:6` (balise script)

**Interfaces:**
- Consumes: le module `media/error_math.js` (Task 1-3).
- Produces: `self.ErrorMath` disponible dans le webview avant le script principal.

- [ ] **Step 1: Ajouter la substitution `{{errorMathUri}}` dans `extension.js`**

Dans `webviewHtml`, après le bloc `plotlyUri` (vers `extension.js:528`), ajouter :

```js
  const errorMathUri = webview.asWebviewUri(
    vscode.Uri.file(path.join(extContext.extensionPath, "media", "error_math.js"))
  );
```

Puis dans la chaîne de `.replace(...)` (vers `extension.js:540`), ajouter une ligne après le `replace` de `{{plotlyUri}}` :

```js
      .replace(/{{plotlyUri}}/g, String(plotlyUri))
      .replace(/{{errorMathUri}}/g, String(errorMathUri));
```

(Retirer le `;` de la ligne `{{plotlyUri}}` existante puisqu'elle n'est plus la dernière.)

- [ ] **Step 2: Ajouter la balise script dans `media/panel.html`**

Juste après la ligne 6 (`<script src="{{plotlyUri}}"></script>`), ajouter :

```html
<script src="{{errorMathUri}}"></script>
```

(Pas de changement CSP : `{{cspSource}}` couvre déjà les scripts servis par le webview, comme Plotly.)

- [ ] **Step 3: Vérifier la syntaxe de l'extension**

Run: `node --check extension.js`
Expected: aucune sortie (OK).

- [ ] **Step 4: Vérification manuelle dans l'Extension Development Host**

1. Ouvrir le dossier dans VS Code, F5 (« Run Extension »).
2. Dans la fenêtre de dev, ouvrir un **nouveau terminal**, lancer `python test/test_plots.py`.
3. Ouvrir les outils de développement du webview (Command Palette → « Developer: Open Webview Developer Tools ») et taper `ErrorMath` dans la console.
Expected: un objet avec `interpLinear`, `computeError`, `buildErrorSeries`, `ERROR_TYPES`, `EPS`.

- [ ] **Step 5: Commit**

```bash
git add extension.js media/panel.html
git commit -m "feat(erreur): charge error_math.js dans le webview (uri + balise script)"
```

---

### Task 5: Aplatissement des courbes + contrôles UI « Erreur »

**Files:**
- Modify: `media/panel.html` (barre de l'overlay `compareOverlay` ~ lignes 243-253 ; styles ~ ligne 173 « Comparaison » ; script `compareLabel`/`mergedPlotlyFigure` ~ lignes 793-852)

**Interfaces:**
- Consumes: `self.ErrorMath`, `compareLabel(index)`, `canMergePlotly(fig)`, `figStore`, `selectedForCompare`.
- Produces (fonctions internes au script du webview) :
  - `numericX(values) -> Array<number>` — convertit des x (nombres ou dates ISO) en nombres.
  - `flattenCurves(figs) -> Array<{ key, letter, name, color, x:Array<number>, y:Array<number> }>` — aplatit toutes les traces `scatter` des figures, lettres `A,B,C…` via `compareLabel(globalIndex)`.
  - État module : `errorState = { active:false, refKey:null, types:[] }`.
  - `updateErrorButton(figs)` — active/désactive le bouton selon éligibilité (`figs.every(canMergePlotly)` et ≥ 2 courbes scatter).

- [ ] **Step 1: Ajouter le bouton et le panneau de réglages dans la barre de `compareOverlay`**

Dans `media/panel.html`, dans l'`<div class="obar">` de `compareOverlay` (après le bouton `compareClose`, ~ ligne 251), ajouter un bouton et un panneau caché :

```html
      <button id="errorToggle" class="compact" disabled title="Disponible uniquement en superposition interactive (Plotly) avec au moins 2 courbes">Erreur</button>
```

Et juste après la `<div class="obar">` de `compareOverlay`, avant `<div class="compare-body">`, ajouter le panneau :

```html
    <div class="error-panel" id="errorPanel" style="display:none">
      <label>Reference :
        <select id="errorRef"></select>
      </label>
      <span class="error-types">
        <label><input type="checkbox" class="error-type" value="signed"> Difference signee</label>
        <label><input type="checkbox" class="error-type" value="abs"> Erreur absolue</label>
        <label><input type="checkbox" class="error-type" value="rel"> Erreur relative</label>
        <label><input type="checkbox" class="error-type" value="relpct"> Erreur relative %</label>
      </span>
      <button id="errorApply" class="compact">Appliquer</button>
      <button id="errorHide" class="compact">Masquer</button>
      <span class="error-warn" id="errorWarn"></span>
    </div>
```

- [ ] **Step 2: Ajouter les styles**

Dans le bloc `<style>`, sous la section « Comparaison » (~ ligne 173), ajouter :

```css
  .error-panel{
    display:flex; align-items:center; gap:12px; flex-wrap:wrap;
    padding:6px 14px; font-size:12px;
    background: var(--vscode-sideBar-background, #252526);
    border-bottom:1px solid var(--vscode-panel-border, #3c3c3c);
  }
  .error-panel .error-types{ display:flex; gap:10px; flex-wrap:wrap; }
  .error-panel select{ margin-left:4px; }
  .error-warn{ color: var(--vscode-charts-yellow, #cca700); font-size:11px; }
```

- [ ] **Step 3: Ajouter les helpers et références DOM dans le script**

Dans le `<script nonce="{{nonce}}">`, près des autres `const ... = document.getElementById(...)` (~ ligne 264), ajouter :

```js
  const errorToggle = document.getElementById("errorToggle");
  const errorPanel = document.getElementById("errorPanel");
  const errorRef = document.getElementById("errorRef");
  const errorApply = document.getElementById("errorApply");
  const errorHide = document.getElementById("errorHide");
  const errorWarn = document.getElementById("errorWarn");
  let errorState = { active: false, refKey: null, types: [] };
```

Et près de `compareLabel`/`mergedPlotlyFigure` (~ ligne 793), ajouter :

```js
  function numericX(values){
    return values.map(function(v){
      if (typeof v === "number"){ return v; }
      const t = Date.parse(v);
      return isNaN(t) ? Number(v) : t;
    });
  }

  function flattenCurves(figs){
    const curves = [];
    let idx = 0;
    figs.forEach(function(fig){
      (fig.plotly && fig.plotly.data ? fig.plotly.data : []).forEach(function(trace){
        const type = trace.type || "scatter";
        if (type !== "scatter"){ return; } // barres exclues du calcul
        const color = (trace.line && trace.line.color) ||
                      (trace.marker && trace.marker.color) || null;
        curves.push({
          key: "c" + idx,
          letter: compareLabel(idx),
          name: trace.name || ("courbe " + (idx + 1)),
          color: color,
          x: numericX(trace.x || []),
          y: (trace.y || []).map(Number)
        });
        idx++;
      });
    });
    return curves;
  }

  function updateErrorButton(figs){
    const mergeable = figs.length >= 2 && figs.every(canMergePlotly);
    const enough = mergeable && flattenCurves(figs).length >= 2;
    errorToggle.disabled = !enough;
  }
```

- [ ] **Step 4: Remplir le menu Référence et gérer l'affichage du panneau**

Toujours dans le script, ajouter :

```js
  function populateErrorRef(curves){
    errorRef.innerHTML = "";
    curves.forEach(function(c){
      const opt = document.createElement("option");
      opt.value = c.key;
      opt.textContent = c.letter + " - " + c.name;
      errorRef.appendChild(opt);
    });
    if (curves.length){ errorRef.value = curves[0].key; }
  }

  function openErrorPanel(){
    const figs = selectedForCompare.map(function(id){ return figStore[id]; }).filter(Boolean);
    populateErrorRef(flattenCurves(figs));
    errorWarn.textContent = "";
    errorPanel.style.display = "flex";
  }

  errorToggle.addEventListener("click", function(){
    if (errorPanel.style.display === "none"){ openErrorPanel(); }
    else { errorPanel.style.display = "none"; }
  });
```

- [ ] **Step 5: Appeler `updateErrorButton` à l'ouverture de la superposition**

Dans `openCompare`, dans la branche `else if (figs.every(canMergePlotly))` (~ ligne 898, mode Plotly fusionnable), après `compareBody.appendChild(stack);`, ajouter :

```js
      updateErrorButton(figs);
```

Et au début de `closeCompare` (~ ligne 925), réinitialiser :

```js
    errorState = { active: false, refKey: null, types: [] };
    errorPanel.style.display = "none";
    errorToggle.disabled = true;
```

- [ ] **Step 6: Vérification manuelle (dev host)**

1. F5, nouveau terminal, `python test/test_plots.py` puis un script qui trace ≥ 2 courbes (ex. `test/test_stress.py`).
2. Cocher ≥ 2 figures, cliquer « Superposer ».
Expected: le bouton « Erreur » est **actif** ; le cliquer affiche le panneau avec le menu Référence rempli (A, B, …) et les 4 cases. Avec une figure en repli image, le bouton reste **désactivé**.

- [ ] **Step 7: Commit**

```bash
git add media/panel.html
git commit -m "feat(erreur): bouton + panneau de reglages, aplatissement des courbes"
```

---

### Task 6: Construire la figure avec sous-graphe d'erreur + appliquer/masquer

**Files:**
- Modify: `media/panel.html` (script : nouvelle `mergedPlotlyFigureWithErrors`, câblage `errorApply`/`errorHide`)

**Interfaces:**
- Consumes: `flattenCurves`, `mergedPlotlyFigure`, `ErrorMath.buildErrorSeries`, `ERROR_TYPES`, `renderPlotly`, `compareBody`, `errorState`.
- Produces: `mergedPlotlyFigureWithErrors(figs, refKey, typeIds) -> { id, title, plotly }` et le re-rendu du div `.compare-plot` à l'Appliquer.

- [ ] **Step 1: Implémenter `mergedPlotlyFigureWithErrors`**

Dans le script, après `mergedPlotlyFigure` (~ ligne 852), ajouter :

```js
  function mergedPlotlyFigureWithErrors(figs, refKey, typeIds){
    const base = mergedPlotlyFigure(figs);      // superposition sur (x, y)
    const layout = base.plotly.layout;
    const curves = flattenCurves(figs);
    const ref = curves.filter(function(c){ return c.key === refKey; })[0] || curves[0];

    // Panneau du haut (superposition) reduit ; panneau du bas (erreurs).
    layout.yaxis = Object.assign({}, layout.yaxis, { domain: [0.32, 1] });
    layout.yaxis2 = {
      domain: [0, 0.26], anchor: "x",
      title: { text: allRelPct(typeIds) ? "erreur (%)" : "erreur" },
      zeroline: true
    };
    layout.shapes = [{
      type: "line", xref: "paper", x0: 0, x1: 1,
      yref: "y2", y0: 0, y1: 0,
      line: { color: "rgba(150,150,150,0.6)", width: 1, dash: "dot" }
    }];

    const data = base.plotly.data;
    const ignored = [];
    curves.forEach(function(c){
      if (c.key === ref.key){ return; }
      typeIds.forEach(function(typeId){
        const series = ErrorMath.buildErrorSeries(typeId, ref.x, ref.y, c.x, c.y);
        if (series.y.every(function(v){ return v === null; })){
          if (ignored.indexOf(c.letter) === -1){ ignored.push(c.letter); }
          return;
        }
        const meta = ErrorMath.ERROR_TYPES[typeId];
        data.push({
          type: "scatter", mode: "lines",
          x: series.x, y: series.y,
          xaxis: "x", yaxis: "y2",
          connectgaps: false,
          line: c.color ? { color: c.color } : {},
          name: c.letter + "−" + ref.letter + " : " + c.name + " (" + meta.abbr + ")"
        });
      });
    });
    base._ignored = ignored;
    return base;
  }

  function allRelPct(typeIds){
    return typeIds.length > 0 && typeIds.every(function(t){ return t === "relpct"; });
  }
```

- [ ] **Step 2: Câbler Appliquer / Masquer**

Après les listeners ajoutés en Task 5, ajouter :

```js
  function currentComparePlotEl(){
    return compareBody.querySelector(".compare-plot");
  }

  errorApply.addEventListener("click", function(){
    const figs = selectedForCompare.map(function(id){ return figStore[id]; }).filter(Boolean);
    const types = Array.prototype.slice
      .call(document.querySelectorAll(".error-type:checked"))
      .map(function(cb){ return cb.value; });
    if (types.length === 0){ errorWarn.textContent = "Cochez au moins un type d'erreur."; return; }
    const el = currentComparePlotEl();
    if (!el){ return; }
    errorState = { active: true, refKey: errorRef.value, types: types };
    const merged = mergedPlotlyFigureWithErrors(figs, errorState.refKey, types);
    Plotly.purge(el);
    renderPlotly(el, merged, true, null);
    Plotly.Plots.resize(el);
    errorWarn.textContent = (merged._ignored && merged._ignored.length)
      ? "Sans recouvrement X, ignorees : " + merged._ignored.join(", ")
      : "";
  });

  errorHide.addEventListener("click", function(){
    const figs = selectedForCompare.map(function(id){ return figStore[id]; }).filter(Boolean);
    const el = currentComparePlotEl();
    if (!el){ return; }
    errorState = { active: false, refKey: null, types: [] };
    errorWarn.textContent = "";
    const merged = mergedPlotlyFigure(figs);
    Plotly.purge(el);
    renderPlotly(el, merged, true, null);
    Plotly.Plots.resize(el);
  });
```

- [ ] **Step 3: Vérification manuelle (dev host) — cas nominal**

1. F5, nouveau terminal, lancer un script traçant 3–4 courbes sur une plage X commune (par ex. plusieurs `plt.plot(x, f_i(x))` puis `plt.show()`).
2. Cocher les figures → « Superposer » → « Erreur » → choisir réf A, cocher « Différence signée » + « Erreur relative % » → « Appliquer ».
Expected: panneau du haut = superposition ; panneau du bas = courbes d'erreur étiquetées `B−A : <nom> (diff)`, `B−A : <nom> (rel %)`, etc. ; ligne `y=0` pointillée ; zoom X synchronisé entre les deux panneaux ; « Masquer » revient à la superposition simple.

- [ ] **Step 4: Vérification manuelle — cas dégradé (recouvrement partiel)**

Tracer deux courbes sur des plages X disjointes ou partiellement recouvrantes, superposer, Erreur, Appliquer.
Expected: la courbe d'erreur est coupée hors recouvrement (trous) ; si aucun recouvrement, la courbe est ignorée et `errorWarn` liste sa lettre.

- [ ] **Step 5: Commit**

```bash
git add media/panel.html
git commit -m "feat(erreur): sous-graphe residuel (2 axes Y empiles) + appliquer/masquer"
```

---

### Task 7: Documentation

**Files:**
- Modify: `README.md` (section « Nouveautés » et « Fonctionnalités »)
- Modify: `CLAUDE.md` (note sur la comparaison/erreur, si pertinent)

**Interfaces:** aucune.

- [ ] **Step 1: Mettre à jour `README.md`**

Dans la liste « Fonctionnalités », sous la puce « Comparaison », ajouter :

```markdown
- **Erreur entre courbes** : en superposition, bouton « Erreur » pour tracer
  l'écart de N courbes par rapport à une référence choisie (différence signée,
  absolue, relative, relative %), dans un sous-graphe lié à axe X partagé.
  Interpolation linéaire sur la grille de la référence ; courbes non
  superposables en Plotly (repli image) exclues.
```

Et dans « Tests », sous la commande `test_convert.py`, ajouter :

```markdown
node test/test_error_curves.js   # calcul d'erreur entre courbes (assertions)
```

- [ ] **Step 2: Ajouter une note dans `CLAUDE.md`**

Dans la section décrivant `media/panel.html`, ajouter une phrase :

```markdown
Le calcul d'erreur entre courbes (bouton « Erreur » en superposition) vit dans
`media/error_math.js` (module pur, wrapper UMD : `self.ErrorMath` dans le
webview, `require` sous Node), testé par `test/test_error_curves.js`. La glue
Plotly (aplatissement des traces, sous-graphe résiduel à 2 axes Y empilés)
reste dans `panel.html`.
```

- [ ] **Step 3: Vérifier l'ensemble une dernière fois**

Run: `node test/test_error_curves.js && node --check media/error_math.js && node --check extension.js`
Expected: tests passent, pas d'erreur de syntaxe.

- [ ] **Step 4: Commit**

```bash
git add README.md CLAUDE.md
git commit -m "docs(erreur): documente l'erreur entre courbes (README + CLAUDE)"
```

---

## Notes d'implémentation

- **DRY** : `mergedPlotlyFigureWithErrors` réutilise `mergedPlotlyFigure` pour la superposition de base, puis ajoute seulement les axes/traces d'erreur.
- **YAGNI** : pas de tableau de stats (RMS/max), pas de barres, pas d'interpolation spline — voir « Hors périmètre » de la spec.
- **Tests** : seul le cœur de calcul (`error_math.js`) est testé en automatique ; la glue Plotly/DOM se vérifie dans l'Extension Development Host (pas de runner DOM dans ce projet, conforme à l'existant).
