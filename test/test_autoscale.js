// Harnais de test sans dependance pour media/autoscale.js
// Lancer : node test/test_autoscale.js
"use strict";
const assert = require("assert");
const AS = require("../media/autoscale.js");
let passed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log("ok   - " + name); }
  catch (e) { console.error("FAIL - " + name + " : " + e.message); process.exitCode = 1; }
}

check("visibleExtent: filtre sur la plage X", function () {
  const traces = [{ x: [0, 1, 2, 3], y: [10, 1, 1, 1000] }];
  // zone X hors du pic (1..2) -> etendue 1..1
  assert.deepStrictEqual(AS.visibleExtent(traces, "y", 1, 2), [1, 1]);
  // toute la plage -> 1..1000
  assert.deepStrictEqual(AS.visibleExtent(traces, "y", 0, 3), [1, 1000]);
});

check("visibleExtent: separe les axes y et y2", function () {
  const traces = [
    { yaxis: "y", x: [0, 1, 2], y: [5, 6, 7] },
    { yaxis: "y2", x: [0, 1, 2], y: [0.001, 0.002, 0.0005] }
  ];
  assert.deepStrictEqual(AS.visibleExtent(traces, "y", 0, 2), [5, 7]);
  assert.deepStrictEqual(AS.visibleExtent(traces, "y2", 0, 2), [0.0005, 0.002]);
});

check("visibleExtent: ignore les traces masquees et non finies", function () {
  const traces = [
    { x: [0, 1], y: [100, 200], hidden: true },
    { x: [0, 1, 2], y: [3, NaN, 9] }
  ];
  assert.deepStrictEqual(AS.visibleExtent(traces, "y", 0, 2), [3, 9]);
});

check("visibleExtent: null si aucun point", function () {
  assert.strictEqual(AS.visibleExtent([{ x: [0], y: [1] }], "y", 5, 6), null);
  assert.strictEqual(AS.visibleExtent([], "y", 0, 1), null);
});

check("padRange: marge normale et cas lo==hi", function () {
  assert.deepStrictEqual(AS.padRange(0, 10), [-0.6, 10.6]);
  const eq = AS.padRange(5, 5);
  assert.ok(eq[0] < 5 && eq[1] > 5);
  const zero = AS.padRange(0, 0);
  assert.deepStrictEqual(zero, [-0.05, 0.05]);
});

check("visibleYRanges: patch multi-axes, log ignore", function () {
  const axes = [
    { name: "yaxis", letter: "y", log: false },
    { name: "yaxis2", letter: "y2", log: false },
    { name: "yaxis3", letter: "y3", log: true }
  ];
  const traces = [
    { yaxis: "y", x: [0, 1], y: [0, 100] },
    { yaxis: "y2", x: [0, 1], y: [1, 1] },
    { yaxis: "y3", x: [0, 1], y: [10, 20] }
  ];
  const patch = AS.visibleYRanges(axes, traces, 0, 1);
  assert.deepStrictEqual(patch["yaxis.range"], [-6, 106]);
  assert.ok(patch["yaxis2.range"][0] < 1 && patch["yaxis2.range"][1] > 1);
  assert.ok(!("yaxis3.range" in patch));   // axe log ignore
});

if (process.exitCode) { process.exit(process.exitCode); }
console.log("\n" + passed + " tests OK");
