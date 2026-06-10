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

let panel = null;          // WebviewPanel unique
let figures = [];          // [{id, png(base64), title, ts}]
let nextId = 1;
let server = null;
let extContext = null;
let activePort = null;

// ------------------------------------------------------------
// Activation
// ------------------------------------------------------------
function activate(context) {
  extContext = context;
  const cfg = vscode.workspace.getConfiguration("spyderPlots");
  startServer(cfg.get("port", 53210), 0);

  // --- Le secret pour survivre au détachement de la fenêtre ---
  vscode.window.registerWebviewPanelSerializer("spyderPlots", {
    async deserializeWebviewPanel(webviewPanel, state) {
      // VS Code nous confie le nouveau panneau recréé dans la fenêtre flottante
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
          if (typeof data.png !== "string" || data.png.length === 0) {
            throw new Error("png manquant");
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
function injectEnvironment(port) {
  const cfg = vscode.workspace.getConfiguration("spyderPlots");
  const pyDir = path.join(extContext.extensionPath, "python");
  const env = extContext.environmentVariableCollection;
  env.clear();
  env.replace("MPLBACKEND", "module://vscode_spyder_plots_backend");
  env.replace("VSCODE_PLOTS_PORT", String(port));
  env.replace("VSCODE_PLOTS_DPI", String(cfg.get("dpi", 144)));
  env.prepend("PYTHONPATH", pyDir + path.delimiter);
}

// ------------------------------------------------------------
// Gestion des figures
// ------------------------------------------------------------
function addFigure(data) {
  const fig = {
    id: nextId,
    png: data.png,
    title: data.title ? String(data.title) : "Figure " + String(nextId),
    ts: new Date().toLocaleTimeString()
  };
  nextId = nextId + 1;
  figures.push(fig);

  const cfg = vscode.workspace.getConfiguration("spyderPlots");
  ensurePanel(cfg.get("autoReveal", true));
  postToWebview({ type: "add", fig: fig });
}

function deleteOne(id) {
  figures = figures.filter(function (f) { return f.id !== id; });
  postToWebview({ type: "remove", id: id });
}

function deleteAll() {
  figures = [];
  postToWebview({ type: "reset", figs: [] });
}

// ------------------------------------------------------------
// Enregistrement
// ------------------------------------------------------------
function defaultName(fig) {
  const clean = fig.title.replace(/[^a-zA-Z0-9_\-]+/g, "_").slice(0, 40);
  return clean.length > 0 ? clean + ".png" : "figure_" + String(fig.id) + ".png";
}

function saveOne(id) {
  const fig = figures.find(function (f) { return f.id === id; });
  if (!fig) { return; }
  vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.file(path.join(workspaceDir(), defaultName(fig))),
    filters: { "Image PNG": ["png"] }
  }).then(function (uri) {
    if (!uri) { return; }
    fs.writeFile(uri.fsPath, Buffer.from(fig.png, "base64"), function (err) {
      if (err) {
        vscode.window.showErrorMessage("Spyder Plots : échec de l'enregistrement (" + String(err) + ")");
      } else {
        vscode.window.showInformationMessage("Figure enregistrée : " + uri.fsPath);
      }
    });
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
    let count = 0;
    for (let i = 0; i < figures.length; i = i + 1) {
      const fig = figures[i];
      const name = String(i + 1).padStart(2, "0") + "_" + defaultName(fig);
      try {
        fs.writeFileSync(path.join(dir, name), Buffer.from(fig.png, "base64"));
        count = count + 1;
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
  p.webview.options = { enableScripts: true, retainContextWhenHidden: true };
  p.webview.html = webviewHtml();

  p.webview.onDidReceiveMessage(function (msg) {
    if (msg.type === "save") { saveOne(msg.id); }
    else if (msg.type === "saveAll") { saveAll(); }
    else if (msg.type === "delete") { deleteOne(msg.id); }
    else if (msg.type === "deleteAll") { deleteAll(); }
    else if (msg.type === "ready") { postToWebview({ type: "reset", figs: figures }); }
  });

  p.onDidDispose(function () {
    // Ne nullifier que si c'est bien le panneau actif (évite les conflits au détachement)
    if (panel === p) { panel = null; }
  });
}

function ensurePanel(reveal) {
  if (panel) {
    if (reveal) {
      // 'undefined' ordonne à VS Code de laisser la fenêtre là où elle est (ex: détachée)
      panel.reveal(undefined, true);
    }
    return;
  }
  
  panel = vscode.window.createWebviewPanel(
    "spyderPlots",
    "Graphes",
    { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
    { enableScripts: true, retainContextWhenHidden: true }
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
function webviewHtml() {
  const nonce = String(Date.now()) + String(Math.floor(Math.random() * 100000));
  return [
    "<!DOCTYPE html>",
    "<html lang='fr'>",
    "<head>",
    "<meta charset='UTF-8'>",
    "<meta http-equiv='Content-Security-Policy' content=\"default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'nonce-" + nonce + "';\">",
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
    "  body.no-fit .imgwrap img{ max-width:none; }",
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
    "    const img = document.createElement('img');",
    "    img.src = 'data:image/png;base64,' + fig.png;",
    "    img.alt = fig.title;",
    "    wrap.appendChild(img);",
    "    card.appendChild(head); card.appendChild(wrap);",
    "    return card;",
    "  }",
    "",
    "  window.addEventListener('message', function(event){",
    "    const msg = event.data;",
    "    if (msg.type === 'add'){",
    "      list.appendChild(makeCard(msg.fig));",
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
    "  vscodeApi.postMessage({ type: 'ready' });",
    "</script>",
    "</body>",
    "</html>"
  ].join("\n");
}

module.exports = { activate: activate, deactivate: deactivate };