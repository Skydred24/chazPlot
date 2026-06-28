// test/test_curve_digitize.js — tests du module pur de digitalisation de courbes.
// Lancer : node test/test_curve_digitize.js
"use strict";
const assert = require("assert");
const CD = require("../media/curve_digitize.js");

let passed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log("ok   - " + name); }
  catch (e) { console.error("FAIL - " + name + " : " + e.message); process.exitCode = 1; }
}

// --- helpers image synthetique ---
function makeImage(w, h, bg) {
  bg = bg || [255, 255, 255];
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = bg[0]; data[i * 4 + 1] = bg[1]; data[i * 4 + 2] = bg[2]; data[i * 4 + 3] = 255;
  }
  return { width: w, height: h, data: data };
}
function setPx(img, x, y, c) {
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return;
  const i = (y * img.width + x) * 4;
  img.data[i] = c[0]; img.data[i + 1] = c[1]; img.data[i + 2] = c[2]; img.data[i + 3] = 255;
}
function drawHLine(img, y, x0, x1, c) { for (let x = x0; x <= x1; x++) setPx(img, x, y, c); }
function drawVLine(img, x, y0, y1, c) { for (let y = y0; y <= y1; y++) setPx(img, x, y, c); }
function drawSeg(img, x0, y0, x1, y1, c) {
  const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx - dy, x = x0, y = y0;
  for (;;) {
    setPx(img, x, y, c);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x += sx; }
    if (e2 < dx) { err += dx; y += sy; }
  }
}

check("pixelsToData : lineaire, y pixel inverse", function () {
  const box = { x0: 0, y0: 0, x1: 100, y1: 100 };
  const calib = { xmin: 0, xmax: 10, ymin: 0, ymax: 20, xlog: false, ylog: false };
  const out = CD.pixelsToData([{ xpx: 50, ypx: 50 }, { xpx: 0, ypx: 100 }, { xpx: 100, ypx: 0 }], box, calib);
  assert.ok(Math.abs(out[0].x - 5) < 1e-9 && Math.abs(out[0].y - 10) < 1e-9);
  assert.ok(Math.abs(out[1].x - 0) < 1e-9 && Math.abs(out[1].y - 0) < 1e-9);
  assert.ok(Math.abs(out[2].x - 10) < 1e-9 && Math.abs(out[2].y - 20) < 1e-9);
});

check("pixelsToData : echelle log en X", function () {
  const box = { x0: 0, y0: 0, x1: 100, y1: 100 };
  const calib = { xmin: 1, xmax: 1000, ymin: 0, ymax: 1, xlog: true, ylog: false };
  const out = CD.pixelsToData([{ xpx: 50, ypx: 0 }], box, calib);
  assert.ok(Math.abs(out[0].x - Math.pow(10, 1.5)) < 1e-6);
});

check("detectBackground : fond blanc malgre quelques pixels colores", function () {
  const img = makeImage(40, 30);
  drawSeg(img, 0, 0, 39, 29, [200, 0, 0]); // une diagonale rouge
  const bg = CD.detectBackground(img, { x0: 0, y0: 0, x1: 39, y1: 29 });
  assert.ok(bg.r >= 240 && bg.g >= 240 && bg.b >= 240, "fond proche du blanc");
});

check("detectPlotBox : cadre noir detecte", function () {
  const img = makeImage(120, 100);
  drawVLine(img, 10, 10, 90, [0, 0, 0]);
  drawVLine(img, 110, 10, 90, [0, 0, 0]);
  drawHLine(img, 10, 10, 110, [0, 0, 0]);
  drawHLine(img, 90, 10, 110, [0, 0, 0]);
  const box = CD.detectPlotBox(img);
  assert.deepStrictEqual(box, { x0: 10, y0: 10, x1: 110, y1: 90 });
});

