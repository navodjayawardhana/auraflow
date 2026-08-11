# Evidence Log — AuraFlow (CMP 7003)

> **මේක මොකටද:** Word report එක ලියන කොට **මෙතනින් copy කරන්න**. හැම entry එකකම තියෙන්නේ:
> මොකද කළේ · **කොහොමද** කළේ (method) · හම්බුණු **ඇත්ත numbers** · **report එකේ කොහෙද යන්නේ**.
>
> ⚠️ **Rule:** වැඩක් කරපු දවසෙම මෙතන ලියන්න. සති 6කට පස්සේ *"ඇයි ඒක එහෙම කළේ"* කියලා මතක් වෙන්නේ නෑ,
> ඒ වෙලාවේ §5 එකේ ලියන්න වෙන්නේ අනුමාන.
>
> **Related:** `docs/DATASET.md` (data provenance — full detail) · `.claude/DATA-STRATEGY.md` (pivot rationale) · `../../TODO.md`

---

## Report section → evidence map

| Report section | මෙතන කොහෙද | තත්ත්වය |
|---|---|---|
| §1 Introduction — problem, objectives | — | ☐ තාම නෑ |
| §2 Literature — trends, gap analysis | — | ☐ තාම නෑ |
| §3.4 Methodology — **data strategy** | **E-002, E-003, E-004** | ✅ ready |
| §4.2 Design — architecture, patterns | E-009 (Adapter, 3rd impl) | ◐ partial |
| §4.6 Security — across lifecycle | E-001 (secrets excluded from VCS) | ◐ partial |
| §5.1 Evaluation — functional testing | E-010 (41 automated tests) | ◐ partial |
| §5.2 Evaluation — performance NFR | E-012 (inference budget) | ◐ partial |
| §5.4 Evaluation — **ML results + threats to validity** | **E-005, E-006, E-007, E-008, E-012** | ✅ ready |
| §6 Conclusion — future work | E-006 (context > biometrics) | ◐ partial |
| **Appendix A** — reproducibility | E-011 | ✅ ready |
| **Appendix B** — simulator generative rules | E-004 | ✅ ready |
| **Appendix C** — raw test evidence | E-010 | ◐ partial |

---

# 2026-08-11

## E-001 · Repository and version control established

**කළේ:** `auraflow/` monorepo (`mobile/` `api/` `ml/` `iot/` `docs/` `data/`), git init, private GitHub repo.

**Evidence:** https://github.com/navodjayawardhana/auraflow — **private**, 5 commits, 41 tests passing.

**Report-relevant decisions:**
- Repo **private until submission**. Reason: a public coursework repo can be copied by a
  peer, and a collusion investigation would implicate **both** parties. Made public at
  submission for examiner access (W12.24).
- `.gitignore` excludes all secrets (`secrets.h`, `.env`, keystores) and all raw datasets.
  Verified post-push: no secret or dataset file is tracked — only `secrets.example.h`.
- Commit history is the **individual-work evidence** the brief asks for. Conventional
  Commits; each message states *why*, not just *what*.

**→ §4.6** (secrets never enter version control — security across the lifecycle, not as a chapter)

---

## E-002 · First-party data collection abandoned — with measured cause

**Context:** the project's original core proposition was training on the author's own
Huawei Watch Fit data.

**Finding 1 — the device does not expose its sensors.** nRF Connect BLE service discovery:

| Service | Status |
|---|---|
| `0x1800` Generic Access, `0x1801` Generic Attribute | present (mandatory) |
| `0x180A` Device Information | present, readable |
| `0x1812` Human Interface Device | present — remote control, no health data |
| **`0xFE86`** | present — **Huawei-assigned SIG member UUID, proprietary and authenticated** |
| `0x3802` | vendor, non-standard |
| **`0x180D` Heart Rate** | **ABSENT** |

**Finding 2 — the remaining path could not yield a dataset in time.** Supervised training
needs paired biometrics *and* focus labels. Labels require sustained self-report (4×/day
over weeks) and **cannot be reconstructed retroactively**.

**Why this belongs in the report as a finding, not an apology:** this is *primary evidence
collected by the author* of vendor lock-in in the consumer wearables market — a measured
instance, not a claim borrowed from the literature.

