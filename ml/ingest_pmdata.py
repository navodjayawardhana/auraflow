"""Load PMData into a daily frame: self-reported wellness joined to Fitbit recovery signals.

PMData's role is narrower than the plan assumed. Its self-report is **daily** -- 99.0% of
participant-days carry exactly one entry -- so it cannot support the hourly scheduling
model (docs/DATASET.md 4.5). What it can do is validate the **daily Recovery Score**:
`readiness` (0-10) is a directly labelled comparator for exactly that construct.

    Licence: CC BY-NC 4.0. Academic evaluation only. The report's commercial argument
    rests on LifeSnaps, which is CC BY.

Extraction is selective. The archive is 1.35 GB (3.25 GB unpacked, 913 files), most of it
per-participant `heart_rate.json` at ~120 MB each and food photographs. None of that is
needed for a daily model, so four small files per participant are pulled and the rest is
left in the zip.

Scales, measured rather than assumed (the project plan had these wrong):

    readiness                                    0-10
    fatigue, mood, stress, sleep_quality,        0-5
      soreness
    sleep_duration_h  (self-reported)            0-12

Run directly for a summary:

    python ml/ingest_pmdata.py
"""

from __future__ import annotations

import io
import json
import zipfile
from pathlib import Path

import pandas as pd

from provenance import mark_measured

DATA = Path(__file__).resolve().parent.parent / "data"
ARCHIVE = DATA / "raw" / "pmdata.zip"
EXTRACTED = DATA / "raw" / "pmdata"

SOURCE = "pmdata"

#: Per participant. Everything else in the archive is ignored.
WANTED = (
    "pmsys/wellness.csv",
    "fitbit/resting_heart_rate.json",
    "fitbit/sleep.json",
    "fitbit/sleep_score.csv",
)

SELF_REPORT = ["readiness", "fatigue", "mood", "stress", "sleep_quality", "soreness"]


class ArchiveMissingError(FileNotFoundError):
    """The dataset has not been fetched yet."""


def extract(force: bool = False) -> Path:
    """Pull only the four small files per participant out of the 1.35 GB archive."""
    if not ARCHIVE.exists():
        raise ArchiveMissingError(
            f"{ARCHIVE.name} not found. Run: python ml/download_data.py --dataset pmdata"
        )

    EXTRACTED.mkdir(parents=True, exist_ok=True)

    with zipfile.ZipFile(ARCHIVE) as archive:
        for entry in archive.infolist():
            if entry.is_dir() or not entry.filename.endswith(WANTED):
                continue
            # pmdata/p01/pmsys/wellness.csv -> p01__wellness.csv
            parts = entry.filename.split("/")
            target = EXTRACTED / f"{parts[1]}__{parts[-1]}"
            if force or not target.exists():
                target.write_bytes(archive.read(entry))

    return EXTRACTED


def _participants() -> list[str]:
    if not any(EXTRACTED.glob("*__wellness.csv")):
        extract()
    return sorted(p.name.split("__")[0] for p in EXTRACTED.glob("*__wellness.csv"))


def load_wellness() -> pd.DataFrame:
    """One row per participant-day of self-report."""
    frames = []
    for participant in _participants():
        frame = pd.read_csv(EXTRACTED / f"{participant}__wellness.csv")
        frame["participant"] = participant
        frames.append(frame)

    wellness = pd.concat(frames, ignore_index=True)
    wellness["date"] = pd.to_datetime(
        wellness.effective_time_frame, format="mixed", utc=True
    ).dt.date

    # 1% of participant-days carry a second entry. Averaging is preferable to keeping
    # the first: both were the person's report of the same day, and picking one by
    # arrival order encodes nothing meaningful.
    numeric = [c for c in SELF_REPORT + ["sleep_duration_h"] if c in wellness.columns]
    collapsed = wellness.groupby(["participant", "date"], as_index=False)[numeric].mean()
    return collapsed


