// test/test_plotly_to_py.js — tests du generateur spec Plotly embarquee -> code matplotlib.
// Lancer : node test/test_plotly_to_py.js
"use strict";
const assert = require("assert");
const P2P = require("../media/plotly_to_py.js");

let passed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log("ok   - " + name); }
  catch (e) { console.error("FAIL - " + name + " : " + e.message); process.exitCode = 1; }
}

// Figure embarquee : { title, plotly:{ data, layout } } (cf. extension.js embedFigureInFile).
function fig(data, layout, title) {
  return { title: title || "", plotly: { data: data, layout: layout || {} } };
}

check("ligne simple -> x0/y0 nommes, ax.plot(x0, y0), couleur, labels, titre", function () {
  const code = P2P.toMatplotlib(fig(
    [{
      type: "scatter", mode: "lines", x: [0, 1, 2], y: [2, 3, 1],
      line: { color: "rgba(31,119,180,1.000)", width: 1.5, dash: "solid" },
      name: "mesure", showlegend: true, xaxis: "x", yaxis: "y"
    }],
    { xaxis: { title: { text: "temps (s)" } }, yaxis: { title: { text: "tension (V)" } }, title: { text: "Ma figure" } },
    "Ma figure"
  ));
  assert.ok(/import matplotlib\.pyplot as plt/.test(code), "import plt");
  assert.ok(/fig, ax = plt\.subplots\(\)/.test(code), "subplots()");
  assert.ok(/x0 = \[0, 1, 2\]/.test(code), "x0 nomme : " + code);
  assert.ok(/y0 = \[2, 3, 1\]/.test(code), "y0 nomme");
  assert.ok(/ax\.plot\(x0, y0,/.test(code), "ax.plot(x0, y0) : " + code);
  assert.ok(/label="mesure"/.test(code), "label");
  assert.ok(/color="#1f77b4"/.test(code), "couleur hex : " + code);
  assert.ok(/linewidth=1\.5/.test(code), "linewidth");
  assert.ok(/ax\.set_xlabel\("temps \(s\)"\)/.test(code), "xlabel");
  assert.ok(/ax\.set_ylabel\("tension \(V\)"\)/.test(code), "ylabel");
  assert.ok(/ax\.set_title\("Ma figure"\)/.test(code), "title");
  assert.ok(/ax\.legend\(\)/.test(code), "legend");
  assert.ok(/plt\.show\(\)/.test(code), "show");
});

check("donnees declarees en variables AVANT plt.subplots (en haut du script)", function () {
  const code = P2P.toMatplotlib(fig(
    [{ type: "scatter", mode: "lines", x: [0, 1], y: [0, 1], xaxis: "x", yaxis: "y" }], {}
  ));
  const iData = code.indexOf("x0 = [");
  const iFig = code.indexOf("plt.subplots(");
  assert.ok(iData !== -1 && iFig !== -1, "x0 et subplots presents");
  assert.ok(iData < iFig, "les donnees viennent avant la creation des axes : " + code);
});

check("moins de decimales : 4 chiffres significatifs", function () {
  const code = P2P.toMatplotlib(fig(
    [{ type: "scatter", mode: "lines", x: [0.123456789, 9.87654321], y: [0, 1], xaxis: "x", yaxis: "y" }], {}
  ));
  assert.ok(/0\.1235/.test(code), "arrondi a 4 sig : " + code);
  assert.ok(!/0\.123456/.test(code), "plus de 6+ decimales");
  assert.ok(/9\.877/.test(code), "9.877 (4 sig)");
});

check("scatter (mode markers) -> ax.scatter(x0, y0) avec symbole, couleur, label", function () {
  const code = P2P.toMatplotlib(fig(
    [{
      type: "scatter", mode: "markers", x: [1, 2], y: [3, 4],
      marker: { symbol: "square", size: 8, color: "rgba(255,127,14,1.000)" },
      name: "pts", showlegend: true, xaxis: "x", yaxis: "y"
    }],
    {}
  ));
  assert.ok(/x0 = \[1, 2\]/.test(code) && /y0 = \[3, 4\]/.test(code), "x0/y0 nommes");
  assert.ok(/ax\.scatter\(x0, y0,/.test(code), "ax.scatter(x0, y0) : " + code);
  assert.ok(/marker="s"/.test(code), "symbole carre");
  assert.ok(/color="#ff7f0e"/.test(code), "couleur");
  assert.ok(/label="pts"/.test(code), "label");
  assert.ok(/ax\.legend\(\)/.test(code), "legend");
  assert.ok(!/ax\.plot\(/.test(code), "pas de plot");
});

check("ligne+marqueurs -> ax.plot avec marker=", function () {
  const code = P2P.toMatplotlib(fig(
    [{
      type: "scatter", mode: "lines+markers", x: [0, 1], y: [0, 1],
      line: { color: "rgba(0,0,0,1.000)", width: 1, dash: "solid" },
      marker: { symbol: "circle", size: 6, color: "rgba(0,0,0,1.000)" },
      showlegend: false, xaxis: "x", yaxis: "y"
    }],
    {}
  ));
  assert.ok(/ax\.plot\(x0, y0,/.test(code), "ax.plot(x0, y0) : " + code);
  assert.ok(/marker="o"/.test(code), "marker= sur plot");
  assert.ok(!/ax\.scatter\(/.test(code), "pas de scatter");
  assert.ok(!/ax\.legend\(\)/.test(code), "pas de legende (showlegend false)");
});

check("barres verticales -> ax.bar(x0, y0, width=w0, bottom=b0, color=c0)", function () {
  const code = P2P.toMatplotlib(fig(
    [{
      type: "bar", x: [0, 1], y: [3, 5], width: [0.8, 0.8], base: [0, 0],
      marker: { color: ["rgba(31,119,180,1.000)", "rgba(255,127,14,1.000)"] },
      orientation: "v", name: "serie", showlegend: true, xaxis: "x", yaxis: "y"
    }],
    {}
  ));
  assert.ok(/x0 = \[0, 1\]/.test(code) && /y0 = \[3, 5\]/.test(code), "x0/y0");
  assert.ok(/w0 = \[0\.8, 0\.8\]/.test(code), "w0 nomme : " + code);
  assert.ok(/b0 = \[0, 0\]/.test(code), "b0 nomme");
  assert.ok(/c0 = \["#1f77b4", "#ff7f0e"\]/.test(code), "c0 liste couleurs");
  assert.ok(/ax\.bar\(x0, y0, width=w0, bottom=b0, color=c0, label="serie"\)/.test(code), "appel bar : " + code);
});

check("barres horizontales -> ax.barh(y0, x0, height=w0, left=b0)", function () {
  const code = P2P.toMatplotlib(fig(
    [{
      type: "bar", x: [3, 5], y: [0, 1], width: [0.8, 0.8], base: [0, 0],
      marker: { color: ["rgba(0,0,0,1.000)"] },
      orientation: "h", showlegend: false, xaxis: "x", yaxis: "y"
    }],
    {}
  ));
  assert.ok(/ax\.barh\(y0, x0, height=w0, left=b0/.test(code), "appel barh : " + code);
  assert.ok(/w0 = \[0\.8, 0\.8\]/.test(code) && /b0 = \[0, 0\]/.test(code), "w0/b0 nommes");
});

check("echelle log + bornes -> set_xscale/log, set_xlim(10**range), set_ylim", function () {
  const code = P2P.toMatplotlib(fig(
    [{ type: "scatter", mode: "lines", x: [1, 10], y: [2, 4], xaxis: "x", yaxis: "y" }],
    { xaxis: { type: "log", range: [0, 2] }, yaxis: { range: [1, 5] } }
  ));
  assert.ok(/ax\.set_xscale\("log"\)/.test(code), "xscale log : " + code);
  assert.ok(/ax\.set_xlim\(1, 100\)/.test(code), "xlim = 10**range : " + code);
  assert.ok(/ax\.set_ylim\(1, 5\)/.test(code), "ylim");
  assert.ok(!/ax\.set_yscale/.test(code), "pas de yscale (lineaire)");
});

check("heatmap -> z0 = np.array, pcolormesh(x0, y0, z0), colorbar avec unite", function () {
  const code = P2P.toMatplotlib(fig(
    [{
      type: "heatmap", z: [[1, 2], [3, 4]], x: [0, 1], y: [0, 1],
      zmin: 0, zmax: 4, colorbar: { title: { text: "temperature (K)" } },
      xaxis: "x", yaxis: "y"
    }],
    {}
  ));
  assert.ok(/import numpy as np/.test(code), "import numpy : " + code);
  assert.ok(/z0 = np\.array\(\[\[1, 2\], \[3, 4\]\]\)/.test(code), "z0 array : " + code);
  assert.ok(/mesh0 = ax\.pcolormesh\(x0, y0, z0/.test(code), "pcolormesh(x0, y0, z0) : " + code);
  assert.ok(/vmin=0/.test(code) && /vmax=4/.test(code), "vmin/vmax");
  assert.ok(/fig\.colorbar\(mesh0,.*label="temperature \(K\)"/.test(code), "colorbar label : " + code);
});

check("pas de numpy si aucune heatmap", function () {
  const code = P2P.toMatplotlib(fig(
    [{ type: "scatter", mode: "lines", x: [0, 1], y: [0, 1], xaxis: "x", yaxis: "y" }], {}
  ));
  assert.ok(!/import numpy/.test(code), "pas d'import numpy inutile");
});

check("type non gere -> commentaire, jamais d'echec", function () {
  const code = P2P.toMatplotlib(fig(
    [{ type: "scatterpolar", r: [1, 2], theta: [0, 90] }], {}
  ));
  assert.ok(/# trace 0 de type 'scatterpolar' non reproductible/.test(code), "commentaire : " + code);
  assert.ok(/import matplotlib\.pyplot as plt/.test(code), "script quand meme valide");
  assert.ok(/plt\.show\(\)/.test(code), "show present");
});

check("sous-graphes (2 paires d'axes, 2 domaines x) -> subplots(1, 2) et axs[r][c]", function () {
  const code = P2P.toMatplotlib(fig(
    [
      { type: "scatter", mode: "lines", x: [0, 1], y: [0, 1], xaxis: "x", yaxis: "y" },
      { type: "scatter", mode: "lines", x: [0, 1], y: [1, 0], xaxis: "x2", yaxis: "y2" }
    ],
    {
      xaxis: { domain: [0, 0.45], title: { text: "gauche" } }, yaxis: { domain: [0, 1] },
      xaxis2: { domain: [0.55, 1], title: { text: "droite" } }, yaxis2: { domain: [0, 1] }
    }
  ));
  assert.ok(/fig, axs = plt\.subplots\(1, 2, squeeze=False\)/.test(code), "subplots(1,2) : " + code);
  assert.ok(/axs\[0\]\[0\]\.plot\(x0, y0[,)]/.test(code), "panneau gauche x0/y0 : " + code);
  assert.ok(/axs\[0\]\[1\]\.plot\(x1, y1[,)]/.test(code), "panneau droit x1/y1");
  assert.ok(/axs\[0\]\[0\]\.set_xlabel\("gauche"\)/.test(code), "xlabel gauche");
  assert.ok(/axs\[0\]\[1\]\.set_xlabel\("droite"\)/.test(code), "xlabel droite");
  assert.ok(!/fig, ax = plt\.subplots\(\)/.test(code), "pas de ax unique");
});

check("deux traces meme paire d'axes -> un seul ax, deux plots", function () {
  const code = P2P.toMatplotlib(fig(
    [
      { type: "scatter", mode: "lines", x: [0, 1], y: [0, 1], xaxis: "x", yaxis: "y" },
      { type: "scatter", mode: "lines", x: [0, 1], y: [1, 0], xaxis: "x", yaxis: "y" }
    ],
    { xaxis: {}, yaxis: {} }
  ));
  assert.ok(/fig, ax = plt\.subplots\(\)/.test(code), "ax unique : " + code);
  assert.ok((code.match(/ax\.plot\(/g) || []).length === 2, "deux plots sur le meme ax");
  assert.ok(/ax\.plot\(x0, y0[,)]/.test(code) && /ax\.plot\(x1, y1[,)]/.test(code), "x0/y0 et x1/y1 distincts");
});

check("le code genere est du Python syntaxiquement valide (py_compile)", function () {
  const cp = require("child_process");
  // figure exhaustive : lignes, scatter, barres, heatmap, sous-graphes
  const code = P2P.toMatplotlib(fig(
    [
      { type: "scatter", mode: "lines+markers", x: [0, 1, 2], y: [2, 3.5, 1],
        line: { color: "rgba(31,119,180,1.000)", width: 1.5, dash: "dash" },
        marker: { symbol: "circle", size: 6, color: "rgba(31,119,180,1.000)" },
        name: 'a"b', showlegend: true, xaxis: "x", yaxis: "y" },
      { type: "bar", x: [0, 1], y: [3, 5], width: [0.8, 0.8], base: [0, 0],
        marker: { color: ["rgba(255,127,14,1.000)", "rgba(44,160,44,1.000)"] },
        orientation: "v", xaxis: "x", yaxis: "y" },
      { type: "heatmap", z: [[1, 2], [3, 4]], x: [0, 1], y: [0, 1], zmin: 0, zmax: 4,
        colorbar: { title: { text: "u" } }, xaxis: "x2", yaxis: "y2" }
    ],
    {
      xaxis: { domain: [0, 0.45], type: "log", range: [0, 2], title: { text: "t" } },
      yaxis: { domain: [0, 1], range: [0, 6], title: { text: "v" } },
      xaxis2: { domain: [0.55, 1] }, yaxis2: { domain: [0, 1] }
    },
    "Titre"
  ));

  function pyCompiles(exe) {
    try {
      const r = cp.spawnSync(exe, ["-c",
        "import sys; compile(sys.stdin.read(), '<gen>', 'exec')"],
        { input: code, encoding: "utf8" });
      if (r.error) { return null; }       // exe introuvable
      return { ok: r.status === 0, err: r.stderr };
    } catch (e) { return null; }
  }
  let res = pyCompiles("python");
  if (res === null) { res = pyCompiles("py"); }
  if (res === null) { console.log("     (python indisponible, compilation non verifiee)"); return; }
  assert.ok(res.ok, "le code genere ne compile pas :\n" + res.err + "\n--- code ---\n" + code);
});

console.log("\n" + passed + " tests OK");
