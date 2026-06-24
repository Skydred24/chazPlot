# ============================================================
# test_plots.py — script de validation de l'extension
# A lancer dans un NOUVEAU terminal VS Code :  python test_plots.py
# Les figures doivent apparaitre dans le panneau "Graphes".
# ============================================================

import numpy as np
import matplotlib.pyplot as plt
from matplotlib.animation import FuncAnimation

# # ---- Figure 1 : relation aire-Mach ----
# gamma = 1.4
# M = np.linspace(0.1, 4.0, 400)
# A_ratio = (1.0 / M) * ((2.0 / (gamma + 1.0)) * (1.0 + (gamma - 1.0) / 2.0 * M**2)) ** ((gamma + 1.0) / (2.0 * (gamma - 1.0)))

# fig1 = plt.figure(figsize=(7, 4))
# plt.plot(M, A_ratio, color="crimson")
# plt.axvline(1.0, color="gray", linestyle="--", linewidth=0.8)
# plt.xlabel("Mach")
# plt.ylabel("A / A*")
# plt.title("Relation aire-Mach (gamma = 1.4)")
# plt.grid(True, alpha=0.3)
# fig1.canvas.manager.set_window_title("aire_mach")
# plt.show()

# # ---- Figure 2 : deux sous-graphes ----
# x = np.linspace(0.0, 4.0 * np.pi, 500)
# fig2, axes = plt.subplots(2, 1, figsize=(7, 5), sharex=True)
# axes[0].plot(x, np.sin(x), color="steelblue")
# axes[0].set_ylabel("sin(x)")
# axes[1].plot(x, np.cos(x) * np.exp(-x / 6.0), color="darkorange")
# axes[1].set_ylabel("cos amorti")
# axes[1].set_xlabel("x")
# fig2.suptitle("Deux sous-graphes dans une figure")
# fig2.canvas.manager.set_window_title("sous_graphes")
# plt.show()

# # ---- Figure 3 : champ 2D ----
# xv, yv = np.meshgrid(np.linspace(-2, 2, 200), np.linspace(-2, 2, 200))
# z = np.exp(-(xv**2 + yv**2)) * np.cos(3.0 * xv)

# fig3 = plt.figure(figsize=(6, 5))
# plt.pcolormesh(xv, yv, z, shading="auto", cmap="plasma")
# plt.colorbar(label="amplitude")
# plt.title("Champ 2D — pcolormesh")
# fig3.canvas.manager.set_window_title("champ_2d")
# plt.show()

# # ---- Figure 4 : errorbar interactif ----
# xe = np.linspace(0.0, 5.0, 9)
# ye = np.exp(-0.35 * xe) * np.cos(2.0 * xe)
# yerr = 0.08 + 0.04 * xe
# xerr = np.full_like(xe, 0.06)

# fig4, ax4 = plt.subplots(figsize=(7, 4))
# ax4.errorbar(
#     xe,
#     ye,
#     yerr=yerr,
#     xerr=xerr,
#     fmt="o-",
#     capsize=4,
#     color="seagreen",
#     ecolor="darkslategray",
#     label="mesures +/- incertitude",
# )
# ax4.set_xlabel("temps (s)")
# ax4.set_ylabel("signal")
# ax4.set_title("Errorbar interactif : xerr + yerr")
# ax4.grid(True, alpha=0.3)
# ax4.legend()
# fig4.canvas.manager.set_window_title("interactive_errorbar")
# plt.show()

# # ---- Figure 5 : fill_between interactif ----
# xf = np.linspace(0.0, 10.0, 300)
# yf = np.sin(xf) * np.exp(-xf / 10.0)
# band = 0.18 + 0.04 * np.cos(1.5 * xf)

# fig5, ax5 = plt.subplots(figsize=(7, 4))
# ax5.plot(xf, yf, color="navy", linewidth=2.0, label="modele")
# ax5.fill_between(xf, yf - band, yf + band, color="cornflowerblue", alpha=0.28, label="bande +/-")
# ax5.axhline(0.0, color="gray", linewidth=0.8, linestyle="--")

# ax5.set_xlabel("x")
# ax5.set_ylabel("amplitude")
# ax5.set_title("Fill between interactif : bande d'incertitude")
# ax5.grid(True, alpha=0.3)
# ax5.legend()
# fig5.canvas.manager.set_window_title("interactive_fill_between")
# plt.show()

# # ---- Figure 6 : text() et annotate() interactifs ----
# xt = np.linspace(0.0, 2.0 * np.pi, 300)
# yt = np.sin(xt)
# imax = int(np.argmax(yt))
# imin = int(np.argmin(yt))