**☐ Outstanding:** service-list screenshot + `0x180A` values (manufacturer, model, firmware
rev, hardware rev) for the test-environment section. **P0.8.**

**→ §5.4 limitations · §3.4 justification for the data strategy · §2 vendor lock-in**

---

## E-003 · Public research cohorts adopted

| | LifeSnaps (**primary**) | PMData (validation only) |
|---|---|---|
| Citation | Yfantidou *et al.* (2022) *Sci Data* 9, 663 | Thambawita *et al.* (2020) *ACM MMSys '20*, 231–236 |
| DOI | 10.5281/zenodo.7229547 | 10.17605/OSF.IO/VX4BK |
| Participants | **71** | 16 |
| Duration | 4+ months | 5 months |
| Device | Fitbit Sense | Fitbit Versa 2 + PMSys |
| **Licence** | **CC BY 4.0** | **CC BY-NC 4.0** |

**Integrity:** `lifesnaps_rais_anonymized.zip`, 615,037,493 bytes, **MD5 `726afe263ab4b900a721eac19b2ca13a` matched the published value**. SHA-256 pinned in `data/raw/PROVENANCE.json` with retrieval timestamp.

**⚠️ Licence constraint that must appear in the report.** PMData is **non-commercial**. The
report proposes a monetisation model (§1). These must not contradict each other:

> *The commercial pathway rests on the CC BY-licensed LifeSnaps cohort. PMData is used
> exclusively for non-commercial academic validation; a commercial deployment would
> require separate licensing or retraining without it.*

**What the pivot changed:**

| | Original plan | Now |
|---|---|---|
| Participants | 1 | **71** (+16) |
| Split | chronological only | **participant-wise** + chronological |
| Generalisation claim | not possible | cross-dataset (two cohorts) |
| Demo | dependent on live sync | deterministic replay |

Cost: the personal *n*=1 novelty, and the within-subject before/after effectiveness study (see E-008).

**→ §3.4 Methodology · §5.4 limitations · reference list**

---

## E-004 · Synthetic data — scope and the wall around it

**Simulator** (`ml/simulate.py`) generates **only**: `task_density` (no wearable dataset
contains a task list), demo/seed data, an online-learning drift scenario, and edge-case
fixtures.

**Generative model — Appendix B:** two-process model of sleep regulation (Borbély, 1982) —
Process C, a ~24 h circadian oscillator whose phase is offset per participant by a
chronotype parameter after Roenneberg; Process S, homeostatic pressure as saturating
growth in hours awake, scaled by accumulated sleep debt. Modifiers: post-lunch dip, stress
coupling, a direct restedness term. Gaussian observation noise. **Seeded RNG** (`--seed 7003`).

**The wall — this is the important part:**

> Simulator output **must never enter model training**. If it did, the model would learn
> the rules written in `simulate.py`, and every metric in §5 would be circular — measuring
> nothing but the simulator's own assumptions. There would be no error and no warning.

Enforced in code, not by convention: `ml/provenance.py` makes data origin a **column**;
`assert_measured()` rejects any frame containing synthetic or **untagged** rows;
`ml/tests/test_no_synthetic_in_training.py` (9 tests) runs in CI.

**Calibration record — the generative model was wrong on the first pass:**

| Signal | First draft | Corrected | Why it mattered |
|---|---|---|---|
| `hour_of_day` correlation | **−0.87** | −0.41 | Focus decayed monotonically all day; a model would learn only "later is worse" |
| `sleep_duration` correlation | 0.02 | **0.53** | Sleep had no effect — absurd for a sleep-driven app |
| `deep_sleep_min` correlation | 0.09 | **0.65** | — |
| `task_density` correlation | 0.56 | **0.23** | Was nearly a copy of the label, flattering any model using it |
| Drift scenario | peak moved **earlier** | moved **later** | Bug: the intended direction was inverted |

**Root cause:** the circadian peak was set to mid-morning, putting the circadian trough at
22:00 where it *compounded* with peak sleep pressure instead of opposing it. Moving the peak
to early afternoon restores the wake-maintenance zone and the realistic plateau-then-decline
profile.

