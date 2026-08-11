"""Dataset splitting, with the two leakage paths this data can produce closed off.

Two different questions need two different splits, and using the wrong one silently
inflates the metric rather than failing.

**Participant-wise (`group_split`)** -- for the population model, the one shipped to a
new user who has no history yet. Every participant appears in exactly one split. Without
this the model can memorise individuals: a person's rows are highly autocorrelated, so
training on their Monday and testing on their Tuesday measures recall of that person,
not a learned pattern. Reported accuracy would look strong and mean nothing about a
user the model has never seen.

**Chronological (`chronological_split`)** -- for the personalisation and online-learning
story, where the question is whether a model fitted to one person's past predicts their
future. Here the split must be by time, because a random split would let the model see
Wednesday while predicting Tuesday.

Both are enforced with assertions rather than left to caller discipline, and both are
covered by `tests/test_split.py`.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

PARTICIPANT_COLUMN = "participant"
TIME_COLUMN = "timestamp"

# The evaluation cohort must not be so small that a single unusual participant
# dominates the metric. Below this, report the split sizes explicitly in §5.
MIN_PARTICIPANTS_PER_SPLIT = 3


class LeakageError(AssertionError):
    """Raised when a split would let information cross between train and test."""


@dataclass(frozen=True)
class Split:
    train: pd.DataFrame
    val: pd.DataFrame
    test: pd.DataFrame

    def summary(self) -> str:
        def describe(name: str, frame: pd.DataFrame) -> str:
            people = (
                frame[PARTICIPANT_COLUMN].nunique() if PARTICIPANT_COLUMN in frame.columns else 0
            )
            return f"{name:<6} {len(frame):>7,} rows  {people:>3} participants"

        return "\n".join(
            [describe("train", self.train), describe("val", self.val), describe("test", self.test)]
        )


def _assert_no_participant_overlap(split: Split) -> None:
    sets = {
        name: set(frame[PARTICIPANT_COLUMN].unique())
        for name, frame in (("train", split.train), ("val", split.val), ("test", split.test))
    }
    for left, right in (("train", "val"), ("train", "test"), ("val", "test")):
        shared = sets[left] & sets[right]
        if shared:
            raise LeakageError(
                f"participant leakage: {len(shared)} participant(s) appear in both "
                f"{left} and {right} -- {sorted(shared)[:5]}. The model would be scored "
                f"on people it trained on."
            )


def group_split(
    frame: pd.DataFrame,
    test_fraction: float = 0.15,
    val_fraction: float = 0.15,
    seed: int = 7003,
) -> Split:
    """Split by participant, so no individual appears in more than one split.

    Fractions are of *participants*, not rows, so the resulting row counts will not
    match the requested proportions exactly -- participants contribute unequal numbers
    of rows. That is the correct trade-off: balancing rows would require splitting a
    participant across sets, which is the leakage this function exists to prevent.
    """
    if PARTICIPANT_COLUMN not in frame.columns:
        raise LeakageError(
            f"cannot group-split: no '{PARTICIPANT_COLUMN}' column, so participants "
            f"cannot be kept apart."
        )

    people = np.array(sorted(frame[PARTICIPANT_COLUMN].unique()))
    rng = np.random.default_rng(seed)
    rng.shuffle(people)

    n_test = max(1, round(len(people) * test_fraction))
    n_val = max(1, round(len(people) * val_fraction))
    if n_test + n_val >= len(people):
        raise LeakageError(
            f"{len(people)} participants cannot support a {test_fraction:.0%}/"
            f"{val_fraction:.0%} split -- nothing would be left to train on."
        )

    test_ids, val_ids = people[:n_test], people[n_test : n_test + n_val]
    train_ids = people[n_test + n_val :]

    split = Split(
        train=frame[frame[PARTICIPANT_COLUMN].isin(train_ids)].copy(),
        val=frame[frame[PARTICIPANT_COLUMN].isin(val_ids)].copy(),
        test=frame[frame[PARTICIPANT_COLUMN].isin(test_ids)].copy(),
    )
    _assert_no_participant_overlap(split)

    for name, ids in (("test", test_ids), ("val", val_ids)):
        if len(ids) < MIN_PARTICIPANTS_PER_SPLIT:
            print(
                f"  warning: {name} split holds only {len(ids)} participant(s). "
                f"One atypical person will dominate the metric -- report the split "
                f"sizes alongside the numbers."
            )

    return split


def chronological_split(
    frame: pd.DataFrame,
    test_fraction: float = 0.15,
    val_fraction: float = 0.15,
) -> Split:
    """Split each participant's rows by time: earliest to train, latest to test.

    Used for the personalisation story. Every participant appears in all three splits by
    design -- the question here is temporal generalisation within a person, not across
    people, so `group_split`'s guarantee is deliberately not wanted.
    """
    for column in (TIME_COLUMN, PARTICIPANT_COLUMN):
        if column not in frame.columns:
            raise LeakageError(f"cannot split chronologically: no '{column}' column.")

    train_parts, val_parts, test_parts = [], [], []

    for _, rows in frame.groupby(PARTICIPANT_COLUMN, sort=True):
        rows = rows.sort_values(TIME_COLUMN)
        n = len(rows)
        n_test = int(n * test_fraction)
        n_val = int(n * val_fraction)
        cut_val = n - n_test - n_val

        if cut_val <= 0:
            # Too few rows to divide three ways; keep them for training rather than
            # emitting a one-row test set that produces a meaningless metric.
            train_parts.append(rows)
            continue

        train_parts.append(rows.iloc[:cut_val])
        val_parts.append(rows.iloc[cut_val : cut_val + n_val])
        test_parts.append(rows.iloc[cut_val + n_val :])

    def combine(parts: list[pd.DataFrame]) -> pd.DataFrame:
        return pd.concat(parts, ignore_index=True) if parts else frame.iloc[0:0].copy()

    split = Split(combine(train_parts), combine(val_parts), combine(test_parts))
    _assert_temporal_order(split)
    return split


def _assert_temporal_order(split: Split) -> None:
    """No participant's training rows may postdate their test rows."""
    if split.test.empty or split.train.empty:
        return

    train_latest = split.train.groupby(PARTICIPANT_COLUMN)[TIME_COLUMN].max()
    test_earliest = split.test.groupby(PARTICIPANT_COLUMN)[TIME_COLUMN].min()

    shared = train_latest.index.intersection(test_earliest.index)
    offenders = [p for p in shared if train_latest[p] > test_earliest[p]]
    if offenders:
        raise LeakageError(
            f"temporal leakage: {len(offenders)} participant(s) have training rows later "
            f"than their test rows -- {offenders[:5]}. The model would predict the past "
            f"having seen the future."
        )
