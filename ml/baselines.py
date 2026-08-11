"""Baselines the trained model has to beat to be worth shipping.

A model reported in isolation is unfalsifiable. ROC-AUC 0.65 sounds respectable until you
find that a per-hour lookup table scores 0.61 -- at which point the model has bought 0.04
in exchange for a training pipeline, an inference budget and a great deal of report space.

So every metric in the evaluation chapter is reported against these, in the same table.
That is also the honest answer to the obvious viva question: how do you know the model
learned anything?

Three baselines, in increasing order of how hard they are to beat:

    MajorityClass       predicts the training base rate for every row. Losing to this
                        means nothing was learned at all.

    HourOfDay           predicts the training positive rate for that hour. This is the
                        one that matters: the app's core claim is that it knows *when*
                        you focus best, and a lookup table already knows that on average.
                        The model has to beat the population's average daily rhythm.

    PersonalRate        predicts each participant's own base rate, falling back to the
                        global rate for unseen people. Tests whether the model adds
                        anything beyond "some people report being alert more often than
                        others." Under a participant-wise split every test participant is
                        unseen, so this collapses to MajorityClass -- it is informative
                        only on a chronological split.

Metrics are classification metrics because the target is binary: LifeSnaps records mood
as seven mutually exclusive categories with no intensity scale, so no regression target
exists (docs/DATASET.md section 4.1).
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd
from sklearn.metrics import (
    accuracy_score,
    confusion_matrix,
    f1_score,
    precision_score,
    recall_score,
    roc_auc_score,
)

TARGET = "focus_ready"

#: Conventional floor for a model worth deploying. Below this, say so plainly.
DEPLOYMENT_FLOOR = 0.60


@dataclass
class Metrics:
    roc_auc: float
    f1: float
    accuracy: float
    precision: float
    recall: float

    def __str__(self) -> str:
        return (
            f"AUC {self.roc_auc:.3f}  F1 {self.f1:.3f}  acc {self.accuracy:.3f}  "
            f"P {self.precision:.3f}  R {self.recall:.3f}"
        )


def evaluate(truth: np.ndarray, probability: np.ndarray, threshold: float = 0.5) -> Metrics:
    truth = np.asarray(truth, dtype=int)
    probability = np.asarray(probability, dtype=float)
    predicted = (probability >= threshold).astype(int)

    # AUC is undefined when the truth has one class; report 0.5 (chance) rather than
    # crashing a cross-validation loop on an unlucky fold.
    auc = roc_auc_score(truth, probability) if len(np.unique(truth)) > 1 else 0.5

    return Metrics(
        roc_auc=float(auc),
        f1=float(f1_score(truth, predicted, zero_division=0)),
        accuracy=float(accuracy_score(truth, predicted)),
        precision=float(precision_score(truth, predicted, zero_division=0)),
        recall=float(recall_score(truth, predicted, zero_division=0)),
    )


class Baseline:
    name = "baseline"

    def fit(self, train: pd.DataFrame) -> "Baseline":
        raise NotImplementedError

    def predict_proba(self, frame: pd.DataFrame) -> np.ndarray:
        raise NotImplementedError

    def score(self, test: pd.DataFrame) -> Metrics:
        return evaluate(test[TARGET].to_numpy(), self.predict_proba(test))


class MajorityClass(Baseline):
    name = "base-rate"

    def fit(self, train: pd.DataFrame) -> "MajorityClass":
        self.rate_ = float(train[TARGET].mean())
        return self

    def predict_proba(self, frame: pd.DataFrame) -> np.ndarray:
        return np.full(len(frame), self.rate_)


class HourOfDay(Baseline):
    """Per-hour positive rate -- the population's average daily rhythm as a lookup."""

    name = "hour-of-day"

    def fit(self, train: pd.DataFrame) -> "HourOfDay":
        self.by_hour_ = train.groupby("hour_of_day")[TARGET].mean()
        self.fallback_ = float(train[TARGET].mean())
        return self

    def predict_proba(self, frame: pd.DataFrame) -> np.ndarray:
        # An hour absent from training falls back to the global rate rather than NaN,
        # which would otherwise poison every metric downstream.
        return frame["hour_of_day"].map(self.by_hour_).fillna(self.fallback_).to_numpy()


