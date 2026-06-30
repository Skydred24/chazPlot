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
const zlib = require("zlib");
const storage = require("./storage");
const LegendEdit = require("./media/legend_edit.js");
const FigureCodec = require("./media/figure_codec.js");
const PlotlyToPy = require("./media/plotly_to_py.js");

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
  try { storage.flushSaves(); } catch (e) { /* best-effort */ }
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

// ------------------------------------------------------------
// Presse-papier de figure (transfert entre fenetres VS Code).
// On passe par un fichier tmp partage (comme le fichier de port) plutot que par
// le presse-papier systeme : la figure est un JSON volumineux qui polluerait le
// presse-papier texte/image. Le bouton « Copier » d'une figure y ecrit son JSON ;
// le bouton « Coller » du panneau le relit dans la fenetre cible.
function clipboardFilePath() {
  return path.join(require("os").tmpdir(), "chaz-plots-clipboard.json");
}

function copyFigureData(id) {
  const fig = figures.find(function (f) { return f.id === id; });
  if (!fig) { return; }
  try {
    fs.writeFileSync(clipboardFilePath(), JSON.stringify(fig), "utf8");
  } catch (e) {
    // best-effort : la copie image (presse-papier) reste fonctionnelle
  }
}

function pasteFigure() {
  let data = null;
  try {
    data = JSON.parse(fs.readFileSync(clipboardFilePath(), "utf8"));
  } catch (e) {
    vscode.window.showWarningMessage(
      "Chaz Plots : aucune figure a coller. Cliquez d'abord « Copier » sur une figure."
    );
    return;
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) { return; }
  // addFigure attribue un nouvel id et ajoute la figure a la fenetre courante.
  addFigure(data);
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
  env.replace("VSCODE_PLOTS_PLOTLY_PNG", cfg.get("preRenderPlotlyPng", false) ? "1" : "0");
  env.replace("VSCODE_PLOTS_PLOTLY_PDF", cfg.get("preRenderPlotlyPdf", false) ? "1" : "0");
  // Encodeurs d'animation : GIF par defaut (cout negligeable), MP4 opt-in
  // (peut bloquer plt.show() plusieurs secondes => laisse l'utilisateur activer).
  env.replace("VSCODE_PLOTS_GIF", cfg.get("includeGif", true) ? "1" : "0");
  env.replace("VSCODE_PLOTS_MP4", cfg.get("includeMp4", false) ? "1" : "0");
  env.prepend("PYTHONPATH", pyDir + path.delimiter);
}

// ------------------------------------------------------------
// Gestion des figures
// ------------------------------------------------------------
// Live update (opt-in via chazPlots.replaceOnSameProvenance, defaut false) :
// si une figure deja connue a la meme cle de provenance (script + ligne du
// plt.show()) et le meme titre, on mute son contenu au lieu d'en empiler une
// nouvelle. Preserve id, tags, ts. Defaut OFF pour proteger le cas frequent
// des etudes parametriques en boucle for (un plt.show() par valeur).
const ReplacePolicy = require("./media/replace_policy.js");

