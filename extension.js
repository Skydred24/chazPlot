// ============================================================================
// Chaz Plots — hote de l'extension VS Code (cote Node).
//
// Role : recevoir les figures matplotlib envoyees par le backend Python
// (python/vscode_spyder_plots_backend.py) et les afficher dans un panneau
// webview scrollable, facon volet « Graphes » de Spyder. L'UI elle-meme vit
// dans media/panel.html ; ce fichier n'est que la plomberie autour.
//
// Vue d'ensemble :
//   1. activate() demarre un serveur HTTP local (startServer) sur 127.0.0.1 et
//      injecte des variables d'env dans les NOUVEAUX terminaux (injectEnvironment)
//      pour que le backend Python sache ou POSTer ses figures.
//   2. Le backend POST /figure -> addFigure() cree une `fig`, la persiste
//      (storage.js) et l'envoie au webview.
//   3. Le panneau (ensurePanel/setupPanel) rend media/panel.html et dialogue
//      avec lui par postMessage (routeur dans setupPanel.onDidReceiveMessage).
//
// Contrat /figure (corps JSON) : au moins un de plotly | svg | png | frames.
// Detail du format et du protocole dans CLAUDE.md.
//
// Pieges (lire avant de modifier) :
//   - L'injection d'env ne touche QUE les terminaux ouverts APRES activation
//     (gotcha n°1 du support : « ouvrez un terminal neuf »).
//   - Le port peut glisser (+1 si occupe, jusqu'a +20) ; on ecrit aussi le port
//     dans un fichier tmp (writePortFile) comme repli pour le backend.
//   - retainContextWhenHidden + WebviewPanelSerializer : le panneau survit au
//     masquage / detachement sur un autre ecran.
// ============================================================================
"use strict";

const vscode = require("vscode");
const http = require("http");
const path = require("path");
const fs = require("fs");
const storage = require("./storage");
const LegendEdit = require("./media/legend_edit.js");

// --- Etat global du module ---
let panel = null;          // l'unique WebviewPanel (null si ferme)
let figures = [];          // figures en memoire : { id, title, ts, tags[], et UNE
                           // representation : plotly | svg | png | frames }
let nextId = 1;            // prochain id (continue apres un rechargement)
let server = null;         // serveur HTTP local
let extContext = null;     // ExtensionContext (chemins, storage, env)
let activePort = null;     // port effectivement ecoute
let nextExportRequestId = 1; // correle un export Plotly async a sa reponse
const pendingExports = {};   // requestId -> { filePath, title, nativePdf } en attente

