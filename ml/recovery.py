"""Recovery Score and illness detection -- rule-based, causal, portable.

Deliberately **not** a trained model, for three reasons:

  **It has to be explainable.** A user told "your recovery is 48 today" will ask why. A
  rule-based score answers with its own components; a fitted model answers with a SHAP
  plot nobody wants.

  **It has to work on day one.** A new user has no history to train on. These rules
  produce a usable number from a single night, then sharpen as a personal baseline forms.

  **It has to run on device.** Pure arithmetic ports directly to TypeScript with no
  runtime, matching the < 50 ms NFR trivially.

Whether the rules are any good is a separate question, and one this project answers
rather than assumes: `evaluate_recovery.py` scores them against PMData's self-reported
`readiness`, alongside Fitbit's own commercial sleep score and a fitted model as an upper
bound. If the rules lose, that is reported.

Three components
----------------
    sleep duration    against the person's own need, asymmetric -- being an hour short
                      costs more than being an hour long, which is how sleep debt works
    sleep architecture  deep + REM against the person's own baseline. Deep sleep carries
                      physical restoration, REM carries memory consolidation
    autonomic         resting HR against the person's trailing baseline. Elevated
                      resting HR is the classic marker of strain, illness or poor recovery

Every baseline is **trailing** -- computed from strictly earlier days. Using a whole-period
mean would leak the future into today's score and make the offline evaluation optimistic in
a way the deployed app could never reproduce.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

#: Component weights -- revised 2026-08-11 on held-out evidence, not intuition.
#:
#: The first version used 0.40 / 0.25 / 0.35, weighting sleep duration highest because it
#: is the component a user can act on. Validation against PMData's self-reported
#: `readiness` showed that score correlating at rho 0.068, **worse than simply inverting
#: the resting-HR z-score** (0.123). Adding sleep duration and architecture was diluting
#: the one component that worked.
#:
#: A weight grid was then searched on training participants and scored on participants the
#: search never saw. **All five folds independently chose duration 0.0 / architecture 0.0
#: / autonomic 1.0**, lifting held-out rho from 0.068 to 0.124. Unanimity across folds is
#: what makes this a finding rather than one lucky split.
#:
#: The sleep weights are not zero here for one engineering reason, stated so it is not
#: mistaken for a predictive claim: the autonomic component needs MIN_BASELINE_DAYS of
#: history, and with zero weight elsewhere a new user's score would be undefined for their
#: first five days. The 0.10 weights exist to keep the cold-start path producing a number.
#: **They are not there because sleep improves the estimate. It does not.**
WEIGHT_DURATION = 0.10
WEIGHT_ARCHITECTURE = 0.10
WEIGHT_AUTONOMIC = 0.80

DEFAULT_SLEEP_NEED_HOURS = 8.0

#: Days of history before a personal baseline is trusted. Below this the population
#: default is used, which is the cold-start path a new user takes.
MIN_BASELINE_DAYS = 5
BASELINE_WINDOW = 14

#: Resting HR this far above the personal baseline, in standard deviations, is flagged.
#: 1.5 sigma is deliberately sensitive: a missed illness warning costs the user more than
#: an occasional false one, which they can dismiss.
ILLNESS_Z_THRESHOLD = 1.5


def duration_score(sleep_hours: float, need_hours: float = DEFAULT_SLEEP_NEED_HOURS) -> float:
    """0-100 from hours slept, asymmetric around the personal need.

    Short sleep is penalised roughly twice as hard as long sleep. Sleeping nine hours
    when eight is needed costs little; sleeping six is a real deficit.
    """
    if not np.isfinite(sleep_hours):
        return np.nan

    deficit = need_hours - sleep_hours
    penalty = 18.0 * deficit if deficit > 0 else 9.0 * abs(deficit)
    return float(np.clip(100.0 - penalty, 0.0, 100.0))


def architecture_score(
    deep_minutes: float, rem_minutes: float,
    baseline_deep: float, baseline_rem: float,
) -> float:
    """0-100 from restorative sleep against the person's own baseline.

    Centred at 50 so that "typical for you" is mid-scale rather than a pass mark, and
    a genuinely restorative night can score above it.
    """
    if not (np.isfinite(deep_minutes) and np.isfinite(rem_minutes)):
        return np.nan
    if not (np.isfinite(baseline_deep) and np.isfinite(baseline_rem)):
        baseline_deep, baseline_rem = 60.0, 90.0  # population cold-start values

    deep_ratio = deep_minutes / max(baseline_deep, 1.0)
    rem_ratio = rem_minutes / max(baseline_rem, 1.0)

    # Deep sleep weighted slightly higher: it is the more protected stage, so a shortfall
    # is a stronger signal than the same shortfall in REM.
    combined = 0.55 * deep_ratio + 0.45 * rem_ratio
    return float(np.clip(50.0 + 50.0 * (combined - 1.0), 0.0, 100.0))


def autonomic_score(resting_hr: float, baseline_hr: float, baseline_sd: float) -> float:
    """0-100 from resting HR against the personal trailing baseline.

    Expressed in the person's own standard deviations, so it means the same thing for a
    resting-HR-45 athlete and a resting-HR-70 desk worker. Below baseline scores above 50.
    """
    if not (np.isfinite(resting_hr) and np.isfinite(baseline_hr)):
        return np.nan

    sd = baseline_sd if np.isfinite(baseline_sd) and baseline_sd > 0.5 else 2.5
    z = (resting_hr - baseline_hr) / sd
    return float(np.clip(50.0 - 20.0 * z, 0.0, 100.0))


def add_personal_baselines(frame: pd.DataFrame) -> pd.DataFrame:
    """Trailing per-participant baselines, computed from strictly earlier days only.

    Columns that are absent yield NaN baselines rather than raising. The components
    degrade independently by design -- the illness detector needs only resting HR, and
    a device that reports heart rate but not sleep stages should still get a warning.
    """
    out = frame.sort_values(["participant", "date"]).copy()

    def trailing(column: str, statistic: str) -> pd.Series:
        if column not in out.columns:
            return pd.Series(np.nan, index=out.index)
        grouped = out.groupby("participant")[column]
        return grouped.transform(
            lambda s: getattr(
                s.shift(1).rolling(BASELINE_WINDOW, min_periods=MIN_BASELINE_DAYS), statistic
            )()
        )

    out["baseline_hr"] = trailing("resting_hr", "mean")
    out["baseline_hr_sd"] = trailing("resting_hr", "std")
    out["baseline_deep"] = trailing("deep_minutes", "mean")
    out["baseline_rem"] = trailing("rem_minutes", "mean")
    out["sleep_need"] = trailing("sleep_hours", "median").fillna(DEFAULT_SLEEP_NEED_HOURS)

    resting = out["resting_hr"] if "resting_hr" in out.columns else np.nan
    out["resting_hr_z"] = (resting - out["baseline_hr"]) / out["baseline_hr_sd"].where(
        out["baseline_hr_sd"] > 0.5, 2.5
    )
    return out


def recovery_score(frame: pd.DataFrame) -> pd.DataFrame:
    """Add the three components and the combined 0-100 Recovery Score.

    Missing components are dropped and the remaining weights renormalised, so a night
    without a resting-HR reading still produces a score from sleep alone rather than a
    blank. The count of contributing components is kept so the UI can say how confident
    the number is.
    """
    out = frame if "baseline_hr" in frame.columns else add_personal_baselines(frame)
    out = out.copy()

    for column in ("sleep_hours", "deep_minutes", "rem_minutes", "resting_hr"):
        if column not in out.columns:
            out[column] = np.nan

    out["score_duration"] = [
        duration_score(h, n) for h, n in zip(out["sleep_hours"], out["sleep_need"])
    ]
    out["score_architecture"] = [
        architecture_score(d, r, bd, br)
        for d, r, bd, br in zip(
            out["deep_minutes"], out["rem_minutes"], out["baseline_deep"], out["baseline_rem"]
        )
    ]
    out["score_autonomic"] = [
        autonomic_score(hr, b, sd)
        for hr, b, sd in zip(out["resting_hr"], out["baseline_hr"], out["baseline_hr_sd"])
    ]

    components = out[["score_duration", "score_architecture", "score_autonomic"]]
    weights = np.array([WEIGHT_DURATION, WEIGHT_ARCHITECTURE, WEIGHT_AUTONOMIC])

    present = components.notna().to_numpy()
    weighted = np.nansum(components.to_numpy() * weights, axis=1)
    total = (present * weights).sum(axis=1)

    with np.errstate(invalid="ignore", divide="ignore"):
        out["recovery_score"] = np.where(total > 0, weighted / total, np.nan)

    out["components_used"] = present.sum(axis=1)

    # Days without the autonomic component are a different measurement, not a slightly
    # weaker one. Renormalising over sleep alone produces a number on the same 0-100
    # scale that means something else entirely, and mixing the two makes a participant's
    # day-to-day ranking incoherent -- which is measurable: with the autonomic-dominant
    # weights, including these days drags the correlation with self-reported readiness
    # DOWN, from 0.121 for the autonomic component alone to 0.063 for the mixture.
    #
    # So they are flagged rather than hidden. The app shows them as provisional, and the
    # evaluation reports established days separately.
    out["is_provisional"] = out["score_autonomic"].isna()
    return out


def illness_flag(frame: pd.DataFrame, threshold: float = ILLNESS_Z_THRESHOLD) -> pd.Series:
    """True where resting HR is anomalously elevated against the personal baseline.

    Requires an established baseline: without one, every unusual-looking first week would
    be flagged.
    """
    if "resting_hr_z" not in frame.columns:
        frame = add_personal_baselines(frame)
    return (frame["resting_hr_z"] > threshold) & frame["baseline_hr"].notna()
