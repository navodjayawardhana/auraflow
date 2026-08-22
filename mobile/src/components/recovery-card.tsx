import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { PrimaryButton } from '@/components/primary-button';
import { ScoreRing } from '@/components/score-ring';
import { Font, Radius, Surfaces, Type } from '@/constants/design';
import { AuraColors } from '@/constants/theme';
import type { RecoveryReading } from '@/types';

function LoadingSkeleton() {
  const opacity = useSharedValue(0.4);

  useEffect(() => {
    opacity.value = withRepeat(
      withSequence(withTiming(1, { duration: 700 }), withTiming(0.4, { duration: 700 })),
      -1,
    );
  }, [opacity]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <View style={styles.card}>
      <Animated.View style={[styles.skeletonRing, animatedStyle]} />
    </View>
  );
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <View style={styles.card}>
      <Text style={Type.cardTitle}>Couldn&apos;t load today&apos;s recovery</Text>
      <PrimaryButton label="Retry" onPress={onRetry} />
    </View>
  );
}

function UnavailableState({ reason }: { reason: string }) {
  const router = useRouter();

  return (
    <View style={styles.card}>
      <View style={styles.copy}>
        <Text style={Type.cardTitle}>No recovery score yet</Text>
        <Text style={Type.prose}>{reason}</Text>
      </View>
      <PrimaryButton label="Log last night" onPress={() => router.push('/log-night')} />
    </View>
  );
}

function AvailableState({ reading }: { reading: Extract<RecoveryReading, { available: true }> }) {
  return (
    <View style={[styles.card, styles.centred]}>
      <ScoreRing score={reading.score} tone={reading.provisional ? 'provisional' : 'success'} />

      {reading.provisional ? (
        <View style={styles.centred}>
          <View style={styles.provisionalPill}>
            <Text style={styles.provisionalText}>Provisional — building your baseline</Text>
          </View>
          <Text style={Type.caption}>Based on {reading.components_used} of 3 signals</Text>
        </View>
      ) : null}

      {reading.illness_warning ? (
        <View style={styles.warning}>
          <Feather name="alert-circle" size={14} color={AuraColors.caution} />
          <Text style={styles.warningText}>
            Your resting heart rate is higher than usual today
          </Text>
        </View>
      ) : null}
    </View>
  );
}

interface RecoveryCardProps {
  status: 'loading' | 'loaded' | 'error';
  reading: RecoveryReading | null;
  onRetry: () => void;
}

export function RecoveryCard({ status, reading, onRetry }: RecoveryCardProps) {
  if (status === 'loading') return <LoadingSkeleton />;
  if (status === 'error') return <ErrorState onRetry={onRetry} />;
  if (!reading) return null;
  if (!reading.available) return <UnavailableState reason={reading.reason} />;
  return <AvailableState reading={reading} />;
}

const styles = StyleSheet.create({
  card: { ...Surfaces.card, gap: 12 },
  centred: { alignItems: 'center', gap: 6 },
  copy: { gap: 5 },
  skeletonRing: {
    width: 160,
    height: 160,
    borderRadius: Radius.pill,
    alignSelf: 'center',
    backgroundColor: AuraColors.surface.selected,
  },
  provisionalPill: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: Radius.pill,
    // The violet used at 10% — provisional is "less certain", never a severity colour.
    backgroundColor: 'rgba(139,92,246,0.1)',
  },
  provisionalText: { fontFamily: Font.semibold, fontSize: 12, color: AuraColors.provisional },
  warning: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    width: '100%',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: Radius.panel,
    backgroundColor: 'rgba(180,83,9,0.1)',
  },
  warningText: { flex: 1, fontFamily: Font.medium, fontSize: 12, color: AuraColors.caution },
});
