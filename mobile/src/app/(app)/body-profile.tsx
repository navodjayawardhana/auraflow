import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
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
import { OfflineBanner } from '@/components/offline-banner';
import { PrimaryButton } from '@/components/primary-button';
import { TextField } from '@/components/text-field';
import {
  Font,
  Layout,
  PlaceholderColor,
  Radius,
  Shadows,
  Surfaces,
  Type,
} from '@/constants/design';
import { AuraColors, IconTones } from '@/constants/theme';
import { useCachedResource } from '@/hooks/use-cached-resource';
import { ApiError } from '@/services/api-client';
import {
  ageFrom,
  BMI_BAND_LABELS,
  BMI_SCALE_LABELS,
  BMI_SCALES,
  bmiBandFor,
  bmiFor,
  cutOffsFor,
} from '@/services/body-metrics';
import { enqueue } from '@/services/outbox';
import { fetchPlan } from '@/services/plan-service';
import { fetchProfile, saveProfile } from '@/services/profile-service';
import { shiftIsoDate, todayIsoDate } from '@/services/recovery-service';
import type { ActivityLevel, BmiScale, Sex, UpdateProfileInput } from '@/types';

/**
 * How far back the calendar reaches. Older than any living person, so the bound never
 * argues with a real date of birth; the sheet's year steppers make the distance walkable.
 */
const EARLIEST_BIRTH_DAYS = 365 * 120;

/** The contract's bounds, checked here so an offline save is not queued to be rejected. */
const HEIGHT_CM = { min: 80, max: 250 };
const WEIGHT_KG = { min: 25, max: 350 };

const SEXES: { value: Sex; label: string }[] = [
  { value: 'female', label: 'Female' },
  { value: 'male', label: 'Male' },
  { value: 'unspecified', label: 'Rather not' },
];

/**
 * Described by what a week looks like rather than by a multiplier.
 *
 * The server holds the activity factors; naming one here would be a second copy of a
 * published coefficient, free to drift. "Moderate exercise three to five days a week" is
 * the wording those factors were defined against anyway, and it is the question the user
 * can actually answer.
 */
const ACTIVITY_LEVELS: { value: ActivityLevel; label: string; detail: string }[] = [
  { value: 'sedentary', label: 'Sedentary', detail: 'Desk work, little deliberate exercise' },
  { value: 'light', label: 'Lightly active', detail: 'Light exercise one to three days a week' },
  {
    value: 'moderate',
    label: 'Moderately active',
    detail: 'Moderate exercise three to five days a week',
  },
  { value: 'active', label: 'Active', detail: 'Hard exercise six or seven days a week' },
  { value: 'very_active', label: 'Very active', detail: 'Hard daily training, or a physical job' },
];

/**
 * Which population's cut-offs to read a BMI against.
 *
 * Offered rather than inferred. The server defaults to the Asian scale because that is
 * where these users are, but a scale is a claim about the person and guessing it from a
 * locale or a phone setting would be a worse guess than asking.
 */
const SCALE_CHOICES: { value: BmiScale; label: string; detail: string }[] = [
  {
    value: 'who_asian',
    label: 'WHO Asian',
    detail: 'Overweight at 23, obese at 27.5 — the 2004 consultation’s action points',
  },
  {
    value: 'who_standard',
    label: 'WHO standard',
    detail: 'Overweight at 25, obese at 30 — the international classification',
  },
];

/** An empty field is "not told", never zero. */
function parseNumber(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === '') return null;

  const parsed = Number(trimmed);

  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

interface FieldErrors {
  date_of_birth?: string;
  height_cm?: string;
  weight_kg?: string;
}

function Choice({
  label,
  detail,
  isSelected,
  onPress,
}: {
  label: string;
  detail?: string;
  isSelected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected: isSelected }}
      accessibilityLabel={detail === undefined ? label : `${label}. ${detail}`}
      style={[styles.choice, isSelected && styles.choiceSelected]}>
      <View style={styles.choiceText}>
        <Text style={[styles.choiceLabel, isSelected && styles.choiceLabelSelected]}>{label}</Text>
        {detail ? <Text style={Type.caption}>{detail}</Text> : null}
      </View>
      {isSelected ? (
        <Feather name="check" size={16} color={AuraColors.brand.default} />
      ) : null}
    </Pressable>
  );
}

