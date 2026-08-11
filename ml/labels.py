"""The target variable, defined once.

There is deliberately no second place in this codebase where a label is constructed. The
target is derived rather than measured, and a derivation that appears in two files will
eventually disagree with itself -- at which point the evaluation chapter describes
something the model was not trained on.

What the data provides
----------------------
LifeSnaps records momentary affect as **seven mutually exclusive categories**, not as a
rating. There is no intensity scale, so no regression target exists:

    ALERT · HAPPY · NEUTRAL · RESTED/RELAXED · SAD · TENSE/ANXIOUS · TIRED

Only 3.15% of hourly rows carry one (5,029 of 159,508).

How the target was chosen
-------------------------
Empirically, not by intuition. Four binary constructions were compared under 5-fold
participant-wise cross-validation in `notebooks/01_gate_label_signal.py`:

    energy     ALERT+HAPPY vs TIRED+SAD           0.654 +-0.028   <- chosen
    not-tired  everything vs TIRED                0.629 +-0.024
    valence    pleasant vs unpleasant             0.568 +-0.025
    strict     ALERT+RESTED vs TIRED+TENSE        0.553 +-0.027

The construction that *looked* most focus-like (`strict`) scored worst of the four, at
essentially chance. The choice of target moved performance far more than the choice of
model did.

**Why the activation axis wins.** Under Russell's circumplex model, affect decomposes
into valence (pleasant-unpleasant) and arousal (activated-deactivated). Wearables measure
the physiological correlates of arousal -- heart rate, HRV, sleep pressure, movement --
and have no privileged access to valence. So the axis the sensors can actually reach is
the one that works, and the near-chance `valence` result is the same finding stated
negatively.

What this is not
----------------
`focus_ready` is **not a measurement of focus**. It is a binary contrast between
self-selected mood categories grouped along an activation axis. A model that predicts it
well predicts self-reported activation well; whether acting on that improves anyone's
working day is a separate question this data cannot answer. See docs/DATASET.md 4.4 for
the wording this requires in the report.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from ingest_lifesnaps import MOOD_COLUMNS

TARGET = "focus_ready"
MOOD = "mood"

#: Activated-pleasant states: available to concentrate.
FOCUS_READY = {"ALERT", "HAPPY"}

#: Deactivated states: not available to concentrate.
NOT_FOCUS_READY = {"TIRED", "SAD"}

#: Dropped, not assigned. NEUTRAL carries no activation information; RESTED/RELAXED and
#: TENSE/ANXIOUS are activation-ambiguous -- rested is pleasant but deactivated, tense is
#: activated but aversive. Forcing them to a side was what made the `strict` construction
#: perform worst.
AMBIGUOUS = {"NEUTRAL", "RESTED/RELAXED", "TENSE/ANXIOUS"}


def add_mood(frame: pd.DataFrame) -> pd.DataFrame:
    """Collapse the seven one-hot columns into a single categorical `mood` column.

    Rows with no mood recorded get NaN -- that is 96.85% of them.
    """
    missing = set(MOOD_COLUMNS) - set(frame.columns)
    if missing:
        raise KeyError(f"mood columns absent from frame: {sorted(missing)}")

    out = frame.copy()
    has_mood = out[MOOD_COLUMNS].notna().any(axis=1)
    # Object dtype up front: assigning category names into a float NaN column works
    # today but pandas has deprecated the silent upcast.
    out[MOOD] = pd.Series(pd.NA, index=out.index, dtype="object")
    out.loc[has_mood, MOOD] = out.loc[has_mood, MOOD_COLUMNS].idxmax(axis=1)
    return out


def add_target(frame: pd.DataFrame) -> pd.DataFrame:
    """Add `focus_ready` (1 / 0 / NaN). NaN rows are unlabelled or ambiguous."""
    out = frame if MOOD in frame.columns else add_mood(frame)
    out = out.copy()

    def classify(mood: object) -> float:
        if mood in FOCUS_READY:
            return 1.0
        if mood in NOT_FOCUS_READY:
            return 0.0
        return np.nan  # unlabelled or deliberately ambiguous

    out[TARGET] = out[MOOD].map(classify)
    return out


def labelled_only(frame: pd.DataFrame, min_rows_per_participant: int = 10) -> pd.DataFrame:
    """Keep only rows with a usable target, and only participants with enough of them.

    A participant contributing three rows cannot support a cross-validation fold; their
    presence inflates the participant count in the report without adding information.
    """
    out = frame if TARGET in frame.columns else add_target(frame)
    out = out.dropna(subset=[TARGET]).copy()
    out[TARGET] = out[TARGET].astype(int)

    counts = out["participant"].value_counts()
    keep = counts[counts >= min_rows_per_participant].index
    return out[out["participant"].isin(keep)].copy()


def describe(frame: pd.DataFrame) -> str:
    """Label composition, for the report's dataset table."""
    with_mood = add_mood(frame)
    labelled = with_mood[with_mood[MOOD].notna()]
    usable = labelled_only(with_mood)

    lines = [
        f"labelled rows      {len(labelled):>6,}  ({len(labelled) / len(frame) * 100:.2f}% of all)",
        f"usable rows        {len(usable):>6,}  "
        f"({usable['participant'].nunique()} participants)",
        f"positive rate      {usable[TARGET].mean() * 100:>5.1f}%",
        "",
        "mood distribution:",
    ]
    counts = labelled[MOOD].value_counts()
    for mood, count in counts.items():
        if mood in FOCUS_READY:
            role = "-> focus_ready = 1"
        elif mood in NOT_FOCUS_READY:
            role = "-> focus_ready = 0"
        else:
            role = "   dropped (ambiguous)"
        lines.append(f"  {mood:<16} {count:>5,}  {role}")

    return "\n".join(lines)


if __name__ == "__main__":
    from ingest_lifesnaps import load_hourly

    print(describe(load_hourly()))
