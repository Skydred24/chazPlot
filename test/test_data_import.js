// test/test_data_import.js — tests du parsing de fichiers de donnees delimites.
// Lancer : node test/test_data_import.js
const assert = require("assert");
const DataImport = require("../media/data_import.js");

let passed = 0;
function check(name, fn) { fn(); passed++; console.log("  ok - " + name); }

check("CSV avec en-tete : noms + colonnes numeriques", function () {
  const r = DataImport.parseDelimited("t,v\n0,1\n1,2\n2,4\n");
  assert.strictEqual(r.delimiter, ",");
  assert.strictEqual(r.hasHeader, true);
  assert.strictEqual(r.columns.length, 2);
  assert.strictEqual(r.columns[0].name, "t");
  assert.deepStrictEqual(r.columns[1].values, [1, 2, 4]);
});

check("sans en-tete : noms col1/col2 generes", function () {
  const r = DataImport.parseDelimited("0 1\n1 2\n2 3\n");
  assert.strictEqual(r.delimiter, "ws");
  assert.strictEqual(r.hasHeader, false);
  assert.strictEqual(r.columns[0].name, "col1");
  assert.strictEqual(r.columns.length, 2);
});

check("tab + point-virgule detectes", function () {
  assert.strictEqual(DataImport.parseDelimited("a\tb\n1\t2\n").delimiter, "\t");
  assert.strictEqual(DataImport.parseDelimited("a;b\n1;2\n").delimiter, ";");
});

check("commentaires (# et %) et lignes vides ignores", function () {
  const r = DataImport.parseDelimited("# titre\nx,y\n\n0,1\n% note\n1,2\n");
  assert.strictEqual(r.rowCount, 2);
  assert.deepStrictEqual(r.columns[0].values, [0, 1]);
});

check("valeurs non numeriques -> NaN, paires ecartees par seriesFromColumns", function () {
  const r = DataImport.parseDelimited("x,y\n0,1\n1,NA\n2,3\n");
  const series = DataImport.seriesFromColumns(r.columns, 0, [1], "data");
  assert.strictEqual(series.length, 1);
  assert.deepStrictEqual(series[0].x, [0, 2]);   // la ligne avec NA est sautee
  assert.deepStrictEqual(series[0].y, [1, 3]);
  assert.strictEqual(series[0].name, "data: y");
});

check("xIndex < 0 -> X = indice", function () {
  const r = DataImport.parseDelimited("v\n10\n20\n30\n");
  const series = DataImport.seriesFromColumns(r.columns, -1, [0], "");
  assert.deepStrictEqual(series[0].x, [0, 1, 2]);
  assert.deepStrictEqual(series[0].y, [10, 20, 30]);
});

check("plusieurs Y -> une serie par colonne", function () {
  const r = DataImport.parseDelimited("t,a,b\n0,1,9\n1,2,8\n");
  const series = DataImport.seriesFromColumns(r.columns, 0, [1, 2], "f");
  assert.strictEqual(series.length, 2);
  assert.strictEqual(series[0].name, "f: a");
  assert.strictEqual(series[1].name, "f: b");
});

check("fichier vide -> erreur", function () {
  assert.ok(DataImport.parseDelimited("   ").error);
  assert.ok(DataImport.parseDelimited("").error);
});

console.log("\n" + passed + " tests OK");
