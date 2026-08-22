import AsyncStorage from '@react-native-async-storage/async-storage';

import { clearNamespace, readCache, writeCache } from '@/services/cache';

jest.mock('@react-native-async-storage/async-storage', () => {
  let store: Record<string, string> = {};

  return {
    getItem: jest.fn(async (key: string) => store[key] ?? null),
    setItem: jest.fn(async (key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: jest.fn(async (key: string) => {
      delete store[key];
    }),
    getAllKeys: jest.fn(async () => Object.keys(store)),
    multiRemove: jest.fn(async (keys: string[]) => {
      keys.forEach((k) => delete store[k]);
    }),
    __reset: () => {
      store = {};
    },
  };
});

const mockStorage = AsyncStorage as unknown as { __reset: () => void };

beforeEach(() => {
  mockStorage.__reset();
});

describe('cache', () => {
  it('round-trips a value with its timestamp', async () => {
    await writeCache(1, 'recovery.2026-08-21', { score: 75 });

    const cached = await readCache<{ score: number }>(1, 'recovery.2026-08-21');

    expect(cached?.value).toEqual({ score: 75 });
    expect(cached?.cachedAt).toBeInstanceOf(Date);
  });

  it('reports a miss for a resource that was never written', async () => {
    expect(await readCache(1, 'nothing-here')).toBeNull();
  });

  it('treats a corrupt entry as a miss rather than throwing', async () => {
    await AsyncStorage.setItem('auraflow.cache.v1.1.broken', 'not json');

    expect(await readCache(1, 'broken')).toBeNull();
  });

  it('invalidates an envelope from an older schema', async () => {
    await AsyncStorage.setItem(
      'auraflow.cache.v1.1.stale',
      JSON.stringify({ v: 0, cachedAt: new Date().toISOString(), value: { score: 10 } }),
    );

    expect(await readCache(1, 'stale')).toBeNull();
  });

  it('does not let one account read another account cache', async () => {
    // The privacy property the namespacing exists for: two people sharing a handset
    // must never see each other's health data.
    await writeCache(1, 'recovery.2026-08-21', { score: 75 });

    expect(await readCache(2, 'recovery.2026-08-21')).toBeNull();
  });

  it('clears only the namespace it was asked to clear', async () => {
    await writeCache(1, 'recovery.2026-08-21', { score: 75 });
    await writeCache(2, 'recovery.2026-08-21', { score: 42 });

    await clearNamespace(1);

    expect(await readCache(1, 'recovery.2026-08-21')).toBeNull();
    expect(await readCache<{ score: number }>(2, 'recovery.2026-08-21')).not.toBeNull();
  });
});
