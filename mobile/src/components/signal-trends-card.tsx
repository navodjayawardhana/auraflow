import { Feather } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInUp } from 'react-native-reanimated';

import { Font, Surfaces, Type, Unit } from '@/constants/design';
import { AuraColors, IconTones } from '@/constants/theme';
import { coverageNote, type SignalSummary } from '@/services/insights-summary';

const STRIP_HEIGHT = 30;
const MISSING_STUB = 2;

export interface SignalRow {
  summary: SignalSummary;
  icon: keyof typeof Feather.glyphMap;
  tone: keyof typeof IconTones;
  unit: string;
  format: (mean: number) => string;
  /** Drawn as a reference line across the strip. Absent for signals with no target. */
  target?: number | null;
}

/**
 * A fortnight of one signal, at the width a row allows.
 *
 * Bars rather than a line, and no interpolation across gaps. A line chart has to decide
 * what to do about a day with no reading, and every option it has — joining across it,
 * dropping to the axis — is a claim the data does not support. A missing day here is a
 * grey stub that is visibly not a small value.
 *
 * Scaled from zero, not from the window's minimum. A resting heart rate that moved between
 * 57 and 59 bpm is a flat fortnight, and a chart that stretched those two beats to fill its
 * height would sell that as a trend.
 */
function TrendStrip({ values, target, color }: { values: (number | null)[]; target?: number | null; color: string }) {
  const recorded = values.filter((value): value is number => value !== null);
  const ceiling = Math.max(...recorded, target ?? 0, 1);

  return (
    <View style={styles.strip}>
      {target != null && target <= ceiling ? (
        <View
          style={[styles.target, { bottom: (target / ceiling) * STRIP_HEIGHT }]}
          pointerEvents="none"
        />
      ) : null}

      <View style={styles.bars}>
        {values.map((value, i) => (
          <View
            key={i}
            style={[
              styles.bar,
              value === null
                ? { height: MISSING_STUB, backgroundColor: AuraColors.surface.selected }
                : {
                    height: Math.max((value / ceiling) * STRIP_HEIGHT, 2),
                    // Days at or over the target keep the full tint; the rest are paler, so
                    // the reference line can be read without counting bars against it.
                    backgroundColor: target != null && value < target ? '#bfdbfe' : color,
                  },
            ]}
          />
        ))}
      </View>
    </View>
  );
}

/**
 * The four signals beside recovery, each with the days behind it.
 *
 * One card of rows rather than four tiles: the rows share a window and a denominator, and
 * splitting them into a grid would give each its own frame and invite reading them as four
 * independent findings rather than four views of the same fortnight.
 */
export function SignalTrendsCard({ rows, index = 0 }: { rows: SignalRow[]; index?: number }) {
  return (
    <Animated.View entering={FadeInUp.delay(index * 60).duration(400)} style={styles.card}>
      <Text style={Type.cardTitle}>Signals</Text>

      {rows.map(({ summary, icon, tone, unit, format, target }) => {
        const badge = IconTones[tone];
        const { mean } = summary;

        return (
          <View key={summary.key} style={styles.row}>
            <View style={[styles.icon, { backgroundColor: badge.bg }]}>
              <Feather name={icon} size={14} color={badge.color} />
            </View>

            <View style={styles.figures}>
              <Text style={Type.tileLabel}>{summary.label}</Text>

              <View style={styles.valueRow}>
                {mean !== null ? (
                  <>
                    <Text style={styles.metric}>{format(mean)}</Text>
                    <Text style={Unit}>{unit} avg</Text>
                  </>
                ) : (
                  <Text style={styles.dash}>—</Text>
                )}
              </View>

              {/* The mean never appears without the days it was taken over. */}
              <Text style={Type.caption}>
                {coverageNote(summary.recordedDays, summary.windowDays)}
              </Text>
            </View>

            <TrendStrip values={summary.values} target={target} color={badge.color} />
          </View>
        );
      })}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: { ...Surfaces.card, gap: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  icon: { width: 30, height: 30, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  figures: { flex: 1, gap: 2 },
  valueRow: { flexDirection: 'row', alignItems: 'baseline', gap: 4 },
  metric: {
    fontFamily: Font.bold,
    fontSize: 20,
    lineHeight: 22,
    letterSpacing: -0.4,
    color: AuraColors.content.default,
    fontVariant: ['tabular-nums'],
  },
  dash: { fontFamily: Font.regular, fontSize: 18, lineHeight: 22, color: AuraColors.content.muted },
  strip: { width: 104, height: STRIP_HEIGHT, justifyContent: 'flex-end' },
  target: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: AuraColors.surface.selected,
  },
  bars: { flexDirection: 'row', alignItems: 'flex-end', gap: 2 },
  bar: { flex: 1, borderRadius: 2 },
});