check("clusterCurveColors : 2 courbes colorees -> 2 clusters", function () {
  const img = makeImage(120, 100);
  drawVLine(img, 10, 10, 90, [0, 0, 0]); drawVLine(img, 110, 10, 90, [0, 0, 0]);
  drawHLine(img, 10, 10, 110, [0, 0, 0]); drawHLine(img, 90, 10, 110, [0, 0, 0]);
  const box = { x0: 10, y0: 10, x1: 110, y1: 90 };
  drawSeg(img, 20, 80, 100, 20, [220, 0, 0]);   // rouge montante
  drawSeg(img, 20, 20, 100, 80, [0, 0, 220]);   // bleue descendante
  const clusters = CD.clusterCurveColors(img, box);
  assert.strictEqual(clusters.length, 2);
  const reds = clusters.filter(function (c) { return c.color[0] > 150 && c.color[2] < 80; });
  const blues = clusters.filter(function (c) { return c.color[2] > 150 && c.color[0] < 80; });
  assert.strictEqual(reds.length, 1);
  assert.strictEqual(blues.length, 1);
});

check("detectLineStyle : solid / dashed / dotted / markers", function () {
  const box = { x0: 0, y0: 0, x1: 100, y1: 50 };
  function cols(present, builder) {
    const px = [];
    for (let x = 0; x < 100; x++) if (present(x)) builder(px, x);
    return px;
  }
  const solid = cols(function () { return true; }, function (px, x) { px.push({ x: x, y: 25 }); });
  const dashed = cols(function (x) { return (x % 10) < 6; }, function (px, x) { px.push({ x: x, y: 25 }); });
  const dotted = cols(function (x) { return (x % 5) === 0; }, function (px, x) { px.push({ x: x, y: 25 }); });
  const markers = cols(function (x) { return (x % 20) < 3; }, function (px, x) {
    for (let dy = -2; dy <= 2; dy++) px.push({ x: x, y: 25 + dy });
  });
  assert.strictEqual(CD.detectLineStyle(solid, box).style, "solid");
  assert.strictEqual(CD.detectLineStyle(dashed, box).style, "dashed");
  assert.strictEqual(CD.detectLineStyle(dotted, box).style, "dotted");
  assert.strictEqual(CD.detectLineStyle(markers, box).style, "markers");
});

check("extractCurves : courbe simple, pas d'ambiguite", function () {
  const img = makeImage(120, 100);
  const box = { x0: 10, y0: 10, x1: 110, y1: 90 };
  drawSeg(img, 20, 80, 100, 30, [220, 0, 0]);
  const clusters = CD.clusterCurveColors(img, box);
  const curves = CD.extractCurves(clusters, box);
  assert.strictEqual(curves.length, 1);
  assert.ok(curves[0].points.length > 50);
  assert.strictEqual(curves[0].ambiguous.length, 0);
  // monotonie globale : y pixel decroit quand x croit
  const first = curves[0].points[0], last = curves[0].points[curves[0].points.length - 1];
  assert.ok(last.ypx < first.ypx);
});

check("extractCurves : croisement MEME couleur -> zone ambigue signalee", function () {
  const img = makeImage(120, 100);
  const box = { x0: 10, y0: 10, x1: 110, y1: 90 };
  drawSeg(img, 20, 30, 100, 80, [0, 0, 0]);
  drawSeg(img, 20, 80, 100, 30, [0, 0, 0]);
  const clusters = CD.clusterCurveColors(img, box, { bg: { r: 255, g: 255, b: 255 } });
  const curves = CD.extractCurves(clusters, box);
  // une seule couleur -> un cluster, croisement -> ambigu
  assert.ok(curves[0].ambiguous.length >= 1);
});

check("traceFromSeeds : separe 2 courbes meme couleur qui se croisent", function () {
  const img = makeImage(120, 100);
  const c = [0, 0, 0];
  drawSeg(img, 20, 30, 100, 80, c); // A : monte (y pixel croit)
  drawSeg(img, 20, 80, 100, 30, c); // B : descend (y pixel decroit)
  const box = { x0: 10, y0: 10, x1: 110, y1: 90 };
  const pixels = [];
  for (let y = 11; y < 90; y++) for (let x = 11; x < 110; x++) {
    const i = (y * img.width + x) * 4;
    if (img.data[i] < 128) pixels.push({ x: x, y: y });
  }
  const traced = CD.traceFromSeeds(pixels, box, [{ x: 20, y: 30 }, { x: 20, y: 80 }]);
  assert.strictEqual(traced.length, 2);
  const a = traced[0].points, b = traced[1].points;
  // A part haut (y~30) et finit bas (y~80) ; B l'inverse
  assert.ok(a[a.length - 1].ypx > a[0].ypx);
  assert.ok(b[b.length - 1].ypx < b[0].ypx);
});

