# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> Note: this is the `spyder-plots` VS Code extension. The parent directory
> `coach_mobile/` holds an unrelated Flutter/Python project with its own
> CLAUDE.md — do not conflate the two.

## What this is

A VS Code extension that reproduces Spyder's **Graphes** pane: every
`plt.show()` (and `anim.save()`) sends the figure into one scrollable webview
panel instead of opening a blocking matplotlib window. Working language is
**French** — UI strings, comments, commit messages, and config descriptions.

It has two halves that talk over local HTTP:

- **`extension.js`** (Node/VS Code API, pure JS, no dependencies) — runs a
  local HTTP server, owns the webview panel, handles save/export/delete.
- **`python/`** — a custom matplotlib backend that renders figures and POSTs
  them to the extension. Imported by the user's Python via `MPLBACKEND`, never
  invoked by the extension directly.

## Commands

There is **no build step and no `npm install`** — the extension is plain
JavaScript. The converter has real assertion tests (`test/test_convert.py`,
`unittest`); the other `test/*.py` are visual demo scripts run *inside the
Extension Development Host*. JS files are syntax-checked with `node --check`.

```bash
# Converter assertion tests (needs a python with matplotlib/numpy):
python test/test_convert.py            # all
python test/test_convert.py ConvertTwinxTests -v   # one class

# Syntax-check the JS (no test runner for the extension host itself):
node --check extension.js
node --check storage.js

# Develop: open this folder in VS Code, press F5 ("Run Extension").
# A second VS Code window launches with the extension active.

# Package a .vsix (requires Node):
npx @vscode/vsce package
code --install-extension spyder-plots-<version>.vsix

# Exercise the extension (run from a NEW integrated terminal in the dev host):
python test/test_plots.py    # 3 figures + 1 animation (smoke test)
python test/test_stress.py   # 25 adversarial cases; titles prefixed
                             # [PLOTLY?]/[SVG]/[ANIM]/[LIMITE] = expected render
python test/test_capture.py  # animation frame capture
python test/test_show.py     # show() routing
```

Releasing = bump `version` in `package.json`, then repackage the `.vsix`. The
committed `*.vsix` files are prior release artifacts (gitignored going forward).

## Architecture

### The two-process contract

```
user's python ──MPLBACKEND──▶ python/vscode_spyder_plots_backend.py
                                       │ POST http://127.0.0.1:<port>/figure
                                       ▼
                              extension.js HTTP server ──postMessage──▶ media/panel.html
```

1. On activation, `extension.js` opens an HTTP server on `127.0.0.1:53210`
   (auto-increments up to +20 if the port is busy) and **injects environment
   variables into newly-created terminals** via
   `context.environmentVariableCollection`: `MPLBACKEND`, `VSCODE_PLOTS_PORT`,
   `VSCODE_PLOTS_DPI`, `VSCODE_PLOTS_ANIM_DPI`, `VSCODE_PLOTS_ANIM_MAX_FRAMES`,
   and prepends `python/` to `PYTHONPATH`.
