import { Feather } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInUp } from 'react-native-reanimated';

import { Font, Surfaces, Type } from '@/constants/design';
import { AuraColors } from '@/constants/theme';
import { MIN_PAIRED_DAYS } from '@/services/correlation';
import { describeRho, type RecoveryDriver } from '@/services/insights-summary';

/**
 * What moves with recovery, and — the actual content of this panel — how little that can
 * be trusted.
 *
 * The layout is the argument. The caveat is the headline and the coefficients are small,
 * grey and below it, because the reverse ordering is how a health app starts lying: a bold
 * "ρ 0.42" with a hedge underneath is read as a finding with a disclaimer attached, and
 * nobody reads the disclaimer. Here the reader has to pass the limitation to reach the
 * number.
 *
 * Three things are said out loud that a correlation panel usually omits:
 *
 *   The floor. Under ten paired days no coefficient is drawn at all, and the empty state
 *   says exactly what would change that rather than leaving a blank card.
 *
 *   The scale of what is knowable. This project's own validation — E-015, against 1,729
 *   days of self-reported readiness from sixteen people — found the best wearable-derived
 *   predictor reaching ρ 0.123, which it calls weak by any standard. A fortnight of one
 *   person cannot beat that; it can only look like it has.
 *
 *   The tautology. The recovery score is computed from resting heart rate and sleep, so
 *   two of these three coefficients largely restate the formula. Steps is the only signal
 *   the score never sees, and so the only row that could be a discovery.
 */
export function RecoveryDriversPanel({
  drivers,
  index = 0,
}: {
  drivers: RecoveryDriver[];
  index?: number;
}) {
  const computed = drivers.filter((driver) => driver.outcome.kind === 'computed');
  const pairs = Math.max(...drivers.map((driver) => driver.outcome.pairs), 0);

  return (
    <Animated.View entering={FadeInUp.delay(index * 60).duration(400)} style={styles.card}>
      <Text style={Type.cardTitle}>What moves with your recovery</Text>

      <View style={styles.lead}>
        <Feather name="alert-circle" size={15} color={AuraColors.caution} />
        <View style={styles.leadBody}>
          <Text style={styles.leadHeadline}>
            {computed.length === 0
              ? `${pairs} paired ${pairs === 1 ? 'day' : 'days'} is not enough to tell you anything.`
              : `${pairs} days of your own data can show a pattern. It cannot establish one.`}
          </Text>
          <Text style={styles.leadBody2}>
            Measured properly — 1,729 days of self-reported readiness from sixteen people —
            the strongest wearable-derived predictor this project found reached ρ 0.123, a
            weak correlation by any standard. Nothing computed from a fortnight of one person
            does better than that; it only looks like it might.
          </Text>

          {computed.length === 0 ? (
            <Text style={styles.leadBody2}>
              Nothing is drawn below until {MIN_PAIRED_DAYS} days carry both an established
              recovery score and the signal. Logging a night with a resting heart rate is what
              adds one.
            </Text>
          ) : null}
        </View>
      </View>

      <View style={styles.rows}>
        {drivers.map((driver) => (
          <DriverRow key={driver.key} driver={driver} />
        ))}
      </View>

      <Text style={Type.caption}>
        Spearman&apos;s ρ on ranks, over days with an established score — provisional days are
        a different measurement and are left out. Resting heart rate and sleep are inputs to
        the score itself, so their coefficients mostly restate its formula; steps is the one
        signal the score never sees.
      </Text>
    </Animated.View>
  );
}

function DriverRow({ driver }: { driver: RecoveryDriver }) {
  const { outcome } = driver;

  return (
    <View style={styles.row}>
      <View style={styles.rowLabel}>
        <Text style={styles.name}>{driver.label}</Text>
        {driver.isScoreInput ? <Text style={styles.tag}>input to the score</Text> : null}
      </View>

      <View style={styles.rowValue}>
        {outcome.kind === 'computed' ? (
          <>
            <Text style={styles.rho}>
              {outcome.rho >= 0 ? '+' : '−'}
              {Math.abs(outcome.rho).toFixed(2)}
            </Text>
            <Text style={styles.detail}>
              {describeRho(outcome.rho)} · {outcome.pairs} days
            </Text>
          </>
        ) : (
          <>
            <Text style={styles.withheld}>—</Text>
            <Text style={styles.detail}>
              {outcome.kind === 'no-variation'
                ? // Not zero. A signal that never moved has no ordering for recovery to
                  // agree or disagree with, and a zero would read as "unrelated".
                  'never varied — undefined, not zero'
                : `${outcome.pairs} of ${MIN_PAIRED_DAYS} days needed`}
            </Text>
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { ...Surfaces.card, gap: 14 },
  lead: { ...Surfaces.panel, flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  leadBody: { flex: 1, gap: 6 },
  leadHeadline: {
    fontFamily: Font.semibold,
    fontSize: 14,
    lineHeight: 20,
    color: AuraColors.content.default,
  },
  leadBody2: {
    fontFamily: Font.regular,
    fontSize: 11,
    lineHeight: 17,
    color: AuraColors.content.muted,
  },
  rows: { gap: 10 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  rowLabel: { flex: 1, gap: 1 },
  // Deliberately quieter than the caveat above it. These are illustrations, not results.
  name: { fontFamily: Font.medium, fontSize: 13, color: AuraColors.content.muted },
  tag: { fontFamily: Font.regular, fontSize: 10, color: '#94a3b8' },
  rowValue: { alignItems: 'flex-end', gap: 1 },
  rho: {
    fontFamily: Font.semibold,
    fontSize: 15,
    color: AuraColors.content.muted,
    fontVariant: ['tabular-nums'],
  },
  withheld: { fontFamily: Font.regular, fontSize: 15, color: '#94a3b8' },
  detail: { fontFamily: Font.regular, fontSize: 10, color: '#94a3b8' },
});