check("buildSpec : produit une spec scatter calibree", function () {
  const box = { x0: 0, y0: 0, x1: 100, y1: 100 };
  const calib = { xmin: 0, xmax: 10, ymin: 0, ymax: 10, xlog: false, ylog: false };
  const curves = [
    { color: [220, 0, 0], style: "solid", points: [{ xpx: 0, ypx: 100 }, { xpx: 100, ypx: 0 }], name: "rouge" },
    { color: [0, 0, 0], style: "markers", points: [{ xpx: 50, ypx: 50 }] }
  ];
  const spec = CD.buildSpec(curves, box, calib, "Test");
  assert.strictEqual(spec.title, "Test");
  assert.strictEqual(spec.plotly.data.length, 2);
  assert.strictEqual(spec.plotly.data[0].type, "scatter");
  assert.strictEqual(spec.plotly.data[0].mode, "lines");
  assert.strictEqual(spec.plotly.data[1].mode, "markers");
  assert.deepStrictEqual(spec.plotly.data[0].x, [0, 10]);
  assert.deepStrictEqual(spec.plotly.data[0].y, [0, 10]);
  assert.strictEqual(spec.plotly.data[0].name, "rouge");
});

check("buildSpec : echelle log reportee dans le layout", function () {
  const box = { x0: 0, y0: 0, x1: 100, y1: 100 };
  const calib = { xmin: 1, xmax: 100, ymin: 0, ymax: 1, xlog: true, ylog: false };
  const spec = CD.buildSpec([{ color: [0, 0, 0], style: "solid", points: [{ xpx: 0, ypx: 0 }] }], box, calib, "");
  assert.strictEqual(spec.plotly.layout.xaxis.type, "log");
});

check("clusterCurveColors : image anti-aliasee + grille -> 2 clusters (pas 50)", function () {
  const img = makeImage(200, 140);
  const box = { x0: 10, y0: 10, x1: 190, y1: 130 };
  drawVLine(img, 10, 10, 130, [0, 0, 0]); drawVLine(img, 190, 10, 130, [0, 0, 0]);
  drawHLine(img, 10, 10, 190, [0, 0, 0]); drawHLine(img, 130, 10, 190, [0, 0, 0]);
  // grille gris clair (doit etre ignoree)
  drawHLine(img, 70, 11, 189, [200, 200, 200]);
  drawVLine(img, 100, 11, 129, [200, 200, 200]);
  // deux courbes pointillees de couleurs distinctes, avec halo anti-aliasing
  function blend(c) { return [Math.round((c[0] + 255) / 2), Math.round((c[1] + 255) / 2), Math.round((c[2] + 255) / 2)]; }
  function aaDot(x, y, core) {
    setPx(img, x, y, core); const h = blend(core);
    setPx(img, x - 1, y, h); setPx(img, x + 1, y, h); setPx(img, x, y - 1, h); setPx(img, x, y + 1, h);
  }
  const red = [220, 20, 20], blue = [20, 20, 220];
  for (let x = 20; x < 180; x += 4) { aaDot(x, 40, red); aaDot(x, 100, blue); }
  const clusters = CD.clusterCurveColors(img, box);
  assert.strictEqual(clusters.length, 2, "attendu 2 clusters, obtenu " + clusters.length);
  const reds = clusters.filter(function (c) { return c.color[0] > c.color[2] + 40; });
  const blues = clusters.filter(function (c) { return c.color[2] > c.color[0] + 40; });
  assert.strictEqual(reds.length, 1, "1 cluster rouge");
  assert.strictEqual(blues.length, 1, "1 cluster bleu");
});

