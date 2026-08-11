"""Generate synthetic data for the things public cohorts cannot provide.

Scope -- and its limits
-----------------------
This module produces data for exactly four purposes:

  1. `task_density`      no wearable dataset contains a participant's task list
  2. demo / seed data    a presentation needs a coherent story, not a random participant
  3. drift scenario      showing an online-learning update needs a controllable trajectory
  4. edge fixtures       illness spikes and stress triggers must be reproducible in tests

It is NOT a substitute for the research datasets. Every frame it emits is tagged
`data_origin=synthetic`, and `train.py` refuses to train on tagged rows. See
`provenance.py` for why that wall exists and `docs/DATASET.md` section 6 for the
reasoning in report form.

Generative model (Appendix B)
-----------------------------
Alertness is generated from the **two-process model of sleep regulation**
(Borbely, 1982), which is the standard account of why alertness varies through a day:

  Process C   circadian oscillator -- a ~24 h sinusoid. Its phase is offset per
              participant by a chronotype parameter, following Roenneberg's
              mid-sleep-on-free-days construct: larks peak earlier, owls later.

  Process S   homeostatic sleep pressure -- accumulates with time awake and
              dissipates during sleep. Implemented as saturating growth in hours
              since waking, scaled by accumulated sleep debt.

Three modifiers sit on top, each corresponding to a feature the model consumes:

  post-lunch dip    a documented secondary trough, independent of meal timing
  stress coupling   elevated stress subtracts from available attention
  sleep debt        a running deficit against each participant's sleep need

Output is `focus_proxy` on a 1-5 scale, matching the response scale used by the real
cohorts, plus Gaussian observation noise representing self-report imprecision.

The RNG is seeded, so a given `--seed` always reproduces the same data.

Usage
-----
    python ml/simulate.py --mode demo    --days 30   # Laravel seeder payload
    python ml/simulate.py --mode tasks   --days 120  # task_density feature stream
    python ml/simulate.py --mode drift   --days 60   # online-learning scenario
    python ml/simulate.py --mode edge                # test fixtures
    python ml/simulate.py --mode all
"""

from __future__ import annotations

import argparse
import json
from dataclasses import dataclass, asdict
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path

import numpy as np
import pandas as pd

from provenance import mark_synthetic, ORIGIN_COLUMN

ML_DIR = Path(__file__).resolve().parent
FIXTURES = ML_DIR / "fixtures"
SEEDER_DATA = ML_DIR.parent / "api" / "database" / "seeders" / "data"

WAKING_HOURS = range(6, 24)

# Focus is self-reported on the same 1-5 scale the real cohorts use.
FOCUS_MIN, FOCUS_MAX = 1.0, 5.0


# ---------------------------------------------------------------------------
# Participant
# ---------------------------------------------------------------------------
@dataclass(frozen=True)
class Participant:
    """A simulated person. Chronotype and sleep need drive everything downstream."""

    label: str
    chronotype_hours: float  # phase shift; negative = lark, positive = owl
    sleep_need_hours: float
    resting_hr_baseline: float
    stress_reactivity: float  # 0-1, how strongly stress erodes focus

    @staticmethod
    def sample(rng: np.random.Generator, label: str) -> "Participant":
        return Participant(
            label=label,
            # Roenneberg's chronotype distribution is roughly normal and slightly
            # owl-shifted in adult populations.
            chronotype_hours=float(rng.normal(0.4, 1.3)),
            sleep_need_hours=float(rng.normal(7.9, 0.5)),
            resting_hr_baseline=float(rng.normal(60, 6)),
            stress_reactivity=float(rng.uniform(0.4, 0.9)),
        )


# ---------------------------------------------------------------------------
# The two-process model
# ---------------------------------------------------------------------------
#: Hour at which the circadian drive peaks for a neutral chronotype.
#:
#: Set to early afternoon rather than mid-morning on purpose. Process C must stay HIGH
#: across both the morning and the early evening so that it opposes rising sleep
#: pressure; that opposition is what produces the wake-maintenance zone and the
#: characteristic flat-then-falling daily profile. Peaking at 10:00 puts the circadian
#: trough at 22:00, where it compounds with peak sleep pressure instead of offsetting
#: it, and the result decays monotonically from breakfast onwards.
CIRCADIAN_PEAK_HOUR = 14.0


def process_c(hour: float, chronotype_hours: float) -> float:
    """Circadian alertness oscillator, normalised to [-1, 1].

    Trough sits ~02:00 (12 h from the peak), which is where the physiological
    low actually falls. `chronotype_hours` shifts the whole curve: negative for
    larks, positive for owls.
    """
    phase = (hour - chronotype_hours - CIRCADIAN_PEAK_HOUR) / 24.0 * 2 * np.pi
    return float(np.cos(phase))


