import { Feather } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, { FadeInUp } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BasisDisclosure } from '@/components/basis-disclosure';
import { OfflineBanner } from '@/components/offline-banner';
import { PrimaryButton } from '@/components/primary-button';
import { TextField } from '@/components/text-field';
import { Font, Layout, Radius, Shadows, Surfaces, Type } from '@/constants/design';
import { AuraColors, IconTones } from '@/constants/theme';
import { usePlan } from '@/hooks/use-plan';
import { ApiError } from '@/services/api-client';
import { enqueue } from '@/services/outbox';
import {
  activeKcalBasis,
  basisLines,
  basisSummary,
  hrZoneBasis,
  listMissing,
  sleepNeedBasis,
  stepGoalBasis,
  waterBasis,
} from '@/services/plan-provenance';
import { newPlanEditId, overridePlan, recalculatePlan } from '@/services/plan-service';
import {
  OVERRIDABLE_FIELDS,
  type HeartRateZones,
  type OverridableField,
  type Plan,
  type PlanBasis,
  type PlanOverrideInput,
} from '@/types';

type ZoneKey = keyof HeartRateZones;

const ZONE_KEYS: ZoneKey[] = ['easy', 'moderate', 'hard'];

const ZONE_LABELS: Record<ZoneKey, string> = {
  easy: 'Easy',
  moderate: 'Moderate',
  hard: 'Hard',
};

interface ScalarSpec {
  key: OverridableField;
  label: string;
  unit: string;
  icon: keyof typeof Feather.glyphMap;
  tone: keyof typeof IconTones;
  /** Sleep is the only target anyone states in halves. */
  isDecimal?: boolean;
  /** The server can decline to derive this one, and the form must let it stay empty. */
  isOptional?: boolean;
  basis: (basis: PlanBasis) => string;
}

const SCALARS: ScalarSpec[] = [
  { key: 'step_goal', label: 'Steps', unit: '', icon: 'activity', tone: 'brand', basis: stepGoalBasis },
  { key: 'water_ml', label: 'Water', unit: 'ml', icon: 'droplet', tone: 'accent', basis: waterBasis },
  {
    key: 'active_kcal_goal',
    label: 'Active energy',
    unit: 'kcal',
    icon: 'zap',
    tone: 'caution',
    isOptional: true,
    basis: activeKcalBasis,
  },
  {
    key: 'sleep_need_hours',
    label: 'Sleep need',
    unit: 'h',
    icon: 'moon',
    tone: 'stage',
    isDecimal: true,
    basis: sleepNeedBasis,
  },
];

/** Every editable number as text, because that is what a keyboard produces. */
type Draft = Record<OverridableField, string>;

function draftFrom(plan: Plan): Draft {
  return {
    step_goal: String(plan.step_goal),
    water_ml: String(plan.water_ml),
    // Empty rather than "0". The server could not derive one, and a zero in the box is a
    // target the user never chose that they would then have to notice and clear.
    active_kcal_goal: plan.active_kcal_goal === null ? '' : String(plan.active_kcal_goal),
    sleep_need_hours: String(plan.sleep_need_hours),
  };
}

