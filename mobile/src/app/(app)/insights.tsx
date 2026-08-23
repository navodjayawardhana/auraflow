import { Feather } from '@expo/vector-icons';
import { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInUp } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CoveragePanel } from '@/components/coverage-panel';
import { OfflineBanner } from '@/components/offline-banner';
import { PlanAdherencePanel } from '@/components/plan-adherence-panel';
import { PrimaryButton } from '@/components/primary-button';
import { RecoveryDriversPanel } from '@/components/recovery-drivers-panel';
import { RecoveryTrendChart, type RecoveryPoint } from '@/components/recovery-trend-chart';
import { SignalTrendsCard, type SignalRow } from '@/components/signal-trends-card';
import { Font, Layout, Surfaces, Type } from '@/constants/design';
import { AuraColors, IconTones } from '@/constants/theme';
import { useCachedResource } from '@/hooks/use-cached-resource';
import { usePlan } from '@/hooks/use-plan';
import { fetchInsights, type InsightsSeries } from '@/services/insights-service';
import {
  coverageNote,
  coverageOf,
  goalAdherence,
  recoveryDrivers,
  sleepAgainstNeed,
  summariseSignal,
} from '@/services/insights-summary';
import { todayIsoDate } from '@/services/recovery-service';

/**
 * A fortnight, not a week.
 *
 * Three things wanted the same number and all three wanted fourteen: it is the window a
 * personal resting-HR baseline is built over, it is the shortest span a rank correlation
 * can be drawn from at this app's floor of ten paired days, and it is long enough that a
 * single bad night stops setting the average. A week could not support the correlation
 * panel at all.
 */
const WINDOW_DAYS = 14;

function SummaryTile({
  icon,
  tone,
  label,
  value,
  denominator,
  caption,
  index,
}: {
  icon: keyof typeof Feather.glyphMap;
  tone: keyof typeof IconTones;
  label: string;
  value: string;
  denominator?: string;
  caption: string;
  index: number;
}) {
  const badge = IconTones[tone];

  return (
    <Animated.View entering={FadeInUp.delay(index * 60).duration(400)} style={styles.tile}>
      <View style={styles.tileHead}>
        <View style={[styles.tileIcon, { backgroundColor: badge.bg }]}>
          <Feather name={icon} size={15} color={badge.color} />
        </View>
        <Text style={Type.tileLabel}>{label}</Text>
      </View>

      <View style={styles.tileValueRow}>
        <Text style={Type.summaryMetric}>{value}</Text>
        {denominator ? <Text style={styles.denominator}>{denominator}</Text> : null}
      </View>

      <Text style={Type.caption}>{caption}</Text>
    </Animated.View>
  );
}

