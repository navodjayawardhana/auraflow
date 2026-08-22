import { StyleSheet, Text, View } from 'react-native';

import { Font } from '@/constants/design';
import { AuraColors } from '@/constants/theme';

/**
 * What the inner two rings mean.
 *
 * Without this the steps and water arcs are decoration — a coloured curve nobody can read
 * a value from. Two lines of text turn them back into data.
 */
export function RingLegend({
  steps,
  stepGoal,
  waterMl,
  waterGoalMl,
}: {
  steps: number | null;
  stepGoal: number;
  waterMl: number | null;
  waterGoalMl: number;
}) {
  return (
    <View style={styles.row}>
      <Item
        color="#00f0ff"
        value={steps === null ? '—' : steps.toLocaleString()}
        detail={`of ${stepGoal.toLocaleString()} steps`}
      />
      <Item
        color="#7dd3fc"
        value={waterMl === null ? '—' : `${waterMl.toLocaleString()}`}
        detail={`of ${waterGoalMl.toLocaleString()} ml`}
      />
    </View>
  );
}

function Item({ color, value, detail }: { color: string; value: string; detail: string }) {
  return (
    <View style={styles.item}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <View style={styles.text}>
        <Text style={styles.value}>{value}</Text>
        <Text style={styles.detail}>{detail}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 12 },
  item: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 999 },
  text: { gap: 1 },
  value: {
    fontFamily: Font.bold,
    fontSize: 14,
    lineHeight: 15.4,
    color: AuraColors.content.default,
    fontVariant: ['tabular-nums'],
  },
  detail: { fontFamily: Font.regular, fontSize: 10, color: AuraColors.content.muted },
});
