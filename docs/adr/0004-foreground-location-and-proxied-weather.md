# 4. Foreground-only location, user-tagged places, and a proxied weather key

Date: 2026-08-21

## Status

Accepted.

## Context

The assignment brief asks for a companion that adapts to "contextual inputs such as
location and time", and names *environment* as one of the three domains it should cover.
There was also a concrete gap in the app: the on-device focus model has seven one-hot
location features (`HOME`, `WORK/SCHOOL`, `HOME_OFFICE`, `GYM`, `OUTDOORS`, `TRANSIT`,
`ENTERTAINMENT`) which were **all zero**, because nothing supplied a context. Filling
them was the single largest available improvement to the model's real-input count.

The obvious implementation — background geofencing plus a weather API call from the
phone — is also the wrong one on three counts, and each is worth stating.

## Decision

### Foreground location only. No background tracking.

`expo-location` is read **when the app is open**, on demand. There is no background task,
no geofence transition listener, and `isAndroidBackgroundLocationEnabled` is explicitly
`false`.

A health app that follows you when it is closed is a far larger promise than this feature
needs. The model wants one coarse category at the moment it makes a prediction, and
reading position while the app is open answers exactly that. The cost of the honest
version is that context is unknown while the app is shut — which is precisely what the
model's all-zeros held-out `OTHER` category already means, so the gap is representable
rather than papered over.

Battery and reliability follow for free: no wake-ups, no background permission to justify
to a store reviewer, no geofence-drift debugging.

### Places are tagged by the user and never leave the device.

Rather than reverse-geocoding a position or shipping a maps SDK, the user stands
somewhere and taps what it is. Classification is then a distance check against their own
list (`src/services/place-classifier.ts`), stored in AsyncStorage under a per-user key
(`src/services/places-store.ts`).

Three things fall out of that:

- **Coordinates never reach the server.** AuraFlow's backend has no idea where anyone
  lives. For a health app that is a materially smaller privacy claim than the alternative,
  and it costs nothing.
- **The classifier is a pure function**, so the behaviour that decides an ML input is
  unit-tested rather than only observable on a walk. Nine tests cover overlapping radii
  (a gym inside an office block resolves to the gym — the tighter radius is the more
  specific claim), the untagged case, and the empty case.
- **An untagged location returns `null`, not a nearest guess.** Rounding to the closest
  place would fabricate an input the user never gave; `null` is encoded as all-zeros,
  which the model already understands as "unknown".

### The weather key lives on the server.

`EXPO_PUBLIC_*` variables are inlined into the JavaScript bundle and readable from the
APK, so a key shipped that way is a published key. The app calls `GET /api/v1/weather`
and Laravel calls OpenWeatherMap (`app/Infrastructure/Weather/OpenWeatherMapClient.php`).

Two secondary benefits: the response is cached for ten minutes on a coordinate key rounded
to two decimals, so a pull-to-refresh loop cannot burn the free tier and nearby users
share an entry; and the client is coupled to *our* narrowed shape rather than the
provider's, so changing provider is a change to one adapter. A test asserts the key never
appears in a response, and another asserts the cache is actually shared.

A provider failure returns **503, not 500** — an unreachable or unconfigured dependency is
a degraded service, not a fault in the request, and the client already knows how to hide a
card it cannot fill.

## Consequences

**Good.** Seven model features become real when the user tags their places, taking the
focus model from 10 to 17 real inputs out of 25 — and `ModelDisclosure` reflects that
automatically, because it derives the count rather than hardcoding it. Weather satisfies
the brief's *environment* dimension. No key is shipped, no coordinates are stored
server-side, no background permission is requested.

**Bad.** Context is unknown while the app is closed, so a prediction made at 3pm about
9am has no location for 9am. Tagging is a one-time setup cost the user has to be
persuaded through. And a circular geofence is a crude model of a place — a large campus
either over- or under-covers.

**If this were to grow**, the honest next step is not background geofencing but a
significant-location-change subscription with an explicit, separate opt-in — and a written
answer to "what does the app do with a location history" before, not after, collecting one.
