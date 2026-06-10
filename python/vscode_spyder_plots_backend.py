# ============================================================
# vscode_spyder_plots_backend.py
# Backend matplotlib pour l'extension VS Code "Spyder Plots".
#
# Principe (identique a Spyder) :
#   - le rendu est fait hors ecran avec Agg ;
#   - plt.show() serialise chaque figure ouverte en PNG (base64)
#     et l'envoie en HTTP au serveur local de l'extension ;
#   - les figures sont ensuite fermees (comme dans Spyder),
#     et le script continue sans bloquer.
#
# Active automatiquement par l'extension via les variables
# d'environnement MPLBACKEND, PYTHONPATH, VSCODE_PLOTS_PORT.
# Aucune dependance hors bibliotheque standard + matplotlib.
# ============================================================

import base64
import io
import json
import os
import sys
import struct
import urllib.request
import urllib.error

from matplotlib.backend_bases import _Backend, FigureManagerBase
from matplotlib.backends.backend_agg import FigureCanvasAgg
from matplotlib._pylab_helpers import Gcf

_WARNED = False


def _port():
    return os.environ.get("VSCODE_PLOTS_PORT", "53210")


def _dpi():
    try:
        return float(os.environ.get("VSCODE_PLOTS_DPI", "144"))
    except ValueError:
        return 144.0


def _send_figure(png_bytes, title):
    """Envoie une figure (PNG) au serveur local de l'extension."""
    global _WARNED
    payload = {
        "png": base64.b64encode(png_bytes).decode("ascii"),
        "title": title,
    }
    url = "http://127.0.0.1:" + _port() + "/figure"
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        urllib.request.urlopen(request, timeout=3.0)
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
    """Titre de la fenetre si defini, sinon 'Figure N'."""
    title = None
    try:
        title = manager.get_window_title()
    except Exception:
        title = None
    if title is None or title == "":
        title = "Figure " + str(manager.num)
    return title


@_Backend.export
class _BackendVSCodeSpyderPlots(_Backend):
    FigureCanvas = FigureCanvasAgg
    FigureManager = FigureManagerBase

    @classmethod
    def show(cls, block=None):
        """Appele par plt.show() : envoie toutes les figures ouvertes,
        puis les ferme (comportement Spyder). Ne bloque jamais."""
        managers = Gcf.get_all_fig_managers()
        if len(managers) == 0:
            return

        for manager in managers:
            figure = manager.canvas.figure
            buffer = io.BytesIO()
            try:
                figure.savefig(
                    buffer,
                    format="png",
                    dpi=_dpi(),
                    bbox_inches="tight",
                    facecolor=figure.get_facecolor(),
                    edgecolor="none",
                )
            except Exception as error:
                sys.stderr.write("[spyder-plots] Echec du rendu d'une figure : " + str(error) + "\n")
                continue
            _send_figure(buffer.getvalue(), _figure_title(manager))

        # Comme Spyder : les figures sont consommees par show().
        Gcf.destroy_all()
