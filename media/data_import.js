// data_import.js — parsing pur de fichiers de donnees delimites (CSV/.dat/TSV)
// pour les superposer sur une figure. Module UMD : self.DataImport dans le
// webview, require() sous Node (teste par test/test_data_import.js).
//
// Aucune dependance, aucune I/O : prend le TEXTE du fichier et renvoie des
// colonnes numeriques. La glue (panel.html) lit le fichier (FileReader pour un
// glisser systeme, ou via l'extension/fs pour un glisser de l'explorateur VS
// Code), appelle parseDelimited, propose un mappage X/Y, puis seriesFromColumns.
(function () {
  "use strict";
  var api = {};

  function splitLine(line, delim) {
    if (delim === "ws") { return line.trim().split(/\s+/); }
    return line.split(delim);
  }

  function isNumeric(s) {
    if (s == null) { return false; }
    var t = String(s).trim();
    if (t === "") { return false; }
    return isFinite(Number(t));
  }

  // Texte d'un fichier delimite -> { columns:[{name, values:[number|NaN]}],
  // delimiter, hasHeader, rowCount } ou { error }. Lignes vides et commentaires
  // (# ou %) ignorees ; delimiteur auto (, ; tab, sinon espaces) ; en-tete
  // detecte si la 1re ligne contient un libelle non numerique.
  function parseDelimited(text) {
    if (typeof text !== "string" || !text.trim()) { return { error: "fichier vide" }; }
    var lines = text.split(/\r\n|\r|\n/).filter(function (l) {
      var t = l.trim();
      return t !== "" && t.charAt(0) !== "#" && t.charAt(0) !== "%";
    });
    if (!lines.length) { return { error: "aucune ligne de donnees" }; }

    var first = lines[0];
    var delim = "ws";
    if (first.indexOf(",") >= 0) { delim = ","; }
    else if (first.indexOf(";") >= 0) { delim = ";"; }
    else if (first.indexOf("\t") >= 0) { delim = "\t"; }

    var firstCells = splitLine(lines[0], delim).map(function (s) { return s.trim(); });
    var hasHeader = firstCells.some(function (c) { return c !== "" && !isNumeric(c); });
    var dataStart = hasHeader ? 1 : 0;

    var ncol = 0;
    var rows = [];
    for (var i = dataStart; i < lines.length; i++) {
      var cells = splitLine(lines[i], delim);
      if (cells.length > ncol) { ncol = cells.length; }
      rows.push(cells);
    }
    if (!rows.length || ncol < 1) { return { error: "aucune donnee exploitable" }; }

    var columns = [];
    for (var c = 0; c < ncol; c++) {
      columns.push({ name: (hasHeader && firstCells[c]) ? firstCells[c] : ("col" + (c + 1)), values: [] });
    }
    rows.forEach(function (cells) {
      for (var c2 = 0; c2 < ncol; c2++) {
        var v = c2 < cells.length ? Number(String(cells[c2]).trim()) : NaN;
        columns[c2].values.push(isFinite(v) ? v : NaN);
      }
    });
    // Colonnes entierement non numeriques (ex. delimiteur final) ecartees.
    columns = columns.filter(function (col) { return col.values.some(function (v) { return isFinite(v); }); });
    if (!columns.length) { return { error: "aucune colonne numerique" }; }

    return { columns: columns, delimiter: delim, hasHeader: hasHeader, rowCount: rows.length };
  }

  // columns + choix X/Y -> liste de series {x, y, name} pretes a tracer.
  // xIndex < 0 => X = indice (0,1,2,...). Paires (x,y) non finies ecartees.
  function seriesFromColumns(columns, xIndex, yIndices, baseName) {
    var useIndex = xIndex == null || xIndex < 0 || !columns[xIndex];
    var xcol = useIndex ? null : columns[xIndex];
    return (yIndices || []).map(function (yi) {
      var ycol = columns[yi];
      if (!ycol) { return null; }
      var x = [], y = [];
      var n = ycol.values.length;
      for (var i = 0; i < n; i++) {
        var yv = ycol.values[i];
        var xv = useIndex ? i : xcol.values[i];
        if (isFinite(xv) && isFinite(yv)) { x.push(xv); y.push(yv); }
      }
      var nm = ycol.name;
      return { x: x, y: y, name: (baseName ? baseName + ": " : "") + nm };
    }).filter(Boolean);
  }

  api.parseDelimited = parseDelimited;
  api.seriesFromColumns = seriesFromColumns;

  if (typeof module !== "undefined" && module.exports) { module.exports = api; }
  if (typeof self !== "undefined") { self.DataImport = api; }
})();
