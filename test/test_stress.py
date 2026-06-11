# ============================================================
# test_stress.py — banc de torture de l'extension Spyder Plots
#
# Objectif : pousser le rendu dans ses retranchements pour reveler
# les LIMITES REELLES (legende illisible / mal placee, titres,
# axes exotiques, artistes non convertis -> fallback SVG, perfs...).
#
# A lancer dans un NOUVEAU terminal VS Code :
#     python test/test_stress.py
#
# Chaque figure porte un titre de fenetre prefixe par une categorie :
#   [PLOTLY]   devrait passer en graphe interactif
#   [SVG]      devrait retomber en image vectorielle (artiste non gere)
#   [LIMITE]   cas connu pour mal rendre -> a observer
#   [ANIM]     animation
# Comparez ce que vous voyez au prefixe pour reperer les ecarts.
# ============================================================

import numpy as np
# NE PAS appeler matplotlib.use(...) ici : cela ecraserait le backend de
# l'extension (MPLBACKEND) et rien ne s'afficherait dans le panneau.
import matplotlib.pyplot as plt
import matplotlib.dates as mdates
from matplotlib.animation import FuncAnimation

try:
    from mpl_toolkits.mplot3d import Axes3D  # noqa: F401 (enregistre la projection 3d)
    HAS_3D = True
except Exception:
    HAS_3D = False

rng = np.random.default_rng(0)
_anims = []          # garder les references aux animations
_report = []         # (titre, statut)


def show(fig, title):
    """Titre la figure et l'envoie au panneau. Capture les erreurs."""
    try:
        fig.canvas.manager.set_window_title(title)
    except Exception:
        pass
    try:
        plt.show()
        _report.append((title, "envoyee"))
    except Exception as exc:
        _report.append((title, "ERREUR: %s" % exc))
        plt.close(fig)


# ------------------------------------------------------------
# 1. Legende avec BEAUCOUP d'entrees -> illisible / chevauche
# ------------------------------------------------------------
fig = plt.figure(figsize=(7, 4))
x = np.linspace(0, 10, 200)
for i in range(24):
    plt.plot(x, np.sin(x + i * 0.3) + i * 0.1, label="serie tres longue numero %02d" % i)
plt.legend(fontsize=7)
plt.title("Legende a 24 entrees")
show(fig, "[LIMITE] legende surchargee (24 entrees)")

# ------------------------------------------------------------
# 2. Legende explicitement HORS des axes (bbox_to_anchor)
#    -> en matplotlib elle est a droite ; le convertisseur la replace
# ------------------------------------------------------------
fig, ax = plt.subplots(figsize=(7, 4))
for i in range(4):
    ax.plot(x, np.cos(x + i), label="courbe %d" % i)
ax.legend(loc="upper left", bbox_to_anchor=(1.02, 1.0), borderaxespad=0.0)
ax.set_title("Legende ancree a l'exterieur (bbox_to_anchor)")
show(fig, "[LIMITE] legende hors axes (bbox_to_anchor)")

# ------------------------------------------------------------
# 3. Legende multi-colonnes + cadre
# ------------------------------------------------------------
fig, ax = plt.subplots(figsize=(7, 4))
for i in range(8):
    ax.plot(x, np.sin(x) * (i + 1) / 8.0, label="L%d" % i)
ax.legend(ncol=4, loc="lower center", frameon=True, fancybox=True, shadow=True)
ax.set_title("Legende 4 colonnes (ncol)")
show(fig, "[LIMITE] legende multi-colonnes (ncol=4)")

# ------------------------------------------------------------
# 4. Titre TRES long + accents + mathtext
# ------------------------------------------------------------
fig, ax = plt.subplots(figsize=(7, 4))
ax.plot(x, np.tanh(x - 5))
ax.set_title(
    r"Un titre interminable avec des accents (éà ç) et du mathtext "
    r"$\int_0^\infty e^{-x^2}\,dx = \frac{\sqrt{\pi}}{2}$ — coupera-t-il ?",
    fontsize=10,
)
ax.set_xlabel(r"$\alpha$ (rad)")
ax.set_ylabel(r"$\tanh(\alpha - 5)$")
show(fig, "[LIMITE] titre long + accents + mathtext")

