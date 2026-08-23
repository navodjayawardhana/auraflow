import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInUp } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/primary-button';
import { SeatedBaselineNote } from '@/components/seated-baseline-note';
import { Font, Layout, Radius, Shadows, Surfaces, Type, Unit } from '@/constants/design';
import { AuraColors, IconTones } from '@/constants/theme';
import { useIot } from '@/context/iot-context';
import { ApiError } from '@/services/api-client';
import { recordHealthSnapshot } from '@/services/health-snapshot-service';
import { usableHeartRate, usableHeartRateMaxim } from '@/services/iot-payloads';
import { enqueue } from '@/services/outbox';
import { todayIsoDate } from '@/services/recovery-service';
import {
  CAPTURE_MS,
  captureCoverage,
  lowestSustainedBpm,
  SUSTAIN_MS,
  type HeartRateSample,
} from '@/services/resting-capture';
import type { BiometricsTelemetry } from '@/types';

/**
 * A resting heart rate the node can actually produce, taken the same way every morning.
 *
 * The premise of this screen is that asking someone to measure only at night is asking for
 * a measurement they will not take. A seated capture is not the overnight rate a wearable
 * reports and never will be — but taken on waking, sitting, before caffeine, it is stable
 * enough day to day to be a baseline of its own, and a baseline that exists beats one that
 * would have been better.
 *
 * Two things make it that rather than a number off a screen. It runs for a minute instead of
 * grabbing a frame, because the node's estimate wanders by several bpm between publishes —
 * more than the effect any of this is trying to see. And it reduces to the lowest rate
 * *held*, not the lowest seen, which is much closer to what a watch means by a resting rate.
 * See `resting-capture`.
 *
 * Everything written here is tagged `seated_spot`, and the server keeps it in a baseline of
 * its own. The disclosure at the bottom is not decoration: the recovery score's published
 * validation used overnight rates and does not cover a score built on these.
 */

/** How the trace updates while a capture runs. Fine enough to feel live, cheap enough to ignore. */
const TICK_MS = 250;

/**
 * The seconds of the capture treated as settling.
 *
 * Nothing is discarded — the reduction already refuses to be moved by a bad stretch. This
 * only governs what the screen says, so a person watching a number bounce in the first few
 * seconds is told that is expected rather than left to conclude the sensor is broken.
 */
const SETTLING_MS = 8_000;

function Stat({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <View style={styles.stat}>
      <View style={styles.statValueLine}>
        <Text style={styles.statValue}>{value}</Text>
        {unit === undefined ? null : <Text style={Unit}>{unit}</Text>}
      </View>
      <Text style={Type.tileLabel}>{label}</Text>
    </View>
  );
}