export default function InsightsScreen() {
  const insets = useSafeAreaInsets();
  const [isRefreshing, setIsRefreshing] = useState(false);

  const today = todayIsoDate();
  const fetcher = useCallback(() => fetchInsights(WINDOW_DAYS), []);

  const { data, status, cachedAt, isStale, refresh } = useCachedResource<InsightsSeries>(
    `insights.${WINDOW_DAYS}`,
    fetcher,
  );

  /*
   * The targets, and whether they are the user's or the constants.
   *
   * Read through the same hook the dashboard uses rather than asked for again here, so the
   * two screens cannot disagree about what the goal is — and so the substitution when no
   * plan exists happens in the one expression that knows a substitution happened.
   */
  const { targets, refresh: refreshPlan } = usePlan();

  async function handleRefresh() {
    setIsRefreshing(true);
    await Promise.all([refresh(), refreshPlan()]);
    setIsRefreshing(false);
  }

  const series = data;
  const scored = series?.days.filter((day) => day.recovery_score !== null) ?? [];

  const average =
    scored.length > 0
      ? Math.round(scored.reduce((sum, day) => sum + (day.recovery_score ?? 0), 0) / scored.length)
      : null;

  // First half against second half — coarse on purpose. A fourteen-point series with gaps
  // in it does not support anything more sophisticated, and a regression slope here would
  // be false rigour of exactly the kind the panel below spends a paragraph warning about.
  const trend = (() => {
    if (scored.length < 4) return null;

    const half = Math.floor(scored.length / 2);
    const mean = (list: typeof scored) =>
      list.reduce((sum, day) => sum + (day.recovery_score ?? 0), 0) / list.length;

    return Math.round(mean(scored.slice(half)) - mean(scored.slice(0, half)));
  })();

  const provisionalCount = scored.filter((day) => day.recovery_provisional).length;

  const points: RecoveryPoint[] =
    series?.days.map((day) => ({
      date: day.date,
      score: day.recovery_score,
      provisional: day.recovery_provisional,
    })) ?? [];

  const signalRows: SignalRow[] = series
    ? [
        {
          summary: summariseSignal(series, 'sleepHours'),
          icon: 'moon',
          tone: 'stage',
          unit: 'h',
          format: (mean) => mean.toFixed(1),
        },
        {
          summary: summariseSignal(series, 'restingHeartRate'),
          icon: 'heart',
          tone: 'vital',
          unit: 'bpm',
          format: (mean) => mean.toFixed(0),
        },
        {
          summary: summariseSignal(series, 'steps'),
          icon: 'activity',
          tone: 'brand',
          unit: 'a day',
          format: (mean) => Math.round(mean).toLocaleString(),
          target: targets.stepGoal,
        },
        {
          summary: summariseSignal(series, 'water'),
          icon: 'droplet',
          tone: 'accent',
          unit: 'ml a day',
          format: (mean) => Math.round(mean).toLocaleString(),
          target: targets.waterMl,
        },
      ]
    : [];

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 14 }]}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} />}>
        <View style={styles.header}>
          <Text style={styles.eyebrow}>LAST {WINDOW_DAYS} DAYS</Text>
          <Text style={Type.screenTitle}>Insights</Text>
        </View>

        {isStale ? <OfflineBanner cachedAt={cachedAt} /> : null}

        {status === 'loading' ? (
          <View style={styles.skeleton} />
        ) : status === 'error' || series === null ? (
          <View style={styles.card}>
            <Text style={Type.cardTitle}>Couldn&apos;t load your trend</Text>
            <PrimaryButton label="Retry" onPress={refresh} />
          </View>
        ) : (
          <>
            {/* Coverage first: it is the frame every figure below is read inside. */}
            <CoveragePanel coverage={coverageOf(series)} />

            <Animated.View entering={FadeInUp.duration(400)} style={styles.card}>
              <View style={styles.cardHead}>
                <Text style={Type.cardTitle}>Recovery</Text>
                {trend !== null ? (
                  <View style={styles.trend}>
                    <Feather
                      name={trend >= 0 ? 'trending-up' : 'trending-down'}
                      size={14}
                      color={trend >= 0 ? AuraColors.success : AuraColors.caution}
                    />
                    <Text
                      style={[
                        styles.trendLabel,
                        { color: trend >= 0 ? AuraColors.success : AuraColors.caution },
                      ]}>
                      {trend >= 0 ? '+' : ''}
                      {trend} across the window
                    </Text>
                  </View>
                ) : null}
              </View>

              <RecoveryTrendChart points={points} today={today} />
            </Animated.View>

            <View style={styles.grid}>
              <SummaryTile
                index={0}
                icon="bar-chart-2"
                tone="brand"
                label="Average"
                value={average === null ? '—' : String(average)}
                caption={
                  average === null ? 'no scores yet' : coverageNote(scored.length, WINDOW_DAYS)
                }
              />
              <SummaryTile
                index={1}
                icon="calendar"
                tone="accent"
                label="Recorded"
                value={String(scored.length)}
                denominator={`/${WINDOW_DAYS}`}
                caption="days with a score"
              />
            </View>

            {provisionalCount > 0 ? (
              <Animated.View entering={FadeInUp.delay(120).duration(400)} style={styles.note}>
                <Feather name="info" size={14} color={AuraColors.caution} />
                <Text style={styles.noteText}>
                  <Text style={styles.noteEmphasis}>{provisionalCount}</Text> of these days are
                  provisional — they were scored before there was enough history for a personal
                  resting-heart-rate baseline.
                </Text>
              </Animated.View>
            ) : null}

            <SignalTrendsCard rows={signalRows} />

            <PlanAdherencePanel
              steps={goalAdherence(series, 'steps', targets.stepGoal, targets.source)}
              water={goalAdherence(series, 'water', targets.waterMl, targets.source)}
              sleep={sleepAgainstNeed(series, targets.sleepNeedHours)}
              source={targets.source}
            />

            <RecoveryDriversPanel drivers={recoveryDrivers(series)} />

            {scored.length === 0 ? (
              <Text style={styles.empty}>
                No scores in this window yet — they&apos;ll appear here as your nights are recorded.
              </Text>
            ) : null}
          </>
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
  header: { gap: 4, marginBottom: 6 },
  eyebrow: { ...Type.eyebrow, color: AuraColors.content.muted, fontSize: 12 },
  card: { ...Surfaces.card, paddingTop: 18, paddingBottom: 14, gap: 14 },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  trend: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  trendLabel: { fontFamily: Font.semibold, fontSize: 12 },
  grid: { flexDirection: 'row', gap: Layout.gapTiles },
  tile: { ...Surfaces.tile, flex: 1, gap: 6 },
  tileHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  tileIcon: { width: 30, height: 30, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  tileValueRow: { flexDirection: 'row', alignItems: 'baseline' },
  denominator: { fontFamily: Font.regular, fontSize: 16, color: AuraColors.content.muted },
  skeleton: {
    height: 240,
    borderRadius: 22,
    backgroundColor: AuraColors.surface.raised,
  },
  note: { ...Surfaces.panel, flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  noteText: {
    flex: 1,
    fontFamily: Font.regular,
    fontSize: 11,
    lineHeight: 16,
    color: AuraColors.content.muted,
  },
  noteEmphasis: { fontFamily: Font.semibold, color: AuraColors.content.default },
  empty: { ...Type.caption, textAlign: 'center' },
});