class PersonalRate(Baseline):
    """Each participant's own base rate. Informative only on a chronological split."""

    name = "personal-rate"

    def fit(self, train: pd.DataFrame) -> "PersonalRate":
        self.by_person_ = train.groupby("participant")[TARGET].mean()
        self.fallback_ = float(train[TARGET].mean())
        return self

    def predict_proba(self, frame: pd.DataFrame) -> np.ndarray:
        return frame["participant"].map(self.by_person_).fillna(self.fallback_).to_numpy()


ALL_BASELINES: list[type[Baseline]] = [MajorityClass, HourOfDay, PersonalRate]


def run_all(train: pd.DataFrame, test: pd.DataFrame) -> pd.DataFrame:
    """Fit and score every baseline. Returns a frame ready to print or paste into §5."""
    rows = []
    for factory in ALL_BASELINES:
        model = factory().fit(train)
        metrics = model.score(test)
        rows.append(
            {
                "model": model.name,
                "ROC-AUC": metrics.roc_auc,
                "F1": metrics.f1,
                "accuracy": metrics.accuracy,
                "precision": metrics.precision,
                "recall": metrics.recall,
            }
        )
    return pd.DataFrame(rows).round(4)


def verdict(model_auc: float, best_baseline_auc: float) -> str:
    """State the comparison in words, including when it is unflattering."""
    margin = model_auc - best_baseline_auc

    if margin <= 0:
        return (
            f"The model does NOT beat the best baseline "
            f"(AUC {model_auc:.3f} vs {best_baseline_auc:.3f}). "
            f"Report this and analyse why -- do not bury it."
        )
    if margin < 0.02:
        return (
            f"The model beats the best baseline by {margin:.3f} AUC, which is within "
            f"fold-to-fold noise. State the margin; do not claim an improvement."
        )
    if model_auc < DEPLOYMENT_FLOOR:
        return (
            f"The model beats the best baseline by {margin:.3f} AUC but sits at "
            f"{model_auc:.3f}, below the {DEPLOYMENT_FLOOR} floor for a usable model."
        )
    return f"The model beats the best baseline by {margin:.3f} AUC."


def report(train: pd.DataFrame, test: pd.DataFrame, model_metrics: Metrics | None = None,
           model_name: str = "model (ours)") -> str:
    """Baselines and the trained model in one table -- never the model on its own."""
    table = run_all(train, test)

    if model_metrics is not None:
        table = pd.concat(
            [
                table,
                pd.DataFrame(
                    [
                        {
                            "model": model_name,
                            "ROC-AUC": round(model_metrics.roc_auc, 4),
                            "F1": round(model_metrics.f1, 4),
                            "accuracy": round(model_metrics.accuracy, 4),
                            "precision": round(model_metrics.precision, 4),
                            "recall": round(model_metrics.recall, 4),
                        }
                    ]
                ),
            ],
            ignore_index=True,
        )

    lines = [table.to_string(index=False)]
    if model_metrics is not None:
        best = table[table.model != model_name]["ROC-AUC"].max()
        lines.append("\n  " + verdict(model_metrics.roc_auc, float(best)))

    return "\n".join(lines)


def confusion(truth: np.ndarray, probability: np.ndarray, threshold: float = 0.5) -> str:
    """Confusion matrix as text, for §5 and the appendix."""
    predicted = (np.asarray(probability) >= threshold).astype(int)
    tn, fp, fn, tp = confusion_matrix(np.asarray(truth, dtype=int), predicted, labels=[0, 1]).ravel()
    return (
        "                 predicted\n"
        "                 not-ready  ready\n"
        f"actual not-ready   {tn:6d} {fp:6d}\n"
        f"       ready       {fn:6d} {tp:6d}"
    )
