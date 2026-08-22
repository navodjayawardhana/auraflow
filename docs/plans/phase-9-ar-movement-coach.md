# AuraFlow — AR movement coach (Phase 9)

## Context

Phases 1–7 are done: offline-first caching with a write outbox, an on-device logistic-regression focus model with golden-vector tests, live IoT biometrics over MQTT, the Huawei-style dashboard, and a full design-system pass over every screen. Phase 8 (Android dev build + BLE) has **not** started — no `eas.json`, no `android/` directory, so the app still runs in Expo Go.

The remaining feature is the **recovery-gated, camera-guided movement session**: one exercise, counted honestly, where the three technologies in the project each answer a different question.

| Question | Answered by | Status |
|---|---|---|
| *What* should I do today? | Recovery score (rule-based) | built |
| *How* am I doing it? | Pose landmarks → knee angle | this phase |
| Does my body *agree*? | Live HR from the node | MQTT today, BLE in Phase 8 |

The quick-actions sheet already has the row (`key: 'move'`, `badge: 'AR'`, `isPrimary`), and `runAction` in `src/app/(app)/_layout.tsx` deliberately routes it to `null` with the comment "not built yet". That is the seam this phase fills.

## The stack decision — this replaces the earlier VisionCamera + TFLite plan

The old plan named `react-native-vision-camera` + `react-native-fast-tflite` + MoveNet, and flagged a worklets version conflict as the top risk. That risk is now **fatal on this project**, and for a different reason than expected:

- VisionCamera **4.x** peer-depended on `react-native-worklets-core`, which collides with Reanimated 4's `react-native-worklets` on Android (duplicate `WorkletsPackage`).
- VisionCamera **5.x** fixed that by moving to Nitro — but its frame processors now require `react-native-worklets` **≥ 0.8**.
- This project is on Expo SDK 54 / RN 0.81.5, pinned to `react-native-worklets@0.5.1` by Reanimated 4.1.1. Worklets 0.12 requires RN 0.83–0.87, so **the pin cannot move without leaving SDK 54.**

So frame processors are off the table. The replacement avoids them entirely:

- **`expo-camera@~17.0.x`** — first-party SDK 54 module. Preview plus `takePictureAsync` on a timer (~3–4 fps), which is ample for squats.
- **`react-native-executorch@0.9.x`** + `react-native-executorch-expo-resource-fetcher` — Software Mansion's on-device runtime. Its `usePoseEstimation` hook exposes **`forward(uri)`** for one-off image inference, so a still capture works directly. Peers are only `react` and `react-native`; the compatibility table lists RN 0.81 and Expo SDK 54 as supported. Model: **YOLO26N-Pose**, 17 COCO keypoints, pre-trained and used as-is.
- **Skeleton overlay** drawn with `react-native-svg` (already installed).

Occluded joints come back as `{ x: -1, y: -1 }`, which maps cleanly onto the honesty discipline the rest of the app already follows.

**This still needs a dev build** — `expo-camera` and executorch are native modules, and adding either ends Expo Go. Batch it with Phase 8's BLE dependency into one build.

## What is already built and green

Everything that does not need the camera is done and tested.

- **`mobile/src/ml/rep-counter.ts`** — knee-angle state machine, not a second model. `unknown → standing → descending`, hysteresis band 140°–160° so jitter cannot double-count, depth judged at ≤ 100°. Shallow reps still count but not as good form. Missing landmarks skip the frame without abandoning the rep. Exports `kneeAngle`, `observe`, `completedShallowRep`, `RepCounterThresholds`.
- **`mobile/src/ml/session-prescription.ts`** — the recovery gate. ≥70 full (15 reps), ≥50 reduced (8), below that mobility only; an illness warning overrides the band regardless of score; no score means *ungated*, not *low*.
- **`mobile/src/services/movement-service.ts`** — `logExerciseSession`, `fetchExerciseHistory`, `newSessionId`.
- **`mobile/src/services/outbox.ts`** — extended from a single-payload queue to a tagged union (`health-snapshot` | `exercise-session`) with a `v2` key and a one-time drain of the `v1` queue so nights logged before the update are not lost.
- **API `exercise_sessions` slice** — migration, model, two form requests, controller, routes. Thin (meals-shaped) rather than full DDD: append-only, no per-day upsert, and its one invariant (`good_form_reps ≤ total_reps`) is expressible at the HTTP boundary, which is the repo's own stated rule for choosing.
- **`client_uuid` idempotency** — the sessions endpoint is append-only, so a replay from the outbox would otherwise create a duplicate. Unique on `(user_id, client_uuid)`; a replay returns the original row.

Tests: **38 mobile ML**, **12 outbox**, **17 API endpoint** — all green. API total 121 → 138.

## What is left

1. **Dev build** — `eas.json` with a `development` profile (`developmentClient`, `distribution: internal`, `android.buildType: apk`), camera + Bluetooth permissions in `app.json`, one build, then `npx expo start --dev-client`. Batch with Phase 8.
2. **`mobile/src/app/(app)/move.tsx`** — the screen. Camera preview, SVG skeleton overlay, rep count, live HR from `useIot()`, prescription banner at the top, disclosure block in the shape of the one inside `focus-forecast.tsx`. Register as `<Tabs.Screen name="move" options={{ href: null }} />`; note `AppShell` renders the nav bar over every `(app)` screen, so a full-bleed camera needs that handled.
3. **Capture loop** — `takePictureAsync` on an interval → `forward(uri)` → `observe(...)`. Keep the loop in a hook (`use-squat-session.ts`) so the screen stays declarative.
4. **Wire `runAction`** in `src/app/(app)/_layout.tsx` — `move` → `router.push('/move')`.
5. **IoT hook** — `completedShallowRep` → `setLight('alert')`. Note `iot-context` throttles publishes to one per 300 ms and the firmware reverts `alert` after 6 s.
6. **Model delivery** — executorch fetches the pose model on first use. Decide bundle-vs-download; for a demo, pre-warming on first open with a visible progress state is safer than a silent stall.
7. **ADR** — `docs/adr/0006-…`: going native for pose, which reverses the Expo Go compatibility ADR 0001 deliberately protected.

## Known issues found along the way, not yet fixed

- **`log-meal.tsx` lost meals offline.** It enqueued an empty health snapshot and navigated back, so the meal was discarded while the UI said it saved. Now shows an honest error instead. The real fix is a `client_uuid` on meals so they can join the outbox — same pattern as sessions.
- **`mobile/AGENTS.md`** points at Expo v57 docs; the project is SDK 54.
- **NativeWind** is fully unused now but still in `babel.config.js`, `metro.config.js`, `tailwind.config.js`, `global.css`, `nativewind-env.d.ts`.

## Verification

- `npm test` — rep counter golden sequences, prescription thresholds, outbox union + v1 migration.
- `php artisan test` — endpoint auth, validation bounds, cross-tenant leakage, replay idempotency.
- On device, once built: ten squats count as ten; a shallow rep is flagged and the lamp pulses; the session appears in history; airplane mode queues it and it lands once on reconnect.
- If the camera slips, the counter and its tests still stand on their own as evidence of the logic.
