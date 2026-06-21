# ============================================================
# _mpl_to_plotly.py
# Conversion d'une figure matplotlib en specification Plotly
# (data + layout) pour un rendu interactif dans le panneau.
#
# Artistes supportes :
#   - Line2D            (plot, axhline, axvline)
#   - ErrorbarContainer (errorbar : barres X/Y)
#   - PathCollection    (scatter, avec couleurs/tailles/colormap)
#   - PolyCollection    (fill_between, zones remplies)
#   - BarContainer      (bar, barh)
#   - AxesImage         (imshow : 2D -> heatmap, RGB -> image)
#   - QuadMesh          (pcolormesh -> heatmap)
#   - QuadContourSet    (contour/contourf)
#   - Quiver            (quiver -> polygones de fleches)
#   - Text/Annotation   (text, annotate)
# Gere : sous-graphes, titres, labels, limites, echelle log,
#        grille, legendes, colormaps, twinx/twiny, axes polaires simples.
#
# Si la figure contient autre chose (streamplot, patches
# libres complexes, 3D...), convert_figure retourne None et le backend
# retombe sur le rendu SVG. Aucune dependance hors matplotlib.
# ============================================================

import numpy as np
import matplotlib.colors as mcolors
from matplotlib.lines import Line2D
from matplotlib.collections import PathCollection, QuadMesh, PolyCollection
from matplotlib.contour import QuadContourSet
from matplotlib.image import AxesImage
from matplotlib.container import BarContainer, ErrorbarContainer
from matplotlib.patches import PathPatch, Rectangle
from matplotlib.path import Path as MplPath
from matplotlib.quiver import Quiver
from matplotlib.text import Annotation

_MAX_POINTS = 500000  # au-dela : figure trop lourde pour le JSON -> fallback
_MS_PER_DAY = 86400000.0  # largeur de barre sur axe date : jours -> millisecondes

_LINESTYLES = {
    "-": "solid",
    "--": "dash",
    "-.": "dashdot",
    ":": "dot",
    "solid": "solid",
    "dashed": "dash",
    "dashdot": "dashdot",
    "dotted": "dot",
}

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


def _legend_bbox_position(legend, ax):
    """Position Plotly (paper coords) pour une legende avec bbox_to_anchor.
    Matplotlib stocke le bbox en coordonnees affichees ; on le ramene dans le
    repere figure pour que Plotly le place au meme endroit relatif."""
    if getattr(legend, "_bbox_to_anchor", None) is None:
        return None
    try:
        bbox = legend.get_bbox_to_anchor().transformed(ax.figure.transFigure.inverted())
    except Exception:
        return None

    base = _LEGEND_LOC.get(getattr(legend, "_loc", 0), _LEGEND_LOC[1])
    xanchor = base.get("xanchor", "right")
    yanchor = base.get("yanchor", "top")
    if xanchor == "left":
        x = bbox.x0
    elif xanchor == "right":
        x = bbox.x1
    else:
        x = 0.5 * (bbox.x0 + bbox.x1)

    if yanchor == "bottom":
        y = bbox.y0
    elif yanchor == "top":
        y = bbox.y1
    else:
        y = 0.5 * (bbox.y0 + bbox.y1)

    return {
        "x": float(x),
        "xanchor": xanchor,
        "y": float(y),
        "yanchor": yanchor,
    }


def _expand_margin_for_legend(layout, legend_layout):
    """Laisse de l'air quand bbox_to_anchor pousse la legende hors papier."""
    margin = layout.setdefault("margin", {})
    x = legend_layout.get("x")
    y = legend_layout.get("y")
    try:
        if x is not None and x > 1.0:
            margin["r"] = max(int(margin.get("r", 30)), 150)
        if x is not None and x < 0.0:
            margin["l"] = max(int(margin.get("l", 60)), 150)
        if y is not None and y > 1.0:
            margin["t"] = max(int(margin.get("t", 50)), 110)
        if y is not None and y < 0.0:
            margin["b"] = max(int(margin.get("b", 50)), 110)
    except TypeError:
        pass


_MARKERS = {
    "o": "circle",
    ".": "circle",
    "s": "square",
    "^": "triangle-up",
    "v": "triangle-down",
    "<": "triangle-left",
    ">": "triangle-right",
    "d": "diamond",
    "D": "diamond",
    "x": "x",
    "X": "x",
    "+": "cross",
    "*": "star",
    "p": "pentagon",
    "h": "hexagon",
}


# ------------------------------------------------------------
# Utilitaires
# ------------------------------------------------------------
def _hex(color):
    """Couleur matplotlib -> 'rgba(r,g,b,a)'."""
    rgba = mcolors.to_rgba(color)
    return "rgba(%d,%d,%d,%.3f)" % (
        int(round(rgba[0] * 255)),
        int(round(rgba[1] * 255)),
        int(round(rgba[2] * 255)),
        rgba[3],
    )


def _colorscale(cmap, n=16):
    """Colormap matplotlib -> colorscale Plotly."""
    scale = []
    for i in range(n):
        t = i / (n - 1.0)
        r, g, b, _a = cmap(t)
        scale.append([round(t, 4), "rgb(%d,%d,%d)" % (int(r * 255), int(g * 255), int(b * 255))])
    return scale


def _colorbar_title(mappable):
    """Titre (= unite) de la colorbar associee a un mappable (imshow,
    pcolormesh, scatter colore), ou None si aucune colorbar/etiquette. La
    colorbar matplotlib stocke son label sur l'axe de son `ax` dedie."""
    cbar = getattr(mappable, "colorbar", None)
    if cbar is None:
        return None
    try:
        label = cbar.ax.get_ylabel() or cbar.ax.get_xlabel()
    except Exception:
        label = None
    return label or None


# Une etiquette mpl est affichable en legende si elle est non vide et ne commence
# pas par "_" (mpl masque ces labels internes).
def _label_ok(label):
    return isinstance(label, str) and label != "" and not label.startswith("_")


def _finite_list(values):
    """ndarray -> liste JSON-compatible (NaN -> None)."""
    arr = np.asarray(values, dtype=float)
    out = []
    for v in arr.ravel():
        if np.isfinite(v):
            out.append(float(v))
        else:
            out.append(None)
    return out


def _segments_to_xy(segments):
    """Segments Nx2 -> listes x/y Plotly avec None entre les morceaux."""
    xs = []
    ys = []
    total = 0
    for segment in segments:
        segment = np.asarray(segment, dtype=float)
        if segment.ndim != 2 or segment.shape[0] < 2 or segment.shape[1] < 2:
            continue
        xs.extend(_finite_list(segment[:, 0]))
        ys.extend(_finite_list(segment[:, 1]))
        xs.append(None)
        ys.append(None)
        total += int(segment.shape[0])
    if xs:
        xs.pop()
        ys.pop()
    return xs, ys, total


def _color_at(colors, index=0, default="rgba(0,0,0,0.25)"):
    """Couleur Plotly a `index` dans un tableau de couleurs mpl (borne au
    dernier element), ou `default` si vide/invalide."""
    try:
        if colors is None or len(colors) == 0:
            return default
        return _hex(colors[min(index, len(colors) - 1)])
    except Exception:
        return default


def _number_at(values, index=0, default=0.0):
    """Nombre a `index` dans un tableau (borne au dernier), ou `default`."""
    try:
        if values is None or len(values) == 0:
            return default
        return float(values[min(index, len(values) - 1)])
    except Exception:
        return default


def _axis_value(value, is_date=False):
    """Valeur prete pour Plotly : ISO si axe date, float fini sinon ; None si
    non convertible."""
    if is_date:
        arr = _as_float_array([value])
        if arr.size == 0 or not np.isfinite(arr[0]):
            return None
        return _dates_to_iso([float(arr[0])])[0]
    try:
        value = float(value)
    except (TypeError, ValueError):
        return None
    if not np.isfinite(value):
        return None
    return value


