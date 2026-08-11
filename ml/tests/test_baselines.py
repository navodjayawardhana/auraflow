"""Baselines must be honest: strong enough that beating them means something."""

import numpy as np
import pandas as pd
import pytest

from baselines import (
    HourOfDayBaseline,
    MeanBaseline,
    PersonalMeanBaseline,
    evaluate,
    report,
    run_all,
)


@pytest.fixture
def data() -> pd.DataFrame:
    """A cohort with a real daily rhythm, so the hour baseline has something to find."""
    rng = np.random.default_rng(0)
    rows = []
    for person in range(10):
        for day in range(20):
            for hour in range(6, 23):
                rhythm = 3.0 + 1.2 * np.cos((hour - 12) / 24 * 2 * np.pi)
                rows.append(
                    {
                        "participant": f"p{person:02d}",
                        "hour_of_day": hour,
                        "focus_proxy": float(np.clip(rhythm + rng.normal(0, 0.3), 1, 5)),
                    }
                )
    return pd.DataFrame(rows)


def test_perfect_prediction_scores_zero_error():
    truth = np.array([1.0, 3.0, 5.0])
    metrics = evaluate(truth, truth)
    assert metrics.mae == 0.0
    assert metrics.rmse == 0.0
    assert metrics.r2 == pytest.approx(1.0)


def test_r2_is_zero_rather_than_undefined_when_truth_is_constant():
    """A constant test target would otherwise divide by zero and poison the table."""
    metrics = evaluate(np.full(5, 3.0), np.full(5, 2.5))
    assert metrics.r2 == 0.0
    assert metrics.mae == pytest.approx(0.5)


def test_mean_baseline_predicts_the_training_mean(data):
    model = MeanBaseline().fit(data)
    predictions = model.predict(data)
    assert np.allclose(predictions, data.focus_proxy.mean())


def test_hour_baseline_beats_the_mean_when_a_rhythm_exists(data):
    """If it does not, the hour feature is worthless and the app's premise is wrong."""
    train = data[data.participant < "p07"]
    test = data[data.participant >= "p07"]

    mean_mae = MeanBaseline().fit(train).score(test).mae
    hour_mae = HourOfDayBaseline().fit(train).score(test).mae

    assert hour_mae < mean_mae


def test_hour_baseline_falls_back_for_an_unseen_hour(data):
    """An unseen hour must not produce NaN, which would silently void every metric."""
    train = data[data.hour_of_day < 20]
    model = HourOfDayBaseline().fit(train)

    predictions = model.predict(pd.DataFrame({"hour_of_day": [3, 22]}))
    assert not np.isnan(predictions).any()
    assert np.allclose(predictions, train.focus_proxy.mean())


def test_personal_mean_falls_back_for_an_unseen_participant(data):
    """The group split guarantees unseen people in test -- this is the normal case."""
    train = data[data.participant < "p05"]
    model = PersonalMeanBaseline().fit(train)

    predictions = model.predict(pd.DataFrame({"participant": ["p09", "unknown"]}))
    assert not np.isnan(predictions).any()


def test_run_all_returns_every_baseline(data):
    table = run_all(data, data)
    assert set(table.model) == {"mean", "hour-of-day", "personal-mean"}
    assert table.MAE.notna().all()


def test_report_flags_a_model_that_does_not_beat_the_baselines(data):
    """The failure case has to be stated, not quietly omitted."""
    from baselines import Metrics

    weak = Metrics(mae=99.0, rmse=99.0, r2=-9.0)
    text = report(data, data, weak)
    assert "does NOT beat" in text


def test_report_calls_a_marginal_win_marginal(data):
    from baselines import Metrics

    best = run_all(data, data).MAE.min()
    barely = Metrics(mae=best - 0.01, rmse=0.5, r2=0.5)
    assert "marginal" in report(data, data, barely)


def test_report_without_a_model_lists_baselines_only(data):
    text = report(data, data)
    assert "hour-of-day" in text
    assert "MLP" not in text
