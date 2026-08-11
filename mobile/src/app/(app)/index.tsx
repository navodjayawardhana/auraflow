import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '@/context/auth-context';
import { fetchRecovery } from '@/services/recovery-service';
import type { RecoveryReading } from '@/types';

export default function TodayScreen() {
  const { user, signOut } = useAuth();

  const [reading, setReading] = useState<RecoveryReading | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    setError(null);
    try {
      setReading(await fetchRecovery());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load your recovery.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <SafeAreaView className="flex-1 bg-surface">
      <ScrollView
        contentContainerClassName="p-four gap-four"
        refreshControl={<RefreshControl refreshing={isLoading} onRefresh={load} />}
      >
        <Text className="text-3xl font-bold text-content">Hello, {user?.name ?? 'there'}</Text>

        <View className="gap-three rounded-2xl bg-surface-raised p-four" testID="recovery-card">
          <Text className="text-sm font-semibold text-content-muted">Recovery</Text>

          {isLoading && !reading ? (
            <ActivityIndicator testID="recovery-loading" />
          ) : error ? (
            <Text className="text-base text-danger" accessibilityRole="alert">
              {error}
            </Text>
          ) : reading?.available ? (
            <RecoveryValue reading={reading} />
          ) : (
            // Not an error state: the account and the date are both fine, there is just
            // nothing recorded yet. Saying so beats an empty circle.
            <Text className="text-base text-content-muted" testID="recovery-unavailable">
              {reading?.reason ?? 'No reading yet.'}
            </Text>
          )}
        </View>

        <Pressable
          className="h-touch items-center justify-center"
          onPress={signOut}
          accessibilityRole="button"
        >
          <Text className="text-base font-semibold text-brand">Sign out</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function RecoveryValue({ reading }: { reading: Extract<RecoveryReading, { available: true }> }) {
  return (
    <View className="gap-two">
      <Text className="text-6xl font-bold text-content" testID="recovery-score">
        {Math.round(reading.score)}
      </Text>

      {reading.provisional ? (
        // Surfaced, not hidden. A provisional score is a different measurement from an
        // established one, and the two must not be read as one trend.
        <Text className="text-sm text-content-muted" testID="recovery-provisional">
          Provisional — still learning your baseline
        </Text>
      ) : null}

      {reading.illness_warning ? (
        <Text className="text-base text-caution" testID="recovery-illness">
          Your resting heart rate is unusually high for you. Consider an easy day.
        </Text>
      ) : null}
    </View>
  );
}
