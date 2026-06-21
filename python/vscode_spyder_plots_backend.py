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
    """Port du serveur de l'extension, depuis l'env injecte (defaut 53210)."""
    return os.environ.get("VSCODE_PLOTS_PORT", "53210")


def _port_file_path():
    """Chemin du fichier tmp ou l'extension publie son port actif (fallback)."""
    import tempfile
    return os.path.join(tempfile.gettempdir(), "chaz-plots-port.json")


def _port_from_file():
    """Port actif ecrit par l'extension (fallback si l'env est perime)."""
    try:
        with open(_port_file_path(), "r", encoding="utf-8") as handle:
            data = json.load(handle)
        return str(int(data.get("port")))
    except Exception:
        return None


def _dpi():
    """DPI de rendu des figures statiques (env VSCODE_PLOTS_DPI, defaut 200)."""
    try:
        return float(os.environ.get("VSCODE_PLOTS_DPI", "200"))
    except ValueError:
        return 200.0


def _pdf_enabled():
    """Generer aussi un PDF vectoriel matplotlib (env VSCODE_PLOTS_PDF, defaut 1).
    Mis a 0 par l'extension si le reglage chazPlots.includePdf est desactive."""
    return os.environ.get("VSCODE_PLOTS_PDF", "1") != "0"


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
        sys.stderr.write("[chaz-plots] Echec de capture de l'animation : " + str(error) + "\n")
        return None, None

    frames = collector.frames
    if not frames:
        return None, None
    cap = _anim_max_frames()
    if cap is not None and len(frames) > cap:
        frames = frames[:cap]
        sys.stderr.write(
            "[chaz-plots] Animation tronquee a "
            + str(cap)
            + " frames (reglez chazPlots.animationMaxFrames, 0 = illimite).\n"
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
            "[chaz-plots] Impossible de joindre l'extension VS Code sur le port "
            + _port()
            + ". Verifiez que l'extension est active, puis ouvrez un NOUVEAU terminal.\n"
        )
    return False


# ------------------------------------------------------------
# Provenance : d'ou vient une figure (script, ligne, env, git, date)
# ------------------------------------------------------------
_GIT_CACHE = {}


def _caller_frame():
    """Premiere frame de la pile qui n'appartient ni a ce backend ni a
    matplotlib : c'est le code utilisateur qui a appele plt.show()."""
    frame = sys._getframe()
    while frame is not None:
        name = frame.f_code.co_filename
        in_mpl = (os.sep + "matplotlib" + os.sep) in name
        if name != __file__ and not in_mpl and not name.startswith("<"):
            return frame
        frame = frame.f_back
    return None


def _git_info(cwd):
    """Etat git du depot contenant cwd (commit court, branche, modifie ?).
    Mis en cache par cwd ; tout echec (pas de git, pas un depot) -> None."""
    if cwd in _GIT_CACHE:
        return _GIT_CACHE[cwd]
    info = {"git_commit": None, "git_branch": None, "git_dirty": None}
    try:
        import subprocess

        def run(args):
            return subprocess.run(
                ["git"] + args, cwd=cwd,
                capture_output=True, text=True, timeout=2.0,
            )

        head = run(["rev-parse", "--short", "HEAD"])
        if head.returncode == 0:
            info["git_commit"] = head.stdout.strip()
            branch = run(["rev-parse", "--abbrev-ref", "HEAD"])
            if branch.returncode == 0:
                info["git_branch"] = branch.stdout.strip()
            status = run(["status", "--porcelain"])
            if status.returncode == 0:
                info["git_dirty"] = bool(status.stdout.strip())
    except Exception:
        pass
    _GIT_CACHE[cwd] = info
    return info


def _provenance():
    """Contexte de production des figures du show() courant : script + ligne
    d'appel, cwd, interpreteur, ligne de commande, etat git, date complete.
    Best-effort : chaque champ indisponible reste None."""
    import datetime

    cwd = os.getcwd()
    prov = {
        "timestamp": datetime.datetime.now().astimezone().isoformat(timespec="seconds"),
        "cwd": cwd,
        "python": sys.executable,
        "python_version": sys.version.split()[0],
        "command": " ".join(sys.argv) if sys.argv else None,
        "script": None,
        "source": None,
        "line": None,
        "function": None,
    }
    try:
        if sys.argv and sys.argv[0]:
            prov["script"] = os.path.abspath(sys.argv[0])
    except Exception:
        pass
    frame = _caller_frame()
    if frame is not None:
        prov["source"] = frame.f_code.co_filename
        prov["line"] = frame.f_lineno
        prov["function"] = frame.f_code.co_name
    prov.update(_git_info(cwd))
    return prov