// ------------------------------------------------------------
// Activation
// ------------------------------------------------------------
// Point d'entree VS Code : restaure les figures persistees, lance le serveur
// HTTP, enregistre le serialiseur de panneau et les commandes. Appele une fois.
function activate(context) {
  extContext = context;
  storage.init(context);
  // nextId est connu immediatement (index synchrone) ; les figures sont
  // chargees en asynchrone pour ne pas bloquer le demarrage.
  nextId = storage.nextId();
  storage.loadAll().then(function (loaded) {
    // fusionne les figures persistees AVANT celles eventuellement recues
    // pendant le chargement (qui ont des id >= nextId, donc pas de collision).
    figures = loaded.concat(figures);
    figures.forEach(function (f) { if (f.id >= nextId) { nextId = f.id + 1; } });
    postToWebview({ type: "reset", figs: figures });
  });
  const cfg = vscode.workspace.getConfiguration("chazPlots");
  startServer(cfg.get("port", 53210), 0);

  // --- Sérialiseur pour survivre au détachement de la fenêtre ---
  vscode.window.registerWebviewPanelSerializer("chazPlots", {
    async deserializeWebviewPanel(webviewPanel, state) {
      panel = webviewPanel;
      setupPanel(panel);
    }
  });

  context.subscriptions.push(
    vscode.commands.registerCommand("chazPlots.open", () => ensurePanel(true)),
    vscode.commands.registerCommand("chazPlots.deleteAll", deleteAll),
    vscode.commands.registerCommand("chazPlots.saveAll", saveAll)
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
// POST /figure -> addFigure ; GET /ping -> sonde de vie. Si le port est occupe
// (EADDRINUSE), reessaie sur port+1 jusqu'a +20 (attempt). A l'ecoute, publie
// le port (env des nouveaux terminaux + fichier tmp).
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
      res.end("chaz-plots");
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  server.on("error", function (err) {
    if (err && err.code === "EADDRINUSE" && attempt < 20) {
      startServer(port + 1, attempt + 1);
    } else {
      vscode.window.showErrorMessage("Chaz Plots : impossible d'ouvrir un port local (" + String(err) + ")");
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
  return path.join(require("os").tmpdir(), "chaz-plots-port.json");
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
  const cfg = vscode.workspace.getConfiguration("chazPlots");
  const pyDir = path.join(extContext.extensionPath, "python");
  const env = extContext.environmentVariableCollection;
  env.clear();
  env.replace("MPLBACKEND", "module://vscode_spyder_plots_backend");
  env.replace("VSCODE_PLOTS_PORT", String(port));
  env.replace("VSCODE_PLOTS_DPI", String(cfg.get("dpi", 200)));
  env.replace("VSCODE_PLOTS_ANIM_DPI", String(cfg.get("animationDpi", 130)));
  env.replace("VSCODE_PLOTS_ANIM_MAX_FRAMES", String(cfg.get("animationMaxFrames", 600)));
  env.replace("VSCODE_PLOTS_PDF", cfg.get("includePdf", true) ? "1" : "0");
  env.prepend("PYTHONPATH", pyDir + path.delimiter);
}

// ------------------------------------------------------------
// Gestion des figures
// ------------------------------------------------------------
// Construit une `fig` normalisee depuis le payload /figure (chaque format
// optionnel -> null si absent), lui attribue un id, la persiste, ouvre le
// panneau si besoin et l'envoie au webview.
function addFigure(data) {
  const hasFrames = Array.isArray(data.frames) && data.frames.length > 0;
  const fig = {
    id: nextId,
    plotly: data.plotly && typeof data.plotly === "object" ? data.plotly : null,
    pgf: typeof data.pgf === "string" && data.pgf.length > 0 ? data.pgf : null,
    svg: typeof data.svg === "string" && data.svg.length > 0 ? data.svg : null,
    png: typeof data.png === "string" && data.png.length > 0 ? data.png : null,
    pdf: typeof data.pdf === "string" && data.pdf.length > 0 ? data.pdf : null,
    frames: hasFrames ? data.frames : null,
    interval: hasFrames ? Number(data.interval) || 100 : null,
    render: data.render && typeof data.render === "object" ? data.render : null,
    provenance: data.provenance && typeof data.provenance === "object" ? data.provenance : null,
    title: data.title ? String(data.title) : "Figure " + String(nextId),
    tags: Array.isArray(data.tags) ? data.tags.map(String) : [],
    ts: new Date().toLocaleTimeString()
  };
  nextId = nextId + 1;
  figures.push(fig);
  storage.save(fig);

  const cfg = vscode.workspace.getConfiguration("chazPlots");
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

// Edition d'une trace depuis la legende (vue liste) : applique le patch a cles
// pointees a la figure en memoire et re-ecrit la figure persistee (best-effort).
function updateFigureTrace(id, traceIndex, patch) {
  const fig = figures.find(function (f) { return f.id === id; });
  if (!fig || !fig.plotly || !Array.isArray(fig.plotly.data)) { return; }
  const idx = Number(traceIndex);
  const trace = fig.plotly.data[idx];
  if (!trace || !patch || typeof patch !== "object") { return; }
  LegendEdit.applyPatch(trace, patch);
  // Le PDF vectoriel natif (rendu par le backend a la creation) ne reflete pas
  // cette edition : on marque la figure pour basculer l'export PDF en raster.
  fig.edited = true;
  try { storage.save(fig); } catch (e) { /* best-effort */ }
}

// Persiste une edition de layout (titre du graphe, labels d'axes) faite au
// clic dans le webview (Plotly editable). patch = cles pointees, ex.
// { "title.text": "...", "xaxis.title.text": "..." }.
function updateFigureLayout(id, patch) {
  const fig = figures.find(function (f) { return f.id === id; });
  if (!fig || !fig.plotly || !patch || typeof patch !== "object") { return; }
  if (!fig.plotly.layout) { fig.plotly.layout = {}; }
  LegendEdit.applyPatch(fig.plotly.layout, patch);
  fig.edited = true;   // PDF natif perime -> export raster (comme l'edition de legende)
  try { storage.save(fig); } catch (e) { /* best-effort */ }
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

// Ecrit une figure NON-Plotly sur disque (PNG/SVG/frame d'animation). Le format
// vient de l'extension du chemin ; si le format demande manque, repli sur ce
// qui est disponible en corrigeant l'extension. Renvoie true si un fichier a
// ete ecrit. (Les figures Plotly passent par saveOne -> export async cote webview.)
function writeFigure(fig, filePath, frameIndex) {
  // le format est deduit de l'extension du chemin choisi
  const wantSvg = filePath.toLowerCase().endsWith(".svg");
  const wantPdf = filePath.toLowerCase().endsWith(".pdf");
  // Animation : on enregistre la frame demandee (ou la premiere) en PNG.
  if (fig.frames) {
    let idx = typeof frameIndex === "number" ? frameIndex : 0;
    if (idx < 0 || idx >= fig.frames.length) { idx = 0; }
    const outPath = (wantSvg || wantPdf) ? filePath.replace(/\.(svg|pdf)$/i, ".png") : filePath;
    fs.writeFileSync(outPath, Buffer.from(fig.frames[idx], "base64"));
    return true;
  }
  if (wantPdf && fig.pdf !== null) {
    fs.writeFileSync(filePath, Buffer.from(fig.pdf, "base64"));
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
  const choices = [
    { label: "PNG", description: "raster, qualite controlee par le DPI", value: "png" },
    { label: "SVG", description: "vectoriel, recommande pour Word/Pandoc", value: "svg" }
  ];
  // PDF disponible : rendu matplotlib natif (fidele, vectoriel) deja recu.
  if (fig && fig.pdf) {
    choices.push({
      label: "PDF",
      description: fig.id === "compare"
        ? "raster haute resolution (comparaison)"
        : "vectoriel matplotlib, ideal publication/LaTeX",
      value: "pdf"
    });
  }
  const formatPick = await vscode.window.showQuickPick(choices, { placeHolder: "Format d'export" });
  if (!formatPick) { return null; }
  // Le PDF est ecrit directement depuis fig.pdf (pas d'export via le webview).
  if (formatPick.value === "pdf") { return { format: "pdf" }; }

  let dpi = null;
  let scale = 1;
  if (formatPick.value === "png") {
    const cfg = vscode.workspace.getConfiguration("chazPlots");
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

// Enregistre UNE figure. Deux chemins :
//   - figure Plotly : seul le webview detient la figure vivante, donc on lui
//     demande l'image (postMessage exportPlotly + requestId) ; la reponse
//     revient dans finishPlotlyExport via le message exportResult.
//   - sinon (png/svg/animation) : ecriture synchrone par writeFigure.
async function saveOne(id, frameIndex) {
  const fig = (id === "compare")
    ? { id: "compare", title: "comparaison", plotly: true, frames: null, pdf: "__present__" }
    : figures.find(function (f) { return f.id === id; });
  if (!fig) { return; }

  if (fig.plotly && !fig.frames) {
    const options = await plotlyExportOptions(fig);
    if (!options) { return; }
    const isPdf = options.format === "pdf";
    const uri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(path.join(workspaceDir(), defaultName(fig, options.format))),
      filters: isPdf
        ? { "PDF": ["pdf"] }
        : (options.format === "svg"
            ? { "Image SVG (vectoriel)": ["svg"] }
            : { "Image PNG": ["png"] })
    });
    if (!uri) { return; }
    const requestId = String(nextExportRequestId++);
    // PDF vectoriel natif disponible seulement si rien n'a ete edite dans le
    // webview (sinon fig.pdf est perime). Le webview respecte ce signal.
    const allowNative = !!(isPdf && fig.pdf && fig.id !== "compare" && !fig.edited);
    pendingExports[requestId] = {
      filePath: uri.fsPath,
      title: fig.title,
      nativePdf: allowNative ? fig.pdf : null
    };
    options.allowNative = allowNative;
    postToWebview({ type: "exportPlotly", id: fig.id, requestId: requestId, options: options });
    return;
  }

  const cfg = vscode.workspace.getConfiguration("chazPlots");
  const ext = fig.frames ? "png" : cfg.get("saveFormat", "png");
  const filters = { "Image PNG": ["png"], "Image SVG (vectoriel)": ["svg"] };
  if (!fig.frames && fig.pdf) { filters["PDF (vectoriel)"] = ["pdf"]; }
  vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.file(path.join(workspaceDir(), defaultName(fig, ext))),
    filters: filters
  }).then(function (uri) {
    if (!uri) { return; }
    try {
      writeFigure(fig, uri.fsPath, frameIndex);
      vscode.window.showInformationMessage("Figure enregistree : " + uri.fsPath);
    } catch (err) {
      vscode.window.showErrorMessage("Chaz Plots : echec de l'enregistrement (" + String(err) + ")");
    }
  });
}

// Reponse async d'un export Plotly : retrouve la requete par requestId et ecrit
// la data URL renvoyee par le webview au chemin choisi dans saveOne.
function finishPlotlyExport(msg) {
  const request = pendingExports[msg.requestId];
  if (!request) { return; }
  delete pendingExports[msg.requestId];
  if (!msg.ok) {
    vscode.window.showErrorMessage("Chaz Plots : echec de l'export Plotly (" + String(msg.error || "erreur inconnue") + ")");
    return;
  }
  try {
    if (msg.useNative) {
      // Figure sans encart : on ecrit le PDF matplotlib natif (vectoriel).
      if (!request.nativePdf) { throw new Error("PDF natif indisponible"); }
      fs.writeFileSync(request.filePath, Buffer.from(request.nativePdf, "base64"));
    } else {
      writeDataUrl(request.filePath, msg.dataUrl);
    }
    vscode.window.showInformationMessage("Figure exportee : " + request.filePath);
  } catch (err) {
    vscode.window.showErrorMessage("Chaz Plots : echec de l'ecriture de l'export (" + String(err) + ")");
  }
}
// Export CSV des donnees visibles d'une figure. Le webview detient la figure
// vivante (zoom, traces) ; il construit le CSV (cf. csv_export.js) et l'envoie
// via le message saveCsv. Ici on ne fait que choisir le fichier et l'ecrire.
// BOM UTF-8 ajoute pour qu'Excel detecte l'encodage.
function saveCsv(msg) {
  if (!msg || typeof msg.csv !== "string") { return; }
  const fig = figures.find(function (f) { return f.id === msg.id; });
  const base = fig ? defaultName(fig, "csv") : (msg.id === "compare" ? "comparaison.csv" : "donnees.csv");
  vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.file(path.join(workspaceDir(), base)),
    filters: { "CSV": ["csv"] }
  }).then(function (uri) {
    if (!uri) { return; }
    try {
      fs.writeFileSync(uri.fsPath, "﻿" + msg.csv, "utf8");
      vscode.window.showInformationMessage("Donnees exportees : " + uri.fsPath);
    } catch (err) {
      vscode.window.showErrorMessage("Chaz Plots : echec de l'export CSV (" + String(err) + ")");
    }
  });
}

// Export "bundle publication" : un dossier <base>/ contenant figure.png,
// figure.svg, metadata.json et figure.tex. Le webview assemble images +
// textes (cf. exportBundle) ; ici on choisit l'emplacement et on ecrit. Les
// noms de fichiers sont reduits a leur basename (anti-traversee de chemin).
function saveBundle(msg) {
  if (!msg || !Array.isArray(msg.files) || msg.files.length === 0) { return; }
  const base = String(msg.base || "figure").replace(/[^a-zA-Z0-9_\-]/g, "_") || "figure";
  vscode.window.showOpenDialog({
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    openLabel: "Creer le bundle ici"
  }).then(function (uris) {
    if (!uris || uris.length === 0) { return; }
    const dir = path.join(uris[0].fsPath, base);
    try {
      fs.mkdirSync(dir, { recursive: true });
      msg.files.forEach(function (f) {
        if (!f || !f.name) { return; }
        const target = path.join(dir, path.basename(String(f.name)));
        if (f.kind === "text") {
          fs.writeFileSync(target, String(f.text || ""), "utf8");
        } else if (typeof f.dataUrl === "string") {
          writeDataUrl(target, f.dataUrl);
        }
      });
      vscode.window.showInformationMessage("Bundle publication cree : " + dir);
    } catch (err) {
      vscode.window.showErrorMessage("Chaz Plots : echec du bundle (" + String(err) + ")");
    }
  });
}

// Export LaTeX PGF/TikZ. NB : le backend ne genere plus de PGF (fig.pgf est
// toujours null aujourd'hui), donc ces chemins sont inactifs et le webview
// n'affiche pas le bouton. Conserves au cas ou le PGF reviendrait.
function pgfText(fig) {
  if (!fig || fig.pgf === null) { return null; }
  return Buffer.from(fig.pgf, "base64").toString("utf8");
}

function copyPgf(id) {
  const fig = figures.find(function (f) { return f.id === id; });
  const text = pgfText(fig);
  if (text === null) {
    vscode.window.showWarningMessage("Chaz Plots : aucun code PGF/TikZ disponible pour cette figure.");
    return;
  }
  vscode.env.clipboard.writeText(text).then(function () {
    vscode.window.showInformationMessage("Code PGF/TikZ copie dans le presse-papiers.");
  }, function (err) {
    vscode.window.showErrorMessage("Chaz Plots : impossible de copier le PGF/TikZ (" + String(err) + ")");
  });
}

function savePgf(id) {
  const fig = figures.find(function (f) { return f.id === id; });
  const text = pgfText(fig);
  if (text === null) {
    vscode.window.showWarningMessage("Chaz Plots : aucun code PGF/TikZ disponible pour cette figure.");
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
      vscode.window.showErrorMessage("Chaz Plots : echec de l'enregistrement PGF/TikZ (" + String(err) + ")");
    }
  });
}

function saveAll() {
  if (figures.length === 0) {
    vscode.window.showInformationMessage("Chaz Plots : aucune figure à enregistrer.");
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
    const cfg = vscode.workspace.getConfiguration("chazPlots");
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
    vscode.window.showInformationMessage("Chaz Plots : " + String(count) + " figure(s) enregistrée(s) dans " + dir);
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
// Configure un WebviewPanel : options + HTML, et branche le routeur des
// messages venant du webview (protocole webview -> extension : save, copyPgf,
// savePgf, exportResult, updateTags, editTags, saveAll, delete, deleteAll,
// copied, copyFailed, ready). Le sens inverse passe par postToWebview.
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
    else if (msg.type === "saveCsv") { saveCsv(msg); }
    else if (msg.type === "saveBundle") { saveBundle(msg); }
    else if (msg.type === "notify") {
      const text = String(msg.text || "");
      if (msg.level === "warn") { vscode.window.showWarningMessage(text); }
      else if (msg.level === "error") { vscode.window.showErrorMessage(text); }
      else { vscode.window.showInformationMessage(text); }
    }
    else if (msg.type === "updateTags") { updateTags(msg.id, msg.tags); }
    else if (msg.type === "updateFigure") { updateFigureTrace(msg.id, msg.traceIndex, msg.patch); }
    else if (msg.type === "updateFigureLayout") { updateFigureLayout(msg.id, msg.patch); }
    else if (msg.type === "editTags") { editTags(msg.id); }
    else if (msg.type === "saveAll") { saveAll(); }
    else if (msg.type === "delete") { deleteOne(msg.id); }
    else if (msg.type === "deleteAll") { deleteAll(); }
    else if (msg.type === "copied") {
      vscode.window.showInformationMessage("Figure copiée dans le presse-papiers.");
    }
    else if (msg.type === "copyFailed") {
      vscode.window.showWarningMessage(
        "Chaz Plots : copie impossible (" + String(msg.error || "") + "). Utilisez « Enregistrer »."
      );
    }
    else if (msg.type === "ready") { postToWebview({ type: "reset", figs: figures }); }
  });

  p.onDidDispose(function () {
    // Évite le conflit de destruction lors du détachement
    if (panel === p) { panel = null; }
  });
}

