# Data Provenance, Labelling and Limitations

> **Report mapping:** §3.4 Methodology (data strategy) · §5.4 Evaluation (threats to validity) · Appendix B (simulator rules)
>
> This document is the single authoritative record of where AuraFlow's data comes
> from, what was derived rather than measured, and what those choices cost. Every
> claim in the report about the dataset should be traceable to a section here.

---

## 1. Position statement

AuraFlow's productivity model is trained on **public, peer-reviewed wearable research
datasets**. It is **not** trained on the author's own wearable data, and it is **not**
trained on synthetic data.

The project originally intended to train on a first-party dataset collected from the
author's Huawei Watch Fit. That path was abandoned; §2 records why, because the reason
is itself a finding worth reporting rather than an embarrassment to hide.

A seeded simulator (`ml/simulate.py`) exists, but its output is confined to demonstration
data, task streams and edge-case test fixtures. **Simulator output never reaches model
training.** This is enforced in code, not by convention — see §6.

---

## 2. Why not first-party data

Two independent blockers, in order of discovery:

**2.1 The watch does not expose its sensors.** A BLE service discovery scan
(nRF Connect) against the Huawei Watch Fit returned **no `0x180D` Heart Rate service**.
The device advertises `0xFE86`, a Huawei-assigned SIG member UUID carrying a
proprietary, authenticated protocol. Direct BLE ingestion is therefore closed, leaving
Huawei Health → Health Connect as the sole live path.

> This is **primary evidence collected by the author**, not a claim borrowed from the
> literature. It is a concrete, measured instance of vendor lock-in in the consumer
> wearables market, and it belongs in §5 as a finding.

**2.2 The remaining path could not produce a usable dataset in the time available.**
Supervised training needs paired data: biometrics **and** focus labels. Labels can only
be produced by sustained self-report (4×/day for several weeks) and cannot be
reconstructed retroactively. Within the assessment timeline, neither the vendor data
export nor the labelling campaign could yield a dataset large enough to train and
honestly evaluate a model.

**2.3 What changed as a result.** Moving to public cohorts is not purely a loss:

| | First-party plan | Public-dataset plan |
|---|---|---|
| Participants | 1 | **71** (+16 for validation) |
| Split strategy | chronological only | **participant-wise group split** + chronological |
| Generalisation claim | not possible | **cross-dataset, two independent cohorts** |
| Cold-start prior | hypothetical | measurable from a real population |
| Demonstration | dependent on live sync | deterministic replay |

The cost is the loss of the personal *n*=1 novelty and of the within-subject
before/after effectiveness study. §7 sets out what replaces the latter.

---

## 3. Datasets

### 3.1 LifeSnaps — primary

| | |
|---|---|
| **Citation** | Yfantidou, S., Karagianni, C., Efstathiou, S. *et al.* (2022) 'LifeSnaps, a 4-month multi-modal dataset capturing unobtrusive snapshots of our lives in the wild', *Scientific Data*, 9, 663. https://doi.org/10.1038/s41597-022-01764-x |
| **Repository** | Zenodo, https://doi.org/10.5281/zenodo.7229547 (concept DOI 10.5281/zenodo.6826682) |
| **Licence** | **CC BY 4.0** — attribution only; commercial use permitted |
| **Archive** | `rais_anonymized.zip`, 615,037,493 bytes, MD5 `726afe263ab4b900a721eac19b2ca13a` |
| **Participants** | 71, geographically distributed |
| **Duration** | 4+ months |
| **Device** | Fitbit Sense |

**Why this cohort.** The Fitbit Sense measures sleep stages, resting heart rate, a
proprietary stress score, SpO2, HRV and steps — close to a one-for-one match with the
Huawei Watch Fit signals the AuraFlow architecture was designed around, so the feature
set survives the pivot unchanged. Critically, it ships **hourly-granularity** data
alongside daily aggregates, which the `hour_of_day` feature depends on, and it includes
**ecological momentary assessments** (SEMA3) capturing subjective state several times
per day — the same shape as the 4×/day self-report the original design called for.

### 3.2 PMData — secondary, validation only

