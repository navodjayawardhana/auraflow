import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInUp } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { OfflineBanner } from '@/components/offline-banner';
import { PrimaryButton } from '@/components/primary-button';
import { Font, Layout, Radius, Shadows, Surfaces, Type } from '@/constants/design';
import { AuraColors, IconTones } from '@/constants/theme';
import { useCachedResource } from '@/hooks/use-cached-resource';
import { basisSummary, listMissing } from '@/services/plan-provenance';
import { fetchPlanHistory } from '@/services/plan-service';
import type { Plan } from '@/types';

/**
 * What each version is worth showing, in the order the plan screen lists them.
 *
 * Heart-rate zones are here even though they can never be hand-set: a version whose zones
 * appeared for the first time — because a date of birth finally existed — is exactly the
 * kind of change this screen is for.
 */
const FIELDS: { key: string; label: string; format: (version: Plan) => string }[] = [
  { key: 'step_goal', label: 'Steps', format: (v) => v.step_goal.toLocaleString() },
  { key: 'water_ml', label: 'Water', format: (v) => `${v.water_ml.toLocaleString()} ml` },
  {
    key: 'active_kcal_goal',
    label: 'Active energy',
    format: (v) =>
      v.active_kcal_goal === null ? '—' : `${v.active_kcal_goal.toLocaleString()} kcal`,
  },
  { key: 'sleep_need_hours', label: 'Sleep need', format: (v) => `${v.sleep_need_hours} h` },
  {
    key: 'hr_zones',
    label: 'Heart-rate zones',
    format: (v) => (v.hr_zones === null ? '—' : `${v.hr_zones.easy[0]}–${v.hr_zones.hard[1]} bpm`),
  },
];

function whenOf(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function VersionCard({ version, index }: { version: Plan; index: number }) {
  const edited = new Set(version.edited_fields);

  return (
    <Animated.View entering={FadeInUp.delay(index * 60).duration(400)} style={styles.card}>
      <View style={styles.cardHead}>
        <Text style={Type.cardTitle}>Version {version.version}</Text>
        <View
          style={[
            styles.badge,
            { backgroundColor: version.source === 'edited' ? IconTones.caution.bg : IconTones.brand.bg },
          ]}>
          <Text
            style={[
              styles.badgeLabel,
              { color: version.source === 'edited' ? AuraColors.caution : AuraColors.brand.default },
            ]}>
            {version.source === 'edited' ? 'EDITED' : 'DERIVED'}
          </Text>
        </View>
      </View>

      <Text style={Type.caption}>{whenOf(version.created_at)}</Text>

      {FIELDS.map((field) => {
        const isEdited = edited.has(field.key);

        return (
          <View key={field.key} style={styles.row}>
            {/* A pencil, not a colour: which numbers the user chose over the formula is the
                one thing this screen exists to answer, and it has to survive a screenshot
                in greyscale. */}
            <Feather
              name={isEdited ? 'edit-3' : 'cpu'}
              size={13}
              color={isEdited ? AuraColors.caution : '#94a3b8'}
            />
            <Text style={styles.rowLabel}>{field.label}</Text>
            <Text style={[styles.rowValue, isEdited && styles.rowValueEdited]}>
              {field.format(version)}
            </Text>
          </View>
        );
      })}

      <Text style={Type.caption}>
        {version.edited_fields.length === 0
          ? `Every target derived · ${basisSummary(version.basis)}`
          : `You set ${version.edited_fields.length} of these by hand · ${basisSummary(version.basis)}`}
      </Text>

      {version.basis.missing.length > 0 ? (
        <Text style={Type.caption}>
          Worked out without {listMissing(version.basis.missing)}.
        </Text>
      ) : null}
    </Animated.View>
  );
}

export default function PlanHistoryScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [isRefreshing, setIsRefreshing] = useState(false);

  const { data, status, cachedAt, isStale, refresh } = useCachedResource(
    'plan.history',
    fetchPlanHistory,
  );

  async function handleRefresh() {
    setIsRefreshing(true);
    await refresh();
    setIsRefreshing(false);
  }

  const versions = data ?? [];

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 14 }]}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} />}>
        <View style={styles.header}>
          <View style={styles.headerText}>
            <Text style={Type.eyebrow}>YOUR PLAN</Text>
            <Text style={Type.screenTitle}>Earlier versions</Text>
          </View>

          <Pressable
            onPress={() => router.back()}
            accessibilityRole="button"
            accessibilityLabel="Close"
            hitSlop={10}
            style={styles.close}>
            <Feather name="x" size={18} color={AuraColors.content.default} />
          </Pressable>
        </View>

        {isStale ? <OfflineBanner cachedAt={cachedAt} /> : null}

        {status === 'loading' ? (
          <View style={styles.skeleton} />
        ) : status === 'error' ? (
          <View style={styles.card}>
            <Text style={Type.cardTitle}>Couldn&apos;t load your earlier versions</Text>
            <PrimaryButton label="Retry" onPress={refresh} />
          </View>
        ) : versions.length === 0 ? (
          <View style={styles.card}>
            <Text style={Type.cardTitle}>Nothing here yet</Text>
            <Text style={Type.prose}>
              Every recalculation and every target you override is kept, so you can see what
              your plan used to say and which of it was your decision.
            </Text>
          </View>
        ) : (
          versions.map((version, index) => (
            <VersionCard key={version.version} version={version} index={index} />
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: AuraColors.surface.sunken },
  scroll: {
    paddingHorizontal: Layout.gutter,
    paddingBottom: Layout.scrollBottom,
    gap: Layout.gapCards,
  },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  headerText: { flex: 1, gap: 4 },
  close: {
    width: 36,
    height: 36,
    borderRadius: Radius.iconSquare,
    backgroundColor: AuraColors.surface.default,
    alignItems: 'center',
    justifyContent: 'center',
    ...Shadows.chip,
  },
  skeleton: { height: 200, borderRadius: Radius.card, backgroundColor: AuraColors.surface.raised },
  card: { ...Surfaces.card, gap: 10 },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  badge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: Radius.pill },
  badgeLabel: { ...Type.badge, letterSpacing: 0.6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 9, minHeight: 24 },
  rowLabel: { flex: 1, fontFamily: Font.regular, fontSize: 12, color: AuraColors.content.muted },
  rowValue: {
    fontFamily: Font.semibold,
    fontSize: 13,
    color: AuraColors.content.default,
    fontVariant: ['tabular-nums'],
  },
  rowValueEdited: { color: AuraColors.caution },
});