check("clusterCurveColors : amas clairseme plein-largeur (bruit) ecarte", function () {
  const img = makeImage(200, 140);
  const box = { x0: 10, y0: 10, x1: 190, y1: 130 };
  // une vraie courbe rouge dense
  for (let x = 20; x < 180; x++) setPx(img, x, 60, [220, 0, 0]);
  // bruit noir clairseme sur toute la largeur (1 pixel toutes les 20 colonnes)
  for (let x = 20; x < 180; x += 20) setPx(img, x, 100, [0, 0, 0]);
  const clusters = CD.clusterCurveColors(img, box);
  assert.strictEqual(clusters.length, 1, "seule la courbe dense survit");
  assert.ok(clusters[0].color[0] > 150 && clusters[0].color[2] < 80, "rouge");
});

check("colorMaskAt : isole la couleur cliquee, ignore l'autre", function () {
  const img = makeImage(120, 100);
  const box = { x0: 10, y0: 10, x1: 110, y1: 90 };
  for (let x = 20; x < 100; x++) { setPx(img, x, 40, [230, 100, 10]); setPx(img, x, 60, [250, 185, 100]); }
  const mask = CD.colorMaskAt(img, box, 50, 40); // clic sur l'orange fonce
  assert.deepStrictEqual(mask.color, [230, 100, 10]);
  assert.ok(mask.pixels.length > 50, "capture la courbe cliquee");
  assert.ok(mask.pixels.every(function (p) { return Math.abs(p.y - 40) <= 2; }), "n'inclut pas la courbe peche (y=60)");
});

check("colorMaskAt : exclut un echantillon de legende deconnecte (meme couleur)", function () {
  const img = makeImage(200, 140);
  const box = { x0: 10, y0: 10, x1: 190, y1: 130 };
  const red = [220, 30, 30];
  for (let x = 20; x < 180; x++) setPx(img, x, 40, red);   // la courbe
  for (let x = 30; x < 70; x++) setPx(img, x, 115, red);   // swatch de legende, meme couleur, deconnecte
  const m = CD.colorMaskAt(img, box, 100, 40);             // clic sur la courbe
  assert.ok(m.pixels.length > 100, "capture la courbe");
  assert.ok(m.pixels.every(function (p) { return p.y < 60; }), "n'inclut pas le swatch (y=115)");
});

check("mapPoints : 2 reperes par axe (lineaire + inversion Y)", function () {
  const calib = { x: { p0: 100, v0: 0, p1: 1000, v1: 10, log: false }, y: { p0: 900, v0: 0, p1: 100, v1: 1, log: false } };
  const out = CD.mapPoints([{ xpx: 550, ypx: 500 }], calib);
  assert.ok(Math.abs(out[0].x - 5) < 1e-9, "x=5");
  assert.ok(Math.abs(out[0].y - 0.5) < 1e-9, "y=0.5 (inversion)");
});

check("mapPoints : axe X log", function () {
  const calib = { x: { p0: 0, v0: 1, p1: 100, v1: 1000, log: true }, y: { p0: 0, v0: 0, p1: 100, v1: 1, log: false } };
  const out = CD.mapPoints([{ xpx: 50, ypx: 0 }], calib);
  assert.ok(Math.abs(out[0].x - Math.pow(10, 1.5)) < 1e-6);
});

check("traceRegion : couleur dominante dans la zone + mediane par colonne", function () {
  const img = makeImage(120, 100);
  const box = { x0: 10, y0: 10, x1: 110, y1: 90 };
  // courbe verte epaisse a y=40, + parasite magenta fin a y=70
  for (let x = 20; x < 100; x++) { for (let dy = -1; dy <= 1; dy++) setPx(img, x, 40 + dy, [0, 150, 0]); setPx(img, x, 70, [200, 0, 200]); }
  const c = CD.traceRegion(img, box, function () { return true; });
  assert.ok(c.color[1] > 100 && c.color[0] < 80, "vert dominant");
  assert.ok(c.points.length > 50, "points");
  assert.ok(c.points.every(function (p) { return Math.abs(p.ypx - 40) <= 2; }), "suit le vert (y=40), ignore le magenta");
});

