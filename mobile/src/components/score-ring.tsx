import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedProps, useSharedValue, withTiming } from 'react-native-reanimated';
import { Circle, Defs, LinearGradient, Stop, Svg } from 'react-native-svg';

import { Font } from '@/constants/design';
import { AuraColors, ProvisionalTint } from '@/constants/theme';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

/**
 * Established scores get the brand ramp; provisional ones a distinct violet, so the two
 * are never mistaken for each other at a glance. Provisional is not "worse" — it is less
 * certain — so it is deliberately not a severity colour.
 */
const TONE_STOPS = {
  success: [AuraColors.brand.default, AuraColors.brand.glow],
  provisional: [AuraColors.provisional, ProvisionalTint],
} as const;

interface ScoreRingProps {
  score: number;
  tone: keyof typeof TONE_STOPS;
  size?: number;
  textColor?: string;
  trackColor?: string;
}

export function ScoreRing({
  score,
  tone,
  size = 160,
  textColor = AuraColors.content.default,
  trackColor = AuraColors.surface.raised,
}: ScoreRingProps) {
  const strokeWidth = size * 0.0875;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const gradientId = `ring-${tone}`;

  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withTiming(score / 100, { duration: 500 });
  }, [score, progress]);

  const animatedProps = useAnimatedProps(() => ({
    strokeDashoffset: circumference * (1 - progress.value),
  }));

  return (
    <View style={[styles.wrap, { width: size, height: size }]}>
      <Svg width={size} height={size}>
        <Defs>
          <LinearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={TONE_STOPS[tone][0]} />
            <Stop offset="1" stopColor={TONE_STOPS[tone][1]} />
          </LinearGradient>
        </Defs>

        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={trackColor}
          strokeWidth={strokeWidth}
          fill="none"
        />
        <AnimatedCircle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={`url(#${gradientId})`}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          animatedProps={animatedProps}
          strokeLinecap="round"
          fill="none"
          rotation="-90"
          origin={`${size / 2}, ${size / 2}`}
        />
      </Svg>
      <View
        style={styles.center}
        accessibilityRole="text"
        accessibilityLabel={`Recovery score ${Math.round(score)} out of 100`}>
        <Text style={[styles.value, { color: textColor, fontSize: size * 0.225 }]}>
          {Math.round(score)}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center' },
  center: { position: 'absolute', alignItems: 'center' },
  // The named family, not fontWeight — Android silently falls back to Regular otherwise.
  value: { fontFamily: Font.bold, letterSpacing: -1, fontVariant: ['tabular-nums'] },
});
