import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { PpgTrace } from '@/components/ppg-trace';
import { Font, GradientAxis, Radius, Shadows } from '@/constants/design';
import { AuraColors } from '@/constants/theme';
import { useIot } from '@/context/iot-context';
import {
  beatProgress,
  isSettling,
  usableHeartRate,
  usableHeartRateMaxim,
  usableSpo2,
} from '@/services/iot-payloads';

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

  /**
   * The streaming estimate where there is one, the reference algorithm's where there is not.
   *
   * Both come from the same signal and the node publishes both. The streaming one is
   * preferred because it resolves a real value between beats rather than snapping to the
   * roughly four-bpm steps the reference method can express at rest -- but preferring it is
   * not the same as waiting for it. On this sensor it frequently never resolves at all
   * while the reference one does, and a number a person can act on beats a better number
   * they never see.
   *
   * Which one is on screen is said in the footer, never left to be inferred from how round
   * it looks.
   */
  const streamed = usableHeartRate(biometrics);
  const reference = usableHeartRateMaxim(biometrics);
  const heartRate = streamed ?? reference;
  const isReferenceRate = streamed === null && reference !== null;
  const spo2 = usableSpo2(biometrics);
  const hasFinger = biometrics?.finger === true;
  const weakSignal = hasFinger && (biometrics?.ir_mean ?? 0) < WEAK_SIGNAL_IR;

  // Contact made, but the node's analysis window is not yet full of it. Worth its own
  // state: it looks identical to a failing reading and has the opposite fix — wait,
  // rather than adjust anything.
  const isMeasuring = isSettling(biometrics);

  // Counting beats off rather than spinning. Six seconds of "measuring" with nothing moving
  // is indistinguishable from a measurement that has stalled, and the node already knows
  // the difference -- it just was not saying.
  const progress = beatProgress(biometrics);

  /**
   * The last rate resolved during this contact, kept while the finger stays down.
   *
   * The estimator reports on three intervals within a ten-second window, so a stretch where
   * beats are missed ages them out and the rate goes invalid — with the finger still on the
   * pad. Dropping the number then sends the card back to "measuring", which reads as
   * starting over rather than as a moment of poor signal, and it is the complaint people
   * actually have about this sensor.
   *
   * So the number is held rather than cleared, and marked as held. A figure from eight
   * seconds ago labelled as such is far more use than no figure at all; a figure from eight
   * seconds ago presented as current is the one thing that would not be. It is cleared the
   * instant contact is, because then it describes nobody.
   */
  const held = useRef<number | null>(null);

  // Written in an effect, not during render: a render can be discarded or replayed, and
  // this is the same hazard the nav bar's shared value had. There is no frame of lag to pay
  // for it -- on any render where a fresh rate exists the fresh one is shown, so the ref is
  // only ever read after the effect that filled it has run.
  useEffect(() => {
    if (!hasFinger) {
      held.current = null;
    } else if (heartRate !== null) {
      held.current = heartRate;
    }
  }, [hasFinger, heartRate]);

  const shown = heartRate ?? held.current;
  const isReacquiring = hasFinger && heartRate === null && held.current !== null;

  // Stale readings are greyed and relabelled rather than left looking current. A vital
  // sign is the one number where "probably still true" is not good enough.
  const isLive = hasFinger && !isBiometricsStale && heartRate !== null;

  // Whole bpm on the card. The node resolves a decimal and the payload keeps it, because
  // the agreement analysis needs the resolution — but a tenth of a beat per minute
  // flickering on a glanceable number is noise wearing the costume of precision.
  const displayBpm = shown === null ? null : Math.round(shown);

  function footer() {
    if (status === 'connecting') return 'Connecting to your node…';
    if (!isDeviceOnline) return 'Node offline — power it and check its Wi-Fi';
    if (!hasFinger) return 'Rest a finger on the MAX30102 pad';
    if (isBiometricsStale) return 'Waiting for a fresh reading';
    // Ahead of the weak-signal hint deliberately: telling someone to press harder while
    // the node is still filling its window would have them fidgeting through the one
    // stretch that has to stay still.
    // Re-acquiring is checked before measuring: both have no current rate, but one has
    // already had one, and telling someone who is mid-measurement that it is starting over
    // is the thing that makes this sensor feel broken when it is merely working hard.
    if (isReacquiring) {
      return weakSignal
        ? 'Holding the last reading — press a little more firmly'
        : 'Holding the last reading — finding your pulse again';
    }
    if (isMeasuring) {
      return progress === null
        ? 'Measuring — hold still for a few seconds'
        : `Measuring — ${progress.have} of ${progress.need} beats · hold still`;
    }
    // Named rather than hidden. The reference method steps in roughly four-bpm increments
    // at rest, so a reading that sits still for a while is the algorithm's resolution
    // rather than the heart's, and a person watching it deserves to know which.
    if (isReferenceRate) return 'Finger on sensor · reference estimate, to the nearest few bpm';
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
