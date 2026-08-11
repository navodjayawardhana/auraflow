"""Recovery Score: the rules must behave as documented, and must not see the future."""

import numpy as np
import pandas as pd
import pytest

from recovery import (
    DEFAULT_SLEEP_NEED_HOURS,
    ILLNESS_Z_THRESHOLD,
    MIN_BASELINE_DAYS,
    WEIGHT_AUTONOMIC,
    add_personal_baselines,
    architecture_score,
    autonomic_score,
    duration_score,
    illness_flag,
    recovery_score,
)


def days(n: int, participant: str = "p01", **columns) -> pd.DataFrame:
    frame = pd.DataFrame(
        {
            "participant": participant,
            "date": pd.date_range("2026-01-01", periods=n),
        }
    )
    for name, value in columns.items():
        frame[name] = value
    return frame


# --- duration ---------------------------------------------------------------------


def test_meeting_the_sleep_need_scores_full_marks():
    assert duration_score(8.0, 8.0) == 100.0


def test_short_sleep_is_penalised_about_twice_as_hard_as_long_sleep():
    """Sleeping an hour over costs little; an hour under is a real deficit."""
    short = 100 - duration_score(7.0, 8.0)
    long = 100 - duration_score(9.0, 8.0)
    assert short == pytest.approx(2 * long)


def test_duration_score_is_bounded():
    assert duration_score(0.0, 8.0) == 0.0
    assert 0.0 <= duration_score(14.0, 8.0) <= 100.0


def test_missing_sleep_is_nan_not_zero():
    """Zero would read as 'slept terribly' rather than 'no data'."""
    assert np.isnan(duration_score(np.nan))


# --- autonomic --------------------------------------------------------------------


def test_resting_hr_at_baseline_is_mid_scale():
    assert autonomic_score(60.0, 60.0, 3.0) == 50.0


def test_resting_hr_below_baseline_scores_above_mid():
    assert autonomic_score(54.0, 60.0, 3.0) > 50.0


def test_resting_hr_above_baseline_scores_below_mid():
    assert autonomic_score(66.0, 60.0, 3.0) < 50.0


def test_score_is_expressed_in_personal_standard_deviations():
    """A resting-HR-45 athlete and a resting-HR-70 desk worker, both one SD high,
    must score the same -- otherwise the score just encodes fitness."""
    athlete = autonomic_score(48.0, 45.0, 3.0)
    desk_worker = autonomic_score(73.0, 70.0, 3.0)
    assert athlete == pytest.approx(desk_worker)


def test_implausible_standard_deviation_falls_back():
    """A near-zero SD would send the z-score to infinity on any small deviation."""
    assert 0.0 <= autonomic_score(62.0, 60.0, 0.0) <= 100.0


# --- architecture -----------------------------------------------------------------


def test_typical_restorative_sleep_is_mid_scale():
    assert architecture_score(60.0, 90.0, 60.0, 90.0) == pytest.approx(50.0)


def test_more_deep_and_rem_than_usual_scores_higher():
    assert architecture_score(90.0, 120.0, 60.0, 90.0) > 50.0


def test_cold_start_uses_population_values_rather_than_failing():
    assert np.isfinite(architecture_score(60.0, 90.0, np.nan, np.nan))


# --- baselines must be causal -----------------------------------------------------


def test_baseline_never_includes_the_current_day():
    """Otherwise today's reading pulls its own reference and the anomaly shrinks."""
    frame = days(10, resting_hr=[60] * 9 + [80])
    out = add_personal_baselines(frame)
    assert out["baseline_hr"].iloc[-1] == pytest.approx(60.0)
    assert out["resting_hr_z"].iloc[-1] > 1.0


def test_baseline_requires_minimum_history():
    frame = days(10, resting_hr=range(55, 65))
    out = add_personal_baselines(frame)
    assert out["baseline_hr"].iloc[: MIN_BASELINE_DAYS - 1].isna().all()


def test_baselines_do_not_cross_participants():
    frame = pd.concat(
        [days(10, participant="fit", resting_hr=45), days(10, participant="unfit", resting_hr=75)],
        ignore_index=True,
    )
    out = add_personal_baselines(frame)
    fit_baseline = out.loc[out.participant == "fit", "baseline_hr"].dropna()
    assert (fit_baseline < 50).all()


# --- combination ------------------------------------------------------------------


def test_autonomic_dominates_the_combined_score():
    """Held-out evidence put every fold at autonomic-only; the weights reflect that."""
    assert WEIGHT_AUTONOMIC > 0.5


def test_days_without_the_autonomic_component_are_flagged_provisional():
    """They are a different measurement on the same scale, not a weaker one. Mixing them
    measurably degrades the ranking (rho 0.123 -> 0.063)."""
    frame = days(
        10,
        sleep_hours=7.5,
        deep_minutes=60,
        rem_minutes=90,
        resting_hr=[np.nan] * 10,
    )
    out = recovery_score(frame)
    assert out["is_provisional"].all()
    # A score is still produced, so cold start is not a blank screen.
    assert out["recovery_score"].notna().any()


def test_established_days_are_not_flagged_provisional():
    frame = days(12, sleep_hours=7.5, deep_minutes=60, rem_minutes=90, resting_hr=60)
    out = recovery_score(frame)
    assert not out["is_provisional"].iloc[-1]


def test_score_stays_within_range():
    frame = days(12, sleep_hours=3.0, deep_minutes=5, rem_minutes=5, resting_hr=range(60, 72))
    out = recovery_score(frame)
    scores = out["recovery_score"].dropna()
    assert scores.between(0, 100).all()


# --- illness flag -----------------------------------------------------------------


def test_elevated_resting_hr_is_flagged():
    frame = days(12, resting_hr=[60] * 11 + [75])
    assert illness_flag(frame).iloc[-1]


def test_normal_days_are_not_flagged():
    frame = days(12, resting_hr=[60, 61, 59, 60, 61, 60, 59, 61, 60, 60, 61, 60])
    assert not illness_flag(frame).iloc[-1]


def test_nothing_is_flagged_before_a_baseline_exists():
    """Otherwise every unusual-looking first week triggers a warning."""
    frame = days(12, resting_hr=[90] + [60] * 11)
    assert not illness_flag(frame).iloc[0]


def test_threshold_is_sensitive_by_design():
    """A missed warning costs the user more than a dismissible false one."""
    assert ILLNESS_Z_THRESHOLD <= 2.0
