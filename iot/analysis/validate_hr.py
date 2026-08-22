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

The node publishes two heart rates from the same signal, and both are analysed here.

    hr_bpm        beat intervals timed against the node's measured sample clock. This
                  is the estimator the app displays.
    hr_bpm_maxim  Maxim's reference algorithm. It divides a whole number of samples by a
                  whole number of beats and divides that into 1500, so at rest it can
                  only return 60, 62, 65, 68, 71, 75, 78, 83, 88, 93 or 100 bpm. Kept
                  because it is the published, citable method — and because the size of
                  its quantisation is itself a result worth reporting.

Reporting both against the same watch samples turns "we changed the algorithm" into a
measured comparison. `--estimators` narrows it if one column is missing.

Inputs (CSV, exported from MySQL — see the queries in the README)
    node_hr.csv   recorded_at,hr_bpm[,hr_bpm_maxim]
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


#: Node columns to analyse, in the order they are reported.
ESTIMATORS = {
    "beat": "hr_bpm",
    "maxim": "hr_bpm_maxim",
}


def plausible(series: pd.Series) -> pd.Series:
    """Physiologically implausible rows are sensor artefacts, not data."""
    return (series > 30) & (series < 220)


def load_watch(path: Path) -> pd.DataFrame:
    df = pd.read_csv(path, parse_dates=["recorded_at"])
    df = df.dropna(subset=["hr_bpm"]).sort_values("recorded_at")
    df["hr_bpm"] = df["hr_bpm"].astype(float)
    df = df[plausible(df["hr_bpm"])]
    print(f"watch: {len(df):4d} samples  "
          f"{df.recorded_at.min()} -> {df.recorded_at.max()}")
    return df.rename(columns={"hr_bpm": "watch"})


def load_node(path: Path, wanted: list[str]) -> dict[str, pd.DataFrame]:
    """One frame per estimator, each already filtered to its own usable rows.

    Split rather than kept as one wide frame because the estimators do not fail
    together: Maxim's can lose its lock on a window the beat timer reads fine, and
    dropping a row from both would quietly shrink the better estimator's sample to
    match the worse one.
    """
    raw = pd.read_csv(path, parse_dates=["recorded_at"]).sort_values("recorded_at")

    frames: dict[str, pd.DataFrame] = {}
    for name in wanted:
        column = ESTIMATORS[name]
        if column not in raw.columns:
            print(f"{name:>5}: column '{column}' absent - skipped")
            continue

        df = raw.dropna(subset=[column])[["recorded_at", column]].copy()
        df[column] = df[column].astype(float)
        df = df[plausible(df[column])]

        if df.empty:
            print(f"{name:>5}:    0 usable samples - skipped")
            continue

        print(f"{name:>5}: {len(df):4d} samples  "
              f"{df.recorded_at.min()} -> {df.recorded_at.max()}  "
              f"{df[column].nunique()} distinct values")
        frames[name] = df.rename(columns={column: "node"})

    return frames


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


def report(paired: pd.DataFrame, name: str) -> dict:
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

    print(f"\n--- agreement: {name} vs watch " + "-" * (32 - len(name)))
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
    ax.set_title(f"HR agreement, {name} — r = {r:.3f}, n = {len(paired)}")
    ax.set_xlim(lo, hi)
    ax.set_ylim(lo, hi)
    fig.tight_layout()
    fig.savefig(OUT_DIR / f"hr_scatter_{name}.png", dpi=200)

    # Bland-Altman
    fig, ax = plt.subplots(figsize=(6.5, 4.5))
    ax.scatter(mean, diff, s=18, alpha=0.65, edgecolor="none")
    ax.axhline(bias, linewidth=1.2)
    ax.axhline(metrics["loa_lower"], linestyle="--", linewidth=1)
    ax.axhline(metrics["loa_upper"], linestyle="--", linewidth=1)
    ax.annotate(f"bias {bias:+.1f}", (mean.max(), bias), ha="right", va="bottom")
    ax.set_xlabel("Mean of the two measurements (bpm)")
    ax.set_ylabel("Node - Watch (bpm)")
    ax.set_title(f"Bland-Altman, {name}")
    fig.tight_layout()
    fig.savefig(OUT_DIR / f"hr_bland_altman_{name}.png", dpi=200)

    print(f"figures written to {OUT_DIR}")
    return metrics


def compare_estimators(frames: dict[str, pd.DataFrame], tolerance_s: int) -> None:
    """The node against itself.

    The watch comparison says whether the node is right; this says how much the two
    estimators actually differ, which is the part a reader cannot get from two separate
    agreement tables. A large spread here with similar watch agreement means the watch
    is too coarse a comparator to separate them, and that is worth saying plainly.
    """
    if len(frames) < 2:
        return

    beat, maxim = frames["beat"], frames["maxim"]
    both = pd.merge_asof(
        beat.rename(columns={"node": "beat"}),
        maxim.rename(columns={"node": "maxim"}),
        on="recorded_at",
        direction="nearest",
        tolerance=pd.Timedelta(seconds=tolerance_s),
    ).dropna()

    if len(both) < 20:
        print(f"\nonly {len(both)} rows carry both estimators - skipping the "
              "estimator-to-estimator comparison")
        return

    diff = both["beat"].to_numpy() - both["maxim"].to_numpy()
    print("\n--- beat vs maxim, same signal ---------------------------------")
    print(f"n                 = {len(both)}")
    print(f"MAE               = {np.abs(diff).mean():.2f} bpm")
    print(f"Bias (beat-maxim) = {diff.mean():+.2f} bpm")
    print(f"Distinct values   = {both['beat'].nunique()} beat / "
          f"{both['maxim'].nunique()} maxim")
    print("---------------------------------------------------------------")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("node_csv", type=Path)
    ap.add_argument("watch_csv", type=Path)
    ap.add_argument("--tolerance", type=int, default=10,
                    help="max seconds between a node and watch sample to pair them")
    ap.add_argument("--estimators", nargs="+", choices=sorted(ESTIMATORS),
                    default=sorted(ESTIMATORS),
                    help="node columns to analyse (default: both)")
    args = ap.parse_args()

    frames = load_node(args.node_csv, args.estimators)
    if not frames:
        raise SystemExit("no usable node estimator columns — nothing to compare")

    watch = load_watch(args.watch_csv)

    reported = 0
    for name, node in frames.items():
        paired = pair(node, watch, args.tolerance)

        # Per estimator rather than up front: one of them losing its lock through a
        # session is a result, not a reason to abandon the other one's analysis.
        if len(paired) < 20:
            print(f"only {len(paired)} paired samples for {name} - not reported. "
                  "Aim for 3 sessions x 5 min at rest, plus one after light exercise.")
            continue

        report(paired, name)
        reported += 1

    compare_estimators(frames, args.tolerance)

    if reported == 0:
        raise SystemExit("no estimator had enough paired samples to report")


if __name__ == "__main__":
    main()
