import * as Location from 'expo-location';
import { useCallback, useEffect, useState } from 'react';

import { useAuth } from '@/context/auth-context';
import type { Context } from '@/ml/focus-features';
import { classifyContext, type Coordinates, type TaggedPlace } from '@/services/place-classifier';
import { loadPlaces, removePlace, savePlace } from '@/services/places-store';

export type LocationStatus = 'checking' | 'denied' | 'unavailable' | 'located';

/**
 * How stale a remembered position may be and still answer "where am I".
 *
 * Generous on purpose. The question this feature asks is which of a handful of tagged
 * places you are standing in, and nobody moves between home and the gym in five minutes
 * without the next reading catching it.
 */
const LAST_KNOWN_MAX_AGE_MS = 5 * 60_000;

/**
 * How long to wait for a fresh fix before calling it unavailable.
 *
 * A GPS lock outdoors is a few seconds; indoors it is often never. Twelve seconds is long
 * enough that a slow lock still succeeds and short enough that a failed one is a passing
 * message rather than a screen that never finishes loading.
 */
const FIX_TIMEOUT_MS = 12_000;

/**
 * Rejects if `work` has not settled in time.
 *
 * The underlying request is not cancelled — expo-location offers no way to — so it may
 * still deliver later, into a `setState` this hook has already moved past. That is
 * harmless: the effect below guards its writes with `cancelled`, and a late fix would set
 * the same coordinates this one gave up on.
 */
function withDeadline<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out waiting for a position.')), ms);

    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * Where the user is, and what that means to the model.
 *
 * **Foreground only, and on demand.** No background task, no geofence transitions, no
 * `ACCESS_BACKGROUND_LOCATION`. A health app asking to follow you when it is closed is a
 * much larger promise than this feature needs: the model wants one coarse category per
 * prediction, and reading the position when the app is open answers that. The cost of
 * the honest version is that context is unknown while the app is shut — which is exactly
 * what the model's all-zeros OTHER category already means.
 */
export function useContextAwareness() {
  const { user } = useAuth();
  const userId = user?.id;

  const [status, setStatus] = useState<LocationStatus>('checking');
  const [coordinates, setCoordinates] = useState<Coordinates | null>(null);
  const [places, setPlaces] = useState<TaggedPlace[]>([]);

  const locate = useCallback(async () => {
    const permission = await Location.getForegroundPermissionsAsync();

    if (!permission.granted) {
      setStatus('denied');
      return;
    }

    try {
      // What the operating system already knows, before asking it to go and find out.
      // Indoors this is usually the only answer there is, and a fix from the last few
      // minutes is far inside the tens of metres a place tag cares about.
      const cached = await Location.getLastKnownPositionAsync({ maxAge: LAST_KNOWN_MAX_AGE_MS });

      if (cached !== null) {
        setCoordinates({
          latitude: cached.coords.latitude,
          longitude: cached.coords.longitude,
        });
        setStatus('located');
        return;
      }

      // Balanced accuracy: a geofence radius is tens of metres, so the extra battery of
      // a high-accuracy fix buys nothing here.
      //
      // Raced against a deadline because `getCurrentPositionAsync` waits for a fix and
      // has no timeout of its own: indoors, on a weak signal, it neither resolves nor
      // rejects. The screen then sits on "Finding your position…" for as long as it is
      // open, which reads as a broken app rather than a building with a thick roof.
      // Losing the race is a real answer — `unavailable` is a state this hook already
      // has and the UI already explains.
      const position = await withDeadline(
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
        FIX_TIMEOUT_MS,
      );

      setCoordinates({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      });
      setStatus('located');
    } catch {
      setStatus('unavailable');
    }
  }, []);

  const requestPermission = useCallback(async () => {
    const permission = await Location.requestForegroundPermissionsAsync();

    if (!permission.granted) {
      setStatus('denied');
      return false;
    }

    await locate();
    return true;
  }, [locate]);

  useEffect(() => {
    if (userId === undefined) return;

    let cancelled = false;

    (async () => {
      const stored = await loadPlaces(userId);
      if (cancelled) return;

      setPlaces(stored);
      await locate();
    })();

    return () => {
      cancelled = true;
    };
  }, [userId, locate]);

  const tagCurrentPlace = useCallback(
    async (label: string, context: Context, radiusMeters = 150) => {
      if (userId === undefined || coordinates === null) return;

      const next = await savePlace(userId, {
        id: `${context}-${Date.now()}`,
        label,
        context,
        latitude: coordinates.latitude,
        longitude: coordinates.longitude,
        radiusMeters,
      });

      setPlaces(next);
    },
    [userId, coordinates],
  );

  const forgetPlace = useCallback(
    async (placeId: string) => {
      if (userId === undefined) return;
      setPlaces(await removePlace(userId, placeId));
    },
    [userId],
  );

  // Null when no tagged place contains the user — the model reads that as its held-out
  // OTHER category rather than as a guess.
  const context: Context | null =
    coordinates === null ? null : classifyContext(coordinates, places);

  return {
    status,
    coordinates,
    context,
    places,
    locate,
    requestPermission,
    tagCurrentPlace,
    forgetPlace,
  };
}
