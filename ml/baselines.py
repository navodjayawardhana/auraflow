"""Baselines the trained model has to beat to be worth shipping.

A neural network reported in isolation says nothing. An MAE of 0.6 on a 1-5 scale
sounds respectable until you find that always predicting the training mean scores 0.62 --
at which point the model has bought a rounding error in exchange for 400 KB of weights,
an inference budget and a great deal of report space.

So every metric in the evaluation chapter is reported against these, in the same table.
That is also the honest answer to the obvious viva question: how do you know the model
learned anything?

Three baselines, in increasing order of how hard they are to beat:

    MeanBaseline        predicts the training mean for every row. If the model cannot
                        beat this, it has learned nothing at all.

    HourOfDayBaseline   predicts the training mean for that hour. This is the one that
                        matters: the app's core claim is that it knows *when* you focus
                        best, and a lookup table already knows that on average. The
                        model has to beat the population's average daily rhythm.

    PersonalMeanBaseline  predicts each participant's own training mean, falling back to
                        the global mean for unseen people. Tests whether the model adds
                        anything beyond "some people concentrate better than others."
                        Only meaningful on a chronological split, where a participant is
                        present in both halves.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

TARGET = "focus_proxy"


@dataclass
class Metrics:
    mae: float
    rmse: float
    r2: float

    def __str__(self) -> str:
        return f"MAE {self.mae:.3f}   RMSE {self.rmse:.3f}   R2 {self.r2:+.3f}"


def evaluate(truth: np.ndarray, predicted: np.ndarray) -> Metrics:
    truth = np.asarray(truth, dtype=float)
    predicted = np.asarray(predicted, dtype=float)
    error = truth - predicted

    variance = float(np.sum((truth - truth.mean()) ** 2))
    # R2 is undefined when the truth has no variance; report 0 rather than dividing by
    # zero, and let the MAE carry the meaning in that (degenerate) case.
    r2 = 1.0 - float(np.sum(error**2)) / variance if variance > 0 else 0.0

    return Metrics(
        mae=float(np.mean(np.abs(error))),
        rmse=float(np.sqrt(np.mean(error**2))),
        r2=r2,
    )


class Baseline:
    name = "baseline"

    def fit(self, train: pd.DataFrame) -> "Baseline":
        raise NotImplementedError

    def predict(self, frame: pd.DataFrame) -> np.ndarray:
        raise NotImplementedError

    def score(self, test: pd.DataFrame) -> Metrics:
        return evaluate(test[TARGET].to_numpy(), self.predict(test))


class MeanBaseline(Baseline):
    name = "mean"

    def fit(self, train: pd.DataFrame) -> "MeanBaseline":
        self.mean_ = float(train[TARGET].mean())
        return self

    def predict(self, frame: pd.DataFrame) -> np.ndarray:
        return np.full(len(frame), self.mean_)


class HourOfDayBaseline(Baseline):
    """Per-hour training mean -- the population's average daily rhythm as a lookup."""

    name = "hour-of-day"

    def fit(self, train: pd.DataFrame) -> "HourOfDayBaseline":
        self.by_hour_ = train.groupby("hour_of_day")[TARGET].mean()
        self.fallback_ = float(train[TARGET].mean())
        return self

    def predict(self, frame: pd.DataFrame) -> np.ndarray:
        # An hour absent from training falls back to the global mean rather than NaN,
        # which would otherwise poison every metric downstream.
        return frame["hour_of_day"].map(self.by_hour_).fillna(self.fallback_).to_numpy()


class PersonalMeanBaseline(Baseline):
    """Each participant's own training mean. Only informative on a chronological split."""

    name = "personal-mean"

    def fit(self, train: pd.DataFrame) -> "PersonalMeanBaseline":
        self.by_person_ = train.groupby("participant")[TARGET].mean()
        self.fallback_ = float(train[TARGET].mean())
        return self

    def predict(self, frame: pd.DataFrame) -> np.ndarray:
        return frame["participant"].map(self.by_person_).fillna(self.fallback_).to_numpy()


ALL_BASELINES: list[type[Baseline]] = [MeanBaseline, HourOfDayBaseline, PersonalMeanBaseline]


def run_all(train: pd.DataFrame, test: pd.DataFrame) -> pd.DataFrame:
    """Fit and score every baseline. Returns a frame ready to print or paste into §5."""
    rows = []
    for factory in ALL_BASELINES:
        model = factory().fit(train)
        metrics = model.score(test)
        rows.append(
            {"model": model.name, "MAE": metrics.mae, "RMSE": metrics.rmse, "R2": metrics.r2}
        )
    return pd.DataFrame(rows).round(4)


def report(train: pd.DataFrame, test: pd.DataFrame, model_metrics: Metrics | None = None) -> str:
    """Baselines and the trained model in one table -- never the model on its own."""
    table = run_all(train, test)
    if model_metrics is not None:
        table = pd.concat(
            [
                table,
                pd.DataFrame(
                    [
                        {
                            "model": "MLP (ours)",
                            "MAE": round(model_metrics.mae, 4),
                            "RMSE": round(model_metrics.rmse, 4),
                            "R2": round(model_metrics.r2, 4),
                        }
                    ]
                ),
            ],
            ignore_index=True,
        )

    lines = [table.to_string(index=False)]

    if model_metrics is not None:
        best_baseline = table[table["model"] != "MLP (ours)"]["MAE"].min()
        margin = best_baseline - model_metrics.mae
        if margin <= 0:
            lines.append(
                f"\n  The model does NOT beat the best baseline "
                f"(MAE {model_metrics.mae:.3f} vs {best_baseline:.3f}). "
                f"Report this and analyse why -- do not bury it."
            )
        elif margin < 0.05:
            lines.append(
                f"\n  The model beats the best baseline by {margin:.3f} MAE, which is "
                f"marginal on a 1-5 scale. State the margin explicitly rather than "
                f"claiming an improvement."
            )
        else:
            lines.append(f"\n  The model beats the best baseline by {margin:.3f} MAE.")

    return "\n".join(lines)
