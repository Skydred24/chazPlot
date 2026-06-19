// ============================================================
// Spyder Plots — extension VS Code
// Reçoit les figures matplotlib envoyées par le backend Python
// (python/vscode_spyder_plots_backend.py) et les affiche dans un
// panneau webview scrollable, façon volet "Graphes" de Spyder.
// ============================================================
"use strict";

const vscode = require("vscode");
const http = require("http");
const path = require("path");
const fs = require("fs");
const storage = require("./storage");

let panel = null;          // WebviewPanel unique
let figures = [];          // [{id, png(base64), title, ts}]
let nextId = 1;
let server = null;
let extContext = null;
let activePort = null;
let nextExportRequestId = 1;
const pendingExports = {};

// ------------------------------------------------------------
// Activation
// ------------------------------------------------------------
function activate(context) {
  extContext = context;
  storage.init(context);
  figures = storage.loadAll();
  nextId = storage.nextId();
  figures.forEach(function (f) { if (f.id >= nextId) { nextId = f.id + 1; } });
  const cfg = vscode.workspace.getConfiguration("spyderPlots");
  startServer(cfg.get("port", 53210), 0);

  // --- Sérialiseur pour survivre au détachement de la fenêtre ---
  vscode.window.registerWebviewPanelSerializer("spyderPlots", {
    async deserializeWebviewPanel(webviewPanel, state) {
      panel = webviewPanel;
      setupPanel(panel);
    }
  });

  context.subscriptions.push(
    vscode.commands.registerCommand("spyderPlots.open", () => ensurePanel(true)),
    vscode.commands.registerCommand("spyderPlots.deleteAll", deleteAll),
    vscode.commands.registerCommand("spyderPlots.saveAll", saveAll)
  );
}

function deactivate() {
  if (server) {
    server.close();
  }
}