def _as_float_array(values):
    """ndarray de flottants. Convertit les dates (date/datetime/datetime64)
    en datenums matplotlib si la conversion directe en float echoue."""
    arr = np.asarray(values)
    if arr.dtype.kind == "M":  # datetime64
        import matplotlib.dates as mdates
        return np.asarray(mdates.date2num(arr), dtype=float)
    try:
        return np.asarray(values, dtype=float)
    except (TypeError, ValueError):
        import matplotlib.dates as mdates
        return np.asarray(mdates.date2num(values), dtype=float)


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
    else:
        conv = getattr(axis, "converter", None)
    if conv is None:
        return False
    date_types = [mdates.DateConverter]
    for name in ("ConciseDateConverter", "_SwitchableDateConverter"):
        if hasattr(mdates, name):
            date_types.append(getattr(mdates, name))
    if isinstance(conv, tuple(date_types)):
        return True
    # garde-fou si matplotlib renomme la classe interne
    return "Date" in type(conv).__name__


def _dates_to_iso(values):
    """Liste de datenums matplotlib -> chaines ISO (None preserve)."""
    import matplotlib.dates as mdates
    out = []
    for v in values:
        if v is None:
            out.append(None)
        else:
            out.append(mdates.num2date(v).isoformat())
    return out


def _axis_range(ax, which):
    """Limites matplotlib -> range Plotly (log10 si echelle log)."""
    if which == "x":
        lo, hi = ax.get_xlim()
        is_log = ax.get_xscale() == "log"
    else:
        lo, hi = ax.get_ylim()
        is_log = ax.get_yscale() == "log"
    if is_log:
        if lo <= 0 or hi <= 0:
            return None
        return [float(np.log10(lo)), float(np.log10(hi))]
    return [float(lo), float(hi)]


def _custom_ticks(axis):
    """Si l'axe porte des etiquettes textuelles (barres categorielles,
    set_xticks avec labels), retourne (tickvals, ticktext), sinon None."""
    try:
        locs = list(axis.get_ticklocs())
        labels = [t.get_text() for t in axis.get_ticklabels()]
    except Exception:
        return None
    if len(locs) == 0 or len(locs) != len(labels):
        return None
    for loc, label in zip(locs, labels):
        if label == "":
            return None
        try:
            if abs(float(label.replace("\u2212", "-")) - float(loc)) < 1e-9:
                continue
            return [float(v) for v in locs], labels
        except ValueError:
            return [float(v) for v in locs], labels
    return None


# ------------------------------------------------------------
# Conversion des artistes
# ------------------------------------------------------------
def _convert_line(line, axis_suffix):
    x = _as_float_array(line.get_xdata())
    y = _as_float_array(line.get_ydata())
    if x.size == 0:
        return None, 0

    has_line = line.get_linestyle() not in ("None", "none", " ", "")
    has_marker = line.get_marker() not in ("None", "none", " ", "", None)
    if has_line and has_marker:
        mode = "lines+markers"
    elif has_marker:
        mode = "markers"
    else:
        mode = "lines"

    trace = {
        "type": "scatter",
        "mode": mode,
        "x": _finite_list(x),
        "y": _finite_list(y),
        "xaxis": "x" + axis_suffix,
        "yaxis": "y" + axis_suffix,
        "line": {
            "color": _hex(line.get_color()),
            "width": float(line.get_linewidth()),
            "dash": _LINESTYLES.get(str(line.get_linestyle()), "solid"),
        },
    }
    if has_marker:
        trace["marker"] = {
            "symbol": _MARKERS.get(str(line.get_marker()), "circle"),
            "size": float(line.get_markersize()),
            "color": _hex(line.get_markerfacecolor()),
        }
    label = line.get_label()
    if _label_ok(label):
        trace["name"] = label
        trace["showlegend"] = True
    else:
        trace["showlegend"] = False
    return trace, x.size



# --- errorbar -> scatter + barres d'erreur Plotly ---------------------------
# matplotlib eclate un errorbar en plusieurs artistes : la ligne de donnees, les
# caplines, et la LineCollection des barres. Pipeline de conversion :
#   _errorbar_parts            separe ces 3 morceaux ;
#   _error_arrays_from_segments reconstruit les amplitudes +/- par point depuis
#                              les segments des barres ;
#   _points_from_errorbar_collections / _nearest_point_index : secours quand il
#                              n'y a pas de ligne de donnees ;
#   _plotly_error_dict         formate error_x / error_y ;
#   _convert_errorbar          assemble le tout en une trace.
def _errorbar_parts(container):
    """(ligne de donnees, caplines, barres) d'un ErrorbarContainer ; tuples
    vides si indisponible."""
    try:
        data_line, caplines, barlinecols = container.lines
    except Exception:
        return None, (), ()
    return data_line, tuple(caplines or ()), tuple(barlinecols or ())


def _collection_line_color(collections, default="rgba(68,68,68,1.000)"):
    for collection in collections:
        try:
            colors = collection.get_colors()
        except Exception:
            colors = None
        color = _color_at(colors, default=None)
        if color is not None:
            return color
    return default


def _points_from_errorbar_collections(barlinecols):
    xs = []
    ys = []
    seen = set()
    for collection in barlinecols:
        try:
            segments = collection.get_segments()
        except Exception:
            continue
        for segment in segments:
            segment = np.asarray(segment, dtype=float)
            if segment.shape[0] < 2:
                continue
            x0, y0 = segment[0]
            x1, y1 = segment[-1]
            if not np.all(np.isfinite([x0, y0, x1, y1])):
                continue
            x = 0.5 * (x0 + x1)
            y = 0.5 * (y0 + y1)
            key = (round(float(x), 12), round(float(y), 12))
            if key in seen:
                continue
            seen.add(key)
            xs.append(float(x))
            ys.append(float(y))
    if len(xs) == 0:
        return None, None
    return np.asarray(xs, dtype=float), np.asarray(ys, dtype=float)


def _nearest_point_index(x, y, px, py):
    valid = np.isfinite(x) & np.isfinite(y)
    if not np.any(valid):
        return None
    xv = x[valid]
    yv = y[valid]
    xscale = np.nanmax(np.abs(xv)) or 1.0
    yscale = np.nanmax(np.abs(yv)) or 1.0
    dist = ((xv - px) / xscale) ** 2 + ((yv - py) / yscale) ** 2
    local = int(np.nanargmin(dist))
    return int(np.flatnonzero(valid)[local])


def _error_arrays_from_segments(barlinecols, x, y):
    """Reconstruit les amplitudes d'erreur par point depuis les segments des
    barres : un segment vertical donne err_y +/-, horizontal err_x +/-, rattache
    au point (x, y) le plus proche de son milieu. Renvoie (err_x, err_y), chacun
    (plus, minus) ou None si cet axe n'a pas de barres."""
    plus_x = np.zeros(x.shape, dtype=float)
    minus_x = np.zeros(x.shape, dtype=float)
    plus_y = np.zeros(y.shape, dtype=float)
    minus_y = np.zeros(y.shape, dtype=float)
    has_x = False
    has_y = False

    for collection in barlinecols:
        try:
            segments = collection.get_segments()
        except Exception:
            continue
        for segment in segments:
            segment = np.asarray(segment, dtype=float)
            if segment.shape[0] < 2:
                continue
            x0, y0 = segment[0]
            x1, y1 = segment[-1]
            if not np.all(np.isfinite([x0, y0, x1, y1])):
                continue
            vertical = np.isclose(x0, x1, rtol=1e-9, atol=1e-12)
            horizontal = np.isclose(y0, y1, rtol=1e-9, atol=1e-12)
            if vertical == horizontal:
                continue
            idx = _nearest_point_index(x, y, 0.5 * (x0 + x1), 0.5 * (y0 + y1))
            if idx is None:
                continue
            if vertical:
                lo, hi = sorted((y0, y1))
                plus_y[idx] = max(plus_y[idx], max(0.0, hi - y[idx]))
                minus_y[idx] = max(minus_y[idx], max(0.0, y[idx] - lo))
                has_y = True
            else:
                lo, hi = sorted((x0, x1))
                plus_x[idx] = max(plus_x[idx], max(0.0, hi - x[idx]))
                minus_x[idx] = max(minus_x[idx], max(0.0, x[idx] - lo))
                has_x = True

    return (
        (plus_x, minus_x) if has_x else None,
        (plus_y, minus_y) if has_y else None,
    )


