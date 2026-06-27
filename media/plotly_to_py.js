// ============================================================
// plotly_to_py.js
// Reconstruit un script matplotlib a partir de la spec Plotly EMBARQUEE dans une
// image auto-portee (cf. figure_codec.js / "Figure auto-portee" dans CLAUDE.md).
// On part des DONNEES deja visibles dans l'image (points, couleurs, labels) ; on
// ne touche jamais au code source d'origine -> pas de fuite de code/chemins.
//
// Module PUR : pas de DOM. Charge par extension.js (require) ; teste par
// test/test_plotly_to_py.js. Entree : { title, plotly:{ data, layout } }. Sortie :
// une chaine de code Python (matplotlib) syntaxiquement valide.
// ============================================================
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) { module.exports = api; }
  else { root.PlotlyToPy = api; }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // --- formatage Python -------------------------------------------------------
  function pyStr(s) {
    return '"' + String(s == null ? "" : s)
      .replace(/\\/g, "\\\\").replace(/"/g, '\\"')
      .replace(/\n/g, "\\n").replace(/\r/g, "") + '"';
  }

  function pyNum(n) {
    if (n === null || n === undefined || (typeof n === "number" && !isFinite(n))) {
      return 'float("nan")';
    }
    const num = Number(n);
    if (Number.isInteger(num)) { return String(num); }
    return String(parseFloat(num.toPrecision(PRECISION)));
  }

  // Chiffres significatifs des donnees inlinees (compromis lisibilite/fidelite).
  const PRECISION = 4;

  function pyList(arr) {
    return "[" + (arr || []).map(pyNum).join(", ") + "]";
  }

  // Declare un tableau sous un nom unique dans la section donnees (ctx.decls) et
  // renvoie le nom, pour que les appels de trace referencent `x0` au lieu d'un
  // long littéral. `value` est deja une expression Python (pyList / np.array...).
  function declare(ctx, name, value) {
    ctx.decls.push(name + " = " + value);
    return name;
  }

  // --- couleurs ---------------------------------------------------------------
  // "rgba(r,g,b,a)" / "rgb(r,g,b)" / "#rrggbb" -> { hex:"#rrggbb", alpha:Number }.
  function parseColor(c) {
    if (typeof c !== "string") { return null; }
    const m = c.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)/i);
    if (m) {
      const hex = "#" + [m[1], m[2], m[3]].map(function (v) {
        return ("0" + (Number(v) & 255).toString(16)).slice(-2);
      }).join("");
      const alpha = m[4] === undefined ? 1 : Number(m[4]);
      return { hex: hex, alpha: alpha };
    }
    if (/^#[0-9a-f]{6}$/i.test(c)) { return { hex: c.toLowerCase(), alpha: 1 }; }
    if (/^#[0-9a-f]{3}$/i.test(c)) {
      const h = c.slice(1);
      return { hex: ("#" + h[0] + h[0] + h[1] + h[1] + h[2] + h[2]).toLowerCase(), alpha: 1 };
    }
    return null;
  }

  // Plotly dash -> matplotlib linestyle.
  const DASH = { solid: "-", dash: "--", dashdot: "-.", dot: ":" };

  // Plotly marker symbol -> matplotlib marker (inverse de _MARKERS du convertisseur).
  const MARKER = {
    circle: "o", square: "s", "triangle-up": "^", "triangle-down": "v",
    "triangle-left": "<", "triangle-right": ">", diamond: "D",
    x: "x", cross: "+", star: "*", pentagon: "p", hexagon: "h",
  };
  function markerSymbol(marker) {
    if (marker && typeof marker.symbol === "string") { return MARKER[marker.symbol] || "o"; }
    return null;
  }
  // Couleur scalaire d'un marker (ignore les tableaux couleur-par-point).
  function markerColor(marker) {
    return marker && typeof marker.color === "string" ? marker.color : null;
  }

  // --- generation -------------------------------------------------------------
  function axisTitle(axisObj) {
    if (axisObj && axisObj.title) {
      if (typeof axisObj.title === "string") { return axisObj.title; }
      if (typeof axisObj.title.text === "string") { return axisObj.title.text; }
    }
    return null;
  }

  // kwargs couleur (color= + alpha= si translucide) depuis une couleur Plotly.
  function colorKwargs(color) {
    const c = parseColor(color);
    if (!c) { return []; }
    const out = ['color=' + pyStr(c.hex)];
    if (c.alpha < 1) { out.push("alpha=" + pyNum(c.alpha)); }
    return out;
  }

  function emitLine(lines, ax, trace, ctx) {
    const xv = declare(ctx, "x" + trace._idx, pyList(trace.x));
    const yv = declare(ctx, "y" + trace._idx, pyList(trace.y));
    const kw = [];
    const ln = trace.line || {};
    const dash = DASH[ln.dash] || null;
    if (dash && dash !== "-") { kw.push("linestyle=" + pyStr(dash)); }
    if (ln.color) { Array.prototype.push.apply(kw, colorKwargs(ln.color)); }
    if (typeof ln.width === "number") { kw.push("linewidth=" + pyNum(ln.width)); }
    const sym = markerSymbol(trace.marker);
    if (sym) { kw.push("marker=" + pyStr(sym)); }
    if (trace.name && trace.showlegend !== false) { kw.push("label=" + pyStr(trace.name)); }
    lines.push(ax + ".plot(" + [xv, yv].concat(kw).join(", ") + ")");
  }

  function emitScatter(lines, ax, trace, ctx) {
    const xv = declare(ctx, "x" + trace._idx, pyList(trace.x));
    const yv = declare(ctx, "y" + trace._idx, pyList(trace.y));
    const kw = [];
    const sym = markerSymbol(trace.marker);
    if (sym) { kw.push("marker=" + pyStr(sym)); }
    const size = trace.marker && typeof trace.marker.size === "number" ? trace.marker.size : null;
    if (size !== null) { kw.push("s=" + pyNum(size * size)); }  // mpl s = aire ; convertisseur a pris sqrt
    const col = markerColor(trace.marker);
    if (col) { Array.prototype.push.apply(kw, colorKwargs(col)); }
    if (trace.name && trace.showlegend !== false) { kw.push("label=" + pyStr(trace.name)); }
    lines.push(ax + ".scatter(" + [xv, yv].concat(kw).join(", ") + ")");
  }

  // marker.color (scalaire ou tableau) -> liste/valeur Python de couleurs (hex,
  // alpha ignore), ou null. Renvoie une expression (pyList-like ou pyStr).
  function barColorValue(marker) {
    const c = marker && marker.color;
    if (Array.isArray(c)) {
      const hexes = c.map(function (v) { const p = parseColor(v); return p ? pyStr(p.hex) : pyStr("#1f77b4"); });
      return "[" + hexes.join(", ") + "]";
    }
    const p = parseColor(c);
    return p ? pyStr(p.hex) : null;
  }

  function emitBar(lines, ax, trace, ctx) {
    const horizontal = trace.orientation === "h";
    const i = trace._idx;
    const xv = declare(ctx, "x" + i, pyList(trace.x));
    const yv = declare(ctx, "y" + i, pyList(trace.y));
    const wv = trace.width ? declare(ctx, "w" + i, pyList(trace.width)) : null;
    const bv = trace.base ? declare(ctx, "b" + i, pyList(trace.base)) : null;
    const colVal = barColorValue(trace.marker);
    const cv = colVal && colVal[0] === "[" ? declare(ctx, "c" + i, colVal) : colVal;  // liste -> variable
    const kw = [];
    const label = (trace.name && trace.showlegend !== false) ? "label=" + pyStr(trace.name) : null;
    if (horizontal) {
      // Plotly h : x = longueurs, y = centres, width = epaisseurs, base = bords gauches.
      if (wv) { kw.push("height=" + wv); }
      if (bv) { kw.push("left=" + bv); }
      if (cv) { kw.push("color=" + cv); }
      if (label) { kw.push(label); }
      lines.push(ax + ".barh(" + [yv, xv].concat(kw).join(", ") + ")");
    } else {
      if (wv) { kw.push("width=" + wv); }
      if (bv) { kw.push("bottom=" + bv); }
      if (cv) { kw.push("color=" + cv); }
      if (label) { kw.push(label); }
      lines.push(ax + ".bar(" + [xv, yv].concat(kw).join(", ") + ")");
    }
  }

  // Emet echelle et bornes pour un axe ('x' ou 'y') d'un objet axis Plotly.
  // En log, Plotly stocke range en log10 -> on revient en valeurs lineaires (10**r).
  function emitScaleAndLimits(lines, ax, axisObj, which) {
    if (!axisObj) { return; }
    const isLog = axisObj.type === "log";
    if (isLog) { lines.push(ax + ".set_" + which + 'scale("log")'); }
    if (Array.isArray(axisObj.range) && axisObj.range.length === 2) {
      let lo = Number(axisObj.range[0]);
      let hi = Number(axisObj.range[1]);
      if (isLog) { lo = Math.pow(10, lo); hi = Math.pow(10, hi); }
      lines.push(ax + ".set_" + which + "lim(" + pyNum(lo) + ", " + pyNum(hi) + ")");
    }
  }

  // Labels/echelle/bornes d'un panneau, depuis ses objets axis x/y Plotly.
  function emitAxis(lines, ax, xAxisObj, yAxisObj) {
    const xl = axisTitle(xAxisObj);
    const yl = axisTitle(yAxisObj);
    if (xl) { lines.push(ax + '.set_xlabel(' + pyStr(xl) + ")"); }
    if (yl) { lines.push(ax + '.set_ylabel(' + pyStr(yl) + ")"); }
    emitScaleAndLimits(lines, ax, xAxisObj, "x");
    emitScaleAndLimits(lines, ax, yAxisObj, "y");
  }

  // heatmap (imshow/pcolormesh) -> np.array + ax.pcolormesh + fig.colorbar. `i` =
  // index pour des noms de variables uniques. Marque ctx.needNumpy.
  function emitHeatmap(lines, ax, trace, i, ctx) {
    ctx.needNumpy = true;
    const rows = (trace.z || []).map(pyList).join(", ");
    const zVar = declare(ctx, "z" + i, "np.array([" + rows + "])");
    const args = [];
    if (Array.isArray(trace.x) && Array.isArray(trace.y)) {
      args.push(declare(ctx, "x" + i, pyList(trace.x)), declare(ctx, "y" + i, pyList(trace.y)));
    }
    args.push(zVar);
    if (typeof trace.zmin === "number") { args.push("vmin=" + pyNum(trace.zmin)); }
    if (typeof trace.zmax === "number") { args.push("vmax=" + pyNum(trace.zmax)); }
    const meshVar = "mesh" + i;
    lines.push(meshVar + " = " + ax + ".pcolormesh(" + args.join(", ") + ")");
    const cbTitle = trace.colorbar && axisTitle(trace.colorbar);
    const cbArgs = [meshVar, "ax=" + ax];
    if (cbTitle) { cbArgs.push("label=" + pyStr(cbTitle)); }
    lines.push("fig.colorbar(" + cbArgs.join(", ") + ")");
  }

  // "x"/"x2"/"y3" -> cle de layout "xaxis"/"xaxis2"/"yaxis3".
  function layoutAxisKey(ref) {
    ref = ref || "x";
    const head = ref[0];           // 'x' ou 'y'
    const suffix = ref.slice(1);   // '' ou '2', '3'...
    return (head === "y" ? "yaxis" : "xaxis") + suffix;
  }

  function domainStart(axisObj) {
    if (axisObj && Array.isArray(axisObj.domain) && axisObj.domain.length === 2) {
      return Number(axisObj.domain[0]);
    }
    return 0;
  }

  // Regroupe les traces par paire d'axes (ordre d'apparition) et calcule une
  // grille de sous-graphes a partir des domaines : colonnes = positions x
  // distinctes (gauche->droite), lignes = positions y distinctes (haut->bas).
  // Plusieurs paires partageant un meme domaine retombent sur la meme cellule
  // (ex. twinx) -> tracees ensemble sur le meme axe.
  function planGrid(data, layout) {
    const groups = [];
    const byKey = {};
    for (let i = 0; i < data.length; i++) {
      const trace = data[i];
      const xKey = layoutAxisKey(trace.xaxis || "x");
      const yKey = layoutAxisKey(trace.yaxis || "y");
      const key = xKey + "|" + yKey;
      if (!byKey[key]) {
        byKey[key] = { xKey: xKey, yKey: yKey, traces: [],
          xStart: domainStart(layout[xKey]), yStart: domainStart(layout[yKey]) };
        groups.push(byKey[key]);
      }
      byKey[key].traces.push(trace);
    }

    const xStarts = [], yStarts = [];
    groups.forEach(function (g) {
      if (xStarts.indexOf(g.xStart) === -1) { xStarts.push(g.xStart); }
      if (yStarts.indexOf(g.yStart) === -1) { yStarts.push(g.yStart); }
    });
    xStarts.sort(function (a, b) { return a - b; });        // gauche -> droite
    yStarts.sort(function (a, b) { return b - a; });        // haut -> bas (y haut = haut)

    groups.forEach(function (g) {
      g.row = yStarts.indexOf(g.yStart);
      g.col = xStarts.indexOf(g.xStart);
    });
    return { groups: groups, rows: yStarts.length, cols: xStarts.length };
  }

  function emitGroupTraces(body, ax, group, ctx) {
    let needLegend = false;
    for (let i = 0; i < group.traces.length; i++) {
      const trace = group.traces[i];
      const idx = trace._idx;
      if (trace.type === "scatter") {
        const mode = trace.mode || "lines";
        if (/lines/.test(mode)) { emitLine(body, ax, trace, ctx); }
        else { emitScatter(body, ax, trace, ctx); }
        if (trace.name && trace.showlegend !== false) { needLegend = true; }
      } else if (trace.type === "bar") {
        emitBar(body, ax, trace, ctx);
        if (trace.name && trace.showlegend !== false) { needLegend = true; }
      } else if (trace.type === "heatmap") {
        emitHeatmap(body, ax, trace, idx, ctx);
      } else {
        body.push("# trace " + idx + " de type '" + String(trace.type) +
          "' non reproductible automatiquement (cf. limites du generateur)");
      }
    }
    return needLegend;
  }

  function toMatplotlib(figure) {
    figure = figure || {};
    const plotly = figure.plotly || {};
    const data = plotly.data || [];
    const layout = plotly.layout || {};
    data.forEach(function (t, i) { t._idx = i; });

    const plan = planGrid(data, layout);
    const single = plan.rows * plan.cols <= 1;
    const ctx = { needNumpy: false, decls: [] };
    const body = [];

    plan.groups.forEach(function (group, gi) {
      const ax = single ? "ax" : ("axs[" + group.row + "][" + group.col + "]");
      if (gi > 0) { body.push(""); }
      const needLegend = emitGroupTraces(body, ax, group, ctx);
      emitAxis(body, ax, layout[group.xKey], layout[group.yKey]);
      if (single) {
        const title = figure.title || axisTitle(layout);
        if (title) { body.push(ax + '.set_title(' + pyStr(title) + ")"); }
      }
      if (needLegend) { body.push(ax + ".legend()"); }
    });

    const out = ["import matplotlib.pyplot as plt"];
    if (ctx.needNumpy) { out.push("import numpy as np"); }
    out.push("");
    if (ctx.decls.length) {
      out.push("# Donnees");
      Array.prototype.push.apply(out, ctx.decls);
      out.push("");
    }
    if (single) {
      out.push("fig, ax = plt.subplots()");
    } else {
      out.push("fig, axs = plt.subplots(" + plan.rows + ", " + plan.cols + ", squeeze=False)");
      const title = figure.title || axisTitle(layout);
      if (title) { out.push("fig.suptitle(" + pyStr(title) + ")"); }
    }
    out.push("");
    Array.prototype.push.apply(out, body);
    out.push("");
    if (!single) { out.push("fig.tight_layout()"); }
    out.push("plt.show()");
    out.push("");

    data.forEach(function (t) { delete t._idx; });
    return out.join("\n");
  }

  return {
    toMatplotlib: toMatplotlib,
    parseColor: parseColor,
  };
});
