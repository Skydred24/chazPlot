// ============================================================
// figure_filter.js
// Recherche et tri des figures (fonctions pures, sans DOM) :
//   - figKind        : type de figure (animation/plotly/svg/png/image).
//   - matchesQuery   : recherche plein-texte sur titre + tags + provenance
//                      (nom de script, fonction, branche/commit git, commande).
//   - sortFigures    : tri par arrivee / titre / type / script / date.
// Charge dans le webview (self.FigureFilter) et sous Node (require).
// Aucune dependance.
// ============================================================
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) { module.exports = api; }
  else { root.FigureFilter = api; }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  function baseName(p) { return String(p || "").split(/[\\/]/).pop(); }

  function figKind(fig) {
    if (fig.frames) { return "animation"; }
    if (fig.plotly) { return "plotly"; }
    if (fig.svg) { return "svg"; }
    if (fig.png) { return "png"; }
    return "image";
  }

  // Texte indexable d'une figure : titre + tags + provenance.
  function searchHaystack(fig) {
    const parts = [fig.title || ""];
    if (Array.isArray(fig.tags)) { parts.push(fig.tags.join(" ")); }
    const p = fig.provenance;
    if (p) {
      if (p.source) { parts.push(baseName(p.source)); }
      if (p.script) { parts.push(baseName(p.script)); }
      if (p.function) { parts.push(p.function); }
      if (p.git_branch) { parts.push(p.git_branch); }
      if (p.git_commit) { parts.push(p.git_commit); }
      if (p.command) { parts.push(p.command); }
    }
    return parts.join(" ").toLowerCase();
  }

  function matchesQuery(fig, q) {
    const needle = String(q || "").trim().toLowerCase();
    if (!needle) { return true; }
    return searchHaystack(fig).indexOf(needle) !== -1;
  }

  // Cle de tri (string) + repli id pour un ordre stable.
  function sortKey(fig, mode) {
    switch (mode) {
      case "title": return (fig.title || "").toLowerCase();
      case "type": return figKind(fig);
      case "script": return baseName(fig.provenance && fig.provenance.source).toLowerCase();
      case "date": return (fig.provenance && fig.provenance.timestamp) || "";
      default: return null;   // arrivee : ordre des id
    }
  }

  function sortFigures(figs, mode) {
    const out = figs.slice();
    const descending = (mode === "date");   // date : plus recent d'abord
    out.sort(function (a, b) {
      const ka = sortKey(a, mode);
      const kb = sortKey(b, mode);
      if (ka === null) { return a.id - b.id; }   // arrivee / mode inconnu
      if (ka < kb) { return descending ? 1 : -1; }
      if (ka > kb) { return descending ? -1 : 1; }
      return a.id - b.id;                         // tie-break stable
    });
    return out;
  }

  return {
    figKind: figKind,
    searchHaystack: searchHaystack,
    matchesQuery: matchesQuery,
    sortFigures: sortFigures,
  };
});