# fig6, ax6 = plt.subplots(figsize=(7, 4))
# ax6.plot(xt, yt, color="purple", label="sin(x)")
# ax6.scatter([xt[imax], xt[imin]], [yt[imax], yt[imin]], color="crimson", zorder=3)
# ax6.annotate(
#     "maximum",
#     xy=(xt[imax], yt[imax]),
#     xytext=(xt[imax] + 0.7, yt[imax] - 0.25),
#     arrowprops={"arrowstyle": "->", "color": "crimson"},
#     color="crimson",
# )
# ax6.annotate(
#     "minimum",
#     xy=(xt[imin], yt[imin]),
#     xytext=(xt[imin] - 1.2, yt[imin] + 0.35),
#     arrowprops={"arrowstyle": "->", "color": "darkorange"},
#     color="darkorange",
# )
# ax6.text(0.03, 0.92, "texte en coordonnees d'axe", transform=ax6.transAxes, color="black")
# ax6.text(5.1, 0.45, "texte en donnees", color="teal", rotation=15)
# ax6.set_xlabel("x")
# ax6.set_ylabel("sin(x)")
# ax6.set_title("Textes et annotations interactifs")
# ax6.grid(True, alpha=0.3)
# fig6.canvas.manager.set_window_title("interactive_annotations")
# plt.show()

# # ---- Figure 7 : combinaison sur subplots ----
# xc = np.linspace(0.0, 6.0, 80)
# yc1 = np.sin(1.8 * xc) * np.exp(-xc / 8.0)
# yc2 = 0.4 + 0.12 * np.cos(2.5 * xc)

# fig7, (ax7a, ax7b) = plt.subplots(1, 2, figsize=(9, 4))
# ax7a.plot(xc, yc1, color="steelblue", label="simulation")
# ax7a.fill_between(xc, yc1 - 0.12, yc1 + 0.12, color="lightskyblue", alpha=0.35, label="enveloppe")
# ax7a.annotate("zone stable", xy=(3.2, yc1[np.searchsorted(xc, 3.2)]), xytext=(3.8, 0.55), arrowprops={"arrowstyle": "->"})
# ax7a.set_title("Subplot + fill_between")
# ax7a.grid(True, alpha=0.3)
# ax7a.legend()

# ax7b.errorbar(xc[::8], yc2[::8], yerr=0.04, fmt="s", capsize=3, color="darkred", label="points")
# ax7b.plot(xc, yc2, color="salmon", linewidth=1.5, label="tendance")
# ax7b.text(0.05, 0.9, "subplot 2", transform=ax7b.transAxes, color="black")
# ax7b.set_title("Subplot + errorbar")
# ax7b.grid(True, alpha=0.3)
# ax7b.legend()
# fig7.suptitle("Cas combines interactifs")
# fig7.canvas.manager.set_window_title("interactive_combo_subplots")
# plt.show()

# # ---- Figure 8 : animation (onde qui se propage) ----
# fig8, ax8 = plt.subplots(figsize=(7, 4))
# xa = np.linspace(0.0, 4.0 * np.pi, 400)
# (line_a,) = ax8.plot(xa, np.sin(xa), color="teal")
# env_up, = ax8.plot(xa, np.exp(-xa / 10.0), color="gray", linewidth=0.8, linestyle="--")
# env_dn, = ax8.plot(xa, -np.exp(-xa / 10.0), color="gray", linewidth=0.8, linestyle="--")
# ax8.set_ylim(-1.2, 1.2)
# ax8.set_xlabel("x")
# ax8.set_ylabel("amplitude")
# ax8.set_title("Onde amortie qui se propage")
# ax8.grid(True, alpha=0.3)

# def _update(frame):
#     phase = frame * 0.25
#     line_a.set_ydata(np.sin(xa - phase) * np.exp(-xa / 10.0))
#     return (line_a,)

# # garder une reference a l'objet animation (sinon il peut etre collecte)
# anim = FuncAnimation(fig8, _update, frames=60, interval=40)
# fig8.canvas.manager.set_window_title("onde_animee")
# plt.show()




# Configuration des données communes
x = np.linspace(0, 10, 250)

# # =====================================================================
# # CAS 1 : 5 PAIRES DE COURBES (Séparées en 2 Figures)
# # =====================================================================
# n_pairs = 5
# colors_pairs = ['crimson', 'royalblue', 'forestgreen', 'darkorange', 'purple']

# # --- Figure 1 : Uniquement les Références ---
# plt.figure(1, figsize=(9, 5))
# for i in range(n_pairs):
#     y_ref = np.sin(x + i * 0.5)
#     plt.plot(x, y_ref, color=colors_pairs[i], linewidth=2, label=f"Réf {i+1}")

# plt.title("Cas 1 : Les 5 Courbes de Référence", fontsize=12, fontweight='bold')
# plt.xlabel("X")
# plt.ylabel("Valeurs")
# plt.grid(True, linestyle=":", alpha=0.5)
# plt.legend(loc="upper right")
# plt.tight_layout()

# # --- Figure 2 : Uniquement les Tests ---
# plt.figure(2, figsize=(9, 5))
# for i in range(n_pairs):
#     y_ref = np.sin(x + i * 0.5)
#     y_test = y_ref + np.random.normal(0, 0.08, size=x.shape) # Ta variable de test
#     plt.plot(x, y_test, color=colors_pairs[i], linestyle="--", alpha=0.8, label=f"Test {i+1}")