# ------------------------------------------------------------
# 5. Double axe Y (twinx) -> le convertisseur gere-t-il 2 echelles ?
# ------------------------------------------------------------
fig, ax1 = plt.subplots(figsize=(7, 4))
ax1.plot(x, np.exp(x / 5.0), color="tab:blue", label="exp")
ax1.set_ylabel("exp", color="tab:blue")
ax2 = ax1.twinx()
ax2.plot(x, np.sin(x), color="tab:red", label="sin")
ax2.set_ylabel("sin", color="tab:red")
ax1.set_title("Deux axes Y (twinx)")
show(fig, "[LIMITE] double axe Y (twinx)")

# ------------------------------------------------------------
# 6. Log-log avec une serie qui touche le zero (range log invalide)
# ------------------------------------------------------------
fig, ax = plt.subplots(figsize=(7, 4))
xx = np.linspace(0, 100, 300)
ax.plot(xx, xx ** 2 + 1)
ax.set_xscale("log")
ax.set_yscale("log")
ax.set_title("Log-log (x part de 0)")
show(fig, "[LIMITE] log-log avec x=0")

# ------------------------------------------------------------
# 7. Dates sur l'axe X -> matplotlib utilise des datenum flottants
# ------------------------------------------------------------
fig, ax = plt.subplots(figsize=(7, 4))
dates = np.arange("2024-01-01", "2024-04-10", dtype="datetime64[D]")
ax.plot(dates, np.cumsum(rng.standard_normal(len(dates))))
ax.xaxis.set_major_formatter(mdates.DateFormatter("%d %b"))
fig.autofmt_xdate()
ax.set_title("Serie temporelle (dates)")
show(fig, "[LIMITE] axe X = dates")

# ------------------------------------------------------------
# 8. fill_between -> PolyCollection -> fallback SVG attendu
# ------------------------------------------------------------
fig, ax = plt.subplots(figsize=(7, 4))
y = np.sin(x)
ax.plot(x, y, color="navy", label="signal")
ax.fill_between(x, y - 0.3, y + 0.3, alpha=0.3, color="navy", label="incertitude")
ax.legend()
ax.set_title("fill_between (bande d'incertitude)")
show(fig, "[SVG] fill_between")

# ------------------------------------------------------------
# 9. errorbar -> LineCollection -> fallback SVG attendu
# ------------------------------------------------------------
fig, ax = plt.subplots(figsize=(7, 4))
xs = np.linspace(0, 10, 15)
ax.errorbar(xs, np.sin(xs), yerr=0.2, xerr=0.1, fmt="o", capsize=4, label="mesures")
ax.legend()
ax.set_title("errorbar (barres d'erreur)")
show(fig, "[SVG] errorbar")

# ------------------------------------------------------------
# 10. contourf -> fallback SVG attendu
# ------------------------------------------------------------
fig, ax = plt.subplots(figsize=(6, 5))
gx, gy = np.meshgrid(np.linspace(-3, 3, 200), np.linspace(-3, 3, 200))
gz = np.sin(gx) * np.cos(gy)
cs = ax.contourf(gx, gy, gz, levels=20, cmap="viridis")
fig.colorbar(cs)
ax.set_title("contourf")
show(fig, "[SVG] contourf + colorbar")

# ------------------------------------------------------------
# 11. quiver -> fallback SVG attendu
# ------------------------------------------------------------
fig, ax = plt.subplots(figsize=(6, 5))
qx, qy = np.meshgrid(np.linspace(-2, 2, 12), np.linspace(-2, 2, 12))
ax.quiver(qx, qy, -qy, qx)
ax.set_title("quiver (champ de vecteurs)")
show(fig, "[SVG] quiver")

