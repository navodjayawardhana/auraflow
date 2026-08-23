# Phase A — Profile and the derived plan

**This file is the contract between the API and the mobile app.** Two agents build against
it in parallel. Neither may change a shape here unilaterally: propose the change, say why,
and report it.

## Why this exists

Three places in the codebase were written expecting personalisation and never got it.

| Where | What is hardcoded | What the profile supplies |
|---|---|---|
| `mobile/src/constants/goals.ts` | `STEP_GOAL = 10_000`, `WATER_GOAL_ML = 2_000` | body mass, and the weather the app already fetches |
| `mobile/src/services/energy.ts` | `estimateActiveKcal(steps, weightKg = 70)` — **the parameter exists and no caller passes one** | real body mass |
| `api/.../RecoveryScoreCalculator.php` | `$personalSleepNeedHours`, `$personalDeepMinutes`, `$personalRemMinutes` — **three parameters, never passed** | a personal sleep need |

`goals.ts` says so in its own docblock: *"personalising a hydration goal properly needs body
mass, climate and activity."* This phase supplies all three.

## The honesty rule, which is not negotiable

"Burn 500 kcal today" and "keep your heart rate at 140" are health advice. This project has
been careful everywhere else not to let an estimate wear the clothes of a measurement — read
`mobile/src/components/focus-forecast.tsx` and `docs/report/EVIDENCE-LOG.md` to calibrate.

So: **every derived number names the published formula it came from**, and the UI says so.
No invented coefficients. No number without a provenance.

| Value | Formula | Note |
|---|---|---|
| BMR | **Mifflin–St Jeor (1990)** | Better validated than Harris–Benedict. Needs age, sex, height, mass. |
| TDEE | BMR × activity factor | Prefer a factor derived from the user's **measured** step history over a self-reported one once ≥7 days exist. |
| Max HR | **Tanaka (2001)**: `208 − 0.7 × age` | Not `220 − age`, which is folklore with a large error term. |
| HR zones | **Karvonen** (heart-rate reserve) | `((HRmax − HRrest) × intensity) + HRrest`. Uses the app's **measured** resting HR when a 14-day baseline exists — see `RestingHeartRateBaseline`. Fall back to a population resting HR and **say which was used**. |
| Water | EFSA/IOM adequate intake, scaled by mass, adjusted for ambient temperature | The weather endpoint already exists. |
| Steps | Measured 7-day median, nudged toward a target | Fall back to 10,000 with the existing "recognisable anchor" caveat until enough history exists. **Complete days only** — see below. |
| Sleep need | Age-band guidance (NSF) | Feeds `RecoveryScoreCalculator`'s dormant `$personalSleepNeedHours`. |

**Steps, and what a day means.** `health_snapshots` carries `steps_are_complete` beside
`steps`, because the same integer means two things: iOS answers a step query from the
operating system's own pedometer history, so its figure is the day, while Android can only
report what the app witnessed while foregrounded. `POST /api/v1/health-snapshots` requires
the flag whenever a count is sent, and `basis.step_goal_source` reaches `measured_7d` only
on seven days that state they are whole — a Tudor-Locke band chosen from a median of
undercounts sits below what the person already walks, which is worse than the population
default it replaces because it looks derived. The vocabulary is unchanged; the bar for
earning `measured_7d` is not.

**BMI**: report the value and a band, but use **WHO Asian cut-offs (23 / 27.5)** alongside the
standard ones (25 / 30) and let the profile say which population applies, defaulting to
showing both. The users of this app are in Sri Lanka; applying European cut-offs silently
would be a real error, and noticing it is worth a paragraph in the report.

---

## API contract

All routes sit inside the existing authenticated `v1` group. All respond `{"data": ...}`.

### Profile

```
GET  /api/v1/profile      200 {"data": Profile|null}
PUT  /api/v1/profile      200 {"data": Profile}     422 on validation
```

```ts
interface Profile {
  date_of_birth: string | null;        // YYYY-MM-DD
  sex: 'female' | 'male' | 'unspecified';
  height_cm: number | null;            // 80–250
  weight_kg: number | null;            // 25–350, one decimal
  activity_level: 'sedentary' | 'light' | 'moderate' | 'active' | 'very_active';
  // Derived, read-only. Null when height or weight is missing.
  bmi: number | null;
  bmi_band: 'underweight' | 'healthy' | 'overweight' | 'obese' | null;
  bmi_scale: 'who_standard' | 'who_asian';
  updated_at: string;                  // ISO 8601
}
```

Every field on `PUT` is optional — a partial profile is valid and normal. Nothing is
required to use the app; the plan degrades instead.

### Plan

```
GET  /api/v1/plan               200 {"data": Plan|null}
POST /api/v1/plan/recalculate   200 {"data": Plan}    // derive afresh from the profile
PUT  /api/v1/plan               200 {"data": Plan}    // user overrides; creates a new version
GET  /api/v1/plan/history       200 {"data": PlanVersion[]}   // newest first, capped at 50
```

```ts
interface Plan {
  version: number;                     // 1-based, increments on every change
  source: 'derived' | 'edited';        // 'edited' the moment a user overrides any field
  step_goal: number;
  water_ml: number;
  active_kcal_goal: number;
  sleep_need_hours: number;
  hr_zones: {
    easy: [number, number];
    moderate: [number, number];
    hard: [number, number];
  };
  // Why each number is what it is. The UI renders this; it is not debug output.
  basis: {
    bmr_kcal: number | null;
    tdee_kcal: number | null;
    bmr_formula: 'mifflin_st_jeor' | null;
    max_hr_formula: 'tanaka' | null;
    hr_zone_formula: 'karvonen' | null;
    resting_hr_bpm: number | null;
    resting_hr_source: 'measured_14d' | 'population_default' | null;
    step_goal_source: 'measured_7d' | 'population_default';
    water_source: 'mass_and_climate' | 'population_default';
    // Fields the plan could not derive because the profile lacks them.
    missing: string[];                 // e.g. ["date_of_birth", "weight_kg"]
  };
  created_at: string;
}

interface PlanVersion extends Plan {
  /** Which fields the user changed by hand in this version, if any. */
  edited_fields: string[];
}
```

**A plan exists even with an empty profile.** It falls back to today's constants and lists
everything in `basis.missing`. That is the cold-start path, and it is the same discipline the
recovery score's `provisional` flag already follows: produce something, and say what it did
not know.

---

## Division of work

**Agent A — `api/` only.** Migrations, domain services for every formula above, the
endpoints, and wiring `RecoveryScoreCalculator`'s three dormant parameters to the plan's
`sleep_need_hours`. Tests for every formula against published worked examples.

**Agent B — `mobile/` only.** Profile screen, plan screen, plan history, and rewiring
`goals.ts` and `energy.ts` to read the plan instead of constants. Builds against this
contract; the endpoints will not exist yet.

Neither touches the other's directory.