# plt.title("Cas 2 : Les 5 Courbes de Test", fontsize=12, fontweight='bold')
# plt.xlabel("X")
# plt.ylabel("Valeurs")
# plt.grid(True, linestyle=":", alpha=0.5)
# plt.legend(loc="upper right")
# plt.tight_layout()


# =====================================================================
# CAS 2 : 4 GROUPES DE 3 COURBES (Séparés en 2 Figures)
# =====================================================================
n_groups = 4
colors_groups = ['#E66101', '#92C5DE', '#5E3C99', '#FDB863']

# --- Figure 3 : Uniquement les Références des Groupes ---
plt.figure(3, figsize=(9, 5))
for i in range(n_groups):
    y_ref = np.cos(x * (0.5 + i * 0.2))
    plt.plot(x, y_ref, color=colors_groups[i], linewidth=2.5, label=f"Gr. {i+1} - Réf")

plt.title("Cas 2 : Références des 4 Groupes", fontsize=12, fontweight='bold')
plt.xlabel("X")
plt.ylabel("Amplitude")
plt.grid(True, linestyle=":", alpha=0.5)
plt.legend(loc="lower left")
plt.tight_layout()

# --- Figure 4 : Uniquement les Tests (A et B) des Groupes ---
plt.figure(4, figsize=(9, 5))
for i in range(n_groups):
    y_ref = np.cos(x * (0.5 + i * 0.2))
    y_test1 = y_ref + np.random.normal(0, 0.1, size=x.shape)  # Ton Test A
    y_test2 = y_ref * 0.8 + np.sin(x * 2) * 0.1               # Ton Test B
    
    # On garde la couleur du groupe, mais on varie les styles pour Test A et Test B
    plt.plot(x, y_test1, color=colors_groups[i], linestyle="-.", linewidth=1.2, label=f"Gr. {i+1} - Test A")
    plt.plot(x, y_test2, color=colors_groups[i], linestyle="--", linewidth=1.2, label=f"Gr. {i+1} - Test B")

plt.title("Cas 2 : Courbes de Test (A & B) des 4 Groupes", fontsize=12, fontweight='bold')
plt.xlabel("X")
plt.ylabel("Amplitude")
plt.grid(True, linestyle=":", alpha=0.5)
plt.legend(loc="lower left", ncol=2) # En 2 colonnes pour que ce soit propre
plt.tight_layout()

# Affichage de toutes les fenêtres en même temps
plt.show()

# =====================================================================
# CAS 3 : STYLE SCIENCEPLOTS (rendu fidele a l'export)
# Le style doit etre actif PENDANT la construction de la figure :
# on entoure le trace ET le plt.show() d'un plt.style.context(...).
# Les styles 'science'/'ieee'/'nature' sont enregistres par le backend,
# pas besoin d'installer le package scienceplots.
# =====================================================================

def _model(xv, p):
    # petite famille de courbes facon "loi de puissance" (exemple SciencePlots)
    return xv ** (2 * p + 1) / (1 + xv ** (2 * p + 1))

xs = np.linspace(0.75, 1.25, 201)
pwrs = [1, 2, 3, 4]

# --- Figure A : SANS style (reference visuelle) ---
fig_a, ax_a = plt.subplots(figsize=(5, 3.75))
for p in pwrs:
    ax_a.plot(xs, _model(xs, p), label=str(p))
ax_a.legend(title="Ordre")
ax_a.set_xlabel("Tension (V)")
ax_a.set_ylabel("Courant (uA)")
ax_a.set_title("Sans style")
ax_a.set_xlim(0.75, 1.25)
ax_a.set_ylim(0.0, 1.0)
fig_a.canvas.manager.set_window_title("sciplot_sans_style")
plt.show()

# --- Figure B : style 'science' ---
with plt.style.context('science'):
    fig_b, ax_b = plt.subplots(figsize=(5, 3.75))
    for p in pwrs:
        ax_b.plot(xs, _model(xs, p), label=str(p))
    ax_b.legend(title="Ordre")
    ax_b.set_xlabel("Tension (V)")
    ax_b.set_ylabel("Courant (uA)")
    ax_b.set_title("Style science")
    ax_b.set_xlim(0.75, 1.25)
    ax_b.set_ylim(0.0, 1.0)
    fig_b.canvas.manager.set_window_title("sciplot_science")
    plt.show()

# --- Figure C : empilement 'science' + 'ieee' (deux colonnes, N&B) ---
with plt.style.context(['science', 'ieee']):
    fig_c, ax_c = plt.subplots()
    for p in pwrs:
        ax_c.plot(xs, _model(xs, p), label=str(p))
    ax_c.legend(title="Ordre")
    ax_c.set_xlabel("Tension (V)")
    ax_c.set_ylabel("Courant (uA)")
    ax_c.set_title("Style science + ieee")
    ax_c.set_xlim(0.75, 1.25)
    ax_c.set_ylim(0.0, 1.0)
    fig_c.canvas.manager.set_window_title("sciplot_science_ieee")
    plt.show()

print("7 figures + 1 animation envoyees au panneau Graphes.")
