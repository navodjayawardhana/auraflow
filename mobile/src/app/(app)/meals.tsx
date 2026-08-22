import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInUp } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  Font,
  GradientAxis,
  Layout,
  Radius,
  Shadows,
  Surfaces,
  Type,
} from '@/constants/design';
import { AuraColors, IconTones } from '@/constants/theme';
import { WaterTracker } from '@/components/water-tracker';
import { useCachedResource } from '@/hooks/use-cached-resource';
import { useSteps } from '@/hooks/use-steps';
import { estimateActiveKcal } from '@/services/energy';
import { fetchHealthSnapshots } from '@/services/health-snapshot-service';
import { fetchDay, removeMeal, type MealEntry } from '@/services/meal-service';
import { todayIsoDate } from '@/services/recovery-service';

function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

/**
 * How each kind of figure introduces itself.
 *
 * A photo estimate gets its own row rather than borrowing the user's: they own a number
 * they typed, and they do not own one a model read off a picture with no scale in it.
 */
const Provenance = {
  lookup: { icon: 'check-circle', tone: IconTones.success, label: 'Open Food Facts' },
  estimate: { icon: 'edit-3', tone: IconTones.caution, label: 'your estimate' },
  photo: { icon: 'camera', tone: IconTones.stage, label: 'from a photo, checked by you' },
} as const;

function MealRow({ meal, onRemove }: { meal: MealEntry; onRemove: () => void }) {
  const provenance = Provenance[meal.source];
  const isMeasured = meal.source === 'lookup';

  return (
    <View style={styles.mealRow}>
      <View style={[styles.mealIcon, { backgroundColor: provenance.tone.bg }]}>
        <Feather name={provenance.icon} size={16} color={provenance.tone.color} />
      </View>

      <View style={styles.mealText}>
        <Text style={Type.rowTitle}>{meal.name}</Text>
        {/* Provenance on every row: a looked-up figure and a guess are different claims. */}
        <Text style={Type.caption}>
          {provenance.label} · {timeOf(meal.eaten_at)}
          {meal.portion_g ? ` · ${meal.portion_g} g` : ''}
        </Text>
      </View>

      <View style={styles.mealValue}>
        {!isMeasured ? <Text style={styles.approx}>≈</Text> : null}
        <Text style={styles.mealKcal}>{meal.kcal}</Text>
        <Text style={Type.caption}>kcal</Text>
      </View>

      <Pressable
        onPress={onRemove}
        accessibilityRole="button"
        accessibilityLabel={`Remove ${meal.name}`}
        hitSlop={10}
        style={styles.remove}>
        <Feather name="x" size={15} color="#94a3b8" />
      </Pressable>
    </View>
  );
}

