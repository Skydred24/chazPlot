// ============================================================
// error_math.js
// Calcul d'erreur entre courbes (fonctions pures, sans DOM).
// Charge a la fois dans le webview (self.ErrorMath) et sous
// Node (require). Aucune dependance.
// ============================================================
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) { module.exports = api; }
  else { root.ErrorMath = api; }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // Interpole (xs, ys) — supposes tries par x croissant — aux abscisses xRef.
  // null hors de [xs[0], xs[n-1]] ou si une borne est null/NaN.
  function interpLinear(xRef, xs, ys) {
    const n = xs.length;
    const out = new Array(xRef.length);
    for (let k = 0; k < xRef.length; k++) {
      const xq = xRef[k];
      if (xq == null || isNaN(xq) || n === 0 || xq < xs[0] || xq > xs[n - 1]) {
        out[k] = null;
        continue;
      }
      if (n === 1) {
        const v = ys[0];
        out[k] = (xq === xs[0] && v != null && !isNaN(v)) ? v : null;
        continue;
      }
      let i = 0;
      while (i < n - 1 && xs[i + 1] < xq) { i++; }
      const x0 = xs[i], x1 = xs[i + 1], y0 = ys[i], y1 = ys[i + 1];
      if (y0 == null || y1 == null || isNaN(y0) || isNaN(y1)) { out[k] = null; continue; }
      out[k] = (x1 === x0) ? y0 : y0 + ((xq - x0) / (x1 - x0)) * (y1 - y0);
    }
    return out;
  }

  const EPS = 1e-12;

  const ERROR_TYPES = {
    signed: { id: "signed", label: "Difference signee", abbr: "diff" },
    abs:    { id: "abs",    label: "Erreur absolue",    abbr: "abs" },
    rel:    { id: "rel",    label: "Erreur relative",   abbr: "rel" },
    relpct: { id: "relpct", label: "Erreur relative %", abbr: "rel %" }
  };

  function computeError(typeId, yRef, yI, eps) {
    if (yRef == null || yI == null || isNaN(yRef) || isNaN(yI)) { return null; }
    const e = (eps == null) ? EPS : eps;
    const diff = yI - yRef;
    switch (typeId) {
      case "signed": return diff;
      case "abs": return Math.abs(diff);
      case "rel": return (Math.abs(yRef) < e) ? null : diff / yRef;
      case "relpct": return (Math.abs(yRef) < e) ? null : (diff / yRef) * 100;
      default: return null;
    }
  }

  function buildErrorSeries(typeId, xRef, yRef, xI, yI, opts) {
    const eps = (opts && opts.eps != null) ? opts.eps : EPS;
    const pairs = [];
    for (let k = 0; k < xI.length; k++) { pairs.push([xI[k], yI[k]]); }
    pairs.sort(function (a, b) { return a[0] - b[0]; });
    const xs = pairs.map(function (p) { return p[0]; });
    const ys = pairs.map(function (p) { return p[1]; });
    const yiOnRef = interpLinear(xRef, xs, ys);
    const ey = new Array(xRef.length);
    for (let k = 0; k < xRef.length; k++) {
      ey[k] = computeError(typeId, yRef[k], yiOnRef[k], eps);
    }
    return { x: xRef.slice(), y: ey };
  }

  return {
    interpLinear: interpLinear,
    computeError: computeError,
    ERROR_TYPES: ERROR_TYPES,
    EPS: EPS,
    buildErrorSeries: buildErrorSeries
  };
});
