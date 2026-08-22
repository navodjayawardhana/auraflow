import { Feather } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInUp } from 'react-native-reanimated';
import { Rect, Svg } from 'react-native-svg';

import { Font, Radius, Surfaces, Type } from '@/constants/design';
import { AuraColors, IconTones } from '@/constants/theme';
import { buildFocusFeatures, focusCoverage, type Context, type FocusCoverage } from '@/ml/focus-features';
import { model, predictFocusReady } from '@/ml/focus-model';
import type { HealthSnapshot } from '@/types';

const FIRST_HOUR = 6;
const LAST_HOUR = 22;
const WINDOW_HOURS = 2;
const CHART_HEIGHT = 86;
const LABEL_ROW = 16;

interface FocusForecastProps {
  snapshot?: HealthSnapshot | null;
  history?: HealthSnapshot[];
  context?: Context | null;
  liveHeartRate?: number | null;
  liveSpo2?: number | null;
  stepsLastHour?: number | null;
  stepsCoverageMinutes?: number;
}

/**
 * Bars are ranked against the day's own spread, not an absolute 0–1 scale.
 *
 * The model's hourly output sits in a narrow band, so an absolute scale paints every hour
 * identically and the chart says nothing. What it *can* do is rank one hour against
 * another on the same day, which is the question being asked.
 */
function fillFor(rank: number): string {
  if (rank >= 0.75) return AuraColors.brand.bright;
  if (rank >= 0.5) return AuraColors.brand.default;
  if (rank >= 0.25) return AuraColors.accent.default;
  return AuraColors.surface.selected;
}

/** A band, not a percentage — a model this uncertain quoted to a decimal reads as measured. */
function bandFor(probability: number): string {
  if (probability >= 0.5) return 'Likely a good window';
  if (probability >= 0.4) return 'Mixed';
  return 'Probably not your best hours';
}

const pad = (hour: number) => `${String(hour).padStart(2, '0')}:00`;

