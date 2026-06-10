# ============================================================
# test_plots.py — script de validation de l'extension
# A lancer dans un NOUVEAU terminal VS Code :  python test_plots.py
# Les 3 figures doivent apparaitre dans le panneau "Graphes".
# ============================================================

import numpy as np
import matplotlib.pyplot as plt

# ---- Figure 1 : relation aire-Mach (clin d'oeil) ----
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

print("3 figures envoyees au panneau Graphes.")
