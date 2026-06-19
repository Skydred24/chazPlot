# ============================================================
# vscode_spyder_plots_backend.py — v3 (figures + animations)
#
# Backend matplotlib qui envoie le contenu de plt.show() vers le
# panneau VS Code de l'extension.
#
# Figures statiques : envoyees en plusieurs formats
#     - "plotly" : graphe interactif (priorite, vectoriel)
#     - "pgf"    : code LaTeX PGF/TikZ copiable dans un document
#     - "svg"    : vectoriel (fallback affichage, net a toute taille)
#     - "png"    : haute resolution (sauvegarde + dernier fallback)
#
# Animations (FuncAnimation / ArtistAnimation) : detectees
# automatiquement. Toutes les frames sont rendues en PNG et
# envoyees ensemble ("frames" + "interval") pour etre rejouees
# dans le panneau (play/pause, navigation frame par frame...).
# ============================================================

import base64
import io
import json
import os
import sys
import weakref
import urllib.request
import urllib.error

from matplotlib.backend_bases import _Backend, FigureManagerBase
from matplotlib.backends.backend_agg import FigureCanvasAgg
from matplotlib._pylab_helpers import Gcf

_WARNED = False
_PGF_WARNED = False
_SVG_MAX_BYTES = 8 * 1024 * 1024  # au-dela : fallback PNG pour l'affichage
_PGF_MAX_TABLE_POINTS = 80000      # garde-fou pour les tables pgfplots compactes

# Animations vivantes, enregistrees a leur creation (cf. _install_animation_hook)
_ANIMATIONS = []
def _anim_max_frames():
    """Plafond de frames capturees par animation (garde-fou memoire).
    Reglable via VSCODE_PLOTS_ANIM_MAX_FRAMES ; 0 (ou negatif) = illimite."""
    try:
        value = int(float(os.environ.get("VSCODE_PLOTS_ANIM_MAX_FRAMES", "600")))
    except ValueError:
        value = 600
    return value if value > 0 else None  # None -> illimite


def _port():
    return os.environ.get("VSCODE_PLOTS_PORT", "53210")


def _port_file_path():
    import tempfile
    return os.path.join(tempfile.gettempdir(), "spyder-plots-port.json")


def _port_from_file():
    """Port actif ecrit par l'extension (fallback si l'env est perime)."""
    try:
        with open(_port_file_path(), "r", encoding="utf-8") as handle:
            data = json.load(handle)
        return str(int(data.get("port")))
    except Exception:
        return None


def _dpi():
    try:
        return float(os.environ.get("VSCODE_PLOTS_DPI", "200"))
    except ValueError:
        return 200.0


def _anim_dpi():
    """DPI utilise pour les frames d'animation (plus leger que le statique,
    car multiplie par le nombre de frames). Reglable via VSCODE_PLOTS_ANIM_DPI."""
    try:
        return float(os.environ.get("VSCODE_PLOTS_ANIM_DPI", "130"))
    except ValueError:
        return 130.0


# ------------------------------------------------------------
# Detection des animations
# ------------------------------------------------------------
def _install_animation_hook():
    """Enregistre chaque Animation creee, pour pouvoir la retrouver
    depuis sa figure lors du plt.show()."""
    try:
        import matplotlib.animation as manimation
    except Exception:
        return
    if getattr(manimation.Animation, "_spyder_plots_hooked", False):
        return
    original_init = manimation.Animation.__init__

    def patched_init(self, *args, **kwargs):
        original_init(self, *args, **kwargs)
        try:
            _ANIMATIONS.append(weakref.ref(self))
        except Exception:
            pass

    patched_init._spyder_plots_hooked = True
    manimation.Animation.__init__ = patched_init
    manimation.Animation._spyder_plots_hooked = True


def _animations_for_figure(figure):
    """Animations encore vivantes attachees a cette figure."""
    alive = []
    found = []
    for ref in _ANIMATIONS:
        anim = ref()
        if anim is None:
            continue
        alive.append(ref)
        if getattr(anim, "_fig", None) is figure:
            found.append(anim)
    _ANIMATIONS[:] = alive
    return found


def _make_frame_collector(fps, dpi):
    """Construit un writer (sous-classe de l'API publique AbstractMovieWriter)
    qui, au lieu d'ecrire une video, capture chaque frame en PNG base64."""
    import matplotlib.animation as manimation

    class _FrameCollector(manimation.AbstractMovieWriter):
        def __init__(self):
            super().__init__(fps=fps)
            self._dpi = dpi
            self._fig = None
            self.frames = []

        def setup(self, fig, outfile=None, dpi=None, *args, **kwargs):
            self._fig = fig
            if dpi:
                self._dpi = dpi

        def grab_frame(self, **savefig_kwargs):
            if self._fig is None:
                return
            # matplotlib injecte deja facecolor/bbox dans savefig_kwargs selon
            # la version : on respecte ces valeurs et on ne les ecrase pas.
            savefig_kwargs.pop("dpi", None)
            savefig_kwargs.pop("bbox_inches", None)
            savefig_kwargs.setdefault("facecolor", self._fig.get_facecolor())
            savefig_kwargs.setdefault("edgecolor", "none")
            buffer = io.BytesIO()
            self._fig.savefig(buffer, format="png", dpi=self._dpi, **savefig_kwargs)
            self.frames.append(base64.b64encode(buffer.getvalue()).decode("ascii"))

        def finish(self):
            pass

    return _FrameCollector()


