import { Feather } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, SlideInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Font, Layout, Radius, Shadows, Type } from '@/constants/design';
import { AuraColors } from '@/constants/theme';
import { monthGridFor, shiftMonth, WEEKDAY_INITIALS } from '@/services/month-grid';
import { todayIsoDate } from '@/services/recovery-service';

/**
 * A month calendar, written rather than installed.
 *
 * `@react-native-community/datetimepicker` is the obvious choice and is a native module, so
 * it would end Expo Go for the whole app — a heavy price for one field, paid by every
 * screen. This is pure JavaScript, it uses the app's own tokens instead of the platform's,
 * and the part that is actually difficult lives in `month-grid.ts` under test.
 */

interface Props {
  visible: boolean;
  /** The chosen day, ISO. */
  value: string;
  /** Inclusive bounds. Days outside them are shown but not selectable. */
  earliest: string;
  latest: string;
  onSelect: (iso: string) => void;
  onClose: () => void;
}

/** ISO of the first of whatever month `iso` falls in. */
function monthStartOf(iso: string): string {
  return monthGridFor(iso).monthStart;
}

export function DatePickerSheet({ visible, value, earliest, latest, onSelect, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const [month, setMonth] = useState(value);

  // Reopening lands on the chosen day's month, not wherever the last visit paged to.
  useEffect(() => {
    if (visible) setMonth(value);
  }, [visible, value]);

  const { monthStart, weeks } = monthGridFor(month);
  const today = todayIsoDate();

  const canGoBack = monthStartOf(earliest) < monthStart;
  const canGoForward = monthStart < monthStartOf(latest);

  const monthLabel = new Date(`${monthStart}T00:00:00`).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  });

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <Animated.View entering={FadeIn.duration(160)} style={styles.backdrop}>
        <Pressable style={styles.dismissArea} onPress={onClose} accessibilityLabel="Close" />

        <Animated.View
          entering={SlideInDown.duration(260)}
          style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 18) }]}>
          <View style={styles.handle} />

          <View style={styles.monthRow}>
            <Pressable
              onPress={() => setMonth(shiftMonth(month, -1))}
              disabled={!canGoBack}
              accessibilityRole="button"
              accessibilityLabel="The month before"
              hitSlop={10}
              style={styles.monthStep}>
              <Feather
                name="chevron-left"
                size={18}
                color={canGoBack ? AuraColors.content.default : AuraColors.surface.selected}
              />
            </Pressable>

            <Text style={styles.monthLabel}>{monthLabel}</Text>

            <Pressable
              onPress={() => setMonth(shiftMonth(month, 1))}
              disabled={!canGoForward}
              accessibilityRole="button"
              accessibilityLabel="The month after"
              hitSlop={10}
              style={styles.monthStep}>
              <Feather
                name="chevron-right"
                size={18}
                color={canGoForward ? AuraColors.content.default : AuraColors.surface.selected}
              />
            </Pressable>
          </View>

          <View style={styles.week}>
            {WEEKDAY_INITIALS.map((initial, i) => (
              // The initials repeat (T, T and S, S), so the index carries the key.
              <View key={i} style={styles.cell}>
                <Text style={Type.caption}>{initial}</Text>
              </View>
            ))}
          </View>

          {weeks.map((days, row) => (
            <View key={row} style={styles.week}>
              {days.map((day, column) => {
                if (day === null) return <View key={column} style={styles.cell} />;

                const isSelectable = day >= earliest && day <= latest;
                const isSelected = day === value;
                const isToday = day === today;

                return (
                  <Pressable
                    key={column}
                    onPress={() => {
                      onSelect(day);
                      onClose();
                    }}
                    disabled={!isSelectable}
                    accessibilityRole="button"
                    accessibilityState={{ selected: isSelected, disabled: !isSelectable }}
                    accessibilityLabel={new Date(`${day}T00:00:00`).toLocaleDateString(undefined, {
                      weekday: 'long',
                      day: 'numeric',
                      month: 'long',
                    })}
                    style={styles.cell}>
                    <View style={[styles.day, isSelected && styles.daySelected]}>
                      <Text
                        style={[
                          styles.dayText,
                          !isSelectable && styles.dayTextDisabled,
                          isSelected && styles.dayTextSelected,
                        ]}>
                        {Number(day.slice(-2))}
                      </Text>
                    </View>
                    {/* Today is marked under the number rather than by colouring it, so it
                        stays visible when the same day is also the selected one. */}
                    {isToday ? (
                      <View style={[styles.todayDot, isSelected && styles.todayDotSelected]} />
                    ) : null}
                  </Pressable>
                );
              })}
            </View>
          ))}

          <Pressable
            onPress={() => {
              onSelect(today);
              onClose();
            }}
            accessibilityRole="button"
            style={styles.today}>
            <Text style={styles.todayLabel}>Back to today</Text>
          </Pressable>
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
    gap: 4,
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
    marginBottom: 10,
    backgroundColor: AuraColors.surface.selected,
  },
  monthRow: { flexDirection: 'row', alignItems: 'center', paddingBottom: 6 },
  monthStep: {
    width: 34,
    height: 34,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  monthLabel: {
    flex: 1,
    textAlign: 'center',
    fontFamily: Font.bold,
    fontSize: 15,
    color: AuraColors.content.default,
  },
  week: { flexDirection: 'row' },
  cell: { flex: 1, aspectRatio: 1, alignItems: 'center', justifyContent: 'center' },
  day: {
    width: 34,
    height: 34,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  daySelected: { backgroundColor: AuraColors.brand.default },
  dayText: { fontFamily: Font.medium, fontSize: 13, color: AuraColors.content.default },
  dayTextDisabled: { color: '#cbd5e1' },
  dayTextSelected: { fontFamily: Font.semibold, color: AuraColors.content.inverse },
  todayDot: {
    position: 'absolute',
    bottom: 4,
    width: 4,
    height: 4,
    borderRadius: Radius.pill,
    backgroundColor: AuraColors.brand.default,
  },
  todayDotSelected: { backgroundColor: AuraColors.content.inverse },
  today: { alignSelf: 'center', paddingVertical: 12 },
  todayLabel: { fontFamily: Font.semibold, fontSize: 13, color: AuraColors.brand.default },
});