def _plotly_error_dict(values, color, cap_width):
    if values is None:
        return None
    plus, minus = values
    if not (np.any(plus > 0) or np.any(minus > 0)):
        return None
    return {
        "type": "data",
        "symmetric": False,
        "array": [float(v) if np.isfinite(v) else 0.0 for v in plus],
        "arrayminus": [float(v) if np.isfinite(v) else 0.0 for v in minus],
        "visible": True,
        "color": color,
        "thickness": 1,
        "width": cap_width,
    }


def _convert_errorbar(container, axis_suffix):
    """ErrorbarContainer -> trace scatter avec error_x/error_y. Reutilise la
    ligne de donnees si presente, sinon reconstruit les points depuis les
    barres. Renvoie (trace, n_points), ou (None, 0) si rien d'exploitable."""
    data_line, caplines, barlinecols = _errorbar_parts(container)
    cap_width = 4 if len(caplines) > 0 else 0

    if data_line is not None:
        trace, n_points = _convert_line(data_line, axis_suffix)
        if trace is None:
            return None, 0
        x = _as_float_array(data_line.get_xdata())
        y = _as_float_array(data_line.get_ydata())
        color = _hex(data_line.get_color())
    else:
        x, y = _points_from_errorbar_collections(barlinecols)
        if x is None or y is None:
            return None, 0
        color = _collection_line_color(barlinecols)
        n_points = x.size
        trace = {
            "type": "scatter",
            "mode": "markers",
            "x": _finite_list(x),
            "y": _finite_list(y),
            "xaxis": "x" + axis_suffix,
            "yaxis": "y" + axis_suffix,
            "marker": {"color": "rgba(0,0,0,0)", "size": 1},
            "showlegend": False,
        }

    err_x, err_y = _error_arrays_from_segments(barlinecols, x, y)
    plotly_err_x = _plotly_error_dict(err_x, color, cap_width)
    plotly_err_y = _plotly_error_dict(err_y, color, cap_width)
    if plotly_err_x is not None:
        trace["error_x"] = plotly_err_x
    if plotly_err_y is not None:
        trace["error_y"] = plotly_err_y
    if plotly_err_x is None and plotly_err_y is None:
        return None, 0

    label = container.get_label() if hasattr(container, "get_label") else None
    if _label_ok(label):
        trace["name"] = label
        trace["showlegend"] = True
    return trace, n_points


def _convert_poly_collection(collection, axis_suffix):
    """PolyCollection (fill_between, aires remplies) -> traces scatter
    `fill:'toself'`, une par polygone. Conserve la couleur de remplissage et son
    alpha. Renvoie (liste de traces, n_points)."""
    try:
        paths = list(collection.get_paths())
    except Exception:
        return None, 0
    if len(paths) == 0:
        return [], 0

    facecolors = collection.get_facecolors()
    edgecolors = collection.get_edgecolors()
    linewidths = collection.get_linewidths()
    label = collection.get_label()
    traces = []
    total_points = 0

    for index, path in enumerate(paths):
        vertices = np.asarray(path.vertices, dtype=float)
        if vertices.ndim != 2 or vertices.shape[0] < 3 or vertices.shape[1] < 2:
            continue
        x = vertices[:, 0]
        y = vertices[:, 1]
        total_points += x.size
        fill_color = _color_at(facecolors, index, "rgba(31,119,180,0.250)")
        line_color = _color_at(edgecolors, index, fill_color)
        trace = {
            "type": "scatter",
            "mode": "lines",
            "x": _finite_list(x),
            "y": _finite_list(y),
            "fill": "toself",
            "fillcolor": fill_color,
            "line": {
                "color": line_color,
                "width": _number_at(linewidths, index, 0.0),
            },
            "hoveron": "points+fills",
            "xaxis": "x" + axis_suffix,
            "yaxis": "y" + axis_suffix,
            "showlegend": False,
        }
        if index == 0 and _label_ok(label):
            trace["name"] = label
            trace["showlegend"] = True
        traces.append(trace)

    return traces, total_points


def _split_path_segments(vertices, codes, close=False):
    """Decoupe un chemin matplotlib en segments utilisables par Plotly."""
    vertices = np.asarray(vertices, dtype=float)
    if vertices.ndim != 2 or vertices.shape[1] < 2:
        return []
    if codes is None:
        finite = np.all(np.isfinite(vertices[:, :2]), axis=1)
        segment = vertices[finite, :2]
        if close and segment.shape[0] > 0 and not np.allclose(segment[0], segment[-1]):
            segment = np.vstack([segment, segment[0]])
        return [segment] if segment.shape[0] >= 2 else []

    segments = []
    current = []
    for vertex, code in zip(vertices[:, :2], codes):
        if code == MplPath.STOP:
            break
        if not np.all(np.isfinite(vertex)):
            continue
        if code == MplPath.MOVETO:
            if current:
                segment = np.asarray(current, dtype=float)
                if close and segment.shape[0] > 0 and not np.allclose(segment[0], segment[-1]):
                    segment = np.vstack([segment, segment[0]])
                segments.append(segment)
            current = [vertex]
            continue
        if code == MplPath.CLOSEPOLY:
            if current:
                segment = np.asarray(current, dtype=float)
                if close and segment.shape[0] > 0 and not np.allclose(segment[0], segment[-1]):
                    segment = np.vstack([segment, segment[0]])
                segments.append(segment)
            current = []
            continue
        current.append(vertex)

    if current:
        segment = np.asarray(current, dtype=float)
        if close and segment.shape[0] > 0 and not np.allclose(segment[0], segment[-1]):
            segment = np.vstack([segment, segment[0]])
        segments.append(segment)
    return [segment for segment in segments if segment.shape[0] >= 2]


def _is_simple_path_patch(patch, max_vertices=200):
    """True pour les polygones PathPatch simples ; False pour les courbes complexes."""
    try:
        path = patch.get_path()
        vertices = np.asarray(path.vertices)
        codes = path.codes
    except Exception:
        return False
    if vertices.ndim != 2 or vertices.shape[0] == 0 or vertices.shape[0] > max_vertices:
        return False
    if codes is None:
        return True
    allowed = {MplPath.MOVETO, MplPath.LINETO, MplPath.CLOSEPOLY, MplPath.STOP}
    try:
        return all(code in allowed for code in codes)
    except TypeError:
        return False


def _convert_path_patch(patch, axis_suffix, ax):
    """PathPatch simple (notamment boxplot patch_artist=True) -> polygone Plotly."""
    try:
        path = patch.get_path()
        vertices = np.asarray(path.vertices, dtype=float)
        display_vertices = patch.get_transform().transform(vertices)
        data_vertices = ax.transData.inverted().transform(display_vertices)
    except Exception:
        return None, 0

    segments = _split_path_segments(data_vertices, path.codes, close=True)
    if len(segments) == 0:
        return [], 0

    face_rgba = mcolors.to_rgba(patch.get_facecolor())
    edge_rgba = mcolors.to_rgba(patch.get_edgecolor())
    face_color = _hex(face_rgba)
    edge_color = _hex(edge_rgba)
    try:
        linewidth = float(patch.get_linewidth())
    except Exception:
        linewidth = 1.0
    label = patch.get_label()

    traces = []
    total_points = 0
    for index, segment in enumerate(segments):
        if segment.shape[0] < 3:
            continue
        x = segment[:, 0]
        y = segment[:, 1]
        total_points += x.size
        trace = {
            "type": "scatter",
            "mode": "lines",
            "x": _finite_list(x),
            "y": _finite_list(y),
            "line": {"color": edge_color, "width": linewidth},
            "xaxis": "x" + axis_suffix,
            "yaxis": "y" + axis_suffix,
            "showlegend": False,
        }
        if face_rgba[3] > 0:
            trace["fill"] = "toself"
            trace["fillcolor"] = face_color
            trace["hoveron"] = "points+fills"
        if index == 0 and _label_ok(label):
            trace["name"] = label
            trace["showlegend"] = True
        traces.append(trace)

    return traces, total_points


