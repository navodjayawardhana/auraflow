# AuraFlow — final week: dashboard, BLE, AR movement coach

## Context

Phases 1–5 are done and running on a physical device: seeded data (recovery score 75 live), the rebrand around the new animated logo, offline-first caching with a write outbox, an on-device logistic-regression focus model with golden-vector tests, and live IoT biometrics over MQTT (verified today: `hr_bpm: 113`, `spo2_pct: 99`, lamp commands, retained state). 127 tests pass (77 API + 50 mobile). Three ADRs are written.

Three things remain, driven by what the user asked for:

1. **The dashboard is too thin.** They want it closer to the Huawei Health app, and chose to **add new metrics** (steps, calories, water) rather than only re-cutting existing data.
2. **BLE.** They want it to behave like a fitness watch. The ESP32 firmware side was written today (`iot/auraflow-node/ble.h`/`ble.cpp` — standard Heart Rate Service `0x180D` plus a custom AuraFlow service) but **has not been flashed**, and the app side does not exist.
3. **An AR + ML exercise feature**, with the concept left to be chosen against the assignment brief.

**Constraint: one week, essentials only.** That is the single most important input to this plan — it sets the AR scope at one working exercise rather than a suite, and it decides the storage design in Phase 7 (extend the existing aggregate rather than build a new one).

**Sequencing decision the user made:** dashboard first, while the app still runs in Expo Go; then the EAS development build, which unlocks BLE and the camera together. Adding any native module ends Expo Go compatibility, so that boundary is crossed once, deliberately, at the start of Phase 8.

## Why this AR concept (the part the user delegated)

The brief asks for a companion that is "context-aware and adaptive", and the rubric pays for **originality (5)**, **smart functionality (5)** and **advanced features — sensors, cloud (3)**, with "extended reality" named explicitly as an expected discussion point.

A generic rep counter scores badly on originality: it is a solved, shipped, unremarkable thing. So the feature is a **recovery-gated, camera-guided movement session**, where the three technologies already in the project each answer a different question:

| Question | Answered by | Already built? |
|---|---|---|
| *What* should I do today? | Recovery score (rule-based, validated against PMData) | yes |
| *How* am I doing it? | MoveNet pose landmarks → joint angles | Phase 9 |
| Does my body *agree*? | Live HR from the node over BLE | Phase 8 |

That is adaptive rather than prescriptive, it is a direct expression of the tagline "work with your body, not against it", and it reuses the recovery model as an input to a second feature rather than leaving it as a number on a screen. It is also the honest answer to "why does this app have an IoT node at all".

## Phase 7 — Dashboard with real new metrics (~2 days, still Expo Go)

**Goal:** a Today screen that reads like a health app rather than one card, with metrics that are genuinely measured where they can be and clearly labelled where they cannot.

### Storage: extend the existing aggregate, do not build a new one

`health_snapshots` is already "one user's health signals for one day", keyed unique on `(user_id, recorded_on)`. Steps and water are exactly that. Adding a `daily_metrics` table would duplicate the key, the repository, the mapper, the use case and the endpoint for no conceptual gain — and with a week left, that cost buys nothing.

- **Migration** — add nullable `steps` (integer) and `water_ml` (integer) to `health_snapshots`.
- **Domain** — extend `DailyHealthSnapshot` with the two optional values. Steps and water are not vital signs, so they do not need value objects with the ceremony `SleepSummary` has; a plain nullable int with a range check in the form request is proportionate. Say so in a comment rather than leaving the asymmetry unexplained.
- **Mapper / repository** — `DailyHealthSnapshotMapper::toEloquentAttributes` and `toDomain` carry the new fields. **Do not change the `whereDate` matching in `EloquentDailyHealthSnapshotRepository::save()`** — the `recorded_on` date cast carries a time component that plain equality misses, which is exactly the bug that broke idempotency earlier.
- **Form request** — `steps` 0–100000, `water_ml` 0–20000, both nullable. Keep `recorded_on` `before_or_equal:today`.
- **Calories are derived, never stored.** `kcal ≈ steps × 0.04` for an average adult stride and mass. That is a population estimate, not a measurement, and the UI must label it as such — the same discipline the focus model's disclosure card already follows.

### Mobile

