"""E1 -- retrospective policy evaluation: is the app's advice any good?

ROC-AUC says the model can rank hours. It does not say whether *acting* on that ranking
would help, and that is the question the brief's "effectiveness" axis actually asks.

This is what replaces the planned within-subject before/after study, which died with the
personal data collection (docs/DATASET.md section 7).

The question, posed the way a user would
---------------------------------------
"The app tells me my best k hours. If I had worked in those hours, would they actually
have been good ones?"

So for each participant the model has never seen: rank all of that person's labelled
hours by predicted readiness, take the top k, and measure what fraction were genuinely
focus-ready. That is **precision@k** -- the accuracy of the advice the app would have
given that specific person.

Compared against three policies the app has to beat to justify existing:

    random      shuffle the hours. Equals the person's base rate in expectation, and is
                the floor: an app no better than this is worse than useless, because it
                costs attention to consult.
    fixed-09:00 always recommend the hours nearest 9am. The "just work in the morning"
                advice anyone can give for free, and a real competitor.
    population  rank by the cohort's average readiness for that hour. A lookup table
                built from other people -- no personalisation at all.

Every participant is held out exactly once via GroupKFold, so this uses the whole cohort
rather than one arbitrary test split.

Two threats to validity, both measured or stated
------------------------------------------------
**1. Observed context is not available for a future hour.** The model's strongest features
are location one-hots (`WORK/SCHOOL`, `HOME`, ...) recording where the person *was* at that
hour. To recommend tomorrow at 10:00, a real app must **predict** location rather than
observe it -- from calendar and geofencing history, imperfectly. Scoring with observed
context therefore flatters the deployed system.

This script measures the gap: every policy is evaluated twice, once with context and once
with time and biometrics only. The context-free row is the **conservative** number, and
the honest one to lead with unless location prediction is separately validated.

**2. Retrospective, not causal.** Nobody followed this advice; the hours were lived, then
labelled. Someone told to work at 10:00 might have felt different *because* they were told.
Only a prospective trial answers that, and it is out of scope. See docs/DATASET.md 7.

Run:  python ml/evaluate_policy.py
"""

from __future__ import annotations

import numpy as np
import pandas as pd
from sklearn.model_selection import GroupKFold

from baselines import TARGET
from build_features import CONTEXT_FEATURES, FEATURE_COLUMNS, OUTPUT as MODEL_FRAME
from provenance import assert_measured
from train import N_FOLDS, SEED, make_logistic

#: How many hours the app would recommend. k=1 is "your best hour today"; k=3 is a
#: realistic morning/afternoon/evening shortlist.
K_VALUES = (1, 3, 5)

#: A participant needs enough labelled hours for precision@5 to mean anything.
MIN_HOURS = 10

IDEAL_HOUR = 9  # the fixed-09:00 policy


def rank_random(frame: pd.DataFrame, rng: np.random.Generator) -> np.ndarray:
    return rng.permutation(len(frame))


def rank_fixed_hour(frame: pd.DataFrame) -> np.ndarray:
    """Nearest to 09:00 first, wrapping around midnight."""
    distance = (frame["hour_of_day"] - IDEAL_HOUR).abs()
    distance = np.minimum(distance, 24 - distance)
    return np.argsort(distance.to_numpy(), kind="stable")


def rank_population(frame: pd.DataFrame, by_hour: pd.Series, fallback: float) -> np.ndarray:
    scores = frame["hour_of_day"].map(by_hour).fillna(fallback).to_numpy()
    return np.argsort(-scores, kind="stable")


def precision_at_k(truth: np.ndarray, order: np.ndarray, k: int) -> float | None:
    """Fraction of the top-k recommended hours that were genuinely focus-ready."""
    if len(order) < k:
        return None
    return float(truth[order[:k]].mean())


