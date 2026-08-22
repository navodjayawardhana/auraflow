import AsyncStorage from '@react-native-async-storage/async-storage';

import type { TaggedPlace } from '@/services/place-classifier';

/**
 * The user's own places, on their own device.
 *
 * Deliberately local-only: coordinates never leave the phone. The server has no idea
 * where anyone lives, and does not need to — the context label the model wants is
 * computed here from places the user tagged themselves. A health app that also holds a
 * server-side map of your home and gym is a much larger promise than this one makes.
 */

const KEY_PREFIX = 'auraflow.places.v1';

function keyFor(userId: string | number): string {
  return `${KEY_PREFIX}.${userId}`;
}

export async function loadPlaces(userId: string | number): Promise<TaggedPlace[]> {
  try {
    const raw = await AsyncStorage.getItem(keyFor(userId));
    return raw === null ? [] : (JSON.parse(raw) as TaggedPlace[]);
  } catch {
    return [];
  }
}

export async function savePlace(
  userId: string | number,
  place: TaggedPlace,
): Promise<TaggedPlace[]> {
  const existing = await loadPlaces(userId);
  const next = [...existing.filter((p) => p.id !== place.id), place];

  try {
    await AsyncStorage.setItem(keyFor(userId), JSON.stringify(next));
  } catch {
    // The place applies for this session; it just will not survive a restart.
  }

  return next;
}

export async function removePlace(
  userId: string | number,
  placeId: string,
): Promise<TaggedPlace[]> {
  const next = (await loadPlaces(userId)).filter((p) => p.id !== placeId);

  try {
    await AsyncStorage.setItem(keyFor(userId), JSON.stringify(next));
  } catch {
    // As above.
  }

  return next;
}

export async function clearPlaces(userId: string | number): Promise<void> {
  try {
    await AsyncStorage.removeItem(keyFor(userId));
  } catch {
    // Best effort.
  }
}