def _figure_title(manager):
    """Titre de la figure : le window title s'il existe, sinon "Figure <num>"."""
    title = None
    try:
        title = manager.get_window_title()
    except Exception:
        title = None
    if title is None or title == "":
        title = "Figure " + str(manager.num)
    return title


def _render_diag(plotly_spec, svg_bytes, plotly_reason, svg_too_big):
    """Diagnostic de rendu transmis a l'UI (badge + raison du repli).

    mode in {"plotly", "svg", "png"} ; pour un repli, code/message/detail
    reprennent la raison renvoyee par le convertisseur (cf. convert_figure_with_reason),
    ou signalent un SVG trop volumineux."""
    if plotly_spec is not None:
        return {"mode": "plotly"}
    base = plotly_reason or {
        "code": "unknown",
        "message": "Rendu interactif indisponible",
        "detail": None,
    }
    if svg_bytes is not None:
        return {
            "mode": "svg",
            "code": base.get("code"),
            "message": base.get("message"),
            "detail": base.get("detail"),
        }
    if svg_too_big:
        return {
            "mode": "png",
            "code": "svg_too_big",
            "message": "Rendu SVG trop volumineux (> 8 Mo)",
            "detail": base.get("message"),
        }
    return {
        "mode": "png",
        "code": base.get("code"),
        "message": base.get("message"),
        "detail": base.get("detail"),
    }


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
            "[chaz-plots] Echec du rendu " + file_format + " : " + str(error) + "\n"
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

        # Provenance commune a toutes les figures de ce plt.show() (meme site
        # d'appel, meme instant, meme etat git).
        provenance = _provenance()

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
                        "render": {"mode": "animation"},
                        "provenance": provenance,
                    })
                    continue
                # echec de capture -> on retombe sur un rendu statique

            # --- 2) figure statique ---
            plotly_spec = None
            plotly_reason = None
            try:
                from _mpl_to_plotly import convert_figure_with_reason
                plotly_spec, plotly_reason = convert_figure_with_reason(figure)
            except Exception as error:
                plotly_spec = None
                plotly_reason = {
                    "code": "exception",
                    "message": "Erreur interne du convertisseur",
                    "detail": str(error),
                }

            png_bytes = _render(figure, "png", _dpi())
            svg_bytes = None
            svg_too_big = False
            if plotly_spec is None:
                svg_bytes = _render(figure, "svg", _dpi())
                if svg_bytes is not None and len(svg_bytes) > _SVG_MAX_BYTES:
                    svg_bytes = None
                    svg_too_big = True

            if plotly_spec is None and svg_bytes is None and png_bytes is None:
                continue

            # PDF vectoriel matplotlib (rendu natif, fidele) pour la sauvegarde
            # PDF et le bundle publication. Optionnel (cf. _pdf_enabled).
            pdf_bytes = _render(figure, "pdf", _dpi()) if _pdf_enabled() else None

            render = _render_diag(plotly_spec, svg_bytes, plotly_reason, svg_too_big)

            # PGF/TikZ is intentionally not generated during capture.
            # It is fragile on complex matplotlib artists, while PNG/SVG export
            # is reliable and can be included from LaTeX with \includegraphics.
            _send_figure({
                "title": title,
                "plotly": plotly_spec,
                "pgf": None,
                "svg": base64.b64encode(svg_bytes).decode("ascii") if svg_bytes is not None else None,
                "png": base64.b64encode(png_bytes).decode("ascii") if png_bytes is not None else None,
                "pdf": base64.b64encode(pdf_bytes).decode("ascii") if pdf_bytes is not None else None,
                "render": render,
                "provenance": provenance,
            })

        # Comme Spyder : les figures sont consommees par show().
        Gcf.destroy_all()


# Hook installe des l'import du backend (et re-tente a chaque show()).
_install_animation_hook()
