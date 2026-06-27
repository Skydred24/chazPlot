// test/test_figure_codec.js — tests du codec PNG (zTXt) / SVG (<metadata>).
// Lancer : node test/test_figure_codec.js
"use strict";
const assert = require("assert");
const zlib = require("zlib");
const FC = require("../media/figure_codec.js");

let passed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log("ok   - " + name); }
  catch (e) { console.error("FAIL - " + name + " : " + e.message); process.exitCode = 1; }
}

// Construit un PNG minimal valide-de-structure : signature + IHDR + IEND.
function fakePng() {
  const sig = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
  function chunk(type, data) {
    const t = Uint8Array.from(type.split("").map(function (c) { return c.charCodeAt(0); }));
    const len = data.length;
    const out = new Uint8Array(12 + len);
    out[0] = (len >>> 24) & 255; out[1] = (len >>> 16) & 255; out[2] = (len >>> 8) & 255; out[3] = len & 255;
    out.set(t, 4); out.set(data, 8);
    const crc = FC.crc32(Uint8Array.from([].concat(Array.from(t), Array.from(data))));
    out[8 + len] = (crc >>> 24) & 255; out[9 + len] = (crc >>> 16) & 255;
    out[10 + len] = (crc >>> 8) & 255; out[11 + len] = crc & 255;
    return out;
  }
  const ihdr = chunk("IHDR", new Uint8Array(13));
  const iend = chunk("IEND", new Uint8Array(0));
  const out = new Uint8Array(sig.length + ihdr.length + iend.length);
  out.set(sig, 0); out.set(ihdr, sig.length); out.set(iend, sig.length + ihdr.length);
  return out;
}

check("isPng : reconnait la signature", function () {
  assert.strictEqual(FC.isPng(fakePng()), true);
  assert.strictEqual(FC.isPng(Uint8Array.from([1, 2, 3])), false);
});

check("PNG : round-trip embed/extract du flux zlib", function () {
  const json = JSON.stringify({ tool: "chaz-plots", v: 1, plotly: { data: [{ x: [0, 1], y: [2, 3] }] } });
  const compressed = zlib.deflateSync(Buffer.from(json, "utf8"));
  const png = fakePng();
  const out = FC.pngEmbed(png, "chazPlotsFigure", compressed);
  assert.ok(out && FC.isPng(out), "sortie PNG valide");
  const got = FC.pngExtract(out, "chazPlotsFigure");
  assert.ok(got, "chunk retrouve");
  const back = zlib.inflateSync(Buffer.from(got)).toString("utf8");
  assert.strictEqual(back, json);
});

check("PNG : IEND reste le dernier chunk", function () {
  const png = fakePng();
  const out = FC.pngEmbed(png, "k", zlib.deflateSync(Buffer.from("x")));
  const tail = Array.from(out.subarray(out.length - 8, out.length - 4))
    .map(function (n) { return String.fromCharCode(n); }).join("");
  assert.strictEqual(tail, "IEND");
});

check("PNG : re-embed ne cree pas de doublon (extrait la derniere valeur)", function () {
  let png = fakePng();
  png = FC.pngEmbed(png, "chazPlotsFigure", zlib.deflateSync(Buffer.from("v1")));
  png = FC.pngEmbed(png, "chazPlotsFigure", zlib.deflateSync(Buffer.from("v2")));
  // un seul chunk zTXt "chazPlotsFigure"
  let count = 0, off = 8;
  while (off + 12 <= png.length) {
    const len = ((png[off] << 24) | (png[off + 1] << 16) | (png[off + 2] << 8) | png[off + 3]) >>> 0;
    const type = String.fromCharCode(png[off + 4], png[off + 5], png[off + 6], png[off + 7]);
    if (type === "zTXt") { count++; }
    if (type === "IEND") { break; }
    off = off + 12 + len;
  }
  assert.strictEqual(count, 1, "un seul chunk zTXt");
  assert.strictEqual(zlib.inflateSync(Buffer.from(FC.pngExtract(png, "chazPlotsFigure"))).toString(), "v2");
});

check("PNG : extract renvoie null si absent", function () {
  assert.strictEqual(FC.pngExtract(fakePng(), "chazPlotsFigure"), null);
});

check("SVG : round-trip embed/extract", function () {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="80"><rect/></svg>';
  const b64 = Buffer.from("hello").toString("base64");
  const out = FC.svgEmbed(svg, b64);
  assert.ok(out.indexOf('id="chazPlotsFigure"') !== -1, "metadata inseree");
  assert.ok(out.indexOf("<rect/>") !== -1, "contenu preserve");
  assert.strictEqual(FC.svgExtract(out), b64);
});

check("SVG : re-embed remplace (pas de doublon)", function () {
  const svg = '<svg width="1" height="1"></svg>';
  let out = FC.svgEmbed(svg, "AAA");
  out = FC.svgEmbed(out, "BBB");
  assert.strictEqual((out.match(/id="chazPlotsFigure"/g) || []).length, 1);
  assert.strictEqual(FC.svgExtract(out), "BBB");
});

check("SVG : extract null si absent", function () {
  assert.strictEqual(FC.svgExtract('<svg></svg>'), null);
});

console.log("\n" + passed + " tests OK");