def evaluate(frame: pd.DataFrame, use_context: bool = True) -> pd.DataFrame:
    features = [c for c in FEATURE_COLUMNS if c in frame.columns]
    if not use_context:
        features = [c for c in features if c not in CONTEXT_FEATURES]
    rng = np.random.default_rng(SEED)

    records: list[dict] = []
    folds = GroupKFold(n_splits=N_FOLDS).split(frame, frame[TARGET], frame["participant"])

    for train_idx, test_idx in folds:
        train, test = frame.iloc[train_idx], frame.iloc[test_idx]

        model = make_logistic().fit(train[features], train[TARGET])
        by_hour = train.groupby("hour_of_day")[TARGET].mean()
        fallback = float(train[TARGET].mean())

        for participant, rows in test.groupby("participant"):
            if len(rows) < MIN_HOURS:
                continue

            truth = rows[TARGET].to_numpy()
            probability = model.predict_proba(rows[features])[:, 1]

            orders = {
                "AuraFlow model": np.argsort(-probability, kind="stable"),
                "population lookup": rank_population(rows, by_hour, fallback),
                "fixed 09:00": rank_fixed_hour(rows),
                "random": rank_random(rows, rng),
            }

            for policy, order in orders.items():
                record = {
                    "participant": participant,
                    "policy": policy,
                    "base_rate": float(truth.mean()),
                    "n_hours": len(rows),
                }
                for k in K_VALUES:
                    record[f"P@{k}"] = precision_at_k(truth, order, k)
                records.append(record)

    return pd.DataFrame(records)


def summarise(records: pd.DataFrame) -> pd.DataFrame:
    """Mean precision@k per policy, averaged over participants.

    Averaged per participant rather than pooled over rows: pooling would let the people
    with the most labelled hours dominate, and the claim being made is about what the app
    does for an individual.
    """
    columns = [f"P@{k}" for k in K_VALUES]
    table = records.groupby("policy")[columns].mean()
    table["participants"] = records.groupby("policy")["participant"].nunique()
    return table.sort_values(columns[0], ascending=False).round(3)


def main() -> int:
    if not MODEL_FRAME.exists():
        print(f"{MODEL_FRAME.name} not found. Run: python ml/build_features.py")
        return 1

    frame = pd.read_parquet(MODEL_FRAME)
    assert_measured(frame, stage="policy evaluation")

    results = {}
    for label, use_context in (("with observed context", True), ("time + biometrics only", False)):
        records = evaluate(frame, use_context=use_context)
        results[label] = (records, summarise(records))

    base_rate = results["with observed context"][0].drop_duplicates("participant").base_rate.mean()
    evaluated = results["with observed context"][0].participant.nunique()

    print(
        f"participants evaluated {evaluated}  "
        f"(of {frame.participant.nunique()}; {MIN_HOURS}+ labelled hours required)"
    )
    print(f"mean personal base rate {base_rate:.3f}  <- what random recommendation gets")

    for label, (_, table) in results.items():
        print(f"\n=== {label} ===")
        print(table.to_string())

        model_row = table.loc["AuraFlow model"]
        for k in K_VALUES:
            column = f"P@{k}"
            others = table.drop(index="AuraFlow model")[column]
            best_rival, best_score = others.idxmax(), others.max()
            margin = model_row[column] - best_score
            if margin <= 0:
                print(
                    f"  {column}: does NOT beat '{best_rival}' "
                    f"({model_row[column]:.3f} vs {best_score:.3f}). Report it."
                )
            else:
                print(
                    f"  {column}: {model_row[column]:.3f} vs {best_score:.3f} "
                    f"('{best_rival}')  +{margin:.3f}"
                )

    optimistic = results["with observed context"][1].loc["AuraFlow model", "P@1"]
    conservative = results["time + biometrics only"][1].loc["AuraFlow model", "P@1"]

    print("\n=== what to report ===")
    print(f"  P@1 with observed context   {optimistic:.3f}   optimistic upper bound")
    print(f"  P@1 without context         {conservative:.3f}   conservative, deployable today")
    print(f"  personal base rate          {base_rate:.3f}")
    print(f"  cost of not knowing location {optimistic - conservative:+.3f}")
    print(
        "\n  Lead with the context-free number unless location prediction is separately\n"
        "  validated: recommending a FUTURE hour means predicting where you will be,\n"
        "  not observing where you were.\n"
        "\n  Reads as: of the hours the app would have recommended, this fraction were\n"
        "  genuinely focus-ready. Agreement with past behaviour, not causal improvement."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