export default function MorningCheckinScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const { biometrics, isBiometricsStale, isDeviceOnline, status } = useIot();

  const [phase, setPhase] = useState<'idle' | 'capturing' | 'done'>('idle');
  const [samples, setSamples] = useState<HeartRateSample[]>([]);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [result, setResult] = useState<number | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  /**
   * The same rule the live card uses: the streaming estimate where it resolves, the
   * reference algorithm's where it does not.
   *
   * Not a compromise so much as a refusal to invent a second definition of "your heart rate"
   * — a check-in that disagreed with the number on the dashboard would be two answers to one
   * question. The reference method's coarse four-bpm steps are survivable here for a reason
   * that does not apply on a live readout: nothing is decided by a single frame, and a
   * sustained window has to be low across six or seven of them before it can win.
   */
  const liveBpm = isBiometricsStale
    ? null
    : (usableHeartRate(biometrics) ?? usableHeartRateMaxim(biometrics));

  const hasFinger = biometrics?.finger === true;

  /**
   * The frame already recorded, held by identity rather than by timestamp.
   *
   * The sampling effect below has to re-run when the capture starts and when staleness
   * flips, and neither of those is a new reading. Appending on those would put the same
   * frame into the window twice, weighting one estimate double for no reason a reader of the
   * data could ever discover.
   */
  const lastSampled = useRef<BiometricsTelemetry | null>(null);

  useEffect(() => {
    if (phase !== 'capturing') return;
    if (biometrics === null || biometrics === lastSampled.current) return;

    lastSampled.current = biometrics;

    if (liveBpm === null) return;

    setSamples((held) => [...held, { at: Date.now(), bpm: liveBpm }]);
  }, [biometrics, liveBpm, phase]);

  useEffect(() => {
    if (phase !== 'capturing') return;

    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, [phase]);

  // The capture ends on the clock, not on a sample count. A minute of poor contact still
  // ends after a minute -- with nothing to show, which is the answer.
  useEffect(() => {
    if (phase !== 'capturing' || startedAt === null) return;
    if (now - startedAt < CAPTURE_MS) return;

    setResult(lowestSustainedBpm(samples));
    setPhase('done');
  }, [now, phase, samples, startedAt]);

  function startCapture() {
    setSamples([]);
    setResult(null);
    setSaveError(null);
    lastSampled.current = null;
    setStartedAt(Date.now());
    setNow(Date.now());
    setPhase('capturing');
  }

  function cancelCapture() {
    setPhase('idle');
    setStartedAt(null);
    setSamples([]);
  }

  async function handleSave() {
    if (result === null) return;

    setIsSaving(true);
    setSaveError(null);

    const payload = {
      recorded_on: todayIsoDate(),
      resting_heart_rate: result,
      // The whole point of the screen, in one field. Without it the server refuses the write
      // rather than filing this into the overnight baseline.
      resting_hr_source: 'seated_spot' as const,
    };

    try {
      await recordHealthSnapshot(payload);
      router.back();
    } catch (error) {
      if (error instanceof ApiError && error.status === 0) {
        // Unreachable, not invalid — the minute has already been spent, so it is kept and
        // sent on reconnect rather than asked for again.
        await enqueue({ kind: 'health-snapshot', body: payload });
        router.back();
      } else if (error instanceof ApiError) {
        setSaveError(error.message);
      } else {
        setSaveError('Something went wrong.');
      }
    } finally {
      setIsSaving(false);
    }
  }

  const elapsed = startedAt === null ? 0 : Math.min(now - startedAt, CAPTURE_MS);
  const remainingSeconds = Math.ceil((CAPTURE_MS - elapsed) / 1000);
  const coverage = captureCoverage(samples);
  const isSettling = phase === 'capturing' && elapsed < SETTLING_MS;

  function guidance() {
    if (status === 'connecting') return 'Connecting to your node…';
    if (!isDeviceOnline) return 'Node offline — power it and check its Wi-Fi';
    if (!hasFinger) return 'Rest a finger on the MAX30102 pad to begin';
    if (liveBpm === null) return 'Finding your pulse — hold still';
    return 'Pulse found — start when you are settled';
  }

  function captureCaption() {
    if (!hasFinger) return 'Finger lifted — put it back on the pad, the minute is still running';
    if (isSettling) return 'Settling — the number will wander for a few seconds, that is normal';
    if (liveBpm === null) return 'Signal lost for a moment — press a little more firmly';
    return `${samples.length} readings held · keeping the lowest ${SUSTAIN_MS / 1000} seconds`;
  }

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 14 }]}
        showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <View style={styles.headerText}>
            <Text style={Type.screenTitle}>Morning check-in</Text>
            <Text style={Type.meta}>One minute, sitting still</Text>
          </View>

          <Pressable
            onPress={() => router.back()}
            accessibilityRole="button"
            accessibilityLabel="Close"
            hitSlop={10}
            style={styles.close}>
            <Feather name="x" size={18} color={AuraColors.content.default} />
          </Pressable>
        </View>

        {/* Ahead of the capture, not beside it. What makes a seated baseline usable is that
            every reading in it was taken under the same conditions, so the conditions are
            the instruction rather than a footnote to one. */}
        <Animated.View entering={FadeInUp.duration(400)} style={styles.card}>
          <Text style={Type.cardTitle}>Same conditions, every morning</Text>
          <View style={styles.conditions}>
            {[
              { icon: 'sunrise' as const, text: 'Soon after waking, before the day starts' },
              { icon: 'coffee' as const, text: 'Before caffeine — a coffee is worth several bpm' },
              { icon: 'user' as const, text: 'Sitting, back supported, feet down' },
              { icon: 'clock' as const, text: 'Around the same time each day' },
            ].map((row) => (
              <View key={row.icon} style={styles.condition}>
                <View style={styles.conditionIcon}>
                  <Feather name={row.icon} size={13} color={IconTones.brand.color} />
                </View>
                <Text style={Type.prose}>{row.text}</Text>
              </View>
            ))}
          </View>
          <Text style={Type.caption}>
            A reading taken the same way every day is what makes the comparison mean anything.
            One taken differently is a different measurement wearing the same units.
          </Text>
        </Animated.View>

        <Animated.View entering={FadeInUp.delay(60).duration(400)} style={styles.card}>
          {phase === 'done' ? (
            <>
              <Text style={Type.cardTitle}>
                {result === null ? 'Not enough steady signal' : 'Your reading'}
              </Text>

              {result === null ? (
                <Text style={Type.prose}>
                  The minute never held {SUSTAIN_MS / 1000} unbroken seconds of pulse, so there
                  is nothing here worth putting in a baseline. Rest your finger flat, press
                  lightly but steadily, and try again.
                </Text>
              ) : (
                <>
                  <View style={styles.resultLine}>
                    <Feather name="heart" size={26} color="#fb7185" />
                    <Text style={styles.result}>{result}</Text>
                    <Text style={styles.resultUnit}>BPM</Text>
                  </View>
                  <Text style={Type.prose}>
                    The lowest rate you held for a full {SUSTAIN_MS / 1000} seconds, across{' '}
                    {samples.length} readings — closer to a resting rate than whatever the last
                    frame said.
                  </Text>
                </>
              )}

              {saveError === null ? null : <Text style={styles.error}>{saveError}</Text>}

              <Pressable
                onPress={startCapture}
                accessibilityRole="button"
                accessibilityLabel="Take the reading again"
                style={styles.secondary}>
                <Feather name="rotate-ccw" size={14} color={AuraColors.brand.default} />
                <Text style={styles.secondaryLabel}>Take it again</Text>
              </Pressable>
            </>
          ) : phase === 'capturing' ? (
            <>
              <View style={styles.captureHead}>
                <Text style={Type.cardTitle}>Hold still</Text>
                <Text style={styles.countdown}>{remainingSeconds}s</Text>
              </View>

              <Stat
                label={liveBpm === null ? 'waiting for a reading' : 'right now'}
                value={liveBpm === null ? '—' : String(Math.round(liveBpm))}
                unit="bpm"
              />

              {/* Filled by signal held, not by seconds elapsed. A bar that advanced while the
                  finger was off the pad would reassure the one person who needs to adjust
                  something. */}
              <View
                style={styles.track}
                accessibilityRole="progressbar"
                accessibilityValue={{ min: 0, max: 100, now: Math.round(coverage * 100) }}>
                <View style={[styles.fill, { width: `${Math.round(coverage * 100)}%` }]} />
              </View>

              <Text style={Type.caption}>{captureCaption()}</Text>

              <Pressable
                onPress={cancelCapture}
                accessibilityRole="button"
                accessibilityLabel="Stop the capture"
                style={styles.secondary}>
                <Feather name="x-circle" size={14} color={AuraColors.content.muted} />
                <Text style={styles.cancelLabel}>Stop</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text style={Type.cardTitle}>Take today&apos;s reading</Text>

              <Stat
                label={hasFinger ? 'live from your node' : 'no finger on the pad'}
                value={liveBpm === null ? '—' : String(Math.round(liveBpm))}
                unit="bpm"
              />

              <Text style={Type.prose}>{guidance()}</Text>

              <Text style={Type.caption}>
                The capture runs for {CAPTURE_MS / 1000} seconds and keeps the lowest rate you
                hold for {SUSTAIN_MS / 1000} of them — one frame, high or low, cannot decide it.
              </Text>
            </>
          )}
        </Animated.View>

        <View style={styles.disclosure}>
          <SeatedBaselineNote />
        </View>
      </ScrollView>

      <View style={[styles.commit, { paddingBottom: Math.max(insets.bottom, 20) }]}>
        {phase === 'done' && result !== null ? (
          <PrimaryButton label="Save this morning" onPress={handleSave} loading={isSaving} />
        ) : (
          <PrimaryButton
            label={phase === 'capturing' ? 'Measuring…' : `Start ${CAPTURE_MS / 1000}-second capture`}
            onPress={startCapture}
            disabled={phase === 'capturing' || liveBpm === null}
          />
        )}
        <Text style={styles.commitNote}>
          {phase === 'done' && result !== null
            ? 'Saved as a seated reading, kept apart from any overnight ones'
            : 'Queues and syncs later if you’re offline'}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: AuraColors.surface.sunken },
  scroll: { paddingHorizontal: Layout.gutter, paddingBottom: 24, gap: Layout.gapCards },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  headerText: { flex: 1, gap: 4 },
  close: {
    width: 36,
    height: 36,
    borderRadius: Radius.iconSquare,
    backgroundColor: AuraColors.surface.default,
    alignItems: 'center',
    justifyContent: 'center',
    ...Shadows.chip,
  },
  card: { ...Surfaces.card, gap: 12 },
  conditions: { gap: 10 },
  condition: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  conditionIcon: {
    width: 28,
    height: 28,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: IconTones.brand.bg,
  },
  captureHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  countdown: {
    fontFamily: Font.bold,
    fontSize: 15,
    color: AuraColors.brand.default,
    fontVariant: ['tabular-nums'],
  },
  stat: { gap: 2 },
  statValueLine: { flexDirection: 'row', alignItems: 'flex-end', gap: 5 },
  statValue: {
    fontFamily: Font.bold,
    fontSize: 34,
    lineHeight: 34,
    color: AuraColors.content.default,
    fontVariant: ['tabular-nums'],
  },
  track: {
    height: 6,
    borderRadius: Radius.pill,
    backgroundColor: AuraColors.surface.selected,
    overflow: 'hidden',
  },
  fill: { height: 6, borderRadius: Radius.pill, backgroundColor: AuraColors.brand.default },
  resultLine: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  result: {
    fontFamily: Font.bold,
    fontSize: 46,
    lineHeight: 46,
    color: AuraColors.content.default,
    fontVariant: ['tabular-nums'],
  },
  resultUnit: {
    fontFamily: Font.semibold,
    fontSize: 12,
    letterSpacing: 1.4,
    color: AuraColors.content.muted,
    paddingBottom: 6,
  },
  secondary: { flexDirection: 'row', alignItems: 'center', gap: 7, minHeight: 32 },
  secondaryLabel: { fontFamily: Font.semibold, fontSize: 12, color: AuraColors.brand.default },
  cancelLabel: { fontFamily: Font.semibold, fontSize: 12, color: AuraColors.content.muted },
  disclosure: { paddingHorizontal: 4 },
  error: { ...Type.caption, color: AuraColors.danger },
  commit: {
    paddingHorizontal: Layout.gutter,
    paddingTop: 12,
    gap: 10,
    backgroundColor: AuraColors.surface.default,
    borderTopWidth: 1,
    borderTopColor: 'rgba(15,23,42,0.06)',
  },
  commitNote: { ...Type.caption, textAlign: 'center' },
});
