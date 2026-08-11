"""
AuraFlow — agreement between the Arduino MAX30102 node and the Huawei Watch Fit.

Why this exists
---------------
Service discovery on the watch (2026-08-08) showed no `0x180D Heart Rate`
service, so live HR over BLE is closed and Health Connect is the only path.
The MAX30102 node gives us a second, independent measurement of the same
quantity — which turns that limitation into a measurable result instead of a
paragraph of apology in the evaluation chapter.

This is a *comparative agreement* analysis, not a clinical validation. Neither
device is a medical reference; the watch is a convenience comparator. Say that
in the report.

Inputs (CSV, exported from MySQL — see the queries in the README)
    node_hr.csv   recorded_at,hr_bpm
    watch_hr.csv  recorded_at,hr_bpm

Usage
    pip install pandas numpy matplotlib scipy
    python validate_hr.py node_hr.csv watch_hr.csv --tolerance 10
"""

from __future__ import annotations

import argparse
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from scipy import stats

OUT_DIR = Path(__file__).parent / "figures"


def load(path: Path, label: str) -> pd.DataFrame:
    df = pd.read_csv(path, parse_dates=["recorded_at"])
    df = df.dropna(subset=["hr_bpm"]).sort_values("recorded_at")
    df["hr_bpm"] = df["hr_bpm"].astype(float)
    # Physiologically implausible rows are sensor artefacts, not data.
    df = df[(df["hr_bpm"] > 30) & (df["hr_bpm"] < 220)]
    print(f"{label:>5}: {len(df):4d} samples  "
          f"{df.recorded_at.min()} -> {df.recorded_at.max()}")
    return df.rename(columns={"hr_bpm": label})


def pair(node: pd.DataFrame, watch: pd.DataFrame, tolerance_s: int) -> pd.DataFrame:
    """Match each node sample to the nearest watch sample within the tolerance.

    The watch reports roughly every 5 min at rest; the node reports every 5 s.
    Without a tolerance window you would be comparing readings taken minutes
    apart, which measures nothing.
    """
    paired = pd.merge_asof(
        node, watch,
        on="recorded_at",
        direction="nearest",
        tolerance=pd.Timedelta(seconds=tolerance_s),
    ).dropna()
    print(f"paired: {len(paired)} within +/-{tolerance_s}s")
    return paired


def report(paired: pd.DataFrame) -> dict:
    a = paired["node"].to_numpy()
    b = paired["watch"].to_numpy()

    diff = a - b
    mean = (a + b) / 2
    bias = diff.mean()
    sd = diff.std(ddof=1)

    r, p = stats.pearsonr(a, b)
    metrics = {
        "n": len(paired),
        "pearson_r": r,
        "p_value": p,
        "mae_bpm": np.abs(diff).mean(),
        "rmse_bpm": float(np.sqrt((diff ** 2).mean())),
        "bias_bpm": bias,
        "loa_lower": bias - 1.96 * sd,
        "loa_upper": bias + 1.96 * sd,
        "within_5bpm_pct": 100 * (np.abs(diff) <= 5).mean(),
        "within_10bpm_pct": 100 * (np.abs(diff) <= 10).mean(),
    }

    print("\n--- agreement -------------------------------------------------")
    print(f"n                 = {metrics['n']}")
    print(f"Pearson r         = {r:.3f}  (p = {p:.2e})")
    print(f"MAE               = {metrics['mae_bpm']:.2f} bpm")
    print(f"RMSE              = {metrics['rmse_bpm']:.2f} bpm")
    print(f"Bias (node-watch) = {bias:+.2f} bpm")
    print(f"95% LoA           = [{metrics['loa_lower']:+.2f}, {metrics['loa_upper']:+.2f}] bpm")
    print(f"Within 5 bpm      = {metrics['within_5bpm_pct']:.1f}%")
    print(f"Within 10 bpm     = {metrics['within_10bpm_pct']:.1f}%")
    print("---------------------------------------------------------------\n")

    OUT_DIR.mkdir(exist_ok=True)

    # Scatter + identity line
    fig, ax = plt.subplots(figsize=(5.5, 5.5))
    ax.scatter(b, a, s=18, alpha=0.65, edgecolor="none")
    lo, hi = min(a.min(), b.min()) - 5, max(a.max(), b.max()) + 5
    ax.plot([lo, hi], [lo, hi], linestyle="--", linewidth=1)
    ax.set_xlabel("Huawei Watch Fit (bpm)")
    ax.set_ylabel("MAX30102 node (bpm)")
    ax.set_title(f"HR agreement — r = {r:.3f}, n = {len(paired)}")
    ax.set_xlim(lo, hi)
    ax.set_ylim(lo, hi)
    fig.tight_layout()
    fig.savefig(OUT_DIR / "hr_scatter.png", dpi=200)

    # Bland-Altman
    fig, ax = plt.subplots(figsize=(6.5, 4.5))
    ax.scatter(mean, diff, s=18, alpha=0.65, edgecolor="none")
    ax.axhline(bias, linewidth=1.2)
    ax.axhline(metrics["loa_lower"], linestyle="--", linewidth=1)
    ax.axhline(metrics["loa_upper"], linestyle="--", linewidth=1)
    ax.annotate(f"bias {bias:+.1f}", (mean.max(), bias), ha="right", va="bottom")
    ax.set_xlabel("Mean of the two measurements (bpm)")
    ax.set_ylabel("Node - Watch (bpm)")
    ax.set_title("Bland-Altman")
    fig.tight_layout()
    fig.savefig(OUT_DIR / "hr_bland_altman.png", dpi=200)

    print(f"figures written to {OUT_DIR}")
    return metrics


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("node_csv", type=Path)
    ap.add_argument("watch_csv", type=Path)
    ap.add_argument("--tolerance", type=int, default=10,
                    help="max seconds between a node and watch sample to pair them")
    args = ap.parse_args()

    node = load(args.node_csv, "node")
    watch = load(args.watch_csv, "watch")
    paired = pair(node, watch, args.tolerance)

    if len(paired) < 20:
        raise SystemExit(
            f"only {len(paired)} paired samples — collect more before reporting. "
            "Aim for 3 sessions x 5 min at rest, plus one after light exercise."
        )

    report(paired)


if __name__ == "__main__":
    main()
