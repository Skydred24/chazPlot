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
