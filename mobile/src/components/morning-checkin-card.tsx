import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInUp } from 'react-native-reanimated';

import { Font, Radius, Surfaces, Type } from '@/constants/design';
import { AuraColors, IconTones } from '@/constants/theme';
import type { RestingHrSource } from '@/types';

/**
 * The dashboard's ask for today's seated reading.
 *
 * A baseline made of check-ins is only worth having if the check-ins happen, and they happen
 * on the morning they are asked for. Buried behind the ＋ menu this becomes a thing the user
 * remembers to do on the days they least need reminding, and the series acquires gaps in
 * exactly the pattern that makes a mean misleading.
 *
 * It goes quiet the moment there is a reading for today rather than nagging, because a card
 * that stays after the job is done teaches people to look past it.
 */
export function MorningCheckinCard({
  restingHeartRate,
  source,
  hasNode,
  index = 0,
}: {
  restingHeartRate: number | null;
  source: RestingHrSource | null;
  hasNode: boolean;
  index?: number;
}) {
  const router = useRouter();

  // No node, no capture. The check-in is the node's one job on this screen, and an entry
  // point to a dead end is worse than no entry point.
  if (!hasNode) return null;

  const done = source === 'seated_spot' && restingHeartRate !== null;

  // A day holds one resting rate, so a check-in on a day that already carries a night's
  // reading replaces it rather than joining it. Said out loud: the alternative is a person
  // discovering it by watching last night's figure disappear.
  const wouldReplaceNight = source === 'overnight' && restingHeartRate !== null;

  return (
    <Animated.View entering={FadeInUp.delay(index * 60).duration(400)} style={styles.card}>
      <View style={styles.head}>
        <View style={[styles.icon, done && styles.iconDone]}>
          <Feather
            name={done ? 'check' : 'sunrise'}
            size={17}
            color={done ? AuraColors.success : IconTones.brand.color}
          />
        </View>

        <View style={styles.copy}>
          <Text style={Type.cardTitle}>
            {done ? 'Checked in this morning' : 'Morning check-in'}
          </Text>
          <Text style={Type.prose}>
            {done
              ? `${restingHeartRate} bpm, seated. It joins your own seated baseline — kept apart from overnight readings.`
              : wouldReplaceNight
                ? `Today already holds an overnight reading of ${restingHeartRate} bpm. A check-in would replace it, since a day carries one resting rate.`
                : 'A minute with a finger on the node, taken the same way each day, gives the recovery score a resting rate of your own.'}
          </Text>
        </View>
      </View>

      {done ? null : (
        <Pressable
          onPress={() => router.push('/morning-checkin')}
          accessibilityRole="button"
          accessibilityLabel="Start the morning check-in"
          style={styles.action}>
          <Text style={styles.actionLabel}>
            {wouldReplaceNight ? 'Check in anyway' : 'Start check-in'}
          </Text>
          <Feather name="arrow-right" size={14} color="#ffffff" />
        </Pressable>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: { ...Surfaces.card, gap: 12 },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  icon: {
    width: 38,
    height: 38,
    borderRadius: Radius.iconMedium,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: IconTones.brand.bg,
  },
  iconDone: { backgroundColor: 'rgba(15,157,88,0.1)' },
  copy: { flex: 1, gap: 4 },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 42,
    borderRadius: Radius.pill,
    backgroundColor: AuraColors.brand.default,
  },
  actionLabel: { fontFamily: Font.semibold, fontSize: 14, color: '#ffffff' },
});