def _contour_level(contour, index):
    if getattr(contour, "filled", False):
        values = getattr(contour, "layers", None)
    else:
        values = getattr(contour, "levels", None)
    try:
        if values is not None and len(values) > index:
            return float(values[index])
    except Exception:
        pass
    return None


def _convert_contour_set(contour, axis_suffix):
    """QuadContourSet (contour/contourf) -> traces scatter lignes/remplies."""
    try:
        paths = list(contour.get_paths())
    except Exception:
        return None, 0
    if len(paths) == 0:
        return [], 0

    filled = bool(getattr(contour, "filled", False))
    facecolors = contour.get_facecolors() if hasattr(contour, "get_facecolors") else []
    edgecolors = contour.get_edgecolors() if hasattr(contour, "get_edgecolors") else []
    linewidths = contour.get_linewidths() if hasattr(contour, "get_linewidths") else []
    traces = []
    total_points = 0

    for index, path in enumerate(paths):
        vertices = np.asarray(path.vertices, dtype=float)
        if vertices.ndim != 2 or vertices.shape[1] < 2:
            continue
        segments = _split_path_segments(vertices, path.codes, close=filled)
        xs, ys, n_points = _segments_to_xy(segments)
        if n_points == 0:
            continue
        total_points += n_points
        level = _contour_level(contour, index)

        if filled:
            fill_color = _color_at(facecolors, index, "rgba(31,119,180,0.350)")
            edge_default = fill_color if len(edgecolors) > 0 else "rgba(0,0,0,0.000)"
            edge_color = _color_at(edgecolors, index, edge_default)
            line_width = _number_at(linewidths, index, 0.0 if len(edgecolors) == 0 else 1.0)
            trace = {
                "type": "scatter",
                "mode": "lines",
                "x": xs,
                "y": ys,
                "fill": "toself",
                "fillcolor": fill_color,
                "line": {"color": edge_color, "width": line_width},
                "hoveron": "points+fills",
                "xaxis": "x" + axis_suffix,
                "yaxis": "y" + axis_suffix,
                "showlegend": False,
            }
        else:
            line_color = _color_at(edgecolors, index, "rgba(31,119,180,1.000)")
            trace = {
                "type": "scatter",
                "mode": "lines",
                "x": xs,
                "y": ys,
                "line": {
                    "color": line_color,
                    "width": _number_at(linewidths, index, 1.0),
                },
                "connectgaps": False,
                "xaxis": "x" + axis_suffix,
                "yaxis": "y" + axis_suffix,
                "showlegend": False,
            }
        if level is not None and np.isfinite(level):
            trace["name"] = "level %.6g" % level
            trace["hovertemplate"] = "level %.6g<extra></extra>" % level
        traces.append(trace)

    return traces, total_points


def _convert_quiver(quiver, axis_suffix, ax):
    """Quiver -> polygones de fleches Plotly en coordonnees donnees."""
    try:
        paths = list(quiver.get_paths())
    except Exception:
        paths = []
    if len(paths) == 0:
        try:
            ax.figure.canvas.draw()
            paths = list(quiver.get_paths())
        except Exception:
            return None, 0
    if len(paths) == 0:
        return [], 0

    try:
        offsets = np.asarray(quiver.get_offsets(), dtype=float)
        offset_transform = quiver.get_offset_transform()
        base_transform = quiver.get_transform()
    except Exception:
        return None, 0

    facecolors = quiver.get_facecolors() if hasattr(quiver, "get_facecolors") else []
    edgecolors = quiver.get_edgecolors() if hasattr(quiver, "get_edgecolors") else []
    linewidths = quiver.get_linewidths() if hasattr(quiver, "get_linewidths") else []
    label = quiver.get_label() if hasattr(quiver, "get_label") else None
    traces = []
    total_points = 0

    for index, path in enumerate(paths):
        vertices = np.asarray(path.vertices, dtype=float)
        if vertices.ndim != 2 or vertices.shape[0] < 3 or vertices.shape[1] < 2:
            continue
        try:
            display_vertices = base_transform.transform(vertices)
            if offsets.ndim == 2 and offsets.shape[0] > 0:
                offset = offsets[min(index, offsets.shape[0] - 1)]
                display_vertices = display_vertices + offset_transform.transform(offset)
            data_vertices = ax.transData.inverted().transform(display_vertices)
        except Exception:
            return None, 0

        segments = _split_path_segments(data_vertices, path.codes, close=True)
        xs, ys, n_points = _segments_to_xy(segments)
        if n_points < 3:
            continue
        total_points += n_points
        fill_color = _color_at(facecolors, index, "rgba(31,119,180,0.800)")
        edge_color = _color_at(edgecolors, index, fill_color)
        trace = {
            "type": "scatter",
            "mode": "lines",
            "x": xs,
            "y": ys,
            "fill": "toself",
            "fillcolor": fill_color,
            "line": {"color": edge_color, "width": _number_at(linewidths, index, 0.0)},
            "hoveron": "points+fills",
            "xaxis": "x" + axis_suffix,
            "yaxis": "y" + axis_suffix,
            "showlegend": False,
        }
        if index == 0 and _label_ok(label):
            trace["name"] = label
            trace["showlegend"] = True
        traces.append(trace)

    return traces, total_points


def _convert_scatter(collection, axis_suffix):
    """PathCollection (scatter) -> trace markers, avec couleurs/tailles par point
    et colormap eventuelle. Renvoie (trace, n_points)."""
    offsets = np.asarray(collection.get_offsets(), dtype=float)
    if offsets.size == 0:
        return None, 0
    x = offsets[:, 0]
    y = offsets[:, 1]

    marker = {}
    sizes = np.asarray(collection.get_sizes(), dtype=float)
    if sizes.size == 1:
        marker["size"] = float(np.sqrt(sizes[0]))
    elif sizes.size == x.size:
        marker["size"] = [float(np.sqrt(s)) for s in sizes]
    else:
        marker["size"] = 6.0

    mapped = collection.get_array()
    if mapped is not None and np.asarray(mapped).size == x.size:
        marker["color"] = _finite_list(mapped)
        marker["colorscale"] = _colorscale(collection.get_cmap())
        vmin, vmax = collection.get_clim()
        if vmin is not None:
            marker["cmin"] = float(vmin)
        if vmax is not None:
            marker["cmax"] = float(vmax)
        marker["showscale"] = True
        cb_title = _colorbar_title(collection)
        if cb_title:
            marker["colorbar"] = {"title": {"text": cb_title}}
    else:
        face = collection.get_facecolor()
        if len(face) == 1:
            marker["color"] = _hex(face[0])
        elif len(face) == x.size:
            marker["color"] = [_hex(c) for c in face]

    trace = {
        "type": "scatter",
        "mode": "markers",
        "x": _finite_list(x),
        "y": _finite_list(y),
        "marker": marker,
        "xaxis": "x" + axis_suffix,
        "yaxis": "y" + axis_suffix,
    }
    label = collection.get_label()
    if _label_ok(label):
        trace["name"] = label
        trace["showlegend"] = True
    else:
        trace["showlegend"] = False
    return trace, x.size


def _convert_bars(container, axis_suffix):
    """BarContainer (bar/barh) -> trace bar Plotly (orientation v/h selon les
    rectangles). Renvoie (trace, n_barres)."""
    rects = [p for p in container.patches if isinstance(p, Rectangle)]
    if len(rects) == 0:
        return None, 0
    orientation = getattr(container, "orientation", "vertical")
    xs = []
    ys = []
    widths = []
    colors = []
    for rect in rects:
        if orientation == "horizontal":
            xs.append(float(rect.get_width()))
            ys.append(float(rect.get_y() + rect.get_height() / 2.0))
            widths.append(float(rect.get_height()))
        else:
            xs.append(float(rect.get_x() + rect.get_width() / 2.0))
            ys.append(float(rect.get_height()))
            widths.append(float(rect.get_width()))
        colors.append(_hex(rect.get_facecolor()))

    trace = {
        "type": "bar",
        "x": xs,
        "y": ys,
        "width": widths,
        "marker": {"color": colors},
        "orientation": "h" if orientation == "horizontal" else "v",
        "xaxis": "x" + axis_suffix,
        "yaxis": "y" + axis_suffix,
    }
    label = container.get_label()
    if _label_ok(label):
        trace["name"] = label
        trace["showlegend"] = True
    else:
        trace["showlegend"] = False
    return trace, len(rects)


