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

import { PrimaryButton } from '@/components/primary-button';
import { TextField } from '@/components/text-field';
import { Layout, Radius, Shadows, Surfaces, Type } from '@/constants/design';
import { AuraColors } from '@/constants/theme';
import { ApiError } from '@/services/api-client';
import { recordHealthSnapshot } from '@/services/health-snapshot-service';
import { enqueue } from '@/services/outbox';
import { todayIsoDate } from '@/services/recovery-service';

interface FieldErrors {
  sleep_minutes?: string;
  deep_sleep_minutes?: string;
  resting_heart_rate?: string;
}

export default function LogNightScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [hours, setHours] = useState('');
  const [restingHr, setRestingHr] = useState('');
  const [deepMinutes, setDeepMinutes] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // The score for a given date is computed from the sleep that ended on that morning, and
  // the user is logging the night they just woke from.
  const recordedOn = todayIsoDate();

  async function handleSubmit() {
    setFieldErrors({});
    setFormError(null);
    setIsSubmitting(true);

    const sleepMinutes = hours ? Math.round(Number(hours) * 60) : undefined;
    const deep = deepMinutes ? Number(deepMinutes) : undefined;
    const hr = restingHr ? Number(restingHr) : undefined;

    const payload = {
      recorded_on: recordedOn,
      ...(sleepMinutes !== undefined ? { sleep_minutes: sleepMinutes } : {}),
      ...(deep !== undefined ? { deep_sleep_minutes: deep } : {}),
      ...(hr !== undefined ? { resting_heart_rate: hr } : {}),
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

  const canSubmit = hours !== '' || restingHr !== '';

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
              <Text style={Type.screenTitle}>Log last night</Text>
              <Text style={Type.meta}>
                {new Date(recordedOn).toLocaleDateString(undefined, {
                  weekday: 'long',
                  day: 'numeric',
                  month: 'long',
                })}
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
            {formError ? <Text style={styles.error}>{formError}</Text> : null}

            <TextField
              label="Hours slept"
              placeholder="7.5"
              value={hours}
              onChangeText={setHours}
              error={fieldErrors.sleep_minutes}
              keyboardType="decimal-pad"
              icon="moon"
              tone="brand"
            />

            <TextField
              label="Resting heart rate (bpm)"
              placeholder="58"
              value={restingHr}
              onChangeText={setRestingHr}
              error={fieldErrors.resting_heart_rate}
              keyboardType="number-pad"
              icon="heart"
              tone="vital"
            />

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
