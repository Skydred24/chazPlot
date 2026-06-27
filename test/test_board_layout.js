// test/test_board_layout.js — tests du module pur de planche multi-panneaux.
// Lancer : node test/test_board_layout.js
"use strict";
const assert = require("assert");
const BoardLayout = require("../media/board_layout.js");

let passed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log("ok   - " + name); }
  catch (e) { console.error("FAIL - " + name + " : " + e.message); process.exitCode = 1; }
}

function fig(name, traceName, extra) {
  return Object.assign({
    title: name,
    plotly: {
      data: [{ type: "scatter", x: [0, 1], y: [1, 2], name: traceName }],
      layout: { xaxis: { title: { text: "t" } }, yaxis: { title: { text: "v" }, type: "log" } },
      width_in: 6, height_in: 3
    }
  }, extra || {});
}

check("defaultGrid : cols=ceil(sqrt n), rows=ceil(n/cols)", function () {
  assert.deepStrictEqual(BoardLayout.defaultGrid(1), { rows: 1, cols: 1 });
  assert.deepStrictEqual(BoardLayout.defaultGrid(2), { rows: 1, cols: 2 });
  assert.deepStrictEqual(BoardLayout.defaultGrid(3), { rows: 2, cols: 2 });
  assert.deepStrictEqual(BoardLayout.defaultGrid(4), { rows: 2, cols: 2 });
  assert.deepStrictEqual(BoardLayout.defaultGrid(5), { rows: 2, cols: 3 });
});

check("panelLabel : (a),(b)... puis (#27)", function () {
  assert.strictEqual(BoardLayout.panelLabel(0), "(a)");
  assert.strictEqual(BoardLayout.panelLabel(2), "(c)");
  assert.strictEqual(BoardLayout.panelLabel(26), "(#27)");
});

check("composeBoard : reaffecte les axes par panneau", function () {
  const spec = BoardLayout.composeBoard([fig("A", "u"), fig("B", "w")], { rows: 1, cols: 2 });
  assert.strictEqual(spec.data.length, 2);
  assert.strictEqual(spec.data[0].xaxis, "x");
  assert.strictEqual(spec.data[0].yaxis, "y");
  assert.strictEqual(spec.data[1].xaxis, "x2");
  assert.strictEqual(spec.data[1].yaxis, "y2");
});

check("composeBoard : un couple d'axes par panneau avec domaines", function () {
  const spec = BoardLayout.composeBoard([fig("A", "u"), fig("B", "w")], { rows: 1, cols: 2 });
  assert.ok(spec.layout.xaxis && Array.isArray(spec.layout.xaxis.domain), "xaxis.domain");
  assert.ok(spec.layout.xaxis2 && Array.isArray(spec.layout.xaxis2.domain), "xaxis2.domain");
  assert.ok(spec.layout.yaxis2 && Array.isArray(spec.layout.yaxis2.domain), "yaxis2.domain");
  // 2 colonnes : le panneau (a) est a gauche du (b)
  assert.ok(spec.layout.xaxis.domain[1] <= spec.layout.xaxis2.domain[0] + 1e-9, "(a) a gauche de (b)");
  // anchors croises
  assert.strictEqual(spec.layout.xaxis2.anchor, "y2");
  assert.strictEqual(spec.layout.yaxis2.anchor, "x2");
});

check("composeBoard : recopie titres et echelle d'axe de la source", function () {
  const spec = BoardLayout.composeBoard([fig("A", "u")], { rows: 1, cols: 1 });
  assert.deepStrictEqual(spec.layout.xaxis.title, { text: "t" });
  assert.strictEqual(spec.layout.yaxis.type, "log");
});

check("composeBoard : annotations (a)/(b) par panneau", function () {
  const spec = BoardLayout.composeBoard([fig("A", "u"), fig("B", "w")], { rows: 2, cols: 1 });
  const texts = spec.layout.annotations.map(function (a) { return a.text; });
  assert.deepStrictEqual(texts, ["(a)", "(b)"]);
  assert.ok(spec.layout.annotations.every(function (a) { return a.xref === "paper" && a.yref === "paper"; }));
});

check("composeBoard : legende unique, dedoublonnee par nom", function () {
  // deux figures avec une trace de meme nom -> une seule entree de legende
  const spec = BoardLayout.composeBoard([fig("A", "signal"), fig("B", "signal")], { rows: 1, cols: 2 });
  const shown = spec.data.filter(function (t) { return t.showlegend; });
  assert.strictEqual(shown.length, 1, "une seule entree de legende");
  assert.strictEqual(spec.layout.showlegend, true);
  assert.strictEqual(spec.layout.legend.orientation, "h");   // bas = horizontale
});

check("composeBoard : legend 'none' masque toutes les entrees", function () {
  const spec = BoardLayout.composeBoard([fig("A", "u"), fig("B", "w")], { rows: 1, cols: 2, legend: "none" });
  assert.ok(spec.data.every(function (t) { return t.showlegend === false; }));
  assert.strictEqual(spec.layout.showlegend, false);
});

check("composeBoard : width_in cible + height_in proportionnel a la grille", function () {
  const spec = BoardLayout.composeBoard([fig("A", "u"), fig("B", "w")], { rows: 1, cols: 2, widthIn: 7 });
  assert.strictEqual(spec.width_in, 7);
  // 2 colonnes, 1 ligne, aspect source 0.5 -> cellWin=3.5, cellHin=1.75, grille=1.75
  // denom = 1 - 0.12 (legende bas) = 0.88 -> ~1.989
  assert.ok(spec.height_in > 1.9 && spec.height_in < 2.1, "height_in=" + spec.height_in);
});

check("composeBoard : ne place que rows*cols figures", function () {
  const spec = BoardLayout.composeBoard([fig("A", "u"), fig("B", "w"), fig("C", "z")], { rows: 1, cols: 2 });
  // 2 cellules -> 2 panneaux, la 3e figure est ignoree
  assert.ok(!spec.layout.xaxis3, "pas de 3e panneau");
  assert.strictEqual(spec.layout.annotations.length, 2);
});

console.log("\n" + passed + " tests OK");