function parsePositive(value: string): number | null {
  const parsed = Number(value.trim());

  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

type DraftErrors = Partial<Record<OverridableField, string>>;

function draftErrors(draft: Draft): DraftErrors {
  const errors: DraftErrors = {};

  for (const spec of SCALARS) {
    const raw = draft[spec.key].trim();

    if (raw === '' && spec.isOptional) continue;
    if (parsePositive(raw) === null) errors[spec.key] = 'Needs a number above zero';
  }

  return errors;
}

/**
 * Only what actually moved.
 *
 * The server records the difference as `edited_fields`, so submitting an untouched field
 * would falsely claim the user set a number the formula produced. It is also what makes a
 * replay a no-op: a retried body that matches the current plan mints no version.
 */
function overridesFrom(plan: Plan, draft: Draft): PlanOverrideInput {
  const overrides: PlanOverrideInput = {};

  for (const field of OVERRIDABLE_FIELDS) {
    const next = parsePositive(draft[field]);
    if (next !== null && next !== plan[field]) overrides[field] = next;
  }

  return overrides;
}

function TargetRow({ spec, plan }: { spec: ScalarSpec; plan: Plan }) {
  const badge = IconTones[spec.tone];
  const value = plan[spec.key];
  const isEdited = plan.edited_fields.includes(spec.key);

  return (
    <View style={styles.target}>
      <View style={[styles.targetIcon, { backgroundColor: badge.bg }]}>
        <Feather name={spec.icon} size={16} color={badge.color} />
      </View>

      <View style={styles.targetText}>
        <View style={styles.targetTitle}>
          <Text style={Type.rowTitle}>{spec.label}</Text>
          {isEdited ? <Feather name="edit-3" size={11} color={AuraColors.caution} /> : null}
        </View>
        {/* The citation, not a subtitle. A target nobody can trace is the thing this
            phase exists to remove. */}
        <Text style={Type.caption}>{spec.basis(plan.basis)}</Text>
      </View>

      <View style={styles.targetValue}>
        {value === null ? (
          <Text style={styles.targetDash}>—</Text>
        ) : (
          <Text style={styles.targetNumber}>{value.toLocaleString()}</Text>
        )}
        {spec.unit && value !== null ? <Text style={Type.caption}>{spec.unit}</Text> : null}
      </View>
    </View>
  );
}

/**
 * Read-only whichever mode the rest of the card is in.
 *
 * A zone the user typed would carry the same Karvonen label in the basis as one the
 * formula produced, and there is no honest way to show a chosen training intensity as a
 * derived one — so the server does not accept an override here and neither does this.
 */
function ZonePanel({ zones, basis }: { zones: HeartRateZones | null; basis: PlanBasis }) {
  return (
    <View style={styles.zones}>
      <Text style={Type.fieldLabel}>Heart-rate zones</Text>

      {zones === null ? (
        <Text style={Type.caption}>Not set — {hrZoneBasis(basis)}.</Text>
      ) : (
        <>
          {ZONE_KEYS.map((zone) => (
            <View key={zone} style={styles.zoneRow}>
              <Text style={Type.rowTitle}>{ZONE_LABELS[zone]}</Text>
              <Text style={styles.zoneRange}>
                {zones[zone][0]}–{zones[zone][1]}
                <Text style={Type.caption}> bpm</Text>
              </Text>
            </View>
          ))}
          <Text style={Type.caption}>{hrZoneBasis(basis)}</Text>
          <Text style={Type.caption}>
            The one target you cannot override — a hand-picked intensity cannot be shown as
            a derived one.
          </Text>
        </>
      )}
    </View>
  );
}

export default function PlanScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const { plan, profile, targets, status, cachedAt, isStale, refresh } = usePlan();

  const [draft, setDraft] = useState<Draft | null>(null);
  const [errors, setErrors] = useState<DraftErrors>({});
  const [formError, setFormError] = useState<string | null>(null);

  /**
   * Enough of a profile to be worth deriving from. Any one of the three moves some target
   * off its population default -- a weight alone reaches hydration and the energy estimate,
   * a date of birth alone reaches the sleep band -- so the gate is "any", not "all".
   */
  const hasBodyFigures =
    profile !== null &&
    (profile.height_cm !== null || profile.weight_kg !== null || profile.date_of_birth !== null);
  const [isQueued, setIsQueued] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isRecalculating, setIsRecalculating] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  async function handleRefresh() {
    setIsRefreshing(true);
    await refresh();
    setIsRefreshing(false);
  }

  function setScalar(key: OverridableField, value: string) {
    setDraft((current) => (current === null ? current : { ...current, [key]: value }));
  }

  function closeEditor() {
    setDraft(null);
    setErrors({});
    setFormError(null);
  }

  async function handleSave() {
    if (plan === null || draft === null) return;

    const found = draftErrors(draft);
    setErrors(found);
    setFormError(null);

    if (Object.keys(found).length > 0) return;

    const overrides = overridesFrom(plan, draft);

    // Nothing moved, so there is nothing to record. The server would collapse this to a
    // no-op anyway; not sending it saves the user's data as well as the round trip.
    if (Object.keys(overrides).length === 0) {
      closeEditor();
      return;
    }

    // Generated before the attempt, not inside the retry, so the online write and any
    // replay of it carry the same key and the server sees one edit.
    const payload: PlanOverrideInput = { ...overrides, client_uuid: newPlanEditId() };

    setIsSaving(true);
    try {
      await overridePlan(payload);
      setIsQueued(false);
      closeEditor();
      await refresh();
    } catch (error) {
      if (error instanceof ApiError && error.status === 0) {
        // Unreachable, not invalid. The `client_uuid` makes this replay-safe, so the
        // targets can wait for a connection the way every other write in the app does.
        await enqueue({ kind: 'plan-override', body: payload });
        setIsQueued(true);
        closeEditor();
      } else {
        setFormError(
          error instanceof ApiError ? error.message : 'Something went wrong.',
        );
      }
    } finally {
      setIsSaving(false);
    }
  }

  async function handleRecalculate() {
    setFormError(null);
    setIsRecalculating(true);
    try {
      await recalculatePlan();
      await refresh();
    } catch (error) {
      setFormError(error instanceof ApiError ? error.message : 'Something went wrong.');
    } finally {
      setIsRecalculating(false);
    }
  }

  // The plan is a snapshot of the profile at the moment it was derived, so a profile saved
  // afterwards leaves it quietly out of date. Saying so is cheaper than recalculating
  // behind the user's back and changing their targets without being asked. Parsed rather
  // than compared as strings: the two timestamps need only both be ISO 8601, not
  // identically formatted, so `+05:30` and `Z` would order wrongly on a text compare.
  const isBehindProfile =
    plan !== null &&
    profile !== null &&
    Date.parse(profile.updated_at) > Date.parse(plan.created_at);

  return (
    <View style={styles.screen}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 14 }]}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} />}>
          <View style={styles.header}>
            <View style={styles.headerText}>
              <Text style={Type.eyebrow}>YOUR PLAN</Text>
              <Text style={Type.screenTitle}>Daily targets</Text>
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

          {status === 'loading' ? (
            <View style={styles.skeleton} />
          ) : status === 'error' ? (
            <View style={styles.card}>
              <Text style={Type.cardTitle}>Couldn&apos;t load your plan</Text>
              <Text style={Type.prose}>
                Your dashboard is running on the default targets meanwhile —{' '}
                {targets.stepGoal.toLocaleString()} steps and {targets.waterMl.toLocaleString()} ml.
              </Text>
              <PrimaryButton label="Retry" onPress={refresh} />
            </View>
          ) : plan === null ? (
            <Animated.View entering={FadeInUp.duration(400)} style={styles.card}>
              <Text style={Type.cardTitle}>No plan yet</Text>
              <Text style={Type.prose}>
                Your rings are counting toward {targets.stepGoal.toLocaleString()} steps and{' '}
                {targets.waterMl.toLocaleString()} ml. Both are population defaults — round
                numbers that are true of nobody in particular, including you.
              </Text>

              {/*
                Two dead ends were possible here and one of them was live: someone who had
                already saved their figures was told to go and save them. Deriving is a
                separate, explicit step by design -- nothing changes a person's targets
                without being asked -- so the step has to be offered, not merely described.
              */}
              {hasBodyFigures ? (
                <>
                  <Text style={Type.prose}>
                    Your figures are saved. Working them through the published formulas takes
                    a moment, and every target it sets will name where it came from.
                  </Text>
                  <PrimaryButton
                    label="Work out my plan"
                    onPress={handleRecalculate}
                    loading={isRecalculating}
                  />
                  <Pressable
                    onPress={() => router.push('/body-profile')}
                    accessibilityRole="button"
                    hitSlop={10}>
                    <Text style={styles.secondaryAction}>Change my body figures</Text>
                  </Pressable>
                </>
              ) : (
                <>
                  <Text style={Type.prose}>
                    Tell AuraFlow your height, weight and date of birth and it will work out
                    targets from published formulas, and name each one.
                  </Text>
                  <PrimaryButton
                    label="Fill in your body figures"
                    onPress={() => router.push('/body-profile')}
                  />
                </>
              )}

              {formError !== null ? <Text style={styles.error}>{formError}</Text> : null}
            </Animated.View>
          ) : (
            <>
              <Animated.View entering={FadeInUp.duration(400)} style={styles.card}>
                <View style={styles.cardHead}>
                  <Text style={Type.cardTitle}>
                    Version {plan.version} ·{' '}
                    {plan.source === 'edited' ? 'edited by you' : 'derived'}
                  </Text>
                  <Text style={Type.caption}>
                    {new Date(plan.created_at).toLocaleDateString(undefined, {
                      day: 'numeric',
                      month: 'short',
                    })}
                  </Text>
                </View>

                {draft === null ? (
                  SCALARS.map((spec) => <TargetRow key={spec.key} spec={spec} plan={plan} />)
                ) : (
                  <>
                    {SCALARS.map((spec) => (
                      <TextField
                        key={spec.key}
                        label={spec.unit === '' ? spec.label : `${spec.label} (${spec.unit})`}
                        value={draft[spec.key]}
                        onChangeText={(value) => setScalar(spec.key, value)}
                        error={errors[spec.key]}
                        placeholder={spec.isOptional ? 'Not set' : undefined}
                        keyboardType={spec.isDecimal ? 'decimal-pad' : 'number-pad'}
                        icon={spec.icon}
                        tone={spec.tone}
                      />
                    ))}

                    <Text style={Type.caption}>
                      An overridden target stops being derived and keeps the number you set
                      until you recalculate. Every version records which fields were yours.
                    </Text>
                  </>
                )}

                <ZonePanel zones={plan.hr_zones} basis={plan.basis} />

                {formError ? <Text style={styles.error}>{formError}</Text> : null}

                <BasisDisclosure
                  summary={basisSummary(plan.basis)}
                  lines={basisLines(plan.basis)}
                />
              </Animated.View>

              {isQueued ? (
                <View style={styles.queued}>
                  <Feather name="upload-cloud" size={13} color={AuraColors.content.muted} />
                  <Text style={styles.queuedLabel}>
                    Your change is queued and will save when you&apos;re back online. The
                    targets above are still the ones the server has.
                  </Text>
                </View>
              ) : null}

              {plan.basis.missing.length > 0 ? (
                <Animated.View entering={FadeInUp.delay(80).duration(400)} style={styles.card}>
                  <Text style={Type.cardTitle}>What your plan does not know</Text>
                  <Text style={Type.prose}>
                    It could not use {listMissing(plan.basis.missing)}, so the targets above
                    that depend on them are population defaults, or missing entirely.
                  </Text>
                  <PrimaryButton
                    label="Fill in what is missing"
                    variant="quiet"
                    onPress={() => router.push('/body-profile')}
                  />
                </Animated.View>
              ) : null}

              {isBehindProfile ? (
                <View style={styles.behind}>
                  <Feather name="refresh-cw" size={13} color={AuraColors.caution} />
                  <Text style={styles.behindLabel}>
                    You changed your body figures after this plan was worked out.
                  </Text>
                </View>
              ) : null}

              <View style={styles.actions}>
                {draft === null ? (
                  <>
                    <PrimaryButton label="Edit targets" onPress={() => setDraft(draftFrom(plan))} />
                    <PrimaryButton
                      label="Work them out again from my profile"
                      variant="quiet"
                      loading={isRecalculating}
                      onPress={handleRecalculate}
                    />
                    <Text style={styles.actionNote}>
                      Recalculating drops anything you set by hand and derives every target
                      afresh. Earlier versions are kept.
                    </Text>
                  </>
                ) : (
                  <>
                    <PrimaryButton label="Save targets" onPress={handleSave} loading={isSaving} />
                    <PrimaryButton label="Cancel" variant="quiet" onPress={closeEditor} />
                  </>
                )}

                <Pressable
                  onPress={() => router.push('/plan-history')}
                  accessibilityRole="button"
                  accessibilityLabel="Earlier versions of your plan"
                  style={styles.historyLink}>
                  <Feather name="clock" size={14} color={AuraColors.brand.default} />
                  <Text style={styles.historyLabel}>Earlier versions</Text>
                </Pressable>
              </View>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
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
  skeleton: { height: 240, borderRadius: Radius.card, backgroundColor: AuraColors.surface.raised },
  card: { ...Surfaces.card, gap: 14 },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  target: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44 },
  targetIcon: {
    width: 40,
    height: 40,
    borderRadius: Radius.iconMedium,
    alignItems: 'center',
    justifyContent: 'center',
  },
  targetText: { flex: 1, gap: 2 },
  targetTitle: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  targetValue: { alignItems: 'flex-end', gap: 1 },
  targetNumber: {
    fontFamily: Font.bold,
    fontSize: 18,
    color: AuraColors.content.default,
    fontVariant: ['tabular-nums'],
  },
  targetDash: { fontFamily: Font.regular, fontSize: 18, color: AuraColors.content.muted },
  zones: { ...Surfaces.panel, gap: 8 },
  zoneRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  zoneRange: {
    fontFamily: Font.semibold,
    fontSize: 14,
    color: AuraColors.content.default,
    fontVariant: ['tabular-nums'],
  },
  queued: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    padding: 12,
    borderRadius: Radius.panel,
    backgroundColor: AuraColors.surface.raised,
  },
  queuedLabel: { flex: 1, ...Type.caption },
  behind: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    borderRadius: Radius.panel,
    backgroundColor: IconTones.caution.bg,
  },
  behindLabel: { flex: 1, fontFamily: Font.medium, fontSize: 12, color: AuraColors.caution },
  actions: { gap: 12 },
  actionNote: { ...Type.caption, textAlign: 'center' },
  historyLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    minHeight: 44,
  },
  historyLabel: { fontFamily: Font.semibold, fontSize: 13, color: AuraColors.brand.default },
  secondaryAction: {
    ...Type.caption,
    textAlign: 'center',
    color: AuraColors.brand.default,
  },
  error: { ...Type.caption, color: AuraColors.danger },
});