def _convert_image(image, axis_suffix):
    """AxesImage (imshow) -> heatmap (donnees 2D) ou image (RGB/RGBA). Renvoie
    (trace, n_pixels)."""
    data = np.asarray(image.get_array())
    extent = image.get_extent()  # (left, right, bottom, top)
    n_points = int(data.shape[0]) * int(data.shape[1])

    if data.ndim == 2:
        height, width = data.shape
        x = np.linspace(extent[0], extent[1], width)
        y = np.linspace(extent[3], extent[2], height)  # origin='upper'
        vmin, vmax = image.get_clim()
        trace = {
            "type": "heatmap",
            "z": [_finite_list(row) for row in data],
            "x": _finite_list(x),
            "y": _finite_list(y),
            "colorscale": _colorscale(image.get_cmap()),
            "zmin": float(vmin),
            "zmax": float(vmax),
            "xaxis": "x" + axis_suffix,
            "yaxis": "y" + axis_suffix,
            "showlegend": False,
        }
        cb_title = _colorbar_title(image)
        if cb_title:
            trace["colorbar"] = {"title": {"text": cb_title}}
        return trace, n_points

    if data.ndim == 3 and data.shape[2] in (3, 4):
        if data.dtype != np.uint8:
            rgb = (np.clip(data, 0.0, 1.0) * 255).astype(int)
        else:
            rgb = data.astype(int)
        trace = {
            "type": "image",
            "z": rgb[:, :, :3].tolist(),
            "xaxis": "x" + axis_suffix,
            "yaxis": "y" + axis_suffix,
        }
        return trace, n_points

    return None, 0


def _convert_quadmesh(mesh, axis_suffix):
    """QuadMesh (pcolormesh) -> heatmap Plotly. Renvoie (trace, n_cellules)."""
    coords = np.asarray(mesh.get_coordinates(), dtype=float)  # (M+1, N+1, 2)
    z = np.asarray(mesh.get_array(), dtype=float)
    rows = coords.shape[0] - 1
    cols = coords.shape[1] - 1
    if z.ndim == 1:
        z = z.reshape(rows, cols)

    # centres des mailles a partir des aretes
    x_edges = coords[0, :, 0]
    y_edges = coords[:, 0, 1]
    x_centers = 0.5 * (x_edges[:-1] + x_edges[1:])
    y_centers = 0.5 * (y_edges[:-1] + y_edges[1:])

    vmin, vmax = mesh.get_clim()
    trace = {
        "type": "heatmap",
        "z": [_finite_list(row) for row in z],
        "x": _finite_list(x_centers),
        "y": _finite_list(y_centers),
        "colorscale": _colorscale(mesh.get_cmap()),
        "zmin": float(vmin),
        "zmax": float(vmax),
        "xaxis": "x" + axis_suffix,
        "yaxis": "y" + axis_suffix,
        "showlegend": False,
    }
    cb_title = _colorbar_title(mesh)
    if cb_title:
        trace["colorbar"] = {"title": {"text": cb_title}}
    return trace, int(z.size)



# --- text() / annotate() -> layout.annotations -----------------------------
# _coord_kind     : classe le systeme de coordonnees (data / fraction d'axe /
#                   papier figure / offset points|pixels) d'un texte.
# _coord_pair_to_plotly : mappe un point (x, y) vers une position Plotly
#                   (valeur + xref/yref, ou offset ax/ay).
# _base_text_annotation : annotation Plotly de base (texte, police, ancres,
#                   rotation, opacite) sans la position.
# _append_plotly_texts : parcourt ax.texts et pousse les annotations dans
#                   layout["annotations"], avec fleche pour les annotate().
def _coord_kind(coord, ax):
    """Type de coordonnees d'un texte : 'data', 'axes_fraction', 'paper',
    'offset_points', 'offset_pixels' (defaut 'data')."""
    try:
        if coord == ax.transData:
            return "data"
        if coord == ax.transAxes:
            return "axes_fraction"
    except Exception:
        pass
    if isinstance(coord, str):
        lowered = coord.lower()
        if lowered == "data":
            return "data"
        if lowered == "axes fraction":
            return "axes_fraction"
        if lowered == "figure fraction":
            return "paper"
        if lowered == "offset points":
            return "offset_points"
        if lowered == "offset pixels":
            return "offset_pixels"
    return "data"


def _coord_pair_to_plotly(ax, coords, point, xref, yref, position, x_is_date, y_is_date):
    """Mappe un point (px, py) exprime dans `coords` (transform ou chaine mpl)
    vers Plotly. Renvoie soit {kind:'position', x, y, xref, yref} (data ou paper,
    fraction d'axe ramenee au domaine via `position`), soit {kind:'offset', x, y}
    (decalage en pixels pour offset points/pixels), soit None si inexploitable."""
    try:
        px, py = point
    except Exception:
        return None

    if isinstance(coords, tuple) and len(coords) == 2:
        kind_x = _coord_kind(coords[0], ax)
        kind_y = _coord_kind(coords[1], ax)
    else:
        kind_x = kind_y = _coord_kind(coords, ax)

    if kind_x.startswith("offset") or kind_y.startswith("offset"):
        try:
            x = float(px)
            y = float(py)
        except (TypeError, ValueError):
            return None
        if kind_x == "offset_points":
            x *= 96.0 / 72.0
        if kind_y == "offset_points":
            y *= 96.0 / 72.0
        return {"kind": "offset", "x": x, "y": -y}

    def value_for_axis(value, kind, axis_ref, is_date, lo, hi):
        if kind == "axes_fraction":
            try:
                value = float(value)
            except (TypeError, ValueError):
                return None, None
            return lo + value * (hi - lo), "paper"
        if kind == "paper":
            try:
                value = float(value)
            except (TypeError, ValueError):
                return None, None
            return value, "paper"
        return _axis_value(value, is_date), axis_ref

    x, out_xref = value_for_axis(px, kind_x, xref, x_is_date, position.x0, position.x1)
    y, out_yref = value_for_axis(py, kind_y, yref, y_is_date, position.y0, position.y1)
    if x is None or y is None:
        return None
    return {"kind": "position", "x": x, "y": y, "xref": out_xref, "yref": out_yref}


def _base_text_annotation(text):
    annotation = {
        "text": text.get_text(),
        "showarrow": False,
        "font": {},
    }
    try:
        annotation["font"]["size"] = float(text.get_fontsize())
    except Exception:
        pass
    try:
        annotation["font"]["color"] = _hex(text.get_color())
    except Exception:
        pass
    if len(annotation["font"]) == 0:
        annotation.pop("font")

    halign = getattr(text, "get_horizontalalignment", lambda: "center")()
    valign = getattr(text, "get_verticalalignment", lambda: "center")()
    if halign in ("left", "center", "right"):
        annotation["xanchor"] = halign
    yanchors = {
        "top": "top",
        "center": "middle",
        "center_baseline": "middle",
        "bottom": "bottom",
        "baseline": "bottom",
    }
    annotation["yanchor"] = yanchors.get(valign, "middle")

    try:
        rotation = text.get_rotation()
        if rotation == "vertical":
            angle = 90.0
        elif rotation == "horizontal":
            angle = 0.0
        else:
            angle = float(rotation)
        if angle != 0:
            annotation["textangle"] = angle
    except Exception:
        pass

    try:
        alpha = text.get_alpha()
        if alpha is not None:
            annotation["opacity"] = float(alpha)
    except Exception:
        pass
    return annotation