// --- Brique 1 : brosse-guide (traceGuided) ---

check("traceGuided : suit le guide a travers un croisement meme couleur", function () {
  const img = makeImage(120, 100);
  const c = [0, 0, 0];
  drawSeg(img, 20, 30, 100, 80, c); // A : monte en y pixel
  drawSeg(img, 20, 80, 100, 30, c); // B : descend en y pixel (croise A au centre)
  const box = { x0: 10, y0: 10, x1: 110, y1: 90 };
  // guide grossier le long de A (pas forcement parfait)
  const stroke = [];
  for (let x = 20; x <= 100; x += 8) stroke.push({ x: x, y: Math.round(30 + (80 - 30) * (x - 20) / 80) });
  const g = CD.traceGuided(img, box, stroke, { brush: 10, bg: { r: 255, g: 255, b: 255 } });
  assert.ok(g.points.length > 30, "des points (" + g.points.length + ")");
  const first = g.points[0], last = g.points[g.points.length - 1];
  assert.ok(last.ypx > first.ypx, "suit A (y pixel croit), pas B");
  // a droite : proche de A(100)=80, loin de B(100)=30
  assert.ok(Math.abs(last.ypx - 80) < Math.abs(last.ypx - 30), "fin sur la branche A");
});

check("traceGuided : centroide sous-pixel pondere par l'intensite", function () {
  const img = makeImage(60, 60);
  const box = { x0: 0, y0: 0, x1: 59, y1: 59 };
  // coeur noir (lignes 39,40) + halo gris (ligne 41, poids plus faible)
  for (let x = 10; x < 50; x++) { setPx(img, x, 39, [0, 0, 0]); setPx(img, x, 40, [0, 0, 0]); setPx(img, x, 41, [128, 128, 128]); }
  const stroke = []; for (let x = 10; x < 50; x += 5) stroke.push({ x: x, y: 40 });
  const g = CD.traceGuided(img, box, stroke, { brush: 6, bg: { r: 255, g: 255, b: 255 }, colorTol: 500 });
  assert.ok(g.points.length > 20, "des points");
  const mid = g.points[Math.floor(g.points.length / 2)].ypx;
  // coeur en 39.5 ; non pondere ce serait 40 ; pondere tire vers le coeur
  assert.ok(mid > 39.5 && mid < 40, "sous-pixel tire vers le coeur (obtenu " + mid + ")");
});

check("traceGuided : guide decale snappe sur la vraie courbe", function () {
  const img = makeImage(80, 80);
  const box = { x0: 0, y0: 0, x1: 79, y1: 79 };
  for (let x = 10; x < 70; x++) setPx(img, x, 40, [200, 0, 0]); // courbe rouge y=40
  // guide volontairement decale de +6 px (dans le couloir brush=12)
  const stroke = []; for (let x = 10; x < 70; x += 6) stroke.push({ x: x, y: 46 });
  const g = CD.traceGuided(img, box, stroke, { brush: 12, bg: { r: 255, g: 255, b: 255 } });
  assert.ok(g.points.length > 30, "des points");
  assert.ok(g.points.every(function (p) { return Math.abs(p.ypx - 40) <= 1.5; }), "snap sur y=40 malgre guide a 46");
});

// --- Brique 2 : style robuste + pontage des trous ---

check("detectLineStyle : tiret-point (dashdot) distingue de dashed", function () {
  const box = { x0: 0, y0: 0, x1: 100, y1: 50 };
  const px = [];
  // motif periode 10 : tiret de 5 (0..4), trou (5,6), point (7), trou (8,9)
  for (let x = 0; x < 100; x++) if ((x % 10) < 5 || (x % 10) === 7) px.push({ x: x, y: 25 });
  assert.strictEqual(CD.detectLineStyle(px, box).style, "dashdot");
});

