# Robustesse, convertisseur & copier-image — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fiabiliser Spyder Plots (persistance, port), corriger le convertisseur matplotlib→Plotly (dates, légende, twinx), supprimer le HTML dupliqué, ajouter des tests, et copier une figure vers le presse-papiers.

**Architecture:** Extension VS Code en JS pur (serveur HTTP + webview) ↔ backend matplotlib Python communiquant par POST `/figure`. Persistance disque dans `context.storageUri` + index `workspaceState`. Convertisseur Python pur (matplotlib/numpy). Copie d'image via webview `ClipboardItem`.

**Tech Stack:** Node/VS Code API, JavaScript ; Python 3 + matplotlib/numpy ; `unittest` stdlib ; Plotly.js (embarqué).

## Global Constraints

- Backend Python : **aucune dépendance hors matplotlib/numpy**.
- Contrat `/figure` (`plotly`/`pgf`/`svg`/`png`/`frames`) et variables `VSCODE_PLOTS_*` : **rétrocompatibles**.
- Extension : JavaScript pur, **pas d'étape de build**.
- Langue : **français** (UI, commentaires, descriptions de réglages).
- Tests lancés via `python test/test_convert.py` (avec `matplotlib.use("Agg")`).

---

### Task 1: Harnais de tests du convertisseur (cas existants)

**Files:**
- Create: `test/test_convert.py`

