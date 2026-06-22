# Redimensionnement + PDF encart/erreurs/comparaison + sélection d'erreur au clic — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corriger le redimensionnement de la vue liste, inclure l'encart/erreurs/comparaison dans les PDF (via un PDF raster généré côté webview), donner à l'overlay comparaison la barre d'export complète, et permettre la sélection au clic des courbes en mode erreur.

**Architecture:** L'extension reste sans build ni dépendance. Un nouveau module pur UMD `media/pdf_export.js` assemble un PDF minimal raster (testé sous Node). La glue navigateur (`panel.html`) prépare les octets image (`Plotly.toImage` → canvas → `CompressionStream`) et route les sauvegardes ; `extension.js` écrit les fichiers. Le mode erreur passe d'un menu déroulant à une sélection au clic via `Plotly.restyle`.

**Tech Stack:** JavaScript pur (Node pour l'extension + tests, Chromium/webview pour la glue), Plotly.js bundlé, matplotlib (backend Python, inchangé ici).

## Global Constraints

- Langue de travail **française** : UI, commentaires, messages de commit, descriptions de config (préfixe `chazPlots.*` / `spyderPlots.*`). Copié verbatim de la spec.
- **Aucune nouvelle dépendance** ni étape de build ; pas de `npm install`. Le webview n'a pas de `connect-src` (CSP) : décoder le base64 directement, pas de `fetch`.
- Modules purs en **UMD** : `self.X` côté webview, `require` sous Node ; chaque module a son harnais Node dédié ; son URI doit être injectée dans `extension.js:webviewHtml()`, déclarée comme placeholder dans `media/panel.html` **et** ajoutée à `test/check_panel_html.js`.
- Contrat `/figure` JSON et protocole `postMessage` : changer un côté impose de changer l'autre.
- Vérification JS : `node --check <fichier>` ; garde-fou webview : `node test/check_panel_html.js`.

---

### Task 1: Redimensionnement de la vue liste (ResizeObserver)

**Files:**
- Modify: `media/panel.html` (fonction `renderPlotly`, branche `else` liste ~ligne 1605 ; écouteur `window.addEventListener("resize", …)` ~ligne 1665)

**Interfaces:**
- Consumes: `listPlotHeight(el, fig)`, `positionInsetOverlay(el)`, `listPlots` (déjà présents).
- Produces: chaque graphe de la liste possède un `ResizeObserver` stocké dans `el._spListRO`, déconnecté au retrait du DOM.

Contexte : la vue liste ne réagit qu'à `window resize` et ne recalcule que la hauteur ; la largeur (autosize Plotly) ne suit pas lors d'un changement d'écran / maximisation, et une mesure à largeur 0 (panneau masqué) fige une taille minuscule. On bascule sur un `ResizeObserver` par graphe, comme l'overlay comparaison (`ovResizeObserver`).

- [ ] **Step 1: Brancher un ResizeObserver à la création du graphe liste**

Dans `renderPlotly`, branche liste (le `else` qui fait `layout.height = listPlotHeight(el, fig); listPlots.push(...)`), remplacer par :

```js
    } else {
      layout.height = listPlotHeight(el, fig);
      listPlots.push({ el: el, fig: fig });
      // Redimensionnement fiable (changement d'ecran, maximisation, affichage
      // du panneau) : un ResizeObserver par graphe recalcule largeur ET hauteur.
      // Garde-fou largeur 0 (panneau masque) pour ne pas figer une taille minuscule.
      if (typeof ResizeObserver !== "undefined" && !el._spListRO){
        let roTimer = null;
        el._spListRO = new ResizeObserver(function(){
          if (roTimer){ clearTimeout(roTimer); }
          roTimer = setTimeout(function(){
            if (!document.body.contains(el)){
              try { el._spListRO.disconnect(); } catch (e) {}
              return;
            }
            if (!el.clientWidth){ return; }   // panneau masque : pas de mesure parasite
            try {
              Plotly.Plots.resize(el);
              Plotly.relayout(el, { height: listPlotHeight(el, fig) }).then(function(){
                if (el._spHasInset){ positionInsetOverlay(el); }
              }).catch(function(){});
            } catch (e) {}
          }, 120);
        });
        el._spListRO.observe(el.parentElement || el);
      }
    }
```

- [ ] **Step 2: Déconnecter l'observer au retrait de la carte**

Dans `removeCard(id)` (la fonction qui `Plotly.purge` le plot ~ligne 2497), ajouter la déconnexion avant le purge :

```js
      if (figStore[id] && figStore[id].plotly){
        const elToFree = document.getElementById("plot-" + id);
        if (elToFree && elToFree._spListRO){
          try { elToFree._spListRO.disconnect(); } catch (e) {}
          elToFree._spListRO = null;
        }
        try { Plotly.purge(document.getElementById("plot-" + id)); } catch (e) {}
      }
```

- [ ] **Step 3: Vérifier la syntaxe**

Run: `node --check media/panel.html` n'existe pas (HTML). À la place, vérifier le garde-fou structurel :
Run: `node test/check_panel_html.js`
Expected: `OK check_panel_html : … placeholders, … ids.`

- [ ] **Step 4: Vérification manuelle (Extension Development Host)**

Ouvrir le dossier dans VS Code, F5, puis dans un terminal neuf du dev host : `python test/test_plots.py`. Déplacer la fenêtre entre deux écrans, maximiser/restaurer, masquer/réafficher le panneau Graphes. Attendu : la largeur du graphe suit toujours, aucune image rétrécie persistante.

- [ ] **Step 5: Commit**

```bash
git add media/panel.html
git commit -m "fix(webview): redimensionnement fiable de la vue liste via ResizeObserver"
```

---

### Task 2: Module pur `PdfExport` (PDF raster minimal) + test

**Files:**
- Create: `media/pdf_export.js`
- Test: `test/test_pdf_export.js`

**Interfaces:**
- Produces:
  - `PdfExport.buildPdf({ imageBytes: Uint8Array, pixelWidth: number, pixelHeight: number, pageWidth?: number, pageHeight?: number, filter: "FlateDecode"|"DCTDecode", colorComponents?: 1|3 }) -> Uint8Array` — PDF 1.4 d'une page, image plein cadre. `imageBytes` est le flux **déjà compressé** (zlib pour FlateDecode, JPEG pour DCTDecode). `pageWidth/Height` en points (défaut = pixels).
  - `PdfExport.asciiBytes(str) -> Uint8Array`, `PdfExport.concatBytes(chunks) -> Uint8Array` (utilitaires exposés pour la glue/tests).

- [ ] **Step 1: Écrire le test qui échoue**

Create `test/test_pdf_export.js` :

```js
// Harnais de test sans dependance pour media/pdf_export.js
// Lancer : node test/test_pdf_export.js
"use strict";
const assert = require("assert");
const PdfExport = require("../media/pdf_export.js");

let passed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log("ok   - " + name); }
  catch (e) { console.error("FAIL - " + name + " : " + e.message); process.exitCode = 1; }
}

function toLatin1(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i++) { s += String.fromCharCode(bytes[i]); }
  return s;
}

const img = new Uint8Array([1, 2, 3, 4, 5]);

check("buildPdf: en-tete %PDF et fin %%EOF", function () {
  const pdf = PdfExport.buildPdf({ imageBytes: img, pixelWidth: 2, pixelHeight: 3, filter: "FlateDecode" });
  const s = toLatin1(pdf);
  assert.ok(s.indexOf("%PDF-1.4") === 0, "en-tete manquante");
  assert.ok(s.indexOf("%%EOF") !== -1, "%%EOF manquant");
});

check("buildPdf: MediaBox = pageWidth/pageHeight en points", function () {
  const pdf = PdfExport.buildPdf({ imageBytes: img, pixelWidth: 2, pixelHeight: 3,
    pageWidth: 120, pageHeight: 90, filter: "FlateDecode" });
  const s = toLatin1(pdf);
  assert.ok(s.indexOf("/MediaBox [0 0 120 90]") !== -1, "MediaBox incorrect : " + s.slice(0, 400));
});

check("buildPdf: Width/Height image = pixels", function () {
  const pdf = PdfExport.buildPdf({ imageBytes: img, pixelWidth: 7, pixelHeight: 11, filter: "FlateDecode" });
  const s = toLatin1(pdf);
  assert.ok(/\/Width 7 \/Height 11/.test(s), "dimensions image incorrectes");
});

check("buildPdf: filtre FlateDecode + DeviceRGB par defaut", function () {
  const pdf = PdfExport.buildPdf({ imageBytes: img, pixelWidth: 2, pixelHeight: 2, filter: "FlateDecode" });
  const s = toLatin1(pdf);
  assert.ok(s.indexOf("/Filter /FlateDecode") !== -1, "filtre attendu FlateDecode");
  assert.ok(s.indexOf("/ColorSpace /DeviceRGB") !== -1, "espace couleur attendu DeviceRGB");
});

check("buildPdf: filtre DCTDecode quand demande", function () {
  const pdf = PdfExport.buildPdf({ imageBytes: img, pixelWidth: 2, pixelHeight: 2, filter: "DCTDecode" });
  assert.ok(toLatin1(pdf).indexOf("/Filter /DCTDecode") !== -1, "filtre attendu DCTDecode");
});

check("buildPdf: DeviceGray quand colorComponents=1", function () {
  const pdf = PdfExport.buildPdf({ imageBytes: img, pixelWidth: 2, pixelHeight: 2,
    filter: "FlateDecode", colorComponents: 1 });
  assert.ok(toLatin1(pdf).indexOf("/ColorSpace /DeviceGray") !== -1, "espace couleur attendu DeviceGray");
});

check("buildPdf: startxref pointe sur la table xref", function () {
  const pdf = PdfExport.buildPdf({ imageBytes: img, pixelWidth: 2, pixelHeight: 2, filter: "FlateDecode" });
  const s = toLatin1(pdf);
  const xrefPos = s.lastIndexOf("\nxref\n") + 1;       // index du 'x' de "xref"
  const m = /startxref\s+(\d+)/.exec(s);
  assert.ok(m, "startxref absent");
  assert.strictEqual(Number(m[1]), xrefPos, "startxref ne pointe pas sur xref");
});

check("buildPdf: le flux image binaire est present tel quel", function () {
  const pdf = PdfExport.buildPdf({ imageBytes: img, pixelWidth: 2, pixelHeight: 2, filter: "FlateDecode" });
  // cherche la sous-sequence 1,2,3,4,5 dans les octets
  let found = -1;
  for (let i = 0; i + img.length <= pdf.length; i++) {
    let ok = true;
    for (let j = 0; j < img.length; j++) { if (pdf[i + j] !== img[j]) { ok = false; break; } }
    if (ok) { found = i; break; }
  }
  assert.ok(found !== -1, "flux image introuvable dans le PDF");
});

console.log("\n" + passed + " tests OK");
```

- [ ] **Step 2: Lancer le test pour confirmer l'échec**

Run: `node test/test_pdf_export.js`
Expected: FAIL — `Cannot find module '../media/pdf_export.js'`.

- [ ] **Step 3: Écrire le module**

Create `media/pdf_export.js` :

```js
// ============================================================
// pdf_export.js
// Assemble un PDF 1.4 minimal d'une page contenant une image plein cadre
// (raster). Sert aux sauvegardes "depuis le webview" (encart, erreurs,
// comparaison) ou le rendu PDF matplotlib natif ne s'applique pas.
// Charge dans le webview (self.PdfExport) et sous Node (require). Aucune
// dependance : assemblage octet par octet (Uint8Array), compatible binaire.
// Le flux image fourni est DEJA compresse (zlib -> FlateDecode, JPEG -> DCTDecode).
// ============================================================
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) { module.exports = api; }
  else { root.PdfExport = api; }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // Chaine ASCII/Latin1 -> octets (un octet par caractere).
  function asciiBytes(str) {
    const out = new Uint8Array(str.length);
    for (let i = 0; i < str.length; i++) { out[i] = str.charCodeAt(i) & 0xff; }
    return out;
  }

  // Concatene une liste de Uint8Array.
  function concatBytes(chunks) {
    let total = 0;
    for (let i = 0; i < chunks.length; i++) { total += chunks[i].length; }
    const out = new Uint8Array(total);
    let off = 0;
    for (let i = 0; i < chunks.length; i++) { out.set(chunks[i], off); off += chunks[i].length; }
    return out;
  }

  // Offset xref sur 10 chiffres (entree de table xref de 20 octets).
  function pad10(n) {
    let s = String(n);
    while (s.length < 10) { s = "0" + s; }
    return s;
  }

  function buildPdf(opts) {
    const o = opts || {};
    const img = o.imageBytes || new Uint8Array(0);
    const pw = Math.max(1, Math.round(o.pixelWidth || 1));
    const ph = Math.max(1, Math.round(o.pixelHeight || 1));
    const pageW = Number((o.pageWidth || pw).toFixed(2));
    const pageH = Number((o.pageHeight || ph).toFixed(2));
    const filter = o.filter === "DCTDecode" ? "DCTDecode" : "FlateDecode";
    const cs = (o.colorComponents === 1) ? "/DeviceGray" : "/DeviceRGB";

    const chunks = [];
    let length = 0;
    const offsets = [0];   // objet 0 (entree libre)

    function push(bytes) { chunks.push(bytes); length += bytes.length; }
    function pushStr(s) { push(asciiBytes(s)); }
    function startObj() { offsets.push(length); }

    pushStr("%PDF-1.4\n");

    startObj();
    pushStr("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");

    startObj();
    pushStr("2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n");

    startObj();
    pushStr(
      "3 0 obj\n<< /Type /Page /Parent 2 0 R " +
      "/MediaBox [0 0 " + pageW + " " + pageH + "] " +
      "/Resources << /XObject << /Im0 4 0 R >> >> " +
      "/Contents 5 0 R >>\nendobj\n"
    );

    startObj();
    pushStr(
      "4 0 obj\n<< /Type /XObject /Subtype /Image " +
      "/Width " + pw + " /Height " + ph + " " +
      "/ColorSpace " + cs + " /BitsPerComponent 8 " +
      "/Filter /" + filter + " /Length " + img.length + " >>\nstream\n"
    );
    push(img);
    pushStr("\nendstream\nendobj\n");

    const content = "q " + pageW + " 0 0 " + pageH + " 0 0 cm /Im0 Do Q\n";
    const contentBytes = asciiBytes(content);
    startObj();
    pushStr("5 0 obj\n<< /Length " + contentBytes.length + " >>\nstream\n");
    push(contentBytes);
    pushStr("endstream\nendobj\n");

    const xrefOffset = length;
    pushStr("xref\n0 6\n");
    pushStr("0000000000 65535 f \n");
    for (let i = 1; i <= 5; i++) { pushStr(pad10(offsets[i]) + " 00000 n \n"); }
    pushStr("trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n" + xrefOffset + "\n%%EOF\n");

    return concatBytes(chunks);
  }

  return { buildPdf: buildPdf, asciiBytes: asciiBytes, concatBytes: concatBytes };
});
```

- [ ] **Step 4: Lancer le test pour confirmer le succès**

Run: `node test/test_pdf_export.js`
Expected: tous `ok` + `8 tests OK`.

- [ ] **Step 5: Vérifier la syntaxe du module**

Run: `node --check media/pdf_export.js`
Expected: aucune sortie (OK).

- [ ] **Step 6: Commit**

```bash
git add media/pdf_export.js test/test_pdf_export.js
git commit -m "feat(pdf): module pur PdfExport (PDF raster minimal) + tests"
```

---

### Task 3: Enregistrer l'URI de `pdf_export.js` dans le webview

**Files:**
- Modify: `extension.js` (`webviewHtml`, ~lignes 700-725)
- Modify: `media/panel.html` (en-tête `<script>`, à côté des autres modules ~ligne 7)
- Modify: `test/check_panel_html.js` (tableau `placeholders`)

**Interfaces:**
- Consumes: motif d'injection d'URI existant (`bundleMetaUri`, etc.).
- Produces: placeholder `{{pdfExportUri}}` disponible dans `panel.html` ; `self.PdfExport` chargé dans le webview.

- [ ] **Step 1: Injecter l'URI dans `extension.js`**

Dans `webviewHtml`, après le bloc `figureFilterUri` (~ligne 703-705), ajouter :

```js
  const pdfExportUri = webview.asWebviewUri(
    vscode.Uri.file(path.join(extContext.extensionPath, "media", "pdf_export.js"))
  );
```

Puis dans la chaîne de `.replace(...)`, après `.replace(/{{figureFilterUri}}/g, String(figureFilterUri))`, ajouter :

```js
      .replace(/{{pdfExportUri}}/g, String(pdfExportUri));
```

(déplacer le `;` : la ligne `figureFilterUri` se termine alors par une virgule de chaînage `.replace(...)` — vérifier que `.replace` reste chaîné. Concrètement : retirer le `;` final de la ligne `figureFilterUri` et l'apposer après la nouvelle ligne `pdfExportUri`.)

- [ ] **Step 2: Déclarer le script dans `panel.html`**

Près des autres `<script src="…">` (ligne 7, `errorMathUri`), ajouter :

```html
<script src="{{pdfExportUri}}"></script>
```

- [ ] **Step 3: Ajouter le placeholder au garde-fou**

Dans `test/check_panel_html.js`, tableau `placeholders`, ajouter `"{{pdfExportUri}}"` :

```js
const placeholders = [
  "{{nonce}}", "{{cspSource}}", "{{plotlyUri}}",
  "{{errorMathUri}}", "{{insetLayoutUri}}", "{{plotNavUri}}",
  "{{measureMathUri}}", "{{csvExportUri}}", "{{compareUtilUri}}",
  "{{bundleMetaUri}}", "{{figureFilterUri}}", "{{pdfExportUri}}",
];
```

- [ ] **Step 4: Vérifier**

Run: `node --check extension.js && node test/check_panel_html.js`
Expected: pas d'erreur de syntaxe ; `OK check_panel_html` avec un placeholder de plus.

- [ ] **Step 5: Commit**

```bash
git add extension.js media/panel.html test/check_panel_html.js
git commit -m "chore(webview): enregistre l'URI du module pdf_export"
```

---

### Task 4: Glue PDF raster + routage `exportPlotly` (webview)

**Files:**
- Modify: `media/panel.html` (nouvelle fonction `buildRasterPdfDataUrl`, helpers ; `exportPlotly`, ~ligne 2450 ; `postExportResult`, ~ligne 2440)

**Interfaces:**
- Consumes: `PdfExport.buildPdf`, `currentComparePlotEl()`, `listPlotHeight(el, fig)`, `Plotly.toImage`, `CompressionStream` (navigateur).
- Produces:
  - `postExportResult(requestId, ok, dataUrl, error, useNative?)` (5e argument optionnel).
  - `exportPlotly(msg)` gère `options.format === "pdf"` et la sentinelle `msg.id === "compare"`.

Contrat : pour un PDF, si la figure n'a **pas** d'encart et n'est **pas** la comparaison → renvoyer `useNative: true` (l'extension écrira `fig.pdf` matplotlib). Sinon → renvoyer un `data:application/pdf;base64,…` raster.

- [ ] **Step 1: Ajouter le 5e argument à `postExportResult`**

Remplacer `postExportResult` (~ligne 2440) par :

```js
  function postExportResult(requestId, ok, dataUrl, error, useNative){
    vscodeApi.postMessage({
      type: "exportResult",
      requestId: requestId,
      ok: ok,
      dataUrl: dataUrl || null,
      error: error || null,
      useNative: !!useNative
    });
  }
```

- [ ] **Step 2: Ajouter les helpers de génération du PDF raster**

Juste avant `function exportPlotly(msg){`, ajouter :

```js
  // Charge un data URL image dans un <canvas> et renvoie ses pixels RGBA.
  function pixelsFromImageUrl(url){
    return new Promise(function(resolve, reject){
      const im = new Image();
      im.onload = function(){
        const cv = document.createElement("canvas");
        cv.width = im.naturalWidth; cv.height = im.naturalHeight;
        const ctx = cv.getContext("2d");
        ctx.drawImage(im, 0, 0);
        resolve({ data: ctx.getImageData(0, 0, cv.width, cv.height).data,
                  width: cv.width, height: cv.height });
      };
      im.onerror = function(){ reject(new Error("image illisible")); };
      im.src = url;
    });
  }

  // RGBA (premultiplie sur blanc) -> RGB compact, pour un flux image PDF.
  function rgbaToRgbOnWhite(rgba){
    const n = rgba.length / 4;
    const out = new Uint8Array(n * 3);
    for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3){
      const a = rgba[i + 3] / 255;
      out[j]     = Math.round(rgba[i]     * a + 255 * (1 - a));
      out[j + 1] = Math.round(rgba[i + 1] * a + 255 * (1 - a));
      out[j + 2] = Math.round(rgba[i + 2] * a + 255 * (1 - a));
    }
    return out;
  }

  // Compresse en zlib (FlateDecode) via l'API plateforme CompressionStream.
  function deflateZlib(bytes){
    const cs = new CompressionStream("deflate");   // "deflate" = zlib (RFC1950)
    const writer = cs.writable.getWriter();
    writer.write(bytes); writer.close();
    return new Response(cs.readable).arrayBuffer().then(function(buf){
      return new Uint8Array(buf);
    });
  }

  // Extrait les octets bruts d'un data URL base64 (ex. JPEG).
  function bytesFromBase64DataUrl(url){
    const b64 = url.slice(url.indexOf(",") + 1);
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++){ out[i] = bin.charCodeAt(i); }
    return out;
  }

  function bytesToPdfDataUrl(bytes){
    let bin = "";
    for (let i = 0; i < bytes.length; i++){ bin += String.fromCharCode(bytes[i]); }
    return "data:application/pdf;base64," + btoa(bin);
  }

  // Construit un data URL PDF raster a partir d'un element Plotly vivant
  // (inclut encart / sous-graphe d'erreur / superposition). FlateDecode
  // (sans perte) si CompressionStream dispo, sinon repli JPEG/DCTDecode.
  function buildRasterPdfDataUrl(el){
    const cssW = Math.max(1, Math.round(el.clientWidth ||
      (el.parentElement && el.parentElement.clientWidth) || 900));
    const cssH = Math.max(1, Math.round(el.clientHeight || 540));
    const pageW = Number((cssW * 0.75).toFixed(2));   // px CSS @96dpi -> points
    const pageH = Number((cssH * 0.75).toFixed(2));
    const SCALE = 3;
    if (typeof CompressionStream !== "undefined"){
      return Plotly.toImage(el, { format: "png", width: cssW, height: cssH, scale: SCALE })
        .then(pixelsFromImageUrl)
        .then(function(px){
          const rgb = rgbaToRgbOnWhite(px.data);
          return deflateZlib(rgb).then(function(deflated){
            return bytesToPdfDataUrl(PdfExport.buildPdf({
              imageBytes: deflated, pixelWidth: px.width, pixelHeight: px.height,
              pageWidth: pageW, pageHeight: pageH, filter: "FlateDecode", colorComponents: 3
            }));
          });
        });
    }
    return Plotly.toImage(el, { format: "jpeg", width: cssW, height: cssH, scale: SCALE })
      .then(function(url){
        return pixelsFromImageUrl(url).then(function(px){
          return bytesToPdfDataUrl(PdfExport.buildPdf({
            imageBytes: bytesFromBase64DataUrl(url), pixelWidth: px.width, pixelHeight: px.height,
            pageWidth: pageW, pageHeight: pageH, filter: "DCTDecode", colorComponents: 3
          }));
        });
      });
  }
```

- [ ] **Step 3: Router le format PDF et la sentinelle `compare` dans `exportPlotly`**

Remplacer le début de `exportPlotly(msg)` (résolution de `fig`/`el` + garde) et ajouter la branche PDF. La fonction devient :

```js
  function exportPlotly(msg){
    const isCompare = msg.id === "compare";
    const el = isCompare ? currentComparePlotEl() : document.getElementById("plot-" + msg.id);
    const fig = isCompare ? null : figStore[msg.id];
    if (!el || typeof Plotly === "undefined" || !Plotly.toImage){
      postExportResult(msg.requestId, false, null, "plot introuvable ou Plotly.toImage indisponible");
      return;
    }
    const options = msg.options || {};

    // PDF : figure sans encart et hors comparaison -> PDF matplotlib natif
    // (signal useNative). Sinon -> PDF raster genere ici (encart/erreurs inclus).
    if (options.format === "pdf"){
      if (!isCompare && !el._spHasInset){
        postExportResult(msg.requestId, true, null, null, true);
        return;
      }
      buildRasterPdfDataUrl(el)
        .then(function(dataUrl){ postExportResult(msg.requestId, true, dataUrl, null); })
        .catch(function(err){ postExportResult(msg.requestId, false, null, String(err)); });
      return;
    }

    const format = options.format === "svg" ? "svg" : "png";
    const scale = Math.max(0.25, Number(options.scale) || 1);
    const width = Math.max(1, Math.round(el.clientWidth || (el.parentElement && el.parentElement.clientWidth) || 900));
    const height = Math.max(1, Math.round(el.clientHeight || listPlotHeight(el, fig || {}) || 540));
    const layout = el.layout || {};
    const previous = {
      paper_bgcolor: layout.paper_bgcolor,
      plot_bgcolor: layout.plot_bgcolor
    };
    const bg = options.transparent ? "rgba(0,0,0,0)" : "#ffffff";

    Promise.resolve(Plotly.relayout(el, { paper_bgcolor: bg, plot_bgcolor: bg }))
      .then(function(){
        return Plotly.toImage(el, { format: format, width: width, height: height, scale: scale });
      })
      .then(function(dataUrl){
        return Promise.resolve(Plotly.relayout(el, previous)).then(function(){ return dataUrl; });
      })
      .then(function(dataUrl){ postExportResult(msg.requestId, true, dataUrl, null); })
      .catch(function(err){
        try { Plotly.relayout(el, previous); } catch (e) {}
        postExportResult(msg.requestId, false, null, String(err));
      });
  }
```

Note : `listPlotHeight(el, fig || {})` tolère `fig` absent (comparaison) ; `listPlotHeight` lit `fig.plotly && fig.plotly.width_in` et retombe sur l'aspect par défaut si absent.

- [ ] **Step 4: Vérifier**

Run: `node test/check_panel_html.js`
Expected: `OK check_panel_html`.

- [ ] **Step 5: Commit**

```bash
git add media/panel.html
git commit -m "feat(webview): PDF raster depuis l'element vivant + routage exportPlotly (pdf/compare)"
```

---

### Task 5: Routage PDF côté extension (round-trip + repli natif)

**Files:**
- Modify: `extension.js` (`plotlyExportOptions` ~ligne 324 ; `saveOne` branche Plotly ~ligne 381 ; `finishPlotlyExport` ~ligne 437 ; déclaration de `pendingExports`)

**Interfaces:**
- Consumes: `postToWebview`, `pendingExports`, `nextExportRequestId`, `writeDataUrl`, `defaultName`, `workspaceDir`.
- Produces: à la sauvegarde PDF, l'extension demande l'image au webview ; `finishPlotlyExport` gère `msg.useNative` en écrivant `request.nativePdf`.

Contexte : aujourd'hui le PDF est écrit directement depuis `fig.pdf`, sans encart. On route le PDF par le webview (qui détient l'état d'encart) et on retombe sur `fig.pdf` quand le webview renvoie `useNative`.

- [ ] **Step 1: Faire passer le PDF par le webview dans `saveOne`**

Dans `saveOne`, branche `if (fig.plotly && !fig.frames)`, **supprimer** le bloc d'écriture directe du PDF (le `if (options.format === "pdf") { … showSaveDialog … fs.writeFileSync(fig.pdf) … return; }`) et le remplacer par une préparation du round-trip. La branche devient :

```js
  if (fig.plotly && !fig.frames) {
    const options = await plotlyExportOptions(fig);
    if (!options) { return; }
    const isPdf = options.format === "pdf";
    const uri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(path.join(workspaceDir(), defaultName(fig, options.format))),
      filters: isPdf
        ? { "PDF": ["pdf"] }
        : (options.format === "svg"
            ? { "Image SVG (vectoriel)": ["svg"] }
            : { "Image PNG": ["png"] })
    });
    if (!uri) { return; }
    const requestId = String(nextExportRequestId++);
    pendingExports[requestId] = {
      filePath: uri.fsPath,
      title: fig.title,
      // Repli si le webview renvoie useNative (figure sans encart) : PDF matplotlib.
      nativePdf: (isPdf && fig.pdf) ? fig.pdf : null
    };
    postToWebview({ type: "exportPlotly", id: fig.id, requestId: requestId, options: options });
    return;
  }
```

- [ ] **Step 2: Gérer `useNative` dans `finishPlotlyExport`**

Remplacer `finishPlotlyExport` par :

```js
function finishPlotlyExport(msg) {
  const request = pendingExports[msg.requestId];
  if (!request) { return; }
  delete pendingExports[msg.requestId];
  if (!msg.ok) {
    vscode.window.showErrorMessage("Chaz Plots : echec de l'export Plotly (" + String(msg.error || "erreur inconnue") + ")");
    return;
  }
  try {
    if (msg.useNative) {
      // Figure sans encart : on ecrit le PDF matplotlib natif (vectoriel).
      if (!request.nativePdf) { throw new Error("PDF natif indisponible"); }
      fs.writeFileSync(request.filePath, Buffer.from(request.nativePdf, "base64"));
    } else {
      writeDataUrl(request.filePath, msg.dataUrl);
    }
    vscode.window.showInformationMessage("Figure exportee : " + request.filePath);
  } catch (err) {
    vscode.window.showErrorMessage("Chaz Plots : echec de l'ecriture de l'export (" + String(err) + ")");
  }
}
```

- [ ] **Step 3: Vérifier la syntaxe**

Run: `node --check extension.js`
Expected: aucune erreur.

- [ ] **Step 4: Vérification manuelle (dev host)**

F5 ; dans un terminal neuf : `python test/test_stress.py`. Sur une figure interactive sans encart → « Enregistrer » → PDF : le fichier est le PDF matplotlib (vectoriel, texte sélectionnable). Ajouter un encart (bouton modebar), puis « Enregistrer » → PDF : l'encart est présent dans le PDF.

- [ ] **Step 5: Commit**

```bash
git add extension.js
git commit -m "feat(extension): PDF via le webview (encart inclus) avec repli PDF matplotlib natif"
```

---

### Task 6: Barre d'export complète dans l'overlay comparaison

**Files:**
- Modify: `media/panel.html` (barre `obar` ~ligne 362 ; `copyFig`/`blobFromFig` ~ligne 564 ; `exportCsv`/`exportBundle` ~lignes 1428/1446 ; descripteur pseudo-figure ; ouverture de la comparaison `openCompare`/`renderCompare`)
- Modify: `extension.js` (`saveOne`, `saveCsv`, `saveBundle` : accepter `id === "compare"`)
- Modify: `test/check_panel_html.js` (`requiredIds` : nouveaux boutons)

**Interfaces:**
- Consumes: `currentComparePlotEl()`, `plotSeriesForCsv(el)`, `CsvExport.buildCsv`, `BundleMeta`, `Plotly.toImage`.
- Produces:
  - `comparePseudoFig()` → `{ id: "compare", title, plotly: true, frames: null, pdf: "__webview__", tags: [], provenance }` (descripteur léger).
  - Boutons `#compareCopy`, `#compareCsv`, `#compareBundle`, `#compareSave` dans `obar`.
  - `extension.js` : `saveOne("compare")`, `saveCsv({id:"compare"})`, `saveBundle` fonctionnent sans figure stockée.

- [ ] **Step 1: Ajouter les boutons à la barre de l'overlay**

Dans `panel.html`, `obar` (après `<button id="errorToggle" …>` ou après `compareClose`), ajouter :

```html
      <button id="compareSave" class="compact" title="Enregistrer (PNG / SVG / PDF)">Enregistrer</button>
      <button id="compareCopy" class="compact" title="Copier l'image dans le presse-papiers">Copier</button>
      <button id="compareCsv" class="compact" title="Exporter les donnees visibles en CSV">CSV</button>
      <button id="compareBundle" class="compact" title="Exporter un dossier publication">Bundle</button>
```

- [ ] **Step 2: Ajouter le descripteur pseudo-figure + le titre courant**

Près de `currentComparePlotEl()` (~ligne 2076), ajouter une variable de titre courant et le constructeur de descripteur. D'abord, dans `openCompare`/`renderCompare` (la fonction qui pose `compareTitle.textContent`), mémoriser le titre dans `compareCurrentTitle`. Déclarer en haut du module (près de `let errorState = …`) :

```js
  let compareCurrentTitle = "comparaison";
```

Et là où le titre de l'overlay est défini (`compareTitle.textContent = …`), ajouter juste après :

```js
    compareCurrentTitle = compareTitle.textContent || "comparaison";
```

Puis ajouter la fabrique de descripteur :

```js
  // Descripteur leger "pseudo-figure" pour la vue comparaison : permet de
  // reutiliser saveOne/saveCsv/saveBundle/copie sur l'element vivant fusionne.
  // pdf = sentinelle truthy pour que le menu d'export propose le PDF (rendu raster).
  function comparePseudoFig(){
    const figs = selectedForCompare.map(function(id){ return figStore[id]; }).filter(Boolean);
    const provenance = figs.map(function(f){ return f.provenance || null; }).filter(Boolean);
    return {
      id: "compare",
      title: compareCurrentTitle,
      plotly: true,
      frames: null,
      png: null, svg: null, pdf: "__webview__",
      tags: [],
      provenance: provenance.length ? { sources: provenance } : null
    };
  }
```

- [ ] **Step 3: Câbler les quatre boutons**

Près de `document.getElementById("compareClose").addEventListener(...)` (~ligne 2420), ajouter :

```js
  document.getElementById("compareSave").addEventListener("click", function(){
    if (!currentComparePlotEl()){ return; }
    vscodeApi.postMessage({ type: "save", id: "compare" });
  });
  document.getElementById("compareCopy").addEventListener("click", function(){
    const el = currentComparePlotEl();
    if (!el){ return; }
    Plotly.toImage(el, { format: "png", scale: 2 })
      .then(function(url){ return dataUrlToBlob(url); })
      .then(function(blob){ return navigator.clipboard.write([ new ClipboardItem({ "image/png": blob }) ]); })
      .then(function(){ vscodeApi.postMessage({ type: "copied" }); })
      .catch(function(err){ vscodeApi.postMessage({ type: "copyFailed", error: String(err) }); });
  });
  document.getElementById("compareCsv").addEventListener("click", function(){
    exportCsv(currentComparePlotEl(), comparePseudoFig());
  });
  document.getElementById("compareBundle").addEventListener("click", function(){
    exportBundle(currentComparePlotEl(), comparePseudoFig());
  });
```

Note : `dataUrlToBlob` existe déjà (~ligne 560, utilisé par `blobFromFig`). `exportCsv(el, fig)` poste `saveCsv` avec `id: fig.id` (= "compare"). `exportBundle(el, fig)` emprunte la branche `fig.plotly && el` (rend png/svg via `Plotly.toImage`) ; ajouter le PDF raster au bundle à l'étape suivante.

- [ ] **Step 4: Inclure le PDF raster dans le bundle de la comparaison**

Dans `exportBundle` (après la génération png/svg via `Plotly.toImage`, avant le `if (fig.pdf)`), ajouter un PDF raster quand on dispose de l'élément vivant et qu'aucun PDF natif exploitable n'existe :

```js
      // PDF : natif matplotlib si disponible (figure simple), sinon raster
      // depuis l'element vivant (comparaison / encart / erreurs).
      if (fig.pdf && fig.pdf !== "__webview__"){
        files.push({ name: "figure.pdf", dataUrl: "data:application/pdf;base64," + fig.pdf }); formats.push("pdf");
      } else if (fig.plotly && el){
        try {
          const pdfUrl = await buildRasterPdfDataUrl(el);
          files.push({ name: "figure.pdf", dataUrl: pdfUrl }); formats.push("pdf");
        } catch (e) { /* PDF best-effort : on continue sans */ }
      }
```

…et **supprimer** l'ancien `if (fig.pdf){ files.push(... figure.pdf ...) }` (remplacé par le bloc ci-dessus).

- [ ] **Step 5: Accepter la sentinelle `compare` côté extension**

Dans `extension.js`, `saveOne(id, frameIndex)`, tout en haut, autoriser un descripteur synthétique. Comme le webview poste `{type:"save", id:"compare"}` mais `figures.find` ne trouvera rien, on synthétise une figure « plotly sans représentation native » :

```js
async function saveOne(id, frameIndex) {
  const fig = (id === "compare")
    ? { id: "compare", title: "comparaison", plotly: true, frames: null, pdf: "__present__" }
    : figures.find(function (f) { return f.id === id; });
  if (!fig) { return; }
  ...
```

Effets : `plotlyExportOptions(fig)` propose le PDF (car `fig.pdf` truthy) ; `saveOne` poste `exportPlotly` avec `id:"compare"` ; `pendingExports[...].nativePdf` vaut `null` (car `fig.pdf` = `"__present__"` n'est pas du base64 ; mais pour la comparaison le webview ne renvoie jamais `useNative`, donc `nativePdf` n'est pas lu). Pour être robuste, forcer `nativePdf: null` quand `id === "compare"` :

Dans `saveOne`, à la construction de `pendingExports[requestId]`, remplacer `nativePdf: (isPdf && fig.pdf) ? fig.pdf : null` par :

```js
      nativePdf: (isPdf && fig.pdf && fig.id !== "compare") ? fig.pdf : null
```

- [ ] **Step 6: `saveCsv`/`saveBundle` tolèrent l'absence de figure stockée**

`saveCsv` (~ligne 456) fait `figures.find(... msg.id)` → `undefined` pour `compare`, puis `base = fig ? defaultName(fig,"csv") : "donnees.csv"`. C'est **déjà** tolérant (repli `donnees.csv`). Améliorer le nom par défaut :

```js
  const fig = figures.find(function (f) { return f.id === msg.id; });
  const base = fig ? defaultName(fig, "csv") : (msg.id === "compare" ? "comparaison.csv" : "donnees.csv");
```

`saveBundle` (~ligne 478) n'utilise que `msg.base`/`msg.files` (pas `figures`) → **déjà** compatible. Aucun autre changement.

- [ ] **Step 7: Mettre à jour le garde-fou des ids**

Dans `test/check_panel_html.js`, `requiredIds`, ajouter les nouveaux boutons :

```js
  "errorWarn", "errorPanel", "errorApply", "errorHide", "compareBody",
  "compareSave", "compareCopy", "compareCsv", "compareBundle",
```

(Note : `errorRef` est retiré ici — voir Task 7 ; si Task 7 n'est pas encore faite, conserver `errorRef` dans la liste. Reflète l'état réel du HTML.)

- [ ] **Step 8: Vérifier**

Run: `node --check extension.js && node test/check_panel_html.js`
Expected: pas d'erreur ; `OK check_panel_html` (ids supplémentaires).

- [ ] **Step 9: Vérification manuelle (dev host)**

F5 ; `python test/test_plots.py`. Sélectionner ≥2 figures Plotly, « Superposer ». Dans l'overlay : **Enregistrer** (PNG/SVG/PDF), **Copier**, **CSV**, **Bundle** produisent chacun le bon fichier reflétant la vue (superposition + erreurs si activées + encart si tracé).

- [ ] **Step 10: Commit**

```bash
git add media/panel.html extension.js test/check_panel_html.js
git commit -m "feat(comparaison): barre d'export complete (Enregistrer/Copier/CSV/Bundle) dans l'overlay"
```

---

### Task 7: Mode erreur — sélection des courbes au clic

**Files:**
- Modify: `media/panel.html` (HTML du panneau erreur ~lignes 373-385 ; état `errorState`/nouveau `errorSelect` ~ligne 449 ; `openErrorPanel`/`applyError`/`bindRefClick`/`errorApply`/`errorHide` ~lignes 2064-2135 ; `mergedPlotlyFigureWithErrors` ~ligne 2213 ; suppression de `populateErrorRef`/`errorRef`)
- Modify: `test/check_panel_html.js` (`requiredIds` : retirer `errorRef`, ajouter `errorReset`/`errorSummary`)

**Interfaces:**
- Consumes: `flattenCurves(figs)`, `currentComparePlotEl()`, `mergedPlotlyFigure(figs)`, `_curveKey` (tag de trace posé par `mergedPlotlyFigure`), `Plotly.restyle`.
- Produces:
  - `mergedPlotlyFigureWithErrors(figs, refKey, typeIds, comparedKeys)` — 4e paramètre : ensemble (Array) des clés à comparer ; n'itère que dessus.
  - État `errorSelect = { refKey: string|null, comparedKeys: string[] }`.
  - Boutons/zone : `#errorReset`, `#errorSummary` (le `<select id="errorRef">` disparaît).

- [ ] **Step 1: Remplacer le HTML du panneau erreur**

Remplacer le bloc `<div class="error-panel" id="errorPanel" …>` (lignes 373-385) par :

```html
    <div class="error-panel" id="errorPanel" style="display:none">
      <span id="errorSummary" class="error-summary">Cliquez une courbe : 1re = référence, suivantes = à comparer.</span>
      <span class="error-types">
        <label><input type="checkbox" class="error-type" value="signed"> Difference signee</label>
        <label><input type="checkbox" class="error-type" value="abs"> Erreur absolue</label>
        <label><input type="checkbox" class="error-type" value="rel"> Erreur relative</label>
        <label><input type="checkbox" class="error-type" value="relpct"> Erreur relative %</label>
      </span>
      <button id="errorApply" class="compact">Appliquer</button>
      <button id="errorReset" class="compact">Reinitialiser</button>
      <button id="errorHide" class="compact">Masquer</button>
    </div>
```

Ajouter un style discret pour le résumé près de `.error-warn` (~ligne 290) :

```css
  .error-summary{ font-size:11px; opacity:0.85; }
```

- [ ] **Step 2: Remplacer l'état et supprimer le menu déroulant**

Remplacer la déclaration `let errorState = { active: false, refKey: null, types: [] };` (~ligne 449) par :

```js
  let errorState = { active: false, refKey: null, types: [], comparedKeys: [] };
  // Selection au clic (panneau ouvert, avant Appliquer).
  let errorSelect = { refKey: null, comparedKeys: [] };
```

Mettre à jour les références DOM (~lignes 443-448) : supprimer `const errorRef = document.getElementById("errorRef");` et ajouter :

```js
  const errorReset = document.getElementById("errorReset");
  const errorSummary = document.getElementById("errorSummary");
```

Supprimer entièrement la fonction `populateErrorRef` (~lignes 2053-2062).

- [ ] **Step 3: Sélection au clic + retour visuel**

Remplacer `openErrorPanel` et ajouter les helpers de sélection :

```js
  function curveLabelByKey(curves, key){
    const c = curves.filter(function(x){ return x.key === key; })[0];
    return c ? c.letter : key;
  }

  function refreshErrorSummary(){
    const figs = selectedForCompare.map(function(id){ return figStore[id]; }).filter(Boolean);
    const curves = flattenCurves(figs);
    if (!errorSelect.refKey){
      errorSummary.textContent = "Cliquez une courbe : 1re = référence, suivantes = à comparer.";
      return;
    }
    const ref = curveLabelByKey(curves, errorSelect.refKey);
    const cmp = errorSelect.comparedKeys.map(function(k){ return curveLabelByKey(curves, k); });
    errorSummary.textContent = "Réf : " + ref +
      " • Comparées : " + (cmp.length ? cmp.join(", ") : "—");
  }

  // Met en avant la reference (epaisse) et les comparees (pleine opacite),
  // attenue le reste. S'appuie sur le tag _curveKey des traces.
  function highlightErrorSelection(el){
    if (!el || !el.data){ return; }
    el.data.forEach(function(tr, i){
      const key = tr._curveKey;
      if (key === undefined){ return; }
      const isRef = key === errorSelect.refKey;
      const isCmp = errorSelect.comparedKeys.indexOf(key) !== -1;
      const opacity = (isRef || isCmp) ? 1 : 0.25;
      const width = isRef ? 3.5 : ((tr.line && tr.line.width) || 2);
      Plotly.restyle(el, { opacity: opacity, "line.width": width }, [i]);
    });
  }

  // Regle unifiee du clic sur une courbe de cle k.
  function toggleErrorSelection(key){
    if (key === errorSelect.refKey){ errorSelect.refKey = null; return; }
    const idx = errorSelect.comparedKeys.indexOf(key);
    if (idx !== -1){ errorSelect.comparedKeys.splice(idx, 1); return; }
    if (!errorSelect.refKey){ errorSelect.refKey = key; return; }
    errorSelect.comparedKeys.push(key);
  }

  function bindSelectionClick(el){
    if (!el || !el.on){ return; }
    el.on("plotly_click", function(ev){
      if (errorPanel.style.display === "none"){ return; }  // selection seulement panneau ouvert
      const pt = ev && ev.points && ev.points[0];
      const key = pt && pt.data && pt.data._curveKey;
      if (key === undefined || key === null){ return; }
      toggleErrorSelection(key);
      refreshErrorSummary();
      highlightErrorSelection(el);
    });
  }

  function openErrorPanel(){
    const figs = selectedForCompare.map(function(id){ return figStore[id]; }).filter(Boolean);
    // Repart de la superposition simple pour selectionner au clic.
    const el = currentComparePlotEl();
    if (el){
      errorState = { active: false, refKey: null, types: [], comparedKeys: [] };
      errorSelect = { refKey: null, comparedKeys: [] };
      const merged = mergedPlotlyFigure(figs);
      Plotly.purge(el);
      renderPlotly(el, merged, true, null);
      Plotly.Plots.resize(el);
      bindSelectionClick(el);
    }
    errorWarn.textContent = "";
    refreshErrorSummary();
    errorPanel.style.display = "flex";
  }
```

- [ ] **Step 4: `applyError` utilise la sélection ; `bindRefClick` supprimé**

Remplacer `applyError`, `bindRefClick` et `errorApply`/`errorHide` :

```js
  function applyError(figs, refKey, types, comparedKeys){
    const el = currentComparePlotEl();
    if (!el){ return; }
    errorState = { active: true, refKey: refKey, types: types, comparedKeys: comparedKeys };
    const merged = mergedPlotlyFigureWithErrors(figs, refKey, types, comparedKeys);
    errorPanel.style.display = "none";
    Plotly.purge(el);
    renderPlotly(el, merged, true, null);
    Plotly.Plots.resize(el);
    errorWarn.textContent = (merged._ignored && merged._ignored.length)
      ? "Sans recouvrement X, ignorees : " + merged._ignored.join(", ")
      : "";
  }

  errorApply.addEventListener("click", function(){
    const figs = selectedForCompare.map(function(id){ return figStore[id]; }).filter(Boolean);
    const types = Array.prototype.slice
      .call(document.querySelectorAll(".error-type:checked"))
      .map(function(cb){ return cb.value; });
    if (!errorSelect.refKey){ errorWarn.textContent = "Cliquez une courbe de référence."; return; }
    if (errorSelect.comparedKeys.length === 0){ errorWarn.textContent = "Cliquez au moins une courbe à comparer."; return; }
    if (types.length === 0){ errorWarn.textContent = "Cochez au moins un type d'erreur."; return; }
    if (!currentComparePlotEl()){ return; }
    applyError(figs, errorSelect.refKey, types, errorSelect.comparedKeys.slice());
  });

  errorReset.addEventListener("click", function(){
    errorSelect = { refKey: null, comparedKeys: [] };
    errorWarn.textContent = "";
    refreshErrorSummary();
    const el = currentComparePlotEl();
    if (el){ highlightErrorSelection(el); }
  });

  errorHide.addEventListener("click", function(){
    const figs = selectedForCompare.map(function(id){ return figStore[id]; }).filter(Boolean);
    const el = currentComparePlotEl();
    if (!el){ return; }
    errorState = { active: false, refKey: null, types: [], comparedKeys: [] };
    errorWarn.textContent = "";
    const merged = mergedPlotlyFigure(figs);
    errorPanel.style.display = "none";
    Plotly.purge(el);
    renderPlotly(el, merged, true, null);
    Plotly.Plots.resize(el);
  });
```

Le bouton `errorToggle` (~ligne 2071) garde son comportement (ouvre/ferme le panneau) : à l'ouverture il appelle `openErrorPanel()` qui repart en mode sélection. Aucune modification.

- [ ] **Step 5: `mergedPlotlyFigureWithErrors` n'itère que sur `comparedKeys`**

Modifier la signature et la boucle (~ligne 2213). Remplacer l'en-tête et le `curves.forEach` :

```js
  function mergedPlotlyFigureWithErrors(figs, refKey, typeIds, comparedKeys){
    const base = mergedPlotlyFigure(figs);
    const layout = base.plotly.layout;
    const curves = flattenCurves(figs);
    const ref = curves.filter(function(c){ return c.key === refKey; })[0] || curves[0];
    const compareSet = (comparedKeys && comparedKeys.length)
      ? comparedKeys
      : curves.filter(function(c){ return c.key !== ref.key; }).map(function(c){ return c.key; });
```

(le reste du corps inchangé jusqu'à la boucle). Puis remplacer `curves.forEach(function(c){ if (c.key === ref.key){ return; } …` par une itération restreinte :

```js
    const data = base.plotly.data;
    const ignored = [];
    curves.forEach(function(c){
      if (c.key === ref.key){ return; }
      if (compareSet.indexOf(c.key) === -1){ return; }   // seulement les courbes choisies
      let produced = 0;
      typeIds.forEach(function(typeId){
        const series = ErrorMath.buildErrorSeries(typeId, ref.x, ref.y, c.x, c.y);
        if (series.y.every(function(v){ return v === null; })){ return; }
        const meta = ErrorMath.ERROR_TYPES[typeId];
        data.push({
          type: "scatter", mode: "lines",
          x: series.x, y: series.y,
          xaxis: "x", yaxis: "y2",
          connectgaps: false,
          line: c.color ? { color: c.color } : {},
          name: c.letter + "−" + ref.letter + " : " + c.name + " (" + meta.abbr + ")"
        });
        produced++;
      });
      if (produced === 0 && ignored.indexOf(c.letter) === -1){ ignored.push(c.letter); }
    });
    base._ignored = ignored;
    return base;
  }
```

Le repli `compareSet = toutes sauf ref` quand `comparedKeys` est vide préserve la compatibilité (anciens appels éventuels).

- [ ] **Step 6: Garde-fou des ids**

Dans `test/check_panel_html.js`, `requiredIds` : retirer `"errorRef"`, ajouter `"errorReset"`, `"errorSummary"`. (Si Task 6 a déjà retiré `errorRef`, ne pas le redoubler.)

- [ ] **Step 7: Vérifier**

Run: `node test/check_panel_html.js`
Expected: `OK check_panel_html`.

- [ ] **Step 8: Vérification manuelle (dev host)**

F5 ; un script traçant ≥3 courbes interpolables dans des figures comparables (p. ex. adapter `test/test_plots.py` pour 4 courbes sur même X dans 4 figures), « Superposer », bouton « Erreur ». Cliquer une courbe (→ Réf), deux autres (→ comparées), cocher « Erreur absolue », « Appliquer » : 2 courbes d'erreur tracées contre la même référence. « Réinitialiser » remet à zéro. Cliquer une comparée la retire.

- [ ] **Step 9: Commit**

```bash
git add media/panel.html test/check_panel_html.js
git commit -m "feat(erreur): selection des courbes au clic (reference + comparees) au lieu du menu deroulant"
```

---

### Task 8: Documentation et version

**Files:**
- Modify: `README.md` (sections fonctionnalités + « Limites connues »)
- Modify: `package.json` (`version`)
- Modify: `CLAUDE.md` (sections « media/panel.html » et modules purs : mentionner `pdf_export.js`, la barre d'export de l'overlay, la sélection d'erreur au clic, le routage PDF hybride)

**Interfaces:**
- Consumes: rien (documentation).
- Produces: README/CLAUDE à jour, version incrémentée.

- [ ] **Step 1: Mettre à jour le README**

Dans `README.md`, documenter :
- PDF des figures avec encart, des erreurs et des comparaisons (raster haute résolution depuis le webview ; PDF matplotlib vectoriel conservé pour les figures simples) ;
- la barre d'export complète de l'overlay comparaison (Enregistrer PNG/SVG/PDF, Copier, CSV, Bundle) ;
- la sélection au clic en mode erreur (référence + courbes à comparer) ;
- correctif du redimensionnement multi-écran de la vue liste.

Ajuster « Limites connues » : noter que le PDF des cas encart/erreurs/comparaison est **raster** (non vectoriel) — option vectorielle (svg2pdf+jsPDF) volontairement non retenue.

- [ ] **Step 2: Mettre à jour CLAUDE.md**

Ajouter `pdf_export.js` (`PdfExport`) à la liste des modules purs du webview, décrire le routage PDF hybride (volet « Génération PDF ») et la sélection d'erreur au clic dans la section panel.html.

- [ ] **Step 3: Incrémenter la version**

Dans `package.json`, passer `version` de `0.7.0` à `0.8.0` (nouvelles fonctionnalités).

- [ ] **Step 4: Vérifier la cohérence JSON**

Run: `node -e "require('./package.json')"`
Expected: aucune erreur (JSON valide).

- [ ] **Step 5: Lancer toute la batterie de tests rapides**

Run: `node test/test_pdf_export.js && node test/test_inset_layout.js && node test/test_error_curves.js && node test/check_panel_html.js && node --check extension.js && node --check storage.js && node --check media/pdf_export.js`
Expected: tous OK.

- [ ] **Step 6: Commit**

```bash
git add README.md CLAUDE.md package.json
git commit -m "docs: PDF encart/erreurs/comparaison, barre d'export overlay, selection erreur au clic (v0.8.0)"
```

---

## Self-Review

**Couverture de la spec :**
- Volet 1 (redimensionnement) → Task 1. ✓
- Volet 2 (encart au PDF) → Tasks 2-5 (module, URI, glue, routage extension). ✓
- Volet 3 (PDF + barre complète erreurs/comparaisons) → Task 6 (+ réutilise le PDF raster des Tasks 2-5). ✓
- Volet 4 (sélection d'erreur au clic) → Task 7. ✓
- Modules touchés / tests / docs de la spec → couverts (Task 8 pour README/CLAUDE, `check_panel_html` mis à jour aux Tasks 3/6/7).

**Cohérence des types :**
- `PdfExport.buildPdf({ imageBytes, pixelWidth, pixelHeight, pageWidth, pageHeight, filter, colorComponents })` — signature identique entre Task 2 (def), Task 4 (`buildRasterPdfDataUrl`), Task 6 (bundle). ✓
- `postExportResult(requestId, ok, dataUrl, error, useNative)` — 5e arg défini Task 4, consommé par l'extension via `msg.useNative` Task 5. ✓
- `exportPlotly` résout `id === "compare"` (Task 4), produit par les boutons overlay (Task 6) et accepté par `saveOne("compare")` (Task 6). ✓
- `mergedPlotlyFigureWithErrors(figs, refKey, typeIds, comparedKeys)` — signature étendue Task 7, appelée avec `comparedKeys` dans `applyError`. ✓
- `pendingExports[id] = { filePath, title, nativePdf }` — défini Task 5, lu dans `finishPlotlyExport` Task 5 ; `nativePdf` forcé à `null` pour `compare` Task 6. ✓

**Placeholders :** aucun « TBD/TODO » ; code complet à chaque étape de code.

**Note de séquencement :** `check_panel_html.js` est édité aux Tasks 3, 6 et 7. Si les tasks sont exécutées dans l'ordre, l'état de `requiredIds`/`placeholders` reste cohérent avec le HTML à chaque commit. Les retraits/ajouts d'ids (`errorRef` retiré, boutons compare/erreur ajoutés) sont notés là où ils interviennent.
