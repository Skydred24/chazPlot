// ============================================================
// storage.js — persistance des figures (disque + index workspace)
// Les figures survivent a un Reload Window. Best-effort : toute
// erreur d'E/S est journalisee et n'interrompt jamais l'affichage.
// ============================================================
"use strict";

const vscode = require("vscode");
const path = require("path");
const fs = require("fs");

const INDEX_KEY = "spyderPlots.index";
let ctx = null;
let figuresDir = null;

function init(context) {
  ctx = context;
  const base = context.storageUri || context.globalStorageUri;
  if (!base) {
    figuresDir = null;
    return;
  }
  figuresDir = path.join(base.fsPath, "figures");
  try {
    fs.mkdirSync(figuresDir, { recursive: true });
  } catch (e) {
    figuresDir = null;
  }
}

function readIndex() {
  return ctx.workspaceState.get(INDEX_KEY, { nextId: 1, figures: [] });
}

function writeIndex(index) {
  return ctx.workspaceState.update(INDEX_KEY, index);
}

function figPath(id) {
  return path.join(figuresDir, String(id) + ".json");
}

function maxFigures() {
  const cfg = vscode.workspace.getConfiguration("spyderPlots");
  const n = cfg.get("maxPersistedFigures", 200);
  return n > 0 ? n : null;
}

function nextId() {
  return readIndex().nextId;
}

// Chargement asynchrone et parallele : ne bloque pas le thread de
// l'extension au demarrage, meme avec beaucoup de figures lourdes
// (animations). Retourne une Promise<fig[]> dans l'ordre de l'index.
function loadAll() {
  if (!figuresDir) { return Promise.resolve([]); }
  const index = readIndex();
  return Promise.all(index.figures.map(function (entry) {
    return fs.promises.readFile(figPath(entry.id), "utf8")
      .then(function (raw) { return JSON.parse(raw); })
      .catch(function () { return null; });  // fichier manquant/corrompu
  })).then(function (figs) {
    return figs.filter(function (f) { return f !== null; });
  });
}

// Suppression de fichier best-effort, non bloquante.
function unlinkAsync(id) {
  fs.promises.unlink(figPath(id)).catch(function () { /* deja absent / ignore */ });
}

function evictIfNeeded(index) {
  const cap = maxFigures();
  if (cap === null) { return; }
  while (index.figures.length > cap) {
    const old = index.figures.shift();
    unlinkAsync(old.id);
  }
}

// NB : l'index (workspaceState) est mis a jour de facon synchrone et en
// memoire — c'est petit et ca evite toute course read-modify-write entre
// deux figures. Seules les E/S de fichiers (potentiellement volumineuses,
// ex. animations) sont asynchrones, pour ne pas bloquer le thread de
// l'extension. loadAll() tolere un fichier manquant, donc une ecriture qui
// echoue reste sans danger (best-effort).
function save(fig) {
  if (!figuresDir) { return; }
  fs.promises.writeFile(figPath(fig.id), JSON.stringify(fig), "utf8")
    .catch(function () { /* best-effort */ });
  const index = readIndex();
  index.figures = index.figures.filter(function (f) { return f.id !== fig.id; });
  index.figures.push({ id: fig.id, title: fig.title, tags: fig.tags || [], ts: fig.ts });
  index.nextId = Math.max(index.nextId, fig.id + 1);
  evictIfNeeded(index);
  writeIndex(index);
}

function remove(id) {
  if (!figuresDir) { return; }
  const index = readIndex();
  index.figures = index.figures.filter(function (f) { return f.id !== id; });
  writeIndex(index);
  unlinkAsync(id);
}

function removeAll() {
  if (!figuresDir) { return; }
  const index = readIndex();
  index.figures.forEach(function (f) { unlinkAsync(f.id); });
  index.figures = [];
  writeIndex(index);
}

function updateTags(id, tags) {
  if (!figuresDir) { return; }
  const index = readIndex();
  const entry = index.figures.find(function (f) { return f.id === id; });
  if (entry) { entry.tags = tags; }
  writeIndex(index);
  // met aussi a jour le fichier figure (lecture/ecriture asynchrone)
  fs.promises.readFile(figPath(id), "utf8")
    .then(function (raw) {
      const fig = JSON.parse(raw);
      fig.tags = tags;
      return fs.promises.writeFile(figPath(id), JSON.stringify(fig), "utf8");
    })
    .catch(function () { /* fichier absent/corrompu : ignore */ });
}

module.exports = {
  init: init, loadAll: loadAll, save: save, remove: remove,
  removeAll: removeAll, updateTags: updateTags, nextId: nextId,
};
