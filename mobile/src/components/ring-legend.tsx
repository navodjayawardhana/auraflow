import { Feather } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Font } from '@/constants/design';
import { AuraColors } from '@/constants/theme';

/**
 * What the inner two rings mean.
 *
 * Without this the steps and water arcs are decoration — a coloured curve nobody can read
 * a value from. Two lines of text turn them back into data.
 *
 * The third line says where the denominators came from, and is a link rather than a caption
 * because the answer "a default, because we know nothing about you" is only useful next to
 * the way to fix it.
 */
export function RingLegend({
  steps,
  stepGoal,
  waterMl,
  waterGoalMl,
  goalSource,
  onOpenPlan,
}: {
  steps: number | null;
  stepGoal: number;
  waterMl: number | null;
  waterGoalMl: number;
  goalSource: 'plan' | 'fallback';
  onOpenPlan?: () => void;
}) {
  const note =
    goalSource === 'plan'
      ? 'Targets from your plan'
      : 'Default targets — nothing about you yet';

  return (
    <View style={styles.wrap}>
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

      <Pressable
        onPress={onOpenPlan}
        disabled={onOpenPlan === undefined}
        accessibilityRole={onOpenPlan ? 'button' : 'text'}
        accessibilityLabel={`${note}. Open your plan.`}
        hitSlop={8}
        style={styles.note}>
        <Feather name="target" size={11} color={AuraColors.content.muted} />
        <Text style={styles.noteLabel}>{note}</Text>
        {onOpenPlan ? (
          <Feather name="chevron-right" size={12} color={AuraColors.content.muted} />
        ) : null}
      </Pressable>
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
  wrap: { gap: 8 },
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
  note: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 22 },
  noteLabel: { fontFamily: Font.regular, fontSize: 10, color: AuraColors.content.muted },
});
