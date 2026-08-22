import { Feather } from '@expo/vector-icons';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, SlideInDown } from 'react-native-reanimated';

import { PrimaryButton } from '@/components/primary-button';
import { Font, Layout, Radius, Type } from '@/constants/design';
import { AuraColors, IconTones } from '@/constants/theme';

interface ConfirmSheetProps {
  visible: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
}

/**
 * The yes/no in front of anything irreversible.
 *
 * Not `Alert.alert`: the system dialog carries none of the app's type or colour, and the
 * one moment a destructive action needs to look like it belongs to this app is the moment
 * it asks whether you meant it. Cancel is the wide, quiet, easy target; confirm is red.
 */
export function ConfirmSheet({
  visible,
  title,
  body,
  confirmLabel,
  onConfirm,
  onCancel,
  busy = false,
}: ConfirmSheetProps) {
  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onCancel}>
      <Animated.View entering={FadeIn.duration(180)} style={styles.backdrop}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onCancel}
          accessibilityLabel="Cancel"
        />
      </Animated.View>

      <Animated.View entering={SlideInDown.duration(260)} style={styles.sheet}>
        <View style={styles.handle} />

        <View style={styles.badge}>
          <Feather name="alert-triangle" size={20} color={IconTones.vital.color} />
        </View>

        <View style={styles.titleBlock}>
          <Text style={Type.sheetTitle}>{title}</Text>
          <Text style={styles.body}>{body}</Text>
        </View>

        <View style={styles.actions}>
          <PrimaryButton
            label={confirmLabel}
            variant="danger"
            loading={busy}
            onPress={onConfirm}
          />
          <Pressable
            onPress={onCancel}
            disabled={busy}
            accessibilityRole="button"
            style={styles.cancel}>
            <Text style={styles.cancelLabel}>Cancel</Text>
          </Pressable>
        </View>
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
  badge: {
    width: 46,
    height: 46,
    borderRadius: Radius.iconLarge,
    backgroundColor: IconTones.vital.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleBlock: { gap: 5 },
  body: { ...Type.prose, color: AuraColors.content.muted },
  actions: { gap: 6 },
  cancel: { alignSelf: 'center', minHeight: 44, justifyContent: 'center', paddingHorizontal: 24 },
  cancelLabel: { fontFamily: Font.semibold, fontSize: 14, color: AuraColors.content.muted },
});
