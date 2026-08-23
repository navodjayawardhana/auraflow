import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, { FadeInUp } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DatePickerSheet } from '@/components/date-picker-sheet';
import { PrimaryButton } from '@/components/primary-button';
import { TextField } from '@/components/text-field';
import { TimePickerSheet } from '@/components/time-picker-sheet';
import { Font, Layout, PlaceholderColor, Radius, Shadows, Surfaces, Type } from '@/constants/design';
import { AuraColors, IconTones } from '@/constants/theme';
import { useIot } from '@/context/iot-context';
import { ApiError } from '@/services/api-client';
import { recordHealthSnapshot } from '@/services/health-snapshot-service';
import { enqueue } from '@/services/outbox';
import { shiftIsoDate, todayIsoDate } from '@/services/recovery-service';
import { formatDuration, parseTimeOfDay, sleepMinutesBetween } from '@/services/sleep-window';

/**
 * How far back a night can be logged.
 *
 * Not a limitation so much as the point: the recovery score's autonomic component carries
 * 0.80 of the weight and needs five days of resting-heart-rate history before it can be
 * computed at all. Without backfill a new user waits five real days for a score that is
 * not provisional. A month covers the fourteen-day baseline window with room to spare.
 */
const EARLIEST_DAYS_BACK = 30;

/**
 * Where the wheels open before anything has been chosen. A plausible night beats 00:00,
 * which is both unlikely and one flick from being accepted by mistake.
 */
const DEFAULT_BED = '23:00';
const DEFAULT_WAKE = '07:00';

function TimeButton({
  label,
  value,
  icon,
  onPress,
}: {
  label: string;
  value: string;
  icon: keyof typeof Feather.glyphMap;
  onPress: () => void;
}) {
  return (
    <View style={styles.time}>
      <Text style={Type.fieldLabel}>{label}</Text>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={value === '' ? `Set ${label.toLowerCase()}` : `${label}, ${value}`}
        style={styles.timeField}>
        <View style={styles.timeIcon}>
          <Feather name={icon} size={15} color={IconTones.brand.color} />
        </View>
        <Text style={[styles.timeValue, value === '' && styles.timePlaceholder]}>
          {value === '' ? '--:--' : value}
        </Text>
      </Pressable>
    </View>
  );
}

interface FieldErrors {
  sleep_minutes?: string;
  deep_sleep_minutes?: string;
  resting_heart_rate?: string;
}

