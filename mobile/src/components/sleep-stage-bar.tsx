import { Feather } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInUp } from 'react-native-reanimated';

import { Font, Radius, Surfaces, Type } from '@/constants/design';
import { AuraColors, IconTones } from '@/constants/theme';
import type { HealthSnapshot } from '@/types';

function duration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);

  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function Legend({ color, label, minutes }: { color: string; label: string; minutes: number }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={styles.legendLabel}>
        {label} <Text style={styles.legendValue}>{duration(minutes)}</Text>
      </Text>
    </View>
  );
}

/**
 * The stage split, which sat unused in `health_snapshots` from the first migration — the
 * recovery score consumed it and the UI only ever showed the result.
 */
export function SleepStageBar({ snapshot }: { snapshot: HealthSnapshot | null }) {
  const total = snapshot?.sleep_minutes ?? null;
  const deep = snapshot?.deep_sleep_minutes ?? null;
  const rem = snapshot?.rem_sleep_minutes ?? null;

  // Without both stages there is no breakdown to draw — "light" would be the whole night,
  // which says nothing. Hidden rather than shown as one flat bar.
  if (total === null || total <= 0 || deep === null || rem === null) return null;

  const light = Math.max(total - deep - rem, 0);

  return (
    <Animated.View entering={FadeInUp.duration(400)} style={styles.card}>
      <View style={styles.head}>
        <View style={styles.title}>
          <View style={[styles.icon, { backgroundColor: IconTones.stage.bg }]}>
            <Feather name="moon" size={15} color={IconTones.stage.color} />
          </View>
          <Text style={Type.cardTitle}>Last night</Text>
        </View>
        <Text style={styles.total}>{duration(total)}</Text>
      </View>

      <View
        style={styles.bar}
        accessibilityRole="image"
        accessibilityLabel={`Sleep stages: ${duration(deep)} deep, ${duration(rem)} REM, ${duration(
          light,
        )} light`}>
        <View style={[styles.segment, styles.first, { flex: deep, backgroundColor: AuraColors.brand.default }]} />
        <View style={[styles.segment, { flex: rem, backgroundColor: AuraColors.provisional }]} />
        <View style={[styles.segment, styles.last, { flex: light, backgroundColor: AuraColors.surface.selected }]} />
      </View>

      <View style={styles.legend}>
        <Legend color={AuraColors.brand.default} label="Deep" minutes={deep} />
        <Legend color={AuraColors.provisional} label="REM" minutes={rem} />
        <Legend color={AuraColors.surface.selected} label="Light" minutes={light} />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: { ...Surfaces.card, gap: 12 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  icon: {
    width: 30,
    height: 30,
    borderRadius: Radius.iconSmall,
    alignItems: 'center',
    justifyContent: 'center',
  },
  total: {
    fontFamily: Font.bold,
    fontSize: 15,
    color: AuraColors.content.default,
    fontVariant: ['tabular-nums'],
  },
  bar: { flexDirection: 'row', gap: 2, height: 14 },
  segment: { height: 14 },
  first: { borderTopLeftRadius: 999, borderBottomLeftRadius: 999 },
  last: { borderTopRightRadius: 999, borderBottomRightRadius: 999 },
  legend: { flexDirection: 'row', gap: 16 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 999 },
  legendLabel: { fontFamily: Font.regular, fontSize: 11, color: AuraColors.content.muted },
  legendValue: { fontFamily: Font.semibold, color: AuraColors.content.default },
});
