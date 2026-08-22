import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, SlideInDown } from 'react-native-reanimated';

import { Font, GradientAxis, Layout, Radius, Shadows, Type } from '@/constants/design';
import { AuraColors, IconTones } from '@/constants/theme';

export interface QuickAction {
  key: string;
  title: string;
  subtitle: string;
  icon: keyof typeof Feather.glyphMap;
  tone: keyof typeof IconTones;
  /** The one gradient row — the movement session. */
  isPrimary?: boolean;
  badge?: string;
}

function Row({ action, onPress }: { action: QuickAction; onPress: () => void }) {
  const badge = IconTones[action.tone];
  const isPrimary = action.isPrimary === true;

  const body = (
    <>
      <View
        style={[
          styles.rowIcon,
          { backgroundColor: isPrimary ? 'rgba(255,255,255,0.2)' : badge.bg },
        ]}>
        <Feather name={action.icon} size={21} color={isPrimary ? '#ffffff' : badge.color} />
      </View>

      <View style={styles.rowText}>
        <View style={styles.rowTitleLine}>
          <Text style={[styles.rowTitle, isPrimary && styles.onPrimary]}>{action.title}</Text>
          {action.badge ? (
            <View style={styles.badge}>
              <Text style={styles.badgeLabel}>{action.badge}</Text>
            </View>
          ) : null}
        </View>
        <Text style={[styles.rowSubtitle, isPrimary && styles.onPrimarySubtle]}>
          {action.subtitle}
        </Text>
      </View>

      <Feather
        name="chevron-right"
        size={18}
        color={isPrimary ? '#ffffff' : '#94a3b8'}
      />
    </>
  );

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${action.title}. ${action.subtitle}`}
      style={[styles.row, !isPrimary && styles.rowPlain, isPrimary && Shadows.cta]}>
      {isPrimary ? (
        <LinearGradient
          colors={[AuraColors.brand.default, AuraColors.accent.default]}
          start={GradientAxis.deg120.start}
          end={GradientAxis.deg120.end}
          style={StyleSheet.absoluteFill}
        />
      ) : null}
      {body}
    </Pressable>
  );
}

interface QuickActionsSheetProps {
  visible: boolean;
  actions: QuickAction[];
  onSelect: (key: string) => void;
  onClose: () => void;
}

export function QuickActionsSheet({
  visible,
  actions,
  onSelect,
  onClose,
}: QuickActionsSheetProps) {
  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      {/* A solid scrim rather than a blur: expo-blur on Android is expensive and
          inconsistent, and the dim is what the design actually asks for. */}
      <Animated.View entering={FadeIn.duration(180)} style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
      </Animated.View>

      <Animated.View entering={SlideInDown.duration(260)} style={styles.sheet}>
        <View style={styles.handle} />

        <View style={styles.titleBlock}>
          <Text style={Type.sheetTitle}>Quick actions</Text>
          <Text style={styles.subtitle}>What would you like to do?</Text>
        </View>

        <View style={styles.rows}>
          {actions.map((action) => (
            <Row key={action.key} action={action} onPress={() => onSelect(action.key)} />
          ))}
        </View>

        <Pressable onPress={onClose} accessibilityRole="button" style={styles.close}>
          <Text style={styles.closeLabel}>Close</Text>
        </Pressable>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(8,22,54,0.55)' },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: AuraColors.surface.default,
    borderTopLeftRadius: Radius.sheet,
    borderTopRightRadius: Radius.sheet,
    paddingTop: 12,
    paddingHorizontal: Layout.gutter,
    paddingBottom: 30,
    gap: 16,
    // Android draws no upward shadow, so the sheet's top edge is stated with a hairline.
    borderTopWidth: 1,
    borderTopColor: 'rgba(15,23,42,0.06)',
  },
  handle: {
    width: 38,
    height: 4,
    borderRadius: 999,
    backgroundColor: '#cbd5e1',
    alignSelf: 'center',
    marginBottom: 2,
  },
  titleBlock: { gap: 3 },
  subtitle: { fontFamily: Font.regular, fontSize: 12, color: AuraColors.content.muted },
  rows: { gap: 10 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 16,
    borderRadius: Radius.row,
    overflow: 'hidden',
  },
  rowPlain: { backgroundColor: AuraColors.surface.sunken },
  rowIcon: {
    width: 46,
    height: 46,
    borderRadius: Radius.iconLarge,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: { flex: 1, gap: 3 },
  rowTitleLine: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  rowTitle: { fontFamily: Font.bold, fontSize: 15, color: AuraColors.content.default },
  rowSubtitle: {
    fontFamily: Font.regular,
    fontSize: 11,
    lineHeight: 16,
    color: AuraColors.content.muted,
  },
  onPrimary: { color: '#ffffff' },
  onPrimarySubtle: { color: 'rgba(255,255,255,0.84)' },
  badge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.24)',
  },
  badgeLabel: { fontFamily: Font.semibold, fontSize: 9, letterSpacing: 0.6, color: '#ffffff' },
  close: { alignSelf: 'center', minHeight: 44, justifyContent: 'center' },
  closeLabel: { fontFamily: Font.semibold, fontSize: 14, color: AuraColors.content.muted },
});