// ------------------------------------------------------------
// Serveur HTTP local : reçoit les figures du backend Python
// ------------------------------------------------------------
function startServer(port, attempt) {
  server = http.createServer(function (req, res) {
    if (req.method === "POST" && req.url === "/figure") {
      const chunks = [];
      req.on("data", function (c) { chunks.push(c); });
      req.on("end", function () {
        try {
          const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          const hasPlotly = data.plotly && typeof data.plotly === "object";
          const hasSvg = typeof data.svg === "string" && data.svg.length > 0;
          const hasPng = typeof data.png === "string" && data.png.length > 0;
          const hasFrames = Array.isArray(data.frames) && data.frames.length > 0;
          if (!hasPlotly && !hasSvg && !hasPng && !hasFrames) {
            throw new Error("plotly/svg/png/frames manquant");
          }
          addFigure(data);
          res.writeHead(200, { "Content-Type": "text/plain" });
          res.end("ok");
        } catch (e) {
          res.writeHead(400, { "Content-Type": "text/plain" });
          res.end("bad request");
        }
      });
    } else if (req.method === "GET" && req.url === "/ping") {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("spyder-plots");
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  server.on("error", function (err) {
    if (err && err.code === "EADDRINUSE" && attempt < 20) {
      startServer(port + 1, attempt + 1);
    } else {
      vscode.window.showErrorMessage("Spyder Plots : impossible d'ouvrir un port local (" + String(err) + ")");
    }
  });

  server.listen(port, "127.0.0.1", function () {
    activePort = port;
    writePortFile(port);
    injectEnvironment(port);
  });
}

// ------------------------------------------------------------
// Variables d'environnement injectées dans les NOUVEAUX terminaux :
//   MPLBACKEND        -> notre backend matplotlib
//   PYTHONPATH        -> dossier python/ de l'extension
//   VSCODE_PLOTS_PORT -> port du serveur
//   VSCODE_PLOTS_DPI  -> dpi du rendu
// ------------------------------------------------------------
// Fichier de port (fallback pour le backend si VSCODE_PLOTS_PORT est perime).
function portFilePath() {
  return path.join(require("os").tmpdir(), "spyder-plots-port.json");
}

function writePortFile(port) {
  try {
    fs.writeFileSync(
      portFilePath(),
      JSON.stringify({ port: port, pid: process.pid, ts: Date.now() }),
      "utf8"
    );
  } catch (e) {
    // best-effort : l'injection env reste le canal principal
  }
}

function injectEnvironment(port) {
  const cfg = vscode.workspace.getConfiguration("spyderPlots");
  const pyDir = path.join(extContext.extensionPath, "python");
  const env = extContext.environmentVariableCollection;
  env.clear();
  env.replace("MPLBACKEND", "module://vscode_spyder_plots_backend");
  env.replace("VSCODE_PLOTS_PORT", String(port));
  env.replace("VSCODE_PLOTS_DPI", String(cfg.get("dpi", 200)));
  env.replace("VSCODE_PLOTS_ANIM_DPI", String(cfg.get("animationDpi", 130)));
  env.replace("VSCODE_PLOTS_ANIM_MAX_FRAMES", String(cfg.get("animationMaxFrames", 600)));
  env.prepend("PYTHONPATH", pyDir + path.delimiter);
}

// ------------------------------------------------------------
// Gestion des figures
// ------------------------------------------------------------
function addFigure(data) {
  const hasFrames = Array.isArray(data.frames) && data.frames.length > 0;
  const fig = {
    id: nextId,
    plotly: data.plotly && typeof data.plotly === "object" ? data.plotly : null,
    pgf: typeof data.pgf === "string" && data.pgf.length > 0 ? data.pgf : null,
    svg: typeof data.svg === "string" && data.svg.length > 0 ? data.svg : null,
    png: typeof data.png === "string" && data.png.length > 0 ? data.png : null,
    frames: hasFrames ? data.frames : null,
    interval: hasFrames ? Number(data.interval) || 100 : null,
    title: data.title ? String(data.title) : "Figure " + String(nextId),
    tags: Array.isArray(data.tags) ? data.tags.map(String) : [],
    ts: new Date().toLocaleTimeString()
  };
  nextId = nextId + 1;
  figures.push(fig);
  storage.save(fig);

  const cfg = vscode.workspace.getConfiguration("spyderPlots");
  ensurePanel(cfg.get("autoReveal", true));
  postToWebview({ type: "add", fig: fig });
}

function deleteOne(id) {
  figures = figures.filter(function (f) { return f.id !== id; });
  storage.remove(id);
  postToWebview({ type: "remove", id: id });
}

function deleteAll() {
  figures = [];
  storage.removeAll();
  postToWebview({ type: "reset", figs: [] });
}

function normalizeTags(tags) {
  const seen = {};
  const out = [];
  if (!Array.isArray(tags)) { return out; }
  tags.forEach(function (tag) {
    const clean = String(tag).trim();
    const key = clean.toLowerCase();
    if (clean.length > 0 && !seen[key]) {
      seen[key] = true;
      out.push(clean);
    }
  });
  return out;
}

function updateTags(id, tags) {
  const fig = figures.find(function (f) { return f.id === id; });
  if (!fig) { return; }
  fig.tags = normalizeTags(tags);
  storage.updateTags(id, fig.tags);
  postToWebview({ type: "tags", id: id, tags: fig.tags });
}

function editTags(id) {
  const fig = figures.find(function (f) { return f.id === id; });
  if (!fig) { return; }
  vscode.window.showInputBox({
    title: "Tags - " + fig.title,
    prompt: "Separez les tags par des virgules. Exemple : mach, gamma, test 1",
    value: normalizeTags(fig.tags).join(", "),
    placeHolder: "mach, gamma, test 1"
  }).then(function (value) {
    if (value === undefined) { return; }
    updateTags(id, value.split(","));
  });
}

// ------------------------------------------------------------
// Enregistrement
// ------------------------------------------------------------
function defaultName(fig, ext) {
  const clean = fig.title.replace(/[^a-zA-Z0-9_\-]+/g, "_").slice(0, 40);
  const base = clean.length > 0 ? clean : "figure_" + String(fig.id);
  return base + "." + ext;
}

function writeFigure(fig, filePath, frameIndex) {
  // le format est deduit de l'extension du chemin choisi
  const wantSvg = filePath.toLowerCase().endsWith(".svg");
  // Animation : on enregistre la frame demandee (ou la premiere) en PNG.
  if (fig.frames) {
    let idx = typeof frameIndex === "number" ? frameIndex : 0;
    if (idx < 0 || idx >= fig.frames.length) { idx = 0; }
    const outPath = wantSvg ? filePath.replace(/\.svg$/i, ".png") : filePath;
    fs.writeFileSync(outPath, Buffer.from(fig.frames[idx], "base64"));
    return true;
  }
  if (wantSvg && fig.svg !== null) {
    fs.writeFileSync(filePath, Buffer.from(fig.svg, "base64"));
    return true;
  }
  if (!wantSvg && fig.png !== null) {
    fs.writeFileSync(filePath, Buffer.from(fig.png, "base64"));
    return true;
  }
  // format demande indisponible : on ecrit ce qu'on a, avec la bonne extension
  if (fig.png !== null) {
    fs.writeFileSync(filePath.replace(/\.svg$/i, ".png"), Buffer.from(fig.png, "base64"));
    return true;
  }
  if (fig.svg !== null) {
    fs.writeFileSync(filePath.replace(/\.png$/i, ".svg"), Buffer.from(fig.svg, "base64"));
    return true;
  }
  return false;
}

function writeDataUrl(filePath, dataUrl) {
  const match = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(dataUrl || "");
  if (!match) {
    throw new Error("data URL invalide");
  }
  const isBase64 = match[2] === ";base64";
  const payload = match[3] || "";
  const buffer = isBase64
    ? Buffer.from(payload, "base64")
    : Buffer.from(decodeURIComponent(payload), "utf8");
  fs.writeFileSync(filePath, buffer);
}

async function plotlyExportOptions(fig) {
  const formatPick = await vscode.window.showQuickPick([
    { label: "PNG", description: "raster, qualite controlee par le DPI", value: "png" },
    { label: "SVG", description: "vectoriel, recommande pour Word/Pandoc", value: "svg" }
  ], { placeHolder: "Format d'export" });
  if (!formatPick) { return null; }

  let dpi = null;
  let scale = 1;
  if (formatPick.value === "png") {
    const cfg = vscode.workspace.getConfiguration("spyderPlots");
    const rawDpi = await vscode.window.showInputBox({
      prompt: "DPI equivalent pour le PNG (comme savefig(dpi=...))",
      value: String(cfg.get("dpi", 200)),
      validateInput: function (value) {
        const n = Number(value);
        if (!isFinite(n) || n < 24 || n > 1200) {
          return "Entrez un DPI entre 24 et 1200.";
        }
        return null;
      }
    });
    if (rawDpi === undefined) { return null; }
    dpi = Number(rawDpi);
    scale = Math.max(0.25, dpi / 96);
  }

  const backgroundPick = await vscode.window.showQuickPick([
    { label: "Fond blanc", description: "equivalent facecolor='white'", value: false },
    { label: "Fond transparent", description: "equivalent transparent=True", value: true }
  ], { placeHolder: "Fond de la figure" });
  if (!backgroundPick) { return null; }

  return {
    format: formatPick.value,
    dpi: dpi,
    scale: scale,
    transparent: backgroundPick.value
  };
}

async function saveOne(id, frameIndex) {
  const fig = figures.find(function (f) { return f.id === id; });
  if (!fig) { return; }

  if (fig.plotly && !fig.frames) {
    const options = await plotlyExportOptions(fig);
    if (!options) { return; }
    const uri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(path.join(workspaceDir(), defaultName(fig, options.format))),
      filters: options.format === "svg"
        ? { "Image SVG (vectoriel)": ["svg"] }
        : { "Image PNG": ["png"] }
    });
    if (!uri) { return; }
    const requestId = String(nextExportRequestId++);
    pendingExports[requestId] = { filePath: uri.fsPath, title: fig.title };
    postToWebview({
      type: "exportPlotly",
      id: fig.id,
      requestId: requestId,
      options: options
    });
    return;
  }

  const cfg = vscode.workspace.getConfiguration("spyderPlots");
  const ext = fig.frames ? "png" : cfg.get("saveFormat", "png");
  vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.file(path.join(workspaceDir(), defaultName(fig, ext))),
    filters: { "Image PNG": ["png"], "Image SVG (vectoriel)": ["svg"] }
  }).then(function (uri) {
    if (!uri) { return; }
    try {
      writeFigure(fig, uri.fsPath, frameIndex);
      vscode.window.showInformationMessage("Figure enregistree : " + uri.fsPath);
    } catch (err) {
      vscode.window.showErrorMessage("Spyder Plots : echec de l'enregistrement (" + String(err) + ")");
    }
  });
}

