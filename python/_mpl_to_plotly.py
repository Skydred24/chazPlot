# ============================================================
# _mpl_to_plotly.py
# Conversion d'une figure matplotlib en specification Plotly
# (data + layout) pour un rendu interactif dans le panneau.
#
# Artistes supportes :
#   - Line2D            (plot, axhline, axvline, errorbar partiel)
#   - PathCollection    (scatter, avec couleurs/tailles/colormap)
#   - BarContainer      (bar, barh)
#   - AxesImage         (imshow : 2D -> heatmap, RGB -> image)
#   - QuadMesh          (pcolormesh -> heatmap)
# Gere : sous-graphes, titres, labels, limites, echelle log,
#        grille, legendes, colormaps.
#
# Si la figure contient autre chose (contour, quiver, patches
# libres, 3D...), convert_figure retourne None et le backend
# retombe sur le rendu SVG. Aucune dependance hors matplotlib.
# ============================================================

import numpy as np
import matplotlib.colors as mcolors
from matplotlib.lines import Line2D
from matplotlib.collections import PathCollection, QuadMesh
from matplotlib.image import AxesImage
from matplotlib.container import BarContainer
from matplotlib.patches import Rectangle

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
    if conv is None:
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


def _convert_scatter(collection, axis_suffix):
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
    return trace, int(z.size)


# ------------------------------------------------------------
# Detection des artistes non supportes (-> fallback SVG)
# ------------------------------------------------------------
def _has_unsupported_artist(ax, bar_rectangles):
    from matplotlib.collections import Collection
    from matplotlib.patches import Patch
    from matplotlib.spines import Spine

    for child in ax.get_children():
        if isinstance(child, Spine):
            continue  # bordures des axes : ignorables (heritent de Patch)
        if isinstance(child, (Line2D, PathCollection, QuadMesh, AxesImage)):
            continue
        if isinstance(child, Rectangle):
            if child in bar_rectangles:
                continue
            # le rectangle de fond de l'axe est ignorable
            if child is ax.patch:
                continue
            return True
        # Toute autre Collection (LineCollection/PolyCollection de fill_between
        # et errorbar, ContourSet de contour/contourf, EventCollection...)
        # n'est pas convertie -> fallback SVG.
        if isinstance(child, Collection):
            return True
        if isinstance(child, Patch):
            return True
        # Text, Spine, Axis, Legend... : ignorables
    return False


# ------------------------------------------------------------
# Classification des axes (detection twinx)
# ------------------------------------------------------------
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
    """Pour chaque axe : {ax, suffix, is_twin, host_suffix}.
    Un axe est un twin (twinx) s'il partage X avec un axe precedent ET occupe
    la meme position. Les sous-graphes distincts (positions differentes) ne le
    sont pas, meme avec sharex=True."""
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
    layout["legend"] = legend_layout


# ------------------------------------------------------------
# Point d'entree
# ------------------------------------------------------------
def convert_figure(fig):
    """Figure matplotlib -> {"data": [...], "layout": {...}} ou None."""
    axes_list = [ax for ax in fig.get_axes() if ax.get_label() != "<colorbar>"]
    if len(axes_list) == 0:
        return None

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
        host_suffix = info["host_suffix"]
        axis_x = "xaxis" + suffix
        axis_y = "yaxis" + suffix
        axis_trace_start = len(data)

        # rectangles appartenant a des barres (pour la detection)
        bar_rectangles = set()
        for container in ax.containers:
            if isinstance(container, BarContainer):
                for p in container.patches:
                    bar_rectangles.add(p)

        if _has_unsupported_artist(ax, bar_rectangles):
            return None

        # text()/annotate() utilisateur ne sont pas convertis en Plotly :
        # pour ne pas les perdre silencieusement, on retombe sur le SVG.
        if len(ax.texts) > 0:
            return None

        # ---- traces ----
        for line in ax.get_lines():
            trace, n = _convert_line(line, suffix)
            if trace is not None:
                data.append(trace)
                total_points += n

        for child in ax.get_children():
            if isinstance(child, PathCollection):
                trace, n = _convert_scatter(child, suffix)
            elif isinstance(child, QuadMesh):
                trace, n = _convert_quadmesh(child, suffix)
            elif isinstance(child, AxesImage):
                trace, n = _convert_image(child, suffix)
            else:
                continue
            if trace is None:
                return None
            data.append(trace)
            total_points += n

        for container in ax.containers:
            if isinstance(container, BarContainer):
                trace, n = _convert_bars(container, suffix)
                if trace is not None:
                    data.append(trace)
                    total_points += n

        if total_points > _MAX_POINTS:
            return None

        # ---- axes temporels : datenums -> chaines ISO ----
        x_is_date = _is_date_axis(ax.xaxis)
        y_is_date = _is_date_axis(ax.yaxis)
        for trace in data[axis_trace_start:]:
            if x_is_date and "x" in trace:
                trace["x"] = _dates_to_iso(trace["x"])
            if y_is_date and "y" in trace:
                trace["y"] = _dates_to_iso(trace["y"])
            # Sur un axe date, Plotly attend la largeur des barres en
            # millisecondes (matplotlib la donne en jours).
            if trace.get("type") == "bar" and "width" in trace:
                horiz = trace.get("orientation") == "h"
                if (horiz and y_is_date) or (not horiz and x_is_date):
                    trace["width"] = [w * _MS_PER_DAY for w in trace["width"]]

        # legende (valable pour l'axe hote comme pour un axe twin)
        _apply_legend(layout, ax)

        # ---- twinx : l'axe secondaire reutilise le X de l'hote ----
        if is_twin:
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
            continue  # pas de bloc axe X / domaine / titre pour un twin

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
        return None

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
    }