2. **Gotcha (the #1 support issue):** only terminals opened *after* activation
   get these vars. Existing terminals, or Python run outside VS Code, use the
   normal matplotlib backend. Tell users to open a fresh terminal.
3. `plt.show()` calls `_BackendVSCodeSpyderPlots.show()`, which renders each
   open figure, POSTs a JSON payload to `/figure`, then `Gcf.destroy_all()` —
   figures are consumed like Spyder's inline mode. It never blocks.

### The `/figure` JSON payload (the wire format)

A single payload carries multiple representations; the server validates that at
least one of `plotly` / `svg` / `png` / `frames` is present
(`extension.js:addFigure`). The Python side decides per figure
(`vscode_spyder_plots_backend.py` `show()`):

- **Animation** detected for the figure → `{frames:[png b64...], interval}`,
  and nothing else. Animations are found by monkey-patching
  `matplotlib.animation.Animation.__init__` to register weakrefs, then matched
  to a figure via `anim._fig`.
- **Static figure** → tries `convert_figure()` (Plotly spec, the preferred
  interactive render). Render priority is **plotly → svg → png**; `png` is
  *always* generated as the save/last-resort format. `pgf` (LaTeX PGF/TikZ) is
  attached when derivable.
- Fallback rules: Plotly spec is `None` (→ SVG) if the figure has unsupported
  artists or > `_MAX_POINTS` (500k). SVG is dropped (→ PNG) if > 8 MB.

### `python/_mpl_to_plotly.py` — the matplotlib→Plotly converter

`convert_figure(fig)` returns a `{data, layout}` Plotly spec or `None`.
Supported artists: `Line2D`, `PathCollection` (scatter), `BarContainer`,
`AxesImage` (imshow), `QuadMesh` (pcolormesh), plus subplots/log scales/limits/
grids/legends/colormaps. **Anything else returns `None` and the backend falls
back to SVG** — this is the deliberate correctness boundary. Date axes
(→ Plotly `type:'date'`), legend position (matplotlib `loc`), and `twinx`
(secondary Y overlay) are handled. Remaining gaps (fill_between, errorbar,
contour, quiver, 3D, pie, polar, user `text()`/`annotate()`, `twiny`,
boxplot-as-Line2D, `bbox_to_anchor` legends) are documented in README.md
"Limites connues". Assertion tests for the converter live in
`test/test_convert.py` (`unittest`, run `python test/test_convert.py`); the
visual `test_stress.py` complements them. When adding artist support, add a
`test_convert.py` case and update README's gap list.

### `media/panel.html` — the webview UI

The panel UI lives here (Plotly.js is bundled as `media/plotly.min.js`, no
network access). `extension.js:webviewHtml()` reads it and substitutes
`{{nonce}}`, `{{cspSource}}`, `{{plotlyUri}}`. If `panel.html` is missing it
returns a minimal error page (the old duplicated inline UI was removed) — so
`panel.html` is the single source of truth for the UI.

The **Copier** button copies the figure image to the clipboard from the webview:
`navigator.clipboard.write([new ClipboardItem({'image/png': blob})])`, where the
blob is built by decoding base64 directly (`atob` → `Blob`, *not* `fetch` — the
webview CSP has no `connect-src`). Plotly figures go through `Plotly.toImage`.
Success/failure posts `copied`/`copyFailed` back to the extension for a toast.

Webview ⇄ extension message protocol (`postMessage`):
- extension → webview: `add`, `remove`, `reset`, `tags`, `exportPlotly`
- webview → extension: `ready`, `save`, `delete`, `deleteAll`, `saveAll`,
  `copyPgf`, `savePgf`, `exportResult`, `updateTags`, `editTags`,
  `copied`, `copyFailed`

Plotly export is async: the webview holds the figure, so `saveOne()` for a
Plotly figure posts `exportPlotly` with a `requestId`, and the webview replies
`exportResult` with a data URL written by `finishPlotlyExport`. PNG/SVG/frame
saves are synchronous in the extension (`writeFigure`).

### State & persistence

Figures live in-memory in `extension.js` (`figures[]`, `nextId`) **and are
persisted to disk** by `storage.js`: one JSON file per figure under
`context.storageUri/figures/<id>.json` (per-workspace; falls back to
`globalStorageUri` if no workspace), plus a light index in `workspaceState`
(`spyderPlots.index` = `{nextId, figures:[{id,title,tags,ts}]}`). `activate()`
calls `storage.loadAll()` so figures reappear after a Reload Window;
`addFigure`/`deleteOne`/`deleteAll`/`updateTags` mirror their mutation to
`storage`. The `spyderPlots.maxPersistedFigures` setting (default 200, 0 =
unlimited) evicts the oldest. Persistence is best-effort — any I/O error is
swallowed and never blocks the in-memory display.

The panel uses `retainContextWhenHidden` and a `WebviewPanelSerializer` so it
survives being hidden or detached to another monitor — `ensurePanel` reveals
with `viewColumn: undefined` to avoid yanking a detached panel back.

### Port discovery (env + file fallback)

`extension.js` injects `VSCODE_PLOTS_PORT` into new terminals **and** writes the
active port to `os.tmpdir()/spyder-plots-port.json` on each successful
`listen()`. The backend's `_send_figure` tries the env port first, then falls
back to the file port (re-read each send) if the env one is unreachable — this
survives an extension restart on a new port for terminals opened earlier.
Multi-window caveat: the file is shared (last writer wins); it is only a
fallback, the per-window env injection stays correct.

## Conventions

- No shared module system across the JS/Python halves; the only coupling is the
  `/figure` JSON contract and the `VSCODE_PLOTS_*` env vars. Change one side and
  the other must match.
- The Python backend has **no dependency beyond matplotlib/numpy** — keep it
  that way (it runs in the user's interpreter, which we don't control).
- User-facing strings and config (`package.json` `contributes.configuration`,
  prefix `spyderPlots.*`) are French.
