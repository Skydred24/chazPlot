// media/curve_digitize.js — module pur de digitalisation de courbes depuis une
// image raster {width,height,data:RGBA}. UMD : self.CurveDigitize / require.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.CurveDigitize = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  function lin(frac, a, b) { return a + frac * (b - a); }
  function logmap(frac, a, b) { return Math.pow(10, lin(frac, Math.log(a) / Math.LN10, Math.log(b) / Math.LN10)); }

  function pixelsToData(points, box, calib) {
    const w = box.x1 - box.x0, h = box.y1 - box.y0;
    return points.map(function (p) {
      const fx = w ? (p.xpx - box.x0) / w : 0;
      const fy = h ? (box.y1 - p.ypx) / h : 0; // y pixel vers le bas -> inversion
      const x = calib.xlog ? logmap(fx, calib.xmin, calib.xmax) : lin(fx, calib.xmin, calib.xmax);
      const y = calib.ylog ? logmap(fy, calib.ymin, calib.ymax) : lin(fy, calib.ymin, calib.ymax);
      return { x: x, y: y };
    });
  }

  function detectBackground(img, box) {
    const counts = {};
    for (let y = box.y0; y <= box.y1; y++) {
      for (let x = box.x0; x <= box.x1; x++) {
        const i = (y * img.width + x) * 4;
        const k = (img.data[i] >> 3) + "_" + (img.data[i + 1] >> 3) + "_" + (img.data[i + 2] >> 3);
        counts[k] = (counts[k] || 0) + 1;
      }
    }
    let best = null, bestN = -1;
    for (const k in counts) { if (counts[k] > bestN) { bestN = counts[k]; best = k; } }
    const p = best.split("_").map(Number);
    return { r: (p[0] << 3) | 7, g: (p[1] << 3) | 7, b: (p[2] << 3) | 7 };
  }

  function lum(r, g, b) { return 0.299 * r + 0.587 * g + 0.114 * b; }
  function sat(r, g, b) {
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    return mx === 0 ? 0 : (mx - mn) / mx;
  }
  function isAxisPixel(r, g, b) { return lum(r, g, b) < 110 && sat(r, g, b) < 0.35; }

  function detectPlotBox(img, opts) {
    opts = opts || {};
    const W = img.width, H = img.height;
    const colCount = new Array(W).fill(0), rowCount = new Array(H).fill(0);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        if (isAxisPixel(img.data[i], img.data[i + 1], img.data[i + 2])) { colCount[x]++; rowCount[y]++; }
      }
    }
    const vThresh = (opts.vFrac != null ? opts.vFrac : 0.5) * H, hThresh = (opts.hFrac != null ? opts.hFrac : 0.5) * W;
    const cols = [], rows = [];
    for (let x = 0; x < W; x++) if (colCount[x] >= vThresh) cols.push(x);
    for (let y = 0; y < H; y++) if (rowCount[y] >= hThresh) rows.push(y);
    if (cols.length < 2 || rows.length < 2) return null;
    return { x0: cols[0], y0: rows[0], x1: cols[cols.length - 1], y1: rows[rows.length - 1] };
  }

  function clusterCurveColors(img, box, opts) {
    opts = opts || {};
    const bg = opts.bg || detectBackground(img, box);
    const bgDist = opts.bgDist != null ? opts.bgDist : 40;
    const mergeTol = opts.mergeTol != null ? opts.mergeTol : 40;
    const minPixels = opts.minPixels != null ? opts.minPixels : 8;
    const clusters = [];
    for (let y = box.y0 + 1; y < box.y1; y++) {
      for (let x = box.x0 + 1; x < box.x1; x++) {
        const i = (y * img.width + x) * 4;
        const r = img.data[i], g = img.data[i + 1], b = img.data[i + 2];
        if (Math.abs(r - bg.r) + Math.abs(g - bg.g) + Math.abs(b - bg.b) < bgDist) continue;
        let found = null;
        for (let k = 0; k < clusters.length; k++) {
          const c = clusters[k].color;
          if (Math.abs(c[0] - r) + Math.abs(c[1] - g) + Math.abs(c[2] - b) <= mergeTol) { found = clusters[k]; break; }
        }
        if (found) found.pixels.push({ x: x, y: y });
        else clusters.push({ color: [r, g, b], pixels: [{ x: x, y: y }] });
      }
    }
    return clusters
      .filter(function (c) { return c.pixels.length >= minPixels; })
      .sort(function (a, b) { return b.pixels.length - a.pixels.length; });
  }

  function detectLineStyle(pixels, box) {
    if (!pixels.length) return { style: "markers" };
    const colRows = {};
    let minx = Infinity, maxx = -Infinity;
    for (let k = 0; k < pixels.length; k++) {
      const p = pixels[k];
      (colRows[p.x] = colRows[p.x] || []).push(p.y);
      if (p.x < minx) minx = p.x;
      if (p.x > maxx) maxx = p.x;
    }
    const span = maxx - minx + 1;
    let present = 0, totalHeight = 0;
    for (let x = minx; x <= maxx; x++) {
      const ys = colRows[x];
      if (!ys) continue;
      present++;
      totalHeight += Math.max.apply(null, ys) - Math.min.apply(null, ys) + 1;
    }
    const coverage = present / span;
    const avgHeight = totalHeight / present;
    if (avgHeight >= 3 && coverage < 0.85) return { style: "markers" };
    if (coverage >= 0.85) return { style: "solid" };
    if (coverage >= 0.45) return { style: "dashed" };
    return { style: "dotted" };
  }

  function columnBands(ys) {
    ys = ys.slice().sort(function (a, b) { return a - b; });
    const bands = [];
    let start = ys[0], prev = ys[0];
    for (let i = 1; i < ys.length; i++) {
      if (ys[i] - prev > 1) { bands.push((start + prev) / 2); start = ys[i]; }
      prev = ys[i];
    }
    bands.push((start + prev) / 2);
    return bands;
  }

  function extractCurves(clusters, box, opts) {
    opts = opts || {};
    return clusters.map(function (c) {
      const byCol = {};
      for (let k = 0; k < c.pixels.length; k++) {
        const p = c.pixels[k];
        (byCol[p.x] = byCol[p.x] || []).push(p.y);
      }
      const xs = Object.keys(byCol).map(Number).sort(function (a, b) { return a - b; });
      const points = [], ambiguous = [];
      let lastY = null, lastX = null, slope = 0;
      for (let j = 0; j < xs.length; j++) {
        const x = xs[j];
        const bands = columnBands(byCol[x]);
        let chosen;
        if (bands.length === 1) {
          chosen = bands[0];
        } else {
          const pred = lastY != null ? lastY + slope * (x - lastX) : bands[0];
          chosen = bands[0]; let best = Infinity;
          for (let b = 0; b < bands.length; b++) {
            const d = Math.abs(bands[b] - pred);
            if (d < best) { best = d; chosen = bands[b]; }
          }
          ambiguous.push({ x0: x, x1: x });
        }
        if (lastY != null && x > lastX) slope = (chosen - lastY) / (x - lastX);
        points.push({ xpx: x, ypx: chosen });
        lastY = chosen; lastX = x;
      }
      const merged = [];
      for (let a = 0; a < ambiguous.length; a++) {
        const m = merged[merged.length - 1];
        if (m && ambiguous[a].x0 <= m.x1 + 1) m.x1 = ambiguous[a].x1;
        else merged.push({ x0: ambiguous[a].x0, x1: ambiguous[a].x1 });
      }
      return {
        color: c.color,
        style: detectLineStyle(c.pixels, box).style,
        pixels: c.pixels,
        points: points,
        ambiguous: merged
      };
    });
  }

  function nearestIndex(xs, x) {
    let best = 0, bd = Infinity;
    for (let i = 0; i < xs.length; i++) { const d = Math.abs(xs[i] - x); if (d < bd) { bd = d; best = i; } }
    return best;
  }

  // Predit y en x par regression lineaire sur les derniers points (fenetre) ;
  // plus robuste au bruit d'arrondi qu'une pente a un seul pas (croisements).
  function fitPredict(hist, x, win) {
    const pts = hist.slice(-win);
    if (pts.length < 2) return pts[pts.length - 1].y;
    let n = pts.length, sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (let i = 0; i < n; i++) {
      const p = pts[i];
      sx += p.x; sy += p.y; sxx += p.x * p.x; sxy += p.x * p.y;
    }
    const den = n * sxx - sx * sx;
    const b = den !== 0 ? (n * sxy - sx * sy) / den : 0;
    const a = (sy - b * sx) / n;
    return a + b * x;
  }

  function traceFromSeeds(pixels, box, seeds) {
    const FIT_WINDOW = 5;
    const byCol = {};
    for (let k = 0; k < pixels.length; k++) {
      const p = pixels[k];
      (byCol[p.x] = byCol[p.x] || []).push(p.y);
    }
    const xs = Object.keys(byCol).map(Number).sort(function (a, b) { return a - b; });
    return seeds.map(function (seed) {
      function traceDir(dir) {
        const pts = [];
        const hist = [{ x: seed.x, y: seed.y }];
        let lastY = seed.y;
        let k = nearestIndex(xs, seed.x) + dir;
        for (; k >= 0 && k < xs.length; k += dir) {
          const x = xs[k];
          const bands = columnBands(byCol[x]);
          const pred = fitPredict(hist, x, FIT_WINDOW);
          let chosen = bands[0], best = Infinity;
          for (let b = 0; b < bands.length; b++) {
            const d = Math.abs(bands[b] - pred);
            // a egalite de distance au predit, preferer la continuite (proche du dernier y)
            if (d < best - 1e-9 ||
                (Math.abs(d - best) <= 1e-9 && Math.abs(bands[b] - lastY) < Math.abs(chosen - lastY))) {
              best = d; chosen = bands[b];
            }
          }
          pts.push({ xpx: x, ypx: chosen });
          hist.push({ x: x, y: chosen });
          lastY = chosen;
        }
        return pts;
      }
      const left = traceDir(-1).reverse();
      const right = traceDir(1);
      return { points: left.concat([{ xpx: seed.x, ypx: seed.y }], right), ambiguous: [] };
    });
  }

  return {
    pixelsToData: pixelsToData,
    detectBackground: detectBackground,
    detectPlotBox: detectPlotBox,
    clusterCurveColors: clusterCurveColors,
    detectLineStyle: detectLineStyle,
    extractCurves: extractCurves,
    traceFromSeeds: traceFromSeeds
  };
});
