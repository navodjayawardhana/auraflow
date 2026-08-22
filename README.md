# AuraFlow — An AI-Driven Smart Lifestyle Companion

> **CMP 7003 — Emerging Mobile Applications** · Cardiff Metropolitan University / ICBT
> PRAC1 (practical + 3000-word report, 75%) · PRES1 (presentation, 25%)

A cross-platform mobile application that combines **wearable biometric data**, **on-device machine
learning**, **large language models**, **augmented reality** and a **custom IoT node** to help users
schedule work around their own physiological readiness rather than the clock.

---

## The intelligence split

The system deliberately uses three different kinds of AI, chosen per problem shape. Each row says
what actually ships, not what the category usually implies.

| Problem | Approach | Runs |
|---|---|---|
| **Numbers** — predicting focus from sleep, HR, time of day | Logistic regression, trained in scikit-learn, exported as coefficients and re-implemented in TypeScript | **On device**, pure arithmetic — no inference runtime |
| **Words** — the daily brief and the assistant | Gemini, called server-side so the key never reaches a phone | Server-side |
| **Pixels** — squat counting from the camera | YOLO26N-Pose (pre-trained, **not ours**) via ExecuTorch → a joint-angle state machine | **On device**, frames never leave |

Two of those are worth being precise about:

- **There is no neural network on the device and no TFLite.** The focus model is a logistic
  regression whose 25 coefficients live in a JSON file the app bundles. That was a deliberate
  choice — [ADR 0001](docs/adr/0001-on-device-logistic-regression.md) records why, and the app's own
  disclosure UI tells the user how many of the 25 inputs are really theirs rather than a
  training-set median.
- **The rep counter is not a model.** The pose estimator supplies seventeen landmarks; everything
  after that is trigonometry and a hysteresis state machine, so it can be unit-tested with golden
  angle sequences and explained to a user.

---

## Data provenance — read this first

AuraFlow's productivity model is trained on **public, peer-reviewed wearable research datasets**, not
on synthetic data and not on the author's own device.

| Dataset | n | Licence | Role |
|---|---|---|---|
| [**LifeSnaps**](https://doi.org/10.5281/zenodo.6826682) (Yfantidou et al., 2022) | 71 | CC BY 4.0 | **Primary** — training + evaluation |
| [**PMData**](https://osf.io/vx4bk/) (Thambawita et al., 2020) | 16 | CC BY-**NC** 4.0 | Cross-dataset validation only |

A **seeded simulator** (`ml/simulate.py`) generates demo/seed data, task streams and edge-case
fixtures. **Simulator output never enters model training** — `ml/train.py` asserts against it, and
`ml/tests/test_no_synthetic_in_training.py` enforces it.

Full provenance, the `focus_proxy` label derivation and its limitations: **[`docs/DATASET.md`](docs/DATASET.md)**.

---

## Repository layout

```
auraflow/
├─ mobile/     React Native (Expo SDK 54) + TypeScript strict + expo-router
├─ api/        Laravel 13 · Sanctum · SQLite · queued jobs · GeminiClient
├─ ml/         Python — ingest · features · baselines · train · coefficient export
├─ iot/        ESP32 firmware (auraflow-node, auraflow-light) + analysis scripts
├─ docs/       requirements · design · adr · diagrams · test-evidence · report · plans
└─ data/       raw/ + processed/  (gitignored — fetched via ml/download_data.py)
```

The API follows a DDD layering (`Domain` / `Application` / `Infrastructure` / `Http`) for the
wellbeing aggregate, and a deliberately thinner slice for append-only lists such as meals and
exercise sessions. The reasoning for that split is in the code comments at each boundary.

## Getting started

```bash
# 1. Datasets (≈700 MB, one-time)
python -m venv .venv && .venv\Scripts\activate     # Windows
pip install -r ml/requirements.txt
python ml/download_data.py

# 2. API
cd api && composer install && cp .env.example .env && php artisan key:generate
php artisan migrate --seed && php artisan serve --host 0.0.0.0

# 3. Mobile
cd mobile && npm install
npx expo start                                     # dev build (camera / BLE)
```

`mobile/.env.local` needs `EXPO_PUBLIC_API_URL` pointing at the machine's **LAN address**, not
`localhost` — a phone resolves `localhost` as itself.

> ⚠️ The camera and BLE features need a **development build on a physical device**. They are native
> modules, so they do not run in Expo Go and the camera does not work in an emulator. Everything
> else — the dashboard, recovery score, focus forecast, brief, assistant, MQTT biometrics — runs in
> Expo Go.

## Tests

```bash
cd api    && php artisan test      # 138 tests
cd mobile && npm run check         # model-sync + typecheck + 98 tests
```

The mobile suite includes **golden-vector tests** pinning the TypeScript port of the focus model to
figures computed in Python from the exported artifact, and **golden angle sequences** for the rep
counter. `npm run check:model` fails the build if the bundled coefficients drift from
`ml/artifacts/focus_model_coefficients.json`.

## Toolchain

Python 3.10 · Node 22 · PHP 8.3+ · Laravel 13 · Expo SDK 54 (React Native 0.81) · SQLite

---

## Academic integrity

This repository is submitted as individual coursework. Third-party datasets and pre-trained models
are cited in `docs/DATASET.md` and in the report's reference list. **The pose estimator is
pre-trained and used as-is — it was not trained by the author.** The only model trained for this
project is the focus-readiness logistic regression in `ml/`. AI assistance used during development
is declared in the report's AI-use declaration.

## Licence

Coursework submission — all rights reserved. Third-party datasets and models retain their own
licences as recorded in `docs/DATASET.md`.
