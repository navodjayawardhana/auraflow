import { useCallback } from 'react';

import { useCachedResource, type ResourceStatus } from '@/hooks/use-cached-resource';
import { fetchPlan } from '@/services/plan-service';
import { resolveTargets, type DailyTargets } from '@/services/plan-targets';
import { fetchProfile } from '@/services/profile-service';
import type { Plan, Profile } from '@/types';

/**
 * The plan, the profile behind it, and the numbers a screen should actually use.
 *
 * One hook rather than two because nothing wants half of it: a target cannot caption itself
 * without knowing whether the body figures it came from are the user's, and both sides
 * degrade to the same fallback when either request fails. Screens below the dashboard take
 * `targets` and never see a `Plan` at all — a ring does not need to know an endpoint exists.
 *
 * Both reads go through `useCachedResource`, so a cold launch in airplane mode shows the
 * last plan the device saw rather than reverting to the constants.
 */
export interface PersonalPlan {
  plan: Plan | null;
  profile: Profile | null;
  targets: DailyTargets;
  /** The plan read's own state — the profile is only ever supporting evidence for it. */
  status: ResourceStatus;
  cachedAt: Date | null;
  isStale: boolean;
  refresh: () => Promise<void>;
}

export function usePlan(): PersonalPlan {
  const { data: plan, status, cachedAt, isStale, refresh: refreshPlan } = useCachedResource(
    'plan',
    fetchPlan,
  );
  const { data: profile, refresh: refreshProfile } = useCachedResource('profile', fetchProfile);

  const refresh = useCallback(async () => {
    await Promise.all([refreshPlan(), refreshProfile()]);
  }, [refreshPlan, refreshProfile]);

  return {
    plan,
    profile,
    targets: resolveTargets(plan, profile),
    status,
    cachedAt,
    isStale,
    refresh,
  };
}
