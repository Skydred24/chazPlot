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

// --- paperRectToPixels ---
check("paperRectToPixels: mappe domaine -> pixels (y inverse)", function () {
  const size = { l: 50, t: 20, w: 400, h: 300 };
  const px = IL.paperRectToPixels({ xDomain: [0.25, 0.75], yDomain: [0.0, 1.0] }, size);
  assert.ok(Math.abs(px.left - (50 + 0.25 * 400)) < 1e-9, "left");
  assert.ok(Math.abs(px.width - (0.5 * 400)) < 1e-9, "width");
  assert.ok(Math.abs(px.top - 20) < 1e-9, "top (yDomain haut=1 -> top=t)");
  assert.ok(Math.abs(px.height - 300) < 1e-9, "height");
});

// --- pixelDeltaToPaper ---
check("pixelDeltaToPaper: dy inverse, normalise par la taille", function () {
  const size = { l: 0, t: 0, w: 200, h: 100 };
  const d = IL.pixelDeltaToPaper(20, 10, size);
  assert.ok(Math.abs(d.dx - 0.1) < 1e-9, "dx");
  assert.ok(Math.abs(d.dy - (-0.1)) < 1e-9, "dy inverse");
});

// --- movePlacement ---
check("movePlacement: translate les deux domaines", function () {
  const p = IL.movePlacement({ xDomain: [0.2, 0.4], yDomain: [0.5, 0.7] }, 0.1, -0.05);
  assert.ok(Math.abs(p.xDomain[0] - 0.3) < 1e-9 && Math.abs(p.xDomain[1] - 0.5) < 1e-9, "x");
  assert.ok(Math.abs(p.yDomain[0] - 0.45) < 1e-9 && Math.abs(p.yDomain[1] - 0.65) < 1e-9, "y");
});

// --- resizePlacement ---
check("resizePlacement: coin 'se' ancre le coin 'nw'", function () {
  // se = est + sud : bouge x1 (droite) et y0 (bas) ; x0 et y1 ancres
  const p = IL.resizePlacement({ xDomain: [0.2, 0.6], yDomain: [0.3, 0.7] }, "se", 0.1, -0.1, 0.12);
  assert.ok(Math.abs(p.xDomain[0] - 0.2) < 1e-9, "x0 ancre");
  assert.ok(Math.abs(p.xDomain[1] - 0.7) < 1e-9, "x1 deplace (+0.1)");
  assert.ok(Math.abs(p.yDomain[1] - 0.7) < 1e-9, "y1 ancre");
  assert.ok(Math.abs(p.yDomain[0] - 0.2) < 1e-9, "y0 deplace (dy=-0.1)");
});
check("resizePlacement: respecte la taille mini contre le coin ancre", function () {
  // nw = ouest + nord : bouge x0 et y1 ; on tente d'ecraser au-dela du mini
  const p = IL.resizePlacement({ xDomain: [0.2, 0.6], yDomain: [0.3, 0.7] }, "nw", 0.5, -0.5, 0.12);
  assert.ok(Math.abs(p.xDomain[0] - 0.48) < 1e-9, "x0 borne par mini (x1 - 0.12)");
  assert.ok(Math.abs(p.yDomain[1] - 0.42) < 1e-9, "y1 borne par mini (y0 + 0.12)");
});
check("resizePlacement: coin 'ne' ancre le coin 'sw' (les deux bords opposes intacts)", function () {
  // ne = est + nord : bouge x1 (droite) et y1 (haut) ; x0 et y0 ancres
  const p = IL.resizePlacement({ xDomain: [0.2, 0.6], yDomain: [0.3, 0.7] }, "ne", 0.1, 0.1, 0.12);
  assert.ok(Math.abs(p.xDomain[0] - 0.2) < 1e-9, "x0 ancre");
  assert.ok(Math.abs(p.xDomain[1] - 0.7) < 1e-9, "x1 deplace (+0.1)");
  assert.ok(Math.abs(p.yDomain[0] - 0.3) < 1e-9, "y0 ancre");
  assert.ok(Math.abs(p.yDomain[1] - 0.8) < 1e-9, "y1 deplace (+0.1)");
});
check("resizePlacement: coin 'sw' ancre le coin 'ne'", function () {
  // sw = ouest + sud : bouge x0 (gauche) et y0 (bas) ; x1 et y1 ancres
  const p = IL.resizePlacement({ xDomain: [0.2, 0.6], yDomain: [0.3, 0.7] }, "sw", -0.1, -0.1, 0.12);
  assert.ok(Math.abs(p.xDomain[0] - 0.1) < 1e-9, "x0 deplace (-0.1)");
  assert.ok(Math.abs(p.xDomain[1] - 0.6) < 1e-9, "x1 ancre");
  assert.ok(Math.abs(p.yDomain[0] - 0.2) < 1e-9, "y0 deplace (-0.1)");
  assert.ok(Math.abs(p.yDomain[1] - 0.7) < 1e-9, "y1 ancre");
});
check("resizePlacement: taille mini laisse le bord ancre intact", function () {
  // se ecrase a la taille mini : le coin nw (x0, y1) ne doit pas bouger
  const p = IL.resizePlacement({ xDomain: [0.2, 0.6], yDomain: [0.3, 0.7] }, "se", -0.5, 0.5, 0.12);
  assert.ok(Math.abs(p.xDomain[0] - 0.2) < 1e-9, "x0 (ancre) intact");
  assert.ok(Math.abs(p.yDomain[1] - 0.7) < 1e-9, "y1 (ancre) intact");
  assert.ok(Math.abs(p.xDomain[1] - 0.32) < 1e-9, "x1 borne par mini (x0 + 0.12)");
  assert.ok(Math.abs(p.yDomain[0] - 0.58) < 1e-9, "y0 borne par mini (y1 - 0.12)");
});
check("paperRectToPixels: yDomain partiel mappe le bon top (inversion)", function () {
  const size = { l: 0, t: 0, w: 100, h: 200 };
  const px = IL.paperRectToPixels({ xDomain: [0.0, 1.0], yDomain: [0.2, 0.6] }, size);
  // top = t + (1 - y1) * h = 0 + (1 - 0.6) * 200 = 80 ; height = (0.6 - 0.2) * 200 = 80
  assert.ok(Math.abs(px.top - 80) < 1e-9, "top = (1 - 0.6) * 200");
  assert.ok(Math.abs(px.height - 80) < 1e-9, "height = 0.4 * 200");
});

console.log("\n" + passed + " tests OK");
