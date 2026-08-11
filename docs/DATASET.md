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
| **Duration** | 5 months |
| **Device** | Fitbit Versa 2 + PMSys self-report app |

**Why this cohort.** PMData records subjective wellness on **1–5 scales** — fatigue,
mood, readiness, stress, sleep quality — which is exactly the response scale AuraFlow's
focus rating uses. That makes it a meaningful independent test of whether a model
trained on LifeSnaps transfers, rather than a second sample of the same distribution.
`readiness` additionally provides a ground-truth comparator for the Recovery Score.

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

### 4.1 Derivation

Defined once, in `ml/labels.py`, and imported everywhere else — there is deliberately no
second place where a label can be constructed:

```
LifeSnaps :  focus_proxy  <-  SEMA3 momentary alertness / mood items, normalised to 1-5
PMData    :  focus_proxy  <-  6 - fatigue        (1-5 scale, inverted)
                              cross-checked against `readiness`
```

### 4.2 Justification

Sustained attention is not directly observable in either cohort. Momentary **alertness**
is the closest construct that is: it is measured contemporaneously rather than recalled,
it is captured on a validated instrument, and in the attention literature it is treated
as a precondition for sustained focus. Inverted fatigue is a conventional stand-in for
the same underlying state and gives an independently-collected second view of it.

### 4.3 What this costs — construct validity

**`focus_proxy` is not focus.** Alertness and fatigue are correlates of the capacity to
concentrate, not measurements of concentration. A model that predicts `focus_proxy` well
predicts *self-reported alertness* well; whether that translates into better real-world
scheduling is a separate question that this data cannot answer.

The report must state this plainly in §5.4 rather than let "focus" pass unqualified.
Suggested wording:

> *The target variable is a proxy. Alertness is not focus, but it is the closest
> validated momentary construct available in an openly licensed wearable dataset, and it
> is measured contemporaneously rather than recalled. The model should be read as
> predicting self-reported alertness, and the scheduling feature built on it as acting on
> that proxy.*

### 4.4 Fallback

If exploratory analysis shows the LifeSnaps EMA-derived label carries no signal the
baselines cannot already capture, **PMData's `fatigue`/`readiness` becomes the primary
label** — its 1–5 scale is cleaner and its semantics are closer to the target — with
LifeSnaps demoted to validation. This decision point sits before any model training, and
its outcome is recorded in `ml/notebooks/01-eda.ipynb`.

---

## 5. Features

Derived in `ml/build_features.py`:

| Feature | Source |
|---|---|
| `hour_of_day`, `day_of_week` | timestamp |
| `sleep_duration`, `deep_sleep_min` | nightly sleep stages |
| `resting_hr` | daily resting heart rate |
| `resting_hr_delta_7d` | `resting_hr` minus its trailing 7-day mean — the illness/strain signal |
| `stress` | device stress score |
| `steps_last_3h` | rolling step count |
| `task_density` | **simulated** — see §6 |

> **Concrete field names are filled in from the extracted archives during ingest.** They
> are deliberately not guessed here; this table is updated against the real schema once
> `ml/ingest_lifesnaps.py` runs, so the report never cites a column that does not exist.

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
| **E3** | **Cross-dataset generalisation.** LifeSnaps-trained model evaluated on PMData. Degradation is expected and acceptable — reporting the number is the point. | ML rigour |

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

1. **Construct validity.** The target is a proxy for focus, not focus (§4.3).
2. **Population mismatch.** Neither cohort was recruited as knowledge workers; the
   scheduling use case assumes that population.
3. **Device mismatch.** Models are trained on Fitbit-derived signals and deployed against
   Health Connect data. Vendors compute sleep stages and stress differently, so
   calibration error at deployment is expected and unquantified.
4. **No first-party validation.** Nothing confirms the model transfers to the author's
   own Huawei device — precisely because §2 made that data unobtainable.
5. **`task_density` is simulated**, so any result resting mainly on that feature is weaker
   than one resting on measured signals.
6. **Retrospective evaluation is not a trial.** E1 measures agreement with past behaviour,
   not whether following the recommendation would have improved anything.
7. **Licence asymmetry.** The validation cohort cannot support commercial claims (§3.2).

---

## Changelog

| Date | Change |
|---|---|
| 2026-08-11 | Created. Pivot from first-party Huawei collection to LifeSnaps + PMData; licences verified; simulator scope and training wall defined. |
