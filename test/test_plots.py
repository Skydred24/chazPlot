# ============================================================
# test_plots.py — script de validation de l'extension
# A lancer dans un NOUVEAU terminal VS Code :  python test_plots.py
# Les figures doivent apparaitre dans le panneau "Graphes".
# ============================================================

import numpy as np
import matplotlib.pyplot as plt
from matplotlib.animation import FuncAnimation

# ---- Figure 1 : relation aire-Mach ----
gamma = 1.4
M = np.linspace(0.1, 4.0, 400)
A_ratio = (1.0 / M) * ((2.0 / (gamma + 1.0)) * (1.0 + (gamma - 1.0) / 2.0 * M**2)) ** ((gamma + 1.0) / (2.0 * (gamma - 1.0)))

fig1 = plt.figure(figsize=(7, 4))
plt.plot(M, A_ratio, color="crimson")
plt.axvline(1.0, color="gray", linestyle="--", linewidth=0.8)
plt.xlabel("Mach")
plt.ylabel("A / A*")
plt.title("Relation aire-Mach (gamma = 1.4)")
plt.grid(True, alpha=0.3)
fig1.canvas.manager.set_window_title("aire_mach")
plt.show()

# ---- Figure 2 : deux sous-graphes ----
x = np.linspace(0.0, 4.0 * np.pi, 500)
fig2, axes = plt.subplots(2, 1, figsize=(7, 5), sharex=True)
axes[0].plot(x, np.sin(x), color="steelblue")
axes[0].set_ylabel("sin(x)")
axes[1].plot(x, np.cos(x) * np.exp(-x / 6.0), color="darkorange")
axes[1].set_ylabel("cos amorti")
axes[1].set_xlabel("x")
fig2.suptitle("Deux sous-graphes dans une figure")
fig2.canvas.manager.set_window_title("sous_graphes")
plt.show()

# ---- Figure 3 : champ 2D ----
xv, yv = np.meshgrid(np.linspace(-2, 2, 200), np.linspace(-2, 2, 200))
z = np.exp(-(xv**2 + yv**2)) * np.cos(3.0 * xv)

fig3 = plt.figure(figsize=(6, 5))
plt.pcolormesh(xv, yv, z, shading="auto", cmap="plasma")
plt.colorbar(label="amplitude")
plt.title("Champ 2D — pcolormesh")
fig3.canvas.manager.set_window_title("champ_2d")
plt.show()

# ---- Figure 4 : errorbar interactif ----
xe = np.linspace(0.0, 5.0, 9)
ye = np.exp(-0.35 * xe) * np.cos(2.0 * xe)
yerr = 0.08 + 0.04 * xe
xerr = np.full_like(xe, 0.06)

fig4, ax4 = plt.subplots(figsize=(7, 4))
ax4.errorbar(
    xe,
    ye,
    yerr=yerr,
    xerr=xerr,
    fmt="o-",
    capsize=4,
    color="seagreen",
    ecolor="darkslategray",
    label="mesures +/- incertitude",
)
ax4.set_xlabel("temps (s)")
ax4.set_ylabel("signal")
ax4.set_title("Errorbar interactif : xerr + yerr")
ax4.grid(True, alpha=0.3)
ax4.legend()
fig4.canvas.manager.set_window_title("interactive_errorbar")
plt.show()

# ---- Figure 5 : fill_between interactif ----
xf = np.linspace(0.0, 10.0, 300)
yf = np.sin(xf) * np.exp(-xf / 10.0)
band = 0.18 + 0.04 * np.cos(1.5 * xf)

fig5, ax5 = plt.subplots(figsize=(7, 4))
ax5.plot(xf, yf, color="navy", linewidth=2.0, label="modele")
ax5.fill_between(xf, yf - band, yf + band, color="cornflowerblue", alpha=0.28, label="bande +/-")
ax5.axhline(0.0, color="gray", linewidth=0.8, linestyle="--")

ax5.set_xlabel("x")
ax5.set_ylabel("amplitude")
ax5.set_title("Fill between interactif : bande d'incertitude")
ax5.grid(True, alpha=0.3)
ax5.legend()
fig5.canvas.manager.set_window_title("interactive_fill_between")
plt.show()

