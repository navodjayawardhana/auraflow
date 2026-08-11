"""Feature construction: the data-quality corrections and the encodings must hold.

Each of these guards a silent failure -- a wrong unit, an invented measurement, or a
collinear feature set that produces uninterpretable coefficients.
"""

import numpy as np
import pandas as pd
import pytest

from build_features import (
    CONTEXT_FEATURES,
    CONTEXT_REFERENCE,
    FEATURE_COLUMNS,
    MAX_SLEEP_HOURS,
    MILLISECONDS_PER_HOUR,
    MIN_SLEEP_HOURS,
    add_cyclical_time,
    add_resting_hr_delta,
    clean_sleep,
)
from ingest_lifesnaps import CONTEXT_COLUMNS


# --- sleep cleaning ---------------------------------------------------------------


def test_sleep_duration_is_converted_from_milliseconds():
    """The archive stores milliseconds. Reading it as minutes gives 27 million-hour nights."""
    daily = pd.DataFrame({"sleep_duration": [8 * MILLISECONDS_PER_HOUR]})
    assert clean_sleep(daily)["sleep_hours"].iloc[0] == pytest.approx(8.0)


def test_implausible_nights_become_nan_rather_than_being_clipped():
    """Clipping would invent a plausible measurement where none was taken."""
    hours = [1.0, 3.5, 7.6, 12.5, 20.7]
    daily = pd.DataFrame({"sleep_duration": [h * MILLISECONDS_PER_HOUR for h in hours]})
    cleaned = clean_sleep(daily)["sleep_hours"]

    assert np.isnan(cleaned.iloc[0])  # 1.0 h
    assert np.isnan(cleaned.iloc[3])  # 12.5 h
    assert np.isnan(cleaned.iloc[4])  # 20.7 h
    assert cleaned.iloc[1] == pytest.approx(3.5)
    assert cleaned.iloc[2] == pytest.approx(7.6)
    # Nothing was moved to the boundary.
    assert not (cleaned == MIN_SLEEP_HOURS).any()
    assert not (cleaned == MAX_SLEEP_HOURS).any()


# --- resting HR delta -------------------------------------------------------------


def test_resting_hr_delta_is_relative_to_the_participants_own_trailing_week():
    """Absolute resting HR mostly encodes fitness, a between-person difference the
    group split withholds. The deviation is the signal that transfers."""
    daily = pd.DataFrame(
        {
            "participant": ["a"] * 8,
            "date": pd.date_range("2026-01-01", periods=8),
            "resting_hr": [60, 60, 60, 60, 60, 60, 60, 70],
        }
    )
    delta = add_resting_hr_delta(daily)["resting_hr_delta_7d"]
    assert delta.iloc[-1] == pytest.approx(10.0)


def test_delta_does_not_leak_across_participants():
    """A fit person's baseline must not shift an unfit person's delta."""
    daily = pd.DataFrame(
        {
            "participant": ["a"] * 4 + ["b"] * 4,
            "date": list(pd.date_range("2026-01-01", periods=4)) * 2,
            "resting_hr": [50, 50, 50, 50, 80, 80, 80, 80],
        }
    )
    out = add_resting_hr_delta(daily)
    assert out.groupby("participant")["resting_hr_delta_7d"].max().abs().max() < 1e-9


def test_first_days_of_a_participant_are_nan_by_construction():
    """A trailing mean needs history; two days is the documented minimum."""
    daily = pd.DataFrame(
        {
            "participant": ["a"] * 3,
            "date": pd.date_range("2026-01-01", periods=3),
            "resting_hr": [60, 62, 64],
        }
    )
    assert np.isnan(add_resting_hr_delta(daily)["resting_hr_delta_7d"].iloc[0])


# --- cyclical time ----------------------------------------------------------------


def test_midnight_and_23h_are_adjacent_after_encoding():
    """The whole point: as raw integers they are 23 apart, which is why a linear model
    cannot represent a daily rhythm from them."""
    frame = add_cyclical_time(pd.DataFrame({"hour_of_day": [23, 0], "day_of_week": [0, 0]}))
    gap = np.hypot(
        frame.hour_sin.iloc[0] - frame.hour_sin.iloc[1],
        frame.hour_cos.iloc[0] - frame.hour_cos.iloc[1],
    )
    # One hour's arc on the unit circle.
    assert gap == pytest.approx(2 * np.sin(np.pi / 24), abs=1e-9)


def test_cyclical_encoding_lies_on_the_unit_circle():
    frame = add_cyclical_time(
        pd.DataFrame({"hour_of_day": range(24), "day_of_week": [0] * 24})
    )
    assert np.allclose(frame.hour_sin**2 + frame.hour_cos**2, 1.0)


def test_sunday_and_monday_are_adjacent():
    frame = add_cyclical_time(pd.DataFrame({"hour_of_day": [9, 9], "day_of_week": [6, 0]}))
    gap = np.hypot(
        frame.dow_sin.iloc[0] - frame.dow_sin.iloc[1],
        frame.dow_cos.iloc[0] - frame.dow_cos.iloc[1],
    )
    assert gap == pytest.approx(2 * np.sin(np.pi / 7), abs=1e-9)


# --- collinearity guards ----------------------------------------------------------


def test_one_context_column_is_held_out_as_reference():
    """All eight one-hots sum to 1, which is perfectly collinear with the intercept.
    Fitting all of them gave every context column infinite VIF."""
    assert CONTEXT_REFERENCE in CONTEXT_COLUMNS
    assert CONTEXT_REFERENCE not in CONTEXT_FEATURES
    assert len(CONTEXT_FEATURES) == len(CONTEXT_COLUMNS) - 1


def test_distance_is_not_a_feature():
    """r = 0.986 with steps (VIF 42 / 40). Fitting both produced large, near-equal,
    opposite coefficients -- an artefact that cannot be interpreted or defended."""
    assert "distance" not in FEATURE_COLUMNS


def test_raw_hour_and_weekday_integers_are_not_features():
    """They remain in the frame for the hour-of-day baseline, but the model sees the
    cyclical encoding instead."""
    assert "hour_of_day" not in FEATURE_COLUMNS
    assert "day_of_week" not in FEATURE_COLUMNS
    assert {"hour_sin", "hour_cos", "dow_sin", "dow_cos"} <= set(FEATURE_COLUMNS)


def test_no_feature_is_listed_twice():
    assert len(FEATURE_COLUMNS) == len(set(FEATURE_COLUMNS))
