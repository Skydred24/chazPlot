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

  // Teinte HSV en degres [0,360), ou -1 si achromatique (gris/noir/blanc).
  function rgbHue(r, g, b) {
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    if (d === 0) return -1;
    let h;
    if (mx === r) h = ((g - b) / d) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360;
    return h;
  }
  function hueDist(a, b) { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; }

  // Regroupe les pixels de courbe par couleur, robuste a l'anti-aliasing.
  // (1) Filtre le fond et les gris clairs (grille). (2) Les pixels chromatiques
  // alimentent un HISTOGRAMME de teinte ; ses PICS (maxima locaux lisses,
  // fusionnes s'ils sont a moins de hueTol) donnent une couleur par courbe ->
  // insensible a l'ordre de rencontre, deux teintes proches (ex. deux oranges)
  // restent deux pics distincts. (3) Chaque pixel rejoint le pic le plus proche ;
  // les gris sombres forment un bucket "sombre" (trait noir). (4) On ecarte les
  // amas qui ne ressemblent pas a une courbe : trop peu de pixels, trop etroits,
  // ou colonnes trop clairsemees (bruit de croisement, texte de legende). La
  // couleur representative est le pixel le plus sature (coeur du trait).
  function clusterCurveColors(img, box, opts) {
    opts = opts || {};
    const bg = opts.bg || detectBackground(img, box);
    const bgDist = opts.bgDist != null ? opts.bgDist : 50;
    const satMin = opts.satMin != null ? opts.satMin : 0.25;
    const darkMax = opts.darkMax != null ? opts.darkMax : 110;
    const hueTol = opts.hueTol != null ? opts.hueTol : 8;
    const minPixels = opts.minPixels != null ? opts.minPixels : 8;
    const minFrac = opts.minFrac != null ? opts.minFrac : 0.01;
    const minSpanFrac = opts.minSpanFrac != null ? opts.minSpanFrac : 0.3;
    const minCoverage = opts.minCoverage != null ? opts.minCoverage : 0.3;
    const peakMinFrac = opts.peakMinFrac != null ? opts.peakMinFrac : 0.04;

    // 1) collecte avant-plan + histogramme de teinte
    const fg = [], hist = new Array(360).fill(0);
    let dark = null, total = 0;
    for (let y = box.y0 + 1; y < box.y1; y++) {
      for (let x = box.x0 + 1; x < box.x1; x++) {
        const i = (y * img.width + x) * 4;
        const r = img.data[i], g = img.data[i + 1], b = img.data[i + 2];
        if (Math.abs(r - bg.r) + Math.abs(g - bg.g) + Math.abs(b - bg.b) < bgDist) continue;
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
        const sat = mx === 0 ? 0 : (mx - mn) / mx;
        if (sat < satMin) {
          const lum = 0.299 * r + 0.587 * g + 0.114 * b;
          if (lum > darkMax) continue;            // gris clair (grille) -> ignore
          if (!dark) dark = { pixels: [], color: [r, g, b], bestSat: -1 };
          dark.pixels.push({ x: x, y: y }); total++;
          continue;
        }
        const h = Math.round(rgbHue(r, g, b)) % 360;
        hist[h]++;
        fg.push({ x: x, y: y, h: h, sat: sat, r: r, g: g, b: b });
        total++;
      }
    }

    // 2) lissage circulaire + pics de teinte
    const sm = new Array(360);
    for (let d = 0; d < 360; d++) {
      let s = 0;
      for (let k = -2; k <= 2; k++) s += hist[(d + k + 360) % 360];
      sm[d] = s;
    }
    let maxBin = 0;
    for (let d = 0; d < 360; d++) if (sm[d] > maxBin) maxBin = sm[d];
    const peakMin = Math.max(1, maxBin * peakMinFrac);
    const peaks = [];
    for (let d = 0; d < 360; d++) {
      const v = sm[d];
      if (v >= peakMin && v >= sm[(d + 359) % 360] && v >= sm[(d + 1) % 360]) peaks.push({ hue: d, w: v });
    }
    peaks.sort(function (a, b) { return b.w - a.w; });
    const kept = [];
    for (let p = 0; p < peaks.length; p++) {
      let merged = false;
      for (let q = 0; q < kept.length; q++) if (hueDist(peaks[p].hue, kept[q].hue) <= hueTol) { merged = true; break; }
      if (!merged) kept.push(peaks[p]);
    }

    // 3) affectation au pic le plus proche
    const clusters = kept.map(function (p) { return { pixels: [], color: [0, 0, 0], bestSat: -1 }; });
    for (let j = 0; j < fg.length; j++) {
      const px = fg[j];
      let best = -1, bd = Infinity;
      for (let q = 0; q < kept.length; q++) { const d = hueDist(px.h, kept[q].hue); if (d < bd) { bd = d; best = q; } }
      if (best < 0) continue;
      const c = clusters[best];
      c.pixels.push({ x: px.x, y: px.y });
      if (px.sat > c.bestSat) { c.bestSat = px.sat; c.color = [px.r, px.g, px.b]; }
    }
    const all = clusters.slice();
    if (dark) all.push(dark);

    // 4) filtres : population, largeur, densite de colonnes
    const minN = Math.max(minPixels, Math.floor(total * minFrac));
    const minSpan = minSpanFrac * (box.x1 - box.x0);
    function spanCov(c) {
      let lo = Infinity, hi = -Infinity; const cols = {};
      for (let k = 0; k < c.pixels.length; k++) { const px = c.pixels[k].x; if (px < lo) lo = px; if (px > hi) hi = px; cols[px] = 1; }
      const span = hi - lo;
      return { span: span, cov: span > 0 ? Object.keys(cols).length / (span + 1) : 0 };
    }
    return all
      .filter(function (c) {
        if (c.pixels.length < minN) return false;
        const sc = spanCov(c);
        return sc.span >= minSpan && sc.cov >= minCoverage;
      })
      .map(function (c) { return { color: c.color, pixels: c.pixels }; })
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

  // Mode manuel : masque des pixels dont la COULEUR est proche de celle cliquee
  // en (sx,sy). Isole une courbe precise meme quand l'auto a fusionne deux teintes
  // voisines (ex. deux oranges) : le clic choisit la couleur exacte. Distance L1
  // en RGB <= tol.
  // Par defaut (connected=true) on ne garde que la composante RELIEE au clic, en
  // pontant les petits trous jusqu'a `bridge` px (pour traverser les croisements
  // de courbes) : ainsi un echantillon de legende de la meme couleur, isole dans
  // un coin, est ECARTE. Renvoie {color, pixels:[{x,y}]} dans l'interieur de la boite.
  function colorMaskAt(img, box, sx, sy, opts) {
    opts = opts || {};
    const tol = opts.tol != null ? opts.tol : 70;
    const connected = opts.connected !== false;
    const bridge = opts.bridge != null ? opts.bridge : 8;
    const i0 = (sy * img.width + sx) * 4;
    const cr = img.data[i0], cg = img.data[i0 + 1], cb = img.data[i0 + 2];
    function match(x, y) {
      const i = (y * img.width + x) * 4;
      return Math.abs(img.data[i] - cr) + Math.abs(img.data[i + 1] - cg) + Math.abs(img.data[i + 2] - cb) <= tol;
    }
    const x0 = box.x0 + 1, x1 = box.x1 - 1, y0 = box.y0 + 1, y1 = box.y1 - 1;
    if (!connected) {
      const out = [];
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (match(x, y)) out.push({ x: x, y: y });
      return { color: [cr, cg, cb], pixels: out };
    }
    // composante reliee au clic, BFS avec pontage des trous <= bridge
    const W = x1 - x0 + 1, H = y1 - y0 + 1;
    const seen = new Uint8Array(W * H);
    function idx(x, y) { return (y - y0) * W + (x - x0); }
    // point de depart : pixel correspondant le plus proche du clic
    let start = null;
    for (let r = 0; r <= bridge + 2 && !start; r++) {
      for (let dy = -r; dy <= r && !start; dy++) for (let dx = -r; dx <= r && !start; dx++) {
        const x = sx + dx, y = sy + dy;
        if (x >= x0 && x <= x1 && y >= y0 && y <= y1 && match(x, y)) start = { x: x, y: y };
      }
    }
    const out = [];
    if (!start) return { color: [cr, cg, cb], pixels: out };
    const queue = [start]; seen[idx(start.x, start.y)] = 1;
    while (queue.length) {
      const p = queue.pop();
      out.push(p);
      for (let dy = -bridge; dy <= bridge; dy++) {
        for (let dx = -bridge; dx <= bridge; dx++) {
          if (!dx && !dy) continue;
          const x = p.x + dx, y = p.y + dy;
          if (x < x0 || x > x1 || y < y0 || y > y1) continue;
          const k = idx(x, y);
          if (seen[k] || !match(x, y)) continue;
          seen[k] = 1; queue.push({ x: x, y: y });
        }
      }
    }
    return { color: [cr, cg, cb], pixels: out };
  }

  // Calibration par 2 points de reference par axe : calib = {x:{p0,v0,p1,v1,log}, y:{...}}.
  // p = position pixel du repere, v = la valeur d'axe correspondante. Lineaire, ou
  // interpolation en log10 si log. L'inversion Y est geree d'office (les pixels
  // cliques portent deja le sens). Plus general que « bords de boite = min/max ».
  function mapAxisRef(p, a) {
    const frac = a.p1 === a.p0 ? 0 : (p - a.p0) / (a.p1 - a.p0);
    if (a.log) {
      const l0 = Math.log(a.v0) / Math.LN10, l1 = Math.log(a.v1) / Math.LN10;
      return Math.pow(10, l0 + frac * (l1 - l0));
    }
    return a.v0 + frac * (a.v1 - a.v0);
  }
  function mapPoints(points, calib) {
    return points.map(function (pt) {
      return { x: mapAxisRef(pt.xpx, calib.x), y: mapAxisRef(pt.ypx, calib.y) };
    });
  }

  // Extraction dans une REGION brossee (inMask(x,y) -> bool). Prend les pixels
  // d'avant-plan de la zone, garde la couleur DOMINANTE (pour ignorer un bout
  // d'une autre courbe effleuree), et renvoie une MEDIANE par colonne -> une
  // courbe {color, points, style}. La brosse apporte la contrainte spatiale qui
  // resout recouvrements / legendes / meme couleur.
  function traceRegion(img, box, inMask, opts) {
    opts = opts || {};
    const bg = opts.bg || detectBackground(img, box);
    const bgDist = opts.bgDist != null ? opts.bgDist : 50;
    const colorTol = opts.colorTol != null ? opts.colorTol : 100;
    const px = [];
    for (let y = box.y0 + 1; y < box.y1; y++) {
      for (let x = box.x0 + 1; x < box.x1; x++) {
        if (!inMask(x, y)) continue;
        const i = (y * img.width + x) * 4, r = img.data[i], g = img.data[i + 1], b = img.data[i + 2];
        if (Math.abs(r - bg.r) + Math.abs(g - bg.g) + Math.abs(b - bg.b) < bgDist) continue;
        px.push({ x: x, y: y, r: r, g: g, b: b });
      }
    }
    if (!px.length) return { color: [0, 0, 0], points: [], style: "solid" };
    const buckets = {};
    for (let k = 0; k < px.length; k++) {
      const p = px[k], key = (p.r >> 4) + "_" + (p.g >> 4) + "_" + (p.b >> 4);
      const c = buckets[key] || (buckets[key] = { n: 0, r: 0, g: 0, b: 0 });
      c.n++; c.r += p.r; c.g += p.g; c.b += p.b;
    }
    let bestK = null, bestN = -1;
    for (const key in buckets) if (buckets[key].n > bestN) { bestN = buckets[key].n; bestK = key; }
    const d = buckets[bestK];
    const color = [Math.round(d.r / d.n), Math.round(d.g / d.n), Math.round(d.b / d.n)];
    const byCol = {};
    for (let k = 0; k < px.length; k++) {
      const p = px[k];
      if (Math.abs(p.r - color[0]) + Math.abs(p.g - color[1]) + Math.abs(p.b - color[2]) <= colorTol) {
        (byCol[p.x] = byCol[p.x] || []).push(p.y);
      }
    }
    const xs = Object.keys(byCol).map(Number).sort(function (a, b) { return a - b; });
    const masked = [];
    const points = xs.map(function (x) {
      const ys = byCol[x].sort(function (a, b) { return a - b; });
      for (let k = 0; k < ys.length; k++) masked.push({ x: x, y: ys[k] });
      return { xpx: x, ypx: ys[(ys.length - 1) >> 1] };
    });
    return { color: color, points: points, style: detectLineStyle(masked, box).style };
  }

  const DASH_FOR = { solid: "solid", dashed: "dash", dotted: "dot", markers: "solid" };
  function rgbCss(c) { return "rgb(" + c[0] + "," + c[1] + "," + c[2] + ")"; }

  function buildSpec(curves, box, calib, title) {
    const data = curves.map(function (c, i) {
      const pts = pixelsToData(c.points, box, calib);
      return {
        type: "scatter",
        mode: c.style === "markers" ? "markers" : "lines",
        x: pts.map(function (p) { return p.x; }),
        y: pts.map(function (p) { return p.y; }),
        line: { color: rgbCss(c.color), dash: DASH_FOR[c.style] || "solid" },
        marker: { color: rgbCss(c.color) },
        name: c.name || ("courbe " + (i + 1))
      };
    });
    const layout = { xaxis: {}, yaxis: {} };
    if (calib.xlog) layout.xaxis.type = "log";
    if (calib.ylog) layout.yaxis.type = "log";
    return { title: title || "", plotly: { data: data, layout: layout } };
  }

  // Variante avec calibration par reperes (calib = {x:{p0,v0,p1,v1,log}, y:{...}}).
  function buildSpecMapped(curves, calib, title) {
    const data = curves.map(function (c, i) {
      const pts = mapPoints(c.points, calib);
      return {
        type: "scatter",
        mode: c.style === "markers" ? "markers" : "lines",
        x: pts.map(function (p) { return p.x; }),
        y: pts.map(function (p) { return p.y; }),
        line: { color: rgbCss(c.color), dash: DASH_FOR[c.style] || "solid" },
        marker: { color: rgbCss(c.color) },
        name: c.name || ("courbe " + (i + 1))
      };
    });
    const layout = { xaxis: {}, yaxis: {} };
    if (calib.x.log) layout.xaxis.type = "log";
    if (calib.y.log) layout.yaxis.type = "log";
    return { title: title || "", plotly: { data: data, layout: layout } };
  }

  return {
    pixelsToData: pixelsToData,
    detectBackground: detectBackground,
    detectPlotBox: detectPlotBox,
    clusterCurveColors: clusterCurveColors,
    detectLineStyle: detectLineStyle,
    extractCurves: extractCurves,
    traceFromSeeds: traceFromSeeds,
    colorMaskAt: colorMaskAt,
    mapPoints: mapPoints,
    traceRegion: traceRegion,
    buildSpec: buildSpec,
    buildSpecMapped: buildSpecMapped
  };
});
