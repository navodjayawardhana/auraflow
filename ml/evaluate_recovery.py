"""E3 -- does the Recovery Score track how recovered people actually say they feel?

The score in `recovery.py` is a set of rules with weights chosen by hand. That is a
defensible design for explainability and cold-start, but it is a claim, and the claim is
testable: PMData's `readiness` (0-10, self-reported daily) is a direct measurement of the
construct the score is trying to estimate.

Scored against four comparators, chosen so that beating them means something specific:

    sleep duration alone       the single most obvious signal. If the score cannot beat
                               "how long did you sleep", the other two components are
                               decoration.
    resting-HR z alone         the other single signal, inverted.
    Fitbit sleep score         a real commercial product's own composite, computed by the
                               vendor from the same nights. The competitor.
    fitted ridge regression    the same inputs, weights fitted instead of chosen. The
                               upper bound on what these features can do, and the honest
                               measure of what the hand-chosen weights cost.

Spearman rather than Pearson: `readiness` is ordinal and its spacing is not guaranteed to
be even, so only the ranking is meaningful.

Correlations are computed **per participant, then averaged**. Pooling across people would
mostly measure between-person differences in how they use the scale -- one person's 6 is
another's 8 -- which is not what the score is for.

The ridge model is fitted under GroupKFold so it is scored on participants it never saw,
which keeps it an honest upper bound rather than a memorised one.

Run:  python ml/evaluate_recovery.py
"""

from __future__ import annotations

import numpy as np
import pandas as pd
from scipy.stats import spearmanr
from sklearn.impute import SimpleImputer
from sklearn.linear_model import Ridge
from sklearn.model_selection import GroupKFold
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

from ingest_pmdata import load
from provenance import assert_measured
from recovery import add_personal_baselines, illness_flag, recovery_score

TARGET = "readiness"
MIN_DAYS = 15  # a per-participant correlation below this is noise
N_FOLDS = 5
SEED = 7003

RIDGE_FEATURES = ["sleep_hours", "deep_minutes", "rem_minutes", "resting_hr_z", "sleep_efficiency"]


def per_participant_spearman(frame: pd.DataFrame, column: str) -> pd.Series:
    """Spearman(column, readiness) within each participant."""
    results = {}
    for participant, rows in frame.groupby("participant"):
        usable = rows[[column, TARGET]].dropna()
        if len(usable) < MIN_DAYS or usable[column].nunique() < 3:
            continue
        rho, _ = spearmanr(usable[column], usable[TARGET])
        if np.isfinite(rho):
            results[participant] = rho
    return pd.Series(results, name=column)


def fit_ridge_out_of_fold(frame: pd.DataFrame) -> pd.Series:
    """Out-of-fold ridge predictions, so no participant is scored by a model that saw them."""
    features = [c for c in RIDGE_FEATURES if c in frame.columns]
    usable = frame.dropna(subset=[TARGET]).copy()
    predictions = pd.Series(np.nan, index=usable.index)

    folds = GroupKFold(n_splits=N_FOLDS).split(usable, usable[TARGET], usable["participant"])
    for train_idx, test_idx in folds:
        train, test = usable.iloc[train_idx], usable.iloc[test_idx]
        model = make_pipeline(
            SimpleImputer(strategy="median"), StandardScaler(), Ridge(alpha=1.0, random_state=SEED)
        ).fit(train[features], train[TARGET])
        predictions.iloc[test_idx] = model.predict(test[features])

    return predictions


def search_weights_held_out(frame: pd.DataFrame) -> pd.DataFrame:
    """Would different component weights help? Chosen on training folds, scored on held-out.

    The evaluation shows the autonomic component carrying the score, which invites simply
    re-weighting towards it. Doing that against the same numbers would be fitting to the
    test set: the improvement would be guaranteed and meaningless.

    So weights are grid-searched on training participants only and scored on participants
    the search never saw. If the held-out gain is real, it survives that. If it does not,
    the apparent gain was the test set talking.
    """
    grid = [
        (d / 10, a / 10, round(1 - d / 10 - a / 10, 2))
        for d in range(0, 11)
        for a in range(0, 11 - d)
    ]
    components = ["score_duration", "score_architecture", "score_autonomic"]
    usable = frame.dropna(subset=[TARGET]).copy()

    def score_with(rows: pd.DataFrame, weights: tuple[float, float, float]) -> float:
        values = rows[components].to_numpy()
        present = ~np.isnan(values)
        w = np.array(weights)
        total = (present * w).sum(axis=1)
        combined = np.where(total > 0, np.nansum(values * w, axis=1) / np.where(total > 0, total, 1), np.nan)
        scored = rows.assign(_combined=combined)
        rho = per_participant_spearman(scored, "_combined")
        return float(rho.mean()) if len(rho) else np.nan

    held_out, chosen = [], []
    folds = GroupKFold(n_splits=N_FOLDS).split(usable, usable[TARGET], usable["participant"])
    for train_idx, test_idx in folds:
        train, test = usable.iloc[train_idx], usable.iloc[test_idx]
        scores = [(score_with(train, w), w) for w in grid]
        scores = [(s, w) for s, w in scores if np.isfinite(s)]
        if not scores:
            continue
        best_weight = max(scores)[1]
        chosen.append(best_weight)
        value = score_with(test, best_weight)
        if np.isfinite(value):
            held_out.append(value)

    return pd.DataFrame({"held_out_rho": held_out, "weights": chosen})


