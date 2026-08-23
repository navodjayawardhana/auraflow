import { Feather } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import Animated, { FadeInUp } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/primary-button';
import { TimePickerSheet } from '@/components/time-picker-sheet';
import { Font, Layout, Radius, Shadows, Surfaces, Type } from '@/constants/design';
import { AuraColors, IconTones } from '@/constants/theme';
import { useReminders } from '@/hooks/use-reminders';
import { isExpoGo, openSystemSettingsAsync } from '@/services/notification-service';
import {
  isWithinQuietHours,
  REMINDERS,
  type ReminderKind,
} from '@/services/reminder-schedule';
import { parseTimeOfDay, type TimeOfDay } from '@/services/sleep-window';

/**
 * Where reminders are turned on, and — more to the point — where it is said what each one
 * is for.
 *
 * The rationale under every row is not padding. Two of these reminders are part of a
 * measurement: a seated resting rate is only comparable with the user's own past ones if it
 * is taken under the same conditions, so a prompt at a consistent time is doing arithmetic,
 * not nagging. The other two are conveniences and say so. Someone deciding which to keep
 * should be able to tell those apart from this screen alone.
 */

const META: Record<ReminderKind, { icon: keyof typeof Feather.glyphMap; tone: keyof typeof IconTones }> = {
  'morning-checkin': { icon: 'sunrise', tone: 'vital' },
  'log-night': { icon: 'moon', tone: 'stage' },
  water: { icon: 'droplet', tone: 'accent' },
  movement: { icon: 'activity', tone: 'brand' },
};

const formatTime = (time: TimeOfDay) =>
  `${String(time.hours).padStart(2, '0')}:${String(time.minutes).padStart(2, '0')}`;

/** `today 07:00` / `tomorrow 07:00` / `Mon 07:00` — enough to check the setting did what was meant. */
function describeNext(at: Date, now = new Date()): string {
  const clock = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;

  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);

  // Compared by calendar day rather than by elapsed hours, so a reminder 20 hours away
  // still reads as "tomorrow" rather than "today".
  const days = Math.round((new Date(at).setHours(0, 0, 0, 0) - midnight.getTime()) / 86_400_000);

  if (days <= 0) return `Next today, ${clock}`;
  if (days === 1) return `Next tomorrow, ${clock}`;

  return `Next ${at.toLocaleDateString(undefined, { weekday: 'short' })}, ${clock}`;
}

/** Which time wheel is open, if any. Quiet hours has two, so the kind alone is not enough. */
type OpenPicker = { kind: ReminderKind } | { quiet: 'start' | 'end' };

