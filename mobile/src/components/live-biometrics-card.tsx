import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, Text, View } from 'react-native';

import { PpgTrace } from '@/components/ppg-trace';
import { Font, GradientAxis, Radius, Shadows } from '@/constants/design';
import { AuraColors } from '@/constants/theme';
import { useIot } from '@/context/iot-context';
import { isSettling, usableHeartRate, usableSpo2 } from '@/services/iot-payloads';

/** Below this the optical signal is mostly noise, whatever the algorithm reports. */
const WEAK_SIGNAL_IR = 100_000;

function Badge({
  icon,
  label,
  tone,
}: {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  tone: 'live' | 'idle';
}) {
  const isLive = tone === 'live';

  return (
    <View style={[styles.badge, isLive ? styles.badgeLive : styles.badgeIdle]}>
      {isLive ? (
        <View style={styles.badgeDot} />
      ) : (
        <Feather name={icon} size={11} color="rgba(255,255,255,0.7)" />
      )}
      <Text style={styles.badgeLabel}>{label}</Text>
    </View>
  );
}

export function LiveBiometricsCard() {
  const { biometrics, isBiometricsStale, isDeviceOnline, status } = useIot();

  const heartRate = usableHeartRate(biometrics);
  const spo2 = usableSpo2(biometrics);
  const hasFinger = biometrics?.finger === true;
  const weakSignal = hasFinger && (biometrics?.ir_mean ?? 0) < WEAK_SIGNAL_IR;

  // Contact made, but the node's analysis window is not yet full of it. Worth its own
  // state: it looks identical to a failing reading and has the opposite fix — wait,
  // rather than adjust anything.
  const isMeasuring = isSettling(biometrics);

  // Stale readings are greyed and relabelled rather than left looking current. A vital
  // sign is the one number where "probably still true" is not good enough.
  const isLive = hasFinger && !isBiometricsStale && heartRate !== null;

  // Whole bpm on the card. The node resolves a decimal and the payload keeps it, because
  // the agreement analysis needs the resolution — but a tenth of a beat per minute
  // flickering on a glanceable number is noise wearing the costume of precision.
  const displayBpm = heartRate === null ? null : Math.round(heartRate);

  function footer() {
    if (status === 'connecting') return 'Connecting to your node…';
    if (!isDeviceOnline) return 'Node offline — power it and check its Wi-Fi';
    if (!hasFinger) return 'Rest a finger on the MAX30102 pad';
    if (isBiometricsStale) return 'Waiting for a fresh reading';
    // Ahead of the weak-signal hint deliberately: telling someone to press harder while
    // the node is still filling its window would have them fidgeting through the one
    // stretch that has to stay still.
    if (isMeasuring) return 'Measuring — hold still for a few seconds';
    if (heartRate === null) return weakSignal ? 'Press a little more firmly' : 'Finding your pulse';
    return 'Finger on sensor · updating every 1.5s';
  }

  return (
    <View
      style={styles.card}
      accessibilityLiveRegion="polite"
      accessibilityLabel={
        isLive
          ? `Heart rate ${displayBpm} beats per minute${spo2 !== null ? `, oxygen saturation ${spo2} percent` : ''}`
          : 'Waiting for a reading from the sensor'
      }>
      <LinearGradient
        colors={['#0f172a', '#12306e', AuraColors.brand.default]}
        locations={[0, 0.58, 1]}
        start={GradientAxis.deg140.start}
        end={GradientAxis.deg140.end}
        style={StyleSheet.absoluteFill}
      />

      <View style={styles.head}>
        <Text style={styles.eyebrow}>LIVE BIOMETRICS</Text>
        {isLive ? (
          <Badge icon="activity" label="Streaming" tone="live" />
        ) : (
          <Badge icon="wifi-off" label={isDeviceOnline ? 'Idle' : 'Offline'} tone="idle" />
        )}
      </View>

      <View style={styles.metrics}>
        <View>
          <View style={styles.metricRow}>
            <Feather
              name="heart"
              size={22}
              color={isLive ? '#fda4af' : 'rgba(255,255,255,0.35)'}
            />
            <Text style={[styles.primary, !isLive && styles.dimmed]}>{displayBpm ?? '—'}</Text>
          </View>
          <Text style={styles.unit}>BPM</Text>
        </View>

        <View>
          <Text style={[styles.secondary, !isLive && styles.dimmed]}>
            {spo2 !== null && isLive ? `${spo2}%` : '—'}
          </Text>
          <Text style={styles.unitPlain}>SpO₂</Text>
        </View>
      </View>

      <PpgTrace bpm={isLive ? heartRate : null} isLive={isLive} />

      <View style={styles.footer}>
        <Feather name="clock" size={13} color="rgba(255,255,255,0.6)" />
        <Text style={styles.footerText}>{footer()}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: Radius.card,
    padding: 20,
    gap: 16,
    overflow: 'hidden',
    ...Shadows.dark,
  },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  eyebrow: {
    fontFamily: Font.semibold,
    fontSize: 13,
    letterSpacing: 1.6,
    color: 'rgba(255,255,255,0.6)',
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 24,
    paddingHorizontal: 10,
    borderRadius: 999,
  },
  badgeLive: { backgroundColor: 'rgba(74,222,128,0.18)' },
  badgeIdle: { backgroundColor: 'rgba(255,255,255,0.12)' },
  badgeDot: { width: 6, height: 6, borderRadius: 999, backgroundColor: '#4ade80' },
  badgeLabel: {
    fontFamily: Font.semibold,
    fontSize: 10,
    color: 'rgba(255,255,255,0.9)',
  },
  metrics: { flexDirection: 'row', gap: 28, alignItems: 'flex-start' },
  metricRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  primary: {
    fontFamily: Font.bold,
    fontSize: 46,
    lineHeight: 46,
    color: '#ffffff',
    fontVariant: ['tabular-nums'],
  },
  secondary: {
    fontFamily: Font.bold,
    fontSize: 28,
    color: '#ffffff',
    fontVariant: ['tabular-nums'],
  },
  dimmed: { color: 'rgba(255,255,255,0.4)' },
  unit: {
    fontFamily: Font.semibold,
    fontSize: 11,
    letterSpacing: 1.4,
    color: 'rgba(255,255,255,0.55)',
    paddingLeft: 31,
  },
  unitPlain: {
    fontFamily: Font.semibold,
    fontSize: 11,
    letterSpacing: 1.4,
    color: 'rgba(255,255,255,0.55)',
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.12)',
    paddingTop: 12,
  },
  footerText: { fontFamily: Font.regular, fontSize: 11, color: 'rgba(255,255,255,0.6)' },
});