export function FocusForecast({
  snapshot,
  history = [],
  context = null,
  liveHeartRate = null,
  liveSpo2 = null,
  stepsLastHour = null,
  stepsCoverageMinutes = 0,
}: FocusForecastProps) {
  const [isOpen, setIsOpen] = useState(false);

  const { points, best, coverage } = useMemo(() => {
    const now = new Date();
    const hourly: { hour: number; probability: number }[] = [];
    let hourlyCoverage: FocusCoverage | null = null;

    for (let hour = FIRST_HOUR; hour <= LAST_HOUR; hour += 1) {
      const at = new Date(now);
      at.setHours(hour, 0, 0, 0);

      const prediction = predictFocusReady(
        buildFocusFeatures({
          at,
          snapshot,
          history,
          context,
          liveHeartRate,
          liveSpo2,
          stepsLastHour,
          stepsCoverageMinutes,
        }),
      );

      hourly.push({ hour, probability: prediction.probability });
      hourlyCoverage = focusCoverage(prediction);
    }

    let bestStart = hourly[0].hour;
    let bestMean = -1;

    for (let i = 0; i + WINDOW_HOURS - 1 < hourly.length; i += 1) {
      const slice = hourly.slice(i, i + WINDOW_HOURS);
      const mean = slice.reduce((sum, p) => sum + p.probability, 0) / slice.length;

      if (mean > bestMean) {
        bestMean = mean;
        bestStart = slice[0].hour;
      }
    }

    return {
      points: hourly,
      best: { start: bestStart, end: bestStart + WINDOW_HOURS, mean: bestMean },
      coverage: hourlyCoverage as FocusCoverage,
    };
  }, [snapshot, history, context, liveHeartRate, liveSpo2, stepsLastHour, stepsCoverageMinutes]);

  const probabilities = points.map((p) => p.probability);
  const min = Math.min(...probabilities);
  const span = Math.max(Math.max(...probabilities) - min, 1e-6);

  const bandLeft = ((best.start - FIRST_HOUR) / points.length) * 100;
  const bandWidth = (WINDOW_HOURS / points.length) * 100;

  return (
    <Animated.View entering={FadeInUp.duration(400)} style={styles.card}>
      <View style={styles.head}>
        <View style={[styles.icon, { backgroundColor: IconTones.brand.bg }]}>
          <Feather name="cpu" size={15} color={IconTones.brand.color} />
        </View>
        <View style={styles.headText}>
          <Text style={Type.cardTitle}>Focus forecast</Text>
          <Text style={Type.caption}>experimental · runs on this device</Text>
        </View>
      </View>

      <View style={styles.chart}>
        {/* Drawn with SVG rather than a dashed border: Android renders borderStyle
            'dashed' inconsistently once a radius is involved. */}
        <View
          style={[styles.band, { left: `${bandLeft}%`, width: `${bandWidth}%` }]}
          pointerEvents="none">
          <Svg width="100%" height="100%">
            <Rect
              x={1}
              y={1}
              width="98%"
              height="98%"
              rx={10}
              fill="rgba(0,82,255,0.07)"
              stroke="rgba(0,82,255,0.32)"
              strokeWidth={1}
              strokeDasharray="4 4"
            />
          </Svg>
        </View>

        <View style={styles.bars}>
          {points.map((point) => {
            const rank = (point.probability - min) / span;

            return (
              <View key={point.hour} style={styles.column}>
                <View
                  style={[
                    styles.bar,
                    { height: 12 + rank * 52, backgroundColor: fillFor(rank) },
                  ]}
                />
                <Text style={[styles.hour, point.hour % 4 !== 0 && styles.hourHidden]}>
                  {point.hour}
                </Text>
              </View>
            );
          })}
        </View>
      </View>

      <View style={styles.bestWindow}>
        <View style={styles.bestIcon}>
          <Feather name="target" size={15} color="#ffffff" />
        </View>
        <View style={styles.bestText}>
          <Text style={styles.bestTitle}>
            Best deep-work window · {pad(best.start)}–{pad(best.end)}
          </Text>
          <Text style={Type.tileLabel}>{bandFor(best.mean)}</Text>
        </View>
      </View>

      <Pressable
        onPress={() => setIsOpen((v) => !v)}
        accessibilityRole="button"
        accessibilityState={{ expanded: isOpen }}
        accessibilityLabel="How this forecast is worked out"
        style={styles.disclosure}>
        <Feather name="info" size={12} color={AuraColors.content.muted} />
        <Text style={styles.disclosureLabel}>
          {coverage.supplied} of {coverage.total} health inputs are your data
        </Text>
        <Feather
          name={isOpen ? 'chevron-up' : 'chevron-down'}
          size={14}
          color={AuraColors.content.muted}
        />
      </Pressable>

      {isOpen ? (
        <View style={styles.panel}>
          <Text style={styles.panelText}>
            A logistic regression trained offline on a public wearable cohort, running on this
            device — nothing is sent anywhere to produce it.
          </Text>
          <Text style={styles.panelText}>
            {coverage.supplied === 0
              ? `None of its ${coverage.total} health inputs — sleep, heart, movement — are yours yet, so all of them are filled from the cohort's median. These bars are when that cohort tends to be alert, not when you are. Log a night and it starts describing you.`
              : `Its other ${coverage.total - coverage.supplied} health inputs are filled from the cohort's median.`}{' '}
            {coverage.ambient} more come from the clock and the location category — real, but
            true of anyone holding a phone.
          </Text>
          <Text style={styles.panelText}>
            On held-out data it scored ROC-AUC {model.metrics_holdout.roc_auc.toFixed(3)}, F1{' '}
            {model.metrics_holdout.f1.toFixed(3)}, accuracy{' '}
            {model.metrics_holdout.accuracy.toFixed(3)} — better than chance, but not by a wide
            margin.
          </Text>
          <Text style={styles.panelText}>{model.note}</Text>
        </View>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: { ...Surfaces.card, gap: 12 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  icon: {
    width: 30,
    height: 30,
    borderRadius: Radius.iconSmall,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headText: { flex: 1, gap: 1 },
  chart: { height: CHART_HEIGHT, justifyContent: 'flex-end' },
  band: { position: 'absolute', top: 0, bottom: LABEL_ROW },
  bars: { flexDirection: 'row', alignItems: 'flex-end', gap: 3 },
  column: { flex: 1, alignItems: 'center', gap: 4 },
  bar: { width: '100%', borderRadius: 999 },
  hour: { fontFamily: Font.regular, fontSize: 8, height: 12, color: '#94a3b8' },
  hourHidden: { color: 'transparent' },
  bestWindow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: Radius.iconLarge,
    backgroundColor: AuraColors.surface.sunken,
  },
  bestIcon: {
    width: 30,
    height: 30,
    borderRadius: Radius.iconSmall,
    backgroundColor: AuraColors.brand.default,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bestText: { flex: 1, gap: 2 },
  bestTitle: { fontFamily: Font.semibold, fontSize: 13, color: AuraColors.content.default },
  disclosure: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 28 },
  disclosureLabel: {
    flex: 1,
    fontFamily: Font.regular,
    fontSize: 10,
    color: AuraColors.content.muted,
  },
  panel: { ...Surfaces.panel, gap: 8 },
  panelText: {
    fontFamily: Font.regular,
    fontSize: 10,
    lineHeight: 15,
    color: AuraColors.content.muted,
  },
});
