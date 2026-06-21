// ============================================================
// compare_util.js
// Aides pures (sans DOM) pour la comparaison :
//   - peerRangeUpdates : normalise un evenement plotly_relayout en mises a
//     jour de plage a repercuter sur les autres graphes (zoom synchronise
//     cote a cote).
//   - subplotSignature / figuresShareSubplots : detecte des figures partageant
//     la meme structure de sous-graphes (pour les superposer en preservant la
//     grille au lieu de tout ecraser sur un seul couple d'axes).
//   - mergeSubplotFigures : superpose plusieurs figures multi-sous-graphes.
// Charge dans le webview (self.CompareUtil) et sous Node (require).
// Aucune dependance.
// ============================================================
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) { module.exports = api; }
  else { root.CompareUtil = api; }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  function deepClone(v) { return JSON.parse(JSON.stringify(v || {})); }

  const AXIS = "(xaxis\\d*|yaxis\\d*)";
  const RANGE_BOUND = new RegExp("^" + AXIS + "\\.range\\[(0|1)\\]$");
  const RANGE_FULL = new RegExp("^" + AXIS + "\\.range$");
  const AUTORANGE = new RegExp("^" + AXIS + "\\.autorange$");

  // Convertit un evenement plotly_relayout en mises a jour de plage a appliquer
  // a un graphe pair. On ne garde que les changements d'axes (range / autorange)
  // et on reassemble les paires range[0]/range[1] en un tableau complet.
  function peerRangeUpdates(relayout) {
    const out = {};
    const bounds = {};   // axis -> [v0, v1]
    Object.keys(relayout || {}).forEach(function (key) {
      let m = RANGE_BOUND.exec(key);
      if (m) {
        const axis = m[1];
        if (!bounds[axis]) { bounds[axis] = [undefined, undefined]; }
        bounds[axis][Number(m[2])] = relayout[key];
        return;
      }
      m = RANGE_FULL.exec(key);
      if (m) { out[m[1] + ".range"] = relayout[key]; return; }
      m = AUTORANGE.exec(key);
      if (m) { out[m[1] + ".autorange"] = relayout[key]; return; }
    });
    Object.keys(bounds).forEach(function (axis) {
      const pair = bounds[axis];
      if (pair[0] !== undefined && pair[1] !== undefined) {
        out[axis + ".range"] = [pair[0], pair[1]];
      }
    });
    return out;
  }

  // Signature de structure : ensemble trie des couples d'axes (xaxis/yaxis)
  // utilises par les traces. "x/y" pour un graphe simple, "x/y|x2/y2" pour
  // deux sous-graphes.
  function subplotSignature(spec) {
    const data = (spec && Array.isArray(spec.data)) ? spec.data : [];
    const pairs = {};
    data.forEach(function (t) {
      const pair = (t.xaxis || "x") + "/" + (t.yaxis || "y");
      pairs[pair] = true;
    });
    return Object.keys(pairs).sort().join("|");
  }

  // True si toutes les figures partagent la meme structure de sous-graphes ET
  // qu'il y a plus d'un sous-graphe (sinon la superposition simple suffit).
  function figuresShareSubplots(figs) {
    if (!Array.isArray(figs) || figs.length < 2) { return false; }
    const sig0 = subplotSignature(figs[0] && figs[0].plotly);
    if (sig0.indexOf("|") === -1) { return false; }   // un seul sous-graphe
    return figs.every(function (f) {
      return f && f.plotly && subplotSignature(f.plotly) === sig0;
    });
  }

  const SECONDARY_DASHES = ["dash", "dot", "dashdot"];

  // Prepare une trace pour la superposition en conservant ses axes (xaxis/
  // yaxis) : prefixe son nom du label de figure et distingue les figures
  // secondaires (opacite + pointilles).
  function styleSubplotTrace(trace, label, index) {
    const out = deepClone(trace);
    out.showlegend = true;
    out.name = label + (out.name ? " - " + out.name : "");
    if (index > 0) {
      out.opacity = Math.min(typeof out.opacity === "number" ? out.opacity : 1, 0.78);
      if (out.line) {
        out.line = Object.assign({}, out.line,
          { dash: out.line.dash || SECONDARY_DASHES[(index - 1) % SECONDARY_DASHES.length] });
      }
      if (out.marker) { out.marker = Object.assign({}, out.marker, { opacity: 0.78 }); }
    }
    return out;
  }

  function compareLabel(index) {
    if (index < 26) { return String.fromCharCode(65 + index); }
    return "#" + String(index + 1);
  }

  // Superpose plusieurs figures multi-sous-graphes : reprend la grille (axes +
  // domaines) de la 1re figure et empile les traces de toutes en preservant
  // leur affectation de sous-graphe. Les plages sont remises a l'autoscale.
  function mergeSubplotFigures(figs) {
    const first = figs[0];
    const layout = deepClone((first.plotly && first.plotly.layout) || {});
    layout.autosize = true;
    layout.showlegend = true;
    layout.hovermode = "closest";
    layout.barmode = "overlay";
    delete layout.height;
    delete layout.title;
    Object.keys(layout).forEach(function (key) {
      if (/^(xaxis|yaxis)\d*$/.test(key) && layout[key]) {
        delete layout[key].range;   // autoscale sur les donnees combinees
      }
    });

    const data = [];
    let widthIn = (first.plotly && first.plotly.width_in) || 7;
    let heightIn = (first.plotly && first.plotly.height_in) || 4;
    figs.forEach(function (fig, index) {
      const label = compareLabel(index);
      widthIn = Math.max(widthIn, (fig.plotly && fig.plotly.width_in) || 7);
      heightIn = Math.max(heightIn, (fig.plotly && fig.plotly.height_in) || 4);
      (fig.plotly && fig.plotly.data ? fig.plotly.data : []).forEach(function (trace) {
        data.push(styleSubplotTrace(trace, label, index));
      });
    });

    return {
      id: "compare-subplots",
      title: "Superposition (sous-graphes)",
      plotly: { data: data, layout: layout, width_in: widthIn, height_in: heightIn }
    };
  }

  return {
    peerRangeUpdates: peerRangeUpdates,
    subplotSignature: subplotSignature,
    figuresShareSubplots: figuresShareSubplots,
    mergeSubplotFigures: mergeSubplotFigures,
    compareLabel: compareLabel,
  };
});
