import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DailyBriefCard } from '@/components/daily-brief-card';
import { FocusForecast } from '@/components/focus-forecast';
import { HeroDecoration } from '@/components/hero-decoration';
import { HeroRings } from '@/components/hero-rings';
import { LiveNodeStrip } from '@/components/live-node-strip';
import { LogoMark } from '@/components/logo-mark';
import { MetricTile } from '@/components/metric-tile';
import { OfflineBanner } from '@/components/offline-banner';
import { RecoveryCard } from '@/components/recovery-card';
import { RingLegend } from '@/components/ring-legend';
import { SleepStageBar } from '@/components/sleep-stage-bar';
import { STEP_GOAL, WATER_GOAL_ML } from '@/constants/goals';
import {
  Font,
  GradientAxis,
  Gradients,
  Layout,
  Radius,
  Shadows,
  Type,
} from '@/constants/design';
import { AuraColors } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import { useContextAwareness } from '@/hooks/use-context-awareness';
import { useIot } from '@/context/iot-context';
import { useCachedResource } from '@/hooks/use-cached-resource';
import { useOutboxFlush } from '@/hooks/use-outbox-flush';
import { useSteps } from '@/hooks/use-steps';
import { fetchBrief, refreshBrief, type DailyBrief } from '@/services/brief-service';
import { estimateActiveKcal } from '@/services/energy';
import { fetchHealthSnapshots } from '@/services/health-snapshot-service';
import { usableHeartRate, usableSpo2 } from '@/services/iot-payloads';
import { fetchRecovery, recentDates, todayIsoDate } from '@/services/recovery-service';
import { fetchWeather } from '@/services/weather-service';

const HERO_HEIGHT = 404;
/** The sheet overlaps the hero by 26px — that overlap is the whole effect. */
const SHEET_TOP = 378;

function Chip({
  icon,
  value,
  label,
}: {
  icon: keyof typeof Feather.glyphMap;
  value: string;
  label: string;
}) {
  return (
    <View style={styles.chip}>
      <Feather name={icon} size={14} color="#ffffff" />
      <Text style={styles.chipValue}>{value}</Text>
      <Text style={styles.chipLabel}>{label}</Text>
    </View>
  );
}

