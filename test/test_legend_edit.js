// Harnais de test sans dependance pour media/legend_edit.js
// Lancer : node test/test_legend_edit.js
"use strict";
const assert = require("assert");
const LE = require("../media/legend_edit.js");
let passed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log("ok   - " + name); }
  catch (e) { console.error("FAIL - " + name + " : " + e.message); process.exitCode = 1; }
}
check("listes label/value", function () {
  assert.ok(Array.isArray(LE.LINE_DASHES) && LE.LINE_DASHES.length >= 4);
  assert.strictEqual(LE.LINE_DASHES[0].value, "solid");
  assert.ok(Array.isArray(LE.MARKER_SYMBOLS) && LE.MARKER_SYMBOLS.length >= 5);
  assert.strictEqual(LE.MARKER_SYMBOLS[0].value, "");
  assert.ok(Array.isArray(LE.BASE_COLORS) && LE.BASE_COLORS.length >= 8);
  assert.ok(Array.isArray(LE.PALETTES) && LE.PALETTES.length >= 4);
});
check("paletteColors: renvoie une copie de palette", function () {
  const colors = LE.paletteColors("viridis");
  assert.ok(colors.length >= 8);
  colors[0] = "#ffffff";
  assert.notStrictEqual(LE.paletteColors("viridis")[0], "#ffffff");
});
check("toHexColor: normalise hex court et rgb", function () {
  assert.strictEqual(LE.toHexColor("#abc"), "#aabbcc");
  assert.strictEqual(LE.toHexColor("rgb(31, 119, 180)"), "#1f77b4");
  assert.strictEqual(LE.toHexColor("pas une couleur", "#000000"), "#000000");
});
check("compareLegendPrefix: titre court", function () {
  assert.strictEqual(LE.compareLegendPrefix("mesures.py", "A"), "mesures.py");
});
check("compareLegendPrefix: titre long tronque", function () {
  const out = LE.compareLegendPrefix("un_titre_vraiment_tres_long", "A");
  assert.strictEqual(out, "un_titre_vraime...");
  assert.strictEqual(out.length, 18);
});
check("compareLegendPrefix: fallback", function () {
  assert.strictEqual(LE.compareLegendPrefix("", "B"), "B");
  assert.strictEqual(LE.compareLegendPrefix("   ", "C"), "C");
  assert.strictEqual(LE.compareLegendPrefix("---", "D"), "D");
});
check("readTrace: valeurs", function () {
  const v = LE.readTrace({ name: "sin", line: { color: "#ff0000", dash: "dot", width: 3 }, marker: { symbol: "square", size: 9 } });
  assert.strictEqual(v.name, "sin");
  assert.strictEqual(v.color, "#ff0000");
  assert.strictEqual(v.dash, "dot");
  assert.strictEqual(v.width, 3);
  assert.strictEqual(v.symbol, "square");
  assert.strictEqual(v.markerSize, 9);
});
check("readTrace: defauts", function () {
  const v = LE.readTrace({});
  assert.strictEqual(v.name, "");
  assert.strictEqual(v.dash, "solid");
  assert.strictEqual(v.width, 2);
  assert.strictEqual(v.symbol, "");
  assert.strictEqual(v.markerSize, 6);
});
check("buildRestyle: patch complet", function () {
  const p = LE.buildRestyle({ name: "x", color: "#00ff00", dash: "dash", width: 2.5, symbol: "circle", markerSize: 8 });
  assert.strictEqual(p.name, "x");
  assert.strictEqual(p["line.color"], "#00ff00");
  assert.strictEqual(p["marker.color"], "#00ff00");
  assert.strictEqual(p["fillcolor"], "rgba(0,255,0,0.25)");
  assert.strictEqual(p["line.dash"], "dash");
  assert.strictEqual(p["line.width"], 2.5);
  assert.strictEqual(p["marker.symbol"], "circle");
  assert.strictEqual(p["marker.size"], 8);
});
check("buildRestyle: champs invalides omis", function () {
  const p = LE.buildRestyle({ name: "", color: "", dash: "", width: 0, symbol: "", markerSize: 0 });
  assert.ok(!("name" in p));
  assert.ok(!("line.color" in p));
  assert.ok(!("line.width" in p));
  assert.strictEqual(p["marker.symbol"], "");
});
check("applyPatch: cles pointees", function () {
  const trace = { name: "old", line: { width: 1 } };
  LE.applyPatch(trace, { name: "new", "line.color": "#abc", "marker.symbol": "circle" });
  assert.strictEqual(trace.name, "new");
  assert.strictEqual(trace.line.color, "#abc");
  assert.strictEqual(trace.line.width, 1);
  assert.strictEqual(trace.marker.symbol, "circle");
});
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
if (process.exitCode) { process.exit(process.exitCode); }
console.log("\n" + passed + " tests OK");

