// ============================================================
// csv_export.js
// Construction d'un CSV "tidy" (serie,x,y[,z]) a partir des traces
// d'une figure (fonctions pures, sans DOM). Gere les series xy
// (lignes/points/barres) et les grilles z 2D (heatmap/pcolormesh),
// avec filtrage optionnel par plage x visible (zoom).
// Charge dans le webview (self.CsvExport) et sous Node (require).
// Aucune dependance.
// ============================================================
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) { module.exports = api; }
  else { root.CsvExport = api; }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  function isFiniteNum(v) { return typeof v === "number" && isFinite(v); }

  // Echappe un champ CSV (RFC 4180) : entoure de guillemets si virgule,
  // guillemet ou saut de ligne ; double les guillemets internes.
  function csvEscape(value) {
    const s = String(value);
    if (/[",\n\r]/.test(s)) { return '"' + s.replace(/"/g, '""') + '"'; }
    return s;
  }

  // Valeur de cellule : "" pour null/undefined/NaN/Infinity ; sinon la valeur
  // telle quelle (nombre -> son ecriture JS pleine precision, date ISO -> chaine).
  function formatValue(v) {
    if (v === null || v === undefined) { return ""; }
    if (typeof v === "number") { return isFinite(v) ? String(v) : ""; }
    return String(v);
  }

  // True si x (numerique) est dans la plage [lo, hi] ; un x non numerique ou
  // une plage absente n'exclut rien (ex. axes date : pas de filtre par zoom).
  function inRange(x, range) {
    if (!range) { return true; }
    if (!isFiniteNum(x)) { return true; }
    const lo = Math.min(range[0], range[1]);
    const hi = Math.max(range[0], range[1]);
    return x >= lo && x <= hi;
  }

  function isGrid(series) {
    return Array.isArray(series.z) && series.z.length > 0 && Array.isArray(series.z[0]);
  }

  // series : [{ name, x:[], y:[], z? }] ; z 2D => grille (heatmap).
  // opts.xRange : [lo, hi] pour ne garder que les points visibles.
  function buildCsv(series, opts) {
    const xRange = opts && opts.xRange ? opts.xRange : null;
    const hasZ = series.some(function (s) { return s.z != null; });
    const header = hasZ ? "serie,x,y,z" : "serie,x,y";
    const rows = [];

    series.forEach(function (s) {
      const name = csvEscape(formatValue(s.name));
      if (isGrid(s)) {
        const xs = s.x || [], ys = s.y || [], z = s.z;
        for (let i = 0; i < ys.length; i++) {
          for (let j = 0; j < xs.length; j++) {
            if (!inRange(xs[j], xRange)) { continue; }
            const zv = (z[i] && z[i][j] !== undefined) ? z[i][j] : null;
            rows.push(name + "," + csvEscape(formatValue(xs[j])) + "," +
                      csvEscape(formatValue(ys[i])) + "," + csvEscape(formatValue(zv)));
          }
        }
        return;
      }
      const xs = s.x || [], ys = s.y || [], zs = s.z || null;
      for (let k = 0; k < xs.length; k++) {
        if (!inRange(xs[k], xRange)) { continue; }
        let row = name + "," + csvEscape(formatValue(xs[k])) + "," + csvEscape(formatValue(ys[k]));
        if (hasZ) { row += "," + csvEscape(formatValue(zs ? zs[k] : null)); }
        rows.push(row);
      }
    });

    return [header].concat(rows).join("\n") + "\n";
  }

  return {
    csvEscape: csvEscape,
    formatValue: formatValue,
    inRange: inRange,
    buildCsv: buildCsv,
  };
});