def _append_plotly_texts(layout, ax, xref, yref, position, x_is_date, y_is_date):
    """Convertit ax.texts (text() et annotate()) en entrees
    layout["annotations"]. Les annotate() avec fleche deviennent des annotations
    `showarrow` (cible xy + ancrage xytext). `position` = ax.get_position()
    (domaine de l'axe en coords papier), pour les coordonnees en fraction d'axe."""
    for text in getattr(ax, "texts", []):
        try:
            label = text.get_text()
        except Exception:
            label = ""
        if not label:
            continue

        annotation = _base_text_annotation(text)
        if isinstance(text, Annotation):
            arrow_patch = getattr(text, "arrow_patch", None)
            xy = getattr(text, "xy", None)
            xycoords = getattr(text, "xycoords", "data")
            xyann = getattr(text, "xyann", None)
            if xyann is None:
                try:
                    xyann = text.get_position()
                except Exception:
                    xyann = xy
            anncoords = getattr(text, "anncoords", xycoords)

            if arrow_patch is not None and xy is not None:
                head = _coord_pair_to_plotly(ax, xycoords, xy, xref, yref, position, x_is_date, y_is_date)
                if head is None or head.get("kind") != "position":
                    continue
                annotation.update({
                    "x": head["x"],
                    "y": head["y"],
                    "xref": head["xref"],
                    "yref": head["yref"],
                    "showarrow": True,
                    "arrowhead": 2,
                    "arrowsize": 1,
                    "arrowwidth": 1,
                })
                try:
                    annotation["arrowcolor"] = _hex(arrow_patch.get_edgecolor())
                except Exception:
                    pass
                tail = _coord_pair_to_plotly(ax, anncoords, xyann, xref, yref, position, x_is_date, y_is_date)
                if (
                    tail is not None
                    and tail.get("kind") == "position"
                    and tail.get("xref") == head.get("xref")
                    and tail.get("yref") == head.get("yref")
                ):
                    annotation["axref"] = tail["xref"]
                    annotation["ayref"] = tail["yref"]
                    annotation["ax"] = tail["x"]
                    annotation["ay"] = tail["y"]
                elif tail is not None and tail.get("kind") == "offset":
                    annotation["ax"] = tail["x"]
                    annotation["ay"] = tail["y"]
                layout["annotations"].append(annotation)
                continue

            position_info = _coord_pair_to_plotly(ax, anncoords, xyann, xref, yref, position, x_is_date, y_is_date)
        else:
            try:
                text_position = text.get_position()
            except Exception:
                continue
            position_info = _coord_pair_to_plotly(
                ax, text.get_transform(), text_position, xref, yref, position, x_is_date, y_is_date
            )

        if position_info is None or position_info.get("kind") != "position":
            continue
        annotation.update({
            "x": position_info["x"],
            "y": position_info["y"],
            "xref": position_info["xref"],
            "yref": position_info["yref"],
            "showarrow": False,
        })
        layout["annotations"].append(annotation)


# ------------------------------------------------------------
# Detection des artistes non supportes (-> fallback SVG)
# ------------------------------------------------------------
def _first_unsupported_artist(ax, bar_rectangles, supported_collections=None, supported_patches=None):
    """FRONTIERE DE CORRECTION : retourne le premier artiste que l'axe contient
    et qu'on ne sait pas convertir fidelement (ou None si tout est gere) ->
    l'appelant (convert_figure) renvoie None et tout bascule en SVG. On laisse
    passer les types geres + les sous-artistes "reclames" (rectangles de barres,
    LineCollection d'errorbar, fleches d'annotations, PathPatch simples) fournis
    dans bar_rectangles / supported_collections / supported_patches. Tout le
    reste (streamplot, patch libre complexe...) = refus. Le type de l'artiste
    rendu sert au diagnostic de fallback (cf. _describe_unsupported)."""
    from matplotlib.collections import Collection
    from matplotlib.patches import Patch
    from matplotlib.spines import Spine

    supported_collections = supported_collections or set()
    supported_patches = supported_patches or set()

    for child in ax.get_children():
        if isinstance(child, Spine):
            continue  # bordures des axes : ignorables (heritent de Patch)
        if child in supported_collections or child in supported_patches:
            continue
        if child is ax.patch:
            continue
        if isinstance(child, (Line2D, PathCollection, QuadMesh, PolyCollection, AxesImage)):
            continue
        if isinstance(child, Rectangle):
            if child in bar_rectangles:
                continue
            # le rectangle de fond de l'axe est ignorable
            if child is ax.patch:
                continue
            return child
        # Toute autre Collection (streamplot, EventCollection...) n'est pas
        # convertie -> fallback SVG.
        if isinstance(child, Collection):
            return child
        if isinstance(child, Patch):
            return child
        # Text, Spine, Axis, Legend... : ignorables
    return None


def _has_unsupported_artist(ax, bar_rectangles, supported_collections=None, supported_patches=None):
    """True si l'axe contient un artiste non convertible (cf.
    _first_unsupported_artist). Conserve pour la lisibilite des appelants."""
    return _first_unsupported_artist(
        ax, bar_rectangles, supported_collections, supported_patches
    ) is not None


# ------------------------------------------------------------
# Diagnostic de fallback (pourquoi pas de rendu Plotly interactif)
# ------------------------------------------------------------
# convert_figure_with_reason renvoie, en cas d'echec, un dict
# {code, message, detail} : `code` est stable (consomme par l'UI), `message`
# est une phrase courte en francais, `detail` precise (nom de classe mpl...).
def _reason(code, message, detail=None):
    return {"code": code, "message": message, "detail": detail}


# Indices cibles pour les artistes non geres les plus frequents (par nom de
# classe matplotlib), afin d'orienter l'utilisateur vers la cause.
_UNSUPPORTED_HINTS = {
    "LineCollection": "streamplot, hlines/vlines ou contour exotique",
    "PatchCollection": "collection de patches (ex. streamplot)",
    "PolyCollection": "remplissage complexe",
    "Poly3DCollection": "trace 3D non gere",
    "Path3DCollection": "trace 3D non gere",
    "Line3D": "trace 3D non gere",
    "Wedge": "camembert (pie) non gere",
}


def _describe_unsupported(artist):
    """Construit la raison de fallback pour un artiste non converti."""
    name = type(artist).__name__
    hint = _UNSUPPORTED_HINTS.get(name)
    detail = name if hint is None else name + " — " + hint
    return _reason("unsupported_artist", "Artiste non gere : " + name, detail)


# ------------------------------------------------------------
# Axes polaires
# ------------------------------------------------------------
def _is_polar_axis(ax):
    return getattr(ax, "name", "") == "polar"


def _convert_axis_traces_to_polar(traces, subplot):
    """Convertit les traces scatter x/y(theta/r) d'un axe polar en scatterpolar."""
    for trace in traces:
        if trace.get("type") != "scatter":
            return False
        if "error_x" in trace or "error_y" in trace:
            return False
        if "x" not in trace or "y" not in trace:
            return False
        trace["type"] = "scatterpolar"
        trace["theta"] = trace.pop("x")
        trace["r"] = trace.pop("y")
        trace["thetaunit"] = "radians"
        trace["subplot"] = subplot
        trace.pop("xaxis", None)
        trace.pop("yaxis", None)
    return True


def _polar_layout(ax, position):
    radial = {
        "range": [float(ax.get_ylim()[0]), float(ax.get_ylim()[1])],
        "gridcolor": "#e6e6e6",
        "linecolor": "#444444",
        "ticks": "outside",
    }
    angular = {
        "gridcolor": "#e6e6e6",
        "linecolor": "#444444",
        "ticks": "outside",
    }
    try:
        angular["direction"] = "clockwise" if ax.get_theta_direction() < 0 else "counterclockwise"
        angular["rotation"] = float(np.degrees(ax.get_theta_offset()))
    except Exception:
        pass
    return {
        "domain": {
            "x": [float(position.x0), float(position.x1)],
            "y": [float(position.y0), float(position.y1)],
        },
        "bgcolor": "#ffffff",
        "radialaxis": radial,
        "angularaxis": angular,
    }


