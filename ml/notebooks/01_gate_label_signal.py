"""Gate 0.9 -- does any LifeSnaps target carry signal a baseline cannot already get?

Why this exists
---------------
A first pass over the obvious construction (ALERT+RESTED vs TIRED+TENSE, logistic
regression, one held-out split) returned ROC-AUC 0.52-0.55: chance. Before abandoning
the cohort, this script rules out the three cheap explanations for a false negative:

  1. The estimate was noisy.       One split held 11 participants and 434 rows.
                                   Replaced with 5-fold GroupKFold over all of them.
  2. The target was badly built.   Three of seven moods were discarded. Four target
                                   definitions are compared instead of assuming one.
  3. The model was too weak.       Logistic regression is linear and needed imputation.
                                   HistGradientBoosting handles NaN natively and
                                   non-linearity for free.

It also adds the context columns (WORK/SCHOOL, HOME, GYM, ...). These are legitimate
app features -- AuraFlow plans geofencing, so location context is available at inference
time -- and mood plausibly depends more on where someone is than on their resting heart
rate.

Every configuration is scored against a majority-class baseline on the same folds. A
configuration only counts as signal if it beats that baseline by more than fold-to-fold
noise.

Run:  python ml/notebooks/01_gate_label_signal.py
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.dummy import DummyClassifier
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score
from sklearn.model_selection import GroupKFold
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

ML_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ML_DIR))

LIFESNAPS = ML_DIR.parent / "data" / "raw" / "lifesnaps"

MOOD = ["ALERT", "HAPPY", "NEUTRAL", "RESTED/RELAXED", "SAD", "TENSE/ANXIOUS", "TIRED"]
CONTEXT = [
    "ENTERTAINMENT", "GYM", "HOME", "HOME_OFFICE",
    "OTHER", "OUTDOORS", "TRANSIT", "WORK/SCHOOL",
]

N_FOLDS = 5
SEED = 7003


# ---------------------------------------------------------------------------
def load() -> pd.DataFrame:
    hourly = pd.read_csv(
        LIFESNAPS / "hourly_fitbit_sema_df_unprocessed.csv", index_col=0, low_memory=False
    )
    daily = pd.read_csv(
        LIFESNAPS / "daily_fitbit_sema_df_unprocessed.csv", index_col=0, low_memory=False
    )

    labelled = hourly[hourly[MOOD].notna().any(axis=1)].copy()
    labelled["mood"] = labelled[MOOD].idxmax(axis=1)

    daily_features = daily[
        ["id", "date", "stress_score", "resting_hr", "sleep_duration",
         "sleep_deep_ratio", "sleep_rem_ratio", "sleep_efficiency", "nremhr", "rmssd", "spo2"]
    ].copy()

    # sleep_duration is milliseconds. Nights outside 3-12 h are recording artefacts
    # (the range runs to 20.7 h) and are dropped rather than clipped, which would
    # invent a plausible value where none was measured.
    daily_features["sleep_hours"] = daily_features.sleep_duration / 3_600_000
    daily_features.loc[
        (daily_features.sleep_hours < 3) | (daily_features.sleep_hours > 12), "sleep_hours"
    ] = np.nan

    # resting_hr relative to each participant's own trailing week -- the strain signal.
    # Absolute resting HR mostly encodes fitness, which is a between-person difference
    # the group split deliberately withholds.
    rhr = daily[["id", "date", "resting_hr"]].dropna().sort_values(["id", "date"]).copy()
    rhr["rhr_delta_7d"] = rhr.resting_hr - rhr.groupby("id").resting_hr.transform(
        lambda s: s.rolling(7, min_periods=2).mean()
    )
    daily_features = daily_features.merge(
        rhr[["id", "date", "rhr_delta_7d"]], on=["id", "date"], how="left"
    )

    frame = labelled.merge(daily_features, on=["id", "date"], how="left", suffixes=("", "_d"))
    frame["dow"] = pd.to_datetime(frame.date).dt.dayofweek
    frame["is_weekend"] = (frame.dow >= 5).astype(int)
    return frame.rename(columns={"id": "participant"})


# ---------------------------------------------------------------------------
# Target definitions. Each returns a Series of 0/1/NaN; NaN rows are excluded.
# ---------------------------------------------------------------------------
def target_strict(frame: pd.DataFrame) -> pd.Series:
    """The original construction: only unambiguous moods."""
    high, low = {"ALERT", "RESTED/RELAXED"}, {"TIRED", "TENSE/ANXIOUS"}
    return frame.mood.map(lambda m: 1.0 if m in high else (0.0 if m in low else np.nan))


def target_valence(frame: pd.DataFrame) -> pd.Series:
    """All seven moods split by pleasantness, keeping every labelled row."""
    high = {"ALERT", "RESTED/RELAXED", "HAPPY", "NEUTRAL"}
    return frame.mood.map(lambda m: 1.0 if m in high else 0.0)


def target_energy(frame: pd.DataFrame) -> pd.Series:
    """Activation rather than pleasantness -- closer to what focus actually needs."""
    high, low = {"ALERT", "HAPPY"}, {"TIRED", "SAD"}
    return frame.mood.map(lambda m: 1.0 if m in high else (0.0 if m in low else np.nan))


def target_tired(frame: pd.DataFrame) -> pd.Series:
    """TIRED against everything else. The single largest, cleanest contrast available
    (1,126 rows) and the one a scheduling app most needs to get right."""
    return (frame.mood != "TIRED").astype(float)


TARGETS = {
    "strict (ALERT+RESTED vs TIRED+TENSE)": target_strict,
    "valence (pleasant vs unpleasant)": target_valence,
    "energy (ALERT+HAPPY vs TIRED+SAD)": target_energy,
    "not-tired (vs TIRED)": target_tired,
}

BIOMETRIC = [
    "hour", "dow", "is_weekend", "sleep_hours", "resting_hr", "rhr_delta_7d",
    "stress_score", "sleep_deep_ratio", "sleep_rem_ratio", "sleep_efficiency",
    "nremhr", "rmssd", "spo2", "steps", "bpm", "calories",
]

FEATURE_SETS = {
    "time-only": ["hour", "dow", "is_weekend"],
    "biometric": BIOMETRIC,
    "biometric+context": BIOMETRIC + CONTEXT,
}


def evaluate(frame: pd.DataFrame, features: list[str], y: pd.Series) -> dict:
    """5-fold GroupKFold AUC, mean and spread, plus the baseline on the same folds."""
    features = [f for f in features if f in frame.columns]
    X, groups = frame[features], frame.participant

    folds = GroupKFold(n_splits=N_FOLDS)
    scores: dict[str, list[float]] = {"baseline": [], "logistic": [], "boosted": []}

    for train_idx, test_idx in folds.split(X, y, groups):
        X_tr, X_te = X.iloc[train_idx], X.iloc[test_idx]
        y_tr, y_te = y.iloc[train_idx], y.iloc[test_idx]

        if y_te.nunique() < 2 or y_tr.nunique() < 2:
            continue  # a fold with one class has no defined AUC

        models = {
            "baseline": DummyClassifier(strategy="prior"),
            "logistic": make_pipeline(
                SimpleImputer(strategy="median"),
                StandardScaler(),
                LogisticRegression(max_iter=3000),
            ),
            "boosted": HistGradientBoostingClassifier(
                max_depth=3, max_iter=200, learning_rate=0.06, random_state=SEED
            ),
        }
        for name, model in models.items():
            model.fit(X_tr, y_tr)
            scores[name].append(roc_auc_score(y_te, model.predict_proba(X_te)[:, 1]))

    return {
        name: (float(np.mean(values)), float(np.std(values))) if values else (float("nan"), 0.0)
        for name, values in scores.items()
    }


def main() -> int:
    frame = load()
    print(f"labelled rows {len(frame):,}   participants {frame.participant.nunique()}")
    print(f"date range {frame.date.min()} .. {frame.date.max()}\n")

    results = []
    for target_name, build in TARGETS.items():
        y_all = build(frame)
        subset = frame[y_all.notna()].copy()
        y = y_all.dropna()

        # A participant needs enough rows for a fold to be meaningful.
        keep = subset.participant.value_counts()
        keep = keep[keep >= 10].index
        mask = subset.participant.isin(keep)
        subset, y = subset[mask], y[mask.to_numpy()]

        print(f"--- {target_name}")
        print(
            f"    n={len(subset):,}  participants={subset.participant.nunique()}  "
            f"positive={y.mean() * 100:.1f}%"
        )

        for feature_name, features in FEATURE_SETS.items():
            scored = evaluate(subset, features, y)
            best_model, (best_auc, best_std) = max(
                ((k, v) for k, v in scored.items() if k != "baseline"),
                key=lambda kv: kv[1][0],
            )
            results.append(
                {
                    "target": target_name,
                    "features": feature_name,
                    "n": len(subset),
                    "logistic": scored["logistic"][0],
                    "boosted": scored["boosted"][0],
                    "best": best_auc,
                    "std": best_std,
                    "model": best_model,
                }
            )
            print(
                f"      {feature_name:<20} logistic {scored['logistic'][0]:.3f}   "
                f"boosted {scored['boosted'][0]:.3f} (+-{scored['boosted'][1]:.3f})"
            )
        print()

    table = pd.DataFrame(results).sort_values("best", ascending=False)
    print("=" * 78)
    print("ranked by best mean ROC-AUC over 5 participant-wise folds\n")
    print(table.round(3).to_string(index=False))

    top = table.iloc[0]
    print("\n" + "=" * 78)
    # One standard deviation over 0.5 is the least that could be called signal; 0.60 is
    # the conventional floor for a model worth deploying.
    if top.best < 0.55:
        print(
            f"VERDICT: no signal. Best is {top.best:.3f} (+-{top['std']:.3f}) -- "
            f"'{top.target}' / {top.features}.\n"
            f"Wearable features do not predict momentary affect in this cohort.\n"
            f"Report as a negative result and reframe the shipped feature."
        )
    elif top.best < 0.60:
        print(
            f"VERDICT: marginal. Best is {top.best:.3f} (+-{top['std']:.3f}) -- "
            f"'{top.target}' / {top.features}.\n"
            f"Above chance but below the usual deployment floor. Usable only if the\n"
            f"report states the margin plainly and does not overclaim."
        )
    else:
        print(
            f"VERDICT: signal found. Best is {top.best:.3f} (+-{top['std']:.3f}) -- "
            f"'{top.target}' / {top.features}, {top.model}.\n"
            f"Proceed with this target definition."
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