function finishPlotlyExport(msg) {
  const request = pendingExports[msg.requestId];
  if (!request) { return; }
  delete pendingExports[msg.requestId];
  if (!msg.ok) {
    vscode.window.showErrorMessage("Spyder Plots : echec de l'export Plotly (" + String(msg.error || "erreur inconnue") + ")");
    return;
  }
  try {
    writeDataUrl(request.filePath, msg.dataUrl);
    vscode.window.showInformationMessage("Figure exportee : " + request.filePath);
  } catch (err) {
    vscode.window.showErrorMessage("Spyder Plots : echec de l'ecriture de l'export (" + String(err) + ")");
  }
}
function pgfText(fig) {
  if (!fig || fig.pgf === null) { return null; }
  return Buffer.from(fig.pgf, "base64").toString("utf8");
}

function copyPgf(id) {
  const fig = figures.find(function (f) { return f.id === id; });
  const text = pgfText(fig);
  if (text === null) {
    vscode.window.showWarningMessage("Spyder Plots : aucun code PGF/TikZ disponible pour cette figure.");
    return;
  }
  vscode.env.clipboard.writeText(text).then(function () {
    vscode.window.showInformationMessage("Code PGF/TikZ copie dans le presse-papiers.");
  }, function (err) {
    vscode.window.showErrorMessage("Spyder Plots : impossible de copier le PGF/TikZ (" + String(err) + ")");
  });
}

