# ============================================================
# vscode_spyder_plots_backend.py — v2 (rendu vectoriel)
#
# Changement par rapport a la v1 :
#   chaque figure est envoyee en DEUX formats :
#     - "svg" : vectoriel, utilise pour l'AFFICHAGE dans le panneau
#               -> net a n'importe quelle taille, comme Spyder/VS Code
#     - "png" : haute resolution, utilise pour l'ENREGISTREMENT
#   Si le SVG est trop lourd (figures a tres nombreux points),
#   il est abandonne et le panneau affiche le PNG a la place.
# ============================================================

import base64
import io
import json
import os
import sys
import urllib.request
import urllib.error

from matplotlib.backend_bases import _Backend, FigureManagerBase
from matplotlib.backends.backend_agg import FigureCanvasAgg
from matplotlib._pylab_helpers import Gcf

_WARNED = False
_SVG_MAX_BYTES = 8 * 1024 * 1024  # au-dela : fallback PNG pour l'affichage


def _port():
    return os.environ.get("VSCODE_PLOTS_PORT", "53210")


def _dpi():
    try:
        return float(os.environ.get("VSCODE_PLOTS_DPI", "200"))
    except ValueError:
        return 200.0


def _send_figure(payload):
    """Envoie une figure au serveur local de l'extension."""
    global _WARNED
    url = "http://127.0.0.1:" + _port() + "/figure"
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        urllib.request.urlopen(request, timeout=5.0)
        return True
    except (urllib.error.URLError, OSError):
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


@_Backend.export
class _BackendVSCodeSpyderPlots(_Backend):
    FigureCanvas = FigureCanvasAgg
    FigureManager = FigureManagerBase

    @classmethod
    def show(cls, block=None):
        """Appele par plt.show() : envoie toutes les figures ouvertes
        (SVG pour l'affichage + PNG pour la sauvegarde), puis les ferme.
        Ne bloque jamais."""
        managers = Gcf.get_all_fig_managers()
        if len(managers) == 0:
            return

        for manager in managers:
            figure = manager.canvas.figure

            # 1) tentative de conversion en graphe interactif Plotly
            plotly_spec = None
            try:
                from _mpl_to_plotly import convert_figure
                plotly_spec = convert_figure(figure)
            except Exception:
                plotly_spec = None

            # 2) rendus image : PNG toujours (sauvegarde), SVG en
            #    fallback d'affichage si la conversion a echoue
            png_bytes = _render(figure, "png", _dpi())
            svg_bytes = None
            if plotly_spec is None:
                svg_bytes = _render(figure, "svg", _dpi())
                if svg_bytes is not None and len(svg_bytes) > _SVG_MAX_BYTES:
                    svg_bytes = None

            if plotly_spec is None and svg_bytes is None and png_bytes is None:
                continue

            payload = {
                "title": _figure_title(manager),
                "plotly": plotly_spec,
                "svg": base64.b64encode(svg_bytes).decode("ascii") if svg_bytes is not None else None,
                "png": base64.b64encode(png_bytes).decode("ascii") if png_bytes is not None else None,
            }
            _send_figure(payload)

        # Comme Spyder : les figures sont consommees par show().
        Gcf.destroy_all()
