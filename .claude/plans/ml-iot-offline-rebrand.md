# AuraFlow — ml + iot integration, offline mode, and rebrand

## Context

Phase 1 of the mobile app is done: auth flow, Today (recovery score), Insights (7-day trend), Profile, bottom-tab navigation, all wired to the Laravel API. What remains is everything that makes this an *AI-driven smart lifestyle companion* rather than a login form over one endpoint — and one blocker that makes the whole app demo as empty.

Four things prompted this plan:

1. **The app has no data.** `health_snapshots` is empty and there is no API to write it, so `GET /recovery/{date}` returns `available:false` for every date. Today and Insights both render their empty states. Nothing else matters until this is fixed.
2. **A new animated logo exists** (`E:\MSC\Emerging Mobile Applications\new-logo.svg`) — an "A"+pulse single-stroke mark with a draw-on animation, a cyber-blue gradient (`#0052FF → #00D2FF → #00F0FF`), and a Plus Jakarta Sans wordmark. The app's current `#1f6feb` palette should be rebuilt around it.
3. **Offline support is a hard requirement.** The user explicitly rejected putting intelligence server-side because "then it won't work offline."
4. **`ml/` and `iot/` are built but completely unconsumed.** The trained focus model sits unused as a JSON file; the ESP32 publishes live biometrics that nothing subscribes to.

Assignment context: CMP 7003 PRAC1, 100 marks — Technical Implementation 20, Project Content/Innovation 20, UI/UX 10, System Architecture 10, Security 10, Testing 10. Every phase below is ordered to bank marks early and front-load risk.

## Key findings that shape the plan

**The ML model is a logistic regression, not a neural net.** `ml/artifacts/focus_model_coefficients.json` (2,433 bytes, exists, trained 2026-08-11) is sklearn `SimpleImputer(median) → StandardScaler → LogisticRegression`. Its own contract: `z = Σ coef[i]·(x[i] − scale_mean[i])/scale_std[i] + intercept`, `p = σ(z)`, missing → `impute_median[i]`. That is ~40 lines of TypeScript running **fully offline, on-device, with no ML runtime and no native module**. `ml/train.py:253` says outright "no TFLite needed for this model" — the README's TFLite claim is superseded. This is the answer to the offline requirement.

**The IoT node works and publishes now.** ESP32 + MAX30102, on public HiveMQ (`broker.hivemq.com`), device `auraflow-node-01`. Topics under `auraflow/auraflow-node-01/`: `telemetry/biometrics` (`finger`, `ir_mean`, `hr_bpm`?, `spo2_pct`?, `hr_valid`, `spo2_valid`, `uptime_s` — every 5s while a finger is present), `telemetry/device` (30s), `light/state` (retained), `status` (retained `online`/`offline`), and it **subscribes** to `light/set` (`{"mode":"off|focus|break|sleep|alert","brightness":0-100}`). Nothing in the repo consumes any of it.

**MQTT-over-WebSocket keeps Expo Go working.** The `mqtt` npm package is pure JS. Raw TCP MQTT and BLE both need native modules and would force an EAS dev build — after a full session fighting Expo Go connectivity, that cost is not worth paying yet. **Decision: MQTT now, BLE deferred to future work.**

**Data source decision: seeder.** `api/database/seeders/data/demo_timeline.json` already exists and is unused — 30 nights of `date`/`sleep_duration`/`deep_sleep_min`/`resting_hr`/`stress`/`is_illness_day`, self-declared `meta.synthetic: true`. Its last night is 2026-08-11, so a seeder must **date-rebase** it so the last night lands on today.

## Expo Go compatibility

| Phase | New dependency | Expo Go? |
|---|---|---|
| 2 | `@expo-google-fonts/plus-jakarta-sans`, `expo-font` | Yes |
| 3 | `@react-native-async-storage/async-storage`, `expo-network` | Yes |
| 4 | none (JSON asset + arithmetic); `jest-expo` as devDep | Yes |
| 5 | `mqtt` (+ `buffer`/`process` shims) | **Risk — Phase 0 decides** |

