// media/autoscale.js — math pure de l'auto-echelle Y sur la plage X visible.
// Pour chaque axe Y, calcule l'etendue [min,max] des traces qui lui sont
// rattachees, limitee aux points dont X tombe dans [x0,x1], avec une marge.
// Permet (vue comparaison/erreur) de recaler chaque sous-graphe independamment.
// UMD : self.AutoScale (webview) / require (node, tests). Aucune dependance.
(function (root, factory) {
  if (typeof module === "object" && module.exports) { module.exports = factory(); }
  else { root.AutoScale = factory(); }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // [lo,hi] des y d'un axe (axisLetter "y"/"y2"...) pour les points dont x est
  // dans [x0,x1]. Ignore les traces masquees (hidden) ou d'un autre axe.
  // Retourne null si aucun point exploitable.
  function visibleExtent(traces, axisLetter, x0, x1) {
    var lo = Infinity, hi = -Infinity;
    for (var t = 0; t < traces.length; t++) {
      var tr = traces[t];
      if (!tr || tr.hidden) { continue; }
      if ((tr.yaxis || "y") !== axisLetter) { continue; }
      var xs = tr.x, ys = tr.y;
      if (!xs || !ys) { continue; }
      var n = Math.min(xs.length, ys.length);
      for (var i = 0; i < n; i++) {
        var xv = xs[i];
        var xn = (xv instanceof Date) ? xv.getTime() : xv;
        if (typeof xn !== "number" || xn < x0 || xn > x1) { continue; }
        var yv = ys[i];
        if (typeof yv !== "number" || !isFinite(yv)) { continue; }
        if (yv < lo) { lo = yv; }
        if (yv > hi) { hi = yv; }
      }
    }
    if (lo === Infinity) { return null; }
    return [lo, hi];
  }

  // Ajoute une marge autour de [lo,hi]. fraction par defaut 0.06 ; si lo==hi,
  // marge relative a |lo| (ou 1) pour ne pas obtenir un intervalle nul.
  function padRange(lo, hi, fraction) {
    var f = (typeof fraction === "number") ? fraction : 0.06;
    if (lo === hi) { var p = (Math.abs(lo) || 1) * 0.05; return [lo - p, hi + p]; }
    var pad = (hi - lo) * f;
    return [lo - pad, hi + pad];
  }

  // axes:   [{ name:"yaxis", letter:"y", log:false }, { name:"yaxis2", letter:"y2", ... }]
  // traces: [{ yaxis:"y"|undefined, x:[...], y:[...], hidden:bool }]
  // Retourne un patch Plotly { "<name>.range":[lo,hi], ... } (axes log ou sans
  // donnees visibles ignores).
  function visibleYRanges(axes, traces, x0, x1) {
    var patch = {};
    for (var a = 0; a < axes.length; a++) {
      var ax = axes[a];
      if (!ax || ax.log) { continue; }
      var ext = visibleExtent(traces, ax.letter, x0, x1);
      if (!ext) { continue; }
      patch[ax.name + ".range"] = padRange(ext[0], ext[1]);
    }
    return patch;
  }

  return { visibleExtent: visibleExtent, padRange: padRange, visibleYRanges: visibleYRanges };
});
