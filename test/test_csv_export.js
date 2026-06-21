// Harnais de test sans dependance pour media/csv_export.js
// Lancer : node test/test_csv_export.js
"use strict";
const assert = require("assert");
const CSV = require("../media/csv_export.js");

let passed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log("ok   - " + name); }
  catch (e) { console.error("FAIL - " + name + " : " + e.message); process.exitCode = 1; }
}

// --- csvEscape ---
check("csvEscape: nombre/texte simple inchange", function () {
  assert.strictEqual(CSV.csvEscape("abc"), "abc");
  assert.strictEqual(CSV.csvEscape(12), "12");
});
check("csvEscape: virgule -> guillemets", function () {
  assert.strictEqual(CSV.csvEscape("a,b"), '"a,b"');
});
check("csvEscape: guillemet double -> double + entoure", function () {
  assert.strictEqual(CSV.csvEscape('a"b'), '"a""b"');
});
check("csvEscape: saut de ligne -> guillemets", function () {
  assert.strictEqual(CSV.csvEscape("a\nb"), '"a\nb"');
});

// --- buildCsv : series xy ---
check("buildCsv: une serie xy", function () {
  const out = CSV.buildCsv([{ name: "A", x: [0, 1], y: [2, 3] }]);
  assert.strictEqual(out, "serie,x,y\nA,0,2\nA,1,3\n");
});
check("buildCsv: y null -> champ vide", function () {
  const out = CSV.buildCsv([{ name: "A", x: [0, 1], y: [2, null] }]);
  assert.strictEqual(out, "serie,x,y\nA,0,2\nA,1,\n");
});
check("buildCsv: nom avec virgule echappe", function () {
  const out = CSV.buildCsv([{ name: "a,b", x: [0], y: [1] }]);
  assert.strictEqual(out, 'serie,x,y\n"a,b",0,1\n');
});
check("buildCsv: deux series", function () {
  const out = CSV.buildCsv([
    { name: "A", x: [0], y: [1] },
    { name: "B", x: [5], y: [9] },
  ]);
  assert.strictEqual(out, "serie,x,y\nA,0,1\nB,5,9\n");
});

// --- buildCsv : filtre par plage x visible ---
check("buildCsv: xRange limite les points (bornes incluses)", function () {
  const out = CSV.buildCsv([{ name: "A", x: [0, 1, 2, 3], y: [0, 10, 20, 30] }], { xRange: [1, 2] });
  assert.strictEqual(out, "serie,x,y\nA,1,10\nA,2,20\n");
});
check("buildCsv: xRange inversee toleree", function () {
  const out = CSV.buildCsv([{ name: "A", x: [0, 1, 2], y: [0, 10, 20] }], { xRange: [2, 0] });
  assert.strictEqual(out, "serie,x,y\nA,0,0\nA,1,10\nA,2,20\n");
});

// --- buildCsv : grille (heatmap z 2D) ---
check("buildCsv: serie grille ajoute la colonne z", function () {
  const out = CSV.buildCsv([{ name: "H", x: [0, 1], y: [10, 20], z: [[1, 2], [3, 4]] }]);
  assert.strictEqual(out, "serie,x,y,z\nH,0,10,1\nH,1,10,2\nH,0,20,3\nH,1,20,4\n");
});
check("buildCsv: colonne z presente des qu'une serie a un z, vide ailleurs", function () {
  const out = CSV.buildCsv([
    { name: "L", x: [0], y: [5] },
    { name: "H", x: [0], y: [1], z: [[7]] },
  ]);
  assert.strictEqual(out, "serie,x,y,z\nL,0,5,\nH,0,1,7\n");
});

// --- buildCsv : robustesse ---
check("buildCsv: aucune serie -> en-tete seul", function () {
  assert.strictEqual(CSV.buildCsv([]), "serie,x,y\n");
});

console.log("\n" + passed + " tests OK");
