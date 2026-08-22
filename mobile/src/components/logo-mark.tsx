import { useEffect } from 'react';
import { View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedProps,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { Circle, Defs, LinearGradient, Path, Stop, Svg } from 'react-native-svg';

const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

/**
 * The "A" + wave + pulse form, one continuous stroke. Traced from the brand artwork,
 * cropped out of its 800x450 canvas to the glyph's own bounds.
 */
const GLYPH =
  'M 90 230 C 130 230 155 210 185 100 C 198 50 215 50 228 100 C 242 165 195 195 160 185 C 220 185 245 185 265 240 C 285 280 305 240 330 200';

const PATH_LENGTH = 1000;
const STROKE_WIDTH = 18;

interface LogoMarkProps {
  size?: number;
  /** Draw the stroke on once when mounted. Use on entry screens, not behind forms. */
  animated?: boolean;
  /** Flat single colour instead of the gradient — for monochrome contexts. */
  color?: string;
}

export function LogoMark({ size = 32, animated = false, color }: LogoMarkProps) {
  const progress = useSharedValue(animated ? 0 : 1);
  const nodeOpacity = useSharedValue(animated ? 0.6 : 1);

  useEffect(() => {
    if (!animated) return;

    progress.value = withTiming(1, { duration: 1400, easing: Easing.out(Easing.cubic) });
    nodeOpacity.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 900, easing: Easing.inOut(Easing.quad) }),
        withTiming(0.6, { duration: 900, easing: Easing.inOut(Easing.quad) }),
      ),
      -1,
    );
  }, [animated, progress, nodeOpacity]);

  const strokeProps = useAnimatedProps(() => ({
    strokeDashoffset: PATH_LENGTH * (1 - progress.value),
  }));

  const nodeProps = useAnimatedProps(() => ({ opacity: nodeOpacity.value }));

  const stroke = color ?? 'url(#markStroke)';

  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size} viewBox="60 30 300 280" fill="none">
        <Defs>
          <LinearGradient id="markStroke" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#0052FF" />
            <Stop offset="0.5" stopColor="#00D2FF" />
            <Stop offset="1" stopColor="#00F0FF" />
          </LinearGradient>
        </Defs>

        {/* Stands in for the artwork's Gaussian glow: react-native-svg has no <filter>,
            so the halo is a wider, fainter copy of the same stroke. */}
        <Path
          d={GLYPH}
          stroke={color ?? '#00D2FF'}
          strokeOpacity={0.18}
          strokeWidth={STROKE_WIDTH + 8}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />

        {/* The unlit track, so the glyph reads as a complete shape before it draws in. */}
        <Path
          d={GLYPH}
          stroke={color ?? '#0052FF'}
          strokeOpacity={0.12}
          strokeWidth={STROKE_WIDTH}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />

        <AnimatedPath
          d={GLYPH}
          stroke={stroke}
          strokeWidth={STROKE_WIDTH}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray={PATH_LENGTH}
          animatedProps={strokeProps}
          fill="none"
        />

        <AnimatedCircle cx={213} cy={72} r={7} fill={color ?? '#00F0FF'} animatedProps={nodeProps} />
      </Svg>
    </View>
  );
}
