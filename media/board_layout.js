// ============================================================
// board_layout.js
// Construit une "planche" multi-panneaux : fusionne N figures Plotly mono-axes
// en UNE spec Plotly multi-sous-graphes (grille lignes x colonnes). Chaque figure
// devient un panneau avec son propre couple d'axes xaxisN/yaxisN et un domaine
// (cellule), un label (a)/(b)/(c) en annotation, et une legende unique en bas
// (dedoublonnee par nom). Module pur (sans DOM) : self.BoardLayout dans le
// webview, require() sous Node. Teste par test/test_board_layout.js.
//
// La glue (panel.html) collecte les figures selectionnees, propose une modale
// (grille, ordre, largeur cible, legende) avec apercu live, puis envoie la spec
// a createFigureFromData -> la planche devient une vraie figure de l'historique
// (export/persistance/.tex via les chemins existants).
// ============================================================
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) { module.exports = api; }
  else { root.BoardLayout = api; }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  function clone(v) { return JSON.parse(JSON.stringify(v === undefined ? null : v)); }

  // Label de panneau : (a), (b), ... minuscules, puis (#27) au-dela de l'alphabet.
  function panelLabel(i) {
    if (i < 26) { return "(" + String.fromCharCode(97 + i) + ")"; }
    return "(#" + (i + 1) + ")";
  }

  // Suffixe d'axe Plotly : "" pour le 1er, "2", "3"... ensuite.
  function axisSuffix(idx1) { return idx1 === 1 ? "" : String(idx1); }

  // Recopie les proprietes d'axe utiles de la source vers le panneau (titre,
  // echelle, plage, format de ticks, grille...). On garde la plage source pour
  // preserver le cadrage choisi par l'utilisateur.
  const AXIS_PROPS = [
    "type", "title", "range", "autorange", "tickformat", "ticksuffix",
    "tickprefix", "dtick", "tick0", "showgrid", "gridcolor", "zeroline",
    "showline", "ticks", "tickfont", "exponentformat", "tickangle"
  ];
  function copyAxis(src) {
    const out = {};
    src = src || {};
    AXIS_PROPS.forEach(function (k) {
      if (src[k] !== undefined) { out[k] = clone(src[k]); }
    });
    return out;
  }

  function num(v, fallback) {
    const n = Number(v);
    return isFinite(n) && n > 0 ? n : fallback;
  }

  // figs : [{ plotly:{data,layout,width_in,height_in}, title }] DANS L'ORDRE des
  //        panneaux (a, b, c...). Seules les n = min(figs.length, rows*cols)
  //        premieres sont placees.
  // opts : { rows, cols, widthIn, legend:"bottom"|"right"|"none", title }
  // -> spec Plotly { data, layout, width_in, height_in }.
  function composeBoard(figs, opts) {
    figs = Array.isArray(figs) ? figs : [];
    opts = opts || {};
    const cols = Math.max(1, Math.round(opts.cols || 1));
    const rows = Math.max(1, Math.round(opts.rows || 1));
    const legend = (opts.legend === "right" || opts.legend === "none") ? opts.legend : "bottom";
    const widthIn = num(opts.widthIn, 3.4);
    const n = Math.min(figs.length, rows * cols);

    // Region paper de la grille (le reste = place pour la legende).
    const legendBottom = legend === "bottom" ? 0.12 : 0;
    const legendRight = legend === "right" ? 0.20 : 0;
    const left = 0, right = 1 - legendRight;
    const bottom = legendBottom, top = 1;

    const cellW = (right - left) / cols;
    const cellH = (top - bottom) / rows;
    const gapX = 0.12 * cellW;
    const gapY = 0.18 * cellH;

    const data = [];
    const layout = {
      autosize: true,
      hovermode: "closest",
      barmode: "overlay",
      showlegend: legend !== "none",
      margin: { l: 55, r: 20, t: 24, b: 24 },
      annotations: []
    };
    if (opts.title) { layout.title = { text: String(opts.title) }; }
    if (legend === "bottom") {
      layout.legend = { orientation: "h", x: 0.5, xanchor: "center", y: 0, yanchor: "top" };
    } else if (legend === "right") {
      layout.legend = { x: 1, xanchor: "right", y: 1, yanchor: "top" };
    }

    let aspectSum = 0, aspectCount = 0;
    const seenNames = {};

    for (let i = 0; i < n; i++) {
      const fig = figs[i] || {};
      const spec = fig.plotly || {};
      const srcLayout = spec.layout || {};
      const r = Math.floor(i / cols), c = i % cols;
      const idx1 = i + 1;
      const suf = axisSuffix(idx1);
      const xKey = "xaxis" + suf, yKey = "yaxis" + suf;
      const xRef = "x" + suf, yRef = "y" + suf;

      const cellLeft = left + c * cellW;
      const cellRight = left + (c + 1) * cellW;
      const cellTop = top - r * cellH;
      const cellBottom = top - (r + 1) * cellH;
      const x0 = +(cellLeft + gapX * 0.5).toFixed(4);
      const x1 = +(cellRight - gapX * 0.5).toFixed(4);
      const y1 = +(cellTop - gapY * 0.62).toFixed(4);     // marge au-dessus pour le label
      const y0 = +(cellBottom + gapY * 0.38).toFixed(4);

      const xa = copyAxis(srcLayout.xaxis);
      xa.domain = [x0, x1]; xa.anchor = yRef;
      const ya = copyAxis(srcLayout.yaxis);
      ya.domain = [y0, y1]; ya.anchor = xRef;
      layout[xKey] = xa;
      layout[yKey] = ya;

      // Traces du panneau : reaffectees a ses axes ; legende dedoublonnee par nom.
      (Array.isArray(spec.data) ? spec.data : []).forEach(function (t) {
        const out = clone(t);
        out.xaxis = xRef; out.yaxis = yRef;
        const nm = out.name || "";
        if (legend === "none" || !nm || seenNames[nm]) {
          out.showlegend = false;
        } else {
          out.showlegend = true;
          seenNames[nm] = true;
        }
        data.push(out);
      });

      // Label (a)/(b)/(c) en haut-gauche du panneau.
      layout.annotations.push({
        text: panelLabel(i),
        xref: "paper", yref: "paper",
        x: x0, y: y1,
        xanchor: "left", yanchor: "bottom",
        showarrow: false,
        font: { size: 15, family: "sans-serif", color: "#111111" }
      });

      const w = num(spec.width_in, 0), h = num(spec.height_in, 0);
      if (w && h) { aspectSum += h / w; aspectCount++; }
    }

    const avgAspect = aspectCount ? (aspectSum / aspectCount) : 0.62;
    const cellWin = widthIn / cols;
    const cellHin = cellWin * avgAspect;
    const gridHin = cellHin * rows;
    const denom = (top - bottom) || 1;          // fraction de hauteur dediee a la grille
    const heightIn = +(gridHin / denom).toFixed(3);

    return { data: data, layout: layout, width_in: +widthIn.toFixed(3), height_in: heightIn };
  }

  // Grille par defaut pour n figures : cols = ceil(sqrt(n)), rows = ceil(n/cols).
  function defaultGrid(n) {
    n = Math.max(1, Math.round(n || 1));
    const cols = Math.ceil(Math.sqrt(n));
    const rows = Math.ceil(n / cols);
    return { rows: rows, cols: cols };
  }

  return {
    composeBoard: composeBoard,
    defaultGrid: defaultGrid,
    panelLabel: panelLabel,
    axisSuffix: axisSuffix,
  };
});
