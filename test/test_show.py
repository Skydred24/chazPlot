# Test d'integration du routage dans show() : animation -> payload "frames",
# figure statique -> "plotly"/"svg"/"png". On intercepte l'envoi reseau.
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "python"))
os.environ["VSCODE_PLOTS_ANIM_DPI"] = "80"
os.environ["VSCODE_PLOTS_DPI"] = "100"

import matplotlib
matplotlib.use("Agg")
import numpy as np
import matplotlib.pyplot as plt
from matplotlib.animation import FuncAnimation

import vscode_spyder_plots_backend as be

# Intercepte les envois reseau
sent = []
be._send_figure = lambda payload: sent.append(payload) or True

# Figure 1 : animee
fig1, ax1 = plt.subplots()
line, = ax1.plot([], [])
ax1.set_xlim(0, 10); ax1.set_ylim(-1, 1)
anim = FuncAnimation(fig1, lambda i: (line.set_data(np.arange(10), np.sin(np.arange(10) + i)), line)[1:],
                     frames=6, interval=120)

# Figure 2 : statique simple (doit passer en plotly)
fig2, ax2 = plt.subplots()
ax2.plot([0, 1, 2], [0, 1, 4], label="carre")
ax2.legend()

be._BackendVSCodeSpyderPlots.show()

assert len(sent) == 2, "attendu 2 envois, obtenu %d" % len(sent)

# Retrouver chaque payload par titre n'est pas fiable -> on classe par contenu
anim_payloads = [p for p in sent if p.get("frames")]
static_payloads = [p for p in sent if not p.get("frames")]
assert len(anim_payloads) == 1, "attendu 1 payload anime"
assert len(static_payloads) == 1, "attendu 1 payload statique"

ap = anim_payloads[0]
assert len(ap["frames"]) == 6, "anim: attendu 6 frames, obtenu %d" % len(ap["frames"])
assert ap["interval"] == 120.0, "anim: interval attendu 120, obtenu %r" % ap["interval"]
assert "title" in ap
print("Animation routee OK:", len(ap["frames"]), "frames, interval", ap["interval"])

sp = static_payloads[0]
has_visual = sp.get("plotly") or sp.get("svg") or sp.get("png")
assert has_visual, "statique: aucun visuel"
print("Statique routee OK: plotly=%s svg=%s png=%s" % (
    sp.get("plotly") is not None, sp.get("svg") is not None, sp.get("png") is not None))

# show() doit avoir consomme les figures
from matplotlib._pylab_helpers import Gcf
assert len(Gcf.get_all_fig_managers()) == 0, "show() n'a pas ferme les figures"
print("Figures consommees OK")

print("\nTOUS LES TESTS D'INTEGRATION PASSENT")
