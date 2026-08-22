import { Feather } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInUp } from 'react-native-reanimated';

import { Font, Surfaces, Type, Unit } from '@/constants/design';
import { AuraColors, IconTones } from '@/constants/theme';

/**
 * Three states, and the difference between them is the app's honesty contract rather
 * than a style choice.
 *
 * `estimated` shows a `≈` before the value; `unavailable` shows an em dash, never a zero
 * — a zero is a claim that nothing happened. Both keep a spacer where `measured` puts its
 * progress bar, so a grid of mixed states stays on one baseline.
 */
export type MetricState = 'measured' | 'estimated' | 'unavailable';

interface MetricTileProps {
  label: string;
  value: string;
  unit?: string;
  icon: keyof typeof Feather.glyphMap;
  tone?: keyof typeof IconTones;
  state?: MetricState;
  /** Provenance, not decoration — where the number came from, or why there isn't one. */
  caption?: string;
  /** 0..1. Only drawn for a measured value. */
  progress?: number;
  index?: number;
}

export function MetricTile({
  label,
  value,
  unit,
  icon,
  tone = 'brand',
  state = 'measured',
  caption,
  progress,
  index = 0,
}: MetricTileProps) {
  const isUnavailable = state === 'unavailable';
  const badge = IconTones[tone];

  const iconColor = isUnavailable ? AuraColors.content.muted : badge.color;
  const iconBg = isUnavailable ? AuraColors.surface.selected : badge.bg;

  return (
    <Animated.View
      entering={FadeInUp.delay(index * 60).duration(400)}
      style={styles.tile}
      accessibilityRole="text"
      accessibilityLabel={
        isUnavailable
          ? `${label}: not available. ${caption ?? ''}`
          : `${label}: ${state === 'estimated' ? 'about ' : ''}${value}${unit ? ` ${unit}` : ''}`
      }>
      <View style={styles.head}>
        <View style={[styles.icon, { backgroundColor: iconBg }]}>
          <Feather name={icon} size={15} color={iconColor} />
        </View>
        <Text style={Type.tileLabel}>{label}</Text>
      </View>

      <View style={styles.valueRow}>
        {isUnavailable ? (
          <Text style={styles.dash}>—</Text>
        ) : (
          <>
            {state === 'estimated' ? <Text style={styles.approx}>≈</Text> : null}
            <Text style={Type.tileMetric}>{value}</Text>
            {unit ? <Text style={Unit}>{unit}</Text> : null}
          </>
        )}
      </View>

      {/* Always 4px tall, filled or not, so mixed-state tiles line up. */}
      <View style={styles.track}>
        {state === 'measured' && progress !== undefined ? (
          <View
            style={[
              styles.fill,
              { width: `${Math.min(Math.max(progress, 0), 1) * 100}%`, backgroundColor: badge.color },
            ]}
          />
        ) : null}
      </View>

      {caption ? <Text style={Type.caption}>{caption}</Text> : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  tile: { ...Surfaces.tile, flex: 1, gap: 9 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  icon: { width: 30, height: 30, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  valueRow: { flexDirection: 'row', alignItems: 'baseline', gap: 4 },
  approx: { fontFamily: Font.semibold, fontSize: 18, color: AuraColors.content.muted },
  dash: { fontFamily: Font.regular, fontSize: 20, color: AuraColors.content.muted },
  track: {
    height: 4,
    borderRadius: 999,
    backgroundColor: AuraColors.surface.selected,
    overflow: 'hidden',
  },
  fill: { height: 4, borderRadius: 999 },
});
