import { Feather } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInUp } from 'react-native-reanimated';

import { Font, Surfaces, Type } from '@/constants/design';
import { AuraColors, IconTones } from '@/constants/theme';
import type { GoalAdherence, SleepAgainstNeed } from '@/services/insights-summary';

/**
 * The targets against what actually happened.
 *
 * This is the only place in the app that closes the loop the plan opened. Everything up to
 * now runs one way — a profile derives targets, the dashboard shows today against them —
 * and nothing ever went back and asked whether a fortnight of days met the numbers a
 * published formula produced for this person.
 *
 * Two rules shape how it is allowed to say so:
 *
 *   Days that recorded nothing are not failures. The denominator is the days that carried
 *   a measurement, and the days that did not are named underneath rather than folded in —
 *   a phone left at home is not a day the user missed their step goal.
 *
 *   The provenance of every target is on the card. A default is not the user's goal, and a
 *   screen reporting adherence to one without saying whose it is invents an obligation.
 */
export function PlanAdherencePanel({
  steps,
  water,
  sleep,
  source,
  index = 0,
}: {
  steps: GoalAdherence;
  water: GoalAdherence;
  sleep: SleepAgainstNeed;
  source: 'plan' | 'fallback';
  index?: number;
}) {
  return (
    <Animated.View entering={FadeInUp.delay(index * 60).duration(400)} style={styles.card}>
      <Text style={Type.cardTitle}>Against your plan</Text>

      <GoalRow
        icon="activity"
        tone="brand"
        adherence={steps}
        target={`${steps.target.toLocaleString()} steps`}
      />
      <GoalRow
        icon="droplet"
        tone="accent"
        adherence={water}
        target={`${water.target.toLocaleString()} ml`}
      />
      <SleepRow sleep={sleep} />

      {/* Same words as the dashboard's, because it is the same claim about the same number. */}
      <Text style={Type.caption}>
        {source === 'plan'
          ? 'Targets from your plan — each derived from a named published formula.'
          : 'Default targets — nothing about you yet. Fill in your profile and the plan derives its own.'}
      </Text>
    </Animated.View>
  );
}

function GoalRow({
  icon,
  tone,
  adherence,
  target,
}: {
  icon: keyof typeof Feather.glyphMap;
  tone: keyof typeof IconTones;
  adherence: GoalAdherence;
  target: string;
}) {
  const { metDays, recordedDays, windowDays } = adherence;
  const measured = recordedDays > 0;
  const badge = IconTones[tone];

  return (
    <View style={styles.row}>
      <View style={[styles.icon, { backgroundColor: measured ? badge.bg : AuraColors.surface.selected }]}>
        <Feather name={icon} size={14} color={measured ? badge.color : AuraColors.content.muted} />
      </View>

      <View style={styles.body}>
        <View style={styles.valueRow}>
          {measured ? (
            <>
              <Text style={styles.metric}>{metDays}</Text>
              <Text style={styles.denominator}>
                /{recordedDays} {recordedDays === 1 ? 'day' : 'days'} met {target}
              </Text>
            </>
          ) : (
            <Text style={styles.absent}>Nothing recorded to compare with {target}</Text>
          )}
        </View>

        {measured ? (
          <View style={styles.track}>
            <View
              style={[
                styles.fill,
                { width: `${(metDays / recordedDays) * 100}%`, backgroundColor: badge.color },
              ]}
            />
          </View>
        ) : null}

        {/* Out of how many days could have met it, which is not the same as the window. */}
        <Text style={Type.caption}>
          {recordedDays === windowDays
            ? `every one of the last ${windowDays} days carried a measurement`
            : `${recordedDays} of ${windowDays} days carried a measurement — the rest are unknown, not missed`}
        </Text>
      </View>
    </View>
  );
}

function SleepRow({ sleep }: { sleep: SleepAgainstNeed }) {
  const { meanHours, needHours, differenceHours, recordedDays, windowDays } = sleep;
  const badge = IconTones.stage;
  const measured = meanHours !== null;

  return (
    <View style={styles.row}>
      <View style={[styles.icon, { backgroundColor: measured ? badge.bg : AuraColors.surface.selected }]}>
        <Feather name="moon" size={14} color={measured ? badge.color : AuraColors.content.muted} />
      </View>

      <View style={styles.body}>
        <View style={styles.valueRow}>
          {measured ? (
            <>
              <Text style={styles.metric}>{meanHours.toFixed(1)}</Text>
              <Text style={styles.denominator}>
                {needHours === null ? 'h a night' : `h a night against a ${needHours.toFixed(1)} h need`}
              </Text>
            </>
          ) : (
            <Text style={styles.absent}>No nights logged in this window</Text>
          )}
        </View>

        <Text style={Type.caption}>
          {needHours === null
            ? // No invented eight hours: `resolveTargets` substitutes a default step goal
              // and water target because both are published population figures, and
              // refuses to substitute a sleep need. So does this.
              'No sleep need yet — your plan derives one from your age, and there is no default worth standing in for it.'
            : differenceHours === null
              ? `nothing to compare over the last ${windowDays} days`
              : `${differenceHours < 0 ? `${Math.abs(differenceHours).toFixed(1)} h short` : `${differenceHours.toFixed(1)} h over`}, averaged across ${recordedDays} of ${windowDays} nights`}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { ...Surfaces.card, gap: 14 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  icon: { width: 30, height: 30, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, gap: 5 },
  valueRow: { flexDirection: 'row', alignItems: 'baseline', gap: 4 },
  metric: {
    fontFamily: Font.bold,
    fontSize: 20,
    lineHeight: 22,
    letterSpacing: -0.4,
    color: AuraColors.content.default,
    fontVariant: ['tabular-nums'],
  },
  denominator: { fontFamily: Font.regular, fontSize: 12, color: AuraColors.content.muted },
  absent: { fontFamily: Font.regular, fontSize: 13, color: AuraColors.content.muted },
  track: {
    height: 4,
    borderRadius: 999,
    backgroundColor: AuraColors.surface.raised,
    overflow: 'hidden',
  },
  fill: { height: 4, borderRadius: 999 },
});