**Known limitation, stated rather than hidden:** the post-lunch dip is present but shallow
(13:00 = 2.93 → 15:00 = 2.87), so the profile reads as plateau-then-decline rather than a
distinct secondary trough. It is **not claimed as a crisp dip anywhere**.

**→ Appendix B · §3.4 · §5.4**

---

## E-005 · Gate 0.9 — the planned label did not exist

**Method:** before committing to Week 8, verify the target carries signal. Inspection of
`hourly_fitbit_sema_df_unprocessed.csv` (159,508 rows, 71 participants).

**Finding — the plan's assumption was wrong.** The plan specified `focus_proxy` as SEMA3
alertness normalised to 1–5. **No such column exists.**

| | |
|---|---|
| Label format | **7 mutually exclusive categories**, one-hot. No row carries more than one |
| Categories | `ALERT` `HAPPY` `NEUTRAL` `RESTED/RELAXED` `SAD` `TENSE/ANXIOUS` `TIRED` |
| Coverage | **5,029 rows = 3.15%** of hourly rows; 63 of 71 participants |
| Per participant | median 65 labelled rows; only 23 exceed 100 |
| `ALERT` frequency | **344** — second-rarest category |

**Consequence: the task is classification, not regression.** No intensity scale exists, so
MAE/RMSE/R² are not available. Metrics become **F1 / precision / recall / confusion matrix / ROC-AUC**.

**→ §3.4 · §5.4 · §5.1 (metric choice justification)**

---

## E-006 · Target selected empirically — the finding that mattered

**Method** (`ml/notebooks/01_gate_label_signal.py`): four binary target constructions × three
feature sets × three models, under **5-fold GroupKFold** (participant-wise — no individual
in both train and test). A first pass using one held-out split of 11 participants returned
0.52–0.55; that estimate was replaced because it was too noisy to conclude from.

**Result — the target definition dominated the model choice:**

| Target | Axis | n | Best ROC-AUC |
|---|---|---|---|
| **`energy` — ALERT+HAPPY vs TIRED+SAD** | **activation** | 2,356 | **0.654 ± 0.028** |
| `not-tired` — all vs TIRED | activation | 4,976 | 0.629 ± 0.024 |
| `valence` — pleasant vs unpleasant | valence | 4,976 | 0.568 ± 0.025 |
| `strict` — ALERT+RESTED vs TIRED+TENSE | mixed | 3,206 | 0.553 ± 0.027 |

**The construction that looked most obviously "focus-like" (`strict`) scored worst of the
four, at essentially chance.**

**Why the activation axis wins — the theoretical result:** under **Russell's circumplex
model**, affect decomposes into *valence* (pleasant–unpleasant) and *arousal*
(activated–deactivated). Wearables measure the physiological correlates of arousal — heart
rate, HRV, sleep pressure, movement — and have **no privileged access to valence**. The axis
the sensors can reach is therefore the one that works, and the near-chance `valence` row is
the same finding stated negatively.

### ⚠️ Two findings that cut against the project's own premise

**(1) The biometrics contribute almost nothing.**

| Feature set | ROC-AUC |
|---|---|
| time-only (hour, weekday, weekend) | 0.609 |
| biometric (sleep, resting HR, HRV, stress, steps…) | 0.611 — **+0.002** |
| **biometric + location context** | **0.654** — **+0.043** |

Location context contributes ~20× what the entire biometric block does. This **qualifies the
project's central premise** that wearable sensing is the primary route to the prediction.
Context is legitimately available at inference (geofencing, W10.12) — but the report must not
claim the wearable signals are carrying this model.

**(2) Logistic regression beat gradient boosting in almost every configuration.**
45 participants is too few for boosted trees. Two consequences — the honest one: a linear
model is correct at this sample size. The useful one: a logistic regression exports to
`coefficients.json` and runs in TypeScript, so the **< 50 ms on-device NFR is trivially met
and TFLite is not needed for this model** (still needed for MoveNet, W10.2).

**Honest framing required:** 0.654 sits just above the conventional 0.60 deployment floor.
The model is a **weak predictor** and must be described as one.

**→ §5.4 (headline ML result) · §6 future work · §4.2 (model choice) · §2 (circumplex citation)**

---

## E-007 · Data-quality corrections

Three issues found on inspection. Each would misrepresent the data if left unstated:

| # | Issue | Handling |
|---|---|---|
| 1 | `sleep_duration` is in **milliseconds**, not minutes (median 27.5 M ms ≈ 7.63 h) | converted |
| 2 | **125 nights physiologically implausible** — range runs 1.0 h to 20.7 h | **dropped, not clipped** — clipping invents a plausible value where none was measured |
| 3 | **`sleep_deep_ratio` is not a fraction** — median 0.986, max 4.31, **1,567 values > 1** | ratio between sleep stages, not a proportion. **Must never be reported as "percentage of deep sleep"** |

**Feature coverage after the `(participant, date)` join** — final model frame, n = 2,356:

| Feature group | Coverage |
|---|---|
| time + location context (11 features) | **100%** |
| `calories` | 97.5% |
| `resting_hr`, `resting_hr_delta_7d` | 88.0% / 87.5% |
| `steps`, `distance`, `bpm` | ~84% |
| `sleep_efficiency`, `sleep_hours` | 80.9% / 78.4% |
| `sleep_deep_ratio`, `sleep_rem_ratio` | 76.7% |
| `nremhr`, `rmssd` | 55.1% |
| `stress_score` | **49.3%** |
| `spo2` | **35.7%** |

`stress_score` retained despite ~49% coverage: requiring it would cut the usable set from
4,012 rows / 57 participants to 2,098 / 29. It is imputed, and the imputation is reported.

**→ §5.4 · Appendix C**

---

## E-008 · Evaluation redesign — effectiveness axis

The planned within-subject before/after effectiveness study **is no longer possible**: it
required the author generating personal data across the whole project timeline.

| | Replacement measure | Axis |
|---|---|---|
| **E1** | **Retrospective policy evaluation** — on held-out participants: does the hour the model recommends coincide with that person's actually-best hour? Hit-rate @1/@3 vs random and fixed-09:00 baselines | Effectiveness — **real human data** |
| **E2** | **SUS (n=5)** + task completion times + Nielsen heuristic walkthrough — needs no wearable, **unchanged from the original plan** | Usability |
| **E3** | **Cross-dataset generalisation** — LifeSnaps-trained → PMData. Degradation expected; **reporting the number is the point** | ML rigour |

**Still possible** from app telemetry (no biometrics needed): suggestion acceptance rate
(SDT autonomy check), posture slips/hr with AR coach on vs off.

**No longer possible:** self-reported focus before/after · schedule adherence · illness
warning precision. All three need months of personal logging.

**Required §5 wording:**

> *Effectiveness is evaluated retrospectively on held-out participants rather than
> prospectively on the author, because the data strategy (§3.4) precluded a within-subject
> design. E1 measures agreement with past behaviour, not causal improvement.*

**⚠️ PMData cannot serve as the planned fallback target.** Its self-report is **daily**, so it
cannot support an hour-of-day model — which is AuraFlow's central claim. Its role narrows to
validating the **daily** Recovery Score, where `readiness` is a directly labelled comparator.

**→ §5.3 · §5.4 · Appendix C**

---

## E-009 · Architecture consequence — `ReplayHealthProvider`

The `HealthProvider` Adapter (W6.9) gains a third implementation replaying a cohort
participant's timeline in real time:

```
HealthProvider
├─ HealthConnectProvider   Android
├─ HealthKitProvider       iOS (stub)
└─ ReplayHealthProvider    NEW — deterministic cohort replay
```

Two report-relevant benefits: it strengthens the **design-patterns table (LO3)** with a third
concrete Adapter implementation, and it makes the **presentation demo deterministic** —
no live watch sync to fail on stage. To be recorded as **ADR-0006**: a design decision, not a
limitation.

**→ §4.2 design patterns · §5 demo reliability**

---

## E-010 · Automated test evidence

**41 tests passing.** Not incidental — each suite guards a specific way this project could
produce good-looking numbers that mean nothing:

| Suite | Tests | Guards against |
|---|---|---|
| `test_no_synthetic_in_training.py` | 9 | Simulated rows reaching training → circular metrics |
| `test_split.py` | 12 | Participant leakage (model memorises a person) and temporal leakage (predicting the past having seen the future) |
| `test_baselines.py` | 10 | A model reported without the baselines it must beat |
| `test_labels.py` | 10 | Target definition drifting from the one that was validated |

