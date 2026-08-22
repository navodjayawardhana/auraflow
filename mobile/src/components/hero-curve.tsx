import { StyleSheet } from 'react-native';
import { Path, Svg } from 'react-native-svg';

/**
 * The curved edge where the sign-in hero meets the form.
 *
 * A straight cut would read as two stacked blocks; the curve is what makes the page one
 * surface. Sits at `bottom: -1` so no hairline of gradient survives rounding on any
 * pixel density.
 */
export function HeroCurve({ color = '#ffffff' }: { color?: string }) {
  return (
    <Svg
      style={styles.curve}
      width="100%"
      height={44}
      viewBox="0 0 390 44"
      preserveAspectRatio="none">
      <Path d="M0,18 C104,50 292,-6 390,18 L390,44 L0,44 Z" fill={color} />
    </Svg>
  );
}

const styles = StyleSheet.create({
  curve: { position: 'absolute', left: 0, right: 0, bottom: -1 },
});