**Interfaces:**
- Consumes: `convert_figure(fig)` de `python/_mpl_to_plotly.py` → `{"data":[...], "layout":{...}, ...}` ou `None`.
- Produces: fonctions de tests réutilisées par les tâches suivantes (mêmes helpers d'import).

- [ ] **Step 1: Écrire les tests des comportements DÉJÀ supportés (doivent passer immédiatement)**

```python
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "python"))
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

from _mpl_to_plotly import convert_figure


class ConvertBaseTests(unittest.TestCase):
    def tearDown(self):
        plt.close("all")

    def test_simple_line_one_scatter_trace(self):
        fig, ax = plt.subplots()
        ax.plot([0, 1, 2], [3, 4, 5])
        spec = convert_figure(fig)
        self.assertIsNotNone(spec)
        self.assertEqual(len(spec["data"]), 1)
        self.assertEqual(spec["data"][0]["type"], "scatter")
        self.assertEqual(spec["data"][0]["mode"], "lines")

    def test_log_scale(self):
        fig, ax = plt.subplots()
        ax.plot([1, 10, 100], [1, 2, 3])
        ax.set_xscale("log")
        spec = convert_figure(fig)
        self.assertEqual(spec["layout"]["xaxis"]["type"], "log")

    def test_bar_orientation(self):
        fig, ax = plt.subplots()
        ax.barh(["a", "b"], [1, 2])
        spec = convert_figure(fig)
        bars = [t for t in spec["data"] if t["type"] == "bar"]
        self.assertTrue(bars and bars[0]["orientation"] == "h")

    def test_unsupported_fill_between_returns_none(self):
        fig, ax = plt.subplots()
        ax.fill_between([0, 1, 2], [0, 1, 0])
        self.assertIsNone(convert_figure(fig))

    def test_unsupported_text_returns_none(self):
        fig, ax = plt.subplots()
        ax.plot([0, 1], [0, 1])
        ax.text(0.5, 0.5, "note")
        self.assertIsNone(convert_figure(fig))

    def test_two_subplots_two_axis_pairs(self):
        fig, (ax1, ax2) = plt.subplots(1, 2)
        ax1.plot([0, 1], [0, 1])
        ax2.plot([0, 1], [1, 0])
        spec = convert_figure(fig)
        self.assertIn("xaxis", spec["layout"])
        self.assertIn("xaxis2", spec["layout"])
        # non-régression twinx : aucun axe en overlay
        for key, val in spec["layout"].items():
            if key.startswith("yaxis"):
                self.assertNotIn("overlaying", val)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Lancer — tout doit passer**

Run: `python test/test_convert.py -v`
Expected: PASS (ces comportements existent déjà).

- [ ] **Step 3: Commit**

```bash
git add test/test_convert.py
git commit -m "test: harnais unittest convert_figure (cas existants)"
```

---

### Task 2: Axes temporels (dates) dans le convertisseur

**Files:**
- Modify: `python/_mpl_to_plotly.py`
- Modify: `test/test_convert.py`

**Interfaces:**
- Produces: helpers `_is_date_axis(axis) -> bool`, `_dates_to_iso(values) -> list`.

- [ ] **Step 1: Test (échoue)** — ajouter à `test_convert.py`

```python
import datetime as _dt


class ConvertDateTests(unittest.TestCase):
    def tearDown(self):
        plt.close("all")

    def test_date_axis_becomes_type_date(self):
        fig, ax = plt.subplots()
        days = [_dt.date(2024, 1, 1), _dt.date(2024, 1, 2), _dt.date(2024, 1, 3)]
        ax.plot(days, [1, 2, 3])
        spec = convert_figure(fig)
        self.assertIsNotNone(spec)
        self.assertEqual(spec["layout"]["xaxis"]["type"], "date")
        # x converti en chaînes ISO (plus des datenums flottants)
        self.assertIsInstance(spec["data"][0]["x"][0], str)
```

- [ ] **Step 2: Lancer — échoue**

Run: `python test/test_convert.py ConvertDateTests -v`
Expected: FAIL (`type` absent ou x flottant).

- [ ] **Step 3: Implémenter les helpers** (après `_custom_ticks`, avant la section conversion d'artistes)

```python
def _is_date_axis(axis):
    """True si l'axe utilise un converter de dates matplotlib."""
    try:
        import matplotlib.dates as mdates
    except Exception:
        return False
    conv = None
    getter = getattr(axis, "get_converter", None)
    if callable(getter):
        try:
            conv = getter()
        except Exception:
            conv = None
    if conv is None:
        conv = getattr(axis, "converter", None)
    date_types = (mdates.DateConverter,)
    if hasattr(mdates, "ConciseDateConverter"):
        date_types = date_types + (mdates.ConciseDateConverter,)
    return isinstance(conv, date_types)


def _dates_to_iso(values):
    """Liste de datenums matplotlib -> chaînes ISO (None preserve)."""
    import matplotlib.dates as mdates
    out = []
    for v in values:
        if v is None:
            out.append(None)
        else:
            out.append(mdates.num2date(v).isoformat())
    return out
```

- [ ] **Step 4: Brancher la détection dans `convert_figure`** — dans la boucle par axe, juste avant la section « ---- axes : domaine... », après l'ajout des traces. Mémoriser l'index de départ des traces de l'axe en début d'itération (`axis_trace_start = len(data)` placé juste après le calcul de `suffix`), puis :

```python
        x_is_date = _is_date_axis(ax.xaxis)
        y_is_date = _is_date_axis(ax.yaxis)
        for trace in data[axis_trace_start:]:
            if x_is_date and "x" in trace:
                trace["x"] = _dates_to_iso(trace["x"])
            if y_is_date and "y" in trace:
                trace["y"] = _dates_to_iso(trace["y"])
```

Puis dans la construction de `layout[axis_x]` / `layout[axis_y]`, après les blocs `type=="log"` :

```python
        if x_is_date:
            layout[axis_x]["type"] = "date"
            layout[axis_x].pop("tickvals", None)
            layout[axis_x].pop("ticktext", None)
            layout[axis_x].pop("range", None)
        if y_is_date:
            layout[axis_y]["type"] = "date"
            layout[axis_y].pop("tickvals", None)
            layout[axis_y].pop("ticktext", None)
            layout[axis_y].pop("range", None)
```

(Ne pas appliquer `_custom_ticks`/`_axis_range` sur un axe date : les `pop` ci-dessus neutralisent les valeurs numériques déjà posées.)

- [ ] **Step 5: Lancer — passe**

Run: `python test/test_convert.py -v`
Expected: PASS (tous).

- [ ] **Step 6: Commit**

```bash
git add python/_mpl_to_plotly.py test/test_convert.py
git commit -m "feat(convert): axes temporels -> type date + ISO"
```

---

### Task 3: Position de légende

**Files:**
- Modify: `python/_mpl_to_plotly.py`
- Modify: `test/test_convert.py`

**Interfaces:**
- Produces: `_LEGEND_LOC` (dict code mpl -> position Plotly).

- [ ] **Step 1: Test (échoue)** — ajouter à `test_convert.py`

```python
class ConvertLegendTests(unittest.TestCase):
    def tearDown(self):
        plt.close("all")

    def test_legend_lower_left(self):
        fig, ax = plt.subplots()
        ax.plot([0, 1], [0, 1], label="serie")
        ax.legend(loc="lower left")
        spec = convert_figure(fig)
        leg = spec["layout"]["legend"]
        self.assertEqual(leg["xanchor"], "left")
        self.assertEqual(leg["yanchor"], "bottom")
        self.assertLess(leg["x"], 0.5)
        self.assertLess(leg["y"], 0.5)
```

- [ ] **Step 2: Lancer — échoue**

Run: `python test/test_convert.py ConvertLegendTests -v`
Expected: FAIL (légende toujours en haut-droite).

- [ ] **Step 3: Implémenter** — ajouter la table près des constantes du haut :

```python
# Codes loc matplotlib -> ancrage Plotly. 0 ('best') non gere (defaut).
_LEGEND_LOC = {
    1: {"x": 0.99, "xanchor": "right", "y": 0.99, "yanchor": "top"},
    2: {"x": 0.01, "xanchor": "left", "y": 0.99, "yanchor": "top"},
    3: {"x": 0.01, "xanchor": "left", "y": 0.01, "yanchor": "bottom"},
    4: {"x": 0.99, "xanchor": "right", "y": 0.01, "yanchor": "bottom"},
    5: {"x": 0.99, "xanchor": "right", "y": 0.5, "yanchor": "middle"},
    6: {"x": 0.01, "xanchor": "left", "y": 0.5, "yanchor": "middle"},
    7: {"x": 0.99, "xanchor": "right", "y": 0.5, "yanchor": "middle"},
    8: {"x": 0.5, "xanchor": "center", "y": 0.01, "yanchor": "bottom"},
    9: {"x": 0.5, "xanchor": "center", "y": 0.99, "yanchor": "top"},
    10: {"x": 0.5, "xanchor": "center", "y": 0.5, "yanchor": "middle"},
}
```

Remplacer le bloc `if ax.get_legend() is not None:` par :

```python
        legend = ax.get_legend()
        if legend is not None:
            layout["showlegend"] = True
            legend_layout = {
                "font": {"size": 13},
                "bgcolor": "rgba(255,255,255,0.88)",
                "bordercolor": "rgba(80,80,80,0.55)",
                "borderwidth": 1,
                "xanchor": "right",
                "x": 0.99,
                "yanchor": "top",
                "y": 0.99,
            }
            pos = _LEGEND_LOC.get(getattr(legend, "_loc", 0))
            if pos:
                legend_layout.update(pos)
            layout["legend"] = legend_layout
```

- [ ] **Step 4: Lancer — passe**

Run: `python test/test_convert.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add python/_mpl_to_plotly.py test/test_convert.py
git commit -m "feat(convert): position de legende selon loc matplotlib"
```

---

### Task 4: twinx (axe Y secondaire en overlay)

**Files:**
- Modify: `python/_mpl_to_plotly.py`
- Modify: `test/test_convert.py`

**Interfaces:**
- Produces: `_shares_x(a, b)`, `_same_position(a, b)`, `_classify_axes(axes_list)`.

- [ ] **Step 1: Test (échoue)** — ajouter à `test_convert.py`

```python
class ConvertTwinxTests(unittest.TestCase):
    def tearDown(self):
        plt.close("all")

    def test_twinx_overlay_single_x(self):
        fig, ax = plt.subplots()
        ax.plot([0, 1, 2], [0, 1, 2])
        ax2 = ax.twinx()
        ax2.plot([0, 1, 2], [10, 5, 1])
        spec = convert_figure(fig)
        self.assertIsNotNone(spec)
        # un seul axe X
        x_axes = [k for k in spec["layout"] if k.startswith("xaxis")]
        self.assertEqual(len(x_axes), 1)
        # un axe Y secondaire en overlay a droite
        self.assertEqual(spec["layout"]["yaxis2"]["overlaying"], "y")
        self.assertEqual(spec["layout"]["yaxis2"]["side"], "right")
        # les traces du twin pointent vers x principal et y2
        y2_traces = [t for t in spec["data"] if t.get("yaxis") == "y2"]
        self.assertTrue(y2_traces and all(t["xaxis"] == "x" for t in y2_traces))
```

- [ ] **Step 2: Lancer — échoue**

Run: `python test/test_convert.py ConvertTwinxTests -v`
Expected: FAIL (deux axes X distincts produits).

- [ ] **Step 3: Implémenter la classification** — ajouter avant `convert_figure` :

```python
def _shares_x(a, b):
    try:
        return b in a.get_shared_x_axes().get_siblings(a)
    except Exception:
        return False


def _same_position(a, b, eps=1e-3):
    pa = a.get_position()
    pb = b.get_position()
    return (
        abs(pa.x0 - pb.x0) < eps and abs(pa.x1 - pb.x1) < eps
        and abs(pa.y0 - pb.y0) < eps and abs(pa.y1 - pb.y1) < eps
    )


def _classify_axes(axes_list):
    """Retourne, pour chaque axe, (suffix, is_twin, host_suffix).
    Un axe est un twin s'il partage X avec un axe precedent ET occupe
    la meme position (twinx). Les sous-graphes distincts ne le sont pas."""
    infos = []
    for index, ax in enumerate(axes_list):
        infos.append({
            "ax": ax,
            "suffix": "" if index == 0 else str(index + 1),
            "is_twin": False,
            "host_suffix": None,
        })
    for i in range(len(infos)):
        ax = infos[i]["ax"]
        for j in range(i):
            host = infos[j]["ax"]
            if _shares_x(ax, host) and _same_position(ax, host):
                infos[i]["is_twin"] = True
                infos[i]["host_suffix"] = infos[j]["suffix"]
                break
    return infos
```

- [ ] **Step 4: Restructurer la boucle de `convert_figure`** — remplacer `for index, ax in enumerate(axes_list):` et le calcul de suffix par une itération sur `_classify_axes(axes_list)`, et brancher le rendu twin. Boucle d'en-tête :

```python
    for info in _classify_axes(axes_list):
        ax = info["ax"]
        suffix = info["suffix"]
        is_twin = info["is_twin"]
        host_suffix = info["host_suffix"]
        axis_x = "xaxis" + suffix
        axis_y = "yaxis" + suffix
        axis_trace_start = len(data)
```

Après l'ajout des traces et la conversion date (Task 2), réécrire le X des traces twin :

```python
        if is_twin:
            for trace in data[axis_trace_start:]:
                trace["xaxis"] = "x" + host_suffix
                trace["yaxis"] = "y" + suffix
```

Encadrer la construction d'axes : pour un axe **non-twin**, garder le code actuel (`layout[axis_x] = {...}` avec domaine, puis `layout[axis_y] = {...}`, log, ticks, range, date, titre, légende). Pour un **twin**, ne créer **que** l'axe Y en overlay (pas de `layout[axis_x]`, pas d'annotation de titre) :

```python
        if is_twin:
            position = ax.get_position()  # conserve pour coherence
            layout[axis_y] = {
                "overlaying": "y" + host_suffix,
                "side": "right",
                "anchor": "x" + host_suffix,
                "title": {"text": ax.get_ylabel()},
                "showgrid": False,
                "zeroline": False,
                "linecolor": "#444444",
                "ticks": "outside",
            }
            if ax.get_yscale() == "log":
                layout[axis_y]["type"] = "log"
            ticks_y = _custom_ticks(ax.yaxis)
            if ticks_y is not None and ax.get_yscale() != "log":
                layout[axis_y]["tickvals"] = ticks_y[0]
                layout[axis_y]["ticktext"] = ticks_y[1]
            y_range = _axis_range(ax, "y")
            if y_range is not None:
                layout[axis_y]["range"] = y_range
            if _is_date_axis(ax.yaxis):
                layout[axis_y]["type"] = "date"
                layout[axis_y].pop("tickvals", None)
                layout[axis_y].pop("range", None)
            continue  # pas de bloc axe X / titre / domaine pour un twin
```

(placer ce bloc twin juste avant le bloc `# ---- axes : domaine... ` existant ; le `continue` saute le rendu d'axe principal. La gestion date X/Y de Task 2 reste appliquée AVANT ce bloc, sur `data[axis_trace_start:]`.)

- [ ] **Step 5: Lancer — passe + non-régression**

Run: `python test/test_convert.py -v`
Expected: PASS (y compris `test_two_subplots_two_axis_pairs`).

- [ ] **Step 6: Commit**

```bash
git add python/_mpl_to_plotly.py test/test_convert.py
git commit -m "feat(convert): twinx -> axe Y secondaire en overlay"
```

---

### Task 5: Fiabilisation du port — backend lit un fichier en fallback

**Files:**
- Modify: `python/vscode_spyder_plots_backend.py`

**Interfaces:**
- Consumes: fichier `os.tmpdir()/spyder-plots-port.json` (écrit par l'extension, Task 6).
- Produces: comportement de relecture de port dans `_send_figure`.

- [ ] **Step 1: Ajouter le helper de lecture du fichier de port** — après `_port()` :

```python
import tempfile


def _port_file_path():
    return os.path.join(tempfile.gettempdir(), "spyder-plots-port.json")


def _port_from_file():
    """Port actif ecrit par l'extension (fallback si l'env est perime)."""
    try:
        with open(_port_file_path(), "r", encoding="utf-8") as handle:
            data = json.load(handle)
        port = int(data.get("port"))
        return str(port)
    except Exception:
        return None
```

- [ ] **Step 2: Modifier `_send_figure` pour réessayer via le fichier** — remplacer le corps `try/except` par une boucle sur les ports candidats (env d'abord, puis fichier s'il diffère) :

```python
def _send_figure(payload):
    """Envoie une figure (ou animation) au serveur local de l'extension."""
    global _WARNED
    body = json.dumps(payload).encode("utf-8")
    candidates = [_port()]
    file_port = _port_from_file()
    if file_port is not None and file_port not in candidates:
        candidates.append(file_port)

    for port in candidates:
        url = "http://127.0.0.1:" + port + "/figure"
        request = urllib.request.Request(
            url, data=body,
            headers={"Content-Type": "application/json"}, method="POST",
        )
        try:
            urllib.request.urlopen(request, timeout=15.0)
            return True
        except (urllib.error.URLError, OSError):
            continue

    if not _WARNED:
        _WARNED = True
        sys.stderr.write(
            "[spyder-plots] Impossible de joindre l'extension VS Code (port "
            + _port() + "). Verifiez que l'extension est active, puis ouvrez "
            + "un NOUVEAU terminal.\n"
        )
    return False
```

- [ ] **Step 3: Vérifier (sanity)**

Run: `python -c "import sys; sys.path.insert(0,'python'); import vscode_spyder_plots_backend as b; print(b._port_file_path())"`
Expected: chemin contenant `spyder-plots-port.json`.

- [ ] **Step 4: Commit**

```bash
git add python/vscode_spyder_plots_backend.py
git commit -m "feat(backend): fallback de port via fichier temp"
```

---

### Task 6: Extension écrit le fichier de port

**Files:**
- Modify: `extension.js`

**Interfaces:**
- Produces: fichier `os.tmpdir()/spyder-plots-port.json` = `{port, pid, ts}`.

- [ ] **Step 1: Ajouter l'écriture du fichier** — dans `startServer`, callback `server.listen`, après `activePort = port;` :

```javascript
  server.listen(port, "127.0.0.1", function () {
    activePort = port;
    writePortFile(port);
    injectEnvironment(port);
  });
```

Ajouter la fonction (près de `injectEnvironment`) :

```javascript
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
```

- [ ] **Step 2: Vérifier (lint manuel)**

Run: `node -e "require('./extension.js'); console.log('require ok')"`
Expected: peut échouer sur `require('vscode')` (normal hors VS Code). Si tel est le cas, vérifier plutôt la syntaxe : `node --check extension.js` → `Expected: pas d'erreur de syntaxe`.

- [ ] **Step 3: Commit**

```bash
git add extension.js
git commit -m "feat(extension): ecrit le port actif dans un fichier temp"
```

---

### Task 7: Module de persistance `storage.js`

**Files:**
- Create: `storage.js`

**Interfaces:**
- Consumes: `vscode.ExtensionContext` (storageUri/globalStorageUri/workspaceState), réglage `spyderPlots.maxPersistedFigures`.
- Produces: `module.exports = { init, loadAll, save, remove, removeAll, updateTags, nextId }`.

- [ ] **Step 1: Écrire le module**

```javascript
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

function loadAll() {
  if (!figuresDir) { return []; }
  const index = readIndex();
  const out = [];
  index.figures.forEach(function (entry) {
    try {
      const raw = fs.readFileSync(figPath(entry.id), "utf8");
      out.push(JSON.parse(raw));
    } catch (e) {
      // fichier manquant/corrompu : on ignore cette figure
    }
  });
  return out;
}

function evictIfNeeded(index) {
  const cap = maxFigures();
  if (cap === null) { return; }
  while (index.figures.length > cap) {
    const old = index.figures.shift();
    try { fs.unlinkSync(figPath(old.id)); } catch (e) { /* ignore */ }
  }
}

function save(fig) {
  if (!figuresDir) { return; }
  const index = readIndex();
  try {
    fs.writeFileSync(figPath(fig.id), JSON.stringify(fig), "utf8");
  } catch (e) {
    return;
  }
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
  try { fs.unlinkSync(figPath(id)); } catch (e) { /* ignore */ }
  writeIndex(index);
}

function removeAll() {
  if (!figuresDir) { return; }
  const index = readIndex();
  index.figures.forEach(function (f) {
    try { fs.unlinkSync(figPath(f.id)); } catch (e) { /* ignore */ }
  });
  index.figures = [];
  writeIndex(index);
}

function updateTags(id, tags) {
  if (!figuresDir) { return; }
  const index = readIndex();
  const entry = index.figures.find(function (f) { return f.id === id; });
  if (entry) { entry.tags = tags; }
  writeIndex(index);
  // met aussi a jour le fichier figure
  try {
    const raw = fs.readFileSync(figPath(id), "utf8");
    const fig = JSON.parse(raw);
    fig.tags = tags;
    fs.writeFileSync(figPath(id), JSON.stringify(fig), "utf8");
  } catch (e) { /* ignore */ }
}

module.exports = {
  init: init, loadAll: loadAll, save: save, remove: remove,
  removeAll: removeAll, updateTags: updateTags, nextId: nextId,
};
```

- [ ] **Step 2: Vérifier la syntaxe**

Run: `node --check storage.js`
Expected: pas d'erreur.

- [ ] **Step 3: Commit**

```bash
git add storage.js
git commit -m "feat: module storage.js (persistance figures)"
```

---

### Task 8: Câbler la persistance dans `extension.js` + réglage

**Files:**
- Modify: `extension.js`
- Modify: `package.json`

**Interfaces:**
- Consumes: `storage` (Task 7).

- [ ] **Step 1: Importer et initialiser** — en tête de `extension.js` après les autres `require` :

```javascript
const storage = require("./storage");
```

Dans `activate(context)`, après `extContext = context;` :

```javascript
  storage.init(context);
  figures = storage.loadAll();
  nextId = storage.nextId();
  figures.forEach(function (f) { if (f.id >= nextId) { nextId = f.id + 1; } });
```

- [ ] **Step 2: Persister aux mutations** — ajouter les appels `storage.*` :

Dans `addFigure`, après `figures.push(fig);` :
```javascript
  storage.save(fig);
```
Dans `deleteOne`, après le filtrage :
```javascript
  storage.remove(id);
```
Dans `deleteAll`, après `figures = [];` :
```javascript
  storage.removeAll();
```
Dans `updateTags`, après `fig.tags = normalizeTags(tags);` :
```javascript
  storage.updateTags(id, fig.tags);
```

- [ ] **Step 3: Déclarer le réglage** — dans `package.json`, `contributes.configuration.properties`, ajouter :

```json
        "spyderPlots.maxPersistedFigures": {
          "type": "number",
          "default": 200,
          "minimum": 0,
          "description": "Nombre maximal de figures conservees entre les sessions (persistance disque). 0 = illimite ; au-dela, les plus anciennes sont evincees."
        }
```

- [ ] **Step 4: Vérifier**

Run: `node --check extension.js && python -c "import json; json.load(open('package.json'))" && echo OK`
Expected: `OK`.

- [ ] **Step 5: Commit**

```bash
git add extension.js package.json
git commit -m "feat(extension): persiste les figures via storage.js + reglage maxPersistedFigures"
```

---

### Task 9: Supprimer le fallback HTML inline

**Files:**
- Modify: `extension.js`

- [ ] **Step 1: Remplacer le fallback de `webviewHtml`** — le `if (template !== null)` reste ; remplacer tout le bloc de fallback inline (le grand tableau de chaînes `return [...]`) par un HTML d'erreur minimal :

```javascript
  if (template !== null) {
    return template
      .replace(/{{nonce}}/g, nonce)
      .replace(/{{cspSource}}/g, webview.cspSource)
      .replace(/{{plotlyUri}}/g, String(plotlyUri));
  }
  // media/panel.html introuvable : l'extension est mal installee.
  return [
    "<!DOCTYPE html><html lang='fr'><head><meta charset='UTF-8'></head>",
    "<body style='font-family:sans-serif;padding:24px'>",
    "<h3>Spyder Plots</h3>",
    "<p>Interface introuvable (media/panel.html manquant).",
    " Reinstallez l'extension.</p>",
    "</body></html>",
  ].join("");
```

- [ ] **Step 2: Vérifier**

Run: `node --check extension.js`
Expected: pas d'erreur.

- [ ] **Step 3: Commit**

```bash
git add extension.js
git commit -m "refactor(extension): supprime le HTML inline duplique (panel.html fait foi)"
```

---

### Task 10: Bouton « Copier » (presse-papiers) dans le panneau

**Files:**
- Modify: `media/panel.html`
- Modify: `extension.js`

**Interfaces:**
- Produces: messages webview→extension `{type:'copied'}` / `{type:'copyFailed', error}`.

- [ ] **Step 1: Ajouter la logique de copie dans `panel.html`** — fonction utilitaire (près des autres handlers JS) :

```javascript
  function blobFromFig(fig){
    if (fig.plotly && typeof Plotly !== "undefined"){
      const el = document.getElementById("plot-" + fig.id);
      if (el){
        return Plotly.toImage(el, { format: "png", scale: 2 })
          .then(function(url){ return fetch(url).then(function(r){ return r.blob(); }); });
      }
    }
    let b64 = fig.png;
    if (fig.frames && fig.frames.length){
      const idx = (fig.frameIndex || 0);
      b64 = fig.frames[Math.min(idx, fig.frames.length - 1)];
    }
    if (!b64){ return Promise.reject(new Error("aucune image PNG disponible")); }
    return fetch("data:image/png;base64," + b64).then(function(r){ return r.blob(); });
  }

  function copyFig(fig){
    blobFromFig(fig).then(function(blob){
      return navigator.clipboard.write([ new ClipboardItem({ "image/png": blob }) ]);
    }).then(function(){
      vscodeApi.postMessage({ type: "copied" });
    }).catch(function(err){
      vscodeApi.postMessage({ type: "copyFailed", error: String(err) });
    });
  }
```

- [ ] **Step 2: Ajouter le bouton « Copier » sur chaque carte** — là où sont créés les autres boutons d'en-tête (à côté de `bSave`), ajouter :

```javascript
    const bCopy = document.createElement("button");
    bCopy.className = "textbtn";
    bCopy.textContent = "Copier";
    bCopy.title = "Copier l'image dans le presse-papiers";
    bCopy.addEventListener("click", function(){ copyFig(fig); });
```

Et l'insérer dans l'en-tête (ajuster la ligne `head.append(...)`), p.ex. : `head.append(bTags, bCopy, bExpand, bSave, bDel);`.

- [ ] **Step 3: Gérer les messages dans `extension.js`** — dans `setupPanel`, `onDidReceiveMessage`, ajouter :

```javascript
    else if (msg.type === "copied") {
      vscode.window.showInformationMessage("Figure copiée dans le presse-papiers.");
    }
    else if (msg.type === "copyFailed") {
      vscode.window.showWarningMessage(
        "Spyder Plots : copie impossible (" + String(msg.error || "") +
        "). Utilisez « Enregistrer »."
      );
    }
```

- [ ] **Step 4: Vérifier**

Run: `node --check extension.js`
Expected: pas d'erreur.

- [ ] **Step 5: Test manuel (F5)** — lancer l'Extension Development Host, `python test/test_plots.py`, cliquer « Copier » sur une figure Plotly et une figure SVG, coller dans une appli externe. Expected: l'image apparaît ; toast « Figure copiée ».

- [ ] **Step 6: Commit**

```bash
git add media/panel.html extension.js
git commit -m "feat: bouton Copier (image -> presse-papiers via ClipboardItem)"
```

---

### Task 11: Documentation + bump de version

**Files:**
- Modify: `README.md`
- Modify: `CLAUDE.md`
- Modify: `package.json`

- [ ] **Step 1: README** — section « Limites connues » : retirer les puces dates / position de légende / twinx (résolues). Ajouter sous transport : « Multi-fenêtres : le fichier de port temporaire (fallback) est partagé ; la dernière fenêtre démarrée gagne. » Mentionner le bouton **Copier** et le réglage `spyderPlots.maxPersistedFigures`.

- [ ] **Step 2: CLAUDE.md** — ajouter : persistance (`storage.js` + index `workspaceState`, fichiers sous `storageUri/figures/`), fichier de port temp + fallback backend, suppression du fallback HTML inline, bouton Copier, réglage `maxPersistedFigures`.

- [ ] **Step 3: package.json** — `"version": "0.5.0"`.

- [ ] **Step 4: Commit**

```bash
git add README.md CLAUDE.md package.json
git commit -m "docs: maj limites/persistance/copier + bump 0.5.0"
```

---

## Self-Review

**Spec coverage :** A→Tasks 7-8 ; B→Tasks 5-6 ; C1→Task 2 ; C2→Task 3 ; C3→Task 4 ; D→Task 9 ; E→Tasks 1-4 (intégrés en TDD) ; F→Task 10 ; docs→Task 11. Tout couvert.

**Placeholders :** aucun TODO/TBD ; code complet à chaque étape.

**Cohérence des types :** `storage` expose `init/loadAll/save/remove/removeAll/updateTags/nextId` utilisés à l'identique en Task 8. Helpers convertisseur (`_is_date_axis`, `_dates_to_iso`, `_LEGEND_LOC`, `_shares_x`, `_same_position`, `_classify_axes`) définis avant usage. Messages `copied`/`copyFailed` cohérents entre panel.html (Task 10 step 1-2) et extension.js (step 3).
