"""Leakage regression tests.

These guard the two ways this dataset can silently inflate a metric: scoring a model on
people it trained on, and letting it see a participant's future while predicting their
past. Both failures produce good-looking numbers, so nothing but a test catches them.
"""

import numpy as np
import pandas as pd
import pytest

from split import (
    PARTICIPANT_COLUMN,
    TIME_COLUMN,
    LeakageError,
    Split,
    chronological_split,
    group_split,
)


def cohort(n_participants: int = 20, rows_each: int = 40) -> pd.DataFrame:
    """A tidy frame shaped like the one ingest produces."""
    rng = np.random.default_rng(0)
    frames = []
    for index in range(n_participants):
        stamps = pd.date_range("2026-01-01", periods=rows_each, freq="h")
        frames.append(
            pd.DataFrame(
                {
                    PARTICIPANT_COLUMN: f"p{index:03d}",
                    TIME_COLUMN: stamps,
                    "hour_of_day": stamps.hour,
                    "focus_proxy": rng.uniform(1, 5, rows_each),
                }
            )
        )
    return pd.concat(frames, ignore_index=True)


# --- group_split ------------------------------------------------------------------


def test_no_participant_appears_in_two_splits():
    split = group_split(cohort())
    train = set(split.train[PARTICIPANT_COLUMN])
    val = set(split.val[PARTICIPANT_COLUMN])
    test = set(split.test[PARTICIPANT_COLUMN])

    assert not train & val
    assert not train & test
    assert not val & test


def test_every_participant_is_used_exactly_once():
    data = cohort()
    split = group_split(data)
    allocated = (
        set(split.train[PARTICIPANT_COLUMN])
        | set(split.val[PARTICIPANT_COLUMN])
        | set(split.test[PARTICIPANT_COLUMN])
    )
    assert allocated == set(data[PARTICIPANT_COLUMN])
    assert len(split.train) + len(split.val) + len(split.test) == len(data)


def test_split_is_deterministic_for_a_given_seed():
    """Metrics in the report must be reproducible from the seed alone."""
    first = group_split(cohort(), seed=42)
    second = group_split(cohort(), seed=42)
    assert set(first.test[PARTICIPANT_COLUMN]) == set(second.test[PARTICIPANT_COLUMN])


def test_different_seeds_give_different_splits():
    a = group_split(cohort(), seed=1)
    b = group_split(cohort(), seed=2)
    assert set(a.test[PARTICIPANT_COLUMN]) != set(b.test[PARTICIPANT_COLUMN])


def test_missing_participant_column_is_refused():
    data = cohort().drop(columns=[PARTICIPANT_COLUMN])
    with pytest.raises(LeakageError, match="no 'participant' column"):
        group_split(data)


def test_too_few_participants_to_split_is_refused():
    """Failing loudly beats returning an empty training set."""
    with pytest.raises(LeakageError, match="nothing would be left to train on"):
        group_split(cohort(n_participants=2), test_fraction=0.5, val_fraction=0.5)


def test_overlap_detector_catches_a_hand_built_bad_split():
    """Directly exercises the assertion, in case a future refactor bypasses group_split."""
    data = cohort(n_participants=6)
    shared = data[data[PARTICIPANT_COLUMN] == "p000"]
    bad = Split(train=data, val=data.iloc[0:0], test=shared)

    from split import _assert_no_participant_overlap

    with pytest.raises(LeakageError, match="participant leakage"):
        _assert_no_participant_overlap(bad)


# --- chronological_split ----------------------------------------------------------


def test_training_rows_never_postdate_test_rows():
    split = chronological_split(cohort())
    train_latest = split.train.groupby(PARTICIPANT_COLUMN)[TIME_COLUMN].max()
    test_earliest = split.test.groupby(PARTICIPANT_COLUMN)[TIME_COLUMN].min()

    for participant in test_earliest.index:
        assert train_latest[participant] <= test_earliest[participant]


def test_chronological_split_keeps_each_participant_in_all_splits():
    """Unlike group_split -- here the question is temporal, not cross-person."""
    data = cohort(n_participants=5)
    split = chronological_split(data)
    everyone = set(data[PARTICIPANT_COLUMN])

    assert set(split.train[PARTICIPANT_COLUMN]) == everyone
    assert set(split.test[PARTICIPANT_COLUMN]) == everyone


def test_chronological_split_ignores_input_row_order():
    """Ingest makes no ordering promise, so the split must sort for itself."""
    shuffled = cohort(n_participants=4).sample(frac=1, random_state=3).reset_index(drop=True)
    split = chronological_split(shuffled)

    train_latest = split.train.groupby(PARTICIPANT_COLUMN)[TIME_COLUMN].max()
    test_earliest = split.test.groupby(PARTICIPANT_COLUMN)[TIME_COLUMN].min()
    for participant in test_earliest.index:
        assert train_latest[participant] <= test_earliest[participant]


def test_participant_with_too_few_rows_goes_to_training():
    """Better than emitting a one-row test set that yields a meaningless metric."""
    data = cohort(n_participants=3, rows_each=3)
    split = chronological_split(data)
    assert len(split.train) == len(data)
    assert split.test.empty


def test_no_row_is_lost_or_duplicated():
    data = cohort(n_participants=8)
    split = chronological_split(data)
    assert len(split.train) + len(split.val) + len(split.test) == len(data)
