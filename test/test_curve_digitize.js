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

// exporter les helpers pour les taches suivantes du meme fichier
module.exports = { makeImage: makeImage, setPx: setPx, drawHLine: drawHLine, drawVLine: drawVLine, drawSeg: drawSeg };

console.log("\n" + passed + " tests OK");
