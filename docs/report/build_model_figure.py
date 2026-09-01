"""Held-out confusion matrix beside the strongest standardised coefficients.

Both panels read from the deployed artifact, so the figure cannot drift from the
model the app actually ships.
"""
import json
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
ART = json.loads((ROOT / "ml" / "artifacts" / "focus_model_coefficients.json").read_text())
OUT = ROOT / "docs" / "report" / "figures" / "fig-model-results.png"

# Held-out split, threshold 0.5. Reproduced by ml/evaluate.py.
CM = np.array([[185, 59], [91, 105]])

INK = "#1b1d23"
GRID = "#d7dae0"
POS = "#2f6f9f"
NEG = "#b4553f"

plt.rcParams.update({
    "font.family": "DejaVu Sans", "font.size": 9,
    "axes.edgecolor": GRID, "axes.labelcolor": INK,
    "text.color": INK, "xtick.color": INK, "ytick.color": INK,
})

fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(9.4, 3.5), gridspec_kw={"width_ratios": [1, 1.35]})

# --- confusion matrix -------------------------------------------------------
ax1.imshow(CM, cmap="Blues", vmin=0, vmax=CM.max() * 1.35)
labels = ["not focus-ready", "focus-ready"]
ax1.set_xticks([0, 1], labels)
ax1.set_yticks([0, 1], labels, rotation=90, va="center")
ax1.set_xlabel("Predicted")
ax1.set_ylabel("Actual")
for i in range(2):
    for j in range(2):
        n = CM[i, j]
        ax1.text(j, i - 0.08, f"{n}", ha="center", va="center", fontsize=17,
                 color="white" if n > 140 else INK)
        ax1.text(j, i + 0.20, ["TN", "FP", "FN", "TP"][i * 2 + j], ha="center",
                 va="center", fontsize=8, color="white" if n > 140 else "#5a6070")
ax1.set_title("(a) Held-out confusion matrix (n = 440)", fontsize=9.5, pad=9)
for s in ax1.spines.values():
    s.set_visible(False)
ax1.tick_params(length=0)

# --- coefficients -----------------------------------------------------------
pairs = sorted(zip(ART["features"], ART["coefficients"]), key=lambda p: -abs(p[1]))[:8][::-1]
names = [n.replace("/", " / ").lower() for n, _ in pairs]
vals = [v for _, v in pairs]
ax2.barh(names, vals, color=[POS if v > 0 else NEG for v in vals], height=0.62)
ax2.axvline(0, color=INK, lw=0.8)
for y, v in enumerate(vals):
    ax2.text(v + (0.012 if v > 0 else -0.012), y, f"{v:+.3f}", va="center",
             ha="left" if v > 0 else "right", fontsize=8)
ax2.set_xlim(-0.48, 0.48)
ax2.set_xlabel("Standardised coefficient (log-odds per SD)")
ax2.set_title("(b) Eight strongest predictors", fontsize=9.5, pad=9)
ax2.grid(axis="x", color=GRID, lw=0.6)
ax2.set_axisbelow(True)
for s in ("top", "right", "left"):
    ax2.spines[s].set_visible(False)
ax2.tick_params(length=0)

fig.tight_layout()
fig.savefig(OUT, dpi=300, facecolor="white")
print(f"wrote {OUT}")
