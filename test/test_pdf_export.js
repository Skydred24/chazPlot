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

check("buildPdf multipage: Count, Kids et MediaBox par page", function () {
  const a = new Uint8Array([10, 11]);
  const b = new Uint8Array([20, 21]);
  const pdf = PdfExport.buildPdf({ pages: [
    { imageBytes: a, pixelWidth: 4, pixelHeight: 5, pageWidth: 595, pageHeight: 842, filter: "FlateDecode" },
    { imageBytes: b, pixelWidth: 6, pixelHeight: 7, pageWidth: 595, pageHeight: 842, filter: "FlateDecode" }
  ] });
  const s = toLatin1(pdf);
  assert.ok(/\/Count 2/.test(s), "Count attendu 2");
  assert.ok(/\/Kids \[3 0 R 6 0 R\]/.test(s), "Kids incorrects : " + (s.match(/\/Kids[^\]]*\]/) || [""])[0]);
  assert.strictEqual((s.match(/\/MediaBox \[0 0 595 842\]/g) || []).length, 2, "2 MediaBox attendus");
  assert.ok(s.indexOf("%PDF-1.4") === 0 && s.indexOf("%%EOF") !== -1, "structure PDF invalide");
  assert.ok(/xref\n0 9\n/.test(s), "table xref attendue 0 9 (1 + 2 + 3*2 objets)");
});

check("buildPdf multipage: startxref pointe sur la table xref", function () {
  const pdf = PdfExport.buildPdf({ pages: [
    { imageBytes: img, pixelWidth: 2, pixelHeight: 2, filter: "FlateDecode" },
    { imageBytes: img, pixelWidth: 2, pixelHeight: 2, filter: "FlateDecode" }
  ] });
  const s = toLatin1(pdf);
  const xrefPos = s.lastIndexOf("\nxref\n") + 1;
  const m = /startxref\s+(\d+)/.exec(s);
  assert.ok(m, "startxref absent");
  assert.strictEqual(Number(m[1]), xrefPos, "startxref ne pointe pas sur xref");
});

console.log("\n" + passed + " tests OK");
