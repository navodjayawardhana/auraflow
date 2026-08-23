import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Where the app remembers that somebody is halfway through a password reset.
 *
 * The reset screen normally receives the address as a navigation param. That is enough
 * right up until the person switches to their mail app to read the code, and the OS
 * reclaims AuraFlow's memory while they are there — which on a mid-range Android handset
 * with a mail client open is not a rare event, it is the *expected* path through this
 * flow. Coming back to a screen that has forgotten which address it was resetting, with a
 * live code in hand and no way to spend it, is the worst moment in the whole feature.
 *
 * Deliberately not in `cache.ts`. That store is namespaced by user id and versions server
 * reads; this is neither — nobody is signed in yet, and it is UI continuity rather than
 * data.
 *
 * Deliberately not in SecureStore either. The address is not a secret, and the code
 * never touches this file: the only thing worth persisting is *which* reset is in
 * progress. Writing the code to disk would take a fifteen-minute secret and give it the
 * lifetime of the filesystem.
 */

const KEY = 'auraflow.pendingPasswordReset';

/** Mirrors PasswordResetChallenge::TTL_MINUTES on the API. */
export const RESET_CODE_TTL_MINUTES = 15;

interface PendingReset {
  email: string;
  /** ISO 8601, so a stale marker can be dropped rather than pointing at a dead code. */
  requestedAt: string;
}

export async function rememberPendingReset(email: string): Promise<void> {
  try {
    const pending: PendingReset = { email, requestedAt: new Date().toISOString() };
    await AsyncStorage.setItem(KEY, JSON.stringify(pending));
  } catch {
    // Failing to remember costs the person one extra tap on "Back to sign in". It is not
    // worth failing a reset they can otherwise complete on this screen right now.
  }
}

/**
 * Null once the code it refers to must already have expired.
 *
 * Resolving a marker older than the code's life would drop somebody onto a screen asking
 * for a code that cannot work. Better to send them back to the start, where the first
 * thing they see is the button that issues a new one.
 */
export async function readPendingReset(): Promise<string | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (raw === null) return null;

    const pending = JSON.parse(raw) as PendingReset;
    const ageMs = Date.now() - new Date(pending.requestedAt).getTime();

    if (!Number.isFinite(ageMs) || ageMs > RESET_CODE_TTL_MINUTES * 60_000) {
      await forgetPendingReset();
      return null;
    }

    return pending.email;
  } catch {
    // A corrupt marker is no marker, never an error the screen has to handle.
    return null;
  }
}

export async function forgetPendingReset(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    // Nothing readable is left behind that matters — the marker holds an address, not a
    // code — and it self-expires on the next read anyway.
  }
}