// Garantit qu'un panneau existe : revele l'existant (sans le rapatrier s'il est
// detache, d'ou viewColumn undefined) ou en cree un neuf a cote de l'editeur.
function ensurePanel(reveal) {
  if (panel) {
    if (reveal) {
      // 'undefined' permet au panneau de rester détaché sur un autre écran
      panel.reveal(undefined, true);
    }
    return;
  }
  panel = vscode.window.createWebviewPanel(
    "chazPlots",
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
// Lit media/panel.html et substitue les placeholders {{...}} : nonce CSP,
// cspSource, et les URIs webview des scripts bundles (plotly, error_math,
// inset_layout, plot_nav). Tout nouveau script bundle = nouveau placeholder ici
// + dans panel.html + dans test/check_panel_html.js. Repli : page d'erreur si
// panel.html est introuvable (extension mal installee).
function webviewHtml(webview) {
  const nonce = String(Date.now()) + String(Math.floor(Math.random() * 100000));
  const plotlyUri = webview.asWebviewUri(
    vscode.Uri.file(path.join(extContext.extensionPath, "media", "plotly.min.js"))
  );
  const errorMathUri = webview.asWebviewUri(
    vscode.Uri.file(path.join(extContext.extensionPath, "media", "error_math.js"))
  );
  const insetLayoutUri = webview.asWebviewUri(
    vscode.Uri.file(path.join(extContext.extensionPath, "media", "inset_layout.js"))
  );
  const plotNavUri = webview.asWebviewUri(
    vscode.Uri.file(path.join(extContext.extensionPath, "media", "plot_nav.js"))
  );
  const measureMathUri = webview.asWebviewUri(
    vscode.Uri.file(path.join(extContext.extensionPath, "media", "measure_math.js"))
  );
  const csvExportUri = webview.asWebviewUri(
    vscode.Uri.file(path.join(extContext.extensionPath, "media", "csv_export.js"))
  );
  const compareUtilUri = webview.asWebviewUri(
    vscode.Uri.file(path.join(extContext.extensionPath, "media", "compare_util.js"))
  );
  const bundleMetaUri = webview.asWebviewUri(
    vscode.Uri.file(path.join(extContext.extensionPath, "media", "bundle_meta.js"))
  );
  const figureFilterUri = webview.asWebviewUri(
    vscode.Uri.file(path.join(extContext.extensionPath, "media", "figure_filter.js"))
  );
  const pdfExportUri = webview.asWebviewUri(
    vscode.Uri.file(path.join(extContext.extensionPath, "media", "pdf_export.js"))
  );
  const legendEditUri = webview.asWebviewUri(
    vscode.Uri.file(path.join(extContext.extensionPath, "media", "legend_edit.js"))
  );
  const autoscaleUri = webview.asWebviewUri(
    vscode.Uri.file(path.join(extContext.extensionPath, "media", "autoscale.js"))
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
      .replace(/{{plotlyUri}}/g, String(plotlyUri))
      .replace(/{{errorMathUri}}/g, String(errorMathUri))
      .replace(/{{insetLayoutUri}}/g, String(insetLayoutUri))
      .replace(/{{plotNavUri}}/g, String(plotNavUri))
      .replace(/{{measureMathUri}}/g, String(measureMathUri))
      .replace(/{{csvExportUri}}/g, String(csvExportUri))
      .replace(/{{compareUtilUri}}/g, String(compareUtilUri))
      .replace(/{{bundleMetaUri}}/g, String(bundleMetaUri))
      .replace(/{{figureFilterUri}}/g, String(figureFilterUri))
      .replace(/{{pdfExportUri}}/g, String(pdfExportUri))
      .replace(/{{legendEditUri}}/g, String(legendEditUri))
      .replace(/{{autoscaleUri}}/g, String(autoscaleUri));
  }
  // media/panel.html introuvable : l'extension est mal installee.
  return [
    "<!DOCTYPE html><html lang='fr'><head><meta charset='UTF-8'></head>",
    "<body style='font-family:sans-serif;padding:24px'>",
    "<h3>Chaz Plots</h3>",
    "<p>Interface introuvable (media/panel.html manquant).",
    " Reinstallez l'extension.</p>",
    "</body></html>",
  ].join("");
}

module.exports = { activate: activate, deactivate: deactivate };
