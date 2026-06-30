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

  // Retire les guillemets entourant une cellule (CSV RFC 4180) et dedouble les
  // guillemets internes. Sert aux fichiers exportes par Chaz Plots (valeurs a
  // virgule decimale entourees de guillemets) comme aux exports tableur.
  function stripQuotes(s) {
    var t = String(s == null ? "" : s).trim();
    if (t.length >= 2 && t.charAt(0) === '"' && t.charAt(t.length - 1) === '"') {
      t = t.slice(1, -1).replace(/""/g, '"');
    }
    return t;
  }

  // Convertit une cellule en nombre. Gere la VIRGULE DECIMALE (Excel/FR) : si le
  // delimiteur n'est pas la virgule, une virgule dans la cellule = separateur
  // decimal -> converti en point. Tolere les espaces (milliers).
  function toNumber(s, delim) {
    var t = stripQuotes(s);
    if (t === "") { return NaN; }
    if (delim !== ",") { t = t.replace(",", "."); }
    t = t.replace(/\s/g, "");
    return Number(t);
  }

  function isNumeric(s, delim) {
    return isFinite(toNumber(s, delim));
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

    var firstCells = splitLine(lines[0], delim).map(function (s) { return stripQuotes(s); });
    var hasHeader = firstCells.some(function (c) { return c !== "" && !isNumeric(c, delim); });
    var dataStart = hasHeader ? 1 : 0;

    // ── Detection du format « large groupe » de Chaz Plots ──
    // 1re ligne = noms (au-dessus des colonnes X), 2e ligne = « x ; y ; ; x ; y »,
    // colonnes vides de separation. Si la 2e ligne ne contient que x/y/vide, on
    // saute cette ligne d'axes et on reconstitue les PAIRES (chaque y avec son x).
    var pairs = null;
    if (hasHeader && lines.length > 1) {
      var axis = splitLine(lines[1], delim).map(function (s) { return stripQuotes(s).toLowerCase(); });
      var onlyAxis = axis.length > 1 && axis.every(function (c) { return c === "" || c === "x" || c === "y"; });
      if (onlyAxis && axis.indexOf("x") >= 0 && axis.indexOf("y") >= 0) {
        dataStart = 2;   // sauter noms + axes
        var xIdx = [], yIdx = [], lastX = -1;
        for (var a = 0; a < axis.length; a++) {
          if (axis[a] === "x") { lastX = a; }
          else if (axis[a] === "y" && lastX >= 0) { xIdx.push(lastX); yIdx.push(a); }
        }
        pairs = { xIndices: xIdx, yIndices: yIdx, axis: axis };
      }
    }

    var ncol = 0;
    var rows = [];
    for (var i = dataStart; i < lines.length; i++) {
      var cells = splitLine(lines[i], delim);
      if (cells.length > ncol) { ncol = cells.length; }
      rows.push(cells);
    }
    if (!rows.length || ncol < 1) { return { error: "aucune donnee exploitable" }; }

    // En format groupe, les noms de SERIE sont au-dessus des colonnes X ; on les
    // reporte sur la colonne Y associee pour que la serie soit bien nommee.
    function colName(c) {
      if (!hasHeader) { return "col" + (c + 1); }
      if (pairs) {
        var k = pairs.yIndices.indexOf(c);
        if (k >= 0) { return firstCells[pairs.xIndices[k]] || ("serie" + (k + 1)); }
      }
      return firstCells[c] || ("col" + (c + 1));
    }

    var columns = [];
    for (var c = 0; c < ncol; c++) {
      columns.push({ name: colName(c), values: [] });
    }
    rows.forEach(function (cells) {
      for (var c2 = 0; c2 < ncol; c2++) {
        var v = c2 < cells.length ? toNumber(cells[c2], delim) : NaN;
        columns[c2].values.push(isFinite(v) ? v : NaN);
      }
    });

    // En format groupe, on garde les indices tels quels (les paires y referent).
    // Sinon on ecarte les colonnes entierement non numeriques (delimiteur final…).
    if (!pairs) {
      columns = columns.filter(function (col) { return col.values.some(function (v) { return isFinite(v); }); });
    }
    if (!columns.length) { return { error: "aucune colonne numerique" }; }

    var out = { columns: columns, delimiter: delim, hasHeader: hasHeader, rowCount: rows.length };
    if (pairs && pairs.yIndices.length) { out.pairs = { xIndices: pairs.xIndices, yIndices: pairs.yIndices }; }
    return out;
  }

  // columns + choix X/Y -> liste de series {x, y, name} pretes a tracer.
  // xIndex < 0 => X = indice (0,1,2,...). Paires (x,y) non finies ecartees.
  //
  // xIndex peut etre :
  //   - un nombre : X commun a toutes les series Y (cas usuel) ;
  //   - un tableau parallele a yIndices : un X propre a chaque Y (donnees en
  //     paires X1,Y1,X2,Y2,...). Une entree absente retombe sur l'indice.
  function seriesFromColumns(columns, xIndex, yIndices, baseName) {
    var perY = Array.isArray(xIndex);
    return (yIndices || []).map(function (yi, k) {
      var ycol = columns[yi];
      if (!ycol) { return null; }
      var xi = perY ? xIndex[k] : xIndex;
      var useIndex = xi == null || xi < 0 || !columns[xi];
      var xcol = useIndex ? null : columns[xi];
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
  api.splitLine = splitLine;
  api.toNumber = toNumber;

  if (typeof module !== "undefined" && module.exports) { module.exports = api; }
  if (typeof self !== "undefined") { self.DataImport = api; }
})();
