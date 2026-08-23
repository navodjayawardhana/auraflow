import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInUp } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DatePickerSheet } from '@/components/date-picker-sheet';
import { WaterTracker } from '@/components/water-tracker';
import { Font, GradientAxis, Layout, Radius, Shadows, Surfaces, Type } from '@/constants/design';
import { AuraColors, IconTones } from '@/constants/theme';
import { useCachedResource } from '@/hooks/use-cached-resource';
import { usePlan } from '@/hooks/use-plan';
import { useSteps } from '@/hooks/use-steps';
import { estimateActiveKcal } from '@/services/energy';
import { fetchHealthSnapshots } from '@/services/health-snapshot-service';
import {
  fetchWindow,
  removeMeal,
  type MealEntry,
  type NutritionTotals,
  type PeriodBucket,
} from '@/services/meal-service';
import {
  bandMeals,
  isApproximate,
  isCurrent,
  macroCoverageNote,
  periodSubtitle,
  periodTitle,
  periodWindow,
  provenanceNote,
  retargetWindow,
  shiftPeriodWindow,
  type PeriodKind,
} from '@/services/nutrition-history';
import { activeKcalCaption } from '@/services/plan-targets';
import { shiftIsoDate, todayIsoDate } from '@/services/recovery-service';

/**
 * How far back the history can be paged.
 *
 * A year, which is as much as the calendar sheet needs to offer and rather more than the
 * app is old. It bounds the date picker rather than the data — nothing older is hidden,
 * there is simply no way to have logged it.
 */
const EARLIEST_DAYS_BACK = 365;

const PERIODS: { kind: PeriodKind; label: string }[] = [
  { kind: 'day', label: 'Day' },
  { kind: 'week', label: 'Week' },
  { kind: 'month', label: 'Month' },
];

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

/**
 * One bucket of a longer window — a day inside a week, a week inside a month.
 *
 * The bar is a share of the busiest bucket on screen, not of any goal. It is there to
 * shape the period at a glance; putting a target behind it would turn a diary into a
 * verdict, and the app does not know enough about anyone to deliver one.
 */
