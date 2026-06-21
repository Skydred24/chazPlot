// ============================================================
// measure_math.js
// Mesures sur courbe (fonctions pures, sans DOM) : metriques entre
// deux curseurs (dx, dy, pente, distance), aire sous la courbe au
// trapeze sur une plage, et statistiques (min/max/moyenne) sur une plage.
// Charge a la fois dans le webview (self.MeasureMath) et sous Node
// (require). Aucune dependance.
// ============================================================
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) { module.exports = api; }
  else { root.MeasureMath = api; }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  function isFiniteNum(v) { return v != null && !isNaN(v) && isFinite(v); }

  // Metriques entre deux points figes A et B. pente = dy/dx (null si dx=0).
  function segmentMetrics(ax, ay, bx, by) {
    const dx = bx - ax;
    const dy = by - ay;
    return {
      dx: dx,
      dy: dy,
      slope: (dx === 0) ? null : dy / dx,
      distance: Math.sqrt(dx * dx + dy * dy),
    };
  }

  // Couples (x, y) finis, tries par x croissant. Sert d'interpretation
  // "y = f(x)" pour l'aire (les points non finis sont sautes : le segment
  // est reconstruit entre les voisins finis).
  function finiteSortedPairs(xs, ys) {
    const pts = [];
    const n = Math.min(xs.length, ys.length);
    for (let i = 0; i < n; i++) {
      if (isFiniteNum(xs[i]) && isFiniteNum(ys[i])) { pts.push([xs[i], ys[i]]); }
    }
    pts.sort(function (a, b) { return a[0] - b[0]; });
    return pts;
  }

  // Aire signee sous la courbe (interpolant lineaire par morceaux) entre
  // xMin et xMax, bornes interpolees. Plage inversee toleree. 0 si < 2 points.
  function areaUnderCurve(xs, ys, xMin, xMax) {
    const lo = Math.min(xMin, xMax);
    const hi = Math.max(xMin, xMax);
    const pts = finiteSortedPairs(xs, ys);
    if (pts.length < 2 || lo === hi) { return 0; }
    let area = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const x0 = pts[i][0], y0 = pts[i][1];
      const x1 = pts[i + 1][0], y1 = pts[i + 1][1];
      if (x1 <= lo || x0 >= hi || x1 === x0) { continue; }
      const cx0 = Math.max(x0, lo);
      const cx1 = Math.min(x1, hi);
      const slope = (y1 - y0) / (x1 - x0);
      const cy0 = y0 + slope * (cx0 - x0);
      const cy1 = y0 + slope * (cx1 - x0);
      area += (cy0 + cy1) / 2 * (cx1 - cx0);
    }
    return area;
  }

  // Statistiques des points dont x est dans [xMin, xMax]. Plage inversee
  // toleree. min/max/mean null si aucun point exploitable.
  function rangeStats(xs, ys, xMin, xMax) {
    const lo = Math.min(xMin, xMax);
    const hi = Math.max(xMin, xMax);
    let count = 0, sum = 0, min = null, max = null;
    const n = Math.min(xs.length, ys.length);
    for (let i = 0; i < n; i++) {
      const x = xs[i], y = ys[i];
      if (!isFiniteNum(x) || x < lo || x > hi) { continue; }
      if (!isFiniteNum(y)) { continue; }
      count++; sum += y;
      if (min === null || y < min) { min = y; }
      if (max === null || y > max) { max = y; }
    }
    return {
      count: count,
      sum: count ? sum : null,
      min: min,
      max: max,
      mean: count ? sum / count : null,
    };
  }

  return {
    segmentMetrics: segmentMetrics,
    areaUnderCurve: areaUnderCurve,
    rangeStats: rangeStats,
    finiteSortedPairs: finiteSortedPairs,
  };
});