export default function MealsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [isRefreshing, setIsRefreshing] = useState(false);

  const today = todayIsoDate();
  const fetcher = useCallback(() => fetchDay(today), [today]);
  const { data, refresh } = useCachedResource(`meals.${today}`, fetcher);

  const steps = useSteps();
  const activeKcal = steps.status === 'counting' ? estimateActiveKcal(steps.today) : null;

  // Water lives on the daily snapshot rather than with meals — it is a running total for
  // the day, not a series of events with times.
  const snapshotFetcher = useCallback(() => fetchHealthSnapshots(today, today), [today]);
  const { data: snapshots, refresh: refreshSnapshots } = useCachedResource(
    `health-snapshots.${today}`,
    snapshotFetcher,
  );
  const waterMl = snapshots?.[0]?.water_ml ?? null;

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  async function handleRefresh() {
    setIsRefreshing(true);
    await refresh();
    setIsRefreshing(false);
  }

  async function handleRemove(id: number) {
    await removeMeal(id);
    await refresh();
  }

  const meals = data?.meals ?? [];
  const eaten = data?.totalKcal ?? 0;
  const macros = { protein: data?.proteinG ?? 0, carbs: data?.carbsG ?? 0, fat: data?.fatG ?? 0 };
  const macroTotal = macros.protein + macros.carbs + macros.fat;
  const withMacros = meals.filter((m) => m.protein_g !== null).length;

  const dateLabel = new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 14 }]}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} />}>
        <View style={styles.header}>
          <View style={styles.headerText}>
            <Text style={Type.eyebrow}>{dateLabel.toUpperCase()}</Text>
            <Text style={Type.screenTitle}>Nutrition</Text>
          </View>

          <Pressable
            onPress={() => router.push('/log-meal')}
            accessibilityRole="button"
            accessibilityLabel="Log a meal"
            style={styles.headerPill}>
            <Feather name="plus" size={15} color={AuraColors.brand.default} />
            <Text style={styles.headerPillLabel}>Log</Text>
          </Pressable>
        </View>

        {/* In vs out — deliberately two figures side by side, never a difference. */}
        <Animated.View entering={FadeInUp.duration(400)} style={styles.card}>
          <View style={styles.inOut}>
            <View style={styles.inOutSide}>
              <Text style={styles.inOutLabel}>EATEN</Text>
              <View style={styles.inOutValue}>
                <Text style={Type.headlineMetric}>{eaten.toLocaleString()}</Text>
                <Text style={styles.inOutUnit}>kcal</Text>
              </View>
            </View>

            <View style={[styles.inOutSide, styles.inOutRight]}>
              <Text style={styles.inOutLabel}>ACTIVE</Text>
              <View style={styles.inOutValue}>
                {activeKcal !== null ? <Text style={styles.approxLarge}>≈</Text> : null}
                <Text style={Type.headlineMetric}>{activeKcal ?? '—'}</Text>
                <Text style={styles.inOutUnit}>kcal</Text>
              </View>
            </View>
          </View>

          <View style={styles.proportion}>
            <LinearGradient
              colors={['#0f9d58', '#34d399']}
              start={GradientAxis.deg90.start}
              end={GradientAxis.deg90.end}
              style={[styles.proportionBar, { flex: Math.max(eaten, 1) }]}
            />
            <View
              style={[
                styles.proportionBar,
                { flex: Math.max(activeKcal ?? 0, 1), backgroundColor: AuraColors.accent.deep },
              ]}
            />
          </View>

          <View style={styles.noteBlock}>
            <Feather name="info" size={13} color={AuraColors.content.muted} />
            <Text style={styles.noteText}>
              No net figure — AuraFlow doesn&apos;t know your basal metabolic rate, and a balance
              computed without it would be wrong by roughly 1,500 kcal.
            </Text>
          </View>
        </Animated.View>

        {macroTotal > 0 ? (
          <Animated.View entering={FadeInUp.delay(80).duration(400)} style={styles.card}>
            <View style={styles.cardHead}>
              <Text style={Type.cardTitle}>Macros</Text>
              <Text style={Type.caption}>
                from {withMacros} of {meals.length} item{meals.length === 1 ? '' : 's'}
              </Text>
            </View>

            <View style={styles.macroBar}>
              <View style={[styles.macroSegment, { flex: Math.max(macros.protein, 0.001), backgroundColor: AuraColors.brand.default }]} />
              <View style={[styles.macroSegment, { flex: Math.max(macros.carbs, 0.001), backgroundColor: AuraColors.accent.default }]} />
              <View style={[styles.macroSegment, { flex: Math.max(macros.fat, 0.001), backgroundColor: AuraColors.caution }]} />
            </View>

            <View style={styles.macroGrid}>
              <Macro color={AuraColors.brand.default} label="Protein" grams={macros.protein} />
              <Macro color={AuraColors.accent.default} label="Carbs" grams={macros.carbs} />
              <Macro color={AuraColors.caution} label="Fat" grams={macros.fat} />
            </View>

            {withMacros < meals.length ? (
              <Text style={Type.caption}>
                {meals.length - withMacros} item
                {meals.length - withMacros === 1 ? ' was' : 's were'} logged as an estimate and
                carr{meals.length - withMacros === 1 ? 'ies' : 'y'} no macro breakdown.
              </Text>
            ) : null}
          </Animated.View>
        ) : null}

        <WaterTracker waterMl={waterMl} onLogged={refreshSnapshots} />

        <Animated.View entering={FadeInUp.delay(160).duration(400)} style={styles.card}>
          <Text style={Type.cardTitle}>Today&apos;s meals</Text>

          {meals.length === 0 ? (
            <Text style={Type.caption}>Nothing logged yet. Tap Log to add something.</Text>
          ) : (
            meals.map((meal) => (
              <MealRow key={meal.id} meal={meal} onRemove={() => handleRemove(meal.id)} />
            ))
          )}
        </Animated.View>
      </ScrollView>
    </View>
  );
}

