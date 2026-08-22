import { StyleSheet } from 'react-native';
import { Circle, Defs, Path, RadialGradient, Stop, Svg } from 'react-native-svg';

/**
 * The soft glows and the ECG trace behind the hero content.
 *
 * React Native has no radial gradient, so the orbs are SVG circles filled with one —
 * which is also cheaper than the two nested Views a fake glow would need. The trace is a
 * single stroked path at low opacity: it reads as texture rather than as data, which is
 * the intent. It is not plotting anything, and the design does not pretend it is.
 */
export function HeroDecoration({ width = 390, height = 404 }: { width?: number; height?: number }) {
  return (
    <>
      <Svg style={StyleSheet.absoluteFill} width={width} height={height}>
        <Defs>
          <RadialGradient id="orbCyan" cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor="#00f0ff" stopOpacity={0.32} />
            <Stop offset="0.7" stopColor="#00f0ff" stopOpacity={0} />
          </RadialGradient>
          <RadialGradient id="orbWhite" cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor="#ffffff" stopOpacity={0.15} />
            <Stop offset="0.7" stopColor="#ffffff" stopOpacity={0} />
          </RadialGradient>
        </Defs>

        <Circle cx={width + 60 - 120} cy={-80 + 120} r={120} fill="url(#orbCyan)" />
        <Circle cx={-50 + 100} cy={height + 70 - 100} r={100} fill="url(#orbWhite)" />
      </Svg>

      <Svg
        style={[StyleSheet.absoluteFill, styles.trace]}
        width={width}
        height={120}
        viewBox="0 0 390 120"
        preserveAspectRatio="none">
        <Path
          d="M0 78 H92 L106 46 L120 104 L134 62 L146 78 H390"
          stroke="#ffffff"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      </Svg>
    </>
  );
}

const styles = StyleSheet.create({
  trace: { top: undefined, bottom: 46, height: 120, opacity: 0.2 },
});
