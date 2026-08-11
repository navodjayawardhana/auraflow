# AuraFlow — An AI-Driven Smart Lifestyle Companion

> **CMP 7003 — Emerging Mobile Applications** · Cardiff Metropolitan University / ICBT
> PRAC1 (practical + 3000-word report, 75%) · PRES1 (presentation, 25%)

A cross-platform mobile application that combines **wearable biometric data**, **on-device machine
learning**, **large language models**, **augmented reality** and a **custom IoT node** to help users
schedule work around their own physiological readiness rather than the clock.

---

## The intelligence split

The system deliberately uses two different kinds of AI, chosen per problem shape:

| Problem | Approach | Runs |
|---|---|---|
| **Numbers** — predicting focus from sleep, HR, stress, time of day | Trained MLP → TFLite | **On device** (edge AI, < 50 ms) |
| **Words** — parsing "remind me to call mum tomorrow evening", weekly digests | LLM (Claude / Gemini) | Server-side |
| **Pixels** — posture estimation from the camera | MoveNet Lightning (pre-trained, **not ours**) | **On device**, frames never leave |

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
`ml/tests/test_no_synthetic_in_training.py` enforces it in CI.

Full provenance, the `focus_proxy` label derivation and its limitations: **[`docs/DATASET.md`](docs/DATASET.md)**.

---

## Repository layout

```
auraflow/
├─ mobile/     React Native (Expo Dev Client) + TypeScript strict
├─ api/        Laravel 11 · Sanctum · Reverb · queues · LlmService
├─ ml/         Python — ingest · features · baselines · train · TFLite export
├─ iot/        ESP32 firmware (auraflow-node) + BLE/HR analysis scripts
├─ docs/       requirements · design · adr · diagrams · test-evidence · report
└─ data/       raw/ + processed/  (gitignored — fetched via ml/download_data.py)
```

## Getting started

```bash
# 1. Datasets (≈700 MB, one-time)
python -m venv .venv && .venv\Scripts\activate     # Windows
pip install -r ml/requirements.txt
python ml/download_data.py

# 2. API
cd api && composer install && cp .env.example .env && php artisan key:generate
php artisan migrate --seed && php artisan serve

# 3. Mobile
cd mobile && npm install && npx expo start --dev-client
```

> ⚠️ AR features require a **physical device** — the camera does not work in an emulator.

## Toolchain

Python 3.10 · Node 22 · PHP 8.4 · Laravel 11 · Expo SDK (Dev Client) · MySQL 8 · Redis

---

## Academic integrity

This repository is submitted as individual coursework. Third-party datasets and pre-trained models
are cited in `docs/DATASET.md` and in the report's reference list. **MoveNet is pre-trained by Google
and is used as-is — it was not trained by the author.** AI assistance used during development is
declared in the report's AI-use declaration.

## Licence

Coursework submission — all rights reserved. Third-party datasets and models retain their own
licences as recorded in `docs/DATASET.md`.
