// Harnais de test sans dependance pour media/inset_layout.js
// Lancer : node test/test_inset_layout.js
"use strict";
const assert = require("assert");
const IL = require("../media/inset_layout.js");

let passed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log("ok   - " + name); }
  catch (e) { console.error("FAIL - " + name + " : " + e.message); process.exitCode = 1; }
}

const X = [0.08, 0.96];
const Y = [0.12, 0.94];

// --- makeInsetCandidates ---
check("makeInsetCandidates: tous les candidats sont dans le domaine", function () {
  const c = IL.makeInsetCandidates(X, Y);
  assert.ok(c.length > 0, "aucun candidat");
  c.forEach(function (k) {
    assert.ok(k.x0 >= X[0] - 1e-9 && k.x1 <= X[1] + 1e-9, "hors domaine x");
    assert.ok(k.y0 >= Y[0] - 1e-9 && k.y1 <= Y[1] + 1e-9, "hors domaine y");
  });
});
check("makeInsetCandidates: les 4 coins sont presents (cornerKind=2 >= 4)", function () {
  const c = IL.makeInsetCandidates(X, Y);
  const corners = c.filter(function (k) { return k.cornerKind === 2; });
  assert.ok(corners.length >= 4, "coins attendus >=4, recu " + corners.length);
});
check("makeInsetCandidates: grille plus fine (>3 positions x distinctes)", function () {
  const c = IL.makeInsetCandidates(X, Y);
  const xs = {};
  c.forEach(function (k) { xs[k.x0.toFixed(4)] = true; });
  assert.ok(Object.keys(xs).length > 3, "positions x distinctes <= 3");
});

// --- scoreInsetCandidate ---
function cand(x0, x1, y0, y1, sizeIndex, cornerKind) {
  return { x0: x0, x1: x1, y0: y0, y1: y1, xDomain: [x0, x1], yDomain: [y0, y1],
           outerXDomain: X, outerYDomain: Y, sizeIndex: sizeIndex || 0, cornerKind: cornerKind || 0 };
}
check("scoreInsetCandidate: une region vide bat une region chargee", function () {
  // points groupes dans le coin bas-gauche (paper ~ 0.1,0.15)
  const ctx = { xDomain: X, yDomain: Y, xFull: [0, 10], yFull: [0, 10],
                traces: [{ x: [0, 0.1, 0.2, 0.3], y: [0, 0.1, 0.2, 0.3] }] };
  const occupied = cand(0.08, 0.30, 0.12, 0.34, 0, 2); // couvre le cluster
  const empty = cand(0.74, 0.96, 0.72, 0.94, 0, 2);    // coin oppose vide
  assert.ok(IL.scoreInsetCandidate(empty, ctx) < IL.scoreInsetCandidate(occupied, ctx),
    "le vide devrait mieux scorer");
});
check("scoreInsetCandidate: coin < bord < centre (occupation egale)", function () {
  const ctx = { xDomain: X, yDomain: Y, xFull: [0, 10], yFull: [0, 10], traces: [] };
  const corner = cand(0.74, 0.96, 0.72, 0.94, 0, 2);
  const edge = cand(0.40, 0.62, 0.72, 0.94, 0, 1);
  const center = cand(0.40, 0.62, 0.40, 0.62, 0, 0);
  const sc = IL.scoreInsetCandidate(corner, ctx);
  const se = IL.scoreInsetCandidate(edge, ctx);
  const sm = IL.scoreInsetCandidate(center, ctx);
  assert.ok(sc < se, "coin doit battre bord");
  assert.ok(se < sm, "bord doit battre centre");
});
check("scoreInsetCandidate: recouvrir la selection est redhibitoire", function () {
  const ctx = { xDomain: X, yDomain: Y, xFull: [0, 10], yFull: [0, 10], traces: [],
                selectedPaper: { x0: 0.40, x1: 0.62, y0: 0.40, y1: 0.62 } };
  const overlapsSel = cand(0.40, 0.62, 0.40, 0.62, 0, 0); // centre, sur la selection
  const cleanCenter = cand(0.74, 0.96, 0.12, 0.34, 0, 2); // coin, hors selection
  assert.ok(IL.scoreInsetCandidate(cleanCenter, ctx) < IL.scoreInsetCandidate(overlapsSel, ctx),
    "ne jamais couvrir la selection");
});

// --- chooseInsetDomain ---
check("chooseInsetDomain: evite le cluster de points", function () {
  const ctx = { xDomain: X, yDomain: Y, xFull: [0, 10], yFull: [0, 10],
                traces: [{ x: [0, 0.1, 0.2, 0.3, 0.4], y: [0, 0.1, 0.2, 0.3, 0.4] }] };
  const p = IL.chooseInsetDomain(ctx);
  // aucun point du cluster ne tombe dans l'inset choisi
  const xs = ctx.traces[0].x, ys = ctx.traces[0].y;
  let inside = 0;
  for (let i = 0; i < xs.length; i++) {
    const px = X[0] + (xs[i] - 0) / (10 - 0) * (X[1] - X[0]);
    const py = Y[0] + (ys[i] - 0) / (10 - 0) * (Y[1] - Y[0]);
    if (px >= p.xDomain[0] && px <= p.xDomain[1] && py >= p.yDomain[0] && py <= p.yDomain[1]) { inside++; }
  }
  assert.strictEqual(inside, 0, "l'inset ne devrait couvrir aucun point");
});

// --- clampPlacement ---
check("clampPlacement: rectangle valide inchange", function () {
  const r = IL.clampPlacement({ x0: 0.5, x1: 0.7, y0: 0.5, y1: 0.7 }, X, Y, 0.12);
  assert.ok(Math.abs(r.xDomain[0] - 0.5) < 1e-9 && Math.abs(r.xDomain[1] - 0.7) < 1e-9);
  assert.ok(Math.abs(r.yDomain[0] - 0.5) < 1e-9 && Math.abs(r.yDomain[1] - 0.7) < 1e-9);
});
check("clampPlacement: hors domaine ramene dans les bornes", function () {
  const r = IL.clampPlacement({ x0: -0.2, x1: 0.0, y0: 1.0, y1: 1.2 }, X, Y, 0.12);
  assert.ok(r.xDomain[0] >= X[0] - 1e-9 && r.xDomain[1] <= X[1] + 1e-9, "x hors bornes");
  assert.ok(r.yDomain[0] >= Y[0] - 1e-9 && r.yDomain[1] <= Y[1] + 1e-9, "y hors bornes");
});
check("clampPlacement: trop petit ramene a la taille mini", function () {
  const r = IL.clampPlacement({ x0: 0.5, x1: 0.52, y0: 0.5, y1: 0.51 }, X, Y, 0.12);
  assert.ok(r.xDomain[1] - r.xDomain[0] >= 0.12 - 1e-9, "largeur mini non respectee");
  assert.ok(r.yDomain[1] - r.yDomain[0] >= 0.12 - 1e-9, "hauteur mini non respectee");
});

console.log("\n" + passed + " tests OK");