def load_resting_hr() -> pd.DataFrame:
    """Fitbit's daily resting heart rate estimate."""
    rows = []
    for participant in _participants():
        path = EXTRACTED / f"{participant}__resting_heart_rate.json"
        if not path.exists():
            continue
        for record in json.loads(path.read_text(encoding="utf-8")):
            value = (record.get("value") or {}).get("value")
            if value:  # zero means "no estimate", not a heart rate of zero
                rows.append(
                    {
                        "participant": participant,
                        "date": pd.to_datetime(record["dateTime"]).date(),
                        "resting_hr": float(value),
                    }
                )
    return pd.DataFrame(rows)


def load_sleep() -> pd.DataFrame:
    """Nightly sleep stages, main sleep only.

    Fitbit logs naps as separate records. Including them would let an afternoon nap
    overwrite the night it should be added to, so only the main sleep is kept -- and
    where the flag is absent, the longest record for that date.
    """
    rows = []
    for participant in _participants():
        path = EXTRACTED / f"{participant}__sleep.json"
        if not path.exists():
            continue

        for record in json.loads(path.read_text(encoding="utf-8")):
            summary = (record.get("levels") or {}).get("summary") or {}
            rows.append(
                {
                    "participant": participant,
                    "date": pd.to_datetime(record["dateOfSleep"]).date(),
                    "is_main_sleep": bool(record.get("mainSleep", False)),
                    "minutes_asleep": record.get("minutesAsleep"),
                    "minutes_awake": record.get("minutesAwake"),
                    "time_in_bed": record.get("timeInBed"),
                    "sleep_efficiency": record.get("efficiency"),
                    "deep_minutes": (summary.get("deep") or {}).get("minutes"),
                    "rem_minutes": (summary.get("rem") or {}).get("minutes"),
                    "light_minutes": (summary.get("light") or {}).get("minutes"),
                    "wake_minutes": (summary.get("wake") or {}).get("minutes"),
                }
            )

    sleep = pd.DataFrame(rows)
    if sleep.empty:
        return sleep

    sleep = sleep.sort_values(
        ["participant", "date", "is_main_sleep", "minutes_asleep"], ascending=[True, True, False, False]
    )
    sleep = sleep.drop_duplicates(["participant", "date"], keep="first")

    sleep["sleep_hours"] = sleep["minutes_asleep"] / 60
    return sleep.drop(columns=["is_main_sleep"])


def load_sleep_score() -> pd.DataFrame:
    """Fitbit's own composite sleep score -- a useful comparator for our Recovery Score."""
    frames = []
    for participant in _participants():
        path = EXTRACTED / f"{participant}__sleep_score.csv"
        if not path.exists():
            continue
        frame = pd.read_csv(path)
        frame["participant"] = participant
        frames.append(frame)

    if not frames:
        return pd.DataFrame()

    scores = pd.concat(frames, ignore_index=True)
    scores["date"] = pd.to_datetime(scores.timestamp, format="mixed", utc=True).dt.date
    keep = ["participant", "date", "overall_score", "composition_score",
            "revitalization_score", "duration_score", "restlessness"]
    return scores[[c for c in keep if c in scores.columns]].drop_duplicates(
        ["participant", "date"], keep="last"
    )


def load() -> pd.DataFrame:
    """The joined daily frame: self-report plus Fitbit recovery signals."""
    frame = load_wellness()

    for other in (load_sleep(), load_resting_hr(), load_sleep_score()):
        if not other.empty:
            frame = frame.merge(other, on=["participant", "date"], how="left")

    frame["date"] = pd.to_datetime(frame["date"])
    return mark_measured(frame.sort_values(["participant", "date"]).reset_index(drop=True), SOURCE)


def summarise() -> str:
    frame = load()
    lines = [
        f"rows          {len(frame):,}",
        f"participants  {frame.participant.nunique()}",
        f"span          {frame.date.min():%Y-%m-%d} .. {frame.date.max():%Y-%m-%d}",
        "",
        "coverage:",
    ]
    for column in ["readiness", "fatigue", "stress", "sleep_hours", "deep_minutes",
                   "rem_minutes", "resting_hr", "overall_score"]:
        if column in frame.columns:
            present = frame[column].notna().mean() * 100
            lines.append(f"  {column:18s} {present:5.1f}%")
    return "\n".join(lines)


if __name__ == "__main__":
    extract()
    print(summarise())
