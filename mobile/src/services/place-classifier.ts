import type { Context } from '@/ml/focus-features';

/**
 * Where the user is, from places they told us about.
 *
 * Deliberately not reverse geocoding and not a maps SDK. The model needs one of seven
 * coarse categories, and a distance check against places the user tagged themselves
 * answers that exactly — without sending their coordinates to a third party, without an
 * API key, and without a map screen. It is also a pure function, so the behaviour that
 * decides an ML input is unit-testable rather than only observable on a walk.
 */

export interface TaggedPlace {
  id: string;
  label: string;
  context: Context;
  latitude: number;
  longitude: number;
  /** Metres. Wider for a campus, tighter for a flat. */
  radiusMeters: number;
}

export interface Coordinates {
  latitude: number;
  longitude: number;
}

const EARTH_RADIUS_M = 6_371_000;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** Great-circle distance. Accurate far beyond what a geofence needs. */
export function distanceMeters(a: Coordinates, b: Coordinates): number {
  const dLat = toRadians(b.latitude - a.latitude);
  const dLon = toRadians(b.longitude - a.longitude);

  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);

  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);

  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface PlaceMatch {
  place: TaggedPlace;
  distanceMeters: number;
}

/**
 * The nearest tagged place the user is actually inside, or null.
 *
 * Nearest rather than first, because a gym inside an office block should win over the
 * office when you are standing in it — the tighter radius is the more specific claim.
 */
export function matchPlace(at: Coordinates, places: TaggedPlace[]): PlaceMatch | null {
  let best: PlaceMatch | null = null;

  for (const place of places) {
    const distance = distanceMeters(at, place);
    if (distance > place.radiusMeters) continue;

    if (best === null || distance < best.distanceMeters) {
      best = { place, distanceMeters: distance };
    }
  }

  return best;
}

/**
 * Null when no tagged place contains the user.
 *
 * Null, not a guess. `focus-features.ts` encodes an absent context as all-zeros, which is
 * the model's held-out OTHER category — so "somewhere I haven't told it about" stays
 * honestly unknown rather than being rounded to the nearest place.
 */
export function classifyContext(at: Coordinates, places: TaggedPlace[]): Context | null {
  return matchPlace(at, places)?.place.context ?? null;
}