def process_s(hours_awake: float, sleep_debt_hours: float) -> float:
    """Homeostatic sleep pressure, normalised to roughly [0, 1].

    Saturating growth in time awake. Accumulated sleep debt raises the starting point,
    so a short night means the day begins already tired.
    """
    base = 1.0 - np.exp(-hours_awake / 9.0)
    debt = np.clip(sleep_debt_hours / 12.0, 0.0, 0.6)
    return float(np.clip(base + debt, 0.0, 1.4))


def post_lunch_dip(hour: float, chronotype_hours: float) -> float:
    """Secondary afternoon trough, ~7 h after a neutral wake time."""
    centre = 14.0 + chronotype_hours
    return float(0.45 * np.exp(-((hour - centre) ** 2) / 2.0))


# ---------------------------------------------------------------------------
# Day-level generation
# ---------------------------------------------------------------------------
def simulate_nights(
    rng: np.random.Generator,
    person: Participant,
    days: int,
    start: date,
    illness_days: set[int] | None = None,
) -> pd.DataFrame:
    """One row per night: sleep, recovery and the running sleep debt."""
    illness_days = illness_days or set()
    rows, debt = [], 0.0

    for offset in range(days):
        day = start + timedelta(days=offset)
        weekend = day.weekday() >= 5

        # Weekends drift later and longer -- this is the social jetlag that makes
        # chronotype visible in real data.
        duration = rng.normal(person.sleep_need_hours + (0.7 if weekend else -0.35), 0.75)
        duration = float(np.clip(duration, 3.5, 10.5))

        debt = float(np.clip(debt + (person.sleep_need_hours - duration), 0.0, 20.0))

        # Deep sleep is a fraction of total, suppressed when sleep is short or debt is high.
        deep_fraction = np.clip(rng.normal(0.19, 0.03) - 0.01 * debt, 0.07, 0.28)
        deep_minutes = float(duration * 60 * deep_fraction)

        wake_hour = float(np.clip(rng.normal(7.0 + person.chronotype_hours + (1.1 if weekend else 0.0), 0.5), 4.5, 11.0))

        ill = offset in illness_days
        resting_hr = person.resting_hr_baseline + 0.55 * debt + rng.normal(0, 1.6)
        if ill:
            resting_hr += rng.uniform(6.0, 11.0)  # the illness signal the model must catch

        stress = np.clip(rng.normal(38 + 2.6 * debt, 11) + (22 if ill else 0), 0, 100)

        rows.append(
            {
                "date": day.isoformat(),
                "sleep_duration": round(duration, 2),
                "deep_sleep_min": round(deep_minutes, 1),
                "wake_hour": round(wake_hour, 2),
                "sleep_debt": round(debt, 2),
                "resting_hr": round(float(resting_hr), 1),
                "stress": round(float(stress), 1),
                "is_weekend": weekend,
                "is_illness_day": ill,
            }
        )

        # Debt partially clears on a long night.
        if duration > person.sleep_need_hours:
            debt = float(max(0.0, debt - 0.5 * (duration - person.sleep_need_hours)))

    return pd.DataFrame(rows)


