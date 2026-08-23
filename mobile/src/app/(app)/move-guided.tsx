import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ConfirmAction } from '@/components/confirm-action';
import { PoseSkeleton } from '@/components/pose-skeleton';
import { PrimaryButton } from '@/components/primary-button';
import { Font, Layout, Radius, Type } from '@/constants/design';
import { AuraColors } from '@/constants/theme';
import { useIot } from '@/context/iot-context';
import { useCachedResource } from '@/hooks/use-cached-resource';
import { useGuidedSession } from '@/hooks/use-guided-session';
import { prescribeSession } from '@/ml/session-prescription';
import { ApiError } from '@/services/api-client';
import { ReferenceFrame, ReferenceGroundY, planGuidedRoutine } from '@/services/guided-routine';
import { usableHeartRate } from '@/services/iot-payloads';
import { logExerciseSession, newSessionId } from '@/services/movement-service';
import { enqueue } from '@/services/outbox';
import { fetchRecovery, todayIsoDate } from '@/services/recovery-service';

/**
 * The movement session without a camera.
 *
 * The figure here is the same `PoseSkeleton` the camera session draws over the preview,
 * fed keyframed reference poses instead of inferred ones — so the thing the user follows
 * looks like the thing that would have been counting them, and the app needs no 3D
 * runtime to show it. Which matters because Expo Go has no pose runtime at all, and this
 * is the whole of the movement feature there.
 *
 * The two honest points, both of which the screen states out loud: the reps are assumed
 * from the tempo rather than observed, and the heart rate is not — it comes from the node
 * over MQTT and is the one measured thing on this screen.
 */

/** Large enough to read the joints, small enough to leave the count and the cue on screen. */
const MAX_FIGURE_WIDTH = 300;

