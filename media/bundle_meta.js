// ============================================================
// bundle_meta.js
// Parties pures du "bundle publication" (sans DOM) : nom de base de
// dossier, echappement LaTeX, snippet figure.tex (\includegraphics) et
// metadata.json. Charge dans le webview (self.BundleMeta) et sous Node
// (require). Aucune dependance.
// ============================================================
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) { module.exports = api; }
  else { root.BundleMeta = api; }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // Nom de base sur (dossier + cles \label) derive du titre ; repli figure_<id>
  // si le titre ne contient aucun caractere alphanumerique.
  function sanitizeBase(title, id) {
    const cleaned = String(title || "").replace(/[^a-zA-Z0-9_\-]+/g, "_");
    if (!/[a-zA-Z0-9]/.test(cleaned)) { return "figure_" + String(id); }
    return cleaned.slice(0, 40);
  }

  // Echappe les caracteres speciaux LaTeX d'un texte libre (legende...).
  function texEscape(s) {
    return String(s)
      .replace(/\\/g, "\\textbackslash ")
      .replace(/([#$%&_{}])/g, "\\$1")
      .replace(/~/g, "\\textasciitilde ")
      .replace(/\^/g, "\\textasciicircum ");
  }

  // Snippet LaTeX prêt a \input : \includegraphics SANS extension pour que
  // pdflatex prenne figure.pdf s'il existe, sinon figure.png.
  function buildTex(base, title) {
    return [
      "% Genere par Chaz Plots — depose le dossier dans ton projet et \\input ce fichier.",
      "% \\includegraphics sans extension : pdflatex prend figure.pdf si present, sinon figure.png.",
      "% Pour un PDF vectoriel : inkscape --export-type=pdf " + base + "/figure.svg",
      "\\begin{figure}[htbp]",
      "  \\centering",
      "  \\includegraphics[width=\\columnwidth]{" + base + "/figure}",
      "  \\caption{" + texEscape(title) + "}",
      "  \\label{fig:" + base + "}",
      "\\end{figure}",
      ""
    ].join("\n");
  }

  // metadata.json : tracabilite legere de la figure exportee.
  function buildMetadata(fig, opts) {
    const o = opts || {};
    const kind = fig.frames ? "animation" : (fig.plotly ? "plotly" : "image");
    const meta = {
      tool: "Chaz Plots",
      title: fig.title || "",
      tags: Array.isArray(fig.tags) ? fig.tags : [],
      created_time: fig.ts || null,
      kind: kind,
      formats: o.formats || [],
      generated_at: o.now || new Date().toISOString(),
    };
    if (fig.plotly) {
      meta.n_traces = Array.isArray(fig.plotly.data) ? fig.plotly.data.length : null;
      meta.size_in = {
        width: fig.plotly.width_in || null,
        height: fig.plotly.height_in || null,
      };
    }
    if (fig.render) { meta.render = fig.render; }
    if (fig.provenance) { meta.provenance = fig.provenance; }
    return JSON.stringify(meta, null, 2);
  }

  return {
    sanitizeBase: sanitizeBase,
    texEscape: texEscape,
    buildTex: buildTex,
    buildMetadata: buildMetadata,
  };
});
