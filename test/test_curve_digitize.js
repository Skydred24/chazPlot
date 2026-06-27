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

// exporter les helpers pour les taches suivantes du meme fichier
module.exports = { makeImage: makeImage, setPx: setPx, drawHLine: drawHLine, drawVLine: drawVLine, drawSeg: drawSeg };

console.log("\n" + passed + " tests OK");