# ------------------------------------------------------------
# 12. Coordonnees polaires -> fallback SVG attendu
# ------------------------------------------------------------
fig = plt.figure(figsize=(6, 5))
axp = fig.add_subplot(projection="polar")
theta = np.linspace(0, 4 * np.pi, 400)
axp.plot(theta, theta / (2 * np.pi))
axp.set_title("Spirale (axes polaires)")
show(fig, "[SVG] axes polaires")

# ------------------------------------------------------------
# 13. Surface 3D -> fallback SVG attendu
# ------------------------------------------------------------
if HAS_3D:
    fig = plt.figure(figsize=(6, 5))
    ax3 = fig.add_subplot(projection="3d")
    sx, sy = np.meshgrid(np.linspace(-3, 3, 60), np.linspace(-3, 3, 60))
    sz = np.sin(np.sqrt(sx ** 2 + sy ** 2))
    ax3.plot_surface(sx, sy, sz, cmap="coolwarm")
    ax3.set_title("Surface 3D")
    show(fig, "[SVG] surface 3D")

# ------------------------------------------------------------
# 14. Camembert (pie) -> Wedge patches -> fallback SVG attendu
# ------------------------------------------------------------
fig, ax = plt.subplots(figsize=(6, 5))
ax.pie([15, 30, 45, 10], labels=["A", "B", "C", "D"], autopct="%1.1f%%")
ax.set_title("Camembert (pie)")
show(fig, "[SVG] pie")

# ------------------------------------------------------------
# 15. Boxplot -> fallback SVG attendu
# ------------------------------------------------------------
fig, ax = plt.subplots(figsize=(7, 4))
ax.boxplot([rng.standard_normal(100) + i for i in range(5)])
ax.set_title("Boxplot (5 groupes)")
show(fig, "[SVG] boxplot")

# ------------------------------------------------------------
# 16. Histogramme -> bar -> devrait passer en Plotly
# ------------------------------------------------------------
fig, ax = plt.subplots(figsize=(7, 4))
ax.hist(rng.standard_normal(5000), bins=40, color="slateblue")
ax.set_title("Histogramme (5000 echantillons)")
show(fig, "[PLOTLY?] histogramme")

# ------------------------------------------------------------
# 17. Barres empilees + etiquettes longues pivotees
# ------------------------------------------------------------
fig, ax = plt.subplots(figsize=(7, 4))
cats = ["categorie tres longue %d" % i for i in range(6)]
v1 = rng.integers(1, 10, 6)
v2 = rng.integers(1, 10, 6)
ax.bar(cats, v1, label="part A")
ax.bar(cats, v2, bottom=v1, label="part B")
ax.set_xticklabels(cats, rotation=45, ha="right")
ax.legend()
ax.set_title("Barres empilees, labels pivotes")
show(fig, "[LIMITE] barres empilees + labels pivotes")

# ------------------------------------------------------------
# 18. Notation scientifique / offset d'axe (grands nombres)
# ------------------------------------------------------------
fig, ax = plt.subplots(figsize=(7, 4))
ax.plot(np.linspace(0, 1, 100) * 1e6, np.linspace(0, 1, 100) * 1e-6 + 1e-3)
ax.set_title("Grands/petits nombres (offset, notation sci.)")
show(fig, "[LIMITE] axes notation scientifique")

# ------------------------------------------------------------
# 19. NaN / Inf dans les donnees
# ------------------------------------------------------------
fig, ax = plt.subplots(figsize=(7, 4))
yb = np.sin(x).copy()
yb[50:60] = np.nan
yb[100] = np.inf
ax.plot(x, yb)
ax.set_title("Donnees avec NaN et Inf")
show(fig, "[LIMITE] NaN / Inf dans les donnees")