- **`expo-sensors` Pedometer** (`npx expo install expo-sensors`) — real step count, works in Expo Go, needs `ACTIVITY_RECOGNITION` on Android 10+. Request the permission with an honest rationale string; handle refusal by hiding the card rather than showing a zero.
- **`src/services/metrics-service.ts`** — read today's step count, and a `useSteps()` hook that subscribes to live updates.
- **`src/ml/focus-features.ts`** — feed the real step count into the `steps` feature. **This is the payoff worth calling out in the report**: the focus model goes from 9/25 to 10/25 real inputs, and `model-disclosure.tsx` will say so automatically because it reads the count rather than hardcoding it.
- **Water** — a small logger (tap to add 250 ml, daily target 2000 ml), written through the existing **outbox** so it works offline like every other write.
- **`src/components/metric-card.tsx`** (new) — one reusable tile: icon in an `IconTones` badge, big value, unit, optional progress ring or bar, optional footnote. Everything on the dashboard grid is this component, which is what will make the screen read as designed rather than assembled.
- **`src/components/sleep-breakdown.tsx`** (new) — deep / REM / light as a stacked bar. **The data is already in `health_snapshots` and has never been shown**; light is derived as `total − deep − rem`.
- **`src/app/(app)/index.tsx`** — restructure to: greeting → recovery hero ring → metric grid (steps, calories, water, resting HR, sleep) → sleep breakdown → focus forecast. Keep the `useCachedResource` + `OfflineBanner` pattern; no screen gets a new loading idiom.

**Verify:** `php artisan test` and `npm test` stay green; `npm run typecheck`; on the phone, walk a few steps and watch the tile move; log water offline and confirm it queues then lands; confirm the disclosure card now says 10 of 25.

## Phase 8 — Android dev build + BLE (~2 days)

**Goal:** the node pairs and streams like a wearable, with no network in the loop.

### The build boundary — crossed once, deliberately

Adding a native module ends Expo Go. Android makes this cheap: no Apple account, no expiry, a plain installable APK.

- **`eas.json`** — a `development` profile with `developmentClient: true`, `distribution: internal`, `android.buildType: apk`.
- Run `eas build --profile development --platform android` once (~15–20 min), install the APK, then develop with `npx expo start --dev-client` instead of `--go`. **A new native module means a new build** — batch Phase 8 and Phase 9's native dependencies into that single build to avoid paying the cycle twice.
- **`app.json`** — plugin config and Android permissions: `BLUETOOTH_SCAN` (with `neverForLocation`), `BLUETOOTH_CONNECT`, and `ACCESS_FINE_LOCATION` only for the legacy path (Android 11 and below). Camera permission goes in the same build for Phase 9.

### App side

- **`react-native-ble-plx`** with its Expo config plugin.
- **`src/services/ble-client.ts`** — the only file importing the BLE library, mirroring how `mqtt-client.ts` isolates MQTT. Scan filtered by the Heart Rate Service UUID `0x180D`, connect, subscribe to HR Measurement `0x2A37` and the AuraFlow vitals characteristic, write the lamp characteristic. Parse the standard HR frame (flags byte, then uint8 bpm) — that layout is already what the firmware emits.
- **`src/hooks/use-live-vitals.ts`** (new) — **the piece that keeps the UI simple.** The app now has two paths to the same node. This hook exposes one reading with an explicit `source: 'ble' | 'mqtt' | null`, preferring BLE when a BLE connection is live and falling back to MQTT otherwise, with a short hold-off so a flapping BLE link cannot make the number flicker between sources. Screens consume the hook and never learn which transport won. `live-biometrics-card.tsx`, `device.tsx` and the Today screen all switch to it.
- **`src/components/device-picker.tsx`** — gains a real BLE scan (with a scanning state and a permissions-denied state) beside the existing MQTT discovery, presented as "nearby" versus "remote" rather than as two unrelated lists.
- **Flash the firmware** — `ble.h`/`ble.cpp` and the `BIO_PUBLISH_MS` 5000→1500 change are written but not on the board. Nothing in this phase works until it is flashed. Watch free heap after flashing: BLE and Wi-Fi coexisting on an ESP32 is tight, and the node reports `heap_free_b` on its device topic, so the diagnostics card already shows the number to watch.

**Verify:** with Wi-Fi off on the phone, scan → the node appears → connect → HR updates at ~1 Hz; a generic BLE heart-rate app also reads it (proof the standard service is correct, and independent confirmation the values are right); the lamp responds over BLE; killing BLE falls back to MQTT without the reading jumping.