def simulate_hours(
    rng: np.random.Generator,
    person: Participant,
    nights: pd.DataFrame,
    focus_shift: float = 0.0,
) -> pd.DataFrame:
    """One row per waking hour, carrying features and the generated focus_proxy.

    `focus_shift` displaces the circadian phase over the run -- used by the drift
    scenario to give the online learner something real to adapt to.
    """
    rows = []
    total_days = len(nights)

    for offset, night in enumerate(nights.itertuples()):
        # Ramp the shift in gradually so the learner sees a trend, not a step change.
        shift = focus_shift * (offset / max(total_days - 1, 1))
        chronotype = person.chronotype_hours + shift

        steps_today = 0.0
        recent_steps: list[float] = []

        for hour in WAKING_HOURS:
            hours_awake = max(0.0, hour - night.wake_hour)
            if hours_awake <= 0:
                continue

            c = process_c(hour, chronotype)
            s = process_s(hours_awake, night.sleep_debt)
            dip = post_lunch_dip(hour, chronotype)

            stress_penalty = person.stress_reactivity * (night.stress / 100.0)

            # Last night's sleep acts on today directly, not only through the debt
            # accumulator. Without this term a single bad night is almost invisible,
            # which would be a strange property for an app built on sleep data.
            restedness = 0.30 * np.clip(night.sleep_duration - person.sleep_need_hours, -3.0, 1.5)
            restedness += 0.014 * (night.deep_sleep_min - 85.0)

            # Centre above the midpoint, then let the processes move it.
            focus = 3.4 + 0.80 * c - 1.00 * s + restedness - dip - 0.9 * stress_penalty
            if night.is_illness_day:
                focus -= 0.8

            focus += rng.normal(0, 0.32)  # self-report imprecision
            focus = float(np.clip(focus, FOCUS_MIN, FOCUS_MAX))

            # Activity: a morning and an evening bump, suppressed when unwell.
            step_rate = 380 * np.exp(-((hour - 9) ** 2) / 8) + 520 * np.exp(-((hour - 18) ** 2) / 6)
            step_rate *= 0.35 if night.is_illness_day else 1.0
            steps_hour = float(max(0.0, rng.normal(step_rate, step_rate * 0.35 + 40)))
            steps_today += steps_hour
            recent_steps.append(steps_hour)

            # Task density: people schedule work when they *expect* to be able to do it,
            # so it tracks alertness -- but loosely. The coupling is kept weak on purpose.
            # Mispredicting one's own good hours is precisely the gap the app exists to
            # close, and a tight coupling would make task_density a near-copy of the
            # label, flattering any model that used it.
            expected = 0.30 * (focus - 3.0) + rng.normal(0, 1.0)
            task_density = int(np.clip(round(1.6 + expected), 0, 6))

            rows.append(
                {
                    "timestamp": datetime.combine(
                        date.fromisoformat(night.date), time(hour=hour), tzinfo=timezone.utc
                    ).isoformat(),
                    "participant": person.label,
                    "hour_of_day": hour,
                    "day_of_week": date.fromisoformat(night.date).weekday(),
                    "sleep_duration": night.sleep_duration,
                    "deep_sleep_min": night.deep_sleep_min,
                    "resting_hr": night.resting_hr,
                    "stress": night.stress,
                    "steps_last_3h": round(float(sum(recent_steps[-3:])), 1),
                    "task_density": task_density,
                    "focus_proxy": round(focus, 3),
                }
            )

    frame = pd.DataFrame(rows)

    # resting_hr_delta_7d -- the illness/strain signal. Computed here so the simulated
    # frame carries exactly the feature set build_features.py produces for real data.
    daily_hr = frame.groupby(frame["timestamp"].str[:10])["resting_hr"].first()
    trailing = daily_hr.rolling(7, min_periods=2).mean()
    delta = (daily_hr - trailing).round(2)
    frame["resting_hr_delta_7d"] = frame["timestamp"].str[:10].map(delta).fillna(0.0)

    return mark_synthetic(frame)


# ---------------------------------------------------------------------------
# Modes
# ---------------------------------------------------------------------------
def mode_demo(rng: np.random.Generator, days: int, seed: int) -> dict:
    """A coherent timeline for the presentation account and the Laravel seeder.

    Deliberately shaped rather than random: a rough patch in week two that the app
    detects, then recovery. A demo has to be legible in ninety seconds.
    """
    person = Participant(
        label="demo-user",
        chronotype_hours=0.8,  # mild owl -- makes the "your peak is later than you think" story land
        sleep_need_hours=8.0,
        resting_hr_baseline=58.0,
        stress_reactivity=0.7,
    )
    start = date.today() - timedelta(days=days - 1)
    illness = {days - 19, days - 18, days - 17} if days >= 20 else set()

    nights = simulate_nights(rng, person, days, start, illness_days=illness)
    hours = simulate_hours(rng, person, nights)

    tasks = []
    task_titles = [
        "Literature review", "Draft API spec", "Refactor sync engine", "Team standup",
        "Gym session", "Grocery run", "Deep work: ML pipeline", "Review PRs",
        "Call parents", "Plan next sprint", "Read paper", "Fix failing tests",
    ]
    for offset in range(days):
        day = start + timedelta(days=offset)
        for _ in range(int(rng.integers(2, 6))):
            hour = int(rng.choice(list(WAKING_HOURS)))
            tasks.append(
                {
                    "title": str(rng.choice(task_titles)),
                    "scheduled_at": datetime.combine(day, time(hour=hour), tzinfo=timezone.utc).isoformat(),
                    "completed": bool(rng.random() < 0.72),
                }
            )

    # Focus logs at the four times the original study design called for.
    log_hours = {10, 13, 16, 20}
    focus_logs = [
        {
            "logged_at": row["timestamp"],
            "rating": int(round(row["focus_proxy"])),
            "task_type": str(rng.choice(["deep-work", "admin", "meeting", "rest"])),
        }
        for row in hours.to_dict("records")
        if row["hour_of_day"] in log_hours
    ]

    return {
        "meta": {
            "synthetic": True,
            "warning": "SYNTHETIC DEMONSTRATION DATA -- not measured, not for training",
            "generator": "ml/simulate.py",
            "generative_model": "two-process (Borbely 1982) + chronotype phase (Roenneberg)",
            "seed": seed,
            "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "days": days,
        },
        "participant": asdict(person),
        "nights": nights.to_dict("records"),
        "tasks": tasks,
        "focus_logs": focus_logs,
    }


