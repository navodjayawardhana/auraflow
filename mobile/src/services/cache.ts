import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * The local read cache.
 *
 * Deliberately *not* expo-secure-store, which the token lives in: SecureStore is
 * Keychain/Keystore backed, has a small practical value limit, and is slow for bulk
 * reads. Cached scores and sleep figures are health data but not a credential, so they
 * sit behind the device lock screen rather than behind the Keychain. The token remains
 * the only thing in SecureStore.
 */

const VERSION = 1;
const PREFIX = `auraflow.cache.v${VERSION}`;

interface Envelope<T> {
  v: number;
  cachedAt: string;
  value: T;
}

export interface CachedValue<T> {
  value: T;
  cachedAt: Date;
}

/**
 * Keys are namespaced by user id. That is a privacy requirement rather than tidiness:
 * two accounts on one handset must never see each other's health data, and signing out
 * clears exactly one namespace.
 */
function keyFor(userId: string | number, resource: string): string {
  return `${PREFIX}.${userId}.${resource}`;
}

export async function readCache<T>(
  userId: string | number,
  resource: string,
): Promise<CachedValue<T> | null> {
  try {
    const raw = await AsyncStorage.getItem(keyFor(userId, resource));
    if (raw === null) return null;

    const envelope = JSON.parse(raw) as Envelope<T>;

    // A shape change invalidates rather than crashes: an old envelope from a previous
    // release must not be handed to code that expects the new one.
    if (envelope.v !== VERSION) return null;

    return { value: envelope.value, cachedAt: new Date(envelope.cachedAt) };
  } catch {
    // A corrupt entry is a cache miss, never an error the caller has to handle.
    return null;
  }
}

export async function writeCache<T>(
  userId: string | number,
  resource: string,
  value: T,
): Promise<void> {
  const envelope: Envelope<T> = { v: VERSION, cachedAt: new Date().toISOString(), value };

  try {
    await AsyncStorage.setItem(keyFor(userId, resource), JSON.stringify(envelope));
  } catch {
    // Failing to cache is not failing to work — the network result already reached the
    // screen, so a full disk should not surface as an error.
  }
}

/** Everything belonging to one account. Called on sign-out. */
export async function clearNamespace(userId: string | number): Promise<void> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const mine = keys.filter((k) => k.startsWith(`${PREFIX}.${userId}.`));

    if (mine.length > 0) {
      await AsyncStorage.multiRemove(mine);
    }
  } catch {
    // Best effort; the token is cleared regardless, so the data is unreachable anyway.
  }
}