Nothing here requires a custom dev build. Explicitly avoided: `react-native-mmkv` (JSI), `react-native-ble-plx` (native), `react-native-fast-tflite` (unnecessary), `@react-native-community/slider` (use chips).

---

## Phase 0 — De-risk the IoT transport (½ day, throwaway)

Prove MQTT-over-WSS works from Expo Go on the physical iPhone *before* designing Phase 5 around it.

On a scratch branch: `npx expo install mqtt buffer process`, shim Node globals at the top of `mobile/src/app/_layout.tsx` (`global.Buffer`, `global.process`), connect a temp screen to `wss://broker.hivemq.com:8884/mqtt` — **`wss` on 8884, not `ws` on 8000**; iOS App Transport Security blocks cleartext WebSocket on a physical device. Subscribe to `telemetry/biometrics`, put a finger on the sensor, confirm frames. Publish `{"mode":"focus"}` to `light/set`, confirm the lamp changes. Delete the branch either way.

**Fallbacks if `mqtt` won't bundle:** (1) `paho-mqtt` (browser build, WebSocket-only) with a 10-line in-memory `localStorage` shim; (2) a Laravel bridge — `php-mqtt/laravel-client` in a long-running `php artisan mqtt:consume`, persisting to a `device_telemetry` table, app polls `GET /devices/{id}/telemetry/latest`. Loses "works without the server," gains persistence.

---

## Phase 1 — Put data in the tank (~1.5 days) ← **highest value, do first**

**Goal:** every screen shows real content; `GET /recovery/{today}` returns `available:true, provisional:false`; Insights shows 7 populated bars. And close the write gap so seeder/manual/IoT all have one way in.

### Seeder (the demo fix)

- **`api/database/seeders/DemoTimelineSeeder.php`** (new) — read `data/demo_timeline.json`, compute `offset = today − max(nights[].date)` and shift every date so the last night is today (this rebasing *is* the point of the seeder — say so in the docblock). Map `sleep_minutes = round(sleep_duration*60)`, `deep_sleep_minutes = round(deep_sleep_min)`, `resting_heart_rate = round(resting_hr,1)`. **`rem_sleep_minutes` is absent from the source** — derive it as `round(sleep_minutes * 0.22)` with deterministic ±10% jitter seeded from `meta.seed` (7003), clamped so `deep + rem <= sleep_minutes`. Justify in the docblock: the file already declares itself synthetic, so a derived REM adds no new claim — whereas leaving it null disables the architecture component (`SleepSummary::hasStageBreakdown()` needs both) and every demo score would compute from 2 of 3 signals. Record the rule in `docs/DATASET.md` too. Idempotent via `updateOrCreate(['user_id','recorded_on'])` — the table already has that unique index.
- **`api/database/seeders/DatabaseSeeder.php`** — call it after creating the test user.
- **`api/app/Console/Commands/SeedDemoTimeline.php`** (new) — `php artisan auraflow:seed-demo {email}`, so an account registered live on the phone during a demo can be filled without wiping the DB.

### Write + read endpoints (the architecture-marks part)

Follow the existing DDD layering exactly — repository interface → Eloquent impl → mapper → use case → form request → thin controller:

- `Domain/Wellbeing/Repository/DailyHealthSnapshotRepository.php` — add `save()` and `findRange()`
- `Infrastructure/Wellbeing/Persistence/EloquentDailyHealthSnapshotRepository.php` — implement; `save` uses `updateOrCreate` (idempotent ingest)
- `Infrastructure/Wellbeing/Persistence/DailyHealthSnapshotMapper.php` — add `toAttributes()`
- `Application/Wellbeing/UseCase/RecordHealthSnapshotUseCase.php` + a request DTO — build the domain value objects (they self-validate; sleep outside 3–12h throws)
- `Application/Wellbeing/UseCase/ListHealthSnapshotsUseCase.php` — **Phase 4 depends on this**; the recovery endpoint returns only a score, but the focus model needs raw `sleep_hours`, `resting_hr`, deep/REM ratios and a 7-day RHR delta
- `Http/Requests/Api/V1/StoreHealthSnapshotRequest.php` — `recorded_on` required date **`before_or_equal:today`** (a client with a wrong clock would otherwise poison every trailing baseline); `sleep_minutes` 0–1440; deep/rem each `lte:sleep_minutes`; `resting_heart_rate` 25–220
- `Http/Controllers/Api/V1/HealthSnapshotController.php` (new) — `store` (201) + `index`
- `api/routes/api.php`, inside `auth:sanctum`: `POST /health-snapshots` with `throttle:60,1` (the one write path an IoT bridge could hammer), `GET /health-snapshots`