# ------------------------------------------------------------
# 20. Grille dense de sous-graphes (titres qui se chevauchent ?)
# ------------------------------------------------------------
fig, axes = plt.subplots(3, 3, figsize=(8, 6))
for i, axx in enumerate(axes.ravel()):
    axx.plot(x, np.sin(x + i))
    axx.set_title("sous-graphe %d" % i, fontsize=8)
fig.suptitle("Grille 3x3")
fig.tight_layout()
show(fig, "[LIMITE] grille 3x3 de sous-graphes")

# ------------------------------------------------------------
# 21. Scatter tres dense (perf / taille du payload JSON)
# ------------------------------------------------------------
fig, ax = plt.subplots(figsize=(7, 5))
n = 120000
ax.scatter(rng.standard_normal(n), rng.standard_normal(n), s=2, alpha=0.2,
           c=rng.standard_normal(n), cmap="turbo")
ax.set_title("Scatter %d points" % n)
show(fig, "[LIMITE] scatter dense (120k points)")

# ------------------------------------------------------------
# 22. imshow image RGB
# ------------------------------------------------------------
fig, ax = plt.subplots(figsize=(6, 5))
img = rng.random((80, 120, 3))
ax.imshow(img)
ax.set_title("Image RGB (imshow)")
show(fig, "[PLOTLY?] imshow RGB")

# ------------------------------------------------------------
# 23. Annotation avec fleche + texte libre
# ------------------------------------------------------------
fig, ax = plt.subplots(figsize=(7, 4))
ax.plot(x, np.sin(x))
ax.annotate("maximum", xy=(np.pi / 2, 1), xytext=(3, 1.3),
            arrowprops=dict(arrowstyle="->", color="red"))
ax.text(6, -0.8, "texte libre", bbox=dict(boxstyle="round", fc="yellow"))
ax.set_title("Annotation flechee + texte")
show(fig, "[LIMITE] annotation flechee")

# ------------------------------------------------------------
# 24. Animation : titre + legende qui changent a chaque frame
# ------------------------------------------------------------
fig, ax = plt.subplots(figsize=(7, 4))
(ln,) = ax.plot(x, np.sin(x), label="t=0")
ax.set_ylim(-1.5, 1.5)
leg = ax.legend(loc="upper right")
ttl = ax.set_title("Animation — frame 0")

def _upd(i):
    ln.set_ydata(np.sin(x + i * 0.2))
    ln.set_label("t=%.1f" % (i * 0.2))
    ax.legend(loc="upper right")
    ttl.set_text("Animation — frame %d" % i)
    return (ln,)

_anims.append(FuncAnimation(fig, _upd, frames=40, interval=60))
show(fig, "[ANIM] titre + legende dynamiques")

# ------------------------------------------------------------
# 25. Animation lourde (proche du plafond de frames)
# ------------------------------------------------------------
fig, ax = plt.subplots(figsize=(6, 4))
(ln2,) = ax.plot([], [])
ax.set_xlim(0, 2 * np.pi)
ax.set_ylim(-1, 1)

def _upd2(i):
    xx2 = np.linspace(0, 2 * np.pi, 300)
    ln2.set_data(xx2, np.sin(xx2 + i * 0.1))
    return (ln2,)

_anims.append(FuncAnimation(fig, _upd2, frames=120, interval=30))
show(fig, "[ANIM] 120 frames (charge)")

# ------------------------------------------------------------
# Rapport
# ------------------------------------------------------------
print("\n================ RAPPORT DE STRESS ================")
ok = sum(1 for _, s in _report if s == "envoyee")
for title, status in _report:
    flag = "OK " if status == "envoyee" else "!! "
    print("%s%-48s %s" % (flag, title, status))
print("---------------------------------------------------")
print("%d / %d figures envoyees sans erreur Python." % (ok, len(_report)))
print("Inspectez le panneau : comparez le rendu reel au prefixe du titre.")
print("  [PLOTLY?] attendu interactif | [SVG] attendu image | [LIMITE] a surveiller")
