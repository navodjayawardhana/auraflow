"""The target definition is the project's most consequential single choice.

It is derived rather than measured, so if it drifts the evaluation chapter ends up
describing something the model was not trained on. These tests pin the mapping.
"""

import numpy as np
import pandas as pd
import pytest

from ingest_lifesnaps import MOOD_COLUMNS
from labels import (
    AMBIGUOUS,
    FOCUS_READY,
    MOOD,
    NOT_FOCUS_READY,
    TARGET,
    add_mood,
    add_target,
    labelled_only,
)


def rows(moods: list[str | None], participant: str = "p01") -> pd.DataFrame:
    """Build a frame shaped like the hourly file: one-hot moods, NaN when unlabelled."""
    data = {column: [] for column in MOOD_COLUMNS}
    for mood in moods:
        for column in MOOD_COLUMNS:
            data[column].append(np.nan if mood is None else float(column == mood))
    frame = pd.DataFrame(data)
    frame["participant"] = participant
    return frame


def test_every_mood_category_has_a_defined_role():
    """No category may be silently unhandled -- that would drop data without a reason."""
    assert FOCUS_READY | NOT_FOCUS_READY | AMBIGUOUS == set(MOOD_COLUMNS)
    assert not FOCUS_READY & NOT_FOCUS_READY
    assert not FOCUS_READY & AMBIGUOUS
    assert not NOT_FOCUS_READY & AMBIGUOUS


def test_mood_is_recovered_from_the_one_hot_columns():
    frame = add_mood(rows(["ALERT", "TIRED", None]))
    assert frame[MOOD].tolist()[:2] == ["ALERT", "TIRED"]
    assert pd.isna(frame[MOOD].iloc[2])


def test_positive_and_negative_classes():
    frame = add_target(rows(["ALERT", "HAPPY", "TIRED", "SAD"]))
    assert frame[TARGET].tolist() == [1.0, 1.0, 0.0, 0.0]


def test_ambiguous_moods_are_dropped_not_assigned():
    """RESTED/RELAXED is pleasant but deactivated; TENSE is activated but aversive.

    Forcing these onto a side is what made the discarded `strict` construction score
    worst of the four candidates.
    """
    frame = add_target(rows(sorted(AMBIGUOUS)))
    assert frame[TARGET].isna().all()


def test_unlabelled_rows_stay_unlabelled():
    frame = add_target(rows([None, None]))
    assert frame[TARGET].isna().all()


def test_add_target_accepts_a_frame_that_already_has_mood():
    """build_features may call either helper; they must compose without double work."""
    once = add_target(add_mood(rows(["ALERT", "TIRED"])))
    twice = add_target(rows(["ALERT", "TIRED"]))
    assert once[TARGET].tolist() == twice[TARGET].tolist()


def test_missing_mood_columns_raise_rather_than_produce_an_empty_label():
    frame = rows(["ALERT"]).drop(columns=["ALERT", "TIRED"])
    with pytest.raises(KeyError, match="mood columns absent"):
        add_mood(frame)


def test_labelled_only_returns_integers_not_floats():
    """A float target silently turns a classifier into a regressor in some APIs."""
    frame = labelled_only(rows(["ALERT"] * 6 + ["TIRED"] * 6))
    assert frame[TARGET].dtype.kind == "i"


def test_participants_below_the_row_threshold_are_excluded():
    """Someone with three labelled rows cannot support a CV fold."""
    many = rows(["ALERT"] * 8 + ["TIRED"] * 8, participant="keep")
    few = rows(["ALERT", "TIRED"], participant="drop")
    frame = labelled_only(pd.concat([many, few], ignore_index=True))

    assert set(frame.participant) == {"keep"}


def test_threshold_is_applied_after_ambiguous_rows_are_removed():
    """A participant of mostly-ambiguous rows must not pass on raw row count alone."""
    padded = rows(["NEUTRAL"] * 20 + ["ALERT"] * 2, participant="mostly-ambiguous")
    frame = labelled_only(padded, min_rows_per_participant=10)
    assert frame.empty