export default function BodyProfileScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const { data: profile, cachedAt, isStale } = useCachedResource('profile', fetchProfile);

  // Read for one field only. `activity_level` always arrives populated — the server sends
  // the *effective* level, defaulting to moderate — so the profile alone cannot tell an
  // answer from an assumption. The plan's `basis.missing` can, and a preselected radio
  // the user never touched is exactly the kind of quiet claim this phase is about.
  const { data: plan } = useCachedResource('plan', fetchPlan);
  const isActivityAssumed = plan?.basis.missing.includes('activity_level') ?? false;

  const [dateOfBirth, setDateOfBirth] = useState<string | null>(null);
  const [sex, setSex] = useState<Sex | null>(null);
  const [heightCm, setHeightCm] = useState('');
  const [weightKg, setWeightKg] = useState('');
  const [activity, setActivity] = useState<ActivityLevel | null>(null);
  const [bmiScale, setBmiScale] = useState<BmiScale | null>(null);

  const [isPickingDate, setIsPickingDate] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Seeded from the server once. `useCachedResource` delivers twice on a cold open — cache
  // then network — and the second delivery must not overwrite what is being typed.
  const isSeeded = useRef(false);

  useEffect(() => {
    if (profile === null || isSeeded.current) return;

    isSeeded.current = true;
    setDateOfBirth(profile.date_of_birth);
    setSex(profile.sex);
    setHeightCm(profile.height_cm === null ? '' : String(profile.height_cm));
    setWeightKg(profile.weight_kg === null ? '' : String(profile.weight_kg));
    setActivity(profile.activity_level);
    setBmiScale(profile.bmi_scale);
  }, [profile]);

  const today = todayIsoDate();
  const height = parseNumber(heightCm);
  const weight = parseNumber(weightKg);

  // Computed here rather than read back from the server so the bands move while the field
  // is being typed into. The server's own figures are the record; these are a preview of it.
  const bmi = bmiFor(Number.isNaN(height) ? null : height, Number.isNaN(weight) ? null : weight);
  const age = ageFrom(dateOfBirth);

  function validate(): FieldErrors {
    const errors: FieldErrors = {};

    if (
      height !== null &&
      (!Number.isInteger(height) || height < HEIGHT_CM.min || height > HEIGHT_CM.max)
    ) {
      // Whole centimetres, because that is what the server stores. Rounding silently
      // would mean the field disagreeing with itself after a reload.
      errors.height_cm = `A whole number between ${HEIGHT_CM.min} and ${HEIGHT_CM.max} cm`;
    }

    if (weight !== null && (Number.isNaN(weight) || weight < WEIGHT_KG.min || weight > WEIGHT_KG.max)) {
      errors.weight_kg = `Between ${WEIGHT_KG.min} and ${WEIGHT_KG.max} kg`;
    }

    if (dateOfBirth !== null && dateOfBirth > today) {
      errors.date_of_birth = 'That date has not happened yet';
    }

    return errors;
  }

  async function handleSubmit() {
    const errors = validate();
    setFieldErrors(errors);
    setFormError(null);

    if (Object.keys(errors).length > 0) return;

    setIsSubmitting(true);

    // A blank field is sent as null rather than omitted: clearing a weight you no longer
    // stand behind has to be possible, and omission means "leave it alone".
    const payload: UpdateProfileInput = {
      date_of_birth: dateOfBirth,
      height_cm: height,
      weight_kg: weight,
      ...(sex !== null ? { sex } : {}),
      ...(activity !== null ? { activity_level: activity } : {}),
      ...(bmiScale !== null ? { bmi_scale: bmiScale } : {}),
    };

    try {
      await saveProfile(payload);
      router.back();
    } catch (error) {
      if (error instanceof ApiError && error.isValidation) {
        setFieldErrors({
          date_of_birth: error.fieldError('date_of_birth'),
          height_cm: error.fieldError('height_cm'),
          weight_kg: error.fieldError('weight_kg'),
        });
        setFormError(error.fieldError('activity_level') ?? error.fieldError('sex') ?? null);
      } else if (error instanceof ApiError && error.status === 0) {
        // Unreachable, not invalid. The write is idempotent per user, so it can wait.
        await enqueue({ kind: 'profile', body: payload });
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
              <Text style={Type.screenTitle}>Your body</Text>
              <Text style={Type.meta}>What your daily targets are worked out from</Text>
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

          {isStale ? <OfflineBanner cachedAt={cachedAt} /> : null}

          <Animated.View entering={FadeInUp.duration(400)} style={styles.card}>
            <Text style={Type.prose}>
              Every field is optional. What you leave out is not guessed at — the plan uses a
              population default for it and says which targets that affected.
            </Text>

            {formError ? <Text style={styles.error}>{formError}</Text> : null}

            <View style={styles.field}>
              <Text style={Type.fieldLabel}>Date of birth</Text>
              <Pressable
                onPress={() => setIsPickingDate(true)}
                accessibilityRole="button"
                accessibilityLabel={
                  dateOfBirth === null ? 'Set your date of birth' : `Date of birth, ${dateOfBirth}`
                }
                style={styles.dateField}>
                <View style={styles.dateIcon}>
                  <Feather name="calendar" size={15} color={IconTones.brand.color} />
                </View>
                <Text style={[styles.dateValue, dateOfBirth === null && styles.datePlaceholder]}>
                  {dateOfBirth === null
                    ? 'Not set'
                    : new Date(`${dateOfBirth}T00:00:00`).toLocaleDateString(undefined, {
                        day: 'numeric',
                        month: 'long',
                        year: 'numeric',
                      })}
                </Text>
                {age !== null ? <Text style={Type.caption}>{age} years</Text> : null}
              </Pressable>
              {fieldErrors.date_of_birth ? (
                <Text style={styles.error}>{fieldErrors.date_of_birth}</Text>
              ) : null}
              {/* The age, not the date, is what the formulas take — Tanaka and the sleep
                  bands both read it, and neither is defined without one. */}
              <Text style={Type.caption}>
                Sets your maximum heart rate and your sleep need. Nothing else reads it.
              </Text>
            </View>

            <View style={styles.pair}>
              <View style={styles.pairItem}>
                <TextField
                  label="Height (cm)"
                  placeholder="170"
                  value={heightCm}
                  onChangeText={setHeightCm}
                  error={fieldErrors.height_cm}
                  keyboardType="number-pad"
                  icon="maximize-2"
                />
              </View>
              <View style={styles.pairItem}>
                <TextField
                  label="Weight (kg)"
                  placeholder="65"
                  value={weightKg}
                  onChangeText={setWeightKg}
                  error={fieldErrors.weight_kg}
                  keyboardType="decimal-pad"
                  icon="anchor"
                  tone="accent"
                />
              </View>
            </View>

            <View style={styles.field}>
              {/* Asked because Mifflin–St Jeor carries a sex term and has no form without
                  one. "Rather not" is a real answer: the plan drops to a population BMR
                  and lists it as missing rather than picking a term on the user's behalf. */}
              <Text style={Type.fieldLabel}>Sex</Text>
              <View style={styles.segmented} accessibilityRole="radiogroup">
                {SEXES.map((option) => (
                  <Pressable
                    key={option.value}
                    onPress={() => setSex(option.value)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: sex === option.value }}
                    style={[styles.segment, sex === option.value && styles.segmentSelected]}>
                    <Text
                      style={[
                        styles.segmentLabel,
                        sex === option.value && styles.segmentLabelSelected,
                      ]}>
                      {option.label}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <Text style={Type.caption}>
                Used only by the metabolic-rate formula, which has a sex term.
              </Text>
            </View>

            <View style={styles.field}>
              <Text style={Type.fieldLabel}>Activity level</Text>
              <View accessibilityRole="radiogroup" style={styles.choices}>
                {ACTIVITY_LEVELS.map((option) => (
                  <Choice
                    key={option.value}
                    label={option.label}
                    detail={option.detail}
                    isSelected={activity === option.value}
                    onPress={() => setActivity(option.value)}
                  />
                ))}
              </View>
              {isActivityAssumed ? (
                <Text style={styles.assumed}>
                  Nothing is selected yet — your plan is assuming{' '}
                  {ACTIVITY_LEVELS.find((o) => o.value === activity)?.label.toLowerCase() ??
                    'moderately active'}
                  . Saving makes it your answer.
                </Text>
              ) : null}

              <Text style={Type.caption}>
                A starting point only. Once you have a week of step history the plan prefers
                what you measured over what you said here.
              </Text>
            </View>
          </Animated.View>

          {/* Both scales at once, and the value recomputed from the fields above rather
              than read back from the server, so the bands move while a weight is being
              typed. The arithmetic is the server's own — round to one decimal, then band,
              with 18.5 shared by both scales — so the preview and the saved figure cannot
              disagree. Which scale *applies* is a claim about the reader, and that one is
              a choice, stored on the profile so it is the same on every device. */}
          <Animated.View entering={FadeInUp.delay(80).duration(400)} style={styles.card}>
            <View style={styles.cardHead}>
              <Text style={Type.cardTitle}>Body mass index</Text>
              <Text style={Type.caption}>derived · not editable</Text>
            </View>

            {bmi === null ? (
              <Text style={Type.prose}>
                Needs both a height and a weight. Without them the plan can still set a step
                and water goal, but not an energy one.
              </Text>
            ) : (
              <>
                <View style={styles.bmiValue}>
                  <Text style={Type.headlineMetric}>{bmi.toFixed(1)}</Text>
                  <Text style={styles.bmiUnit}>kg/m²</Text>
                </View>

                {BMI_SCALES.map((scale) => {
                  const cutOffs = cutOffsFor(scale);

                  return (
                    <View key={scale} style={styles.bandRow}>
                      <View style={styles.bandText}>
                        <Text style={Type.rowTitle}>
                          {BMI_BAND_LABELS[bmiBandFor(bmi, scale)]}
                        </Text>
                        <Text style={Type.caption}>
                          {BMI_SCALE_LABELS[scale]} · overweight at {cutOffs.overweight}, obese at{' '}
                          {cutOffs.obese}
                        </Text>
                      </View>
                      {bmiScale === scale ? (
                        <View style={styles.appliedBadge}>
                          <Text style={styles.appliedLabel}>YOUR PLAN USES THIS</Text>
                        </View>
                      ) : null}
                    </View>
                  );
                })}

                <Text style={Type.caption}>
                  WHO recommends the lower pair of cut-offs for South Asian populations, whose
                  cardiometabolic risk rises at a markedly lower BMI. Both readings are shown
                  either way; the choice below only decides which one the plan quotes back.
                </Text>
              </>
            )}

            <View style={styles.field}>
              <Text style={Type.fieldLabel}>Which cut-offs apply to you</Text>
              <View accessibilityRole="radiogroup" style={styles.choices}>
                {SCALE_CHOICES.map((option) => (
                  <Choice
                    key={option.value}
                    label={option.label}
                    detail={option.detail}
                    isSelected={bmiScale === option.value}
                    onPress={() => setBmiScale(option.value)}
                  />
                ))}
              </View>
            </View>
          </Animated.View>

          <View style={styles.actions}>
            <PrimaryButton label="Save" onPress={handleSubmit} loading={isSubmitting} />
            <Text style={styles.actionNote}>
              Queues and syncs later if you&apos;re offline. Your plan is worked out again from
              this.
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* With nothing chosen the calendar opens roughly thirty years back rather than on
          this month, which would otherwise be a hundred year-taps from any real answer. */}
      <DatePickerSheet
        visible={isPickingDate}
        value={dateOfBirth ?? shiftIsoDate(today, -365 * 30)}
        earliest={shiftIsoDate(today, -EARLIEST_BIRTH_DAYS)}
        latest={today}
        todayShortcut={false}
        onSelect={setDateOfBirth}
        onClose={() => setIsPickingDate(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: AuraColors.surface.sunken },
  flex: { flex: 1 },
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
  card: { ...Surfaces.card, gap: 16 },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  field: { gap: 7 },
  dateField: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingLeft: 8,
    paddingRight: 16,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: AuraColors.surface.selected,
    backgroundColor: AuraColors.surface.default,
  },
  dateIcon: {
    width: 36,
    height: 36,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: IconTones.brand.bg,
  },
  dateValue: { flex: 1, fontFamily: Font.semibold, fontSize: 15, color: AuraColors.content.default },
  datePlaceholder: { fontFamily: Font.regular, color: PlaceholderColor },
  pair: { flexDirection: 'row', gap: 10 },
  pairItem: { flex: 1 },
  segmented: {
    flexDirection: 'row',
    gap: 4,
    padding: 4,
    borderRadius: Radius.pill,
    backgroundColor: AuraColors.surface.sunken,
  },
  segment: {
    flex: 1,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.pill,
  },
  segmentSelected: { backgroundColor: AuraColors.surface.default, ...Shadows.chip },
  segmentLabel: { fontFamily: Font.medium, fontSize: 13, color: AuraColors.content.muted },
  segmentLabelSelected: { fontFamily: Font.semibold, color: AuraColors.brand.default },
  choices: { gap: 8 },
  choice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 44,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: Radius.panel,
    borderWidth: 1,
    borderColor: AuraColors.surface.selected,
  },
  choiceSelected: { borderColor: AuraColors.brand.default, backgroundColor: IconTones.brand.bg },
  choiceText: { flex: 1, gap: 2 },
  choiceLabel: { fontFamily: Font.medium, fontSize: 13, color: AuraColors.content.default },
  choiceLabelSelected: { fontFamily: Font.semibold, color: AuraColors.brand.default },
  bmiValue: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  bmiUnit: { fontFamily: Font.regular, fontSize: 12, color: AuraColors.content.muted },
  bandRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  bandText: { flex: 1, gap: 2 },
  appliedBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: Radius.pill,
    backgroundColor: IconTones.brand.bg,
  },
  appliedLabel: { ...Type.badge, letterSpacing: 0.6, color: AuraColors.brand.default },
  actions: { gap: 12 },
  actionNote: { ...Type.caption, textAlign: 'center' },
  error: { ...Type.caption, color: AuraColors.danger },
  assumed: { ...Type.caption, color: AuraColors.caution },
});
