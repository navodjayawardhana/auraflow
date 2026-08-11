"""The wall between simulated data and model training must hold.

If this suite ever goes red, the evaluation chapter is invalid until it is green again:
a model trained on simulator output learns the rules in `simulate.py` and every metric
derived from it measures nothing but those rules. See docs/DATASET.md section 6.
"""

import pandas as pd
import pytest

from provenance import (
    MEASURED,
    ORIGIN_COLUMN,
    SYNTHETIC,
    SyntheticDataInTrainingError,
    assert_measured,
    is_synthetic,
    mark_measured,
    mark_synthetic,
)


@pytest.fixture
def frame() -> pd.DataFrame:
    return pd.DataFrame({"hour_of_day": [9, 14, 20], "focus_proxy": [3.9, 2.8, 2.1]})


def test_measured_frame_passes(frame):
    assert_measured(mark_measured(frame, "lifesnaps"))


def test_synthetic_frame_is_rejected(frame):
    with pytest.raises(SyntheticDataInTrainingError, match="non-measured"):
        assert_measured(mark_synthetic(frame))


def test_single_synthetic_row_among_measured_is_rejected(frame):
    """The realistic failure: a fixture concatenated into a real frame by accident.

    Rejecting a wholly-synthetic frame is easy. This is the case that would otherwise
    slip through, so it is the one worth pinning down.
    """
    contaminated = pd.concat(
        [mark_measured(frame, "lifesnaps"), mark_synthetic(frame.head(1))],
        ignore_index=True,
    )
    with pytest.raises(SyntheticDataInTrainingError) as excinfo:
        assert_measured(contaminated)

    # The error has to say how much got in, or debugging it means guessing.
    assert SYNTHETIC in str(excinfo.value)
    assert "3" in str(excinfo.value) and "1" in str(excinfo.value)


def test_untagged_frame_is_rejected_not_assumed_clean(frame):
    """An untagged frame means some path built data without declaring its origin.

    Treating that as measured would defeat the entire mechanism, so it must fail.
    """
    with pytest.raises(SyntheticDataInTrainingError, match="origin cannot be established"):
        assert_measured(frame)


def test_marking_does_not_mutate_the_caller_s_frame(frame):
    """Tagging returns a copy. An in-place tag could silently relabel a shared frame."""
    mark_synthetic(frame)
    assert ORIGIN_COLUMN not in frame.columns


def test_measured_records_which_dataset(frame):
    tagged = mark_measured(frame, "pmdata")
    assert tagged["source_dataset"].eq("pmdata").all()
    assert tagged[ORIGIN_COLUMN].eq(MEASURED).all()


def test_is_synthetic_detects_partial_contamination(frame):
    clean = mark_measured(frame, "lifesnaps")
    contaminated = pd.concat([clean, mark_synthetic(frame.head(1))], ignore_index=True)

    assert not is_synthetic(clean)
    assert is_synthetic(contaminated)


def test_error_message_names_the_stage(frame):
    """A failure in feature-building and one in training need to be told apart."""
    with pytest.raises(SyntheticDataInTrainingError, match="feature-build"):
        assert_measured(mark_synthetic(frame), stage="feature-build")


# --- The generated fixtures themselves -------------------------------------------


def test_every_simulator_fixture_is_tagged_synthetic():
    """Guards the generator, not just the helper.

    A future edit to simulate.py could emit an untagged frame; the tags above would
    still pass while the real artefacts on disk went unmarked.
    """
    from pathlib import Path

    fixtures = sorted((Path(__file__).resolve().parent.parent / "fixtures").glob("*.csv"))
    assert fixtures, "no simulator fixtures found - run: python ml/simulate.py"

    for path in fixtures:
        data = pd.read_csv(path)
        assert ORIGIN_COLUMN in data.columns, f"{path.name} carries no origin column"
        assert data[ORIGIN_COLUMN].eq(SYNTHETIC).all(), f"{path.name} is not tagged synthetic"

        with pytest.raises(SyntheticDataInTrainingError):
            assert_measured(data)
