"""Join the hourly and daily frames and derive the model's feature set.

The two source files have to be joined on `(participant, date)`: the label and time-of-day
live hourly, while every sleep, resting-HR and stress field lives only in the daily file.

Three data-quality corrections happen here, each of which would misrepresent the data if
left silent. They are documented in docs/DATASET.md section 5 and must survive into the
report:

  1. `sleep_duration` is in **milliseconds**, not minutes.
  2. 125 nights fall outside 3-12 h (the range runs to 20.7 h). They are **dropped, not
     clipped** -- clipping invents a plausible value where none was measured.
  3. `sleep_deep_ratio` is **not a fraction**: median 0.986, max 4.31, with 1,567 values
     above 1. It is a ratio between sleep stages. It must never be reported as
     "percentage of deep sleep".

Run directly to build and save the model frame:

    python ml/build_features.py
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd

from ingest_lifesnaps import CONTEXT_COLUMNS, load_daily, load_hourly
from labels import TARGET, labelled_only
from provenance import ORIGIN_COLUMN, assert_measured

PROCESSED = Path(__file__).resolve().parent.parent / "data" / "processed"
OUTPUT = PROCESSED / "lifesnaps_model_frame.parquet"

MIN_SLEEP_HOURS, MAX_SLEEP_HOURS = 3.0, 12.0
MILLISECONDS_PER_HOUR = 3_600_000

TIME_FEATURES = ["hour_of_day", "day_of_week", "is_weekend"]

ACTIVITY_FEATURES = ["steps", "bpm", "calories", "distance"]

#: Derived per participant rather than used raw. Absolute resting HR mostly encodes
#: fitness, which is a between-person difference the group split deliberately withholds;
#: the deviation from one's own trailing week is the strain signal that transfers.
RECOVERY_FEATURES = [
    "sleep_hours", "resting_hr", "resting_hr_delta_7d", "stress_score",
    "sleep_deep_ratio", "sleep_rem_ratio", "sleep_efficiency",
    "nremhr", "rmssd", "spo2",
]

FEATURE_COLUMNS = TIME_FEATURES + ACTIVITY_FEATURES + RECOVERY_FEATURES + CONTEXT_COLUMNS

IDENTITY_COLUMNS = ["participant", "timestamp", "date", "mood", TARGET, ORIGIN_COLUMN]


def clean_sleep(daily: pd.DataFrame) -> pd.DataFrame:
    """Convert sleep to hours and void implausible nights."""
    out = daily.copy()
    out["sleep_hours"] = out["sleep_duration"] / MILLISECONDS_PER_HOUR

    implausible = (out["sleep_hours"] < MIN_SLEEP_HOURS) | (out["sleep_hours"] > MAX_SLEEP_HOURS)
    out.loc[implausible, "sleep_hours"] = np.nan

    return out


def add_resting_hr_delta(daily: pd.DataFrame) -> pd.DataFrame:
    """Resting HR relative to each participant's own trailing 7-day mean.

    This is the illness and accumulated-strain signal the Recovery Score depends on. It
    needs at least two prior nights, so the first day or two of each participant is NaN
    by construction rather than by accident.
    """
    out = daily.sort_values(["participant", "date"]).copy()
    trailing = out.groupby("participant")["resting_hr"].transform(
        lambda series: series.rolling(7, min_periods=2).mean()
    )
    out["resting_hr_delta_7d"] = out["resting_hr"] - trailing
    return out


def build(min_rows_per_participant: int = 10) -> pd.DataFrame:
    """Produce the model-ready frame: one row per labelled participant-hour."""
    hourly = load_hourly()
    daily = add_resting_hr_delta(clean_sleep(load_daily()))

    labelled = labelled_only(hourly, min_rows_per_participant)

    daily_columns = ["participant", "date"] + [
        c for c in RECOVERY_FEATURES if c in daily.columns
    ]
    merged = labelled.merge(daily[daily_columns], on=["participant", "date"], how="left")

    # Context one-hots are only populated on rows carrying an EMA response; a missing
    # value means "not reported", which for a one-hot is zero rather than unknown.
    for column in CONTEXT_COLUMNS:
        if column in merged.columns:
            merged[column] = merged[column].fillna(0).astype(int)

    available = [c for c in FEATURE_COLUMNS if c in merged.columns]
    frame = merged[[c for c in IDENTITY_COLUMNS if c in merged.columns] + available].copy()

    # Nothing simulated may reach a frame destined for training.
    assert_measured(frame, stage="build_features")
    return frame


def coverage(frame: pd.DataFrame) -> pd.DataFrame:
    """Per-feature non-null rate -- the table the report needs for §5."""
    available = [c for c in FEATURE_COLUMNS if c in frame.columns]
    return (
        pd.DataFrame(
            {
                "feature": available,
                "non_null": [int(frame[c].notna().sum()) for c in available],
                "coverage_%": [round(frame[c].notna().mean() * 100, 1) for c in available],
            }
        )
        .sort_values("coverage_%", ascending=False)
        .reset_index(drop=True)
    )


def main() -> int:
    frame = build()
    PROCESSED.mkdir(parents=True, exist_ok=True)
    frame.to_parquet(OUTPUT, index=False)

    print(f"rows          {len(frame):,}")
    print(f"participants  {frame.participant.nunique()}")
    print(f"positive rate {frame[TARGET].mean() * 100:.1f}%")
    print(f"span          {frame.date.min():%Y-%m-%d} .. {frame.date.max():%Y-%m-%d}")
    print(f"features      {len([c for c in FEATURE_COLUMNS if c in frame.columns])}")
    print(f"\nsaved -> {OUTPUT.relative_to(PROCESSED.parent.parent)}\n")
    print(coverage(frame).to_string(index=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