export default function TodayScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [isRefreshing, setIsRefreshing] = useState(false);

  const today = todayIsoDate();
  const recoveryFetcher = useCallback(() => fetchRecovery(today), [today]);

  const { data: recovery, cachedAt, isStale, refresh } = useCachedResource(
    `recovery.${today}`,
    recoveryFetcher,
  );

  const snapshotWindow = recentDates(8);
  const snapshotsFetcher = useCallback(
    () => fetchHealthSnapshots(snapshotWindow[0], snapshotWindow[snapshotWindow.length - 1]),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [snapshotWindow[0], snapshotWindow[snapshotWindow.length - 1]],
  );

  const { data: snapshots, refresh: refreshSnapshots } = useCachedResource(
    'health-snapshots.8',
    snapshotsFetcher,
  );

  const history = snapshots ?? [];
  const tonight = history.find((s) => s.date === today) ?? null;

  const steps = useSteps();
  const { biometrics, isBiometricsStale } = useIot();
  const liveHeartRate = isBiometricsStale ? null : usableHeartRate(biometrics);
  const liveSpo2 = isBiometricsStale ? null : usableSpo2(biometrics);

  const { coordinates, context } = useContextAwareness();
  const weatherFetcher = useCallback(
    () => (coordinates ? fetchWeather(coordinates) : Promise.reject(new Error('no position'))),
    [coordinates],
  );
  const { data: weather } = useCachedResource(
    `weather.${coordinates ? coordinates.latitude.toFixed(2) : 'unknown'}`,
    weatherFetcher,
  );

  // The brief is generated off the request, so it arrives as `pending` and has to be
  // polled. Polling stops the moment it settles — a dashboard that keeps asking after
  // the answer arrived is just noise on someone's data plan.
  const [brief, setBrief] = useState<DailyBrief | null>(null);

  const loadBrief = useCallback(async () => {
    try {
      setBrief(await fetchBrief(today));
    } catch {
      // A missing brief is a missing card, not a broken screen.
      setBrief(null);
    }
  }, [today]);

  useEffect(() => {
    loadBrief();
  }, [loadBrief]);

  useEffect(() => {
    if (brief?.status !== 'pending') return;

    const timer = setInterval(loadBrief, 4000);
    return () => clearInterval(timer);
  }, [brief?.status, loadBrief]);

  const retryBrief = useCallback(async () => {
    setBrief((current) => (current ? { ...current, status: 'pending' } : current));
    try {
      await refreshBrief(today);
    } catch {
      // The poll above will surface whatever the server settles on.
    }
    loadBrief();
  }, [today, loadBrief]);

  const refreshAll = useCallback(async () => {
    await Promise.all([refresh(), refreshSnapshots(), loadBrief()]);
  }, [refresh, refreshSnapshots, loadBrief]);

  const { pending } = useOutboxFlush(refreshAll);

  useFocusEffect(
    useCallback(() => {
      refreshAll();
    }, [refreshAll]),
  );

  async function handleRefresh() {
    setIsRefreshing(true);
    await refreshAll();
    setIsRefreshing(false);
  }

  const score = recovery?.available ? recovery.score : null;
  const isProvisional = recovery?.available === true && recovery.provisional;
  const stepsAvailable = steps.status === 'counting';
  const waterMl = tonight?.water_ml ?? null;

  const dateLabel = new Date()
    .toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })
    .toUpperCase();

  return (
    <View style={styles.screen}>
      <LinearGradient
        colors={Gradients.hero}
        start={GradientAxis.deg158.start}
        end={GradientAxis.deg158.end}
        style={styles.hero}>
        <HeroDecoration height={HERO_HEIGHT} />

        <View style={[styles.heroContent, { paddingTop: insets.top + 16 }]}>
          <View style={styles.heroHead}>
            <View style={styles.heroGreeting}>
              <Text style={Type.eyebrowOnHero}>{dateLabel}</Text>
              <Text style={Type.greeting}>Hello, {user?.name?.split(' ')[0]}</Text>
            </View>
            <View style={styles.heroMark}>
              <LogoMark size={24} color="#ffffff" />
            </View>
          </View>

          <View style={styles.chips}>
            {weather ? (
              <Chip
                icon="thermometer"
                value={`${Math.round(weather.temperature_c)}°`}
                label={weather.condition.toLowerCase()}
              />
            ) : null}
            {context ? <Chip icon="map-pin" value="" label={context.toLowerCase()} /> : null}
          </View>

          <View style={styles.rings}>
            <HeroRings
              score={score}
              isProvisional={isProvisional}
              stepsProgress={stepsAvailable ? steps.today / STEP_GOAL : null}
              waterProgress={waterMl === null ? null : waterMl / WATER_GOAL_ML}
            />
          </View>
        </View>
      </LinearGradient>

      <View style={styles.sheet}>
        <View style={styles.handle} />

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scroll}
          refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} />}>
          {isStale ? <OfflineBanner cachedAt={cachedAt} /> : null}

          {/* The hero shows an em dash when there is no score; this says why, and how to
              fix it. The ring alone would leave the user guessing. */}
          {recovery !== null && !recovery.available ? (
            <RecoveryCard status="loaded" reading={recovery} onRetry={refresh} />
          ) : null}

          <RingLegend
            steps={stepsAvailable ? steps.today : null}
            stepGoal={STEP_GOAL}
            waterMl={waterMl}
            waterGoalMl={WATER_GOAL_ML}
          />

          <View style={styles.grid}>
          <View style={styles.gridRow}>
            <MetricTile
              index={0}
              label="Steps"
              icon="activity"
              tone="brand"
              state={stepsAvailable ? 'measured' : 'unavailable'}
              value={stepsAvailable ? steps.today.toLocaleString() : '—'}
              progress={stepsAvailable ? steps.today / STEP_GOAL : undefined}
              caption={
                steps.status === 'counting'
                  ? 'counted while AuraFlow is open'
                  : steps.status === 'denied'
                    ? 'activity permission denied'
                    : steps.status === 'unavailable'
                      ? 'no step sensor on this phone'
                      : 'checking…'
              }
            />
            <MetricTile
              index={1}
              label="Active energy"
              icon="zap"
              tone="accent"
              state={stepsAvailable ? 'estimated' : 'unavailable'}
              value={stepsAvailable ? String(estimateActiveKcal(steps.today)) : '—'}
              unit="kcal"
              caption="estimated from steps, not measured"
            />
          </View>

          <View style={styles.gridRow}>
            <MetricTile
              index={2}
              label="Resting HR"
              icon="heart"
              tone="vital"
              state={tonight?.resting_heart_rate != null ? 'measured' : 'unavailable'}
              value={tonight?.resting_heart_rate != null ? String(tonight.resting_heart_rate) : '—'}
              unit="bpm"
              caption="from last night"
            />
            <MetricTile
              index={3}
              label="Water"
              icon="droplet"
              tone="accent"
              state={waterMl != null ? 'measured' : 'unavailable'}
              value={waterMl != null ? waterMl.toLocaleString() : '—'}
              unit="ml"
              progress={waterMl == null ? undefined : waterMl / WATER_GOAL_ML}
              caption={`of ${WATER_GOAL_ML.toLocaleString()} ml today`}
            />
          </View>
          </View>

          {liveHeartRate !== null ? (
            <LiveNodeStrip heartRate={liveHeartRate} spo2={liveSpo2} />
          ) : null}

          <DailyBriefCard brief={brief} onRetry={retryBrief} />

          <SleepStageBar snapshot={tonight} />

          <FocusForecast
            snapshot={tonight}
            history={history}
            context={context}
            liveHeartRate={liveHeartRate}
            liveSpo2={liveSpo2}
            stepsLastHour={stepsAvailable ? steps.lastHour : null}
            stepsCoverageMinutes={steps.coverageMinutes}
          />

          {pending > 0 ? (
            <View style={styles.pending}>
              <Feather name="upload-cloud" size={14} color={AuraColors.content.muted} />
              <Text style={Type.caption}>
                {pending} update{pending === 1 ? '' : 's'} waiting to sync
              </Text>
            </View>
          ) : null}
        </ScrollView>
      </View>

      <Pressable
        onPress={() => router.push('/assistant')}
        accessibilityRole="button"
        accessibilityLabel="Open the assistant"
        style={[styles.fab, { bottom: Math.max(insets.bottom + 4, 22) + 86 }]}>
        <Feather name="message-circle" size={22} color={AuraColors.brand.default} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: AuraColors.surface.sunken },
  hero: { height: HERO_HEIGHT, overflow: 'hidden' },
  heroContent: { paddingHorizontal: Layout.gutter },
  heroHead: { flexDirection: 'row', justifyContent: 'space-between', gap: 16 },
  heroGreeting: { flex: 1, gap: 5 },
  heroMark: {
    width: 44,
    height: 44,
    borderRadius: 15,
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.22)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  chips: { flexDirection: 'row', gap: 8, marginTop: 16, minHeight: 32 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    height: 32,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  chipValue: { fontFamily: Font.semibold, fontSize: 13, color: '#ffffff' },
  chipLabel: {
    fontFamily: Font.regular,
    fontSize: 13,
    color: 'rgba(255,255,255,0.76)',
    textTransform: 'capitalize',
  },
  rings: { marginTop: 16, alignItems: 'center' },
  sheet: {
    position: 'absolute',
    top: SHEET_TOP,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: AuraColors.surface.sunken,
    borderTopLeftRadius: Radius.sheet,
    borderTopRightRadius: Radius.sheet,
    paddingTop: 10,
    // Android draws no upward shadow, so the sheet's edge is stated with a hairline.
    borderTopWidth: 1,
    borderTopColor: 'rgba(15,23,42,0.06)',
  },
  handle: {
    width: 38,
    height: 4,
    borderRadius: 999,
    backgroundColor: '#cbd5e1',
    alignSelf: 'center',
    marginBottom: 16,
  },
  scroll: {
    paddingHorizontal: Layout.gutter,
    paddingBottom: Layout.scrollBottom,
    gap: Layout.gapCards,
  },
  // Two explicit rows rather than one wrapping row: the tiles set flex:1, which gives
  // them a zero basis, so a wrapping container would fit all four on a single line.
  // The wrapper carries the row gap so the grid is evenly spaced in both axes.
  grid: { gap: Layout.gapTiles },
  gridRow: { flexDirection: 'row', gap: Layout.gapTiles },
  pending: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  fab: {
    position: 'absolute',
    right: Layout.gutter,
    width: 52,
    height: 52,
    borderRadius: Radius.fab,
    backgroundColor: AuraColors.surface.default,
    alignItems: 'center',
    justifyContent: 'center',
    ...Shadows.fab,
  },
});