function Macro({ color, label, grams }: { color: string; label: string; grams: number }) {
  return (
    <View style={styles.macro}>
      <View style={styles.macroHead}>
        <View style={[styles.macroDot, { backgroundColor: color }]} />
        <Text style={Type.tileLabel}>{label}</Text>
      </View>
      <View style={styles.macroValue}>
        <Text style={styles.macroGrams}>{grams}</Text>
        <Text style={styles.macroUnit}>g</Text>
      </View>
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
  header: { flexDirection: 'row', alignItems: 'flex-end', gap: 12, marginBottom: 4 },
  headerText: { flex: 1, gap: 4 },
  headerPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 36,
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: AuraColors.surface.default,
    ...Shadows.chip,
  },
  headerPillLabel: { fontFamily: Font.semibold, fontSize: 13, color: AuraColors.brand.default },
  card: { ...Surfaces.card, gap: 14 },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  inOut: { flexDirection: 'row', justifyContent: 'space-between', gap: 16 },
  inOutSide: { gap: 3 },
  inOutRight: { alignItems: 'flex-end' },
  inOutLabel: {
    fontFamily: Font.semibold,
    fontSize: 10,
    letterSpacing: 1.6,
    color: '#94a3b8',
  },
  inOutValue: { flexDirection: 'row', alignItems: 'baseline', gap: 4 },
  inOutUnit: { fontFamily: Font.regular, fontSize: 12, color: AuraColors.content.muted },
  approx: { fontFamily: Font.semibold, fontSize: 13, color: AuraColors.content.muted },
  approxLarge: { fontFamily: Font.semibold, fontSize: 20, color: AuraColors.content.muted },
  proportion: { flexDirection: 'row', gap: 4 },
  proportionBar: { height: 10, borderRadius: 999 },
  noteBlock: { ...Surfaces.panel, flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  noteText: {
    flex: 1,
    fontFamily: Font.regular,
    fontSize: 10,
    lineHeight: 15,
    color: AuraColors.content.muted,
  },
  macroBar: { flexDirection: 'row', gap: 2, height: 12, borderRadius: 999, overflow: 'hidden' },
  macroSegment: { height: 12 },
  macroGrid: { flexDirection: 'row', gap: 10 },
  macro: { flex: 1, gap: 4 },
  macroHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  macroDot: { width: 8, height: 8, borderRadius: 999 },
  macroValue: { flexDirection: 'row', alignItems: 'baseline', gap: 2 },
  macroGrams: {
    fontFamily: Font.bold,
    fontSize: 16,
    color: AuraColors.content.default,
    fontVariant: ['tabular-nums'],
  },
  macroUnit: { fontFamily: Font.medium, fontSize: 11, color: AuraColors.content.muted },
  mealRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  mealIcon: {
    width: 40,
    height: 40,
    borderRadius: Radius.iconMedium,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mealText: { flex: 1, gap: 2 },
  mealValue: { flexDirection: 'row', alignItems: 'baseline', gap: 3 },
  mealKcal: {
    fontFamily: Font.bold,
    fontSize: 15,
    color: AuraColors.content.default,
    fontVariant: ['tabular-nums'],
  },
  remove: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
});
