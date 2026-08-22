# AuraFlow Mobile — Phase 1 UI (Auth + Today/Recovery)

## Context

The mobile app was rebuilt from scratch this session (fresh Expo scaffold, pinned to SDK 54 to match the team's Expo Go client, NativeWind wired in) and currently has only the stock placeholder screen — no auth, no design tokens, no screens. A more complete version existed before the rebuild (git commit `2934054`) with a working login + "Today" recovery screen, a semantic design-token system, and a clean services/context layer — that work is gone from the working tree but recoverable in spirit from history, and this plan recreates it, improved, rather than reinventing it.

This is also graded coursework (CMP 7003, Cardiff Met/ICBT — assignment brief `cmp-7003prac-01.docx`, target 80+/100). The rubric scores UI/UX (10), Technical Implementation (20 — core functionality, code quality), System Architecture (10), and Security (10 — auth, secure storage) directly, and a working polished auth+data flow feeds "Project Content and Innovation" too. The backend (`api/`) currently only implements auth (register/login/logout/me) and a single recovery-score endpoint — no Task, LLM, or IoT/MQTT routes exist despite being mentioned in the README's aspirational vision. Scope for this phase is deliberately limited to what the backend actually supports, so nothing in the UI calls an endpoint that doesn't exist. Broader "Smart Lifestyle Companion" features (IoT live biometrics, AR posture, LLM digests) and a full brand identity/logo are explicitly deferred to a later phase, not part of this plan.

## Backend contract (confirmed, `api/routes/api.php` + controllers, base path `/api/v1`)

- `POST /register` — `name, email, password, password_confirmation` (password: min 10 chars, `confirmed`, rejected if pwned via HaveIBeenPwned), optional `device_name`. → 201 `{"data":{"user":{id,name,email},"token"}}`.
- `POST /login` — `email, password`, optional `device_name`; throttled 5/60s per email+ip (a 429 surfaces as a normal `email`-field validation error, not a special case). Same response shape.
- `POST /logout` (sanctum) — revokes current device token only. `POST /logout-everywhere` — revokes all.
- `GET /me` (sanctum) — `{id, name, email}`.
- `GET /recovery/{date}` (sanctum, `date` = `YYYY-MM-DD`) — always 200. Unavailable: `{"data":{date, score:null, available:false, reason}}`. Available: `{"data":{date, score:0-100, available:true, provisional, components_used, illness_warning}}`.
- Auth via `Authorization: Bearer <token>`. No health-data-submission endpoint exists yet (dataset-seeded only) — do not build a "sync device" flow.

## Design tokens — `mobile/tailwind.config.js`

Recreate the old semantic palette (currently `theme.extend: {}` is empty), plus two new tokens for score confidence states that didn't exist before:

```js
theme: {
  extend: {
    colors: {
      surface: { DEFAULT: '#ffffff', raised: '#f0f0f3', selected: '#e0e1e6' },
      content: { DEFAULT: '#000000', muted: '#60646c' },
      brand: { DEFAULT: '#1f6feb', pressed: '#1a5fd0' },
      caution: '#8a5300',
      danger: '#b3261e',
      success: '#1a7f37',      // established/confident recovery score
      provisional: '#6b5b95',  // provisional score — distinct hue, not a severity color
    },
    spacing: { half: '2px', one: '4px', two: '8px', three: '16px', four: '24px', five: '32px', six: '64px' },
    minHeight: { touch: '44px' },
    minWidth: { touch: '44px' },
  },
},
```

Dark-mode NativeWind variants are a deliberate scope cut — `ThemeProvider` already switches by scheme for native chrome, but screens use light tokens unconditionally; no grading benefit for the extra surface area. Check `src/constants/theme.ts`'s old `Colors` map for importers (`grep -r "from '@/constants/theme'"`) before touching/removing it — it's pre-existing scaffold code.

## Dependencies to add

```
npx expo install expo-secure-store react-native-svg
```

`expo-secure-store` for the auth token (not AsyncStorage — plaintext-readable, and this token unlocks health data). `react-native-svg` for a proper score ring (single well-supported native module, not a charting-library detour). `expo-device` and `react-native-reanimated` are already dependencies.

## File-by-file build order

1. **`tailwind.config.js`** tokens (above).
2. **`src/types/index.ts`** — `User {id,name,email}`; `AuthPayload {user,token}`; `ApiEnvelope<T> {data:T}`; discriminated `RecoveryReading` matching the API shape exactly (snake_case field names as returned, e.g. `illness_warning` not `illnessWarning`).
3. **`src/services/api-client.ts`** — `ApiError extends Error` with `status`, `errors?: Record<string,string[]>`, `isUnauthenticated` (401 getter), `isValidation` (422/429 with errors, getter), `fieldError(field)` → `errors?.[field]?.[0]`. Token helpers wrapping `expo-secure-store` (key `auraflow.authToken`). `request<T>()` core builds the `Authorization`/`Content-Type`/`Accept` headers, parses Laravel's `{message,errors}` body into `ApiError` on non-2xx, and wraps `fetch` itself in try/catch so `TypeError: Network request failed` becomes a friendly `ApiError` (status 0). `apiGet/apiPost/apiPatch/apiDelete` thin wrappers. Base URL from `EXPO_PUBLIC_API_URL` with a documented fallback constant (don't over-engineer platform IP detection).
4. **`src/services/auth-service.ts`** — `deviceName()` via `expo-device`; `register`, `login` (both store the returned token), `logout` (best-effort POST, always clears local token), `fetchCurrentUser`.
5. **`src/services/recovery-service.ts`** — `todayIsoDate()` built from **local** `Date` parts (`getFullYear/getMonth/getDate`), never `toISOString()` (UTC — wrong near midnight); `fetchRecovery(date)` unwrapping `.data`.
6. **`src/context/auth-context.tsx`** — `AuthProvider`/`useAuth` exposing `user, isRestoring, signIn, signUp, signOut`. On mount: read token, call `fetchCurrentUser()`; clear token/user **only** on `isUnauthenticated` (401) — a network error during restore leaves the stored token alone and just leaves `user` null for this session. `signOut` clears local `user` immediately, then best-effort network logout. `isRestoring` always set false in `finally`.
7. **`src/components/`** — `text-field.tsx` (labeled input + inline `error`), `primary-button.tsx` (`loading`/`disabled`, `h-touch`), `screen-container.tsx` (SafeAreaView + consistent `px-four`, used by every screen), `score-ring.tsx` (`react-native-svg` circle, animated `strokeDashoffset` via reanimated, `tone: 'success' | 'provisional'`), `recovery-card.tsx` (owns all four visual states, see below).
8. **Navigation** (expo-router v6 / SDK 54 — `DarkTheme/DefaultTheme/ThemeProvider` come from `@react-navigation/native`, **not** `expo-router`, confirmed for this install):
   - Delete placeholder `src/app/index.tsx`.
   - `src/app/_layout.tsx`: `AuthProvider` → `ThemeProvider` (scheme-based) → `AuthGate` → `Stack screenOptions={{headerShown:false}}`. `AuthGate` is the **single** navigation decision point: while `isRestoring`, show a centered spinner; once restored, one `useEffect` does `if (!user && !inAuthGroup) router.replace('/(auth)/login'); else if (user && inAuthGroup) router.replace('/(app)')`. No screen ever calls `router.replace`/`push` to `(app)` or `(auth)` root after a sign-in/out — this is the one invariant most worth protecting during implementation.
   - `src/app/(auth)/_layout.tsx`, `src/app/(app)/_layout.tsx`: plain `<Stack screenOptions={{headerShown:false}} />`, route groups exist only so `AuthGate`'s `segments[0] === '(auth)'` check is trivial.