# ---- Figure 6 : text() et annotate() interactifs ----
xt = np.linspace(0.0, 2.0 * np.pi, 300)
yt = np.sin(xt)
imax = int(np.argmax(yt))
imin = int(np.argmin(yt))

fig6, ax6 = plt.subplots(figsize=(7, 4))
ax6.plot(xt, yt, color="purple", label="sin(x)")
ax6.scatter([xt[imax], xt[imin]], [yt[imax], yt[imin]], color="crimson", zorder=3)
ax6.annotate(
    "maximum",
    xy=(xt[imax], yt[imax]),
    xytext=(xt[imax] + 0.7, yt[imax] - 0.25),
    arrowprops={"arrowstyle": "->", "color": "crimson"},
    color="crimson",
)
ax6.annotate(
    "minimum",
    xy=(xt[imin], yt[imin]),
    xytext=(xt[imin] - 1.2, yt[imin] + 0.35),
    arrowprops={"arrowstyle": "->", "color": "darkorange"},
    color="darkorange",
)
ax6.text(0.03, 0.92, "texte en coordonnees d'axe", transform=ax6.transAxes, color="black")
ax6.text(5.1, 0.45, "texte en donnees", color="teal", rotation=15)
ax6.set_xlabel("x")
ax6.set_ylabel("sin(x)")
ax6.set_title("Textes et annotations interactifs")
ax6.grid(True, alpha=0.3)
fig6.canvas.manager.set_window_title("interactive_annotations")
plt.show()

# ---- Figure 7 : combinaison sur subplots ----
xc = np.linspace(0.0, 6.0, 80)
yc1 = np.sin(1.8 * xc) * np.exp(-xc / 8.0)
yc2 = 0.4 + 0.12 * np.cos(2.5 * xc)

fig7, (ax7a, ax7b) = plt.subplots(1, 2, figsize=(9, 4))
ax7a.plot(xc, yc1, color="steelblue", label="simulation")
ax7a.fill_between(xc, yc1 - 0.12, yc1 + 0.12, color="lightskyblue", alpha=0.35, label="enveloppe")
ax7a.annotate("zone stable", xy=(3.2, yc1[np.searchsorted(xc, 3.2)]), xytext=(3.8, 0.55), arrowprops={"arrowstyle": "->"})
ax7a.set_title("Subplot + fill_between")
ax7a.grid(True, alpha=0.3)
ax7a.legend()

ax7b.errorbar(xc[::8], yc2[::8], yerr=0.04, fmt="s", capsize=3, color="darkred", label="points")
ax7b.plot(xc, yc2, color="salmon", linewidth=1.5, label="tendance")
ax7b.text(0.05, 0.9, "subplot 2", transform=ax7b.transAxes, color="black")
ax7b.set_title("Subplot + errorbar")
ax7b.grid(True, alpha=0.3)
ax7b.legend()
fig7.suptitle("Cas combines interactifs")
fig7.canvas.manager.set_window_title("interactive_combo_subplots")
plt.show()

# ---- Figure 8 : animation (onde qui se propage) ----
fig8, ax8 = plt.subplots(figsize=(7, 4))
xa = np.linspace(0.0, 4.0 * np.pi, 400)
(line_a,) = ax8.plot(xa, np.sin(xa), color="teal")
env_up, = ax8.plot(xa, np.exp(-xa / 10.0), color="gray", linewidth=0.8, linestyle="--")
env_dn, = ax8.plot(xa, -np.exp(-xa / 10.0), color="gray", linewidth=0.8, linestyle="--")
ax8.set_ylim(-1.2, 1.2)
ax8.set_xlabel("x")
ax8.set_ylabel("amplitude")
ax8.set_title("Onde amortie qui se propage")
ax8.grid(True, alpha=0.3)

def _update(frame):
    phase = frame * 0.25
    line_a.set_ydata(np.sin(xa - phase) * np.exp(-xa / 10.0))
    return (line_a,)

# garder une reference a l'objet animation (sinon il peut etre collecte)
anim = FuncAnimation(fig8, _update, frames=60, interval=40)
fig8.canvas.manager.set_window_title("onde_animee")
plt.show()

print("7 figures + 1 animation envoyees au panneau Graphes.")