export default function GuidedMoveScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();

  const today = todayIsoDate();
  const recoveryFetcher = useCallback(() => fetchRecovery(today), [today]);
  const { data: recovery } = useCachedResource(`recovery.${today}`, recoveryFetcher);

  // Same prescription object the camera session gates on, turned into a routine rather
  // than re-derived — one decision, two ways of carrying it out.
  const prescription = prescribeSession(recovery);
  const routine = planGuidedRoutine(prescription);

  const { biometrics, isBiometricsStale } = useIot();
  const liveHeartRate = isBiometricsStale ? null : usableHeartRate(biometrics);

  const session = useGuidedSession(routine);

  // Mean over the session rather than the last reading, exactly as the camera session
  // does it — the two rows have to mean the same thing in this column.
  const heartRates = useRef<number[]>([]);

  useEffect(() => {
    if (session.phase === 'running' && liveHeartRate !== null) {
      heartRates.current.push(liveHeartRate);
    }
  }, [session.phase, liveHeartRate]);

  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'queued' | 'failed'>(
    'idle',
  );

  // Bounded on both axes and never stretched: the reference frame's own aspect ratio is
  // kept so `PoseSkeleton`'s cover fit has nothing to crop, and the height cap keeps the
  // count and the Start button on screen on a short phone.
  const figureWidth = Math.min(
    width - Layout.gutter * 2,
    MAX_FIGURE_WIDTH,
    (height * 0.42 * ReferenceFrame.width) / ReferenceFrame.height,
  );
  const figureHeight = (figureWidth * ReferenceFrame.height) / ReferenceFrame.width;

  async function finish() {
    session.stop();

    if (session.reps === 0) {
      router.back();
      return;
    }

    setSaveState('saving');

    const beats = heartRates.current;
    const payload = {
      exercise: routine.exercise.id,
      // The distinction the record exists to keep: a tempo led these reps, nothing
      // watched them.
      source: 'guided' as const,
      total_reps: session.reps,
      // Not zero, and not a copy of total_reps. Nothing judged the depth, so there is no
      // figure to give, and inventing one would turn a follow-along into a measurement.
      good_form_reps: null,
      duration_seconds: session.elapsedSeconds,
      mean_heart_rate:
        beats.length === 0
          ? null
          : Math.round(beats.reduce((sum, b) => sum + b, 0) / beats.length),
      prescribed_intensity: prescription.intensity,
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
        await enqueue({ kind: 'exercise-session', body: payload });
        setSaveState('queued');
      } else {
        setSaveState('failed');
      }
    }
  }

  /**
   * A restart has to forget the heart rates as well as the count. They are averaged over
   * the session at save time, and beats measured during the abandoned attempt would be
   * folded into the mean of the one that replaced it.
   */
  function restart() {
    heartRates.current = [];
    setSaveState('idle');
    session.reset();
  }

  const { exercise } = routine;

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 10 }]}>
      <View style={styles.top}>
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

      <View style={styles.stage}>
        <View style={[styles.figure, { width: figureWidth, height: figureHeight }]}>
          <PoseSkeleton
            landmarks={session.frame.landmarks}
            sourceWidth={ReferenceFrame.width}
            sourceHeight={ReferenceFrame.height}
            width={figureWidth}
            height={figureHeight}
            isAtDepth={session.frame.isAtDepth}
            variant="reference"
            groundY={ReferenceGroundY}
          />
        </View>

        <Text
          style={styles.cue}
          accessibilityLiveRegion="polite"
          accessibilityLabel={`${exercise.name}. ${session.frame.cue}`}>
          {session.frame.cue}
        </Text>

        {/* The tempo, drawn. Following a figure is easier when you can see the beat coming. */}
        <View style={[styles.tempoTrack, { width: figureWidth }]}>
          <View style={[styles.tempoFill, { width: `${session.frame.progress * 100}%` }]} />
        </View>

        <Text style={styles.summary}>{exercise.summary}</Text>
      </View>

      <View style={[styles.bottom, { paddingBottom: Math.max(insets.bottom, 18) }]}>
        <View style={styles.metrics}>
          <View style={styles.repBlock}>
            <Text style={styles.reps}>{session.reps}</Text>
            <Text style={styles.repsLabel}>
              {routine.targetReps === null
                ? exercise.repNoun.toUpperCase()
                : `OF ${routine.targetReps} ${exercise.repNoun.toUpperCase()}`}
            </Text>
          </View>

          <View style={styles.side}>
            <Stat label="Tempo" value={`${(routine.cycleMs / 1000).toFixed(1)}s`} />
            <Stat label="Elapsed" value={formatClock(session.elapsedSeconds)} />
            <Stat
              label="Heart rate"
              value={liveHeartRate === null ? '—' : `${liveHeartRate}`}
              tone={liveHeartRate === null ? 'plain' : 'good'}
            />
          </View>
        </View>

        {session.phase === 'ready' ? (
          <>
            <Text style={styles.hint}>
              {exercise.name} — the figure keeps the pace. Start when you can see it and have
              room to move.
            </Text>
            <PrimaryButton label="Start" onPress={session.start} />
          </>
        ) : null}

        {session.phase === 'running' ? (
          <>
            <PrimaryButton label="Finish" onPress={finish} />
            <ConfirmAction
              label="Start over"
              confirmLabel="Tap again — this clears the count"
              onConfirm={restart}
            />
          </>
        ) : null}

        {session.phase === 'finished' ? (
          <View style={styles.finish}>
            <Text style={styles.finishText}>
              {saveState === 'saving'
                ? 'Saving…'
                : saveState === 'saved'
                  ? `Saved — ${session.reps} guided ${exercise.repNoun}.`
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
          These reps are counted from the tempo, not from you — nothing is watching, so the
          session is saved as guided and carries no form score. Your heart rate is the one
          measured figure here, and only while the node is connected. Run the camera coach
          from a development build if you want the reps checked.
        </Text>
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
  tone?: 'plain' | 'good';
}) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, { color: tone === 'good' ? AuraColors.brand.glow : '#fff' }]}>
        {value}
      </Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function formatClock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;

  return `${m}:${s.toString().padStart(2, '0')}`;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#050e26' },

  top: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingHorizontal: Layout.gutter },
  close: {
    width: 40,
    height: 40,
    borderRadius: Radius.pill,
    backgroundColor: 'rgba(8,22,54,0.85)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  prescription: {
    flex: 1,
    gap: 3,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: Radius.panel,
    backgroundColor: 'rgba(8,22,54,0.85)',
  },
  prescriptionTitle: { fontFamily: Font.bold, fontSize: 14, color: '#ffffff' },
  prescriptionReason: {
    fontFamily: Font.regular,
    fontSize: 11,
    lineHeight: 15,
    color: 'rgba(255,255,255,0.78)',
  },

  stage: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14 },
  figure: {
    borderRadius: Radius.card,
    backgroundColor: 'rgba(8,22,54,0.55)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    overflow: 'hidden',
  },
  cue: { fontFamily: Font.bold, fontSize: 20, letterSpacing: -0.4, color: '#ffffff' },
  tempoTrack: {
    height: 3,
    borderRadius: Radius.pill,
    backgroundColor: 'rgba(255,255,255,0.14)',
    overflow: 'hidden',
  },
  tempoFill: { height: 3, backgroundColor: AuraColors.brand.bright },
  summary: {
    fontFamily: Font.regular,
    fontSize: 12,
    lineHeight: 17,
    textAlign: 'center',
    color: 'rgba(255,255,255,0.7)',
    paddingHorizontal: Layout.gutter,
  },

  bottom: {
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
