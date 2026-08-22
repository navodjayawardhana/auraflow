import { Feather } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PoseSkeleton } from '@/components/pose-skeleton';
import { PrimaryButton } from '@/components/primary-button';
import { Font, Layout, Radius, Surfaces, Type } from '@/constants/design';
import { AuraColors } from '@/constants/theme';
import { useIot } from '@/context/iot-context';
import { useCachedResource } from '@/hooks/use-cached-resource';
import { useSquatSession } from '@/hooks/use-squat-session';
import { RepCounterThresholds } from '@/ml/rep-counter';
import { prescribeSession } from '@/ml/session-prescription';
import { ApiError } from '@/services/api-client';
import { usableHeartRate } from '@/services/iot-payloads';
import { logExerciseSession, newSessionId } from '@/services/movement-service';
import { enqueue } from '@/services/outbox';
import { fetchRecovery, todayIsoDate } from '@/services/recovery-service';

export default function MoveScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();

  const [permission, requestPermission] = useCameraPermissions();
  const camera = useRef<CameraView | null>(null);

  const today = todayIsoDate();
  const recoveryFetcher = useCallback(() => fetchRecovery(today), [today]);
  const { data: recovery } = useCachedResource(`recovery.${today}`, recoveryFetcher);
  const prescription = prescribeSession(recovery);

  const { biometrics, isBiometricsStale, setLight } = useIot();
  const liveHeartRate = isBiometricsStale ? null : usableHeartRate(biometrics);

  // Mean over the session rather than the last reading: a single beat at the moment you
  // stopped says less about the set than its average does.
  const heartRates = useRef<number[]>([]);

  const onShallowRep = useCallback(() => {
    // The firmware already implements `alert` and nothing triggered it until now. It is
    // momentary — the node reverts after about six seconds on its own.
    setLight('alert');
  }, [setLight]);

  const session = useSquatSession({ camera, onShallowRep });

  useEffect(() => {
    if (session.phase === 'running' && liveHeartRate !== null) {
      heartRates.current.push(liveHeartRate);
    }
  }, [session.phase, liveHeartRate]);

  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'queued' | 'failed'>(
    'idle',
  );

  async function finish() {
    session.stop();

    if (session.counter.reps === 0) {
      router.back();
      return;
    }

    setSaveState('saving');

    const beats = heartRates.current;
    const payload = {
      exercise: 'squat' as const,
      total_reps: session.counter.reps,
      good_form_reps: session.counter.goodFormReps,
      duration_seconds: session.elapsedSeconds,
      mean_heart_rate:
        beats.length === 0
          ? null
          : Math.round(beats.reduce((sum, b) => sum + b, 0) / beats.length),
      prescribed_intensity: prescription.intensity,
      // The two travel together: an ungated session must not invent a score it never saw.
      recovery_score:
        prescription.intensity === 'unknown' || !recovery?.available
          ? null
          : Math.round(recovery.score),
      client_uuid: newSessionId(),
    };

    try {
      await logExerciseSession(payload);
      setSaveState('saved');
    } catch (error) {
      if (error instanceof ApiError && error.status === 0) {
        // Unreachable, not invalid. The client id makes the replay safe.
        await enqueue({ kind: 'exercise-session', body: payload });
        setSaveState('queued');
      } else {
        setSaveState('failed');
      }
    }
  }

  if (permission === null) return <View style={styles.screen} />;

  if (!permission.granted) {
    return (
      <View style={[styles.screen, styles.centred, { paddingTop: insets.top }]}>
        <View style={styles.permissionCard}>
          <Text style={Type.cardTitle}>AuraFlow needs the camera</Text>
          <Text style={Type.prose}>
            The session counts your squats by reading your joints from the camera. Frames are
            analysed on this phone and never leave it — nothing is uploaded and nothing is
            saved to your photos.
          </Text>
          <PrimaryButton label="Allow camera" onPress={requestPermission} />
          <Pressable onPress={() => router.back()} accessibilityRole="button" hitSlop={10}>
            <Text style={styles.dismiss}>Not now</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const { counter } = session;
  const isAtDepth =
    counter.minAngleThisRep !== null &&
    counter.minAngleThisRep <= RepCounterThresholds.goodDepthAngleMax;

  return (
    <View style={styles.screen}>
      <CameraView ref={camera} style={StyleSheet.absoluteFill} facing="back" animateShutter={false} />

      <PoseSkeleton
        landmarks={session.landmarks}
        sourceWidth={session.frameSize?.width ?? 0}
        sourceHeight={session.frameSize?.height ?? 0}
        width={width}
        height={height}
        isAtDepth={isAtDepth}
      />

      {/* Top — who is in charge of the session and how to leave it. */}
      <View style={[styles.top, { paddingTop: insets.top + 10 }]}>
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Close the session"
          hitSlop={12}
          style={styles.close}>
          <Feather name="x" size={20} color="#ffffff" />
        </Pressable>

        <View style={styles.prescription}>
          <Text style={styles.prescriptionTitle}>{prescription.headline}</Text>
          <Text style={styles.prescriptionReason}>{prescription.reason}</Text>
        </View>
      </View>

      {/* Bottom — the count, and the one control. */}
      <View style={[styles.bottom, { paddingBottom: Math.max(insets.bottom, 18) }]}>
        {session.phase === 'loading' ? (
          <View style={styles.status}>
            <Text style={styles.statusTitle}>
              {session.downloadProgress > 0 && session.downloadProgress < 1
                ? `Getting the pose model ready — ${Math.round(session.downloadProgress * 100)}%`
                : 'Getting the pose model ready'}
            </Text>
            <Text style={styles.statusNote}>
              A one-off download. After this the session works with no connection.
            </Text>
          </View>
        ) : null}

        {session.error !== null ? <Text style={styles.error}>{session.error}</Text> : null}

        {session.phase !== 'loading' ? (
          <>
            <View style={styles.metrics}>
              <View style={styles.repBlock}>
                <Text style={styles.reps}>{counter.reps}</Text>
                <Text style={styles.repsLabel}>
                  {prescription.targetReps === null
                    ? 'REPS'
                    : `OF ${prescription.targetReps} REPS`}
                </Text>
              </View>

              <View style={styles.side}>
                <Stat
                  label="Reached depth"
                  value={`${counter.goodFormReps}`}
                  tone={counter.reps > counter.goodFormReps ? 'caution' : 'good'}
                />
                <Stat
                  label="Knee angle"
                  value={counter.lastAngle === null ? '—' : `${Math.round(counter.lastAngle)}°`}
                />
                <Stat
                  label="Heart rate"
                  value={liveHeartRate === null ? '—' : `${liveHeartRate}`}
                />
              </View>
            </View>

            {counter.phase === 'unknown' && session.phase === 'running' ? (
              <Text style={styles.hint}>
                Stand so your hips, knees and ankles are all in frame — counting starts from
                standing.
              </Text>
            ) : null}

            {session.phase === 'ready' ? (
              <PrimaryButton label="Start" onPress={session.start} />
            ) : null}

            {session.phase === 'running' ? (
              <PrimaryButton label={`Finish · ${formatDuration(session.elapsedSeconds)}`} onPress={finish} />
            ) : null}

            {session.phase === 'finished' ? (
              <View style={styles.finish}>
                <Text style={styles.finishText}>
                  {saveState === 'saving'
                    ? 'Saving…'
                    : saveState === 'saved'
                      ? `Saved — ${counter.reps} reps, ${counter.goodFormReps} at depth.`
                      : saveState === 'queued'
                        ? "Saved on this phone — it'll sync when you're back online."
                        : saveState === 'failed'
                          ? "Couldn't save this session."
                          : ''}
                </Text>
                <PrimaryButton label="Done" onPress={() => router.back()} />
              </View>
            ) : null}

            <Text style={styles.disclosure}>
              Pose landmarks come from YOLO26n-Pose, pre-trained by others and used as-is. The
              rep count is a knee-angle rule, not a model: a rep is counted below{' '}
              {RepCounterThresholds.repAngleMax}° and reaches depth below{' '}
              {RepCounterThresholds.goodDepthAngleMax}°. Depth is the only form check —
              a single camera cannot judge knee or spine position reliably.
            </Text>
          </>
        ) : null}
      </View>
    </View>
  );
}

function Stat({
  label,
  value,
  tone = 'plain',
}: {
  label: string;
  value: string;
  tone?: 'plain' | 'good' | 'caution';
}) {
  const color =
    tone === 'good' ? AuraColors.brand.glow : tone === 'caution' ? '#fbbf24' : '#ffffff';

  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;

  return `${m}:${s.toString().padStart(2, '0')}`;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#000000' },
  centred: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: Layout.gutter },

  permissionCard: { ...Surfaces.card, gap: 14, width: '100%' },
  dismiss: { ...Type.meta, textAlign: 'center' },

  top: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingHorizontal: Layout.gutter,
  },
  close: {
    width: 40,
    height: 40,
    borderRadius: Radius.pill,
    backgroundColor: 'rgba(8,22,54,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  prescription: {
    flex: 1,
    gap: 3,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: Radius.panel,
    backgroundColor: 'rgba(8,22,54,0.55)',
  },
  prescriptionTitle: { fontFamily: Font.bold, fontSize: 14, color: '#ffffff' },
  prescriptionReason: {
    fontFamily: Font.regular,
    fontSize: 11,
    lineHeight: 15,
    color: 'rgba(255,255,255,0.78)',
  },

  bottom: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    gap: 14,
    paddingHorizontal: Layout.gutter,
    paddingTop: 18,
    borderTopLeftRadius: Radius.sheet,
    borderTopRightRadius: Radius.sheet,
    backgroundColor: 'rgba(8,22,54,0.82)',
  },
  metrics: { flexDirection: 'row', alignItems: 'center', gap: 18 },
  repBlock: { alignItems: 'flex-start' },
  reps: { ...Type.heroMetric },
  repsLabel: {
    fontFamily: Font.semibold,
    fontSize: 10,
    letterSpacing: 2,
    color: 'rgba(255,255,255,0.6)',
  },
  side: { flex: 1, gap: 8 },
  stat: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  statValue: { fontFamily: Font.bold, fontSize: 16, fontVariant: ['tabular-nums'] },
  statLabel: { fontFamily: Font.regular, fontSize: 11, color: 'rgba(255,255,255,0.65)' },

  status: { gap: 4 },
  statusTitle: { fontFamily: Font.semibold, fontSize: 14, color: '#ffffff' },
  statusNote: { fontFamily: Font.regular, fontSize: 11, color: 'rgba(255,255,255,0.7)' },
  error: { fontFamily: Font.medium, fontSize: 12, color: '#fca5a5' },
  hint: {
    fontFamily: Font.regular,
    fontSize: 11,
    lineHeight: 15,
    color: 'rgba(255,255,255,0.72)',
  },
  finish: { gap: 10 },
  finishText: { fontFamily: Font.medium, fontSize: 13, color: '#ffffff' },
  disclosure: {
    fontFamily: Font.regular,
    fontSize: 10,
    lineHeight: 14,
    color: 'rgba(255,255,255,0.55)',
  },
});