def _capture_animation(anim):
    """Capture toutes les frames d'une animation. Retourne (frames, interval_ms)
    ou (None, None) en cas d'echec."""
    interval = getattr(anim, "_interval", None) or 200
    try:
        interval = float(interval)
    except (TypeError, ValueError):
        interval = 200.0
    fps = max(1000.0 / max(interval, 1.0), 1.0)

    collector = _make_frame_collector(fps=fps, dpi=_anim_dpi())
    try:
        anim.save("__spyder_plots__.png", writer=collector, dpi=_anim_dpi())
    except Exception as error:
        sys.stderr.write("[spyder-plots] Echec de capture de l'animation : " + str(error) + "\n")
        return None, None

    frames = collector.frames
    if not frames:
        return None, None
    cap = _anim_max_frames()
    if cap is not None and len(frames) > cap:
        frames = frames[:cap]
        sys.stderr.write(
            "[spyder-plots] Animation tronquee a "
            + str(cap)
            + " frames (reglez spyderPlots.animationMaxFrames, 0 = illimite).\n"
        )
    return frames, interval


# ------------------------------------------------------------
# Envoi reseau
# ------------------------------------------------------------
def _send_figure(payload):
    """Envoie une figure (ou une animation) au serveur local de l'extension.

    Essaie d'abord le port de l'environnement, puis le port lu dans le fichier
    temporaire ecrit par l'extension (fallback si l'env est perime apres un
    redemarrage de l'extension sur un autre port)."""
    global _WARNED
    body = json.dumps(payload).encode("utf-8")
    candidates = [_port()]
    file_port = _port_from_file()
    if file_port is not None and file_port not in candidates:
        candidates.append(file_port)

    for port in candidates:
        url = "http://127.0.0.1:" + port + "/figure"
        request = urllib.request.Request(
            url,
            data=body,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            urllib.request.urlopen(request, timeout=15.0)
            return True
        except (urllib.error.URLError, OSError):
            continue

    if not _WARNED:
        _WARNED = True
        sys.stderr.write(
            "[spyder-plots] Impossible de joindre l'extension VS Code sur le port "
            + _port()
            + ". Verifiez que l'extension est active, puis ouvrez un NOUVEAU terminal.\n"
        )
    return False


def _figure_title(manager):
    title = None
    try:
        title = manager.get_window_title()
    except Exception:
        title = None
    if title is None or title == "":
        title = "Figure " + str(manager.num)
    return title


def _render(figure, file_format, dpi):
    """Rend la figure dans le format demande, retourne les octets (ou None)."""
    buffer = io.BytesIO()
    try:
        figure.savefig(
            buffer,
            format=file_format,
            dpi=dpi,
            bbox_inches="tight",
            facecolor=figure.get_facecolor(),
            edgecolor="none",
        )
    except Exception as error:
        sys.stderr.write(
            "[spyder-plots] Echec du rendu " + file_format + " : " + str(error) + "\n"
        )
        return None
    return buffer.getvalue()


def _render_pgf(figure):
    """Rend la figure en code PGF/TikZ LaTeX, retourne les octets (ou None).

    Le backend PGF de matplotlib peut necessiter une installation LaTeX pour
    mesurer certains textes. Si elle n'est pas disponible, l'extension continue
    simplement sans bouton PGF pour cette figure.
    """
    global _PGF_WARNED
    buffer = io.BytesIO()
    try:
        figure.savefig(
            buffer,
            format="pgf",
            bbox_inches="tight",
            facecolor=figure.get_facecolor(),
            edgecolor="none",
        )
    except Exception as error:
        if not _PGF_WARNED:
            _PGF_WARNED = True
            sys.stderr.write(
                "[spyder-plots] Export PGF/TikZ indisponible : " + str(error) + "\n"
            )
        return None
    return buffer.getvalue()


def _latex_escape(text):
    replacements = {
        "\\": "\\textbackslash{}",
        "&": "\\&",
        "%": "\\%",
        "$": "\\$",
        "#": "\\#",
        "_": "\\_",
        "{": "\\{",
        "}": "\\}",
        "~": "\\textasciitilde{}",
        "^": "\\textasciicircum{}",
    }
    return "".join(replacements.get(ch, ch) for ch in str(text))


def _pgf_number(value):
    try:
        f = float(value)
    except (TypeError, ValueError):
        return None
    if f != f or f in (float("inf"), float("-inf")):
        return None
    return ("%.12g" % f)


def _pgf_color_options(color):
    if not isinstance(color, str):
        return []
    text = color.strip()
    rgb = None
    alpha = None

    if text.startswith("#") and len(text) in (7, 9):
        try:
            rgb = [int(text[1:3], 16), int(text[3:5], 16), int(text[5:7], 16)]
            if len(text) == 9:
                alpha = int(text[7:9], 16) / 255.0
        except ValueError:
            rgb = None
    elif text.startswith("rgb"):
        start = text.find("(")
        end = text.rfind(")")
        if start != -1 and end != -1 and end > start:
            parts = [p.strip() for p in text[start + 1:end].split(",")]
            if len(parts) >= 3:
                try:
                    rgb = [int(round(float(parts[0]))), int(round(float(parts[1]))), int(round(float(parts[2])))]
                    if len(parts) >= 4:
                        alpha = float(parts[3])
                except ValueError:
                    rgb = None

    if rgb is None:
        return []
    rgb = [max(0, min(255, value)) for value in rgb]
    options = [
        "color={rgb,255:red,%d;green,%d;blue,%d}" % (rgb[0], rgb[1], rgb[2])
    ]
    if alpha is not None and alpha < 1.0:
        options.append("opacity=" + _pgf_number(alpha))
    return options


def _pgf_color_options_from_rgba(rgba):
    try:
        r = int(round(float(rgba[0]) * 255))
        g = int(round(float(rgba[1]) * 255))
        b = int(round(float(rgba[2]) * 255))
        a = float(rgba[3]) if len(rgba) > 3 else 1.0
    except (TypeError, ValueError, IndexError):
        return []
    options = [
        "color={rgb,255:red,%d;green,%d;blue,%d}" % (
            max(0, min(255, r)),
            max(0, min(255, g)),
            max(0, min(255, b)),
        )
    ]
    if a < 1.0:
        options.append("opacity=" + _pgf_number(a))
    return options


def _mpl_color_options(color):
    try:
        import matplotlib.colors as mcolors
        return _pgf_color_options_from_rgba(mcolors.to_rgba(color))
    except Exception:
        return _pgf_color_options(color)


def _pgf_line_style_options(trace):
    line = trace.get("line")
    if not isinstance(line, dict):
        line = {}
    options = []
    options.extend(_pgf_color_options(line.get("color")))

    width = _pgf_number(line.get("width"))
    if width is not None:
        options.append("line width=" + width + "pt")

    dash = line.get("dash")
    if dash in ("dash", "dashed"):
        options.append("dashed")
    elif dash in ("dot", "dotted"):
        options.append("dotted")
    elif dash in ("dashdot", "dash dot"):
        options.append("dash pattern=on 4pt off 2pt on 1pt off 2pt")
    return options


def _mpl_line_style_options(line):
    options = []
    try:
        options.extend(_mpl_color_options(line.get_color()))
    except Exception:
        pass
    try:
        width = _pgf_number(line.get_linewidth())
        if width is not None:
            options.append("line width=" + width + "pt")
    except Exception:
        pass
    try:
        linestyle = line.get_linestyle()
    except Exception:
        linestyle = "-"
    if linestyle in ("--", "dashed"):
        options.append("dashed")
    elif linestyle in (":", "dotted"):
        options.append("dotted")
    elif linestyle in ("-.", "dashdot"):
        options.append("dash pattern=on 4pt off 2pt on 1pt off 2pt")
    try:
        marker = line.get_marker()
    except Exception:
        marker = None
    if marker in (None, "", "None", "none", " "):
        options.append("mark=none")
    else:
        options.append("mark=*")
    return options


def _pgf_colormap_option(cmap):
    if cmap is None:
        return None
    name = "spyderplots" + "".join(ch for ch in str(getattr(cmap, "name", "cmap")) if ch.isalnum())
    samples = []
    for index in range(9):
        try:
            r, g, b, _a = cmap(index / 8.0)
        except Exception:
            return None
        samples.append(
            "rgb255=(%d,%d,%d)" % (
                int(round(r * 255)),
                int(round(g * 255)),
                int(round(b * 255)),
            )
        )
    return "colormap={" + name + "}{" + " ".join(samples) + "}"


def _plotly_axis_layout(layout, key):
    axis = layout.get(key)
    if isinstance(axis, dict):
        return axis
    return {}


def _plotly_axis_title(axis):
    title = axis.get("title")
    if isinstance(title, dict):
        return title.get("text", "")
    if isinstance(title, str):
        return title
    return ""


def _plotly_to_pgfplots(plotly_spec, title):
    """Fallback LaTeX pur sans installation LaTeX.

    Convertit les traces Plotly simples (courbes/nuages 2D) en pgfplots.
    C'est moins fidele que le PGF natif de matplotlib, mais les polices et
    tailles seront celles du document LaTeX final.
    """
    if not isinstance(plotly_spec, dict):
        return None
    data = plotly_spec.get("data")
    if not isinstance(data, list) or len(data) == 0:
        return None

    layout = plotly_spec.get("layout")
    if not isinstance(layout, dict):
        layout = {}

    axis_x = _plotly_axis_layout(layout, "xaxis")
    axis_y = _plotly_axis_layout(layout, "yaxis")
    axis_options = [
        "width=\\linewidth",
        "height=0.62\\linewidth",
        "grid=both",
        "legend style={draw=none, fill=none}",
        "legend pos=north east",
    ]
    xlabel = _plotly_axis_title(axis_x)
    ylabel = _plotly_axis_title(axis_y)
    if xlabel:
        axis_options.append("xlabel={" + _latex_escape(xlabel) + "}")
    if ylabel:
        axis_options.append("ylabel={" + _latex_escape(ylabel) + "}")
    if axis_x.get("type") == "log":
        axis_options.append("xmode=log")
    if axis_y.get("type") == "log":
        axis_options.append("ymode=log")

    lines = [
        "% Generated by Spyder Plots.",
        "% Requires: \\usepackage{pgfplots}",
        "% Optional: \\pgfplotsset{compat=1.18}",
        "\\begin{tikzpicture}",
        "\\begin{axis}[",
    ]
    lines.extend("  " + option + "," for option in axis_options)
    lines.append("]")

    plotted = 0
    for trace in data:
        if not isinstance(trace, dict):
            continue
        trace_type = trace.get("type", "scatter")
        if trace_type != "scatter":
            continue
        if trace.get("xaxis") not in (None, "x") or trace.get("yaxis") not in (None, "y"):
            continue
        xs = trace.get("x")
        ys = trace.get("y")
        if not isinstance(xs, list) or not isinstance(ys, list):
            continue
        n = min(len(xs), len(ys))
        coords = []
        for idx in range(n):
            x = _pgf_number(xs[idx])
            y = _pgf_number(ys[idx])
            if x is not None and y is not None:
                coords.append("(" + x + "," + y + ")")
        if len(coords) == 0:
            continue

        mode = trace.get("mode", "lines")
        style = _pgf_line_style_options(trace)
        if "lines" not in mode:
            style.append("only marks")
        if "markers" not in mode:
            style.append("mark=none")
        style_text = "[" + ", ".join(style) + "]" if style else ""
        lines.append("\\addplot+" + style_text + " coordinates {")
        lines.extend("  " + coord for coord in coords)
        lines.append("};")

        name = trace.get("name")
        if isinstance(name, str) and name:
            lines.append("\\addlegendentry{" + _latex_escape(name) + "}")
        plotted += 1

    if plotted == 0:
        return None

    if title:
        lines.insert(3, "% Source figure: " + _latex_escape(title))
    lines.append("\\end{axis}")
    lines.append("\\end{tikzpicture}")
    lines.append("")
    return "\n".join(lines).encode("utf-8")


def _is_3d_axis(ax):
    return getattr(ax, "name", "") == "3d" or hasattr(ax, "get_zlim")


def _axis_has_exportable_content(ax):
    if len(ax.get_lines()) > 0:
        return True
    if len(getattr(ax, "collections", [])) > 0:
        return True
    if len(getattr(ax, "images", [])) > 0:
        return True
    if len(getattr(ax, "containers", [])) > 0:
        return True
    if len(getattr(ax, "texts", [])) > 0:
        return True
    return False


def _ordered_axes_grid(axes):
    def center(pos):
        return ((float(pos.x0) + float(pos.x1)) / 2.0, (float(pos.y0) + float(pos.y1)) / 2.0)

    centers = [center(ax.get_position()) for ax in axes]

    def unique_sorted(values, reverse=False):
        out = []
        for value in sorted(values, reverse=reverse):
            if not any(abs(value - known) < 0.03 for known in out):
                out.append(value)
        return out

    cols = unique_sorted([c[0] for c in centers])
    rows = unique_sorted([c[1] for c in centers], reverse=True)

    def nearest_index(value, values):
        best = 0
        best_dist = None
        for idx, known in enumerate(values):
            dist = abs(value - known)
            if best_dist is None or dist < best_dist:
                best = idx
                best_dist = dist
        return best

    keyed = []
    for ax, (cx, cy) in zip(axes, centers):
        keyed.append((nearest_index(cy, rows), nearest_index(cx, cols), ax))
    keyed.sort(key=lambda item: (item[0], item[1]))
    return len(rows), len(cols), [item[2] for item in keyed]


def _axis_numeric_range(getter):
    try:
        lo, hi = getter()
    except Exception:
        return []
    lo_text = _pgf_number(lo)
    hi_text = _pgf_number(hi)
    if lo_text is None or hi_text is None:
        return []
    return lo_text, hi_text


def _axis_text_option(name, value):
    if value:
        return name + "={" + _latex_escape(value) + "}"
    return None


def _axis_base_options(ax, is_3d, nrows, ncols, has_colorbar, cmap):
    if nrows == 1 and ncols == 1:
        width = "\\linewidth"
        height = "0.62\\linewidth"
    else:
        width = ("%.3f\\linewidth" % max(0.22, 0.92 / max(ncols, 1)))
        height = ("%.3f\\linewidth" % max(0.20, 0.55 / max(ncols, 1)))

    options = [
        "width=" + width,
        "height=" + height,
        "grid=both",
    ]

    for item in (
        _axis_text_option("title", ax.get_title()),
        _axis_text_option("xlabel", ax.get_xlabel()),
        _axis_text_option("ylabel", ax.get_ylabel()),
    ):
        if item:
            options.append(item)

    if is_3d:
        try:
            zlabel = ax.get_zlabel()
        except Exception:
            zlabel = ""
        zitem = _axis_text_option("zlabel", zlabel)
        if zitem:
            options.append(zitem)
        elev = _pgf_number(getattr(ax, "elev", 30))
        azim = _pgf_number(getattr(ax, "azim", -60))
        if elev is not None and azim is not None:
            options.append("view={" + azim + "}{" + elev + "}")

    try:
        if ax.get_xscale() == "log":
            options.append("xmode=log")
    except Exception:
        pass
    try:
        if ax.get_yscale() == "log":
            options.append("ymode=log")
    except Exception:
        pass

    x_range = _axis_numeric_range(ax.get_xlim)
    y_range = _axis_numeric_range(ax.get_ylim)
    if x_range:
        options.extend(["xmin=" + x_range[0], "xmax=" + x_range[1]])
    if y_range:
        options.extend(["ymin=" + y_range[0], "ymax=" + y_range[1]])
    if is_3d:
        z_range = _axis_numeric_range(ax.get_zlim)
        if z_range:
            options.extend(["zmin=" + z_range[0], "zmax=" + z_range[1]])

    if has_colorbar:
        options.append("colorbar")
    cmap_option = _pgf_colormap_option(cmap)
    if cmap_option:
        options.append(cmap_option)
    return options


def _format_axis_open(command, options):
    lines = [command + "["]
    lines.extend("  " + option + "," for option in options)
    lines.append("]")
    return lines


def _line_xy_for_export(ax, line):
    try:
        import numpy as np
        x = np.asarray(line.get_xdata(), dtype=float)
        y = np.asarray(line.get_ydata(), dtype=float)
    except Exception:
        return None, None
    if x.size == 2 and y.size == 2:
        if abs(x[0] - x[1]) < 1e-14 and abs(y[0]) < 1e-14 and abs(y[1] - 1.0) < 1e-14:
            try:
                y = np.asarray(ax.get_ylim(), dtype=float)
            except Exception:
                pass
        if abs(y[0] - y[1]) < 1e-14 and abs(x[0]) < 1e-14 and abs(x[1] - 1.0) < 1e-14:
            try:
                x = np.asarray(ax.get_xlim(), dtype=float)
            except Exception:
                pass
    return x, y


def _downsample_indices(length, max_points):
    if length <= max_points:
        return None
    try:
        import numpy as np
        return np.linspace(0, length - 1, max_points).astype(int)
    except Exception:
        return None


def _append_line2d(lines, ax, line):
    x, y = _line_xy_for_export(ax, line)
    if x is None or y is None or x.size == 0 or y.size == 0:
        return 0
    count = min(int(x.size), int(y.size))
    idx = _downsample_indices(count, _PGF_MAX_TABLE_POINTS)
    if idx is None:
        iterable = range(count)
    else:
        iterable = idx
    coords = []
    for item in iterable:
        x_text = _pgf_number(x[item])
        y_text = _pgf_number(y[item])
        if x_text is not None and y_text is not None:
            coords.append("(" + x_text + "," + y_text + ")")
    if len(coords) == 0:
        return 0
    style = _mpl_line_style_options(line)
    lines.append("\\addplot+[" + ", ".join(style) + "] coordinates {")
    lines.extend("  " + coord for coord in coords)
    lines.append("};")
    try:
        label = line.get_label()
    except Exception:
        label = ""
    if isinstance(label, str) and label and not label.startswith("_"):
        lines.append("\\addlegendentry{" + _latex_escape(label) + "}")
    return 1


def _append_line3d(lines, line):
    try:
        xs, ys, zs = line.get_data_3d()
        import numpy as np
        xs = np.asarray(xs, dtype=float)
        ys = np.asarray(ys, dtype=float)
        zs = np.asarray(zs, dtype=float)
    except Exception:
        return 0
    count = min(int(xs.size), int(ys.size), int(zs.size))
    if count == 0:
        return 0
    idx = _downsample_indices(count, _PGF_MAX_TABLE_POINTS)
    iterable = range(count) if idx is None else idx
    coords = []
    for item in iterable:
        x_text = _pgf_number(xs[item])
        y_text = _pgf_number(ys[item])
        z_text = _pgf_number(zs[item])
        if x_text is not None and y_text is not None and z_text is not None:
            coords.append("(" + x_text + "," + y_text + "," + z_text + ")")
    if len(coords) == 0:
        return 0
    style = _mpl_line_style_options(line)
    lines.append("\\addplot3+[" + ", ".join(style) + "] coordinates {")
    lines.extend("  " + coord for coord in coords)
    lines.append("};")
    return 1


def _append_scatter2d(lines, collection):
    if "PathCollection" not in collection.__class__.__name__:
        return 0
    try:
        import numpy as np
        offsets = np.asarray(collection.get_offsets(), dtype=float)
    except Exception:
        return 0
    if offsets.ndim != 2 or offsets.shape[0] == 0 or offsets.shape[1] < 2:
        return 0
    count = int(offsets.shape[0])
    idx = _downsample_indices(count, _PGF_MAX_TABLE_POINTS)
    iterable = range(count) if idx is None else idx
    style = ["only marks", "mark=*"]
    try:
        colors = collection.get_facecolor()
        if len(colors) > 0:
            style.extend(_pgf_color_options_from_rgba(colors[0]))
    except Exception:
        pass
    coords = []
    for item in iterable:
        x_text = _pgf_number(offsets[item, 0])
        y_text = _pgf_number(offsets[item, 1])
        if x_text is not None and y_text is not None:
            coords.append("(" + x_text + "," + y_text + ")")
    if len(coords) == 0:
        return 0
    lines.append("\\addplot+[" + ", ".join(style) + "] coordinates {")
    lines.extend("  " + coord for coord in coords)
    lines.append("};")
    return 1


def _append_path_lines2d(lines, collection):
    try:
        import numpy as np
        paths = collection.get_paths()
    except Exception:
        return 0
    if not paths:
        return 0
    style = ["mark=none"]
    try:
        edgecolors = collection.get_edgecolor()
        if len(edgecolors) > 0:
            style.extend(_pgf_color_options_from_rgba(edgecolors[0]))
    except Exception:
        pass
    try:
        widths = collection.get_linewidths()
        if len(widths) > 0:
            width = _pgf_number(widths[0])
            if width is not None:
                style.append("line width=" + width + "pt")
    except Exception:
        pass
    plotted = 0
    for path in paths:
        try:
            vertices = np.asarray(path.vertices, dtype=float)
        except Exception:
            continue
        if vertices.ndim != 2 or vertices.shape[0] < 2 or vertices.shape[1] < 2:
            continue
        count = int(vertices.shape[0])
        idx = _downsample_indices(count, _PGF_MAX_TABLE_POINTS)
        iterable = range(count) if idx is None else idx
        coords = []
        for item in iterable:
            x_text = _pgf_number(vertices[item, 0])
            y_text = _pgf_number(vertices[item, 1])
            if x_text is not None and y_text is not None:
                coords.append("(" + x_text + "," + y_text + ")")
        if len(coords) < 2:
            continue
        lines.append("\\addplot+[" + ", ".join(style) + "] coordinates {")
        lines.extend("  " + coord for coord in coords)
        lines.append("};")
        plotted += 1
    return plotted


def _append_scatter3d(lines, collection):
    if not hasattr(collection, "_offsets3d"):
        return 0
    try:
        import numpy as np
        xs, ys, zs = collection._offsets3d
        xs = np.asarray(xs, dtype=float)
        ys = np.asarray(ys, dtype=float)
        zs = np.asarray(zs, dtype=float)
    except Exception:
        return 0
    count = min(int(xs.size), int(ys.size), int(zs.size))
    if count == 0:
        return 0
    idx = _downsample_indices(count, _PGF_MAX_TABLE_POINTS)
    iterable = range(count) if idx is None else idx
    style = ["only marks", "mark=*"]
    coords = []
    for item in iterable:
        x_text = _pgf_number(xs[item])
        y_text = _pgf_number(ys[item])
        z_text = _pgf_number(zs[item])
        if x_text is not None and y_text is not None and z_text is not None:
            coords.append("(" + x_text + "," + y_text + "," + z_text + ")")
    if len(coords) == 0:
        return 0
    lines.append("\\addplot3+[" + ", ".join(style) + "] coordinates {")
    lines.extend("  " + coord for coord in coords)
    lines.append("};")
    return 1


def _append_bars(lines, container):
    try:
        from matplotlib.patches import Rectangle
    except Exception:
        return 0
    rects = [p for p in container.patches if isinstance(p, Rectangle)]
    if len(rects) == 0:
        return 0
    orientation = getattr(container, "orientation", "vertical")
    coords = []
    style = ["xbar" if orientation == "horizontal" else "ybar"]
    try:
        style.extend(_pgf_color_options_from_rgba(rects[0].get_facecolor()))
    except Exception:
        pass
    for rect in rects:
        if orientation == "horizontal":
            x = rect.get_width()
            y = rect.get_y() + rect.get_height() / 2.0
        else:
            x = rect.get_x() + rect.get_width() / 2.0
            y = rect.get_height()
        x_text = _pgf_number(x)
        y_text = _pgf_number(y)
        if x_text is not None and y_text is not None:
            coords.append("(" + x_text + "," + y_text + ")")
    if len(coords) == 0:
        return 0
    lines.append("\\addplot+[" + ", ".join(style) + "] coordinates {")
    lines.extend("  " + coord for coord in coords)
    lines.append("};")
    return 1


def _grid_stride(rows, cols):
    total = max(rows, 1) * max(cols, 1)
    if total <= _PGF_MAX_TABLE_POINTS:
        return 1, 1
    import math
    factor = math.sqrt(float(total) / float(_PGF_MAX_TABLE_POINTS))
    step = max(1, int(math.ceil(factor)))
    return step, step


def _append_heatmap_table(lines, x_values, y_values, z_values):
    try:
        import numpy as np
        x_values = np.asarray(x_values, dtype=float)
        y_values = np.asarray(y_values, dtype=float)
        z_values = np.asarray(z_values, dtype=float)
    except Exception:
        return 0
    if z_values.ndim != 2:
        return 0
    rows, cols = z_values.shape
    step_y, step_x = _grid_stride(rows, cols)
    xs = x_values[::step_x]
    ys = y_values[::step_y]
    zs = z_values[::step_y, ::step_x]
    if xs.size == 0 or ys.size == 0:
        return 0
    lines.append("\\addplot[matrix plot*, mesh/cols=" + str(int(xs.size)) + ", point meta=explicit] table [meta=z] {")
    lines.append("x y z")
    for row_index, y in enumerate(ys):
        for col_index, x in enumerate(xs):
            x_text = _pgf_number(x)
            y_text = _pgf_number(y)
            z_text = _pgf_number(zs[row_index, col_index])
            if x_text is not None and y_text is not None and z_text is not None:
                lines.append(x_text + " " + y_text + " " + z_text)
    lines.append("};")
    return 1


def _append_image_heatmap(lines, image):
    try:
        import numpy as np
        data = np.asarray(image.get_array(), dtype=float)
    except Exception:
        return 0
    if data.ndim != 2:
        return 0
    try:
        extent = image.get_extent()
    except Exception:
        extent = (0, data.shape[1] - 1, 0, data.shape[0] - 1)
    x_values = np.linspace(float(extent[0]), float(extent[1]), data.shape[1])
    y_values = np.linspace(float(extent[2]), float(extent[3]), data.shape[0])
    return _append_heatmap_table(lines, x_values, y_values, data)


def _append_quadmesh_heatmap(lines, mesh):
    try:
        import numpy as np
        coords = np.asarray(mesh.get_coordinates(), dtype=float)
        z = np.asarray(mesh.get_array(), dtype=float)
    except Exception:
        return 0
    if coords.ndim != 3 or coords.shape[2] < 2:
        return 0
    rows = coords.shape[0] - 1
    cols = coords.shape[1] - 1
    if rows <= 0 or cols <= 0:
        return 0
    if z.ndim == 1:
        try:
            z = z.reshape(rows, cols)
        except Exception:
            return 0
    x_edges = coords[0, :, 0]
    y_edges = coords[:, 0, 1]
    x_centers = 0.5 * (x_edges[:-1] + x_edges[1:])
    y_centers = 0.5 * (y_edges[:-1] + y_edges[1:])
    return _append_heatmap_table(lines, x_centers, y_centers, z)


def _surface_grid_from_collection(collection):
    vec = getattr(collection, "_vec", None)
    if vec is None:
        return None
    try:
        import numpy as np
        arr = np.asarray(vec, dtype=float)
    except Exception:
        return None
    if arr.ndim != 2 or arr.shape[0] < 3 or arr.shape[1] == 0:
        return None
    points = arr[:3, :].T
    data = {}
    for x, y, z in points:
        if not (np.isfinite(x) and np.isfinite(y) and np.isfinite(z)):
            continue
        key = (round(float(x), 12), round(float(y), 12))
        data[key] = float(z)
    if len(data) < 4:
        return None
    xs = sorted(set(key[0] for key in data))
    ys = sorted(set(key[1] for key in data))
    if len(xs) < 2 or len(ys) < 2:
        return None
    expected = len(xs) * len(ys)
    if len(data) < max(4, int(expected * 0.75)):
        return None
    rows = []
    for y in ys:
        row = []
        for x in xs:
            value = data.get((x, y))
            if value is None:
                return None
            row.append(value)
        rows.append(row)
    return xs, ys, rows


def _append_surface3d(lines, collection):
    grid = _surface_grid_from_collection(collection)
    if grid is None:
        return 0
    xs, ys, z_rows = grid
    rows = len(ys)
    cols = len(xs)
    step_y, step_x = _grid_stride(rows, cols)
    xs = xs[::step_x]
    ys = ys[::step_y]
    z_rows = [row[::step_x] for row in z_rows[::step_y]]
    lines.append("\\addplot3[surf, shader=interp, mesh/rows=" + str(len(ys)) + "] coordinates {")
    for row_index, y in enumerate(ys):
        for col_index, x in enumerate(xs):
            x_text = _pgf_number(x)
            y_text = _pgf_number(y)
            z_text = _pgf_number(z_rows[row_index][col_index])
            if x_text is not None and y_text is not None and z_text is not None:
                lines.append("  (" + x_text + "," + y_text + "," + z_text + ")")
        lines.append("")
    lines.append("};")
    return 1


def _text_coord_prefix(ax, text):
    try:
        if text.get_transform() == ax.transAxes:
            return "rel axis cs"
    except Exception:
        pass
    return "axis cs"


def _append_axis_texts(lines, ax):
    try:
        from matplotlib.text import Annotation
    except Exception:
        Annotation = None
    count = 0
    for text in getattr(ax, "texts", []):
        try:
            label = text.get_text()
        except Exception:
            label = ""
        if not label:
            continue
        try:
            x, y = text.get_position()
        except Exception:
            continue
        prefix = _text_coord_prefix(ax, text)
        x_text = _pgf_number(x)
        y_text = _pgf_number(y)
        if x_text is None or y_text is None:
            continue
        options = ["font=\\small", "align=center"]
        try:
            rotation = _pgf_number(text.get_rotation())
            if rotation is not None and rotation != "0":
                options.append("rotate=" + rotation)
        except Exception:
            pass
        if Annotation is not None and isinstance(text, Annotation):
            try:
                xy = text.xy
                arrow_patch = getattr(text, "arrow_patch", None)
            except Exception:
                xy = None
                arrow_patch = None
            if xy is not None and arrow_patch is not None:
                x0 = _pgf_number(x)
                y0 = _pgf_number(y)
                x1 = _pgf_number(xy[0])
                y1 = _pgf_number(xy[1])
                if x0 is not None and y0 is not None and x1 is not None and y1 is not None:
                    lines.append("\\draw[->] (" + prefix + ":" + x0 + "," + y0 + ") -- (axis cs:" + x1 + "," + y1 + ");")
        lines.append("\\node[" + ", ".join(options) + "] at (" + prefix + ":" + x_text + "," + y_text + ") {" + _latex_escape(label) + "};")
        count += 1
    return count


def _axis_colormap_hint(ax):
    for image in getattr(ax, "images", []):
        try:
            if getattr(image.get_array(), "ndim", 0) == 2:
                return image.get_cmap()
        except Exception:
            pass
    for collection in getattr(ax, "collections", []):
        try:
            if collection.get_cmap() is not None:
                return collection.get_cmap()
        except Exception:
            pass
    return None


def _axis_has_colorbar_content(ax):
    for image in getattr(ax, "images", []):
        try:
            if getattr(image.get_array(), "ndim", 0) == 2:
                return True
        except Exception:
            pass
    for collection in getattr(ax, "collections", []):
        if hasattr(collection, "get_coordinates") or hasattr(collection, "_vec"):
            return True
    return False


def _mpl_axis_to_pgfplots(ax, group_mode, nrows, ncols):
    is_3d = _is_3d_axis(ax)
    options = _axis_base_options(
        ax,
        is_3d,
        nrows,
        ncols,
        _axis_has_colorbar_content(ax),
        _axis_colormap_hint(ax),
    )
    if group_mode:
        lines = _format_axis_open("\\nextgroupplot", options)
    else:
        lines = _format_axis_open("\\begin{axis}", options)

    plotted = 0
    if is_3d:
        for line in ax.get_lines():
            plotted += _append_line3d(lines, line)
        for collection in getattr(ax, "collections", []):
            added = _append_surface3d(lines, collection)
            if added == 0:
                added = _append_scatter3d(lines, collection)
            plotted += added
    else:
        for line in ax.get_lines():
            plotted += _append_line2d(lines, ax, line)
        for container in getattr(ax, "containers", []):
            plotted += _append_bars(lines, container)
        for image in getattr(ax, "images", []):
            plotted += _append_image_heatmap(lines, image)
        for collection in getattr(ax, "collections", []):
            if hasattr(collection, "get_coordinates"):
                added = _append_quadmesh_heatmap(lines, collection)
            else:
                added = _append_scatter2d(lines, collection)
                if added == 0:
                    added = _append_path_lines2d(lines, collection)
            plotted += added

    plotted += _append_axis_texts(lines, ax)

    if not group_mode:
        lines.append("\\end{axis}")
    return lines, plotted


def _figure_to_pgfplots(figure, title):
    axes = [
        ax for ax in figure.get_axes()
        if ax.get_label() != "<colorbar>" and _axis_has_exportable_content(ax)
    ]
    if len(axes) == 0:
        return None
    nrows, ncols, ordered_axes = _ordered_axes_grid(axes)
    group_mode = len(ordered_axes) > 1

    lines = [
        "% Generated by Spyder Plots.",
        "% Requires in the document preamble:",
        "% \\usepackage{pgfplots}",
        "% \\pgfplotsset{compat=1.18}",
    ]
    if group_mode:
        lines.append("% \\usepgfplotslibrary{groupplots}")
    if title:
        lines.append("% Source figure: " + _latex_escape(title))
    lines.append("\\begin{tikzpicture}")

    total = 0
    if group_mode:
        lines.append("\\begin{groupplot}[")
        lines.append("  group style={group size=" + str(ncols) + " by " + str(nrows) + ", horizontal sep=1.2cm, vertical sep=1.2cm},")
        lines.append("]")
        for ax in ordered_axes:
            block, plotted = _mpl_axis_to_pgfplots(ax, True, nrows, ncols)
            lines.extend(block)
            total += plotted
        lines.append("\\end{groupplot}")
    else:
        block, plotted = _mpl_axis_to_pgfplots(ordered_axes[0], False, nrows, ncols)
        lines.extend(block)
        total += plotted

    lines.append("\\end{tikzpicture}")
    lines.append("")
    if total == 0:
        return None
    return "\n".join(lines).encode("utf-8")


# ------------------------------------------------------------
# Backend
# ------------------------------------------------------------
@_Backend.export
class _BackendVSCodeSpyderPlots(_Backend):
    FigureCanvas = FigureCanvasAgg
    FigureManager = FigureManagerBase

    @classmethod
    def show(cls, block=None):
        """Appele par plt.show() : envoie toutes les figures ouvertes, en
        rejouant les animations detectees frame par frame. Ne bloque jamais."""
        _install_animation_hook()
        managers = Gcf.get_all_fig_managers()
        if len(managers) == 0:
            return

        for manager in managers:
            figure = manager.canvas.figure
            title = _figure_title(manager)

            # --- 1) animation attachee a cette figure ? ---
            anims = _animations_for_figure(figure)
            if anims:
                frames, interval = _capture_animation(anims[0])
                if frames is not None:
                    _send_figure({
                        "title": title,
                        "frames": frames,
                        "interval": interval,
                    })
                    continue
                # echec de capture -> on retombe sur un rendu statique

            # --- 2) figure statique ---
            plotly_spec = None
            try:
                from _mpl_to_plotly import convert_figure
                plotly_spec = convert_figure(figure)
            except Exception:
                plotly_spec = None

            png_bytes = _render(figure, "png", _dpi())
            svg_bytes = None
            if plotly_spec is None:
                svg_bytes = _render(figure, "svg", _dpi())
                if svg_bytes is not None and len(svg_bytes) > _SVG_MAX_BYTES:
                    svg_bytes = None

            if plotly_spec is None and svg_bytes is None and png_bytes is None:
                continue

            pgf_bytes = _figure_to_pgfplots(figure, title)
            if pgf_bytes is None and plotly_spec is not None:
                pgf_bytes = _plotly_to_pgfplots(plotly_spec, title)
            if pgf_bytes is None:
                pgf_bytes = _render_pgf(figure)

            _send_figure({
                "title": title,
                "plotly": plotly_spec,
                "pgf": base64.b64encode(pgf_bytes).decode("ascii") if pgf_bytes is not None else None,
                "svg": base64.b64encode(svg_bytes).decode("ascii") if svg_bytes is not None else None,
                "png": base64.b64encode(png_bytes).decode("ascii") if png_bytes is not None else None,
            })

        # Comme Spyder : les figures sont consommees par show().
        Gcf.destroy_all()


# Hook installe des l'import du backend (et re-tente a chaque show()).
_install_animation_hook()