9. **`src/app/(auth)/login.tsx`** — `KeyboardAvoidingView`+`ScrollView`, title "AuraFlow" + tagline "Work with your body, not against it.", email+password `TextField`s, `PrimaryButton` with loading/disabled state, inline field errors via `ApiError.fieldError`, footer link to register (`router.push`, safe since it stays inside `(auth)`).
10. **`src/app/(auth)/register.tsx`** (new — didn't exist before) — same pattern, name+email+password+password-confirmation fields, cheap client-side pre-check (match + length ≥10) before hitting the network, server 422s remain the source of truth (HIBP check can't be replicated client-side).
11. **`src/app/(app)/index.tsx`** "Today" screen — greets `Hello, {user.name}`, sign-out affordance (`h-touch`, calls `useAuth().signOut()`, no manual nav), pull-to-refresh. State machine distinguishes **network/API failure** (real error, retry card) from the API's own `available:false` **business state** (calm empty state showing `reason`, not styled as an error) — do not collapse these into one catch-all. `RecoveryCard` renders loading (pulsing skeleton), error (retry button), unavailable (calm empty state), provisional (`ScoreRing` provisional tone + "Provisional — building your baseline" badge + `components_used` as muted text), established (`ScoreRing` success tone, prominent numeral). `illness_warning:true` shows a `caution`-colored inline banner independent of provisional/established. Light entrance motion only (reanimated `FadeIn`, ring fill `withTiming` ~500ms) — explicitly the ceiling, no further animation scope.

## Verification

Given this session's on-device connectivity problems, treat these as the actual "done" bar, roughly in this order and re-run after each file group (types → services → context → components → screens), not just once at the end:

1. `cd mobile && npm run typecheck` — must stay clean throughout.
2. `npx expo export --platform android` — proven working smoke test this session; catches Metro/NativeWind/babel/native-module wiring issues `tsc` won't (e.g. `react-native-svg` not linked).
3. Manual review: confirm the single-redirect invariant in `AuthGate`, confirm `todayIsoDate()` uses local date parts, confirm 401-only token eviction on restore.
4. On-device via Expo Go is a bonus check only if connectivity cooperates — not a blocker for calling this phase done, given the known environment issues this session.

## Explicitly deferred (not part of this plan)

- IoT node integration (ESP32/MAX30102 live biometrics), AR posture screen, LLM-driven task/digest UI — backend support for these doesn't exist yet (confirmed: no LlmService, no Reverb config, no Task model/routes in `api/`).
- Full brand identity / logo design — separate follow-up using the `design` skill once this implementation plan is approved.