### Mobile (thin here; restyled in Phase 2)

- `src/types/index.ts` — add `HealthSnapshot`
- `src/services/health-snapshot-service.ts` (new) — `recordHealthSnapshot`, `fetchHealthSnapshots(from, to)`
- `src/app/(app)/log-night.tsx` (new) — "log last night" form (hours slept, resting HR, optional deep minutes), `ApiError.fieldError()` per field exactly as `login.tsx` does. Register in `(app)/_layout.tsx` as `<Tabs.Screen name="log-night" options={{ href: null }} />` and reach it with `router.push` from a Today header button — **not** a tab, and a `push` so it doesn't touch the single-AuthGate invariant.

**Tests:** `api/tests/Feature/Wellbeing/RecordHealthSnapshotEndpointTest.php` (401 unauthed; 201 creates; same-date POST updates not duplicates; 422 future date; 422 deep > total), a use-case unit test (extend the existing `FakeDailyHealthSnapshotRepository`), and a seeder test asserting the last night equals today.

**Verify:** `php artisan migrate:fresh --seed && php artisan test`; `curl GET /api/v1/recovery/<today>` → `available:true, components_used:3`; on the phone Today shows a ring and Insights 7 bars.

---

## Phase 2 — Brand, logo, design system (~2 days)

**Goal:** the app reads as one designed product built around the new mark — now with real content underneath it.

**Decide up front:** `app.json` sets `userInterfaceStyle: "automatic"` and `_layout.tsx` swaps the React Navigation theme, but every Tailwind token is light-only — dark mode currently gives dark chrome around light screens. **Lock to `"light"` and drop the `DarkTheme` branch**; a half-built dark mode reads as a defect. Note the trade-off in the report.