# ------------------------------------------------------------
# Classification des axes (detection twinx/twiny)
# ------------------------------------------------------------
# _shares_x/_shares_y + _same_position servent a detecter les axes jumeaux :
# deux axes qui partagent une dimension et occupent exactement le meme rectangle.
def _shares_x(a, b):
    """True si a et b partagent le meme axe X (candidats twinx)."""
    try:
        return b in a.get_shared_x_axes().get_siblings(a)
    except Exception:
        return False


def _shares_y(a, b):
    """True si a et b partagent le meme axe Y (candidats twiny)."""
    try:
        return b in a.get_shared_y_axes().get_siblings(a)
    except Exception:
        return False


def _same_position(a, b, eps=1e-3):
    """True si a et b occupent le meme rectangle (a eps pres)."""
    pa = a.get_position()
    pb = b.get_position()
    return (
        abs(pa.x0 - pb.x0) < eps and abs(pa.x1 - pb.x1) < eps
        and abs(pa.y0 - pb.y0) < eps and abs(pa.y1 - pb.y1) < eps
    )


def _classify_axes(axes_list):
    """Pour chaque axe : {ax, suffix, is_twin, twin_kind, host_suffix}.
    `twinx` partage X et ajoute un axe Y secondaire ; `twiny` partage Y et
    ajoute un axe X secondaire. Les sous-graphes distincts ne sont jamais
    traites comme des twins, meme avec sharex/sharey."""
    infos = []
    for index, ax in enumerate(axes_list):
        infos.append({
            "ax": ax,
            "suffix": "" if index == 0 else str(index + 1),
            "is_twin": False,
            "twin_kind": None,
            "host_suffix": None,
        })
    for i in range(len(infos)):
        ax = infos[i]["ax"]
        for j in range(i):
            host = infos[j]["ax"]
            if not _same_position(ax, host):
                continue
            if _shares_x(ax, host):
                infos[i]["is_twin"] = True
                infos[i]["twin_kind"] = "twinx"
                infos[i]["host_suffix"] = infos[j]["suffix"]
                break
            if _shares_y(ax, host):
                infos[i]["is_twin"] = True
                infos[i]["twin_kind"] = "twiny"
                infos[i]["host_suffix"] = infos[j]["suffix"]
                break
    return infos


def _apply_legend(layout, ax):
    """Active et positionne la legende si l'axe en porte une. S'applique
    aussi bien a l'axe hote qu'a un axe twin (qui peut porter la legende)."""
    legend = ax.get_legend()
    if legend is None:
        return
    layout["showlegend"] = True
    # Legende lisible : cadre, fond semi-transparent, police plus grande.
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
    # position selon loc matplotlib (best/0 -> defaut haut-droite)
    pos = _LEGEND_LOC.get(getattr(legend, "_loc", 0))
    if pos:
        legend_layout.update(pos)
    # Si bbox_to_anchor est explicite, il gagne sur le loc interne : le loc
    # fournit l'ancre, le bbox fournit la position en coordonnees papier.
    bbox_pos = _legend_bbox_position(legend, ax)
    if bbox_pos is not None:
        legend_layout.update(bbox_pos)
        _expand_margin_for_legend(layout, legend_layout)
    layout["legend"] = legend_layout


# ------------------------------------------------------------
# Point d'entree
# ------------------------------------------------------------
def convert_figure(fig):
    """Figure matplotlib -> {"data": [...], "layout": {...}} ou None.
    Enveloppe de convert_figure_with_reason qui ne renvoie que le spec."""
    spec, _ = convert_figure_with_reason(fig)
    return spec