export default function RemindersScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { settings, permission, nextFiring, isReady, setEnabled, setTime, setQuiet, refreshPermission } =
    useReminders();

  const [picker, setPicker] = useState<OpenPicker | null>(null);

  /**
   * Re-read the permission every time the screen comes back into view.
   *
   * The path that matters: someone taps through to the OS settings, allows notifications
   * there, and returns. Nothing in the app observed that, so without this the screen would
   * still be showing the blocked state over a permission that now works.
   */
  useFocusEffect(
    useCallback(() => {
      refreshPermission();
    }, [refreshPermission]),
  );

  function onPicked(value: string) {
    const time = parseTimeOfDay(value);
    if (time === null || picker === null) return;

    if ('kind' in picker) {
      setTime(picker.kind, time);
    } else if (picker.quiet === 'start') {
      setQuiet({ start: time });
    } else {
      setQuiet({ end: time });
    }
  }

  const pickerValue =
    picker === null
      ? ''
      : 'kind' in picker
        ? formatTime(settings.reminders[picker.kind].time)
        : formatTime(picker.quiet === 'start' ? settings.quiet.start : settings.quiet.end);

  const pickerLabel =
    picker === null
      ? ''
      : 'kind' in picker
        ? `${REMINDERS.find((r) => r.kind === picker.kind)?.label} at`
        : picker.quiet === 'start'
          ? 'Quiet from'
          : 'Quiet until';

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 14 }]}
        showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <View style={styles.headerText}>
            <Text style={Type.screenTitle}>Reminders</Text>
            <Text style={Type.meta}>Scheduled on this phone — nothing is sent from a server</Text>
          </View>

          <Pressable
            onPress={() => router.back()}
            accessibilityRole="button"
            accessibilityLabel="Close"
            hitSlop={10}
            style={styles.close}>
            <Feather name="x" size={18} color={AuraColors.content.default} />
          </Pressable>
        </View>

        {isReady ? null : (
          <View style={styles.loading}>
            <ActivityIndicator color={AuraColors.brand.default} />
          </View>
        )}

        {isReady && permission !== 'granted' && permission !== 'undetermined' ? (
          <Animated.View entering={FadeInUp.duration(400)} style={styles.card}>
            <Text style={Type.cardTitle}>
              {permission === 'blocked' ? 'Notifications are blocked' : 'Notifications are off'}
            </Text>
            <Text style={Type.prose}>
              {permission === 'blocked'
                ? 'This phone is set to block AuraFlow’s notifications, and an app cannot ask again once that has been chosen. The switches below are remembered, but nothing will arrive until it is changed in the system settings.'
                : 'Nothing will arrive until this phone allows AuraFlow to send notifications. Switching a reminder on below will ask.'}
            </Text>
            {permission === 'blocked' ? (
              <PrimaryButton label="Open system settings" onPress={openSystemSettingsAsync} />
            ) : null}
          </Animated.View>
        ) : null}

        {isReady
          ? REMINDERS.map((definition, index) => {
              const preference = settings.reminders[definition.kind];
              const meta = META[definition.kind];
              const badge = IconTones[meta.tone];
              const next = nextFiring.get(definition.kind);

              // A time the user has chosen that their own quiet hours swallow. Stated rather
              // than silently dropped — the alternative is a switch that is on, a time that
              // looks right, and nothing ever arriving.
              const isMuted =
                preference.isEnabled && isWithinQuietHours(preference.time, settings.quiet);

              return (
                <Animated.View
                  key={definition.kind}
                  entering={FadeInUp.delay(index * 60).duration(400)}
                  style={styles.card}>
                  <View style={styles.rowHead}>
                    <View style={[styles.icon, { backgroundColor: badge.bg }]}>
                      <Feather name={meta.icon} size={17} color={badge.color} />
                    </View>

                    <View style={styles.rowText}>
                      <Text style={Type.cardTitle}>{definition.label}</Text>
                      <Text style={Type.prose}>{definition.rationale}</Text>
                    </View>

                    <Switch
                      value={preference.isEnabled}
                      onValueChange={(value) => setEnabled(definition.kind, value)}
                      accessibilityLabel={definition.label}
                      trackColor={{ false: AuraColors.surface.selected, true: AuraColors.brand.default }}
                      thumbColor="#ffffff"
                    />
                  </View>

                  <Pressable
                    onPress={() => setPicker({ kind: definition.kind })}
                    accessibilityRole="button"
                    accessibilityLabel={`${definition.label} time, currently ${formatTime(preference.time)}`}
                    style={styles.timeRow}>
                    <Feather name="clock" size={14} color={AuraColors.content.muted} />
                    <Text style={styles.timeValue}>{formatTime(preference.time)}</Text>
                    <Text style={styles.timeMeta}>
                      {!preference.isEnabled
                        ? 'Off'
                        : isMuted
                          ? 'Inside quiet hours'
                          : next === undefined
                            ? permission === 'granted'
                              ? 'Nothing scheduled'
                              : 'Waiting on permission'
                            : describeNext(next)}
                    </Text>
                    <Feather name="chevron-right" size={16} color="#94a3b8" />
                  </Pressable>

                  {isMuted ? (
                    <Text style={styles.warning}>
                      This time falls inside your quiet hours, so it will not be delivered. Move
                      either the reminder or the quiet window.
                    </Text>
                  ) : null}
                </Animated.View>
              );
            })
          : null}

        {isReady ? (
          <Animated.View entering={FadeInUp.delay(260).duration(400)} style={styles.card}>
            <View style={styles.rowHead}>
              <View style={[styles.icon, { backgroundColor: IconTones.disabled.bg }]}>
                <Feather name="bell-off" size={17} color={IconTones.disabled.color} />
              </View>

              <View style={styles.rowText}>
                <Text style={Type.cardTitle}>Quiet hours</Text>
                <Text style={Type.prose}>
                  Nothing is delivered inside this window. A reminder set for a time it covers is
                  dropped for that day rather than moved — a prompt about last night that arrives
                  at breakfast is a prompt about the wrong thing.
                </Text>
              </View>

              <Switch
                value={settings.quiet.isEnabled}
                onValueChange={(value) => setQuiet({ isEnabled: value })}
                accessibilityLabel="Quiet hours"
                trackColor={{ false: AuraColors.surface.selected, true: AuraColors.brand.default }}
                thumbColor="#ffffff"
              />
            </View>

            {settings.quiet.isEnabled ? (
              <View style={styles.quietRow}>
                <Pressable
                  onPress={() => setPicker({ quiet: 'start' })}
                  accessibilityRole="button"
                  accessibilityLabel={`Quiet hours start, currently ${formatTime(settings.quiet.start)}`}
                  style={styles.quietCell}>
                  <Text style={Type.fieldLabel}>From</Text>
                  <Text style={styles.timeValue}>{formatTime(settings.quiet.start)}</Text>
                </Pressable>

                <Pressable
                  onPress={() => setPicker({ quiet: 'end' })}
                  accessibilityRole="button"
                  accessibilityLabel={`Quiet hours end, currently ${formatTime(settings.quiet.end)}`}
                  style={styles.quietCell}>
                  <Text style={Type.fieldLabel}>Until</Text>
                  <Text style={styles.timeValue}>{formatTime(settings.quiet.end)}</Text>
                </Pressable>
              </View>
            ) : null}
          </Animated.View>
        ) : null}

        {isReady ? (
          <Animated.View entering={FadeInUp.delay(320).duration(400)} style={styles.note}>
            <Feather name="shield" size={14} color={AuraColors.content.muted} />
            <Text style={styles.noteText}>
              Every reminder here is scheduled by this phone from a time you set. AuraFlow sends no
              push notifications and holds no device token, so nothing about your day leaves the
              handset to make one of these arrive.
              {isExpoGo
                ? ' Running inside Expo Go, these are delivered under Expo Go’s own name and icon rather than AuraFlow’s.'
                : ''}
            </Text>
          </Animated.View>
        ) : null}
      </ScrollView>

      <TimePickerSheet
        visible={picker !== null}
        value={pickerValue}
        label={pickerLabel}
        fallback="07:00"
        onSelect={onPicked}
        onClose={() => setPicker(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: AuraColors.surface.sunken },
  scroll: {
    paddingHorizontal: Layout.gutter,
    paddingBottom: Layout.scrollBottom,
    gap: Layout.gapCards,
  },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  headerText: { flex: 1, gap: 4 },
  close: {
    width: 36,
    height: 36,
    borderRadius: Radius.iconSquare,
    backgroundColor: AuraColors.surface.default,
    alignItems: 'center',
    justifyContent: 'center',
    ...Shadows.chip,
  },
  loading: { paddingVertical: 40, alignItems: 'center' },
  card: { ...Surfaces.card, gap: 12 },
  rowHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  icon: {
    width: 40,
    height: 40,
    borderRadius: Radius.iconMedium,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: { flex: 1, gap: 4 },
  timeRow: {
    ...Surfaces.panel,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 44,
  },
  timeValue: {
    fontFamily: Font.bold,
    fontSize: 16,
    color: AuraColors.content.default,
    fontVariant: ['tabular-nums'],
  },
  timeMeta: { ...Type.meta, flex: 1, textAlign: 'right' },
  warning: { ...Type.caption, color: AuraColors.caution },
  quietRow: { flexDirection: 'row', gap: 10 },
  quietCell: { ...Surfaces.panel, flex: 1, gap: 2, minHeight: 44, justifyContent: 'center' },
  note: { ...Surfaces.panel, flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  noteText: {
    flex: 1,
    fontFamily: Font.regular,
    fontSize: 11,
    lineHeight: 16,
    color: AuraColors.content.muted,
  },
});
