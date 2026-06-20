// Harnais de test sans dependance pour media/error_math.js
// Lancer : node test/test_error_curves.js
"use strict";
const assert = require("assert");
const EM = require("../media/error_math.js");

let passed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log("ok   - " + name); }
  catch (e) { console.error("FAIL - " + name + " : " + e.message); process.exitCode = 1; }
}
function approx(a, b, eps) { return Math.abs(a - b) <= (eps == null ? 1e-9 : eps); }

// --- interpLinear ---
check("interpLinear: grille identique renvoie les memes y", function () {
  const r = EM.interpLinear([0, 1, 2], [0, 1, 2], [10, 20, 30]);
  assert.deepStrictEqual(r, [10, 20, 30]);
});
check("interpLinear: point milieu interpole", function () {
  const r = EM.interpLinear([0.5], [0, 1], [0, 10]);
  assert.ok(approx(r[0], 5), "attendu 5, recu " + r[0]);
});
check("interpLinear: hors plage -> null", function () {
  const r = EM.interpLinear([-1, 3], [0, 1, 2], [0, 1, 2]);
  assert.deepStrictEqual(r, [null, null]);
});
check("interpLinear: borne y null -> null", function () {
  const r = EM.interpLinear([0.5], [0, 1], [null, 10]);
  assert.strictEqual(r[0], null);
});
check("interpLinear: n=1 avec y null -> null", function () {
  assert.strictEqual(EM.interpLinear([0], [0], [null])[0], null);
});
check("interpLinear: borne y NaN -> null", function () {
  const r = EM.interpLinear([0.5], [0, 1], [NaN, 10]);
  assert.strictEqual(r[0], null);
});

// --- computeError ---
check("computeError: difference signee", function () {
  assert.strictEqual(EM.computeError("signed", 10, 12), 2);
});
check("computeError: erreur absolue", function () {
  assert.strictEqual(EM.computeError("abs", 10, 8), 2);
});
check("computeError: erreur relative", function () {
  assert.ok(approx(EM.computeError("rel", 10, 11), 0.1));
});
check("computeError: erreur relative %", function () {
  assert.ok(approx(EM.computeError("relpct", 10, 11), 10));
});
check("computeError: yRef ~ 0 en relatif -> null", function () {
  assert.strictEqual(EM.computeError("rel", 0, 5), null);
  assert.strictEqual(EM.computeError("relpct", 1e-15, 5), null);
});
check("computeError: yRef ~ 0 en signe reste defini", function () {
  assert.strictEqual(EM.computeError("signed", 0, 5), 5);
});
check("computeError: entree null -> null", function () {
  assert.strictEqual(EM.computeError("signed", null, 5), null);
  assert.strictEqual(EM.computeError("abs", 5, NaN), null);
});
check("ERROR_TYPES: 4 types avec label et abbr", function () {
  ["signed", "abs", "rel", "relpct"].forEach(function (id) {
    assert.ok(EM.ERROR_TYPES[id], "type manquant : " + id);
    assert.ok(EM.ERROR_TYPES[id].label, "label manquant : " + id);
    assert.ok(EM.ERROR_TYPES[id].abbr, "abbr manquant : " + id);
  });
});

// --- buildErrorSeries ---
check("buildErrorSeries: grilles identiques, difference signee", function () {
  const s = EM.buildErrorSeries("signed", [0, 1, 2], [0, 10, 20], [0, 1, 2], [0, 12, 19]);
  assert.deepStrictEqual(s.x, [0, 1, 2]);
  assert.deepStrictEqual(s.y, [0, 2, -1]);
});
check("buildErrorSeries: grille cible plus fine, interpole", function () {
  // ref aux x 0,2 ; cible echantillonnee 0,1,2,3,4 -> valeur a x=2 interpolee
  const s = EM.buildErrorSeries("signed", [0, 2], [0, 0], [0, 1, 2, 3, 4], [0, 5, 10, 15, 20]);
  assert.ok(Math.abs(s.y[0] - 0) < 1e-9);
  assert.ok(Math.abs(s.y[1] - 10) < 1e-9);
});
check("buildErrorSeries: cible non triee est triee avant interpolation", function () {
  const s = EM.buildErrorSeries("signed", [1], [0], [2, 0], [20, 0]);
  assert.ok(Math.abs(s.y[0] - 10) < 1e-9, "attendu 10, recu " + s.y[0]);
});
check("buildErrorSeries: recouvrement partiel -> trous (null)", function () {
  // cible couvre [1,2] ; ref demande x=0 (hors) et x=1.5 (dedans)
  const s = EM.buildErrorSeries("signed", [0, 1.5], [0, 0], [1, 2], [10, 20]);
  assert.strictEqual(s.y[0], null);
  assert.ok(Math.abs(s.y[1] - 15) < 1e-9);
});
check("buildErrorSeries: axe date (timestamps) fonctionne", function () {
  const t0 = Date.parse("2020-01-01"), t1 = Date.parse("2020-01-02");
  const s = EM.buildErrorSeries("signed", [t0, t1], [1, 2], [t0, t1], [1, 5]);
  assert.deepStrictEqual(s.y, [0, 3]);
});
check("buildErrorSeries: NaN cible propage en null", function () {
  const s = EM.buildErrorSeries("abs", [0.5], [0], [0, 1], [0, NaN]);
  assert.strictEqual(s.y[0], null);
});

console.log("\n" + passed + " tests passes");