| | |
|---|---|
| **Citation** | Thambawita, V., Hicks, S.A., Borgli, H. *et al.* (2020) 'PMData: a sports logging dataset', *Proceedings of the 11th ACM Multimedia Systems Conference (MMSys '20)*, pp. 231–236. https://doi.org/10.1145/3339825.3394926 |
| **Repository** | OSF, https://osf.io/vx4bk/ · mirror: https://datasets.simula.no/pmdata/ |
| **Licence** | **CC BY-NC 4.0** — attribution, **non-commercial only** |
| **Participants** | 16 |
| **Duration** | 5 months — 2019-11-01 to 2020-03-30 |
| **Device** | Fitbit Versa 2 + PMSys self-report app |
| **Archive** | `pmdata.zip`, 1.35 GB (3.25 GB unpacked, 913 files); OSF builds it on demand, so SHA-256 is pinned on first download rather than published |

**Verified on retrieval (2026-08-11).** `pmsys/wellness.csv`, 16 participants,
**1,747 rows**, median 103 days per participant.

| Field | Scale |
|---|---|
| `readiness` | **0–10** |
| `fatigue`, `mood`, `stress`, `sleep_quality`, `soreness` | **0–5** |
| `sleep_duration_h` | 0–12 (self-reported hours) |

> ⚠️ **Correction.** The project plan described these as 1–5 scales. They are not:
> `readiness` is 0–10 and the rest are 0–5. Any comparison against a differently-scaled
> target must normalise explicitly rather than assume alignment.

**Why this cohort.** It is an independent test of whether findings transfer, rather than a
second sample of the same distribution: different device generation, different cohort,
different self-report instrument, and collected two years earlier. `readiness` provides a
directly labelled ground-truth comparator for the **daily Recovery Score** — see §4.5 for
why its role is narrower than the plan assumed.

> ⚠️ **Licence constraint that reaches the report.** The NC clause forbids commercial
> use. The report proposes a monetisation model (§1, business value). Those two must not
> be allowed to contradict each other. The position to state explicitly in §3.4 and §5.4:
>
> > *The commercial pathway rests on the CC BY-licensed LifeSnaps cohort. PMData is used
> > exclusively for non-commercial academic validation; a commercial deployment would
> > require either separate licensing from the rights holders or retraining without it.*
>
> Naming this constraint is worth more than avoiding it — it is direct evidence of the
> legal and ethical awareness the learning outcomes ask for.

### 3.3 Retrieval and integrity

```bash
python ml/download_data.py                # fetch both
python ml/download_data.py --verify-only  # re-check files already on disk
```

Raw archives are **not committed** (`.gitignore`): they exceed 600 MB, and fetching from
the canonical source keeps the licence chain and provenance verifiable. The script
verifies published checksums where the source provides them, and pins a SHA-256 on first
download where it does not (OSF builds its archive on demand). Results are written to
`data/raw/PROVENANCE.json` — URL, SHA-256, byte count and retrieval timestamp per file —
so a reviewer can confirm the model was trained on the same bytes.

---

## 4. The label problem

**Neither dataset contains a column called "focus."** AuraFlow's target variable is
therefore **derived**, and the derivation is a modelling decision that must be declared.

### 4.1 What the data actually contains

The plan assumed LifeSnaps carried a graded alertness rating. **It does not.** Inspection
of `hourly_fitbit_sema_df_unprocessed.csv` (159,508 rows, 71 participants) found:

| | |
|---|---|
| Label format | **Seven mutually exclusive mood categories**, one-hot. No row carries more than one. |
| Categories | `ALERT` · `HAPPY` · `NEUTRAL` · `RESTED/RELAXED` · `SAD` · `TENSE/ANXIOUS` · `TIRED` |
| Coverage | **5,029 rows — 3.15%** of hourly rows; 63 of 71 participants |
| Per participant | median 65 labelled rows; only 23 participants exceed 100 |
| `ALERT` frequency | **344 selections** — the second-rarest category |

There is no intensity scale of any kind. A regression target on 1–5 is not available,
so **the task is classification, not regression** — the alternative the plan already
allowed for (confusion matrix + F1 rather than MAE/RMSE/R²).

### 4.2 Choosing the target — the finding that mattered

Four binary constructions were compared under 5-fold participant-wise cross-validation
(`ml/notebooks/01_gate_label_signal.py`). **The choice of target moved performance far
more than the choice of model:**

| Target | Axis | n | Best ROC-AUC |
|---|---|---|---|
| **`energy` — ALERT+HAPPY vs TIRED+SAD** | **activation** | 2,356 | **0.654 ± 0.028** |
| `not-tired` — everything vs TIRED | activation | 4,976 | 0.629 ± 0.024 |
| `valence` — pleasant vs unpleasant | valence | 4,976 | 0.568 ± 0.025 |
| `strict` — ALERT+RESTED vs TIRED+TENSE | mixed | 3,206 | 0.553 ± 0.027 |

The first construction attempted — `strict`, which looked the most obviously
"focus-like" — performed **worst of the four**, at essentially chance.

**Why the activation axis wins is the interesting part.** Under Russell's circumplex
model, affect decomposes into *valence* (pleasant–unpleasant) and *arousal*
(activated–deactivated). Wearables measure the physiological correlates of arousal —
heart rate, HRV, sleep pressure, movement. They have no privileged access to valence.
A target aligned to the arousal axis is therefore the one the sensors can reach, and the
`valence` result (0.568, near chance) is the same finding stated negatively.

This is worth reporting as a result in its own right, not buried as a preprocessing
detail.

### 4.3 Feature-set and model findings

| Feature set | ROC-AUC (`energy` target) |
|---|---|
| time-only (hour, day of week, weekend) | 0.609 |
| biometric (sleep, resting HR, HRV, stress, steps…) | 0.611 |
| **biometric + context** (`WORK/SCHOOL`, `HOME`, `GYM`…) | **0.654** |

**Context contributes more than the biometrics do.** Adding location context lifts AUC by
0.043 while the entire biometric block adds 0.002 over time alone. AuraFlow already plans
geofencing (W10.12), so context is available at inference time — but the report should
not claim the wearable signals are carrying the model when they are not.

**Logistic regression beat gradient boosting in almost every configuration.** With ~2,356
rows across 45 participants, the boosted trees overfit. Two consequences: the honest one
is that a linear model is the appropriate choice at this sample size; the useful one is
that a logistic regression exports to `coefficients.json` and runs in TypeScript, making
the sub-50 ms on-device inference requirement trivial and removing the need for TFLite
on this model.

### 4.4 What this costs — construct validity

**The target is not focus.** It is a binary contrast between self-selected momentary mood
categories, grouped along an activation axis. Alertness and tiredness are correlates of
the capacity to concentrate, not measurements of concentration.

**And the signal is modest.** ROC-AUC 0.654 sits just above the conventional 0.60 floor
for a usable model and far below anything that would justify confident language. The
report must state the number and its spread, not describe the model as "accurate."

Suggested §5.4 wording:

> *The target is a derived binary proxy: momentary mood categories grouped along the
> activation axis of Russell's circumplex. It is not a measurement of focus. The model
> discriminates focus-favourable from focus-unfavourable hours at ROC-AUC 0.654 ± 0.028
> under participant-wise cross-validation — above chance and above the conventional
> deployment floor, but modest. Notably, location context contributes more than the
> wearable-derived features, which qualifies the premise that biometric sensing is the
> primary route to this prediction.*

### 4.5 Why PMData cannot serve as the fallback — confirmed

The plan named PMData's `fatigue`/`readiness` as the fallback target if the LifeSnaps label
failed. **It is not a drop-in replacement, and the archive confirms why.**

**Measured, not assumed (2026-08-11):** of 1,747 participant-days in `wellness.csv`,
**99.0% carry exactly one entry** (1,712 of 1,730 participant-days; 16 have two, one has
three). Submission timestamps are spread across all 24 hours, but that reflects *when the
person filled the form*, not what it describes — there is still only one observation per day.

**PMData's self-report is therefore daily, and cannot support an hour-of-day model at all.**
Predicting *when in the day* to work is AuraFlow's central claim, so the fallback the plan
relied on does not exist. Had the LifeSnaps label failed the gate (§4.2), the project would
have needed a different response — not this cohort.

**Its actual role is narrower and still useful:** validation of the **daily Recovery Score**,
where `readiness` (0–10) is a directly labelled comparator against Fitbit sleep and resting
heart rate. 1,747 labelled days across 16 participants is a reasonable dataset for that
component — it is simply a different model from the hourly scheduler.

**Consequence for E3.** The planned cross-dataset generalisation test (§7) cannot be run on
the hourly model. E3 is therefore scoped to the daily recovery component, and the hourly
model's generalisation rests on participant-wise cross-validation within LifeSnaps alone.
**This is a genuine reduction in evidence and must be stated as one.**

---

## 5. Features

Derived in `ml/build_features.py`:

Two source files, joined on `(id, date)`. The hourly file carries the label, time and
activity; **all sleep, resting-HR and stress fields exist only in the daily file.**

| Feature | Source column | Coverage after join |
|---|---|---|
| `hour_of_day`, `day_of_week`, `is_weekend` | hourly `hour`, `date` | 100% |
| `steps`, `bpm`, `calories` | hourly | ~100% |
| context one-hots (`WORK/SCHOOL`, `HOME`, `GYM`, …) | hourly | 100% |
| `sleep_hours` | daily `sleep_duration` | 80% |
| `resting_hr` | daily | 88% |
| `resting_hr_delta_7d` | derived — `resting_hr` minus its trailing 7-day mean, per participant | 88% |
| `stress_score` | daily | **48%** |
| `sleep_deep_ratio`, `sleep_rem_ratio`, `sleep_efficiency` | daily | 75% |
| `nremhr`, `rmssd`, `spo2` | daily | 53% / 53% / 17% |
| `task_density` | **simulated** — see §6 | — |

### Data-quality corrections

Three issues found on inspection that would misrepresent the data if left unstated:

1. **`sleep_duration` is in milliseconds**, not minutes or hours (median 27.5 M ms ≈ 7.63 h).
2. **125 nights are physiologically implausible** — the range runs from 1.0 h to 20.7 h.
   These are dropped rather than clipped: clipping would invent a plausible value where
   none was measured.
3. **`sleep_deep_ratio` is not a fraction.** Its median is 0.986 and its maximum 4.31,
   with 1,567 values above 1. It is a ratio between sleep stages, not a proportion of
   total sleep. **It must not be described as "percentage of deep sleep" in the report.**

`stress_score` is retained despite 48% coverage because dropping incomplete rows would
cut the usable set from 4,012 rows / 57 participants to 2,098 / 29. It is imputed, and
the imputation is reported.

**Leakage control.** Splits are grouped by participant, so no individual appears in both
training and test — without this, the model can memorise a person rather than learn a
pattern, and the reported metrics become meaningless. Enforced by an assertion in
`ml/split.py` and a regression test in `ml/tests/test_split.py`.

---

## 6. The simulator, and the wall around it

`ml/simulate.py` generates data for four purposes the public cohorts cannot serve:

| # | Need | Why no dataset provides it |
|---|---|---|
| 1 | `task_density` | No wearable dataset contains the participant's task list |
| 2 | Demonstration / seed data | A presentation needs a coherent, legible account, not a random real participant |
| 3 | Online-learning demonstration | Showing an SGD update requires a controllable user trajectory |
| 4 | Edge-case fixtures | Illness spikes, sleep debt and stress>65 triggers must be reproducible for tests |

**Generative rules** (documented in full in Appendix B): a circadian curve after
Roenneberg, a sleep-debt accumulator, stress coupling, and Gaussian noise. The RNG is
seeded, so output is reproducible.

### The wall

> **Simulator output must never enter model training.** If it did, the model would learn
> the rules the author wrote, and every metric in §5 would be circular — measuring
> nothing but the simulator.

Enforced in two places, deliberately redundant:

- a runtime assertion in `ml/train.py` rejecting any frame carrying the synthetic marker
- `ml/tests/test_no_synthetic_in_training.py`, run in CI

Every artefact derived from the simulator carries a `synthetic=True` marker and is
labelled as synthetic wherever it is presented — including in demonstration screenshots
that appear in the report.

---

## 7. Evaluation consequences

The pivot removes the planned within-subject before/after effectiveness study, which
depended on the author generating personal data across the project timeline. Three
measures replace it:

| | Measure | Evaluation axis |
|---|---|---|
| **E1** | **Retrospective policy evaluation.** On held-out participants: does the hour the model recommends coincide with that person's actually-best-focus hour? Hit-rate @1/@3, against random and fixed-9am baselines. | Effectiveness — on real human data |
| **E2** | **SUS (n=5) + task completion times + heuristic walkthrough.** Requires no wearable; unchanged from the original plan. | Usability |
| **E3** | **Cross-dataset generalisation — scoped down.** PMData's self-report is daily (§4.5), so the hourly model cannot be tested on it. E3 now covers the **daily Recovery Score** against PMData `readiness`. The hourly model's generalisation evidence is participant-wise cross-validation within LifeSnaps only. | ML rigour |

The performance, security and compatibility evaluation blocks are unaffected.

---

## 8. Ethics

Both datasets are **public, de-identified and released for research reuse** by their
original custodians. Participant consent, ethical review and de-identification were
handled by the original studies and are documented in their respective publications;
this project performs **secondary analysis** of already-published data and therefore
requires no new ethical approval and collects no new personal data.

Obligations this project does carry:

- **Attribution** — both datasets cited in the report reference list and in §3.1–3.2 above (both licences require this)
- **Non-commercial restriction** — PMData, see §3.2
- **No re-identification** — no attempt to link participants to identities, and no
  re-publication of the raw data in the repository or the report appendices
- **Separate consent** for the SUS usability study (E2), which does involve new
  participants; consent forms in `docs/test-evidence/`

Under GDPR the source data is already de-identified and lawfully published for research;
the Art. 9 special-category analysis in the requirements pack therefore addresses the
**live app**, where AuraFlow processes the end user's own health data, which remains the
higher-risk pathway.

---

## 9. Limitations — the §5.4 list

1. **Construct validity.** The target is a binary contrast between self-selected mood
   categories grouped along an activation axis. It is not a measurement of focus (§4.4).
2. **Modest discrimination.** ROC-AUC 0.654 ± 0.028 — above the conventional 0.60 floor,
   but the model is a weak predictor and must be described as one.
3. **The biometrics contribute little.** Location context adds 0.043 AUC; the entire
   biometric block adds 0.002 over time-of-day alone (§4.3). This qualifies the project's
   premise that wearable sensing is the primary route to the prediction — a finding that
   belongs in the evaluation, not a detail to omit.
4. **Sparse labels.** Only 3.15% of hourly rows carry a label; the usable set is ~2,400
   rows across 45 participants, with a median of 65 labelled rows per person.
5. **Population mismatch.** Neither cohort was recruited as knowledge workers; the
   scheduling use case assumes that population.
6. **Device mismatch.** Models are trained on Fitbit-derived signals and deployed against
   Health Connect data. Vendors compute sleep stages and stress differently, so
   calibration error at deployment is expected and unquantified.
7. **No first-party validation.** Nothing confirms the model transfers to the author's
   own Huawei device — precisely because §2 made that data unobtainable.
8. **`task_density` is simulated**, so any result resting mainly on that feature is weaker
   than one resting on measured signals.
9. **Retrospective evaluation is not a trial.** E1 measures agreement with past behaviour,
   not whether following the recommendation would have improved anything.
10. **Licence asymmetry.** The validation cohort cannot support commercial claims (§3.2).
11. **No cross-dataset validation of the hourly model.** PMData is daily-only (§4.5), so
    the scheduling model's only generalisation evidence is participant-wise
    cross-validation within a single cohort. Cross-cohort transfer is untested.
12. **Recommendation quality depends on observed location.** The policy evaluation scores
    0.667 P@1 with observed context but 0.600 without it, against 0.578 for a fixed-09:00
    heuristic. A deployed system must *predict* location rather than observe it, so 0.600
    is the defensible figure and the margin over trivial advice is small.

---

## Changelog

| Date | Change |
|---|---|
| 2026-08-11 | Created. Pivot from first-party Huawei collection to LifeSnaps + PMData; licences verified; simulator scope and training wall defined. |
| 2026-08-11 | LifeSnaps archive retrieved and inspected. §4 rewritten against the real schema: no 1–5 alertness scale exists, so the task becomes classification. Target selected empirically (`energy`, ROC-AUC 0.654 ± 0.028); the originally-planned construction scored worst of four. §5 gains real coverage figures and three data-quality corrections. §4.5 records that PMData cannot serve as the planned fallback. |
