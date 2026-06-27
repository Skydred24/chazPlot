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

  // Normalise les options d'UNE page (image plein cadre).
  function normPage(o) {
    o = o || {};
    const img = o.imageBytes || new Uint8Array(0);
    const pw = Math.max(1, Math.round(o.pixelWidth || 1));
    const ph = Math.max(1, Math.round(o.pixelHeight || 1));
    return {
      img: img,
      pw: pw,
      ph: ph,
      pageW: Number((o.pageWidth || pw).toFixed(2)),
      pageH: Number((o.pageHeight || ph).toFixed(2)),
      filter: o.filter === "DCTDecode" ? "DCTDecode" : "FlateDecode",
      cs: (o.colorComponents === 1) ? "/DeviceGray" : "/DeviceRGB"
    };
  }

  // Construit un PDF 1.4. Deux formes acceptees :
  //  - une image plein cadre : buildPdf({ imageBytes, pixelWidth, ... }) ;
  //  - plusieurs pages       : buildPdf({ pages: [{ imageBytes, ... }, ...] })
  //    -> une page par image (utilise par le rapport PDF multipage).
  // Numerotation objets : 1=Catalog, 2=Pages, puis par page i (0-based) :
  // Page=3+3i, Image=4+3i, Content=5+3i. La forme image unique reste identique
  // a l'ancienne sortie (objets 1..5, xref "0 6").
  function buildPdf(opts) {
    const o = opts || {};
    const pages = (Array.isArray(o.pages) && o.pages.length)
      ? o.pages.map(normPage)
      : [normPage(o)];
    const N = pages.length;
    const totalObjs = 2 + 3 * N;

    const chunks = [];
    let length = 0;
    const offsets = new Array(totalObjs + 1).fill(0);   // offsets[numObjet]

    function push(bytes) { chunks.push(bytes); length += bytes.length; }
    function pushStr(s) { push(asciiBytes(s)); }
    function obj(num) { offsets[num] = length; }

    pushStr("%PDF-1.4\n");

    obj(1);
    pushStr("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");

    const kids = [];
    for (let i = 0; i < N; i++) { kids.push((3 + 3 * i) + " 0 R"); }
    obj(2);
    pushStr("2 0 obj\n<< /Type /Pages /Kids [" + kids.join(" ") + "] /Count " + N + " >>\nendobj\n");

    for (let i = 0; i < N; i++) {
      const p = pages[i];
      const pageNum = 3 + 3 * i;
      const imgNum = 4 + 3 * i;
      const contentNum = 5 + 3 * i;

      obj(pageNum);
      pushStr(
        pageNum + " 0 obj\n<< /Type /Page /Parent 2 0 R " +
        "/MediaBox [0 0 " + p.pageW + " " + p.pageH + "] " +
        "/Resources << /XObject << /Im0 " + imgNum + " 0 R >> >> " +
        "/Contents " + contentNum + " 0 R >>\nendobj\n"
      );

      obj(imgNum);
      pushStr(
        imgNum + " 0 obj\n<< /Type /XObject /Subtype /Image " +
        "/Width " + p.pw + " /Height " + p.ph + " " +
        "/ColorSpace " + p.cs + " /BitsPerComponent 8 " +
        "/Filter /" + p.filter + " /Length " + p.img.length + " >>\nstream\n"
      );
      push(p.img);
      pushStr("\nendstream\nendobj\n");

      const content = "q " + p.pageW + " 0 0 " + p.pageH + " 0 0 cm /Im0 Do Q\n";
      const contentBytes = asciiBytes(content);
      obj(contentNum);
      pushStr(contentNum + " 0 obj\n<< /Length " + contentBytes.length + " >>\nstream\n");
      push(contentBytes);
      pushStr("endstream\nendobj\n");
    }

    const xrefOffset = length;
    pushStr("xref\n0 " + (totalObjs + 1) + "\n");
    pushStr("0000000000 65535 f \n");
    for (let i = 1; i <= totalObjs; i++) { pushStr(pad10(offsets[i]) + " 00000 n \n"); }
    pushStr("trailer\n<< /Size " + (totalObjs + 1) + " /Root 1 0 R >>\nstartxref\n" + xrefOffset + "\n%%EOF\n");

    return concatBytes(chunks);
  }

  return { buildPdf: buildPdf, asciiBytes: asciiBytes, concatBytes: concatBytes };
});