check("bridgeGaps : comble les trous de tirets par interpolation lineaire", function () {
  const pts = [{ xpx: 0, ypx: 10 }, { xpx: 1, ypx: 11 }, { xpx: 2, ypx: 12 }, { xpx: 7, ypx: 17 }, { xpx: 8, ypx: 18 }, { xpx: 9, ypx: 19 }];
  const out = CD.bridgeGaps(pts, { maxGap: 6 });
  assert.strictEqual(out.length, 10, "toutes les colonnes 0..9");
  const at5 = out.filter(function (p) { return p.xpx === 5; })[0];
  assert.ok(at5 && Math.abs(at5.ypx - 15) < 1e-6, "interpolation a x=5 -> 15");
});

check("bridgeGaps : laisse intact un trou plus grand que maxGap", function () {
  const pts = [{ xpx: 0, ypx: 0 }, { xpx: 1, ypx: 1 }, { xpx: 20, ypx: 20 }];
  const out = CD.bridgeGaps(pts, { maxGap: 5 });
  assert.strictEqual(out.length, 3, "grand trou non comble");
});

check("buildSpec : style dashdot reporte en dash plotly", function () {
  const box = { x0: 0, y0: 0, x1: 100, y1: 100 };
  const calib = { xmin: 0, xmax: 10, ymin: 0, ymax: 10, xlog: false, ylog: false };
  const spec = CD.buildSpec([{ color: [0, 0, 0], style: "dashdot", points: [{ xpx: 0, ypx: 0 }, { xpx: 100, ypx: 100 }] }], box, calib, "");
  assert.strictEqual(spec.plotly.data[0].line.dash, "dashdot");
});

check("detectLineStyle : trait EPAIS avec petits trous reste une ligne (pas markers)", function () {
  const box = { x0: 0, y0: 0, x1: 200, y1: 50 };
  const px = [];
  // trait epais (hauteur 5) couvrant 0..199 mais avec des petits trous (plages 6, trous 2)
  for (let x = 0; x < 200; x++) if ((x % 8) < 6) for (let dy = 0; dy < 5; dy++) px.push({ x: x, y: 22 + dy });
  const st = CD.detectLineStyle(px, box).style;
  assert.notStrictEqual(st, "markers", "trait epais troue ne doit pas devenir markers (obtenu " + st + ")");
});

check("detectLineStyle : vrais marqueurs (clairsemes, plus de trou que d'encre)", function () {
  const box = { x0: 0, y0: 0, x1: 200, y1: 50 };
  const px = [];
  // pastilles de 4 px tous les 25 px (gros trous) -> vrais markers
  for (let x = 0; x < 200; x++) if ((x % 25) < 4) for (let dy = 0; dy < 5; dy++) px.push({ x: x, y: 22 + dy });
  assert.strictEqual(CD.detectLineStyle(px, box).style, "markers");
});

check("dropSwatchPixels : retire une petite composante isolee (swatch legende)", function () {
  const px = [];
  for (let x = 0; x < 200; x++) px.push({ x: x, y: 50 + Math.round(x * 0.1) }); // courbe ~200 px continue
  for (let x = 0; x < 20; x++) px.push({ x: x, y: 120 });                        // swatch 20 px, isole loin en y
  const out = CD.dropSwatchPixels(px, { x0: 0, y0: 0, x1: 200, y1: 140 });
  assert.ok(out.length >= 195 && out.length <= 205, "courbe gardee (" + out.length + ")");
  assert.ok(out.every(function (p) { return p.y !== 120; }), "swatch retire");
});

check("dropSwatchPixels : ne casse pas une courbe en tirets", function () {
  const px = [];
  for (let x = 0; x < 200; x++) if ((x % 20) < 12) px.push({ x: x, y: 50 }); // tirets 12 on / 8 off
  const before = px.length;
  const out = CD.dropSwatchPixels(px, { x0: 0, y0: 0, x1: 200, y1: 60 }, { bridge: 4 });
  assert.ok(out.length >= before * 0.9, "dashes conserves (" + out.length + "/" + before + ")");
});