**→ §5.1 functional testing · Appendix C · screenshot the passing run for evidence**

---

## E-011 · Reproducibility (Appendix A)

```bash
python -m venv .venv && .venv\Scripts\activate
pip install -r ml/requirements.txt

python ml/download_data.py              # checksum-verified fetch, resumable
python ml/ingest_lifesnaps.py           # extracts CSVs only (skips the 9.6 GB BSON)
python ml/build_features.py             # -> data/processed/lifesnaps_model_frame.parquet
python ml/notebooks/01_gate_label_signal.py
python -m pytest ml/tests -q
```

- Raw data **not committed** — fetched from the canonical source so provenance and the
  licence chain stay verifiable. `data/raw/PROVENANCE.json` records URL, SHA-256, byte count
  and retrieval time per file.
- All randomness seeded (`--seed 7003`).
- No MongoDB required: the 9.6 GB BSON dump is never touched.

**Final model frame:** 2,356 rows · 45 participants · 47.0% positive · 25 features ·
span 2021-04-22 → 2022-01-16.

**→ Appendix A**

---

## E-012 · Model trained and evaluated against baselines

**Method:** 5-fold participant-wise cross-validation is the **headline estimate** — every
participant held out exactly once, so the number does not depend on who landed in one test
split. A separate held-out split provides the confusion matrix and the shipped model
(pooling a confusion matrix across folds would mix five different models).

### Headline result — §5.4 table

| Model | ROC-AUC | ± | F1 | Accuracy | Precision | Recall |
|---|---|---|---|---|---|---|
| **logistic regression** | **0.656** | 0.027 | 0.543 | 0.618 | 0.620 | 0.503 |
| MLP (16, 8) | 0.626 | 0.038 | 0.526 | 0.596 | 0.588 | 0.490 |
| hour-of-day lookup *(baseline)* | 0.599 | 0.039 | 0.443 | 0.572 | 0.588 | 0.374 |
| base rate *(baseline)* | 0.500 | 0.000 | 0.000 | 0.530 | 0.000 | 0.000 |
| personal rate *(baseline)* | 0.500 | 0.000 | 0.000 | 0.530 | 0.000 | 0.000 |

**Logistic regression beats the best baseline by 0.057 AUC.**

**The MLP lost.** 0.626 vs 0.656 — it beats the baseline by 0.026 but is beaten by the
linear model. This is reported rather than dropped: the plan proposed a neural network, it
was tried, and ~2,400 rows across 45 participants do not support one. The same thing
happened to gradient boosting at the gate stage (E-006). **Consistent evidence that sample
size, not model capacity, is the binding constraint.**

**`personal-rate` scoring exactly 0.500 is a leakage check that passed** — under a
participant-wise split every test participant is unseen, so a per-person lookup *must*
collapse to the base rate. Any value above 0.5 would mean participants were crossing the
split.

### Held-out participants (n = 440 rows, 9 unseen people)

`AUC 0.674 · F1 0.583 · accuracy 0.659 · precision 0.640 · recall 0.536`

```
                 predicted
                 not-ready  ready
actual not-ready      185     59
       ready           91    105
```

**Recall 0.536 is the weak spot** — the model misses 91 of 196 genuinely focus-ready hours
at the default 0.5 threshold. For a scheduling assistant, a missed good hour is a cheaper
error than a recommended bad one, so the threshold is defensible, but the asymmetry should
be stated rather than left for a reader to compute.

### What the model learned — interpretable output for §4/§5

```
learned circadian peak    09:26
learned circadian trough  21:26
amplitude (standardised)  0.364
```

Recovered by decoding the two cyclical hour coefficients back into a single sinusoid. A
mid-morning peak is consistent with the chronobiology literature, which is a useful
external check: the model was not told this, it was fitted.

**Strongest standardised coefficients:**

| Feature | Coefficient | |
|---|---|---|
| `ENTERTAINMENT` | +0.376 | → ready |
| `HOME` | −0.340 | → not ready |
| `hour_cos` / `hour_sin` | −0.285 / +0.226 | circadian phase |
| `sleep_rem_ratio` | +0.223 | → ready |
| `OUTDOORS` | +0.220 | → ready |
| `resting_hr` | +0.212 | → ready |
| `WORK/SCHOOL` | −0.170 | → not ready |