function savePgf(id) {
  const fig = figures.find(function (f) { return f.id === id; });
  const text = pgfText(fig);
  if (text === null) {
    vscode.window.showWarningMessage("Spyder Plots : aucun code PGF/TikZ disponible pour cette figure.");
    return;
  }
  vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.file(path.join(workspaceDir(), defaultName(fig, "pgf"))),
    filters: { "Code LaTeX PGF/TikZ": ["pgf", "tex"] }
  }).then(function (uri) {
    if (!uri) { return; }
    try {
      fs.writeFileSync(uri.fsPath, text, "utf8");
      vscode.window.showInformationMessage("Code PGF/TikZ enregistre : " + uri.fsPath);
    } catch (err) {
      vscode.window.showErrorMessage("Spyder Plots : echec de l'enregistrement PGF/TikZ (" + String(err) + ")");
    }
  });
}

function saveAll() {
  if (figures.length === 0) {
    vscode.window.showInformationMessage("Spyder Plots : aucune figure à enregistrer.");
    return;
  }
  vscode.window.showOpenDialog({
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    openLabel: "Enregistrer les " + String(figures.length) + " figures ici"
  }).then(function (uris) {
    if (!uris || uris.length === 0) { return; }
    const dir = uris[0].fsPath;
    const cfg = vscode.workspace.getConfiguration("spyderPlots");
    const ext = cfg.get("saveFormat", "png");
    let count = 0;
    for (let i = 0; i < figures.length; i = i + 1) {
      const fig = figures[i];
      const name = String(i + 1).padStart(2, "0") + "_" + defaultName(fig, ext);
      try {
        if (writeFigure(fig, path.join(dir, name))) {
          count = count + 1;
        }
      } catch (e) {
        // on continue avec les suivantes
      }
    }
    vscode.window.showInformationMessage("Spyder Plots : " + String(count) + " figure(s) enregistrée(s) dans " + dir);
  });
}

