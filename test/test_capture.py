# Test isole de la capture de frames d'animation par le backend.
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "python"))
os.environ["VSCODE_PLOTS_ANIM_DPI"] = "80"

import matplotlib
matplotlib.use("Agg")
import numpy as np
import matplotlib.pyplot as plt
from matplotlib.animation import FuncAnimation, ArtistAnimation

import vscode_spyder_plots_backend as be  # installe le hook a l'import

# --- FuncAnimation ---
fig, ax = plt.subplots()
line, = ax.plot([], [])
ax.set_xlim(0, 2 * np.pi); ax.set_ylim(-1, 1)
def update(i):
    x = np.linspace(0, 2 * np.pi, 100)
    line.set_data(x, np.sin(x + i * 0.3))
    return (line,)
anim = FuncAnimation(fig, update, frames=12, interval=50)

frames, interval = be._capture_animation(anim)
assert frames is not None, "FuncAnimation: pas de frames"
assert len(frames) == 12, "FuncAnimation: attendu 12 frames, obtenu %r" % len(frames)
assert interval == 50.0, "interval attendu 50, obtenu %r" % interval
import base64
assert base64.b64decode(frames[0])[:8] == b"\x89PNG\r\n\x1a\n", "frame 0 n'est pas un PNG"
print("FuncAnimation OK:", len(frames), "frames, interval", interval, "ms, premiere frame", len(frames[0]), "octets b64")

# --- le hook a-t-il enregistre l'animation ? ---
found = be._animations_for_figure(fig)
assert anim in found, "hook: animation non retrouvee depuis la figure"
print("Hook _animations_for_figure OK:", len(found), "animation(s)")

# --- ArtistAnimation ---
fig2, ax2 = plt.subplots()
artists = []
x = np.linspace(0, 2 * np.pi, 100)
for i in range(8):
    ln, = ax2.plot(x, np.sin(x + i * 0.5), color="C0")
    artists.append([ln])
anim2 = ArtistAnimation(fig2, artists, interval=100)
frames2, interval2 = be._capture_animation(anim2)
assert frames2 is not None and len(frames2) == 8, "ArtistAnimation: attendu 8 frames, obtenu %r" % (
    None if frames2 is None else len(frames2))
print("ArtistAnimation OK:", len(frames2), "frames, interval", interval2, "ms")

print("\nTOUS LES TESTS PASSENT")
