"""Baselines must be honest: strong enough that beating them means something."""

import numpy as np
import pandas as pd
import pytest

from baselines import (
    TARGET,
    HourOfDay,
    MajorityClass,
    Metrics,
    PersonalRate,
    confusion,
    evaluate,
    report,
    run_all,
    verdict,
)


@pytest.fixture
def data() -> pd.DataFrame:
    """A cohort with a real daily rhythm, so the hour baseline has something to find."""
    rng = np.random.default_rng(0)
    rows = []
    for person in range(10):
        for _ in range(20):
            for hour in range(6, 23):
                # Positive rate peaks late morning, troughs late evening.
                rate = 0.5 + 0.3 * np.cos((hour - 11) / 24 * 2 * np.pi)
                rows.append(
                    {
                        "participant": f"p{person:02d}",
                        "hour_of_day": hour,
                        TARGET: int(rng.random() < rate),
                    }
                )
    return pd.DataFrame(rows)


def test_perfect_probabilities_score_perfectly():
    truth = np.array([0, 0, 1, 1])
    metrics = evaluate(truth, np.array([0.01, 0.02, 0.98, 0.99]))
    assert metrics.roc_auc == pytest.approx(1.0)
    assert metrics.f1 == pytest.approx(1.0)


def test_auc_is_chance_rather_than_undefined_for_a_single_class_fold():
    """An unlucky CV fold must not crash the loop."""
    metrics = evaluate(np.ones(5, dtype=int), np.full(5, 0.7))
    assert metrics.roc_auc == 0.5


def test_majority_baseline_predicts_the_training_base_rate(data):
    model = MajorityClass().fit(data)
    assert np.allclose(model.predict_proba(data), data[TARGET].mean())


def test_majority_baseline_scores_chance_auc(data):
    """A constant prediction cannot rank anything, so AUC must be 0.5."""
    assert MajorityClass().fit(data).score(data).roc_auc == pytest.approx(0.5)


def test_hour_baseline_beats_chance_when_a_rhythm_exists(data):
    """If it does not, the hour feature is worthless and the app's premise is wrong."""
    train = data[data.participant < "p07"]
    test = data[data.participant >= "p07"]
    assert HourOfDay().fit(train).score(test).roc_auc > 0.55


def test_hour_baseline_falls_back_for_an_unseen_hour(data):
    """An unseen hour must not produce NaN, which would silently void every metric."""
    train = data[data.hour_of_day < 20]
    predictions = HourOfDay().fit(train).predict_proba(
        pd.DataFrame({"hour_of_day": [3, 22]})
    )
    assert not np.isnan(predictions).any()
    assert np.allclose(predictions, train[TARGET].mean())


def test_personal_rate_falls_back_for_an_unseen_participant(data):
    """Under the group split every test participant is unseen -- the normal case."""
    train = data[data.participant < "p05"]
    predictions = PersonalRate().fit(train).predict_proba(
        pd.DataFrame({"participant": ["p09", "unknown"]})
    )
    assert not np.isnan(predictions).any()


def test_run_all_returns_every_baseline(data):
    table = run_all(data, data)
    assert set(table.model) == {"base-rate", "hour-of-day", "personal-rate"}
    assert table["ROC-AUC"].notna().all()


# --- verdict: the wording under pressure to be omitted --------------------------


def test_verdict_states_plainly_when_the_model_loses():
    assert "does NOT beat" in verdict(model_auc=0.58, best_baseline_auc=0.61)


def test_verdict_calls_a_noise_level_win_noise():
    assert "within fold-to-fold noise" in verdict(model_auc=0.655, best_baseline_auc=0.650)


def test_verdict_flags_a_win_that_is_still_below_the_deployment_floor():
    text = verdict(model_auc=0.57, best_baseline_auc=0.52)
    assert "below" in text and "floor" in text


def test_verdict_reports_a_genuine_win_without_hedging():
    text = verdict(model_auc=0.72, best_baseline_auc=0.61)
    assert "beats the best baseline" in text
    assert "NOT" not in text


def test_report_includes_the_model_row_and_the_verdict(data):
    # Disjoint participants, as the real pipeline uses. Scoring baselines on their own
    # training rows lets personal-rate memorise each participant and inflates it past
    # anything a held-out model could reach.
    train = data[data.participant < "p07"]
    test = data[data.participant >= "p07"]

    text = report(train, test, Metrics(0.85, 0.8, 0.8, 0.8, 0.8), model_name="MLP")
    assert "MLP" in text
    assert "hour-of-day" in text
    assert "beats the best baseline" in text


def test_personal_rate_is_no_better_than_chance_under_a_participant_split(data):
    """Every test participant is unseen, so it collapses to the global base rate.

    Worth pinning: if this ever rises, participants are leaking across the split.
    """
    train = data[data.participant < "p07"]
    test = data[data.participant >= "p07"]
    assert PersonalRate().fit(train).score(test).roc_auc == pytest.approx(0.5)


def test_report_without_a_model_lists_baselines_only(data):
    text = report(data, data)
    assert "hour-of-day" in text
    assert "beats" not in text


def test_confusion_matrix_counts_are_correct():
    text = confusion(np.array([0, 0, 1, 1]), np.array([0.1, 0.9, 0.2, 0.8]))
    # one TN, one FP, one FN, one TP
    assert "     1      1" in text
