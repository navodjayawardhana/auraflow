# 2. Cache health data in AsyncStorage, keep only the token in SecureStore

Date: 2026-08-21

## Status

Accepted.

## Context

The app must open usefully with no network: a cold launch in airplane mode should show
the last known recovery score, weekly trend and identity rather than a spinner that
resolves into an error.

`expo-secure-store` was already a dependency, holding the Sanctum bearer token, so the
obvious move was to reuse it for the cache too. That is the wrong tool. SecureStore is
Keychain/Keystore-backed, which brings a small practical size limit per value and slow
bulk reads — a seven-day window of readings would mean either splitting across many
keychain entries or truncating. `react-native-mmkv` is faster than either, but it is a
JSI module and would force a custom development build, ending Expo Go compatibility for
a caching layer.

## Decision

Two stores, split by what the data actually is:

- **SecureStore holds the bearer token, and nothing else.** It is a credential: it
  unlocks health data on a server, and it is small.
- **AsyncStorage holds the read cache** (`mobile/src/services/cache.ts`) and the offline
  write queue (`mobile/src/services/outbox.ts`). Cached scores and sleep figures are
  health data, but they are not a credential — they are already on this device, behind
  its lock screen, and no key to anything else.

Cache entries are wrapped in a versioned envelope (`{ v, cachedAt, value }`) so a shape
change invalidates rather than crashes, and keys are namespaced per user id
(`auraflow.cache.v1.<userId>.<resource>`). The namespacing is a privacy requirement
rather than tidiness: two accounts on one handset must never see each other's health
data, and signing out purges exactly one namespace.

## Consequences

**Good.** Offline launch works; a failed refresh keeps the previous answer on screen and
sets a staleness flag rather than replacing it with an error; no native module was added;
Expo Go still runs the app.

**Bad.** AsyncStorage is unencrypted at rest. On a device with no passcode, or a rooted
one, cached health figures are readable. That is a deliberate, bounded trade: the data is
already local, the credential that would let an attacker fetch *more* of it stays in the
Keychain, and the alternative costs either a native module or a broken cache.

**Enforced by test.** `mobile/src/services/__tests__/cache.test.ts` pins the two
properties that matter — one account cannot read another's namespace, and clearing one
namespace leaves the other intact. Sign-out purges the cache before clearing the token,
so an interrupted sign-out never leaves readable data with no session to explain it.
