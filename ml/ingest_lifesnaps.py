"""Load the LifeSnaps archive into tidy frames with this project's column names.

The archive holds two CSVs that matter and one 9.6 GB MongoDB dump that does not.
Everything the model needs is in the CSVs, so the BSON is never touched -- no MongoDB
instance is required to reproduce any result in this project.

The two files carry different things and must be joined on `(participant, date)`:

    hourly  the EMA mood label, hour of day, steps, heart rate, location context
    daily   ALL sleep, resting-HR and stress fields -- none of these exist hourly

Column names are normalised here, once, so that downstream code and the simulator speak
the same vocabulary (`participant`, `hour_of_day`, ...) rather than the archive's.

Run directly to print a summary of what was loaded:

    python ml/ingest_lifesnaps.py
"""

from __future__ import annotations

import zipfile
from pathlib import Path

import pandas as pd

from provenance import mark_measured

DATA = Path(__file__).resolve().parent.parent / "data"
ARCHIVE = DATA / "raw" / "lifesnaps_rais_anonymized.zip"
EXTRACTED = DATA / "raw" / "lifesnaps"

SOURCE = "lifesnaps"

HOURLY_CSV = "hourly_fitbit_sema_df_unprocessed.csv"
DAILY_CSV = "daily_fitbit_sema_df_unprocessed.csv"

#: SEMA3 momentary mood categories. Mutually exclusive -- exactly one is set per
#: labelled row. See labels.py for how these become a target.
MOOD_COLUMNS = [
    "ALERT", "HAPPY", "NEUTRAL", "RESTED/RELAXED", "SAD", "TENSE/ANXIOUS", "TIRED",
]

#: Reported location context. Kept as features: they contribute more to the model than
#: the biometric block does (docs/DATASET.md section 4.3), and AuraFlow's planned
#: geofencing makes them available at inference time.
CONTEXT_COLUMNS = [
    "ENTERTAINMENT", "GYM", "HOME", "HOME_OFFICE",
    "OTHER", "OUTDOORS", "TRANSIT", "WORK/SCHOOL",
]

DAILY_COLUMNS = [
    "stress_score", "resting_hr", "sleep_duration", "sleep_deep_ratio",
    "sleep_rem_ratio", "sleep_light_ratio", "sleep_efficiency",
    "nremhr", "rmssd", "spo2", "nightly_temperature",
]


class ArchiveMissingError(FileNotFoundError):
    """The dataset has not been fetched yet."""


def extract(force: bool = False) -> Path:
    """Unpack only the CSVs from the archive. Skips the 9.6 GB BSON dump."""
    if not ARCHIVE.exists():
        raise ArchiveMissingError(
            f"{ARCHIVE.name} not found. Run: python ml/download_data.py --dataset lifesnaps"
        )

    EXTRACTED.mkdir(parents=True, exist_ok=True)
    wanted = ("rais_anonymized/csv_rais_anonymized/", "rais_anonymized/scored_surveys/")

    with zipfile.ZipFile(ARCHIVE) as archive:
        for entry in archive.infolist():
            if entry.is_dir() or not entry.filename.startswith(wanted):
                continue
            target = EXTRACTED / Path(entry.filename).name
            if force or not target.exists():
                target.write_bytes(archive.read(entry))

    return EXTRACTED


def _read(name: str) -> pd.DataFrame:
    path = EXTRACTED / name
    if not path.exists():
        extract()
    # The first column is an unnamed pandas index left over from the authors' export.
    return pd.read_csv(path, index_col=0, low_memory=False)


def load_hourly() -> pd.DataFrame:
    """One row per participant-hour. Carries the label and the time-varying signals."""
    frame = _read(HOURLY_CSV).rename(columns={"id": "participant", "hour": "hour_of_day"})

    frame["date"] = pd.to_datetime(frame["date"])
    frame["timestamp"] = frame["date"] + pd.to_timedelta(frame["hour_of_day"], unit="h")
    frame["day_of_week"] = frame["date"].dt.dayofweek
    frame["is_weekend"] = (frame["day_of_week"] >= 5).astype(int)

    return mark_measured(frame, SOURCE)


def load_daily() -> pd.DataFrame:
    """One row per participant-day. The only source of sleep, resting HR and stress."""
    frame = _read(DAILY_CSV).rename(columns={"id": "participant"})
    frame["date"] = pd.to_datetime(frame["date"])

    keep = ["participant", "date"] + [c for c in DAILY_COLUMNS if c in frame.columns]
    return mark_measured(frame[keep], SOURCE)


def load_surveys() -> dict[str, pd.DataFrame]:
    """Scored trait questionnaires, one row per participant.

    Not used by the hourly model -- they are between-person constants, and the
    participant-wise split deliberately withholds between-person information. Loaded
    for the cohort description in the report.
    """
    surveys = {}
    for name in ("panas", "stai", "personality", "breq", "ttm"):
        path = EXTRACTED / f"{name}.csv"
        if path.exists():
            surveys[name] = pd.read_csv(path, index_col=0)
    return surveys


def summarise() -> str:
    hourly, daily = load_hourly(), load_daily()
    labelled = hourly[hourly[MOOD_COLUMNS].notna().any(axis=1)]

    lines = [
        f"hourly   {len(hourly):>7,} rows   {hourly.participant.nunique():>3} participants",
        f"daily    {len(daily):>7,} rows   {daily.participant.nunique():>3} participants",
        f"labelled {len(labelled):>7,} rows   {labelled.participant.nunique():>3} participants"
        f"   ({len(labelled) / len(hourly) * 100:.2f}% of hourly)",
        f"span     {hourly.date.min():%Y-%m-%d} .. {hourly.date.max():%Y-%m-%d}",
        "",
        "daily field coverage:",
    ]
    for column in DAILY_COLUMNS:
        if column in daily.columns:
            present = daily[column].notna().mean() * 100
            lines.append(f"  {column:22s} {present:5.1f}%")

    return "\n".join(lines)


if __name__ == "__main__":
    extract()
    print(summarise())