function workspaceDir() {
  const folders = vscode.workspace.workspaceFolders;
  if (folders && folders.length > 0) {
    return folders[0].uri.fsPath;
  }
  return require("os").homedir();
}

// ------------------------------------------------------------
// Panneau webview
// ------------------------------------------------------------
function setupPanel(p) {
  p.webview.options = {
    enableScripts: true,
    retainContextWhenHidden: true,
    localResourceRoots: [vscode.Uri.file(path.join(extContext.extensionPath, "media"))]
  };
  p.webview.html = webviewHtml(p.webview);

  p.webview.onDidReceiveMessage(function (msg) {
    if (msg.type === "save") { saveOne(msg.id, msg.frameIndex); }
    else if (msg.type === "copyPgf") { copyPgf(msg.id); }
    else if (msg.type === "savePgf") { savePgf(msg.id); }
    else if (msg.type === "exportResult") { finishPlotlyExport(msg); }
    else if (msg.type === "updateTags") { updateTags(msg.id, msg.tags); }
    else if (msg.type === "editTags") { editTags(msg.id); }
    else if (msg.type === "saveAll") { saveAll(); }
    else if (msg.type === "delete") { deleteOne(msg.id); }
    else if (msg.type === "deleteAll") { deleteAll(); }
    else if (msg.type === "ready") { postToWebview({ type: "reset", figs: figures }); }
  });

  p.onDidDispose(function () {
    // Évite le conflit de destruction lors du détachement
    if (panel === p) { panel = null; }
  });
}

function ensurePanel(reveal) {
  if (panel) {
    if (reveal) {
      // 'undefined' permet au panneau de rester détaché sur un autre écran
      panel.reveal(undefined, true);
    }
    return;
  }
  panel = vscode.window.createWebviewPanel(
    "spyderPlots",
    "Graphes",
    { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.file(path.join(extContext.extensionPath, "media"))]
    }
  );
  
  setupPanel(panel);
}

function postToWebview(message) {
  if (panel) {
    panel.webview.postMessage(message);
  }
}