def main() -> int:
    frame = load()
    assert_measured(frame, stage="recovery evaluation")

    frame = recovery_score(add_personal_baselines(frame))
    frame["negative_resting_hr_z"] = -frame["resting_hr_z"]
    frame["ridge_fitted"] = fit_ridge_out_of_fold(frame)

    print(f"rows {len(frame):,}   participants {frame.participant.nunique()}")
    print(f"span {frame.date.min():%Y-%m-%d} .. {frame.date.max():%Y-%m-%d}")
    print(f"recovery score computed for {frame.recovery_score.notna().sum():,} days")
    print(
        "  components contributing: "
        + ", ".join(
            f"{int(k)}->{v}" for k, v in frame.components_used.value_counts().sort_index().items()
        )
        + "\n"
    )

    # The deployed headline score. Provisional days (no autonomic component) are a
    # different measurement on the same scale; mixing them makes the ranking incoherent.
    frame["recovery_established"] = frame["recovery_score"].where(~frame["is_provisional"])
    provisional = int(frame["is_provisional"].sum())
    print(
        f"  provisional days (no autonomic component): {provisional:,} of {len(frame):,} "
        f"({provisional / len(frame) * 100:.1f}%) -- excluded from the headline score\n"
    )

    candidates = {
        "Recovery Score (established days)": "recovery_established",
        "Recovery Score (all days, mixed)": "recovery_score",
        "  component: duration": "score_duration",
        "  component: architecture": "score_architecture",
        "  component: autonomic": "score_autonomic",
        "sleep hours alone": "sleep_hours",
        "resting-HR z alone (inverted)": "negative_resting_hr_z",
        "Fitbit sleep score": "overall_score",
        "ridge, fitted (upper bound)": "ridge_fitted",
    }

    rows = []
    for label, column in candidates.items():
        if column not in frame.columns:
            continue
        rho = per_participant_spearman(frame, column)
        if rho.empty:
            continue
        rows.append(
            {
                "predictor": label,
                "mean rho": rho.mean(),
                "median rho": rho.median(),
                "participants": len(rho),
                "positive": int((rho > 0).sum()),
            }
        )

    table = pd.DataFrame(rows).sort_values("mean rho", ascending=False)
    print("=== Spearman correlation with self-reported readiness ===")
    print("    (per participant, then averaged)\n")
    print(table.round(3).to_string(index=False))

    ours = table.loc[table.predictor == "Recovery Score (established days)", "mean rho"]
    if not ours.empty:
        ours_rho = float(ours.iloc[0])
        rivals = table[~table.predictor.str.startswith(("Recovery Score", "  component"))]
        # Differences below this are not distinguishable at 14-16 participants with
        # per-fold spread running from 0.018 to 0.288. Calling a 0.0004 difference a win
        # would be exactly the overclaiming this comparison exists to prevent.
        TIE = 0.02

        print()
        for _, rival in rivals.iterrows():
            margin = ours_rho - rival["mean rho"]
            if abs(margin) < TIE:
                verdict = "ties with"
            elif margin > 0:
                verdict = "beats    "
            else:
                verdict = "LOSES to "
            print(f"  {verdict} {rival['predictor']:<32} {ours_rho:+.3f} vs {rival['mean rho']:+.3f}")

        fitted = table.loc[table.predictor.str.startswith("ridge"), "mean rho"]
        if not fitted.empty:
            gap = ours_rho - float(fitted.iloc[0])
            if gap > TIE:
                note = "the hand-chosen rules do better than fitting these features."
            elif gap < -TIE:
                note = "fitting would help materially; the hand-chosen weights cost accuracy."
            else:
                note = "the hand-chosen rules match fitting; the weights cost nothing."
            print(f"\n  Rules vs fitted ridge: {gap:+.3f} rho -- {note}")

        print(
            f"\n  ABSOLUTE CAVEAT: the best predictor here reaches rho {table['mean rho'].max():.3f}.\n"
            f"  That is a weak correlation by any standard. The ranking above says which\n"
            f"  signal is least bad, not that any of them predicts readiness well."
        )

    print("\n=== would re-weighting help? (weights chosen on train folds, scored held-out) ===")
    search = search_weights_held_out(frame)
    if not search.empty:
        for _, row in search.iterrows():
            d, a, au = row["weights"]
            print(f"  fold chose duration {d:.1f} / architecture {a:.1f} / autonomic {au:.1f}"
                  f"  -> held-out rho {row['held_out_rho']:+.3f}")
        current = float(ours.iloc[0]) if not ours.empty else np.nan
        print(f"\n  mean held-out rho with searched weights  {search.held_out_rho.mean():+.3f}")
        print(f"  current hand-chosen weights              {current:+.3f}")
        gain = search.held_out_rho.mean() - current
        print(
            f"  gain {gain:+.3f} -- "
            + (
                "worth re-weighting."
                if gain > 0.02
                else "not worth re-weighting; the search does not generalise."
            )
        )

    flags = illness_flag(frame)
    print(f"\n=== illness detector (resting-HR z > 1.5) ===")
    print(f"  flagged {flags.sum():,} of {frame.resting_hr_z.notna().sum():,} days with a baseline "
          f"({flags.sum() / max(frame.resting_hr_z.notna().sum(), 1) * 100:.1f}%)")

    flagged_readiness = frame.loc[flags, TARGET].mean()
    normal_readiness = frame.loc[~flags & frame.resting_hr_z.notna(), TARGET].mean()
    print(f"  mean readiness on flagged days  {flagged_readiness:.2f}")
    print(f"  mean readiness on normal days   {normal_readiness:.2f}")
    print(f"  difference                      {flagged_readiness - normal_readiness:+.2f}")
    print(
        "\n  Readiness is a proxy for illness, not a diagnosis. A lower mean on flagged\n"
        "  days is consistent with the detector working; it is not proof that it detects\n"
        "  illness, and the report must not say that it is."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
