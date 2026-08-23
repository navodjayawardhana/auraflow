import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInUp } from 'react-native-reanimated';

import { Font, Surfaces, Type } from '@/constants/design';
import { AuraColors } from '@/constants/theme';
import type { Coverage } from '@/services/insights-summary';

/**
 * How much of the window each signal actually covers.
 *
 * The cheapest panel on the screen and the one every other number stands on. A fortnight's
 * average over three days is a different claim from one over fourteen, and nothing else
 * here can say which of the two you are reading — the averages carry their own coverage
 * line, but only this shows the shape of what is missing across all of them at once.
 *
 * It is placed above the charts rather than below them for that reason. Read afterwards it
 * is a footnote; read first it is the frame.
 */
export function CoveragePanel({ coverage, index = 0 }: { coverage: Coverage; index?: number }) {
  const { windowDays } = coverage;

  return (
    <Animated.View entering={FadeInUp.delay(index * 60).duration(400)} style={styles.card}>
      <View style={styles.head}>
        <Text style={Type.cardTitle}>What these days actually hold</Text>
        <Text style={Type.meta}>of {windowDays}</Text>
      </View>

      <View style={styles.rows}>
        {coverage.rows.map((row) => {
          const filled = windowDays === 0 ? 0 : row.days / windowDays;

          return (
            <View key={row.key} style={styles.row}>
              <Text style={styles.label} numberOfLines={1}>
                {row.label}
              </Text>

              <View style={styles.track}>
                <View
                  style={[
                    styles.fill,
                    {
                      width: `${filled * 100}%`,
                      // Muted below half: the bar is a coverage figure, not a score, and a
                      // brand-blue bar at 3/14 reads as an achievement.
                      backgroundColor:
                        filled >= 0.5 ? AuraColors.brand.default : AuraColors.surface.selected,
                    },
                  ]}
                />
              </View>

              <Text style={styles.count}>{row.days}</Text>
            </View>
          );
        })}
      </View>

      {coverage.mealDaysWithEstimate > 0 ? (
        <Text style={Type.caption}>
          {coverage.mealDaysWithEstimate} of the fed days include something nobody measured —
          a typed guess or a photo estimate. Counted, but not the same as a label.
        </Text>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: { ...Surfaces.card, gap: 12 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rows: { gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  label: { ...Type.tileLabel, width: 108 },
  track: {
    flex: 1,
    height: 6,
    borderRadius: 999,
    backgroundColor: AuraColors.surface.raised,
    overflow: 'hidden',
  },
  fill: { height: 6, borderRadius: 999 },
  count: {
    fontFamily: Font.semibold,
    fontSize: 12,
    color: AuraColors.content.default,
    fontVariant: ['tabular-nums'],
    width: 18,
    textAlign: 'right',
  },
});
