import { Feather } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInUp } from 'react-native-reanimated';

import { GLASS_ML, WATER_GOAL_ML } from '@/constants/goals';
import { Font, Surfaces, Type } from '@/constants/design';
import { AuraColors, IconTones } from '@/constants/theme';
import { ApiError } from '@/services/api-client';
import { recordHealthSnapshot } from '@/services/health-snapshot-service';
import { enqueue } from '@/services/outbox';
import { todayIsoDate } from '@/services/recovery-service';

const GLASSES = Math.round(WATER_GOAL_ML / GLASS_ML);

export function WaterTracker({
  waterMl,
  onLogged,
}: {
  waterMl: number | null;
  onLogged?: () => void;
}) {
  // Optimistic, because a tap that waits on a round trip feels broken for something this
  // small. The write is idempotent per (user, day), so a replay through the outbox lands
  // on the same total rather than double-counting.
  const [pending, setPending] = useState<number | null>(null);
  const total = pending ?? waterMl ?? 0;
  const filled = Math.min(Math.round(total / GLASS_ML), GLASSES);

  async function setTotal(next: number) {
    const clamped = Math.max(0, Math.min(next, GLASSES * GLASS_ML));
    setPending(clamped);

    const payload = { recorded_on: todayIsoDate(), water_ml: clamped };

    try {
      await recordHealthSnapshot(payload);
      onLogged?.();
    } catch (error) {
      if (error instanceof ApiError && error.status === 0) {
        await enqueue({ kind: 'health-snapshot', body: payload });
      }
    }
  }

  return (
    <Animated.View entering={FadeInUp.delay(120).duration(400)} style={styles.card}>
      <View style={styles.head}>
        <View style={styles.title}>
          <View style={[styles.icon, { backgroundColor: IconTones.accent.bg }]}>
            <Feather name="droplet" size={15} color={IconTones.accent.color} />
          </View>
          <Text style={Type.cardTitle}>Water</Text>
        </View>
        <Text style={styles.total}>
          {total.toLocaleString()}
          <Text style={styles.goal}> / {WATER_GOAL_ML.toLocaleString()} ml</Text>
        </Text>
      </View>

      <View style={styles.glasses}>
        {Array.from({ length: GLASSES }, (_, i) => {
          const isFilled = i < filled;
          // Tapping the last filled glass empties it — undo without a separate control.
          const next = isFilled && i === filled - 1 ? i * GLASS_ML : (i + 1) * GLASS_ML;

          return (
            <Pressable
              key={i}
              onPress={() => setTotal(next)}
              accessibilityRole="button"
              accessibilityState={{ selected: isFilled }}
              accessibilityLabel={`${isFilled ? 'Remove' : 'Log'} glass ${i + 1} of ${GLASSES}`}
              hitSlop={4}
              style={[styles.glass, isFilled && styles.glassFilled]}>
              <Feather
                name="droplet"
                size={16}
                color={isFilled ? '#ffffff' : '#cbd5e1'}
              />
            </Pressable>
          );
        })}
      </View>

      <Text style={Type.caption}>
        Tap a glass to log {GLASS_ML} ml. Tap the last filled one to undo.
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: { ...Surfaces.card, gap: 12 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  icon: { width: 30, height: 30, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  total: {
    fontFamily: Font.bold,
    fontSize: 15,
    color: AuraColors.content.default,
    fontVariant: ['tabular-nums'],
  },
  goal: { fontFamily: Font.regular, fontSize: 12, color: AuraColors.content.muted },
  glasses: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  glass: {
    width: 38,
    height: 38,
    borderRadius: 999,
    backgroundColor: AuraColors.surface.sunken,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glassFilled: { backgroundColor: AuraColors.accent.deep },
});