// ------------------------------------------------------------
// HTML du webview — interface façon volet Graphes de Spyder
// ------------------------------------------------------------
function webviewHtml(webview) {
  const nonce = String(Date.now()) + String(Math.floor(Math.random() * 100000));
  const plotlyUri = webview.asWebviewUri(
    vscode.Uri.file(path.join(extContext.extensionPath, "media", "plotly.min.js"))
  );
  const htmlPath = path.join(extContext.extensionPath, "media", "panel.html");
  let template = null;
  try {
    template = fs.readFileSync(htmlPath, "utf8");
  } catch (e) {
    template = null;
  }
  if (template !== null) {
    return template
      .replace(/{{nonce}}/g, nonce)
      .replace(/{{cspSource}}/g, webview.cspSource)
      .replace(/{{plotlyUri}}/g, String(plotlyUri));
  }
  // Fallback : ancien HTML inline si le fichier media/panel.html est absent.
  return [
    "<!DOCTYPE html>",
    "<html lang='fr'>",
    "<head>",
    "<meta charset='UTF-8'>",
    "<meta http-equiv='Content-Security-Policy' content=\"default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; script-src 'nonce-" + nonce + "' " + webview.cspSource + ";\">",
    "<script src='" + String(plotlyUri) + "'></script>",
    "<style>",
    "  :root{ color-scheme: light dark; }",
    "  body{ margin:0; font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); }",
    "  .toolbar{ position:sticky; top:0; z-index:10; display:flex; align-items:center; gap:8px;",
    "    padding:8px 12px; background: var(--vscode-sideBar-background); border-bottom:1px solid var(--vscode-panel-border); }",
    "  .toolbar .spacer{ flex:1; }",
    "  .count{ font-size:12px; opacity:.75; }",
    "  button{ font-family:inherit; font-size:12px; cursor:pointer; border:1px solid var(--vscode-button-border, transparent);",
    "    background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground);",
    "    border-radius:4px; padding:4px 10px; }",
    "  button:hover{ background: var(--vscode-button-secondaryHoverBackground); }",
    "  button.primary{ background: var(--vscode-button-background); color: var(--vscode-button-foreground); }",
    "  button.primary:hover{ background: var(--vscode-button-hoverBackground); }",
    "  label.fit{ font-size:12px; display:flex; align-items:center; gap:5px; opacity:.85; }",
    "  #list{ padding:14px; display:flex; flex-direction:column; gap:16px; }",
    "  .card{ border:1px solid var(--vscode-panel-border); border-radius:6px; overflow:hidden; background: var(--vscode-sideBar-background); }",
    "  .card-head{ display:flex; align-items:center; gap:8px; padding:6px 10px; border-bottom:1px solid var(--vscode-panel-border); }",
    "  .card-head .title{ font-size:12px; font-weight:600; }",
    "  .card-head .ts{ font-size:11px; opacity:.6; }",
    "  .card-head .spacer{ flex:1; }",
    "  .imgwrap{ background:#ffffff; text-align:center; padding:8px; }",
    "  .imgwrap img{ max-width:100%; height:auto; display:inline-block; }",
    "  .imgwrap img.vector{ width:100%; }",
    "  body.no-fit .imgwrap img{ max-width:none; }",
    "  body.no-fit .imgwrap img.vector{ width:auto; }",
    "  body.no-fit .imgwrap{ overflow-x:auto; }",
    "  .empty{ padding:60px 20px; text-align:center; opacity:.6; font-size:13px; }",
    "</style>",
    "</head>",
    "<body class='fit'>",
    "  <div class='toolbar'>",
    "    <button class='primary' id='saveAll'>Tout enregistrer</button>",
    "    <button id='deleteAll'>Tout supprimer</button>",
    "    <label class='fit'><input type='checkbox' id='fitToggle' checked> Ajuster à la largeur</label>",
    "    <span class='spacer'></span>",
    "    <span class='count' id='count'>0 graphe</span>",
    "  </div>",
    "  <div id='list'></div>",
    "  <div class='empty' id='empty'>Aucun graphe pour l'instant.<br>Lancez un script avec <code>plt.show()</code> dans un nouveau terminal.</div>",
    "<script nonce='" + nonce + "'>",
    "  const vscodeApi = acquireVsCodeApi();",
    "  const list = document.getElementById('list');",
    "  const empty = document.getElementById('empty');",
    "  const count = document.getElementById('count');",
    "  let n = 0;",
    "",
    "  function refreshCount(){",
    "    count.textContent = n + (n > 1 ? ' graphes' : ' graphe');",
    "    empty.style.display = (n === 0) ? 'block' : 'none';",
    "  }",
    "",
    "  function makeCard(fig){",
    "    const card = document.createElement('div');",
    "    card.className = 'card';",
    "    card.id = 'fig-' + fig.id;",
    "    const head = document.createElement('div');",
    "    head.className = 'card-head';",
    "    const title = document.createElement('span');",
    "    title.className = 'title';",
    "    title.textContent = fig.title;",
    "    const ts = document.createElement('span');",
    "    ts.className = 'ts';",
    "    ts.textContent = fig.ts;",
    "    const spacer = document.createElement('span');",
    "    spacer.className = 'spacer';",
    "    const btnSave = document.createElement('button');",
    "    btnSave.textContent = 'Enregistrer';",
    "    btnSave.addEventListener('click', function(){ vscodeApi.postMessage({ type:'save', id: fig.id }); });",
    "    const btnDel = document.createElement('button');",
    "    btnDel.textContent = 'Supprimer';",
    "    btnDel.addEventListener('click', function(){ vscodeApi.postMessage({ type:'delete', id: fig.id }); });",
    "    head.appendChild(title); head.appendChild(ts); head.appendChild(spacer);",
    "    head.appendChild(btnSave); head.appendChild(btnDel);",
    "    const wrap = document.createElement('div');",
    "    wrap.className = 'imgwrap';",
    "    if (fig.plotly){",
    "      const plotDiv = document.createElement('div');",
    "      plotDiv.id = 'plot-' + fig.id;",
    "      wrap.appendChild(plotDiv);",
    "    } else {",
    "      const img = document.createElement('img');",
    "      if (fig.svg){",
    "        img.src = 'data:image/svg+xml;base64,' + fig.svg;",
    "        img.classList.add('vector');",
    "      } else {",
    "        img.src = 'data:image/png;base64,' + fig.png;",
    "      }",
    "      img.alt = fig.title;",
    "      wrap.appendChild(img);",
    "    }",
    "    card.appendChild(head); card.appendChild(wrap);",
    "    return card;",
    "  }",
    "",
    "  function renderPlotly(fig){",
    "    if (!fig.plotly){ return; }",
    "    const el = document.getElementById('plot-' + fig.id);",
    "    if (!el || typeof Plotly === 'undefined'){ return; }",
    "    Plotly.newPlot(el, fig.plotly.data, fig.plotly.layout, {",
    "      responsive: true,",
    "      displaylogo: false,",
    "      scrollZoom: false,", // <-- Désactivation du zoom à la molette ici
    "      modeBarButtonsToRemove: ['select2d', 'lasso2d'],",
    "      toImageButtonOptions: { format: 'png', scale: 2, filename: fig.title }",
    "    });",
    "  }",
    "",
    "  window.addEventListener('message', function(event){",
    "    const msg = event.data;",
    "    if (msg.type === 'add'){",
    "      list.appendChild(makeCard(msg.fig));",
    "      renderPlotly(msg.fig);",
    "      n = n + 1; refreshCount();",
    "      window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });",
    "    } else if (msg.type === 'remove'){",
    "      const el = document.getElementById('fig-' + msg.id);",
    "      if (el){ el.remove(); n = n - 1; refreshCount(); }",
    "    } else if (msg.type === 'reset'){",
    "      list.innerHTML = '';",
    "      n = 0;",
    "      for (let i = 0; i < msg.figs.length; i = i + 1){",
    "        list.appendChild(makeCard(msg.figs[i]));",
    "        renderPlotly(msg.figs[i]);",
    "        n = n + 1;",
    "      }",
    "      refreshCount();",
    "    }",
    "  });",
    "",
    "  document.getElementById('saveAll').addEventListener('click', function(){ vscodeApi.postMessage({ type:'saveAll' }); });",
    "  document.getElementById('deleteAll').addEventListener('click', function(){ vscodeApi.postMessage({ type:'deleteAll' }); });",
    "  document.getElementById('fitToggle').addEventListener('change', function(e){",
    "    document.body.classList.toggle('no-fit', !e.target.checked);",
    "  });",
    "  refreshCount();",
    "  vscodeApi.postMessage({ type: 'ready' });", // <-- Signal de réveil ajouté ici
    "</script>",
    "</body>",
    "</html>"
  ].join("\n");
}

module.exports = { activate: activate, deactivate: deactivate };
