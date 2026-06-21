// Harnais de test sans dependance pour media/compare_util.js
// Lancer : node test/test_compare_util.js
"use strict";
const assert = require("assert");
const CU = require("../media/compare_util.js");

let passed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log("ok   - " + name); }
  catch (e) { console.error("FAIL - " + name + " : " + e.message); process.exitCode = 1; }
}

// --- peerRangeUpdates : synchronisation des zooms cote a cote ---
check("peerRangeUpdates: range x explicite -> tableau complet", function () {
  const u = CU.peerRangeUpdates({ "xaxis.range[0]": 1, "xaxis.range[1]": 5 });
  assert.deepStrictEqual(u, { "xaxis.range": [1, 5] });
});
check("peerRangeUpdates: autorange propage", function () {
  const u = CU.peerRangeUpdates({ "xaxis.autorange": true });
  assert.deepStrictEqual(u, { "xaxis.autorange": true });
});
check("peerRangeUpdates: x et y ensemble", function () {
  const u = CU.peerRangeUpdates({
    "xaxis.range[0]": 1, "xaxis.range[1]": 2,
    "yaxis.range[0]": 0, "yaxis.range[1]": 10,
  });
  assert.deepStrictEqual(u, { "xaxis.range": [1, 2], "yaxis.range": [0, 10] });
});
check("peerRangeUpdates: range objet direct (xaxis.range:[a,b])", function () {
  const u = CU.peerRangeUpdates({ "xaxis.range": [3, 7] });
  assert.deepStrictEqual(u, { "xaxis.range": [3, 7] });
});
check("peerRangeUpdates: ignore les cles non liees aux axes", function () {
  const u = CU.peerRangeUpdates({ "dragmode": "zoom", "shapes[0].x0": 2 });
  assert.deepStrictEqual(u, {});
});
check("peerRangeUpdates: axes secondaires (xaxis2)", function () {
  const u = CU.peerRangeUpdates({ "xaxis2.range[0]": 0, "xaxis2.range[1]": 4 });
  assert.deepStrictEqual(u, { "xaxis2.range": [0, 4] });
});

// --- subplotSignature / figuresShareSubplots ---
function fig(traces, layout) {
  return { plotly: { data: traces, layout: layout || {}, width_in: 7, height_in: 4 } };
}
check("subplotSignature: axes par defaut -> x/y", function () {
  const sig = CU.subplotSignature(fig([{ type: "scatter", x: [0], y: [0] }]).plotly);
  assert.strictEqual(sig, "x/y");
});
check("subplotSignature: deux sous-graphes", function () {
  const sig = CU.subplotSignature(fig([
    { x: [0], y: [0], xaxis: "x", yaxis: "y" },
    { x: [0], y: [0], xaxis: "x2", yaxis: "y2" },
  ]).plotly);
  assert.strictEqual(sig, "x/y|x2/y2");
});
check("figuresShareSubplots: meme structure multi-subplot -> true", function () {
  const a = fig([{ x: [0], y: [0], xaxis: "x", yaxis: "y" }, { x: [0], y: [0], xaxis: "x2", yaxis: "y2" }]);
  const b = fig([{ x: [1], y: [1], xaxis: "x", yaxis: "y" }, { x: [1], y: [1], xaxis: "x2", yaxis: "y2" }]);
  assert.strictEqual(CU.figuresShareSubplots([a, b]), true);
});
check("figuresShareSubplots: signatures differentes -> false", function () {
  const a = fig([{ x: [0], y: [0], xaxis: "x", yaxis: "y" }, { x: [0], y: [0], xaxis: "x2", yaxis: "y2" }]);
  const b = fig([{ x: [1], y: [1] }]);
  assert.strictEqual(CU.figuresShareSubplots([a, b]), false);
});
check("figuresShareSubplots: un seul subplot -> false (overlay simple suffit)", function () {
  const a = fig([{ x: [0], y: [0] }]);
  const b = fig([{ x: [1], y: [1] }]);
  assert.strictEqual(CU.figuresShareSubplots([a, b]), false);
});

// --- mergeSubplotFigures ---
check("mergeSubplotFigures: empile toutes les traces en conservant les axes", function () {
  const a = fig([{ x: [0], y: [0], xaxis: "x", yaxis: "y", name: "u" },
                 { x: [0], y: [0], xaxis: "x2", yaxis: "y2", name: "v" }],
                { xaxis: { domain: [0, 0.45] }, xaxis2: { domain: [0.55, 1] }, yaxis: {}, yaxis2: {} });
  const b = fig([{ x: [1], y: [1], xaxis: "x", yaxis: "y", name: "u" },
                 { x: [1], y: [1], xaxis: "x2", yaxis: "y2", name: "v" }]);
  const merged = CU.mergeSubplotFigures([a, b]);
  assert.strictEqual(merged.plotly.data.length, 4);
  // axes preserves
  const axesPairs = merged.plotly.data.map(function (t) { return t.xaxis + "/" + t.yaxis; });
  assert.deepStrictEqual(axesPairs.sort(), ["x/y", "x/y", "x2/y2", "x2/y2"]);
  // prefixes de figure
  assert.ok(merged.plotly.data.some(function (t) { return /^A/.test(t.name); }));
  assert.ok(merged.plotly.data.some(function (t) { return /^B/.test(t.name); }));
  // domaines de sous-graphes conserves
  assert.deepStrictEqual(merged.plotly.layout.xaxis2.domain, [0.55, 1]);
});

console.log("\n" + passed + " tests OK");
