import { StyleSheet, Text, View } from 'react-native';

import { Font } from '@/constants/design';
import { AuraColors } from '@/constants/theme';
import type { RecoveryReading } from '@/types';

const CHART_HEIGHT = 176;
const BAR_MAX = 130;
const LABEL_ROW = 22;
const WEEKDAY = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function dayLabel(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  return WEEKDAY[new Date(y, m - 1, d).getDay()];
}

/**
 * Seven days of recovery.
 *
 * Provisional days are violet rather than a faded blue: a score computed without a
 * personal heart-rate baseline is a different measurement, not a weaker one, and fading
 * it would invite reading it as "worse". The legend names all three so the chart is
 * readable without a tap.
 */
export function RecoveryTrendChart({
  readings,
  today,
}: {
  readings: RecoveryReading[];
  today: string;
}) {
  return (
    <View>
      <View style={styles.chart}>
        {/* Gridlines sit behind the bars and stop above the day labels. */}
        <View style={styles.grid} pointerEvents="none">
          {[0, 1, 2, 3].map((i) => (
            <View key={i} style={[styles.gridline, i === 3 && styles.baseline]} />
          ))}
        </View>

        <View style={styles.bars}>
          {readings.map((reading) => {
            const score = reading.available ? reading.score : null;
            const isToday = reading.date === today;
            const isProvisional = reading.available && reading.provisional;

            const fill = isProvisional
              ? AuraColors.provisional
              : isToday
                ? AuraColors.brand.default
                : '#93c5fd';

            return (
              <View key={reading.date} style={styles.column}>
                <Text style={[styles.value, isToday && styles.valueToday]}>
                  {score === null ? '' : Math.round(score)}
                </Text>
                <View
                  style={[
                    styles.bar,
                    {
                      height: score === null ? 3 : Math.max((score / 100) * BAR_MAX, 4),
                      backgroundColor: score === null ? AuraColors.surface.selected : fill,
                    },
                  ]}
                />
                <Text style={[styles.day, isToday && styles.dayToday]}>
                  {dayLabel(reading.date)}
                </Text>
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