// Construit une `fig` normalisee depuis le payload /figure (chaque format
// optionnel -> null si absent), lui attribue un id, la persiste, ouvre le
// panneau si besoin et l'envoie au webview.
function addFigure(data) {
  const hasFrames = Array.isArray(data.frames) && data.frames.length > 0;
  const incoming = {
    plotly: data.plotly && typeof data.plotly === "object" ? data.plotly : null,
    pgf: typeof data.pgf === "string" && data.pgf.length > 0 ? data.pgf : null,
    svg: typeof data.svg === "string" && data.svg.length > 0 ? data.svg : null,
    png: typeof data.png === "string" && data.png.length > 0 ? data.png : null,
    pdf: typeof data.pdf === "string" && data.pdf.length > 0 ? data.pdf : null,
    gif: typeof data.gif === "string" && data.gif.length > 0 ? data.gif : null,
    mp4: typeof data.mp4 === "string" && data.mp4.length > 0 ? data.mp4 : null,
    frames: hasFrames ? data.frames : null,
    interval: hasFrames ? Number(data.interval) || 100 : null,
    render: data.render && typeof data.render === "object" ? data.render : null,
    sciencePlot: data.sciencePlot === true,
    provenance: data.provenance && typeof data.provenance === "object" ? data.provenance : null,
    title: data.title ? String(data.title) : "Figure " + String(nextId),
  };
  const cfg = vscode.workspace.getConfiguration("chazPlots");
  // Dedup re-run identique (option (a) : signature contenu). Si la MEME figure
  // (meme script+ligne ET meme rendu) est re-emise, on rafraichit la carte au
  // lieu d'empiler -> pas de 40 doublons quand on relance un script inchange.
  // Des qu'un parametre change le rendu, la signature differe -> nouvelle carte
  // (on garde l'ancienne pour comparer). Defaut OFF : les reruns s'empilent.
  if (cfg.get("refreshIdenticalReruns", false)) {
    const dup = ReplacePolicy.findDedupTarget(figures, incoming);
    if (dup) {
      dup.ts = new Date().toLocaleTimeString();
      try { storage.save(dup); } catch (e) { /* best-effort */ }
      ensurePanel(cfg.get("autoReveal", true));
      postToWebview({ type: "update", fig: dup });
      return;
    }
  }
  // Opt-in : remplace en place la cible au lieu d'empiler.
  if (cfg.get("replaceOnSameProvenance", false)) {
    const target = ReplacePolicy.findReplaceTarget(figures, incoming);
    if (target) {
      // Conserve le titre existant (le titre sert de discriminateur) ; mute le contenu.
      ReplacePolicy.mergeReplace(target, incoming);
      try { storage.save(target); } catch (e) { /* best-effort */ }
      ensurePanel(cfg.get("autoReveal", true));
      postToWebview({ type: "update", fig: target });
      return;
    }
  }
  const fig = Object.assign({ id: nextId }, incoming,
    { tags: Array.isArray(data.tags) ? data.tags.map(String) : [],
      ts: new Date().toLocaleTimeString() });
  nextId = nextId + 1;
  figures.push(fig);

  if (cfg.get("persistFigures", true)) { storage.save(fig); }

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

function appendFigureTrace(id, trace) {
  const fig = figures.find(function (f) { return f.id === id; });
  if (!fig || !fig.plotly || !trace || typeof trace !== "object") { return; }
  if (!Array.isArray(fig.plotly.data)) { fig.plotly.data = []; }
  fig.plotly.data.push(trace);
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

// Remplace en bloc la spec Plotly d'une figure (data + layout). Utilise par
// l'annulation (Ctrl+Z) du webview : restaurer un etat anterieur d'un coup
// plutot qu'en patches incrementaux.
function replaceFigurePlotly(id, plotly) {
  const fig = figures.find(function (f) { return f.id === id; });
  if (!fig || !fig.plotly || !plotly || typeof plotly !== "object") { return; }
  if (Array.isArray(plotly.data)) { fig.plotly.data = plotly.data; }
  if (plotly.layout && typeof plotly.layout === "object") { fig.plotly.layout = plotly.layout; }
  // Registre des vignettes (encarts colles d'un autre graphe) : persiste pour
  // remonter les overlays draggables au rechargement.
  if (Array.isArray(plotly.vignettes)) { fig.plotly.vignettes = plotly.vignettes; }
  fig.edited = true;
  try { storage.save(fig); } catch (e) { /* best-effort */ }
}

// Ctrl/Cmd+clic sur la provenance d'une figure : ouvre le script Python a la
// ligne du site d'appel (provenance.source/line).
function openSource(filePath, line) {
  if (!filePath || typeof filePath !== "string") { return; }
  const uri = vscode.Uri.file(filePath);
  vscode.workspace.openTextDocument(uri).then(function (doc) {
    const opts = { preview: false };
    const ln = Number(line);
    if (isFinite(ln) && ln > 0) {
      const pos = new vscode.Position(ln - 1, 0);
      opts.selection = new vscode.Range(pos, pos);
    }
    return vscode.window.showTextDocument(doc, opts);
  }, function (err) {
    vscode.window.showWarningMessage(
      "Chaz Plots : impossible d'ouvrir " + filePath + " (" + String((err && err.message) || err) + ")."
    );
  });
}

// Enregistre un preset de style personnalise (cree depuis l'editeur Style
// publication) dans la config `chazPlots.customPlotStyles` (settings utilisateur)
// pour qu'il reapparaisse au prochain demarrage.
function saveCustomPreset(name, style) {
  if (!name || typeof name !== "string" || !style || typeof style !== "object") { return; }
  const cfg = vscode.workspace.getConfiguration("chazPlots");
  const current = cfg.get("customPlotStyles", {});
  const next = Object.assign({}, (current && typeof current === "object") ? current : {});
  next[name] = style;
  cfg.update("customPlotStyles", next, vscode.ConfigurationTarget.Global).then(function () {
    vscode.window.showInformationMessage("Chaz Plots : preset « " + name + " » enregistré.");
  }, function (err) {
    vscode.window.showErrorMessage(
      "Chaz Plots : échec d'enregistrement du preset (" + String((err && err.message) || err) + ")."
    );
  });
}

// Glisser un fichier de donnees depuis l'explorateur VS Code : le webview ne lit
// pas le disque, il envoie l'URI ; on lit le contenu et on le renvoie.
function readDataFile(requestId, uriString, target) {
  if (!requestId || !uriString) { return; }
  let fsPath;
  try { fsPath = vscode.Uri.parse(uriString).fsPath; }
  catch (e) { fsPath = String(uriString); }
  fs.stat(fsPath, function (statErr, stat) {
    if (!statErr && stat && stat.size >= 50 * 1024 * 1024) {
      postToWebview({ type: "dataFileContent", requestId: requestId,
        error: "fichier trop volumineux via glisser depuis VS Code ; utilisez le bouton Importer CSV/DAT pour l'import streaming" });
      return;
    }
    fs.readFile(fsPath, "utf8", function (err, text) {
      if (err) {
        postToWebview({ type: "dataFileContent", requestId: requestId, error: String((err && err.message) || err) });
        return;
      }
      postToWebview({ type: "dataFileContent", requestId: requestId, text: text, name: path.basename(fsPath), target: target });
    });
  });
}

// Cree une figure a partir de donnees importees (glisser sur une zone vide).
function createFigureFromData(title, plotly) {
  if (!plotly || typeof plotly !== "object") { return; }
  addFigure({ plotly: plotly, title: title ? String(title) : "Données importées" });
}

// Override du toggle "export science" (depuis le webview) : choisit si l'export
// d'une figure plotly puise dans les assets matplotlib propres ou dans le rendu
// Plotly. Persiste le choix (storage serialise l'objet entier).
function setExportSource(id, sciencePlot) {
  const fig = figures.find(function (f) { return f.id === id; });
  if (!fig) { return; }
  fig.sciencePlot = sciencePlot === true;
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
// Sauvegarde d'une animation en GIF ou MP4. Le binaire est deja encode
// dans fig.gif / fig.mp4 (produits par le backend a plt.show() si les
// reglages includeGif / includeMp4 sont actives ; depend de ffmpeg sur
// PATH pour MP4). Les frames PNG restent accessibles via le bouton Save
// classique (PNG par defaut).
function saveAnimation(id, format) {
  const fig = figures.find(function (f) { return f.id === id; });
  if (!fig) { return; }
  if (format !== "gif" && format !== "mp4") {
    vscode.window.showWarningMessage("Chaz Plots : format d'animation inconnu (" + String(format) + ").");
    return;
  }
  const b64 = format === "gif" ? fig.gif : fig.mp4;
  if (!b64) {
    const settingName = format === "gif"
      ? "chazPlots.includeGif"
      : "chazPlots.includeMp4 (et ffmpeg sur PATH)";
    vscode.window.showWarningMessage(
      "Chaz Plots : aucun " + format.toUpperCase()
      + " disponible pour cette animation. Activez " + settingName + "."
    );
    return;
  }
  const filters = format === "gif"
    ? { "Image GIF (anime)": ["gif"] }
    : { "Video MP4": ["mp4"] };
  vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.file(path.join(workspaceDir(), defaultName(fig, format))),
    filters: filters,
  }).then(function (uri) {
    if (!uri) { return; }
    try {
      fs.writeFileSync(uri.fsPath, Buffer.from(b64, "base64"));
      vscode.window.showInformationMessage("Animation enregistree : " + uri.fsPath);
    } catch (err) {
      vscode.window.showErrorMessage(
        "Chaz Plots : echec d'enregistrement " + format.toUpperCase() + " (" + String(err) + ")."
      );
    }
  });
}

// Variante de saveOne appelee par la modale d'apercu (panel.html) : les
// options sont deja choisies par l'utilisateur, on bypass les QuickPicks
// cote extension.
async function saveWith(id, frameIndex, options) {
  return await saveOne(id, frameIndex, options || {});
}


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

// ------------------------------------------------------------
// Figure "auto-portee" : on cache la spec Plotly (les points de la courbe) dans
// le PNG/SVG enregistre pour pouvoir recreer la figure en deposant l'image. Les
// donnees sont DEJA visibles dans l'image -> pas de fuite (contrairement au code
// source) ; cf. memoire "paused-self-documenting-images" pour la distinction.
// ------------------------------------------------------------
const EMBED_KEYWORD = "chazPlotsFigure";
let embedSizeWarned = false;

// Injecte les donnees de `fig` dans le fichier PNG/SVG deja ecrit (best-effort :
// n'echoue jamais la sauvegarde). Respecte le reglage + un plafond de taille.
function embedFigureInFile(filePath, fig) {
  try {
    const cfg = vscode.workspace.getConfiguration("chazPlots");
    if (!cfg.get("embedFigureData", true)) { return; }
    // Pas de plotly exploitable (animation, image brute, vue "compare" synthetique).
    if (!fig || fig.plotly === true || !fig.plotly || typeof fig.plotly !== "object" || fig.frames) { return; }
    const ext = path.extname(filePath).toLowerCase();
    if (ext !== ".png" && ext !== ".svg") { return; }
    const json = JSON.stringify({ tool: "chaz-plots", v: 1, kind: "figure", title: fig.title || "", plotly: fig.plotly });
    const deflated = zlib.deflateSync(Buffer.from(json, "utf8"));
    const capKB = Number(cfg.get("embedFigureDataMaxKB", 2048)) || 2048;
    if (deflated.length > capKB * 1024) {
      if (!embedSizeWarned) {
        embedSizeWarned = true;
        vscode.window.showWarningMessage(
          "Chaz Plots : donnees trop volumineuses pour etre integrees a l'image (> " + capKB +
          " Ko compresses) ; figure enregistree sans donnees embarquees (reglage chazPlots.embedFigureDataMaxKB)."
        );
      }
      return;
    }
    if (ext === ".png") {
      const out = FigureCodec.pngEmbed(fs.readFileSync(filePath), EMBED_KEYWORD, deflated);
      if (out) { fs.writeFileSync(filePath, Buffer.from(out)); }
    } else {
      const out = FigureCodec.svgEmbed(fs.readFileSync(filePath, "utf8"), deflated.toString("base64"));
      fs.writeFileSync(filePath, out);
    }
  } catch (e) { /* best-effort : ne jamais bloquer la sauvegarde */ }
}

// Lit les donnees embarquees d'une image (octets) -> objet payload ou null.
function extractEmbeddedFigure(buf, name) {
  try {
    const ext = path.extname(name || "").toLowerCase();
    let deflated = null;
    if (ext === ".svg" || !FigureCodec.isPng(buf)) {
      const b64 = FigureCodec.svgExtract(buf.toString("utf8"));
      if (b64) { deflated = Buffer.from(b64, "base64"); }
    } else {
      const raw = FigureCodec.pngExtract(buf, EMBED_KEYWORD);
      if (raw) { deflated = Buffer.from(raw); }
    }
    if (!deflated) { return null; }
    const obj = JSON.parse(zlib.inflateSync(deflated).toString("utf8"));
    if (obj && obj.tool === "chaz-plots" && obj.plotly && typeof obj.plotly === "object") { return obj; }
  } catch (e) { /* image sans donnees Chaz Plots valides */ }
  return null;
}

// Image deposee : si elle porte des donnees Chaz Plots, genere un script
// matplotlib qui reproduit la courbe (a partir des donnees embarquees, jamais du
// code source) et l'ouvre dans un nouvel editeur Python. Sinon, message discret.
// Prepare le code matplotlib reproduisant la figure embarquee SANS l'afficher :
// le document est cree en memoire et une notification discrete propose de
// l'ouvrir a la demande (rien ne s'affiche/recouvre tant qu'on ne clique pas).
function openCodeFromPayload(payload) {
  let code;
  try {
    code = PlotlyToPy.toMatplotlib({ title: payload.title || "", plotly: payload.plotly });
  } catch (e) {
    vscode.window.showErrorMessage("Chaz Plots : echec de la generation du code (" + String(e) + ")");
    return;
  }
  const header = "# Code reconstruit par Chaz Plots a partir de l'image"
    + (payload.title ? " « " + payload.title + " »" : "")
    + "\n# (donnees embarquees dans l'image ; reproduit la courbe).\n\n";
  vscode.workspace.openTextDocument({ language: "python", content: header + code })
    .then(function (doc) {
      vscode.window.showInformationMessage("Chaz Plots : code matplotlib genere.", "Ouvrir le code")
        .then(function (choice) { if (choice === "Ouvrir le code") { vscode.window.showTextDocument(doc); } });
    }, function (err) {
      vscode.window.showErrorMessage("Chaz Plots : echec de la generation du code (" + String(err) + ")");
    });
}

// Image deposee/choisie. requestId present (glisser ou bouton du webview) : on
// renvoie la spec au webview qui decide superposition (depot sur une figure) ou
// nouvelle figure (depot sur le vide), comme pour le CSV. Le CODE est ouvert en
// arriere-plan. Sans donnees Chaz Plots : digitalisation (si demandee) ou message.
function handleImportImage(buf, name, requestId, digitizeFallback) {
  const payload = extractEmbeddedFigure(buf, name);
  if (payload) {
    openCodeFromPayload(payload);
    if (requestId != null) {
      postToWebview({ type: "imageSpec", requestId: requestId, title: payload.title || "", plotly: payload.plotly });
    } else {
      createFigureFromData(payload.title, payload.plotly);   // pas de requestId : trace direct
    }
    return;
  }
  if (requestId != null && digitizeFallback) {
    postToWebview({ type: "imageNoEmbed", requestId: requestId, name: name });
  } else {
    vscode.window.showInformationMessage(
      "Chaz Plots : « " + (name || "cette image") + " » ne contient pas de donnees Chaz Plots."
    );
  }
}

async function plotlyExportOptions(fig) {
  const choices = [
    { label: "PNG", description: "raster, qualite controlee par le DPI", value: "png" },
    { label: "SVG", description: "vectoriel, recommande pour Word/Pandoc", value: "svg" }
  ];
  // PDF disponible : natif si deja recu, sinon rendu webview raster a la demande.
  choices.push({
    label: "PDF",
    description: fig && fig.pdf && fig.id !== "compare" && !fig.edited
      ? "vectoriel matplotlib, ideal publication/LaTeX"
      : "raster haute resolution genere a la demande",
    value: "pdf"
  });
  const formatPick = await vscode.window.showQuickPick(choices, { placeHolder: "Format d'export" });
  if (!formatPick) { return null; }
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

// Enregistre UNE figure. Trois chemins (selon le format disponible, le
// contexte compare/regular, et si la webview a deja les options via
// saveWith / la modale d'apercu) :
//   - figure Plotly non-editee + options deja connues : export async via
//     webview (postMessage exportPlotly + requestId ; reponse dans
//     finishPlotlyExport via le message exportResult).
//   - figure Plotly + pas d'options : extension montre le QuickPick
//     (plotlyExportOptions) pour demander DPI/fond/format.
//   - sinon (png/svg/pdf natif/animation) : ecriture synchrone par writeFigure.
// optionsOverride (optionnel) : {format, dpi, scale, transparent, allowNative}
// envoye par le webview (modale d'apercu). Court-circuite plotlyExportOptions.
// Pour une GIF/MP4 d'animation, passer par saveAnimation().
async function saveOne(id, frameIndex, optionsOverride) {
  const fig = (id === "compare")
    ? { id: "compare", title: "comparaison", plotly: true, frames: null, pdf: "__present__" }
    : figures.find(function (f) { return f.id === id; });
  if (!fig) { return; }

  // Figure science : l'export puise dans les assets matplotlib (png/svg/pdf deja
  // propres), pas dans le rendu Plotly. Sauf si la figure a ete editee dans le
  // webview (assets perimes) -> on repasse par l'export Plotly.
  const matplotlibExport = !!(fig.plotly && !fig.frames && fig.sciencePlot
    && !fig.edited && (fig.png || fig.svg || fig.pdf));

  if (fig.plotly && !fig.frames && !matplotlibExport) {
    // La webview a deja choisi format / DPI / fond via la modale d'apercu ?
    // Si oui on bypass les QuickPicks cote extension. Si l'objet est vide /
    // absent / sans format defini -> on demande.
    let options;
    if (optionsOverride && typeof optionsOverride === "object" && optionsOverride.format) {
      options = optionsOverride;
    } else {
      options = await plotlyExportOptions(fig);
      if (!options) { return; }
    }
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
      nativePdf: allowNative ? fig.pdf : null,
      figId: fig.id
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
      embedFigureInFile(uri.fsPath, fig);
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
  const batch = request.batch || null;   // export groupe (saveAll) : compte agrege
  if (!msg.ok) {
    // Annulation depuis la modale d'apercu PDF : nettoyage silencieux.
    if (msg.error === "__cancel__") { if (batch) { finishExportBatchTick(batch); } return; }
    if (!batch) {
      vscode.window.showErrorMessage("Chaz Plots : echec de l'export Plotly (" + String(msg.error || "erreur inconnue") + ")");
    }
    if (batch) { finishExportBatchTick(batch); }
    return;
  }
  try {
    if (msg.useNative) {
      // Figure sans encart : on ecrit le PDF matplotlib natif (vectoriel).
      if (!request.nativePdf) { throw new Error("PDF natif indisponible"); }
      fs.writeFileSync(request.filePath, Buffer.from(request.nativePdf, "base64"));
    } else {
      writeDataUrl(request.filePath, msg.dataUrl);
      // Figure auto-portee : injecte les donnees dans le PNG/SVG rendu par le webview.
      if (request.figId !== undefined && !request.report) {
        const f = figures.find(function (x) { return x.id === request.figId; });
        if (f) { embedFigureInFile(request.filePath, f); }
      }
    }
    if (batch) { batch.written = batch.written + 1; }
    else if (request.report) { vscode.window.showInformationMessage("Rapport PDF enregistré : " + request.filePath); }
    else { vscode.window.showInformationMessage("Figure exportee : " + request.filePath); }
  } catch (err) {
    if (!batch) {
      vscode.window.showErrorMessage("Chaz Plots : echec de l'ecriture de l'export (" + String(err) + ")");
    }
  }
  if (batch) { finishExportBatchTick(batch); }
}

// Decremente le lot d'export (saveAll) et affiche le bilan quand tout est revenu.
function finishExportBatchTick(batch) {
  batch.remaining = batch.remaining - 1;
  if (batch.remaining <= 0) {
    vscode.window.showInformationMessage(
      "Chaz Plots : " + String(batch.syncCount + batch.written) + " figure(s) enregistrée(s) dans " + batch.dir);
  }
}
// Export CSV des donnees visibles d'une figure. Le webview detient la figure
// vivante (zoom, traces) ; il construit le CSV (cf. csv_export.js) et l'envoie
// via le message saveCsv. Ici on ne fait que choisir le fichier et l'ecrire.
// BOM UTF-8 ajoute pour qu'Excel detecte l'encodage.
function saveCsv(msg) {
  if (!msg || typeof msg.csv !== "string") { return; }
  const fig = figures.find(function (f) { return f.id === msg.id; });
  let base;
  if (fig) base = defaultName(fig, "csv");
  else if (msg.base) base = String(msg.base).replace(/[^a-zA-Z0-9_\-]/g, "_") + ".csv";
  else base = msg.id === "compare" ? "comparaison.csv" : "donnees.csv";
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

// ids : sous-ensemble selectionne cote webview (cases de comparaison). Vide/absent
// = toutes les figures. PNG/SVG (dossier) ET PDF (rapport) respectent la selection.
function saveAll(ids) {
  const selected = Array.isArray(ids) && ids.length
    ? figures.filter(function (f) { return ids.indexOf(f.id) !== -1; })
    : figures;
  if (selected.length === 0) {
    vscode.window.showInformationMessage("Chaz Plots : aucune figure à enregistrer.");
    return;
  }
  const scope = (selected.length === figures.length) ? "toutes les figures" : (selected.length + " figure(s) selectionnee(s)");
  // Choix du format : PDF -> un seul rapport multipage (une figure par page) ;
  // PNG/SVG -> un fichier par figure dans un dossier (comportement historique).
  const choices = [
    { label: "PDF — un seul rapport multipage", description: "Une figure par page (titre + provenance)", ext: "pdf" },
    { label: "PNG — un fichier par figure", description: "Dans un dossier", ext: "png" },
    { label: "SVG — un fichier par figure", description: "Dans un dossier", ext: "svg" }
  ];
  vscode.window.showQuickPick(choices, { placeHolder: "Format d'export (" + scope + ")" }).then(function (pick) {
    if (!pick) { return; }
    // Le PDF est compose cote webview qui relit lui-meme la selection ; png/svg
    // (boucle d'ecriture cote extension) recoit explicitement le sous-ensemble.
    if (pick.ext === "pdf") { exportReportPdf(); }
    else { saveAllToFolder(pick.ext, selected); }
  });
}

// Rapport PDF multipage : choisit un fichier de destination puis demande au
// webview de composer le PDF (il detient les figures Plotly vivantes + provenance).
// La selection (cases de comparaison) sinon toutes les figures est decidee cote
// webview ; ici on ne fait que router le resultat vers finishPlotlyExport.
function exportReportPdf() {
  vscode.window.showQuickPick([
    { label: "Avec provenance", description: "Source, script, git et date en bas de chaque page", value: true },
    { label: "Sans provenance", description: "Titre et figure seulement", value: false }
  ], { placeHolder: "Inclure la provenance dans le rapport ?" }).then(function (provPick) {
    if (!provPick) { return; }
    vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(path.join(workspaceDir(), "rapport.pdf")),
      filters: { "PDF": ["pdf"] }
    }).then(function (uri) {
      if (!uri) { return; }
      const cfg = vscode.workspace.getConfiguration("chazPlots");
      const requestId = String(nextExportRequestId++);
      pendingExports[requestId] = { filePath: uri.fsPath, title: "rapport", nativePdf: null, report: true };
      postToWebview({
        type: "exportReport", requestId: requestId,
        options: { dpi: Number(cfg.get("dpi", 200)) || 150, provenance: provPick.value }
      });
    });
  });
}

function saveAllToFolder(ext, figs) {
  const targets = Array.isArray(figs) && figs.length ? figs : figures;
  vscode.window.showOpenDialog({
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    openLabel: "Enregistrer les " + String(targets.length) + " figures ici"
  }).then(function (uris) {
    if (!uris || uris.length === 0) { return; }
    const dir = uris[0].fsPath;
    const cfg = vscode.workspace.getConfiguration("chazPlots");
    // ext (png/svg) choisi en amont par le prompt de saveAll.
    const scale = Math.max(0.25, Number(cfg.get("dpi", 200)) / 96);
    let syncCount = 0;
    const pending = [];   // figures Plotly : pas d'asset png/svg -> export via webview
    for (let i = 0; i < targets.length; i = i + 1) {
      const fig = targets[i];
      const name = String(i + 1).padStart(2, "0") + "_" + defaultName(fig, ext);
      const filePath = path.join(dir, name);
      let wrote = false;
      try { wrote = writeFigure(fig, filePath); } catch (e) { wrote = false; }
      if (wrote) {
        embedFigureInFile(filePath, fig);
        syncCount = syncCount + 1;
      } else if (fig.plotly && !fig.frames) {
        pending.push({ fig: fig, filePath: filePath });
      }
    }
    if (pending.length === 0) {
      vscode.window.showInformationMessage("Chaz Plots : " + String(syncCount) + " figure(s) enregistrée(s) dans " + dir);
      return;
    }
    // Figures Plotly interactives : seul le webview detient le rendu vivant. On
    // demande un export image par figure (meme mecanique que saveOne) et on
    // agrege le compte final dans finishPlotlyExport via le marqueur `batch`.
    const batch = { remaining: pending.length, written: 0, syncCount: syncCount, dir: dir };
    const options = { format: ext, scale: scale, transparent: false };
    pending.forEach(function (item) {
      const requestId = String(nextExportRequestId++);
      pendingExports[requestId] = { filePath: item.filePath, title: item.fig.title, nativePdf: null, batch: batch, figId: item.fig.id };
      postToWebview({ type: "exportPlotly", id: item.fig.id, requestId: requestId, options: options });
    });
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
    else if (msg.type === "saveAnimation") { saveAnimation(msg.id, msg.format); }
    else if (msg.type === "saveWith") { saveWith(msg.id, msg.frameIndex, msg.options); }
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
    else if (msg.type === "setExportSource") { setExportSource(msg.id, msg.sciencePlot); }
    else if (msg.type === "copyFigureData") { copyFigureData(msg.id); }
    else if (msg.type === "pasteFigure") { pasteFigure(); }
    else if (msg.type === "updateTags") { updateTags(msg.id, msg.tags); }
    else if (msg.type === "updateFigure") { updateFigureTrace(msg.id, msg.traceIndex, msg.patch); }
    else if (msg.type === "appendFigureTrace") { appendFigureTrace(msg.id, msg.trace); }
    else if (msg.type === "updateFigureLayout") { updateFigureLayout(msg.id, msg.patch); }
    else if (msg.type === "replaceFigurePlotly") { replaceFigurePlotly(msg.id, msg.plotly); }
    else if (msg.type === "openSource") { openSource(msg.path, msg.line); }
    else if (msg.type === "saveCustomPreset") { saveCustomPreset(msg.name, msg.style); }
    else if (msg.type === "readDataFile") { readDataFile(msg.requestId, msg.uri, msg.target); }
    else if (msg.type === "importImageData") {
      try {
        const buf = Buffer.from(msg.b64 || "", "base64");
        handleImportImage(buf, msg.name, msg.requestId, msg.digitizeFallback);
      } catch (e) { /* image illisible */ }
    }
    else if (msg.type === "importImageUri") {
      try {
        const fsPath = vscode.Uri.parse(msg.uri).fsPath;
        handleImportImage(fs.readFileSync(fsPath), path.basename(fsPath), msg.requestId, msg.digitizeFallback);
      } catch (e) { /* lecture impossible */ }
    }
    else if (msg.type === "createFigureFromData") { createFigureFromData(msg.title, msg.plotly); }
    else if (msg.type === "generateModelCode") {
      // Code matplotlib reproduisant le MODELE ajuste (equation), pas un dump de points.
      try {
        const header = "# Code genere par Chaz Plots : courbe(s) reconstruite(s) par leur EQUATION ajustee.\n\n";
        vscode.workspace.openTextDocument({ language: "python", content: header + String(msg.code || "") })
          .then(function (doc) { return vscode.window.showTextDocument(doc); })
          .then(undefined, function (err) {
            vscode.window.showErrorMessage("Chaz Plots : impossible d'ouvrir l'editeur (" + String(err) + ")");
          });
      } catch (e) {
        vscode.window.showErrorMessage("Chaz Plots : echec de la generation du code (" + String(e) + ")");
      }
    }
    else if (msg.type === "generateCodeFromSpec") {
      try {
        const code = PlotlyToPy.toMatplotlib({ title: msg.title || "", plotly: msg.spec });
        const header = "# Code reconstruit par Chaz Plots a partir d'une image digitalisee\n"
          + "# (points extraits du raster ; reproduit la courbe).\n\n";
        vscode.workspace.openTextDocument({ language: "python", content: header + code })
          .then(function (doc) { return vscode.window.showTextDocument(doc); })
          .then(undefined, function (err) {
            vscode.window.showErrorMessage("Chaz Plots : impossible d'ouvrir l'editeur (" + String(err) + ")");
          });
      } catch (e) {
        vscode.window.showErrorMessage("Chaz Plots : echec de la generation du code (" + String(e) + ")");
      }
    }
    else if (msg.type === "editTags") { editTags(msg.id); }
    else if (msg.type === "saveAll") { saveAll(msg.ids); }
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
      // 'undefined' permet au panneau de rester détaché sur un autre écran.
      // Panneau singleton : un script (re)lancé reutilise CETTE fenetre, qu'elle
      // soit en onglet ou detachee — on n'en ouvre jamais une seconde.
      panel.reveal(undefined, true);
    }
    return;
  }
  const cfg = vscode.workspace.getConfiguration("chazPlots");
  const autoDetach = cfg.get("autoDetachWindow", false);
  panel = vscode.window.createWebviewPanel(
    "chazPlots",
    "Graphes",
    // Detachement auto : on le cree focalise (preserveFocus:false) pour pouvoir
    // le deplacer dans sa propre fenetre juste apres.
    { viewColumn: vscode.ViewColumn.Beside, preserveFocus: !autoDetach },
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.file(path.join(extContext.extensionPath, "media"))]
    }
  );

  setupPanel(panel);

  if (autoDetach) {
    // Detache le panneau dans sa propre fenetre, UNIQUEMENT a la creation
    // (le bloc `if (panel)` ci-dessus court-circuite les appels suivants, donc
    // pas de re-detachement ni de seconde fenetre quand le script relance).
    // Petit delai : laisser l'editeur webview devenir l'editeur actif avant que
    // la commande ne le deplace.
    setTimeout(function () {
      if (!panel) { return; }
      try { panel.reveal(undefined, false); } catch (e) { /* ignore */ }
      vscode.commands.executeCommand("workbench.action.moveEditorToNewWindow")
        .then(undefined, function () { /* commande indisponible (VS Code ancien) : on laisse l'onglet */ });
    }, 60);
  }
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
  const dataImportUri = webview.asWebviewUri(
    vscode.Uri.file(path.join(extContext.extensionPath, "media", "data_import.js"))
  );
  const boardLayoutUri = webview.asWebviewUri(
    vscode.Uri.file(path.join(extContext.extensionPath, "media", "board_layout.js"))
  );
  const curveDigitizeUri = webview.asWebviewUri(
    vscode.Uri.file(path.join(extContext.extensionPath, "media", "curve_digitize.js"))
  );
  const curveFitUri = webview.asWebviewUri(
    vscode.Uri.file(path.join(extContext.extensionPath, "media", "curve_fit.js"))
  );
  const htmlPath = path.join(extContext.extensionPath, "media", "panel.html");
  let template = null;
  try {
    template = fs.readFileSync(htmlPath, "utf8");
  } catch (e) {
    template = null;
  }
  if (template !== null) {
    const cfg = vscode.workspace.getConfiguration("chazPlots");
    const customPlotStyles = cfg.get("customPlotStyles", {});
    const customPlotStylesJson = JSON.stringify(customPlotStyles && typeof customPlotStyles === "object" ? customPlotStyles : {});
    return template
      .replace(/{{customPlotStylesJson}}/g, customPlotStylesJson)
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
      .replace(/{{autoscaleUri}}/g, String(autoscaleUri))
      .replace(/{{dataImportUri}}/g, String(dataImportUri))
      .replace(/{{boardLayoutUri}}/g, String(boardLayoutUri))
      .replace(/{{curveDigitizeUri}}/g, String(curveDigitizeUri))
      .replace(/{{curveFitUri}}/g, String(curveFitUri));
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