export default function LogNightScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const today = todayIsoDate();
  const earliest = shiftIsoDate(today, -EARLIEST_DAYS_BACK);

  // The morning the sleep ended, which is the day the score belongs to.
  const [recordedOn, setRecordedOn] = useState(today);

  const [bedTime, setBedTime] = useState('');
  const [wakeTime, setWakeTime] = useState('');
  const [restingHr, setRestingHr] = useState('');
  const [deepMinutes, setDeepMinutes] = useState('');
  const [isPickingDate, setIsPickingDate] = useState(false);
  const [pickingTime, setPickingTime] = useState<'bed' | 'wake' | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Only to decide whether the check-in is worth pointing at. The number itself no longer
  // has a way into this form -- see the panel below.
  const { selectedDeviceId } = useIot();

  const bed = parseTimeOfDay(bedTime);
  const wake = parseTimeOfDay(wakeTime);
  const sleepMinutes = bed !== null && wake !== null ? sleepMinutesBetween(bed, wake) : null;

  function pickDate(iso: string) {
    if (iso > today || iso < earliest) return;

    setRecordedOn(iso);
    // The errors belonged to the day being left, not the one being opened.
    setFieldErrors({});
    setFormError(null);
  }

  /** The stepper is for nudging one night either way; the calendar is for the rest. */
  function stepDate(days: number) {
    pickDate(shiftIsoDate(recordedOn, days));
  }

  async function handleSubmit() {
    setFieldErrors({});
    setFormError(null);
    setIsSubmitting(true);

    const deep = deepMinutes ? Number(deepMinutes) : undefined;
    const hr = restingHr ? Number(restingHr) : undefined;

    const payload = {
      recorded_on: recordedOn,
      ...(sleepMinutes !== null && sleepMinutes > 0 ? { sleep_minutes: sleepMinutes } : {}),
      ...(deep !== undefined ? { deep_sleep_minutes: deep } : {}),
      // Every rate this form produces is an overnight one, and it says so rather than
      // letting the server infer it. That is only true because the node's spot reading was
      // taken out of here: while both could arrive through this field, no honest value for
      // this key existed.
      ...(hr !== undefined
        ? { resting_heart_rate: hr, resting_hr_source: 'overnight' as const }
        : {}),
    };

    try {
      await recordHealthSnapshot(payload);
      router.back();
    } catch (error) {
      if (error instanceof ApiError && error.isValidation) {
        setFieldErrors({
          sleep_minutes: error.fieldError('sleep_minutes'),
          deep_sleep_minutes: error.fieldError('deep_sleep_minutes'),
          resting_heart_rate: error.fieldError('resting_heart_rate'),
        });
        setFormError(error.fieldError('recorded_on') ?? null);
      } else if (error instanceof ApiError && error.status === 0) {
        // Unreachable, not invalid — keep the night and send it on reconnect.
        await enqueue({ kind: 'health-snapshot', body: payload });
        router.back();
      } else if (error instanceof ApiError) {
        setFormError(error.message);
      } else {
        setFormError('Something went wrong.');
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  const canSubmit = (sleepMinutes !== null && sleepMinutes > 0) || restingHr !== '';
  const isEarliest = recordedOn <= earliest;
  const isLatest = recordedOn >= today;

  return (
    <View style={styles.screen}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 14 }]}
          showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <View style={styles.headerText}>
              <Text style={Type.screenTitle}>Log a night</Text>
              <Text style={Type.meta}>
                {recordedOn === today ? 'The night you just woke from' : 'An earlier night'}
              </Text>
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

          <Animated.View entering={FadeInUp.duration(400)} style={styles.card}>
            {/* Backfilling is the point of the stepper, so it leads the form rather than
                hiding under it. Five nights entered here is the difference between a
                provisional score and an established one. */}
            <View style={styles.dateRow}>
              <Pressable
                onPress={() => stepDate(-1)}
                disabled={isEarliest}
                accessibilityRole="button"
                accessibilityLabel="The night before"
                hitSlop={10}
                style={[styles.step, isEarliest && styles.stepDisabled]}>
                <Feather
                  name="chevron-left"
                  size={18}
                  color={isEarliest ? AuraColors.surface.selected : AuraColors.content.default}
                />
              </Pressable>

              <Pressable
                onPress={() => setIsPickingDate(true)}
                accessibilityRole="button"
                accessibilityLabel="Pick a different night"
                style={styles.dateText}>
                <Text style={Type.eyebrow}>Night of</Text>
                <View style={styles.dateLine}>
                  <Text style={styles.date}>
                    {new Date(`${recordedOn}T00:00:00`).toLocaleDateString(undefined, {
                      weekday: 'long',
                      day: 'numeric',
                      month: 'long',
                    })}
                  </Text>
                  <Feather name="calendar" size={13} color={AuraColors.content.muted} />
                </View>
              </Pressable>

              <Pressable
                onPress={() => stepDate(1)}
                disabled={isLatest}
                accessibilityRole="button"
                accessibilityLabel="The night after"
                hitSlop={10}
                style={[styles.step, isLatest && styles.stepDisabled]}>
                <Feather
                  name="chevron-right"
                  size={18}
                  color={isLatest ? AuraColors.surface.selected : AuraColors.content.default}
                />
              </Pressable>
            </View>

            {formError ? <Text style={styles.error}>{formError}</Text> : null}

            {/* Two clock times rather than a duration: people know when they went to bed,
                and round when asked how long they slept. The arithmetic is ours to do. */}
            <View style={styles.times}>
              <TimeButton
                label="Went to bed"
                value={bedTime}
                icon="sunset"
                onPress={() => setPickingTime('bed')}
              />
              <TimeButton
                label="Woke up"
                value={wakeTime}
                icon="sunrise"
                onPress={() => setPickingTime('wake')}
              />
            </View>

            {fieldErrors.sleep_minutes ? (
              <Text style={styles.error}>{fieldErrors.sleep_minutes}</Text>
            ) : null}

            <View style={styles.derived}>
              <Feather name="moon" size={13} color={AuraColors.content.muted} />
              <Text style={Type.caption}>
                {sleepMinutes === null
                  ? 'Both times, and the hours work themselves out'
                  : sleepMinutes === 0
                    ? 'Those are the same time — check one of them'
                    : `${formatDuration(sleepMinutes)} asleep`}
              </Text>
            </View>

            <TextField
              label="Overnight resting heart rate (bpm)"
              placeholder="58"
              value={restingHr}
              onChangeText={setRestingHr}
              error={fieldErrors.resting_heart_rate}
              keyboardType="number-pad"
              icon="heart"
              tone="vital"
            />

            {/*
              The node's number is not offered here any more.

              It used to fill this field from whatever frame was live: a finger on a pad,
              awake and sitting, written into the same column as an overnight rate. The label
              said so in words while the data said nothing, and the baseline built from that
              column averaged the two kinds together -- a mean between two distributions and a
              deviation made mostly of the gap between them.

              Now the two are separate baselines, so this field means one thing and the
              seated reading has a door of its own. The check-in is also a better capture than
              this button ever was: a minute reduced to the lowest sustained rate, rather than
              whichever estimate happened to be on screen when a thumb landed.
            */}
            {selectedDeviceId !== null ? (
              <Pressable
                onPress={() => router.push('/morning-checkin')}
                accessibilityRole="button"
                accessibilityLabel="Open the morning check-in"
                style={styles.nodeFill}>
                <Feather name="sunrise" size={14} color={AuraColors.brand.default} />
                <View style={styles.nodeText}>
                  <Text style={styles.nodeLabel}>No wearable? Use the morning check-in</Text>
                  <Text style={Type.caption}>
                    Your node reads a finger while you are awake and sitting, which is a
                    different measurement from an overnight rate — so it is kept in its own
                    baseline rather than typed in here.
                  </Text>
                </View>
                <Feather name="chevron-right" size={16} color={AuraColors.content.muted} />
              </Pressable>
            ) : null}

            <TextField
              label="Deep sleep (minutes, optional)"
              placeholder="90"
              value={deepMinutes}
              onChangeText={setDeepMinutes}
              error={fieldErrors.deep_sleep_minutes}
              keyboardType="number-pad"
              icon="bar-chart-2"
              tone="stage"
            />

            <Text style={Type.caption}>
              Either figure on its own is enough — the score uses whatever it has.
            </Text>
          </Animated.View>
        </ScrollView>

        <View style={[styles.commit, { paddingBottom: Math.max(insets.bottom, 20) }]}>
          <PrimaryButton
            label="Save"
            onPress={handleSubmit}
            loading={isSubmitting}
            disabled={!canSubmit}
          />
          <Text style={styles.commitNote}>Queues and syncs later if you&apos;re offline</Text>
        </View>
      </KeyboardAvoidingView>

      <DatePickerSheet
        visible={isPickingDate}
        value={recordedOn}
        earliest={earliest}
        latest={today}
        onSelect={pickDate}
        onClose={() => setIsPickingDate(false)}
      />

      <TimePickerSheet
        visible={pickingTime !== null}
        label={pickingTime === 'wake' ? 'Woke up' : 'Went to bed'}
        value={pickingTime === 'wake' ? wakeTime : bedTime}
        fallback={pickingTime === 'wake' ? DEFAULT_WAKE : DEFAULT_BED}
        onSelect={pickingTime === 'wake' ? setWakeTime : setBedTime}
        onClose={() => setPickingTime(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: AuraColors.surface.sunken },
  flex: { flex: 1 },
  scroll: { paddingHorizontal: Layout.gutter, paddingBottom: 24, gap: Layout.gapCards },
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
  card: { ...Surfaces.card, gap: 16 },
  dateRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dateText: { flex: 1, alignItems: 'center', gap: 3 },
  dateLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  date: { fontFamily: Font.bold, fontSize: 15, color: AuraColors.content.default },
  step: {
    width: 34,
    height: 34,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: AuraColors.surface.sunken,
  },
  stepDisabled: { backgroundColor: 'transparent' },
  times: { flexDirection: 'row', gap: 10 },
  time: { flex: 1, gap: 7 },
  timeField: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingLeft: 8,
    paddingRight: 12,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: AuraColors.surface.selected,
    backgroundColor: AuraColors.surface.default,
  },
  timeIcon: {
    width: 36,
    height: 36,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: IconTones.brand.bg,
  },
  timeValue: {
    fontFamily: Font.semibold,
    fontSize: 16,
    color: AuraColors.content.default,
    fontVariant: ['tabular-nums'],
  },
  timePlaceholder: { color: PlaceholderColor },
  derived: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: -8 },
  nodeFill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: -8,
    padding: 10,
    borderRadius: Radius.panel,
    backgroundColor: AuraColors.surface.sunken,
  },
  nodeText: { flex: 1, gap: 2 },
  nodeLabel: {
    fontFamily: Font.semibold,
    fontSize: 12,
    color: AuraColors.brand.default,
  },
  error: { ...Type.caption, color: AuraColors.danger },
  commit: {
    paddingHorizontal: Layout.gutter,
    paddingTop: 12,
    gap: 10,
    backgroundColor: AuraColors.surface.default,
    borderTopWidth: 1,
    borderTopColor: 'rgba(15,23,42,0.06)',
  },
  commitNote: { ...Type.caption, textAlign: 'center' },
});