def convert_figure_with_reason(fig):
    """Figure matplotlib -> (spec, reason).

    spec   : {"data": [...], "layout": {...}} si la figure est convertible en
             Plotly interactif, sinon None.
    reason : None en cas de succes ; sinon un dict {code, message, detail}
             expliquant le repli (cf. _reason) — consomme par le diagnostic UI."""
    axes_list = [ax for ax in fig.get_axes() if ax.get_label() != "<colorbar>"]
    if len(axes_list) == 0:
        return None, _reason("no_axes", "Aucun axe a convertir")

    data = []
    layout = {
        "margin": {"l": 60, "r": 30, "t": 50, "b": 50},
        "paper_bgcolor": "#ffffff",
        "plot_bgcolor": "#ffffff",
        "font": {"size": 12},
        "annotations": [],
        "showlegend": False,
    }

    suptitle = fig.get_suptitle() if hasattr(fig, "get_suptitle") else ""
    if suptitle:
        layout["title"] = {"text": suptitle, "x": 0.5}

    total_points = 0

    for info in _classify_axes(axes_list):
        ax = info["ax"]
        suffix = info["suffix"]
        is_twin = info["is_twin"]
        twin_kind = info["twin_kind"]
        host_suffix = info["host_suffix"]
        axis_x = "xaxis" + suffix
        axis_y = "yaxis" + suffix
        is_polar = _is_polar_axis(ax)
        axis_trace_start = len(data)

        # rectangles/barres d'erreur/textes appartenant a des artistes geres
        # (pour eviter un fallback SVG juste a cause de leurs sous-artistes).
        bar_rectangles = set()
        path_patches = set()
        supported_collections = set()
        errorbar_containers = []
        errorbar_lines = set()
        errorbar_collections = set()
        text_arrow_patches = set()
        for container in ax.containers:
            if isinstance(container, BarContainer):
                for p in container.patches:
                    bar_rectangles.add(p)
            elif isinstance(container, ErrorbarContainer):
                errorbar_containers.append(container)
                data_line, caplines, barlinecols = _errorbar_parts(container)
                if data_line is not None:
                    errorbar_lines.add(data_line)
                errorbar_lines.update(caplines)
                errorbar_collections.update(barlinecols)
        for child in ax.get_children():
            if not is_polar and isinstance(child, (QuadContourSet, Quiver)):
                supported_collections.add(child)
        for patch in ax.patches:
            if isinstance(patch, PathPatch) and patch is not ax.patch and _is_simple_path_patch(patch):
                path_patches.add(patch)
        for text in getattr(ax, "texts", []):
            arrow_patch = getattr(text, "arrow_patch", None)
            if arrow_patch is not None:
                text_arrow_patches.add(arrow_patch)

        supported_collections.update(errorbar_collections)
        supported_patches = text_arrow_patches | path_patches
        offending = _first_unsupported_artist(ax, bar_rectangles, supported_collections, supported_patches)
        if offending is not None:
            return None, _describe_unsupported(offending)

        # ---- traces ----
        for container in errorbar_containers:
            trace, n = _convert_errorbar(container, suffix)
            if trace is None:
                return None, _reason("convert_failed", "Echec de conversion d'une barre d'erreur", "ErrorbarContainer")
            data.append(trace)
            total_points += n

        for line in ax.get_lines():
            if line in errorbar_lines:
                continue
            trace, n = _convert_line(line, suffix)
            if trace is not None:
                data.append(trace)
                total_points += n

        for child in ax.get_children():
            if child in errorbar_collections:
                continue
            traces = None
            n = 0
            if isinstance(child, QuadContourSet):
                traces, n = _convert_contour_set(child, suffix)
            elif isinstance(child, Quiver):
                traces, n = _convert_quiver(child, suffix, ax)
            elif isinstance(child, PathCollection):
                trace, n = _convert_scatter(child, suffix)
                traces = [trace] if trace is not None else None
            elif isinstance(child, QuadMesh):
                trace, n = _convert_quadmesh(child, suffix)
                traces = [trace] if trace is not None else None
            elif isinstance(child, AxesImage):
                trace, n = _convert_image(child, suffix)
                traces = [trace] if trace is not None else None
            elif isinstance(child, PolyCollection):
                traces, n = _convert_poly_collection(child, suffix)
            else:
                continue
            if traces is None:
                return None, _reason("convert_failed", "Echec de conversion d'un artiste", type(child).__name__)
            data.extend(traces)
            total_points += n

        for patch in ax.patches:
            if patch is ax.patch or patch in bar_rectangles or patch in text_arrow_patches:
                continue
            if not isinstance(patch, PathPatch):
                continue
            traces, n = _convert_path_patch(patch, suffix, ax)
            if traces is None:
                return None, _reason("convert_failed", "Echec de conversion d'un patch", type(patch).__name__)
            data.extend(traces)
            total_points += n

        for container in ax.containers:
            if isinstance(container, BarContainer):
                trace, n = _convert_bars(container, suffix)
                if trace is not None:
                    data.append(trace)
                    total_points += n

        if total_points > _MAX_POINTS:
            return None, _reason(
                "too_many_points",
                "Trop de points pour le mode interactif (> 500 000)",
                str(total_points) + " points",
            )

        # ---- axes temporels : datenums -> chaines ISO ----
        x_is_date = _is_date_axis(ax.xaxis)
        y_is_date = _is_date_axis(ax.yaxis)
        for trace in data[axis_trace_start:]:
            if x_is_date and "x" in trace:
                trace["x"] = _dates_to_iso(trace["x"])
            if y_is_date and "y" in trace:
                trace["y"] = _dates_to_iso(trace["y"])
            if x_is_date and "error_x" in trace:
                for key in ("array", "arrayminus"):
                    trace["error_x"][key] = [v * _MS_PER_DAY for v in trace["error_x"].get(key, [])]
            if y_is_date and "error_y" in trace:
                for key in ("array", "arrayminus"):
                    trace["error_y"][key] = [v * _MS_PER_DAY for v in trace["error_y"].get(key, [])]
            # Sur un axe date, Plotly attend la largeur des barres en
            # millisecondes (matplotlib la donne en jours).
            if trace.get("type") == "bar" and "width" in trace:
                horiz = trace.get("orientation") == "h"
                if (horiz and y_is_date) or (not horiz and x_is_date):
                    trace["width"] = [w * _MS_PER_DAY for w in trace["width"]]

        # legende (valable pour l'axe hote comme pour un axe twin)
        _apply_legend(layout, ax)
        position = ax.get_position()

        # ---- axe polar : traces scatterpolar Plotly ----
        if is_polar:
            polar_name = "polar" + suffix
            if not _convert_axis_traces_to_polar(data[axis_trace_start:], polar_name):
                return None, _reason(
                    "polar_unsupported",
                    "Axe polaire : type de trace non gere",
                    "seuls lignes/points (scatterpolar) sont convertis",
                )
            layout[polar_name] = _polar_layout(ax, position)
            title = ax.get_title()
            if title:
                layout["annotations"].append({
                    "text": title,
                    "x": float((position.x0 + position.x1) / 2.0),
                    "y": float(position.y1),
                    "xref": "paper",
                    "yref": "paper",
                    "xanchor": "center",
                    "yanchor": "bottom",
                    "showarrow": False,
                    "font": {"size": 14},
                })
            continue

        # ---- twinx : l'axe secondaire reutilise le X de l'hote ----
        if is_twin and twin_kind == "twinx":
            for trace in data[axis_trace_start:]:
                trace["xaxis"] = "x" + host_suffix
                trace["yaxis"] = "y" + suffix
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
            if y_is_date:
                layout[axis_y]["type"] = "date"
                layout[axis_y].pop("tickvals", None)
                layout[axis_y].pop("ticktext", None)
                layout[axis_y].pop("range", None)
            _append_plotly_texts(layout, ax, "x" + host_suffix, "y" + suffix, position, x_is_date, y_is_date)
            continue  # pas de bloc axe X / domaine / titre pour un twin

        # ---- twiny : l'axe secondaire reutilise le Y de l'hote ----
        if is_twin and twin_kind == "twiny":
            for trace in data[axis_trace_start:]:
                trace["xaxis"] = "x" + suffix
                trace["yaxis"] = "y" + host_suffix
            layout[axis_x] = {
                "overlaying": "x" + host_suffix,
                "side": "top",
                "anchor": "y" + host_suffix,
                "title": {"text": ax.get_xlabel()},
                "showgrid": False,
                "zeroline": False,
                "linecolor": "#444444",
                "ticks": "outside",
            }
            if ax.get_xscale() == "log":
                layout[axis_x]["type"] = "log"
            ticks_x = _custom_ticks(ax.xaxis)
            if ticks_x is not None and ax.get_xscale() != "log":
                layout[axis_x]["tickvals"] = ticks_x[0]
                layout[axis_x]["ticktext"] = ticks_x[1]
            x_range = _axis_range(ax, "x")
            if x_range is not None:
                layout[axis_x]["range"] = x_range
            if x_is_date:
                layout[axis_x]["type"] = "date"
                layout[axis_x].pop("tickvals", None)
                layout[axis_x].pop("ticktext", None)
                layout[axis_x].pop("range", None)
            _append_plotly_texts(layout, ax, "x" + suffix, "y" + host_suffix, position, x_is_date, y_is_date)
            continue  # pas de bloc axe Y / domaine / titre pour un twin

        # ---- axes : domaine, labels, echelle, limites, grille ----
        position = ax.get_position()
        grid_on = False
        gridlines = ax.xaxis.get_gridlines()
        if len(gridlines) > 0:
            grid_on = bool(gridlines[0].get_visible())

        layout[axis_x] = {
            "domain": [float(position.x0), float(position.x1)],
            "anchor": "y" + suffix,
            "title": {"text": ax.get_xlabel()},
            "showgrid": grid_on,
            "gridcolor": "#e6e6e6",
            "zeroline": False,
            "linecolor": "#444444",
            "mirror": True,
            "ticks": "outside",
        }
        layout[axis_y] = {
            "domain": [float(position.y0), float(position.y1)],
            "anchor": "x" + suffix,
            "title": {"text": ax.get_ylabel()},
            "showgrid": grid_on,
            "gridcolor": "#e6e6e6",
            "zeroline": False,
            "linecolor": "#444444",
            "mirror": True,
            "ticks": "outside",
        }
        if ax.get_xscale() == "log":
            layout[axis_x]["type"] = "log"
        if ax.get_yscale() == "log":
            layout[axis_y]["type"] = "log"
        ticks_x = _custom_ticks(ax.xaxis)
        if ticks_x is not None and ax.get_xscale() != "log":
            layout[axis_x]["tickvals"] = ticks_x[0]
            layout[axis_x]["ticktext"] = ticks_x[1]
        ticks_y = _custom_ticks(ax.yaxis)
        if ticks_y is not None and ax.get_yscale() != "log":
            layout[axis_y]["tickvals"] = ticks_y[0]
            layout[axis_y]["ticktext"] = ticks_y[1]
        x_range = _axis_range(ax, "x")
        y_range = _axis_range(ax, "y")
        if x_range is not None:
            layout[axis_x]["range"] = x_range
        if y_range is not None:
            layout[axis_y]["range"] = y_range
        # axe date : type 'date' et abandon des valeurs numeriques (datenums)
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

        _append_plotly_texts(layout, ax, "x" + suffix, "y" + suffix, position, x_is_date, y_is_date)

        # titre de l'axe -> annotation au-dessus du sous-graphe
        title = ax.get_title()
        if title:
            layout["annotations"].append({
                "text": title,
                "x": float((position.x0 + position.x1) / 2.0),
                "y": float(position.y1),
                "xref": "paper",
                "yref": "paper",
                "xanchor": "center",
                "yanchor": "bottom",
                "showarrow": False,
                "font": {"size": 14},
            })

    # filet de securite : aucune trace produite (artiste exotique passe
    # entre les mailles) -> on retombe sur le SVG plutot qu'un graphe vide.
    if len(data) == 0:
        return None, _reason("empty", "Aucune trace exploitable produite")

    # hauteur d'affichage derivee de la taille de la figure
    size = fig.get_size_inches()
    layout["height"] = int(size[1] * 96)

    # dimensions (pouces) transmises pour un redimensionnement qui conserve
    # le ratio cote panneau (notamment en plein ecran).
    return {
        "data": data,
        "layout": layout,
        "width_in": float(size[0]),
        "height_in": float(size[1]),
    }, None
