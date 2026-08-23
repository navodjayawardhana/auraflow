import { Feather } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Font, Surfaces } from '@/constants/design';
import { AuraColors } from '@/constants/theme';

/**
 * The disclosure the focus forecast uses, pulled out for the plan to reuse.
 *
 * Same shape for the same reason: a summary line that is worth reading on its own, and the
 * working underneath it for anyone who wants to check. A daily target is a stronger claim
 * than a focus forecast — the forecast suggests an hour, a target suggests a number of
 * calories — so if anything it owes the reader more, not less.
 */
export function BasisDisclosure({ summary, lines }: { summary: string; lines: string[] }) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <View>
      <Pressable
        onPress={() => setIsOpen((v) => !v)}
        accessibilityRole="button"
        accessibilityState={{ expanded: isOpen }}
        accessibilityLabel="How these targets are worked out"
        style={styles.disclosure}>
        <Feather name="info" size={12} color={AuraColors.content.muted} />
        <Text style={styles.disclosureLabel}>{summary}</Text>
        <Feather
          name={isOpen ? 'chevron-up' : 'chevron-down'}
          size={14}
          color={AuraColors.content.muted}
        />
      </Pressable>

      {isOpen ? (
        <View style={styles.panel}>
          {lines.map((line) => (
            <Text key={line} style={styles.panelText}>
              {line}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  disclosure: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 28 },
  disclosureLabel: {
    flex: 1,
    fontFamily: Font.regular,
    fontSize: 10,
    color: AuraColors.content.muted,
  },
  panel: { ...Surfaces.panel, gap: 8, marginTop: 6 },
  panelText: {
    fontFamily: Font.regular,
    fontSize: 10,
    lineHeight: 15,
    color: AuraColors.content.muted,
  },
});
