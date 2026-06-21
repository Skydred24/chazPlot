// Harnais de test sans dependance pour media/figure_filter.js
// Lancer : node test/test_figure_filter.js
"use strict";
const assert = require("assert");
const FF = require("../media/figure_filter.js");

let passed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log("ok   - " + name); }
  catch (e) { console.error("FAIL - " + name + " : " + e.message); process.exitCode = 1; }
}

// --- figKind ---
check("figKind: animation/plotly/svg/png/image", function () {
  assert.strictEqual(FF.figKind({ frames: [1] }), "animation");
  assert.strictEqual(FF.figKind({ plotly: {} }), "plotly");
  assert.strictEqual(FF.figKind({ svg: "x" }), "svg");
  assert.strictEqual(FF.figKind({ png: "x" }), "png");
  assert.strictEqual(FF.figKind({}), "image");
});

// --- matchesQuery ---
check("matchesQuery: requete vide -> vrai", function () {
  assert.strictEqual(FF.matchesQuery({ title: "A" }, ""), true);
});
check("matchesQuery: titre", function () {
  assert.strictEqual(FF.matchesQuery({ title: "Vitesse" }, "vite"), true);
  assert.strictEqual(FF.matchesQuery({ title: "Vitesse" }, "zzz"), false);
});
check("matchesQuery: tag", function () {
  assert.strictEqual(FF.matchesQuery({ title: "A", tags: ["physique"] }, "phys"), true);
});
check("matchesQuery: provenance (nom de script)", function () {
  const fig = { title: "A", provenance: { source: "/home/u/run_exp.py", line: 12 } };
  assert.strictEqual(FF.matchesQuery(fig, "run_exp"), true);
});
check("matchesQuery: provenance (branche/commit)", function () {
  const fig = { title: "A", provenance: { git_branch: "feature-x", git_commit: "abc1234" } };
  assert.strictEqual(FF.matchesQuery(fig, "feature-x"), true);
  assert.strictEqual(FF.matchesQuery(fig, "abc1234"), true);
});

// --- sortFigures ---
function figs() {
  return [
    { id: 1, title: "Bravo", plotly: {}, provenance: { source: "/x/b.py", timestamp: "2026-06-21T10:00:00Z" } },
    { id: 2, title: "alpha", frames: [1], provenance: { source: "/x/a.py", timestamp: "2026-06-21T12:00:00Z" } },
    { id: 3, title: "Charlie", svg: "x", provenance: { source: "/x/a.py", timestamp: "2026-06-21T11:00:00Z" } },
  ];
}
check("sortFigures: arrivee = ordre des id", function () {
  const r = FF.sortFigures(figs(), "arrival").map(function (f) { return f.id; });
  assert.deepStrictEqual(r, [1, 2, 3]);
});
check("sortFigures: titre insensible a la casse", function () {
  const r = FF.sortFigures(figs(), "title").map(function (f) { return f.title; });
  assert.deepStrictEqual(r, ["alpha", "Bravo", "Charlie"]);
});
check("sortFigures: type (kind alpha) puis id", function () {
  const r = FF.sortFigures(figs(), "type").map(function (f) { return FF.figKind(f); });
  // animation, plotly, svg
  assert.deepStrictEqual(r, ["animation", "plotly", "svg"]);
});
check("sortFigures: script (basename) puis id", function () {
  const r = FF.sortFigures(figs(), "script").map(function (f) { return f.id; });
  // a.py : id2, id3 ; b.py : id1
  assert.deepStrictEqual(r, [2, 3, 1]);
});
check("sortFigures: date decroissante (plus recent d'abord)", function () {
  const r = FF.sortFigures(figs(), "date").map(function (f) { return f.id; });
  // timestamps : id2 12h, id3 11h, id1 10h
  assert.deepStrictEqual(r, [2, 3, 1]);
});
check("sortFigures: mode inconnu -> ordre d'arrivee, sans muter l'entree", function () {
  const input = figs();
  const r = FF.sortFigures(input, "???").map(function (f) { return f.id; });
  assert.deepStrictEqual(r, [1, 2, 3]);
  assert.deepStrictEqual(input.map(function (f) { return f.id; }), [1, 2, 3]);
});

console.log("\n" + passed + " tests OK");