**Two things to state honestly in the report:**
- **Location dominates again.** Four of the top eight are context, consistent with E-006.
  `WORK/SCHOOL` being *negative* is a notable finding in its own right.
- **`resting_hr` positive is physiologically counter-intuitive.** Higher resting heart rate
  predicting readiness is likely confounded with time-of-day and activity. **Do not
  interpret this coefficient causally** — flag it as a limitation.

### Collinearity correction — before/after

The first run produced an uninterpretable coefficient table. Diagnosed and fixed:

| Problem | Evidence | Fix |
|---|---|---|
| `steps` ↔ `distance` | **r = 0.986**, VIF **42 / 40**; coefficients −0.839 / +0.823 (near-equal, opposite) | dropped `distance` |
| All 8 context one-hots | **VIF = ∞** — complete set summing to 1, collinear with the intercept (dummy-variable trap) | `OTHER` held out as reference |
| `hour_of_day` as integer | 23:00 and 00:00 treated as 23 units apart; a linear model cannot fit a rhythm | **cyclical sin/cos encoding** |
| `day_of_week` ↔ `is_weekend` | r = 0.783 | cyclical encoding + `is_weekend` |

| | Before | After |
|---|---|---|
| logistic AUC (CV) | 0.654 | **0.656** |
| MLP AUC (CV) | 0.613 | **0.626** |
| Held-out F1 | 0.524 | **0.583** |
| Held-out recall | 0.449 | **0.536** |
| Largest coefficient | 0.839 *(artefact)* | 0.376 *(real)* |

AUC barely moved; **interpretability and recall moved a lot**. Worth reporting: the fix
was not about the headline metric.

### A correctness fix found by a test

`resting_hr_delta_7d` originally computed its baseline with `rolling(7)` **including the
current day**. A test expecting a clean +10 deviation returned 8.57, exposing it. Including
today lets the reading pull its own reference: a single elevated day is damped by 6/7, and
across a multi-day illness the baseline climbs with the symptom until the anomaly vanishes
into it. Now uses `shift(1)` — today against the *preceding* seven days.

**This matters beyond this feature:** the illness-warning feature (W8.13) depends entirely
on this signal.

### Deployment artefact

`ml/artifacts/focus_model_coefficients.json` — **2,433 bytes**, tracked in git so the exact
deployed coefficients are tied to the commit that produced them.

The **whole pipeline** is exported (imputer medians, scaler mean/std, coefficients,
intercept), not just the coefficients — without the transform parameters the device cannot
reproduce what the model was fitted on and would silently score garbage.

```
z = Σ coefficients[i] × (x[i] − mean[i]) / std[i] + intercept
p = 1 / (1 + exp(−z))
```

**No TFLite needed for this model.** The < 50 ms NFR (W1.9) is met by orders of magnitude.
TensorFlow is still required for MoveNet (W10.2), which is a different model.

**→ §5.4 headline result · §4.2 model choice · §5.2 performance NFR · Appendix C**

---

## Open items

| | Item | Owner |
|---|---|---|
| 🔴 | **P0.6** Moodle deadline confirm + reverse-plan | Navod |
| 🟠 | **P0.8** BLE screenshots + `0x180A` device values (E-002) | Navod |
| 🔴 | **W1.1–W1.3** user survey — responses need ~1 week, start early | Navod |
| 🟠 | PMData download + confirm daily granularity (E-008) | code |
| 🟠 | ADR-0006 `ReplayHealthProvider` (E-009) | code |
| 🟠 | E1 retrospective policy evaluation — hit-rate @1/@3 (E-008) | code |
| 🟢 | Threshold tuning — recall 0.536 at 0.5 (E-012) | code |
| 🟢 | `resting_hr` positive coefficient — investigate confound (E-012) | code |

---

## Changelog

| Date | Entries |
|---|---|
| 2026-08-11 | E-001 … E-011 — repository, data pivot, Gate 0.9, ingest pipeline |
| 2026-08-11 | E-012 — model trained; logistic 0.656 beats MLP 0.626 and all baselines; collinearity corrected; `resting_hr_delta_7d` baseline fixed |
