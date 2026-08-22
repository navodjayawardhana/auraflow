import * as Location from 'expo-location';
import { useCallback, useEffect, useState } from 'react';

import { useAuth } from '@/context/auth-context';
import type { Context } from '@/ml/focus-features';
import { classifyContext, type Coordinates, type TaggedPlace } from '@/services/place-classifier';
import { loadPlaces, removePlace, savePlace } from '@/services/places-store';

export type LocationStatus = 'checking' | 'denied' | 'unavailable' | 'located';

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
      // Balanced accuracy: a geofence radius is tens of metres, so the extra battery of
      // a high-accuracy fix buys nothing here.
      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

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
