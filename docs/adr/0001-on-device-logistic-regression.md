# 1. Run the focus model on the device, in TypeScript

Date: 2026-08-21

## Status

Accepted.

## Context

The trained focus-readiness model exists at `ml/artifacts/focus_model_coefficients.json`
but nothing consumes it — neither the Laravel API nor the mobile app reads it. It needed
a home.

The project README describes an on-device TFLite MLP. That is out of date:
`ml/train.py` trains an `MLPClassifier` only for comparison inside cross-validation, and
exports the **logistic regression** instead (`train.py:253` notes explicitly that no
TFLite export is needed). What ships is a scikit-learn pipeline of
`SimpleImputer(median) → StandardScaler → LogisticRegression`, holdout ROC-AUC 0.674.

Three placements were possible:

1. A Python microservice the API calls.
2. A PHP port inside the Laravel domain, as was already done for the rule-based recovery
   score.
3. A TypeScript port running on the phone.

The deciding constraint came from the product side: the app must work offline. Anything
behind the API stops working the moment the device does, and a wellbeing app that cannot
tell you anything on a plane or in a basement is answering the wrong question.

## Decision

Port inference to TypeScript and run it on the device (`mobile/src/ml/focus-model.ts`),
bundling the artifact as `mobile/assets/models/focus-model.json`.

The artifact documents its own inference contract —
`z = Σ coef[i]·(x[i] − scale_mean[i]) / scale_std[i] + intercept`, then a sigmoid, with
missing inputs replaced by `impute_median[i]`. That is roughly forty lines of arithmetic.
No ML runtime is involved, which also means no native module and no loss of Expo Go
compatibility.

Two safeguards make the copy trustworthy:

- **`mobile/scripts/check-model-sync.mjs`** compares a SHA-256 of the bundled copy
  against `ml/artifacts/`. Metro cannot import above the project root, so a copy is
  unavoidable; the check makes divergence loud rather than silent. It runs as part of
  `npm run check`.
- **Golden-vector tests** (`mobile/src/ml/__tests__/focus-model.test.ts`) pin three
  probabilities computed in Python directly from the artifact, asserted to 1e-6. A
  transposed coefficient or a re-ordered feature fails there and nowhere else.

## Consequences

**Good.** Predictions work with no network at all, cost nothing per request, and leak no
health data to a server to be computed. The whole path — artifact, port, test — is
inspectable in one afternoon.

**Bad.** Retraining now requires re-copying the artifact and re-deriving the golden
vectors. The sync check turns that from a silent failure into a build failure, but it is
still a manual step.

**Limits worth stating plainly.** Only 9 of the model's 25 features come from this app's
own data today (five from the clock, four from the user's recorded nights); another two
arrive when the IoT node is connected, and seven more if the user sets their location.
Six — `steps`, `calories`, `stress_score`, `sleep_efficiency`, `nremhr`, `rmssd` — are
permanently imputed to the training-set median, because the app has no pedometer,
calorimeter, HRV or stress feed. The UI reports that count rather than hiding it, and
labels the feature "experimental": an ROC-AUC of 0.674 against a mood-derived proxy is a
real signal but a weak one, and presenting it as a measurement would be overclaiming.