check("smoothPoints : lisse le jitter, garde la forme et les bords", function () {
  const pts = [];
  for (let x = 0; x <= 100; x++) pts.push({ xpx: x, ypx: 50 + (x % 2 === 0 ? 1 : -1) }); // dents de scie +-1
  const out = CD.smoothPoints(pts, { window: 5 });
  assert.strictEqual(out.length, pts.length, "meme nombre de points");
  // au milieu, le jitter +-1 doit etre fortement attenue
  const mid = out[50].ypx;
  assert.ok(Math.abs(mid - 50) < 0.4, "jitter attenue (obtenu " + mid + ")");
  // bords preserves (xpx inchanges)
  assert.strictEqual(out[0].xpx, 0);
  assert.strictEqual(out[100].xpx, 100);
});

check("savgolSmooth : preserve un pic quadratique", function () {
  const pts = []; for (let x = 0; x <= 100; x++) pts.push({ xpx: x, ypx: 100 - 0.04 * (x - 50) * (x - 50) });
  const out = CD.savgolSmooth(pts, { window: 11 });
  assert.ok(Math.abs(out[50].ypx - 100) < 0.2, "pic preserve (" + out[50].ypx + ")");
});

check("savgolSmooth : attenue le jitter", function () {
  const pts = []; for (let x = 0; x <= 100; x++) pts.push({ xpx: x, ypx: 50 + (x % 2 ? 1 : -1) });
  const out = CD.savgolSmooth(pts, { window: 11 });
  assert.ok(Math.abs(out[50].ypx - 50) < 0.3, "jitter attenue (" + out[50].ypx + ")");
});

check("decimate : reduit en gardant les bords", function () {
  const pts = []; for (let x = 0; x < 1000; x++) pts.push({ xpx: x, ypx: x });
  const out = CD.decimate(pts, { maxPoints: 100 });
  assert.strictEqual(out.length, 100);
  assert.strictEqual(out[0].xpx, 0);
  assert.strictEqual(out[99].xpx, 999);
});

// --- Brique 3 : anti-grille (lignes droites pleine etendue) ---

check("removeGridPixels : enleve une ligne pleine largeur, garde la diagonale", function () {
  const box = { x0: 0, y0: 0, x1: 100, y1: 80 };
  const px = [];
  for (let x = 0; x <= 100; x++) px.push({ x: x, y: 40 });               // grille horizontale
  for (let x = 0; x <= 100; x++) px.push({ x: x, y: Math.round(10 + x * 0.5) }); // courbe
  const out = CD.removeGridPixels(px, box);
  assert.ok(out.filter(function (p) { return p.y === 40; }).length <= 1, "ligne y=40 retiree");
  assert.ok(out.length >= 95 && out.length <= 105, "diagonale conservee (" + out.length + ")");
});

check("clusterCurveColors : grille grise foncee pleine largeur ecartee", function () {
  const img = makeImage(200, 140);
  const box = { x0: 10, y0: 10, x1: 190, y1: 130 };
  drawVLine(img, 10, 10, 130, [0, 0, 0]); drawVLine(img, 190, 10, 130, [0, 0, 0]);
  drawHLine(img, 10, 10, 190, [0, 0, 0]); drawHLine(img, 130, 10, 190, [0, 0, 0]);
  drawHLine(img, 70, 11, 189, [97, 97, 97]);     // grille grise foncee (bucket sombre)
  drawSeg(img, 20, 110, 180, 30, [0, 150, 0]);   // vraie courbe verte
  const clusters = CD.clusterCurveColors(img, box);
  assert.ok(clusters.some(function (c) { return c.color[1] > 100 && c.color[0] < 80; }), "courbe verte detectee");
  assert.ok(!clusters.some(function (c) {
    const mx = Math.max(c.color[0], c.color[1], c.color[2]), mn = Math.min(c.color[0], c.color[1], c.color[2]);
    return (mx - mn) < 20 && mx > 40 && mx < 140;
  }), "aucun cluster gris (grille retiree)");
});

// exporter les helpers pour les taches suivantes du meme fichier
module.exports = { makeImage: makeImage, setPx: setPx, drawHLine: drawHLine, drawVLine: drawVLine, drawSeg: drawSeg };

console.log("\n" + passed + " tests OK");
