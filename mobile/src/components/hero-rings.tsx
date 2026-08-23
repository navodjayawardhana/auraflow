import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedProps,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { Circle, Defs, G, LinearGradient, Stop, Svg } from 'react-native-svg';

import { Font, Type } from '@/constants/design';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

const SIZE = 200;
const VIEW = 220;
const CENTRE = VIEW / 2;

/**
 * Three concentric arcs, all starting at twelve o'clock and filling clockwise.
 *
 * Recovery is the outer ring because it is the one figure the whole app exists to
 * deliver; steps and water sit inside it as supporting context. Their hue never changes
 * with state — only recovery's does — so a glance reads confidence from one place.
 */
const RINGS = {
  recovery: { r: 96, width: 13, track: 'rgba(255,255,255,0.16)' },
  steps: { r: 77, width: 9, track: 'rgba(255,255,255,0.14)', fill: '#00f0ff' },
  water: { r: 60, width: 9, track: 'rgba(255,255,255,0.14)', fill: '#7dd3fc' },
} as const;

const circumference = (r: number) => 2 * Math.PI * r;

interface HeroRingsProps {
  /** 0–100, or null when today has no score yet. */
  score: number | null;
  isProvisional?: boolean;
  /**
   * Shown greyed in place of the dash when today cannot be scored. Its own date comes with
   * it and is rendered — a recovery score belongs to one morning, and an undated one sitting
   * where today's goes is a different claim entirely.
   */
  lastKnown?: { date: string; score: number } | null;
  /** null when the signal cannot be measured at all — never pass 0 for that. */
  stepsProgress: number | null;
  waterProgress: number | null;
}

function Ring({
  r,
  width,
  track,
  fill,
  progress,
}: {
  r: number;
  width: number;
  track: string;
  fill: string;
  progress: number | null;
}) {
  const length = circumference(r);
  const animated = useSharedValue(0);

  useEffect(() => {
    animated.value = withTiming(Math.min(Math.max(progress ?? 0, 0), 1), {
      duration: 900,
      easing: Easing.out(Easing.cubic),
    });
  }, [progress, animated]);

  const animatedProps = useAnimatedProps(() => ({
    strokeDashoffset: length * (1 - animated.value),
  }));

  // A solid empty track is a claim — it says "measured, and it is zero". When there is
  // nothing to measure the track is dashed instead, which reads as absence rather than
  // as a bad result. The same distinction MetricTile makes with an em dash.
  const isUnmeasured = progress === null;

  return (
    <>
      {/* Tracks are butt-capped full circles; only the fills get round caps. */}
      <Circle
        cx={CENTRE}
        cy={CENTRE}
        r={r}
        stroke={track}
        strokeWidth={width}
        strokeDasharray={isUnmeasured ? `${width * 0.55} ${width * 1.1}` : undefined}
        strokeLinecap={isUnmeasured ? 'round' : 'butt'}
        fill="none"
      />
      {isUnmeasured ? null : (
        <AnimatedCircle
          cx={CENTRE}
          cy={CENTRE}
          r={r}
          stroke={fill}
          strokeWidth={width}
          strokeLinecap="round"
          strokeDasharray={length}
          animatedProps={animatedProps}
          fill="none"
        />
      )}
    </>
  );
}

export function HeroRings({
  score,
  isProvisional = false,
  lastKnown = null,
  stepsProgress,
  waterProgress,
}: HeroRingsProps) {
  const gradientId = isProvisional ? 'ringProvisional' : 'ringEstablished';

  return (
    <View style={styles.wrap}>
      <Svg width={SIZE} height={SIZE} viewBox={`0 0 ${VIEW} ${VIEW}`}>
        <Defs>
          {/* Provisional is violet rather than a muted version of the confident ramp:
              less certain is not the same as worse, and a greyed ring would say the
              wrong thing. */}
          <LinearGradient id="ringEstablished" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#7ef9ff" />
            <Stop offset="1" stopColor="#ffffff" />
          </LinearGradient>
          <LinearGradient id="ringProvisional" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#c4b5fd" />
            <Stop offset="1" stopColor="#ede9fe" />
          </LinearGradient>
        </Defs>

        {/* Rotated as a group so every ring starts at twelve o'clock rather than at
            three, which is where SVG's zero angle sits. */}
        <G rotation={-90} origin={`${CENTRE}, ${CENTRE}`}>
          <Ring
            {...RINGS.recovery}
            fill={`url(#${gradientId})`}
            progress={score === null ? null : score / 100}
          />
          <Ring {...RINGS.steps} progress={stepsProgress} />
          <Ring {...RINGS.water} progress={waterProgress} />
        </G>
      </Svg>

      <View style={styles.centre} pointerEvents="none">
        {/*
            A dash is the truth and tells you nothing. The last score that could be worked
            out, greyed and dated, says the same thing and adds what is known — while the
            ring track behind it stays empty, because that is about today.
        */}
        <Text style={[Type.heroMetric, score === null && lastKnown !== null && styles.stale]}>
          {score !== null ? Math.round(score) : lastKnown !== null ? Math.round(lastKnown.score) : '—'}
        </Text>
        <Text style={styles.label}>RECOVERY</Text>

        {isProvisional ? (
          <View style={styles.pill}>
            <Text style={styles.pillLabel}>PROVISIONAL</Text>
          </View>
        ) : score === null && lastKnown !== null ? (
          <View style={styles.pill}>
            <Text style={styles.pillLabel}>
              {new Date(`${lastKnown.date}T00:00:00`)
                .toLocaleDateString(undefined, { weekday: 'short' })
                .toUpperCase()}
            </Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  stale: { opacity: 0.45 },
  wrap: { width: SIZE, height: SIZE, alignItems: 'center', justifyContent: 'center' },
  centre: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', gap: 2 },
  label: {
    fontFamily: Font.semibold,
    fontSize: 10,
    letterSpacing: 2.2,
    color: 'rgba(255,255,255,0.68)',
  },
  pill: {
    marginTop: 7,
    height: 22,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: 'rgba(196,181,253,0.24)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillLabel: { fontFamily: Font.semibold, fontSize: 10, color: '#ede9fe' },
});
