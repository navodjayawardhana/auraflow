import { useCallback, useEffect, useState } from 'react';

import { useAuth } from '@/context/auth-context';
import { readCache, writeCache } from '@/services/cache';

export type ResourceStatus = 'loading' | 'loaded' | 'error';

export interface CachedResource<T> {
  data: T | null;
  status: ResourceStatus;
  /** Where the data currently on screen came from. */
  source: 'cache' | 'network' | null;
  cachedAt: Date | null;
  /** Showing cached data because the last refresh failed. */
  isStale: boolean;
  refresh: () => Promise<void>;
}

/**
 * Cache-then-network, with an honest staleness signal.
 *
 * The rule that matters: `status: 'error'` is reached only when there is no cache *and*
 * the network failed. If a cached value exists it is shown, and a failed refresh sets
 * `isStale` instead — an app that has the answer should not show an error screen just
 * because it could not check for a newer one.
 */
export function useCachedResource<T>(
  resource: string,
  fetcher: () => Promise<T>,
): CachedResource<T> {
  const { user } = useAuth();
  const userId = user?.id;

  const [data, setData] = useState<T | null>(null);
  const [status, setStatus] = useState<ResourceStatus>('loading');
  const [source, setSource] = useState<'cache' | 'network' | null>(null);
  const [cachedAt, setCachedAt] = useState<Date | null>(null);
  const [isStale, setIsStale] = useState(false);

  const fetchFresh = useCallback(
    async (hasCached: boolean) => {
      if (userId === undefined) return;

      try {
        const fresh = await fetcher();
        setData(fresh);
        setSource('network');
        setCachedAt(new Date());
        setIsStale(false);
        setStatus('loaded');
        await writeCache(userId, resource, fresh);
      } catch {
        if (hasCached) {
          // Keep what we have and say so, rather than replacing a good answer with an
          // error because the refresh could not complete.
          setIsStale(true);
          setStatus('loaded');
        } else {
          setStatus('error');
        }
      }
    },
    [fetcher, resource, userId],
  );

  const load = useCallback(async () => {
    if (userId === undefined) return;

    const cached = await readCache<T>(userId, resource);

    if (cached !== null) {
      // Render immediately from cache — a cold launch in airplane mode should show the
      // last known state, not a spinner that resolves to an error.
      setData(cached.value);
      setSource('cache');
      setCachedAt(cached.cachedAt);
      setStatus('loaded');
    }

    await fetchFresh(cached !== null);
  }, [fetchFresh, resource, userId]);

  useEffect(() => {
    load();
  }, [load]);

  const refresh = useCallback(async () => {
    await fetchFresh(data !== null);
  }, [fetchFresh, data]);

  return { data, status, source, cachedAt, isStale, refresh };
}
