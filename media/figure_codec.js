// ============================================================
// figure_codec.js
// Embarque / relit des donnees arbitraires dans un PNG (chunk zTXt) ou un SVG
// (element <metadata>), pour rendre une figure "auto-portee" : on y cache la spec
// Plotly (les points de la courbe) afin de pouvoir la recreer en deposant l'image
// dans le panneau. Cf. "Figure auto-portee" dans CLAUDE.md.
//
// Module PUR : pas de DOM, pas de compression (le flux fourni/rendu est DEJA
// compresse — zlib pour le PNG, base64 d'un flux zlib pour le SVG ; la
// (de)compression est faite par l'appelant : `zlib` cote extension). Charge par
// extension.js (require) et teste par test/test_figure_codec.js. Travaille sur des
// Uint8Array/Buffer (le PNG est binaire). Aucune dependance.
// ============================================================
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) { module.exports = api; }
  else { root.FigureCodec = api; }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const PNG_SIG = [137, 80, 78, 71, 13, 10, 26, 10];

  // --- CRC32 (polynome PNG/zlib) ---
  let crcTable = null;
  function buildCrcTable() {
    const t = new Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) { c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); }
      t[n] = c >>> 0;
    }
    return t;
  }
  function crc32(bytes) {
    if (!crcTable) { crcTable = buildCrcTable(); }
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) { c = crcTable[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8); }
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  function isPng(b) {
    if (!b || b.length < 8) { return false; }
    for (let i = 0; i < 8; i++) { if (b[i] !== PNG_SIG[i]) { return false; } }
    return true;
  }
  function readU32(b, off) {
    return ((b[off] << 24) | (b[off + 1] << 16) | (b[off + 2] << 8) | b[off + 3]) >>> 0;
  }
  function writeU32(b, off, v) {
    b[off] = (v >>> 24) & 0xFF; b[off + 1] = (v >>> 16) & 0xFF;
    b[off + 2] = (v >>> 8) & 0xFF; b[off + 3] = v & 0xFF;
  }
  function type4(b, off) {
    return String.fromCharCode(b[off], b[off + 1], b[off + 2], b[off + 3]);
  }
  function latin1Bytes(s) {
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) { out[i] = s.charCodeAt(i) & 0xFF; }
    return out;
  }
  function concat(parts) {
    let total = 0;
    for (let i = 0; i < parts.length; i++) { total += parts[i].length; }
    const out = new Uint8Array(total);
    let off = 0;
    for (let i = 0; i < parts.length; i++) { out.set(parts[i], off); off += parts[i].length; }
    return out;
  }

  // Lit le mot-cle d'un chunk zTXt (jusqu'au premier octet nul).
  function ztxtKeyword(b, dataStart, len) {
    let i = dataStart;
    const end = dataStart + len;
    let s = "";
    while (i < end && b[i] !== 0) { s += String.fromCharCode(b[i]); i++; }
    return s;
  }

  // Construit un chunk zTXt : keyword + 0x00 + methode(0=deflate) + flux zlib.
  function buildZtxt(keyword, compressed) {
    const kw = latin1Bytes(keyword);
    const data = concat([kw, Uint8Array.of(0), Uint8Array.of(0), compressed]);
    const typeBytes = latin1Bytes("zTXt");
    const chunk = new Uint8Array(4 + 4 + data.length + 4);
    writeU32(chunk, 0, data.length);
    chunk.set(typeBytes, 4);
    chunk.set(data, 8);
    writeU32(chunk, 8 + data.length, crc32(concat([typeBytes, data])));
    return chunk;
  }

  // Insere `compressed` (flux zlib) dans le PNG sous le mot-cle donne (chunk zTXt
  // avant IEND). Remplace un eventuel chunk existant du meme mot-cle (pas de
  // doublon a la re-sauvegarde). Renvoie un Uint8Array, ou null si pas un PNG.
  function pngEmbed(png, keyword, compressed) {
    if (!isPng(png)) { return null; }
    const segments = [png.subarray(0, 8)];
    let iendChunk = null;
    let off = 8;
    while (off + 12 <= png.length) {
      const len = readU32(png, off);
      const type = type4(png, off + 4);
      const chunkEnd = off + 12 + len;
      const chunkBytes = png.subarray(off, chunkEnd);
      if (type === "IEND") { iendChunk = chunkBytes; break; }
      const isOurs = (type === "zTXt" && ztxtKeyword(png, off + 8, len) === keyword);
      if (!isOurs) { segments.push(chunkBytes); }
      off = chunkEnd;
    }
    if (!iendChunk) { return null; }
    segments.push(buildZtxt(keyword, compressed));
    segments.push(iendChunk);
    return concat(segments);
  }

  // Renvoie le flux zlib stocke sous `keyword` (Uint8Array) ou null.
  function pngExtract(png, keyword) {
    if (!isPng(png)) { return null; }
    let off = 8;
    while (off + 12 <= png.length) {
      const len = readU32(png, off);
      const type = type4(png, off + 4);
      if (type === "zTXt") {
        const dataStart = off + 8;
        let i = dataStart;
        const end = dataStart + len;
        while (i < end && png[i] !== 0) { i++; }
        const kw = ztxtKeyword(png, dataStart, len);
        if (kw === keyword) {
          // i = position du nul ; +1 nul, +1 octet methode -> flux zlib
          return png.subarray(i + 2, end);
        }
      }
      if (type === "IEND") { break; }
      off = off + 12 + len;
    }
    return null;
  }

  const SVG_META = /<metadata[^>]*id="chazPlotsFigure"[^>]*>([\s\S]*?)<\/metadata>/i;

  function svgStrip(text) { return text.replace(SVG_META, ""); }

  // Insere <metadata id="chazPlotsFigure">b64</metadata> juste apres <svg ...>.
  function svgEmbed(text, b64) {
    text = svgStrip(text);
    const meta = '<metadata id="chazPlotsFigure" data-chaz="1">' + b64 + "</metadata>";
    const m = /<svg[^>]*>/i.exec(text);
    if (!m) { return text + meta; }
    const idx = m.index + m[0].length;
    return text.slice(0, idx) + meta + text.slice(idx);
  }

  function svgExtract(text) {
    const m = SVG_META.exec(text || "");
    return m ? m[1].trim() : null;
  }

  return {
    isPng: isPng,
    crc32: crc32,
    pngEmbed: pngEmbed,
    pngExtract: pngExtract,
    svgEmbed: svgEmbed,
    svgExtract: svgExtract,
    svgStrip: svgStrip,
  };
});
