"""Train the focus-readiness classifier and report it against the baselines.

Two estimates are produced, because they answer different questions:

  **Cross-validated (5-fold GroupKFold)** -- the headline number for the report. Every
  participant is held out exactly once, so the estimate does not depend on which people
  happened to land in one test split. This is what §5 quotes.

  **Held-out split** -- a single participant-wise split used to produce the confusion
  matrix and to fit the model that ships. A confusion matrix pooled across folds would
  mix models, so it is taken from one fitted model on unseen people.

Why an MLP at all, given the gate found gradient boosting overfitting at this sample
size: the plan proposed a neural network, and "we tried it and it did not help" is a
result worth reporting. It is compared honestly rather than assumed to win.

`sklearn`'s MLPClassifier is used rather than Keras. The gate established that this model
does not need TFLite -- a logistic regression exports to `coefficients.json` and runs in
TypeScript well inside the 50 ms budget -- so a 600 MB TensorFlow dependency would buy
nothing here. TensorFlow is still required for MoveNet (W10.2), which is a different model.

Run:  python ml/train.py
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import GroupKFold
from sklearn.neural_network import MLPClassifier
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

from baselines import ALL_BASELINES, TARGET, Metrics, confusion, evaluate, verdict
from build_features import FEATURE_COLUMNS, OUTPUT as MODEL_FRAME
from provenance import assert_measured
from split import group_split

ARTIFACTS = Path(__file__).resolve().parent / "artifacts"
COEFFICIENTS = ARTIFACTS / "focus_model_coefficients.json"

N_FOLDS = 5
SEED = 7003


def make_logistic() -> Pipeline:
    return Pipeline(
        [
            # Median rather than mean: stress_score and spo2 are ~49% and ~36% covered,
            # and their distributions are skewed enough that the mean sits off-centre.
            ("impute", SimpleImputer(strategy="median")),
            ("scale", StandardScaler()),
            ("model", LogisticRegression(max_iter=3000, random_state=SEED)),
        ]
    )


def make_mlp() -> Pipeline:
    return Pipeline(
        [
            ("impute", SimpleImputer(strategy="median")),
            ("scale", StandardScaler()),
            (
                "model",
                MLPClassifier(
                    # Deliberately small. ~2,400 rows across 45 participants will not
                    # support a large network; the gate already saw boosted trees overfit
                    # at this size.
                    hidden_layer_sizes=(16, 8),
                    alpha=1e-2,
                    max_iter=1500,
                    early_stopping=True,
                    n_iter_no_change=25,
                    random_state=SEED,
                ),
            ),
        ]
    )


MODELS = {"logistic": make_logistic, "MLP": make_mlp}


def cross_validate(frame: pd.DataFrame, features: list[str]) -> pd.DataFrame:
    """5-fold participant-wise CV for baselines and models on identical folds."""
    X, y, groups = frame[features], frame[TARGET], frame["participant"]
    folds = list(GroupKFold(n_splits=N_FOLDS).split(X, y, groups))

    scores: dict[str, list[Metrics]] = {}

    for train_idx, test_idx in folds:
        train, test = frame.iloc[train_idx], frame.iloc[test_idx]

        for factory in ALL_BASELINES:
            model = factory().fit(train)
            scores.setdefault(model.name, []).append(model.score(test))

        for name, factory in MODELS.items():
            model = factory().fit(train[features], train[TARGET])
            probability = model.predict_proba(test[features])[:, 1]
            scores.setdefault(name, []).append(evaluate(test[TARGET].to_numpy(), probability))

    rows = []
    for name, metrics in scores.items():
        rows.append(
            {
                "model": name,
                "ROC-AUC": np.mean([m.roc_auc for m in metrics]),
                "±": np.std([m.roc_auc for m in metrics]),
                "F1": np.mean([m.f1 for m in metrics]),
                "accuracy": np.mean([m.accuracy for m in metrics]),
                "precision": np.mean([m.precision for m in metrics]),
                "recall": np.mean([m.recall for m in metrics]),
            }
        )
    return pd.DataFrame(rows).sort_values("ROC-AUC", ascending=False).round(4)


def export_coefficients(model: Pipeline, features: list[str], metrics: Metrics) -> Path:
    """Write the fitted logistic regression as JSON for on-device TypeScript inference.

    The whole pipeline is exported, not just the coefficients: without the imputer's
    medians and the scaler's mean/scale, the device cannot reproduce the transform the
    model was fitted on, and would silently score garbage.

        z = sum(coefficients[i] * (x[i] - mean[i]) / scale[i]) + intercept
        p = 1 / (1 + exp(-z))
    """
    imputer: SimpleImputer = model.named_steps["impute"]
    scaler: StandardScaler = model.named_steps["scale"]
    logistic: LogisticRegression = model.named_steps["model"]

    payload = {
        "model": "logistic_regression",
        "target": TARGET,
        "note": (
            "Binary focus-readiness. Derived proxy, not a measurement of focus - "
            "see docs/DATASET.md section 4.4."
        ),
        "features": features,
        "impute_median": [round(float(v), 6) for v in imputer.statistics_],
        "scale_mean": [round(float(v), 6) for v in scaler.mean_],
        "scale_std": [round(float(v), 6) for v in scaler.scale_],
        "coefficients": [round(float(v), 6) for v in logistic.coef_[0]],
        "intercept": round(float(logistic.intercept_[0]), 6),
        "threshold": 0.5,
        "metrics_holdout": {
            "roc_auc": round(metrics.roc_auc, 4),
            "f1": round(metrics.f1, 4),
            "accuracy": round(metrics.accuracy, 4),
        },
        "trained_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "seed": SEED,
    }

    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    COEFFICIENTS.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    return COEFFICIENTS


def learned_peak_hour(model: Pipeline, features: list[str]) -> str:
    """Decode the two cyclical hour coefficients back into a clock time.

    The model sees `hour_sin` and `hour_cos`, so its daily rhythm is split across two
    numbers that mean nothing individually. Their combination a*sin + b*cos is a single
    sinusoid, and recovering its phase gives the hour the model considers most
    focus-favourable -- which is directly reportable and directly checkable against the
    chronobiology literature.
    """
    if "hour_sin" not in features or "hour_cos" not in features:
        return ""

    coefficients = model.named_steps["model"].coef_[0]
    a = coefficients[features.index("hour_sin")]
    b = coefficients[features.index("hour_cos")]

    amplitude = float(np.hypot(a, b))
    peak = float(np.arctan2(a, b)) % (2 * np.pi) / (2 * np.pi) * 24
    trough = (peak + 12) % 24

    def clock(hour: float) -> str:
        return f"{int(hour):02d}:{int(round((hour % 1) * 60)) % 60:02d}"

    return (
        f"  learned circadian peak    {clock(peak)}\n"
        f"  learned circadian trough  {clock(trough)}\n"
        f"  amplitude (standardised)  {amplitude:.3f}"
    )


def top_coefficients(model: Pipeline, features: list[str], n: int = 8) -> str:
    """Largest standardised coefficients -- which signals the model actually uses."""
    coefficients = model.named_steps["model"].coef_[0]
    order = np.argsort(np.abs(coefficients))[::-1][:n]
    lines = []
    for index in order:
        direction = "->  ready" if coefficients[index] > 0 else "-> not ready"
        lines.append(f"  {features[index]:<22} {coefficients[index]:+.3f}  {direction}")
    return "\n".join(lines)


def main() -> int:
    if not MODEL_FRAME.exists():
        print(f"{MODEL_FRAME.name} not found. Run: python ml/build_features.py")
        return 1

    frame = pd.read_parquet(MODEL_FRAME)
    assert_measured(frame, stage="training")

    features = [c for c in FEATURE_COLUMNS if c in frame.columns]
    print(
        f"rows {len(frame):,}   participants {frame.participant.nunique()}   "
        f"features {len(features)}   positive {frame[TARGET].mean() * 100:.1f}%\n"
    )

    print(f"=== {N_FOLDS}-fold participant-wise cross-validation ===")
    table = cross_validate(frame, features)
    print(table.to_string(index=False))

    best_baseline = table[table.model.isin({b.name for b in ALL_BASELINES})]["ROC-AUC"].max()
    for name in MODELS:
        auc = float(table.loc[table.model == name, "ROC-AUC"].iloc[0])
        print(f"\n  {name}: {verdict(auc, float(best_baseline))}")

    # Held-out split: confusion matrix and the shipped model.
    print(f"\n=== held-out split (for the confusion matrix and the exported model) ===")
    split = group_split(frame, test_fraction=0.20, val_fraction=0.10, seed=SEED)
    print(split.summary())

    fitted = make_logistic().fit(split.train[features], split.train[TARGET])
    probability = fitted.predict_proba(split.test[features])[:, 1]
    holdout = evaluate(split.test[TARGET].to_numpy(), probability)

    print(f"\nlogistic on held-out participants:  {holdout}")
    print("\n" + confusion(split.test[TARGET].to_numpy(), probability))

    print("\n=== what the model learned ===")
    peak = learned_peak_hour(fitted, features)
    if peak:
        print(peak)
    print("\n  strongest standardised coefficients:")
    print(top_coefficients(fitted, features))

    path = export_coefficients(fitted, features, holdout)
    size = path.stat().st_size
    print(f"\nexported -> {path.relative_to(ARTIFACTS.parent.parent)}  ({size:,} bytes)")
    print("  Runs in TypeScript on device; no TFLite needed for this model.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