function BucketRow({
  label,
  detail,
  bucket,
  busiest,
  onPress,
}: {
  label: string;
  detail: string;
  bucket: PeriodBucket;
  busiest: number;
  onPress: () => void;
}) {
  const isEmpty = bucket.meal_count === 0;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label}, ${bucket.kcal} kcal`}
      style={styles.bucketRow}>
      <View style={styles.bucketText}>
        <Text style={[Type.rowTitle, isEmpty && styles.bucketMuted]}>{label}</Text>
        <Text style={Type.caption}>{detail}</Text>
      </View>

      <View style={styles.bucketTrack}>
        <View
          style={[
            styles.bucketFill,
            { width: `${Math.round((bucket.kcal / busiest) * 100)}%` },
            bucket.measured_kcal === bucket.kcal && styles.bucketFillMeasured,
          ]}
        />
      </View>

      <View style={styles.bucketValue}>
        {bucket.estimated_kcal > 0 ? <Text style={styles.approx}>≈</Text> : null}
        <Text style={[styles.mealKcal, isEmpty && styles.bucketMuted]}>
          {bucket.kcal.toLocaleString()}
        </Text>
      </View>
    </Pressable>
  );
}

/** The measured share of a total, drawn as the proportion of the bar it actually is. */
function ProvenanceBar({ totals }: { totals: NutritionTotals }) {
  if (totals.kcal === 0) return null;

  return (
    <View style={styles.proportion}>
      {totals.measured_kcal > 0 ? (
        <LinearGradient
          colors={['#0f9d58', '#34d399']}
          start={GradientAxis.deg90.start}
          end={GradientAxis.deg90.end}
          style={[styles.proportionBar, { flex: totals.measured_kcal }]}
        />
      ) : null}
      {totals.estimated_kcal > 0 ? (
        <View
          style={[
            styles.proportionBar,
            styles.proportionEstimated,
            { flex: totals.estimated_kcal },
          ]}
        />
      ) : null}
    </View>
  );
}

export default function MealsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [isRefreshing, setIsRefreshing] = useState(false);

  const today = todayIsoDate();
  const earliest = shiftIsoDate(today, -EARLIEST_DAYS_BACK);

  const [window, setWindow] = useState(() => periodWindow('day', today));
  const [isPickingDate, setIsPickingDate] = useState(false);

  const { from, to, kind } = window;
  const fetcher = useCallback(() => fetchWindow(from, to), [from, to]);
  const { data, status, refresh } = useCachedResource(`meals.${from}.${to}`, fetcher);

  const isToday = kind === 'day' && from === today;
  const isLatest = isCurrent(window, today);
  const isEarliest = from <= earliest;

  const steps = useSteps();
  const { targets } = usePlan();
  const activeKcal =
    steps.status === 'counting' ? estimateActiveKcal(steps.today, targets.weightKg) : null;

  // Water lives on the daily snapshot rather than with meals — it is a running total for
  // the day, not a series of events with times — so it only belongs on a single day's view.
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

  /** Paging stops at today going forward, and at the calendar's own floor going back. */
  function step(periods: number) {
    if (periods > 0 && isLatest) return;
    if (periods < 0 && isEarliest) return;

    setWindow(shiftPeriodWindow(window, periods));
  }

  function openAt(kindToOpen: PeriodKind, anchor: string) {
    setWindow(periodWindow(kindToOpen, anchor));
  }

  const meals = data?.meals ?? [];
  const totals = data?.totals ?? null;
  const eaten = totals?.kcal ?? 0;
  const isLoading = status === 'loading' && data === null;
  const hasFailed = status === 'error';

  const macroTotal = (totals?.protein_g ?? 0) + (totals?.carbs_g ?? 0) + (totals?.fat_g ?? 0);
  const note = totals === null ? null : provenanceNote(totals);
  const macroNote = totals === null ? null : macroCoverageNote(totals);

  // A week is read as its days; a month as its weeks. A month as thirty-one rows would be
  // a wall of numbers nobody scans, and a week as one row would say nothing at all.
  const buckets = kind === 'week' ? (data?.days ?? []) : kind === 'month' ? (data?.weeks ?? []) : [];
  const busiest = Math.max(...buckets.map((bucket) => bucket.kcal), 1);

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 14 }]}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} />}>
        <View style={styles.header}>
          <View style={styles.headerText}>
            <Text style={Type.eyebrow}>Nutrition</Text>
            <Text style={Type.screenTitle}>{periodTitle(window, today)}</Text>
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

        <Animated.View entering={FadeInUp.duration(360)} style={styles.card}>
          <View style={styles.segmented}>
            {PERIODS.map((period) => {
              const isSelected = period.kind === kind;

              return (
                <Pressable
                  key={period.kind}
                  onPress={() => setWindow(retargetWindow(window, period.kind, today))}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isSelected }}
                  style={[styles.segment, isSelected && styles.segmentSelected]}>
                  <Text style={[styles.segmentLabel, isSelected && styles.segmentLabelSelected]}>
                    {period.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <View style={styles.dateRow}>
            <Pressable
              onPress={() => step(-1)}
              disabled={isEarliest}
              accessibilityRole="button"
              accessibilityLabel={`The ${kind} before`}
              hitSlop={10}
              style={[styles.step, isEarliest && styles.stepDisabled]}>
              <Feather
                name="chevron-left"
                size={18}
                color={isEarliest ? AuraColors.surface.selected : AuraColors.content.default}
              />
            </Pressable>

            {/* The span in full, every time. "This week" and "this month" are both
                ambiguous, and a total the reader cannot reproduce is worse than none. */}
            <Pressable
              onPress={() => setIsPickingDate(true)}
              accessibilityRole="button"
              accessibilityLabel="Jump to a date"
              style={styles.dateText}>
              <Text style={styles.dateLabel}>{periodSubtitle(window, today)}</Text>
              <Feather name="calendar" size={13} color={AuraColors.content.muted} />
            </Pressable>

            <Pressable
              onPress={() => step(1)}
              disabled={isLatest}
              accessibilityRole="button"
              accessibilityLabel={`The ${kind} after`}
              hitSlop={10}
              style={[styles.step, isLatest && styles.stepDisabled]}>
              <Feather
                name="chevron-right"
                size={18}
                color={isLatest ? AuraColors.surface.selected : AuraColors.content.default}
              />
            </Pressable>
          </View>
        </Animated.View>

        <Animated.View entering={FadeInUp.delay(60).duration(400)} style={styles.card}>
          {/* In vs out — deliberately two figures side by side, never a difference. The
              active side is today's only: step counting runs while the app is open, so
              there is no honest figure for it on any other day. */}
          <View style={styles.inOut}>
            <View style={styles.inOutSide}>
              <Text style={styles.inOutLabel}>EATEN</Text>
              <View style={styles.inOutValue}>
                {totals !== null && isApproximate(totals) ? (
                  <Text style={styles.approxLarge}>≈</Text>
                ) : null}
                <Text style={Type.headlineMetric}>{eaten.toLocaleString()}</Text>
                <Text style={styles.inOutUnit}>kcal</Text>
              </View>
            </View>

            {isToday ? (
              <View style={[styles.inOutSide, styles.inOutRight]}>
                <Text style={styles.inOutLabel}>ACTIVE</Text>
                <View style={styles.inOutValue}>
                  {activeKcal !== null ? <Text style={styles.approxLarge}>≈</Text> : null}
                  <Text style={Type.headlineMetric}>{activeKcal ?? '—'}</Text>
                  <Text style={styles.inOutUnit}>kcal</Text>
                </View>
              </View>
            ) : (
              <View style={[styles.inOutSide, styles.inOutRight]}>
                <Text style={styles.inOutLabel}>MEALS</Text>
                <View style={styles.inOutValue}>
                  <Text style={Type.headlineMetric}>{totals?.meal_count ?? 0}</Text>
                </View>
              </View>
            )}
          </View>

          {/* Measured against guessed, drawn to scale. The ≈ says the figure is
              approximate; this says how much of it is. */}
          {totals !== null ? <ProvenanceBar totals={totals} /> : null}

          {note !== null ? <Text style={Type.caption}>{note}</Text> : null}

          {isToday ? (
            <Text style={Type.caption}>Active energy {activeKcalCaption(targets)}.</Text>
          ) : null}

          <View style={styles.noteBlock}>
            <Feather name="info" size={13} color={AuraColors.content.muted} />
            <Text style={styles.noteText}>
              No net figure — AuraFlow doesn&apos;t know your basal metabolic rate, and a balance
              computed without it would be wrong by roughly 1,500 kcal.
            </Text>
          </View>
        </Animated.View>

        {macroTotal > 0 && totals !== null ? (
          <Animated.View entering={FadeInUp.delay(120).duration(400)} style={styles.card}>
            <View style={styles.cardHead}>
              <Text style={Type.cardTitle}>Macros</Text>
              <Text style={Type.caption}>
                from {totals.meals_with_macros} of {totals.meal_count} item
                {totals.meal_count === 1 ? '' : 's'}
              </Text>
            </View>

            <View style={styles.macroBar}>
              <View
                style={[
                  styles.macroSegment,
                  { flex: Math.max(totals.protein_g, 0.001), backgroundColor: AuraColors.brand.default },
                ]}
              />
              <View
                style={[
                  styles.macroSegment,
                  { flex: Math.max(totals.carbs_g, 0.001), backgroundColor: AuraColors.accent.default },
                ]}
              />
              <View
                style={[
                  styles.macroSegment,
                  { flex: Math.max(totals.fat_g, 0.001), backgroundColor: AuraColors.caution },
                ]}
              />
            </View>

            <View style={styles.macroGrid}>
              <Macro color={AuraColors.brand.default} label="Protein" grams={totals.protein_g} />
              <Macro color={AuraColors.accent.default} label="Carbs" grams={totals.carbs_g} />
              <Macro color={AuraColors.caution} label="Fat" grams={totals.fat_g} />
            </View>

            {macroNote !== null ? <Text style={Type.caption}>{macroNote}</Text> : null}
          </Animated.View>
        ) : null}

        {isToday ? (
          <WaterTracker
            waterMl={waterMl}
            goalMl={targets.waterMl}
            goalSource={targets.source}
            onLogged={refreshSnapshots}
          />
        ) : null}

        <Animated.View entering={FadeInUp.delay(180).duration(400)} style={styles.card}>
          <Text style={Type.cardTitle}>
            {kind === 'day' ? 'What you ate' : kind === 'week' ? 'Day by day' : 'Week by week'}
          </Text>

          {isLoading ? (
            <Text style={Type.caption}>Loading…</Text>
          ) : hasFailed ? (
            <Text style={Type.caption}>
              Couldn&apos;t reach AuraFlow, and there is nothing saved on this phone for these
              dates. Pull down to try again.
            </Text>
          ) : kind === 'day' ? (
            meals.length === 0 ? (
              <Text style={Type.caption}>
                {isToday
                  ? 'Nothing logged yet today. Tap Log — you can set the time it was eaten, so catching up later still lands on the right meal.'
                  : 'Nothing was logged on this day. You can still add it: tap Log and set the date.'}
              </Text>
            ) : (
              /* Banded by clock time, not named as breakfast and lunch. The app knows when
                 a meal was eaten and not what it was; someone on nights eats their largest
                 meal at four in the morning. */
              bandMeals(meals).map((group) => (
                <View key={group.band} style={styles.band}>
                  <Text style={Type.eyebrow}>{group.band}</Text>
                  {group.meals.map((meal) => (
                    <MealRow key={meal.id} meal={meal} onRemove={() => handleRemove(meal.id)} />
                  ))}
                </View>
              ))
            )
          ) : totals === null || totals.meal_count === 0 ? (
            /* Every day of the period at zero would be seven honest rows saying one thing.
               The sentence says it once and points at the way out. */
            <Text style={Type.caption}>
              Nothing logged in {isLatest ? `this ${kind}` : `that ${kind}`}. A meal added with
              an earlier date lands here, not on the day you type it.
            </Text>
          ) : (
            buckets.map((bucket) => (
              <BucketRow
                key={bucket.start}
                label={
                  kind === 'week'
                    ? new Date(`${bucket.start}T00:00:00`).toLocaleDateString(undefined, {
                        weekday: 'long',
                      })
                    : `${dayAndMonth(bucket.start)} – ${dayAndMonth(bucket.end)}`
                }
                detail={
                  bucket.meal_count === 0
                    ? 'nothing logged'
                    : bucket.partial
                      ? `${bucket.meal_count} item${bucket.meal_count === 1 ? '' : 's'} · part week`
                      : `${bucket.meal_count} item${bucket.meal_count === 1 ? '' : 's'}`
                }
                bucket={bucket}
                busiest={busiest}
                onPress={() => openAt(kind === 'week' ? 'day' : 'week', bucket.start)}
              />
            ))
          )}

          {/* Said once, at the bottom of the list, rather than on every row: a week bucket
              inside a month view can begin in the month before or end in the one after. */}
          {kind === 'month' && buckets.some((bucket) => bucket.partial) ? (
            <Text style={Type.caption}>
              A week runs Monday to Sunday, so the first and last of a month can reach into
              the months either side. Those rows total only the days inside this one.
            </Text>
          ) : null}
        </Animated.View>
      </ScrollView>

      <DatePickerSheet
        visible={isPickingDate}
        value={window.anchor}
        earliest={earliest}
        latest={today}
        onSelect={(iso) => openAt(kind, iso)}
        onClose={() => setIsPickingDate(false)}
      />
    </View>
  );
}

function dayAndMonth(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
  });
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
  segmented: {
    flexDirection: 'row',
    gap: 4,
    padding: 4,
    borderRadius: Radius.pill,
    backgroundColor: AuraColors.surface.sunken,
  },
  segment: {
    flex: 1,
    height: 36,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentSelected: { backgroundColor: AuraColors.surface.default, ...Shadows.chip },
  segmentLabel: { fontFamily: Font.medium, fontSize: 13, color: AuraColors.content.muted },
  segmentLabelSelected: { fontFamily: Font.semibold, color: AuraColors.content.default },
  dateRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: -4 },
  dateText: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  dateLabel: { fontFamily: Font.semibold, fontSize: 12, color: AuraColors.content.muted },
  step: {
    width: 34,
    height: 34,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: AuraColors.surface.sunken,
  },
  stepDisabled: { backgroundColor: 'transparent' },
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
  proportionEstimated: { backgroundColor: AuraColors.surface.selected },
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
  band: { gap: 10 },
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
  bucketRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44 },
  bucketText: { width: 104, gap: 2 },
  bucketMuted: { color: '#94a3b8' },
  bucketTrack: {
    flex: 1,
    height: 8,
    borderRadius: 999,
    backgroundColor: AuraColors.surface.sunken,
    overflow: 'hidden',
  },
  bucketFill: { height: 8, borderRadius: 999, backgroundColor: AuraColors.accent.default },
  bucketFillMeasured: { backgroundColor: AuraColors.success },
  bucketValue: { width: 62, flexDirection: 'row', alignItems: 'baseline', justifyContent: 'flex-end', gap: 3 },
});