## Phase 9 — AR movement coach, one exercise (~2 days)

**Goal:** a working, honest demo — not a suite. One exercise, counted correctly, with the recovery gate and the IoT hook wired.

- **`react-native-vision-camera` + `react-native-fast-tflite`**, MoveNet Lightning as a bundled `.tflite`. **Check `react-native-worklets-core` against the installed `react-native-worklets@0.5.1` and `react-native-reanimated@4.1.1` before building** — that trio is the most likely version conflict in this plan. Fallback if they clash: run inference on periodic still captures (~4 fps) instead of a frame processor. Slower, visibly adequate for squats, and it removes the worklets dependency entirely.
- **MoveNet is Google's, pre-trained, used as-is.** The README already says so; the report must repeat it, and the disclosure card must too. Nothing here claims a model was trained.
- **The exercise: bodyweight squat.** Chosen because the knee angle is the largest, most unambiguous signal a single front-facing camera can see; it needs no equipment; and it suits a recovery-gated prescription at every intensity. One exercise done properly beats three done unreliably, and with a week left that is not a close call.
- **`src/ml/rep-counter.ts`** (new) — a joint-angle state machine, **not** a second model. Knee angle from hip–knee–ankle landmarks; `standing → descending → bottom → ascending → standing` with hysteresis thresholds (e.g. bottom below 100°, standing above 160°) so jitter near a boundary cannot double-count. Explainable, cheap, and **unit-testable with golden angle sequences** — which matters directly, testing being 10 marks.
- **Form check: depth only.** One check, genuinely measurable from 2D landmarks. Explicitly *not* knee valgus or spinal position — a single 2D camera cannot see those reliably, and claiming otherwise in a health app is exactly the overclaiming this project has avoided elsewhere.
- **Recovery gate** — `src/ml/session-prescription.ts` (new): score ≥ 70 → full set; 50–69 → reduced; < 50 → mobility and breathing only, with the reason shown. This is the "context-aware and adaptive" requirement, expressed as a rule the user can read rather than a black box.
- **IoT hook** — on a form slip, publish the lamp's existing `alert` mode. The firmware already implements it and nothing currently triggers it; this closes that loop for free.
- **Persistence** — `exercise_sessions` (user, date, exercise, reps, good-form reps, duration, mean HR), following the same DDD layering, with `POST /api/v1/exercise-sessions` written through the **existing outbox** so a session logged in a basement is not lost.
- **`src/app/(app)/move.tsx`** (new, non-tab, `href: null`, reached by `router.push` from a Today card) — camera preview, skeleton overlay, rep count, live HR from `use-live-vitals`, and a disclosure card in the same shape as `model-disclosure.tsx`.

**Verify:** `npm test` covers the rep counter's golden sequences and the prescription thresholds; on the phone, ten squats count as ten; a shallow rep is flagged and the lamp pulses; the session appears in history; airplane mode queues it.

## Phase 10 — Report evidence (~1 day, alongside)

- **ADRs** for the two decisions this plan makes: extending `health_snapshots` rather than adding `daily_metrics`, and BLE-preferred-with-MQTT-fallback as a dual-transport design.
- **Fix the stale README** — it currently claims Reverb, an `LlmService` and a TFLite export, none of which exist. An examiner who checks will find the gap; correcting it costs ten minutes and protects the credibility of everything that *is* true.
- **One architecture diagram** in `docs/diagrams/` showing app / Laravel / broker / node, and marking which paths survive an offline device. That single diagram carries most of the System Architecture marks.
- Screenshots per feature for the UI/UX evidence.

## Risks, and what to do about them

- **Worklets version conflict** (highest) — fallback to periodic still-capture inference, above.
- **Dev-build cycle time** — batch every native dependency (BLE, camera, TFLite) into one build.
- **ESP32 heap with BLE + Wi-Fi** — watch `heap_free_b` on the diagnostics card after flashing; if it is tight, drop the OLED's frame rate before dropping either radio.
- **Pose accuracy in a small room** — MoveNet needs the whole body in frame. Test the demo space early; if it is too tight, the fallback exercise is a seated shoulder press, where only the upper body must be visible.
- **One week** — Phases 7 and 8 are the ones that must land. If Phase 9 slips, ship the rep counter and its tests without the camera and describe the integration as future work; the golden-sequence tests still evidence the logic.
