import { useNetworkState } from 'expo-network';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { flush, pendingCount } from '@/services/outbox';

/**
 * Drains the offline write queue when the app is plausibly able to reach the server.
 *
 * Two triggers, because either alone leaves a hole: regaining connectivity while the app
 * is open, and returning to a foreground that was backgrounded on a dead connection.
 */
export function useOutboxFlush(onFlushed?: () => void) {
  const network = useNetworkState();
  const [pending, setPending] = useState(0);
  const isFlushing = useRef(false);

  const refreshCount = useCallback(async () => {
    setPending(await pendingCount());
  }, []);

  const attemptFlush = useCallback(async () => {
    // A flush already in flight must not be started twice — the two triggers can fire
    // within milliseconds of each other on a resume-with-reconnect.
    if (isFlushing.current) return;

    isFlushing.current = true;
    try {
      const result = await flush();
      setPending(result.remaining);
      if (result.sent > 0) {
        onFlushed?.();
      }
    } finally {
      isFlushing.current = false;
    }
  }, [onFlushed]);

  useEffect(() => {
    refreshCount();
  }, [refreshCount]);

  useEffect(() => {
    if (network.isInternetReachable) {
      attemptFlush();
    }
  }, [network.isInternetReachable, attemptFlush]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        attemptFlush();
      }
    });

    return () => subscription.remove();
  }, [attemptFlush]);

  return { pending, isOnline: network.isInternetReachable !== false, refreshCount };
}
