// Harnais de test sans dependance pour media/bundle_meta.js
// Lancer : node test/test_bundle_meta.js
"use strict";
const assert = require("assert");
const BM = require("../media/bundle_meta.js");

let passed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log("ok   - " + name); }
  catch (e) { console.error("FAIL - " + name + " : " + e.message); process.exitCode = 1; }
}

// --- sanitizeBase ---
check("sanitizeBase: nettoie les caracteres speciaux", function () {
  assert.strictEqual(BM.sanitizeBase("My Plot!", 3), "My_Plot_");
});
check("sanitizeBase: titre vide -> figure_<id>", function () {
  assert.strictEqual(BM.sanitizeBase("", 7), "figure_7");
  assert.strictEqual(BM.sanitizeBase("***", 7), "figure_7");
});

// --- texEscape ---
check("texEscape: echappe les caracteres LaTeX", function () {
  assert.strictEqual(BM.texEscape("a_b%c&d#e"), "a\\_b\\%c\\&d\\#e");
});
check("texEscape: backslash et accolades", function () {
  assert.strictEqual(BM.texEscape("x{y}"), "x\\{y\\}");
});

// --- buildTex ---
check("buildTex: includegraphics sans extension + caption + label", function () {
  const tex = BM.buildTex("my_fig", "My Title");
  assert.ok(tex.indexOf("\\includegraphics[width=\\linewidth]{my_fig/figure}") !== -1, tex);
  assert.ok(tex.indexOf("\\caption{My Title}") !== -1, tex);
  assert.ok(tex.indexOf("\\label{fig:my_fig}") !== -1, tex);
  assert.ok(tex.indexOf("\\begin{figure}") !== -1);
});
check("buildTex: caption echappee", function () {
  const tex = BM.buildTex("f", "Taux 50%");
  assert.ok(tex.indexOf("\\caption{Taux 50\\%}") !== -1, tex);
});

// --- buildMetadata ---
check("buildMetadata: champs principaux", function () {
  const fig = {
    id: 2, title: "Essai", tags: ["a", "b"], ts: "10:00:00",
    plotly: { data: [{}, {}], width_in: 6.4, height_in: 4.8 },
    render: { mode: "plotly" },
  };
  const meta = JSON.parse(BM.buildMetadata(fig, { now: "2026-06-21T00:00:00Z", formats: ["png", "svg"] }));
  assert.strictEqual(meta.title, "Essai");
  assert.deepStrictEqual(meta.tags, ["a", "b"]);
  assert.strictEqual(meta.kind, "plotly");
  assert.strictEqual(meta.n_traces, 2);
  assert.deepStrictEqual(meta.size_in, { width: 6.4, height: 4.8 });
  assert.deepStrictEqual(meta.formats, ["png", "svg"]);
  assert.strictEqual(meta.render.mode, "plotly");
  assert.strictEqual(meta.generated_at, "2026-06-21T00:00:00Z");
  assert.strictEqual(meta.tool, "Chaz Plots");
});
check("buildMetadata: inclut la provenance si presente", function () {
  const fig = {
    id: 1, title: "P", tags: [],
    plotly: { data: [{}], width_in: 6, height_in: 4 },
    provenance: { source: "/x/run.py", line: 12, git_commit: "abc1234" },
  };
  const meta = JSON.parse(BM.buildMetadata(fig, { now: "X", formats: ["png"] }));
  assert.strictEqual(meta.provenance.source, "/x/run.py");
  assert.strictEqual(meta.provenance.line, 12);
  assert.strictEqual(meta.provenance.git_commit, "abc1234");
});
check("buildMetadata: figure image (sans plotly)", function () {
  const fig = { id: 1, title: "Img", tags: [], svg: "...", png: "..." };
  const meta = JSON.parse(BM.buildMetadata(fig, { now: "X", formats: ["svg", "png"] }));
  assert.strictEqual(meta.kind, "image");
  assert.ok(!("n_traces" in meta) || meta.n_traces === null);
});

console.log("\n" + passed + " tests OK");
