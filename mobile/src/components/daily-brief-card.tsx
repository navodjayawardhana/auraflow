import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { Font, GradientAxis, Radius, Surfaces, Type } from '@/constants/design';
import { AuraColors } from '@/constants/theme';
import type { DailyBrief } from '@/services/brief-service';

/**
 * Skeletons that pulse rather than shimmer.
 *
 * A sweep implies progress along a bar; a language model call has no measurable progress,
 * so a gentle breath is the honest idle. Pending is a state a user sees every morning —
 * it deserves to look considered rather than broken.
 */
function Skeletons() {
  const opacity = useSharedValue(0.6);

  useEffect(() => {
    opacity.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 1200, easing: Easing.inOut(Easing.quad) }),
        withTiming(0.6, { duration: 1200, easing: Easing.inOut(Easing.quad) }),
      ),
      -1,
    );
  }, [opacity]);

  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View style={[styles.skeletons, style]}>
      {['100%', '86%', '62%'].map((width) => (
        <View key={width} style={[styles.skeleton, { width: width as `${number}%` }]} />
      ))}
    </Animated.View>
  );
}

function writtenAt(iso: string | null): string | null {
  if (iso === null) return null;
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

export function DailyBriefCard({
  brief,
  onRetry,
}: {
  brief: DailyBrief | null;
  onRetry: () => void;
}) {
  if (brief === null) return null;

  const status = brief.status;
  const time = writtenAt(brief.generated_at);

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <View style={[styles.badge, status !== 'ready' && styles.badgePlain]}>
          {status === 'ready' ? (
            <LinearGradient
              colors={[AuraColors.brand.default, AuraColors.accent.default]}
              start={GradientAxis.deg135.start}
              end={GradientAxis.deg135.end}
              style={StyleSheet.absoluteFill}
            />
          ) : null}
          <Feather
            name={status === 'failed' ? 'alert-triangle' : 'zap'}
            size={14}
            color={
              status === 'ready'
                ? '#ffffff'
                : status === 'failed'
                  ? AuraColors.caution
                  : '#94a3b8'
            }
          />
        </View>

        <View style={styles.headText}>
          <Text style={Type.cardTitle}>Your brief</Text>
          <Text style={Type.caption}>
            {/*
                Which model wrote it stays in the payload and in the database -- advice from
                a model since replaced has to remain identifiable, which is what that column
                is for. It just does not belong on the card: a person reading their morning
                brief needs to know a machine wrote it, not which company's.
            */}
            {status === 'ready' && time
              ? `written ${time} · generated, not written by a person`
              : status === 'pending'
                ? 'from this morning’s figures'
                : 'not written today'}
          </Text>
        </View>

        {status !== 'failed' ? (
          <View style={styles.statusPill}>
            <Text style={styles.statusLabel}>{status === 'ready' ? 'Ready' : 'Writing…'}</Text>
          </View>
        ) : null}
      </View>

      {status === 'pending' ? <Skeletons /> : null}

      {status === 'ready' && brief.body ? (
        <View style={styles.paragraphs}>
          {brief.body
            .split(/\n\s*\n/)
            .filter((p) => p.trim() !== '')
            .map((paragraph, i) => (
              <Text key={i} style={Type.prose}>
                {paragraph.trim()}
              </Text>
            ))}
        </View>
      ) : null}

      {status === 'failed' ? (
        <>
          {/* Says what still works. A health app that blanks the screen on a failed
              optional feature teaches the user not to trust the rest of it. */}
          <Text style={Type.prose}>
            {brief.reason ?? 'Couldn’t be written this morning.'} Your figures below are
            unaffected.
          </Text>
          <Pressable
            onPress={onRetry}
            accessibilityRole="button"
            accessibilityLabel="Try writing the brief again"
            style={styles.retry}>
            <Text style={styles.retryLabel}>Try again</Text>
          </Pressable>
        </>
      ) : null}

      {status === 'ready' ? (
        <View style={styles.footer}>
          <Feather name="info" size={12} color={AuraColors.content.muted} />
          <Text style={styles.footerText}>
            Written from your own figures. Not medical advice.
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { ...Surfaces.card, gap: 12 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  badge: {
    width: 28,
    height: 28,
    borderRadius: Radius.navPill,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  badgePlain: { backgroundColor: '#f1f5f9' },
  headText: { flex: 1, gap: 1 },
  statusPill: {
    height: 22,
    paddingHorizontal: 9,
    borderRadius: 999,
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusLabel: { fontFamily: Font.semibold, fontSize: 10, color: AuraColors.content.muted },
  skeletons: { gap: 10 },
  skeleton: { height: 9, borderRadius: 999, backgroundColor: '#f1f5f9' },
  paragraphs: { gap: 10 },
  retry: {
    alignSelf: 'flex-start',
    height: 36,
    paddingHorizontal: 16,
    borderRadius: 999,
    backgroundColor: AuraColors.surface.sunken,
    borderWidth: 1,
    borderColor: AuraColors.surface.selected,
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryLabel: { fontFamily: Font.semibold, fontSize: 12, color: AuraColors.brand.default },
  footer: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, paddingTop: 2 },
  footerText: {
    flex: 1,
    fontFamily: Font.regular,
    fontSize: 10,
    lineHeight: 15,
    color: AuraColors.content.muted,
  },
});