def mode_tasks(rng: np.random.Generator, days: int) -> pd.DataFrame:
    """task_density streams for several participants -- the feature real data lacks."""
    frames = []
    for index in range(6):
        person = Participant.sample(rng, f"sim-{index:02d}")
        nights = simulate_nights(rng, person, days, date.today() - timedelta(days=days - 1))
        frames.append(simulate_hours(rng, person, nights))
    return pd.concat(frames, ignore_index=True)


def mode_drift(rng: np.random.Generator, days: int) -> pd.DataFrame:
    """A participant whose peak hours migrate later -- the online learner must follow.

    Without a moving target, an online-learning demonstration proves nothing: a static
    model would score just as well.
    """
    person = Participant.sample(rng, "drift-user")
    nights = simulate_nights(rng, person, days, date.today() - timedelta(days=days - 1))
    return simulate_hours(rng, person, nights, focus_shift=2.5)


def mode_edge(rng: np.random.Generator) -> dict[str, pd.DataFrame]:
    """Deterministic fixtures for the scoring and alerting paths."""
    today = date.today()

    illness = Participant.sample(rng, "edge-illness")
    illness_nights = simulate_nights(rng, illness, 21, today - timedelta(days=20), illness_days={17, 18, 19})

    debt_person = Participant("edge-sleep-debt", 0.0, 8.5, 62.0, 0.6)
    debt_nights = simulate_nights(rng, debt_person, 14, today - timedelta(days=13))
    # Force a week of short nights so the debt accumulator is unambiguously exercised.
    debt_nights.loc[7:, "sleep_duration"] = 5.1
    debt_nights.loc[7:, "sleep_debt"] = np.cumsum(np.full(len(debt_nights) - 7, 3.4)).round(2)

    stressed = Participant("edge-high-stress", 0.0, 8.0, 60.0, 0.9)
    stress_nights = simulate_nights(rng, stressed, 7, today - timedelta(days=6))
    stress_nights["stress"] = 78.0  # above the breathing-orb trigger threshold of 65

    return {
        "illness-spike": simulate_hours(rng, illness, illness_nights),
        "sleep-debt": simulate_hours(rng, debt_person, debt_nights),
        "high-stress": simulate_hours(rng, stressed, stress_nights),
    }


# ---------------------------------------------------------------------------
def write_frame(frame: pd.DataFrame, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    frame.to_csv(path, index=False)
    print(f"  {path.relative_to(ML_DIR.parent)}  ({len(frame)} rows, {ORIGIN_COLUMN}=synthetic)")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--mode", choices=["demo", "tasks", "drift", "edge", "all"], default="all")
    parser.add_argument("--days", type=int, default=30)
    parser.add_argument("--seed", type=int, default=7003)  # the module code, for luck
    args = parser.parse_args()

    modes = ["demo", "tasks", "drift", "edge"] if args.mode == "all" else [args.mode]
    print(f"simulate.py  seed={args.seed}\n")

    for mode in modes:
        rng = np.random.default_rng(args.seed)  # per-mode, so modes are independent
        print(f"{mode}:")

        if mode == "demo":
            payload = mode_demo(rng, args.days, args.seed)
            SEEDER_DATA.mkdir(parents=True, exist_ok=True)
            out = SEEDER_DATA / "demo_timeline.json"
            out.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
            print(
                f"  {out.relative_to(ML_DIR.parent)}  "
                f"({args.days} days, {len(payload['tasks'])} tasks, "
                f"{len(payload['focus_logs'])} focus logs)"
            )

        elif mode == "tasks":
            write_frame(mode_tasks(rng, max(args.days, 60)), FIXTURES / "task_density.csv")

        elif mode == "drift":
            write_frame(mode_drift(rng, max(args.days, 60)), FIXTURES / "drift_scenario.csv")

        elif mode == "edge":
            for name, frame in mode_edge(rng).items():
                write_frame(frame, FIXTURES / f"edge_{name}.csv")

    print("\nAll output is tagged synthetic and is rejected by train.py.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
