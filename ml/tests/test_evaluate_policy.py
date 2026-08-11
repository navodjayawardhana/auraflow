"""E1 policy evaluation: the ranking helpers must rank what they claim to."""

import numpy as np
import pandas as pd
import pytest

from baselines import TARGET
from evaluate_policy import (
    IDEAL_HOUR,
    precision_at_k,
    rank_fixed_hour,
    rank_population,
    rank_random,
    summarise,
)


def test_precision_at_k_counts_only_the_top_k():
    truth = np.array([1, 1, 0, 0, 0])
    order = np.array([0, 1, 2, 3, 4])  # best-first
    assert precision_at_k(truth, order, 1) == 1.0
    assert precision_at_k(truth, order, 2) == 1.0
    assert precision_at_k(truth, order, 4) == 0.5


def test_precision_at_k_follows_the_ranking_not_the_row_order():
    truth = np.array([0, 0, 1])
    assert precision_at_k(truth, np.array([2, 0, 1]), 1) == 1.0
    assert precision_at_k(truth, np.array([0, 1, 2]), 1) == 0.0


def test_precision_at_k_is_none_when_there_are_too_few_hours():
    """Returning 0.0 would silently drag the mean down for sparse participants."""
    assert precision_at_k(np.array([1, 0]), np.array([0, 1]), 5) is None


def test_fixed_hour_policy_puts_nine_am_first():
    frame = pd.DataFrame({"hour_of_day": [15, 9, 20, 11]})
    order = rank_fixed_hour(frame)
    assert frame.hour_of_day.to_numpy()[order[0]] == IDEAL_HOUR


def test_fixed_hour_policy_wraps_around_midnight():
    """23:00 is 10 h from 09:00, not 14 -- distance must not be computed linearly."""
    frame = pd.DataFrame({"hour_of_day": [23, 21]})
    order = rank_fixed_hour(frame)
    # 21:00 is 12 h away, 23:00 is 10 h away, so 23:00 ranks first.
    assert frame.hour_of_day.to_numpy()[order[0]] == 23


def test_population_policy_ranks_by_the_cohort_hourly_rate():
    by_hour = pd.Series({9: 0.8, 14: 0.5, 22: 0.2})
    frame = pd.DataFrame({"hour_of_day": [22, 9, 14]})
    order = rank_population(frame, by_hour, fallback=0.4)
    assert frame.hour_of_day.to_numpy()[order].tolist() == [9, 14, 22]


def test_population_policy_falls_back_for_an_unseen_hour():
    by_hour = pd.Series({9: 0.8})
    frame = pd.DataFrame({"hour_of_day": [3, 9]})
    order = rank_population(frame, by_hour, fallback=0.4)
    assert not np.isnan(order).any()
    assert frame.hour_of_day.to_numpy()[order[0]] == 9


def test_random_policy_is_a_permutation():
    frame = pd.DataFrame({"hour_of_day": range(10)})
    order = rank_random(frame, np.random.default_rng(0))
    assert sorted(order.tolist()) == list(range(10))


def test_summary_averages_per_participant_not_per_row():
    """A participant with many labelled hours must not dominate the mean.

    Here one participant scores 1.0 and four score 0.0. Pooling by row would weight the
    first far above 0.2; averaging per participant gives exactly 0.2.
    """
    records = pd.DataFrame(
        [
            {"participant": "heavy", "policy": "p", "P@1": 1.0, "P@3": 1.0, "P@5": 1.0,
             "base_rate": 1.0, "n_hours": 500},
            *[
                {"participant": f"light{i}", "policy": "p", "P@1": 0.0, "P@3": 0.0,
                 "P@5": 0.0, "base_rate": 0.0, "n_hours": 10}
                for i in range(4)
            ],
        ]
    )
    assert summarise(records).loc["p", "P@1"] == pytest.approx(0.2)


def test_summary_reports_participant_counts():
    records = pd.DataFrame(
        [
            {"participant": "a", "policy": "model", "P@1": 1.0, "P@3": 1.0, "P@5": 1.0,
             "base_rate": 0.5, "n_hours": 20},
            {"participant": "b", "policy": "model", "P@1": 0.0, "P@3": 0.0, "P@5": 0.0,
             "base_rate": 0.5, "n_hours": 20},
        ]
    )
    assert summarise(records).loc["model", "participants"] == 2
