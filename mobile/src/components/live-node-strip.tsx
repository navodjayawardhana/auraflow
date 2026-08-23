import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, Text, View } from 'react-native';

import { Font, GradientAxis, Radius, Shadows, Unit } from '@/constants/design';
import type { VitalsSource } from '@/services/vitals-merge';

/**
 * Live vitals from the node, on Today.
 *
 * Rendered only while a reading is actually current. A stale heart rate shown as live is
 * the single most misleading thing a health dashboard can do, so this strip disappears
 * rather than freezing its last value — the Device screen is where a stale state is
 * explained.
 */
export function LiveNodeStrip({
  heartRate,
  spo2,
  source,
}: {
  heartRate: number;
  spo2: number | null;
  source: VitalsSource;
}) {
  // The badge already existed to say the number is current; over Bluetooth it says how it
  // got here as well. Same badge, one word different — a second indicator for the same
  // fact would be two things to read where there was one.
  const badge = source === 'ble' ? 'BLUETOOTH' : 'LIVE';

  return (
    <View
      style={styles.strip}
      accessibilityRole="text"
      accessibilityLiveRegion="polite"
      accessibilityLabel={`Live heart rate ${heartRate} beats per minute${
        spo2 !== null ? `, oxygen saturation ${spo2} percent` : ''
      }${source === 'ble' ? ', over Bluetooth' : ''}`}>
      <LinearGradient
        colors={['#0f172a', '#14306b']}
        start={GradientAxis.deg120.start}
        end={GradientAxis.deg120.end}
        style={StyleSheet.absoluteFill}
      />

      <View style={styles.icon}>
        <Feather name="heart" size={19} color="#fda4af" />
      </View>

      <View style={styles.values}>
        <View style={styles.pair}>
          <Text style={styles.primary}>{heartRate}</Text>
          <Text style={styles.unit}>bpm</Text>
        </View>

        {spo2 !== null ? (
          <View style={styles.pair}>
            <Text style={styles.secondary}>{spo2}%</Text>
            <Text style={styles.unit}>SpO₂</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.badge}>
        <View style={styles.badgeDot} />
        <Text style={styles.badgeLabel}>{badge}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  strip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: Radius.row,
    overflow: 'hidden',
    ...Shadows.dark,
  },
  icon: {
    width: 38,
    height: 38,
    borderRadius: Radius.iconMedium,
    backgroundColor: 'rgba(220,38,38,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  values: { flex: 1, flexDirection: 'row', alignItems: 'baseline', gap: 14 },
  pair: { flexDirection: 'row', alignItems: 'baseline', gap: 4 },
  primary: {
    fontFamily: Font.bold,
    fontSize: 26,
    color: '#ffffff',
    fontVariant: ['tabular-nums'],
  },
  secondary: {
    fontFamily: Font.semibold,
    fontSize: 18,
    color: '#ffffff',
    fontVariant: ['tabular-nums'],
  },
  unit: { ...Unit, color: 'rgba(255,255,255,0.58)' },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    height: 22,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  badgeDot: { width: 6, height: 6, borderRadius: 999, backgroundColor: '#4ade80' },
  badgeLabel: {
    fontFamily: Font.semibold,
    fontSize: 10,
    letterSpacing: 0.8,
    color: 'rgba(255,255,255,0.9)',
  },
});
