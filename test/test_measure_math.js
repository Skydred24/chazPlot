// Harnais de test sans dependance pour media/measure_math.js
// Lancer : node test/test_measure_math.js
"use strict";
const assert = require("assert");
const MM = require("../media/measure_math.js");

let passed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log("ok   - " + name); }
  catch (e) { console.error("FAIL - " + name + " : " + e.message); process.exitCode = 1; }
}
function approx(a, b, eps) { return Math.abs(a - b) <= (eps == null ? 1e-9 : eps); }

// --- segmentMetrics ---
check("segmentMetrics: dx/dy/pente/distance", function () {
  const m = MM.segmentMetrics(0, 0, 2, 4);
  assert.ok(approx(m.dx, 2));
  assert.ok(approx(m.dy, 4));
  assert.ok(approx(m.slope, 2));
  assert.ok(approx(m.distance, Math.sqrt(20)));
});
check("segmentMetrics: segment vertical -> pente null", function () {
  const m = MM.segmentMetrics(1, 0, 1, 5);
  assert.ok(approx(m.dx, 0));
  assert.ok(approx(m.dy, 5));
  assert.strictEqual(m.slope, null);
});

// --- areaUnderCurve (trapezes, interpolation aux bornes) ---
check("areaUnderCurve: y=x sur [0,3] = 4.5", function () {
  const a = MM.areaUnderCurve([0, 1, 2, 3], [0, 1, 2, 3], 0, 3);
  assert.ok(approx(a, 4.5), "recu " + a);
});
check("areaUnderCurve: bornes interpolees [0.5,2.5] sur y=x = 3", function () {
  const a = MM.areaUnderCurve([0, 1, 2, 3], [0, 1, 2, 3], 0.5, 2.5);
  assert.ok(approx(a, 3), "recu " + a);
});
check("areaUnderCurve: plage inversee donne le meme resultat", function () {
  const a = MM.areaUnderCurve([0, 1, 2, 3], [0, 1, 2, 3], 2.5, 0.5);
  assert.ok(approx(a, 3), "recu " + a);
});
check("areaUnderCurve: donnees non triees en x", function () {
  const a = MM.areaUnderCurve([3, 0, 2, 1], [3, 0, 2, 1], 0, 3);
  assert.ok(approx(a, 4.5), "recu " + a);
});
check("areaUnderCurve: ignore les points y non finis", function () {
  const a = MM.areaUnderCurve([0, 1, 2], [0, NaN, 2], 0, 2);
  // segment 0->2 reconstruit en sautant le point milieu invalide : (0+2)/2*2 = 2
  assert.ok(approx(a, 2), "recu " + a);
});

// --- rangeStats ---
check("rangeStats: min/max/moyenne/compte sur la plage", function () {
  const s = MM.rangeStats([0, 1, 2, 3], [5, 1, 9, 2], 1, 3);
  assert.strictEqual(s.count, 3);
  assert.ok(approx(s.min, 1));
  assert.ok(approx(s.max, 9));
  assert.ok(approx(s.mean, 4));
  assert.ok(approx(s.sum, 12));
});
check("rangeStats: plage inversee toleree", function () {
  const s = MM.rangeStats([0, 1, 2, 3], [5, 1, 9, 2], 3, 1);
  assert.strictEqual(s.count, 3);
});
check("rangeStats: aucun point dans la plage -> count 0, stats null", function () {
  const s = MM.rangeStats([0, 1, 2], [0, 1, 2], 5, 6);
  assert.strictEqual(s.count, 0);
  assert.strictEqual(s.min, null);
  assert.strictEqual(s.mean, null);
});
check("rangeStats: ignore les y non finis", function () {
  const s = MM.rangeStats([0, 1, 2], [10, NaN, 20], 0, 2);
  assert.strictEqual(s.count, 2);
  assert.ok(approx(s.mean, 15));
});

console.log("\n" + passed + " tests OK");