- **`mobile/tailwind.config.js`** — new palette (keep the spacing/`touch` scales): `surface` `#ffffff`/sunken `#f8fafc`/raised `#f1f5f9`/selected `#e2e8f0`; `content` `#0f172a`/muted `#64748b`/inverse `#ffffff`; `brand` `#0052ff`/pressed `#0041cc`/bright `#00d2ff`/glow `#00f0ff`; `accent` `#00b4db`/deep `#0083b0`; `caution` `#b45309`, `danger` `#dc2626`, `success` `#0f9d58`, `provisional` `#8b5cf6` (kept far from the cyan ramp so provisional bars stay legible). Add `fontFamily` entries.
- **`mobile/src/constants/theme.ts`** — still the Expo starter file. Rewrite to export the same hexes as `AuraColors` for the consumers that can't use classNames (SVG stroke/fill, Feather `color`, `Tabs` tints, `LinearGradient` colors). One source of truth.
- **`mobile/src/components/logo-mark.tsx`** — full rewrite. `viewBox="60 30 300 280"` cropping the glyph from the source's 800×450 space. Three stacked paths: a fake-glow path (`strokeWidth={26}`, `strokeOpacity={0.18}`, `#00D2FF` — **`<filter>` has no `react-native-svg` equivalent, don't try to port it**), the `0.12`-opacity track, and an `AnimatedPath` with `stroke="url(#stroke)"`, `strokeDasharray={1000}`, `strokeDashoffset` 1000→0 over ~1400ms `Easing.out(Easing.cubic)` — same `createAnimatedComponent` pattern already proven in `score-ring.tsx`. Plus the `#00F0FF` energy dot at (213,72) r=7. Props `size`, `animated?` (default false), `pulse?` — a permanently animating logo behind a form is a distraction; animate on login/register only.
- **`mobile/src/components/logo-wordmark.tsx`** (new) — "Aura" weight 800 `#0F172A` + "Flow" weight 400 with a `#00B4DB → #0083B0` gradient fill, via `react-native-svg`'s `<Text>` + gradient (**not** a masked view — avoids a native dep). Optional `tagline` prop: "WORK WITH YOUR BODY", 11px/600/`letterSpacing:3`/`#64748B`.
- **Fonts** — `npx expo install expo-font @expo-google-fonts/plus-jakarta-sans`; load 400/600/800 with `useFonts` in `src/app/_layout.tsx` and gate on it in the *same* place `isRestoring` is gated, so there's one loading state not two.
- **Recolour sweep** — `score-ring.tsx` (gradient stroke instead of flat `TONE_COLORS`), `insights.tsx` (hardcoded `#1f6feb`/`#14b8a6` at lines 121/126 → `theme.ts`), `(app)/_layout.tsx` tab tints, `wave-divider.tsx` + `hero-decoration.tsx` (echo the logo's curvature), `login.tsx`/`register.tsx` (hero `#0052FF → #00B4DB`, swap in `<LogoMark animated />` + `<LogoWordmark tagline />`), `primary-button.tsx`/`text-field.tsx` states.
- **Fix a live copy bug**: `recovery-card.tsx:68` says "Based on {components_used} of 4 signals" — `RecoveryScoreCalculator` has **three** components. Change to "of 3". Also give `UnavailableState` a CTA pointing at `log-night`.
- **`mobile/app.json`** — name/slug/scheme `auraflow`, splash `#0F172A`, android adaptive icon bg `#0052FF`; regenerate `icon.png`/`splash-icon.png`/`android-icon-foreground.png` at 1024px from the new mark.

**Verify:** `npm run typecheck`; `grep -rn "#[0-9a-fA-F]\{6\}" mobile/src --include=*.tsx` should hit only `constants/theme.ts` and the two logo components; device screenshots for the report's UI/UX evidence.

---

## Phase 3 — Offline-first core (~2 days)

**Goal:** cold-launch in airplane mode shows last-known recovery, trend and profile instantly with an honest staleness indicator, and offline writes are not lost.

**Storage: `@react-native-async-storage/async-storage`.** `expo-secure-store` is already installed but is the wrong tool — Keychain-backed, ~2KB practical limit per value, slow for bulk reads. Keep SecureStore for exactly one thing (the bearer token, as today) and put the cache in AsyncStorage. The cached data is health data but not a credential, so it sits behind the device lock screen but not the Keychain — **state that reasoning in the report; it's a defensible security boundary and examiners look for exactly this.** Skip `react-native-mmkv` (JSI → dev build). Connectivity via `expo-network`'s `useNetworkState()` (first-party, in Expo Go).

- **`src/services/cache.ts`** (new) — `readCache<T>`, `writeCache<T>`, `clearNamespace(userId)`. Envelope `{ v: 1, cachedAt, value }` so a schema change invalidates rather than crashes. Key `auraflow.cache.v1.<userId>.<resource>` — **namespacing by user id is a privacy requirement**: two accounts on one handset must never see each other's health data.
- **`src/hooks/use-cached-resource.ts`** (new) — the core abstraction. `{ data, status, source: 'cache'|'network', cachedAt, isStale, refresh }`. Render from cache immediately if present (status jumps straight to `loaded`), fetch in the background, write through on success, keep cached data and set `isStale` on failure. Reach `status: 'error'` **only** when there is no cache *and* the network failed. Build this properly and both screens become three-line changes.
- **`src/context/auth-context.tsx`** — (1) cache the `User` on successful `/me`; during restore, if the token exists but the request fails with `ApiError.status === 0` *and* a cached user exists, sign in from cache (the existing drop-token-only-on-401 invariant already makes this safe). (2) `await clearNamespace(userId)` in both `signOut` and `signOutEverywhere` — cached health data surviving a sign-out is a real security finding.
- **`src/components/offline-banner.tsx`** (new) — a subtle pill, not a modal: "Offline · updated 2h ago", `accessibilityLiveRegion="polite"`.
- **`src/services/outbox.ts`** (new) — durable queue for offline `POST /health-snapshots`. Flush on reconnect and on app foreground; drop on 2xx **or 422** (a permanently invalid payload must not retry forever); back off on network errors. The write endpoint is idempotent per `(user, date)` by design, which is exactly why replaying a flush is safe — call that out.
- **Screens** — `(app)/index.tsx`, `insights.tsx`, `profile.tsx` swap their hand-rolled status machines for `useCachedResource`, keeping `RefreshControl` on `refresh()`. `log-night.tsx` submits through the outbox.

**Verify:** sign in online → force-quit → airplane mode → cold launch shows the cached ring instantly with the offline pill; submitting a night queues; disabling airplane mode lands the write. Also verify a second account sees none of the first's data.

---

## Phase 4 — On-device focus model (~2 days)

**Goal:** real ML running locally, no network, no native runtime, presented honestly.

- **`mobile/assets/models/focus-model.json`** — byte-for-byte copy of `ml/artifacts/focus_model_coefficients.json` (Metro can't import above the project root, so it must be a copy). Add **`mobile/scripts/check-model-sync.mjs`** comparing SHA-256 against the source and wire it into the check scripts, so a retrained model can never silently diverge from the one the report quotes.
- **`src/ml/focus-model.ts`** (new) — types the JSON, exports `predictFocusReady(inputs): { probability, ready, imputedFeatures }`. Pure, synchronous, no I/O — trivially unit-testable, which is the point.
- **`src/ml/focus-features.ts`** (new) — builds the 25-vector in the model's declared order. Be precise about what is real:
  - **Real from the clock (5):** `hour_sin`, `hour_cos`, `dow_sin`, `dow_cos`, `is_weekend`
  - **Real from `GET /health-snapshots` (5):** `sleep_hours`, `resting_hr`, `sleep_deep_ratio`, `sleep_rem_ratio`, `resting_hr_delta_7d` (computable client-side from the cached range — exactly why Phase 1 added the range endpoint)
  - **Real once Phase 5 lands (2):** `bpm`, `spo2` from the MAX30102
  - **Real from a user control (7):** the location one-hots — a segmented icon row (Home/Work/Gym/Outdoors/Transit/Entertainment/Other). Default **all-zeros = OTHER**, the held-out reference category, rather than the median's `HOME=1`; "unknown" is the honest default
  - **Permanently imputed (6):** `steps`, `calories`, `stress_score`, `sleep_efficiency`, `nremhr`, `rmssd` — no pedometer, no HRV, no stress feed
  
  So **9 of 25 real today, 11 after Phase 5, 18 with the context control set.** Surface that count in the UI rather than hiding it.
- **`src/components/focus-forecast.tsx`** (new) — hourly strip 06:00–22:00 coloured on the `#0052FF → #00F0FF` ramp, with the best contiguous 2-hour window called out ("Best deep-work window: 09:00–11:00").
- **`src/components/model-disclosure.tsx`** (new) — collapsible "How this is worked out": logistic regression trained offline; holdout ROC-AUC 0.674 / F1 0.583 / acc 0.659 **read from the JSON's own `metrics_holdout`, never hardcoded**; "N of 25 inputs are your data, the rest use population averages"; and the artifact's own note — *"Derived proxy, not a measurement of focus."* Label the card **"Focus forecast (experimental)"**. Headline should be a band ("Likely a good window" / "Mixed" / "Probably not your best hours"), not a percentage — AUC 0.67 is a weak-but-real signal, and presenting it as a prediction would be overclaiming. Note honestly that only the four time features vary across the strip within a day: the shape is the model's learned circadian curve, shifted by the user's real sleep/HR.
- **`src/app/(app)/index.tsx`** — forecast card below `RecoveryCard`. Renders with zero network (model + cached snapshot) — the offline story landing visibly.

**Test infrastructure (introduce here — testing is graded):** `npx expo install jest-expo jest @types/jest @testing-library/react-native react-test-renderer`, `jest.config.js` with `preset: 'jest-expo'` + `@/` moduleNameMapper.
- **Golden-vector test** — compute `p` in Python once from the artifact for the all-median input and two hand-picked vectors, hardcode expected values, assert the TS port matches to 1e-6. This proves the port is faithful and is worth a paragraph in the report.
- Plus: missing features imputed and reported; `ready` respects `threshold`; probability in [0,1]; feature vector asserted against `model.features` so a reordered artifact fails loudly.

**Verify:** `npm test`; airplane mode + cached snapshot still renders a forecast.

---

## Phase 5 — Live IoT biometrics and lamp control (~2 days, gated on Phase 0)

**Goal:** real hardware live in the app — HR and SpO₂ streaming from the MAX30102, lamp commandable from the phone.

- **`src/config/iot.ts`** (new) — `MQTT_URL` from `EXPO_PUBLIC_MQTT_URL` (default `wss://broker.hivemq.com:8884/mqtt`), `DEVICE_ID` from `EXPO_PUBLIC_IOT_DEVICE_ID`, derived topic constants matching the firmware exactly.
- **`src/types/index.ts`** — `LightMode`, `BiometricsTelemetry` (`hr_bpm`/`spo2_pct` **optional** — the firmware only includes them when valid), `DeviceTelemetry`, `LightState`, `IotStatus`. **Parse defensively**: a malformed retained payload from a *public* broker must not crash the app.
- **`src/services/mqtt-client.ts`** (new) — thin wrapper. Random `clientId` (`auraflow-app-<8 hex>`) — never a stable identifier; on a public broker that's a tracking vector. `clean: true`, `keepalive: 30` to match the firmware, backoff reconnect. Keep `mqtt` imported **only here** so a fallback swap touches one file.
- **`src/context/iot-context.tsx`** (new) — mirrors `auth-context.tsx`'s shape. Connects only when `user != null`, disconnects on sign-out. Exposes `{ status, biometrics, device, light, lastMessageAt, setLight(mode, brightness?) }`. Mark biometrics stale after 15s (three missed 5s frames). Rate-limit `setLight` to ~1 publish/300ms. Mount inside `(app)/_layout.tsx`, **not** the root layout — the auth screens have no business holding a socket.
- **`src/components/live-biometrics-card.tsx`** (new) — big HR number with a reanimated pulse whose period is `60000/hr_bpm` (real data driving real motion), SpO₂ beside it, signal-quality hint from `ir_mean`, clear "Place your finger on the sensor" state keyed off `finger === false`. When stale, **grey out and say "waiting for a reading" rather than freezing the last value** — a stale vital sign shown as current is exactly what a health-app rubric penalises.
- **`src/components/lamp-control.tsx`** (new) — five mode chips + 25/50/75/100% brightness chips (chips, not a slider — avoids a native dep). Show the **confirmed** state from the retained `light/state` topic, not optimistic local state: the physical BOOT button can change the mode too (`source: "button"`) and the app must reflect that. `alert` self-reverts after 6s — show it as momentary.
- **`src/app/(app)/device.tsx`** (new) + a fourth tab (Feather `activity`) — biometrics card, lamp control, diagnostics (RSSI, IP, uptime, free heap, connection state).
- **Cross-phase payoff:** feed live `hr_bpm` → `bpm` and `spo2_pct` → `spo2` into `focus-features.ts`. The demo becomes *"put your finger on my ESP32 and watch the on-device model update"* — one gesture tying IoT + ML + offline together.

### Security — graded, do not skip

The broker is public, anonymous, world-readable **and world-writable**.

1. **`wss://…:8884`, never `ws://…:8000`** — encrypts in transit and satisfies iOS ATS. Does *not* stop a subscriber to the same topic; say so, don't let TLS imply confidentiality it doesn't provide here.
2. **Rotate `DEVICE_ID` in `iot/auraflow-node/secrets.h` to a 128-bit random string** and reflash — and label it as security by obscurity, which is what it is. It raises a drive-by from trivial to impractical, nothing more.
3. **No PII on the wire** — current payloads carry no user id, name or email. Keep it that way; never publish a token, never key a topic on an email.
4. **The lamp is the only actuator.** Worst-case tampering is an annoying lamp — stating that blast radius explicitly is what makes the accepted risk defensible for a prototype.
5. **`docs/adr/NNNN-public-mqtt-broker-for-prototype.md`** — context, decision, accepted risk, production path (HiveMQ Cloud / self-hosted Mosquitto with per-device credentials, per-topic ACLs, and a server-side bridge so the phone authenticates to Laravel rather than holding broker credentials). **An ADR that names the weakness scores better than a design that pretends it isn't there.**

**Verify:** finger on sensor → HR within ~5s; remove → empty state; tap "focus" → lamp changes and UI confirms from the retained topic; press the physical BOOT button → the app's mode follows; kill Wi-Fi → status `reconnecting` while cached recovery and the focus forecast keep working.

---

## Phase 6 — Hardening, tests, evidence (~1.5 days, runs alongside 4 and 5)

**Security fixes:**
- **`src/services/api-client.ts` lines 57/63/67/76** — four unconditional `console.log`s printing every URL, status and error body, including login validation errors. Wrap in `if (__DEV__)`. This ships to release builds today; concrete finding, two-minute fix.
- Confirm cache purge actually runs on both sign-out paths; confirm the token is still the only thing in SecureStore.

**Tests:** `api-client` (401 → `isUnauthenticated`, 422 → `fieldError('email')`, network error → `status: 0`), `recovery-service` (`todayIsoDate` uses **local** parts not UTC — a real off-by-one-day bug class; `recentDates(7)` oldest-first, ends today, spans a month boundary), `cache` (envelope round-trip, version invalidation, `clearNamespace` leaves other users intact), `recovery-card` (all five states via RNTL), plus Phase 1's backend tests and Phase 4's golden vectors.

**Accessibility:** `accessibilityRole`/`accessibilityLabel` on every `Pressable`; **`#64748B` on `#F1F5F9` lands near 4.3:1, below the 4.5:1 AA threshold** — darken muted text to `#475569` or only place it on pure white; text alternatives for the score ring and forecast strip (a chart is invisible to a screen reader).

**Report evidence:** ADRs for the four load-bearing decisions (AsyncStorage vs SecureStore; on-device LR vs server ML; direct MQTT vs bridge; public-broker risk acceptance). Per-phase screenshots. A C4-ish diagram in `docs/diagrams/` showing app / Laravel / broker / ESP32 and **which paths survive an offline device** — that one diagram carries the architecture marks.

---

## Sequencing

```
Phase 0 (½d spike) ─┐
Phase 1 (1.5d API) ─┴─► Phase 2 (2d UI) ─► Phase 3 (2d offline) ─┬─► Phase 4 (2d ML)
                                                                  └─► Phase 5 (2d IoT)
                                             Phase 6 (1.5d) runs alongside 4 and 5
```

Phases 4 and 5 are independent after Phase 3. Phase 4 is lower-risk — do it first if time is tight. **If something must be cut, cut Phase 5 and keep the Phase 0 write-up**: a documented, evidenced "here is why we did not put the phone on a public broker" is worth more than a rushed integration.

**Watch-outs:**
- `app.json` sets `"reactCompiler": true` — strict about conditional hooks and mutation during render. The new contexts and `useCachedResource` must obey the rules of hooks exactly; fix bailouts rather than disabling the experiment.
- `npm run typecheck` is the reliable gate. `npx expo export` works but gets killed intermittently here and must target a temp dir outside the project (PhpStorm locks `dist/`). Treat export as an occasional smoke test, not the gate.
- Expo Go over the network is flaky here — the working setups are manual ngrok with `EXPO_PACKAGER_PROXY_URL`, or plain LAN. Establish the tunnel once per session rather than re-diagnosing mid-phase.

## Deferred to future work (state in the report)

- **BLE direct device connection** — needs a BLE GATT server added to the ESP32 firmware *and* `react-native-ble-plx` + an EAS custom dev build on the app side, which would end Expo Go compatibility. MQTT-over-WSS delivers the same live-data experience today at a fraction of the risk.
- Server-side LLM features, AR posture (MoveNet) — no backend support exists (no `LlmService`, no Reverb config, no Task model), and both are out of scope for this submission.
