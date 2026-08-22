import { useEffect, useRef, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import Animated, { FadeIn, SlideInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Font, Layout, Radius, Shadows, Type } from '@/constants/design';
import { AuraColors } from '@/constants/theme';

/**
 * Two snapping columns, written rather than installed, for the same reason the calendar is:
 * the platform picker is a native module and would end Expo Go for the whole app.
 *
 * A `ScrollView` with `snapToInterval` is the whole mechanism. The centre row is read back
 * from the scroll offset, and a band drawn behind it says which row that is.
 */

const ITEM_HEIGHT = 44;
/** Odd, so there is a middle row to select through. */
const VISIBLE_ITEMS = 5;
const CENTRE_OFFSET = Math.floor(VISIBLE_ITEMS / 2);

const HOURS = Array.from({ length: 24 }, (_, i) => i);

/**
 * Five-minute steps.
 *
 * Sixty rows to scroll would be tedious for a figure nobody knows to the minute — the
 * question is when you went to bed, and the honest answer is already rounded. It also keeps
 * the wheel short enough to reach the far end in one flick.
 */
const MINUTE_STEP = 5;
const MINUTES = Array.from({ length: 60 / MINUTE_STEP }, (_, i) => i * MINUTE_STEP);

const pad = (value: number) => String(value).padStart(2, '0');

interface Props {
  visible: boolean;
  /** `HH:MM`, or empty when nothing has been chosen yet. */
  value: string;
  label: string;
  /** Where the wheels open when `value` is empty. A plausible hour beats midnight. */
  fallback: string;
  onSelect: (value: string) => void;
  onClose: () => void;
}

interface WheelProps {
  values: number[];
  index: number;
  onIndexChange: (index: number) => void;
  accessibilityLabel: string;
}

function Wheel({ values, index, onIndexChange, accessibilityLabel }: WheelProps) {
  const ref = useRef<ScrollView | null>(null);

  // Without this the wheel opens at the top whatever the current value is. `animated: false`
  // because it is a starting position, not a movement the user made.
  useEffect(() => {
    ref.current?.scrollTo({ y: index * ITEM_HEIGHT, animated: false });
  }, [index]);

  function settle(event: NativeSyntheticEvent<NativeScrollEvent>) {
    const next = Math.round(event.nativeEvent.contentOffset.y / ITEM_HEIGHT);
    onIndexChange(Math.min(Math.max(next, 0), values.length - 1));
  }

  return (
    <ScrollView
      ref={ref}
      accessibilityLabel={accessibilityLabel}
      showsVerticalScrollIndicator={false}
      snapToInterval={ITEM_HEIGHT}
      decelerationRate="fast"
      // Momentum covers a flick; the drag handler covers a slow drag released mid-scroll,
      // which fires no momentum event at all and would otherwise leave the value behind
      // where the wheel is sitting.
      onMomentumScrollEnd={settle}
      onScrollEndDrag={settle}
      contentContainerStyle={{ paddingVertical: ITEM_HEIGHT * CENTRE_OFFSET }}
      style={styles.wheel}>
      {values.map((value, i) => (
        <Pressable
          key={value}
          onPress={() => onIndexChange(i)}
          accessibilityRole="button"
          style={styles.item}>
          <Text style={[styles.itemText, i === index && styles.itemTextActive]}>{pad(value)}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

export function TimePickerSheet({ visible, value, label, fallback, onSelect, onClose }: Props) {
  const insets = useSafeAreaInsets();

  const [hourIndex, setHourIndex] = useState(0);
  const [minuteIndex, setMinuteIndex] = useState(0);

  useEffect(() => {
    if (!visible) return;

    const source = /^\d{1,2}:\d{2}$/.test(value) ? value : fallback;
    const [h, m] = source.split(':').map(Number);

    setHourIndex(HOURS.indexOf(Math.min(h, 23)));
    // Snapped rather than rejected: a time typed before the wheels existed, or one carried
    // over from a finer source, should still open on the row nearest to it.
    setMinuteIndex(Math.min(Math.round(m / MINUTE_STEP), MINUTES.length - 1));
  }, [visible, value, fallback]);

  function confirm() {
    onSelect(`${pad(HOURS[hourIndex])}:${pad(MINUTES[minuteIndex])}`);
    onClose();
  }

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <Animated.View entering={FadeIn.duration(160)} style={styles.backdrop}>
        <Pressable style={styles.dismissArea} onPress={onClose} accessibilityLabel="Close" />

        <Animated.View
          entering={SlideInDown.duration(260)}
          style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 18) }]}>
          <View style={styles.handle} />

          <Text style={styles.title}>{label}</Text>

          <View style={styles.wheels}>
            {/* Behind the wheels, not inside them: it marks the selection zone rather than
                any one row, so it must not scroll with the numbers. */}
            <View style={styles.band} pointerEvents="none" />

            <Wheel
              values={HOURS}
              index={hourIndex}
              onIndexChange={setHourIndex}
              accessibilityLabel="Hour"
            />
            <Text style={styles.colon}>:</Text>
            <Wheel
              values={MINUTES}
              index={minuteIndex}
              onIndexChange={setMinuteIndex}
              accessibilityLabel="Minute"
            />
          </View>

          <View style={styles.actions}>
            <Pressable onPress={onClose} accessibilityRole="button" style={styles.cancel}>
              <Text style={styles.cancelLabel}>Cancel</Text>
            </Pressable>
            <Pressable onPress={confirm} accessibilityRole="button" style={styles.confirm}>
              <Text style={styles.confirmLabel}>
                Set {pad(HOURS[hourIndex])}:{pad(MINUTES[minuteIndex])}
              </Text>
            </Pressable>
          </View>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.4)', justifyContent: 'flex-end' },
  dismissArea: { flex: 1 },
  sheet: {
    paddingHorizontal: Layout.gutter,
    paddingTop: 10,
    gap: 14,
    backgroundColor: AuraColors.surface.default,
    borderTopLeftRadius: Radius.sheet,
    borderTopRightRadius: Radius.sheet,
    ...Shadows.card,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: Radius.pill,
    alignSelf: 'center',
    backgroundColor: AuraColors.surface.selected,
  },
  title: { ...Type.cardTitle, textAlign: 'center' },
  wheels: {
    height: ITEM_HEIGHT * VISIBLE_ITEMS,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  band: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: ITEM_HEIGHT * CENTRE_OFFSET,
    height: ITEM_HEIGHT,
    borderRadius: Radius.panel,
    backgroundColor: AuraColors.surface.sunken,
  },
  wheel: { width: 78 },
  item: { height: ITEM_HEIGHT, alignItems: 'center', justifyContent: 'center' },
  itemText: {
    fontFamily: Font.medium,
    fontSize: 22,
    color: '#cbd5e1',
    fontVariant: ['tabular-nums'],
  },
  itemTextActive: { fontFamily: Font.bold, color: AuraColors.content.default },
  colon: { fontFamily: Font.bold, fontSize: 22, color: AuraColors.content.default },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  cancel: { paddingHorizontal: 18, paddingVertical: 14 },
  cancelLabel: { fontFamily: Font.semibold, fontSize: 14, color: AuraColors.content.muted },
  confirm: {
    flex: 1,
    height: 50,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: AuraColors.brand.default,
  },
  confirmLabel: { fontFamily: Font.semibold, fontSize: 15, color: AuraColors.content.inverse },
});
