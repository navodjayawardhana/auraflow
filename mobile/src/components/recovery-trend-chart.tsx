import { StyleSheet, Text, View } from 'react-native';

import { Font } from '@/constants/design';
import { AuraColors } from '@/constants/theme';

const CHART_HEIGHT = 176;
const BAR_MAX = 130;
const LABEL_ROW = 22;
const WEEKDAY = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function dayLabel(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  return WEEKDAY[new Date(y, m - 1, d).getDay()];
}

/**
 * One day of the trend.
 *
 * Structural rather than the `RecoveryReading` the endpoint returns, because the chart
 * needs three fields and the reading carries seven -- an unavailable reason and a
 * last-known score among them, neither of which a bar can draw. Taking the wider type
 * would mean any other source of daily scores had to fabricate those fields to be drawn.
 */
export interface RecoveryPoint {
  date: string;
  /** Null on a day that could not be scored. Drawn as a stub, never as a zero-height bar. */
  score: number | null;
  provisional: boolean;
}

/**
 * A window of recovery, one bar a day.
 *
 * Provisional days are violet rather than a faded blue: a score computed without a
 * personal heart-rate baseline is a different measurement, not a weaker one, and fading
 * it would invite reading it as "worse". The legend names all three so the chart is
 * readable without a tap.
 */
export function RecoveryTrendChart({
  points,
  today,
}: {
  points: RecoveryPoint[];
  today: string;
}) {
  // A fortnight of bars in the width a week had. The value above each bar is the first
  // thing to become unreadable, so it is dropped rather than shrunk into a smear.
  const isDense = points.length > 8;

  return (
    <View>
      <View style={styles.chart}>
        {/* Gridlines sit behind the bars and stop above the day labels. */}
        <View style={styles.grid} pointerEvents="none">
          {[0, 1, 2, 3].map((i) => (
            <View key={i} style={[styles.gridline, i === 3 && styles.baseline]} />
          ))}
        </View>

        <View style={[styles.bars, isDense && styles.barsDense]}>
          {points.map((point) => {
            const { score, date } = point;
            const isToday = date === today;
            const isProvisional = score !== null && point.provisional;

            const fill = isProvisional
              ? AuraColors.provisional
              : isToday
                ? AuraColors.brand.default
                : '#93c5fd';

            return (
              <View key={date} style={styles.column}>
                {isDense ? null : (
                  <Text style={[styles.value, isToday && styles.valueToday]}>
                    {score === null ? '' : Math.round(score)}
                  </Text>
                )}
                <View
                  style={[
                    styles.bar,
                    {
                      height: score === null ? 3 : Math.max((score / 100) * BAR_MAX, 4),
                      backgroundColor: score === null ? AuraColors.surface.selected : fill,
                    },
                  ]}
                />
                <Text style={[styles.day, isToday && styles.dayToday]}>{dayLabel(date)}</Text>
              </View>
            );
          })}
        </View>
      </View>

      <View style={styles.legend}>
        <LegendItem color={AuraColors.brand.default} label="Today" />
        <LegendItem color="#93c5fd" label="Established" />
        <LegendItem color={AuraColors.provisional} label="Provisional" />
      </View>
    </View>
  );
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.swatch, { backgroundColor: color }]} />
      <Text style={styles.legendLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chart: { height: CHART_HEIGHT, justifyContent: 'flex-end' },
  grid: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: LABEL_ROW,
    justifyContent: 'space-between',
  },
  gridline: { height: 1, backgroundColor: '#f1f5f9' },
  baseline: { backgroundColor: AuraColors.surface.selected },
  bars: { flexDirection: 'row', alignItems: 'flex-end', gap: 9 },
  barsDense: { gap: 4 },
  column: { flex: 1, alignItems: 'center', gap: 4 },
  value: {
    fontFamily: Font.semibold,
    fontSize: 11,
    color: AuraColors.content.muted,
    fontVariant: ['tabular-nums'],
  },
  valueToday: { color: AuraColors.content.default },
  bar: { width: '100%', borderTopLeftRadius: 8, borderTopRightRadius: 8, borderBottomLeftRadius: 4, borderBottomRightRadius: 4 },
  day: { fontFamily: Font.regular, fontSize: 10, height: 12, color: AuraColors.content.muted },
  dayToday: { color: AuraColors.content.default },
  legend: {
    flexDirection: 'row',
    gap: 16,
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
    paddingTop: 10,
    marginTop: 4,
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  swatch: { width: 10, height: 4, borderRadius: 999 },
  legendLabel: { fontFamily: Font.regular, fontSize: 11, color: AuraColors.content.muted },
});
