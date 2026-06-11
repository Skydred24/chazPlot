# ============================================================
# vscode_spyder_plots_backend.py — v3 (figures + animations)
#
# Backend matplotlib qui envoie le contenu de plt.show() vers le
# panneau VS Code de l'extension.
#
# Figures statiques : envoyees en plusieurs formats
#     - "plotly" : graphe interactif (priorite, vectoriel)
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
_SVG_MAX_BYTES = 8 * 1024 * 1024  # au-dela : fallback PNG pour l'affichage

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
    """Envoie une figure (ou une animation) au serveur local de l'extension."""
    global _WARNED
    url = "http://127.0.0.1:" + _port() + "/figure"
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        urllib.request.urlopen(request, timeout=15.0)
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

            _send_figure({
                "title": title,
                "plotly": plotly_spec,
                "svg": base64.b64encode(svg_bytes).decode("ascii") if svg_bytes is not None else None,
                "png": base64.b64encode(png_bytes).decode("ascii") if png_bytes is not None else None,
            })

        # Comme Spyder : les figures sont consommees par show().
        Gcf.destroy_all()


# Hook installe des l'import du backend (et re-tente a chaque show()).
_install_animation_hook()
