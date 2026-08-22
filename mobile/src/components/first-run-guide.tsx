import { Feather } from '@expo/vector-icons';
import { useRouter, type Href } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInUp } from 'react-native-reanimated';

import { Font, Radius, Surfaces, Type } from '@/constants/design';
import { AuraColors, IconTones } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import { readCache, writeCache } from '@/services/cache';

/**
 * The dashboard's answer to its own cold start.
 *
 * A new account sees four em dashes, two empty bars and a forecast that says none of its
 * health inputs are theirs. Every one of those is honest, and together they read as broken
 * rather than as new. The recovery card already solves this for its own number — it says
 * why the score is missing and offers the one action that fixes it — and this is that same
 * move made once for the whole screen.
 *
 * Deliberately not a slideshow before the dashboard. Someone who has been told three things
 * and then handed a screen of dashes has learned nothing about *this* screen; the empty
 * state is the lesson, so the explanation belongs inside it.
 */

/** Stored per user, so two accounts on one handset do not share a finished guide. */
const DISMISSED_RESOURCE = 'first-run-guide.dismissed';

interface Props {
  /** A night is on record for today — the recovery score's one prerequisite. */
  hasLoggedSleep: boolean;
  /** A node has been chosen. Not whether it is online: a powered-down node is still set up. */
  hasNode: boolean;
  /** A location category is known, which is seven of the focus model's inputs. */
  hasContext: boolean;
}

interface Step {
  done: boolean;
  title: string;
  /** What the user gets, in their terms. Never the mechanism. */
  payoff: string;
  action: string;
  href: Href;
}

export function FirstRunGuide({ hasLoggedSleep, hasNode, hasContext }: Props) {
  const { user } = useAuth();
  const router = useRouter();

  /**
   * `null` while the stored answer is still being read. Rendering the card and pulling it
   * away a frame later is worse than a beat of nothing where it would have been.
   */
  const [isDismissed, setIsDismissed] = useState<boolean | null>(null);

  useEffect(() => {
    if (user === null) return;

    let active = true;

    (async () => {
      const stored = await readCache<boolean>(user.id, DISMISSED_RESOURCE);
      if (active) setIsDismissed(stored?.value === true);
    })();

    return () => {
      active = false;
    };
  }, [user]);

  const steps: Step[] = [
    {
      done: hasLoggedSleep,
      title: "Log last night's sleep",
      payoff: 'Turns the dash at the top into a recovery score',
      action: 'Log',
      href: '/log-night',
    },
    {
      done: hasNode,
      title: 'Connect your AuraFlow node',
      payoff: 'Live heart rate and oxygen, and the lamp follows your day',
      action: 'Set up',
      href: '/device',
    },
    {
      done: hasContext,
      title: 'Tell AuraFlow where you are',
      payoff: 'Home, work or the gym sharpens the focus forecast',
      action: 'Choose',
      href: '/places',
    },
  ];

  const completed = steps.filter((step) => step.done).length;
  const isComplete = completed === steps.length;

  /**
   * Finishing is recorded, not merely detected.
   *
   * `hasLoggedSleep` is true for *today*, so it falls back to false at midnight. Without
   * this the guide would return every morning for the rest of the user's life, which is the
   * opposite of what a first-run card is.
   */
  useEffect(() => {
    if (user === null || isDismissed !== false || !isComplete) return;

    writeCache(user.id, DISMISSED_RESOURCE, true);
    setIsDismissed(true);
  }, [user, isDismissed, isComplete]);

  async function dismiss() {
    setIsDismissed(true);
    if (user !== null) await writeCache(user.id, DISMISSED_RESOURCE, true);
  }

  // The dismissal is also the escape hatch for the node step, which someone without the
  // hardware can never complete. A card that cannot be finished must be closeable.
  if (isDismissed !== false || isComplete) return null;

  return (
    <Animated.View entering={FadeInUp.duration(400)} style={styles.card}>
      <View style={styles.head}>
        <View style={styles.headText}>
          <Text style={Type.eyebrow}>Getting started</Text>
          <Text style={Type.cardTitle}>Getting AuraFlow to know you</Text>
        </View>
        <Pressable
          onPress={dismiss}
          accessibilityRole="button"
          accessibilityLabel="Hide the getting started card"
          hitSlop={12}>
          <Feather name="x" size={16} color={AuraColors.content.muted} />
        </Pressable>
      </View>

      <View style={styles.progress}>
        <View style={styles.track}>
          {steps.map((step) => (
            <View
              key={step.title}
              style={[styles.segment, step.done && styles.segmentDone]}
            />
          ))}
        </View>
        <Text style={Type.caption}>
          {completed} of {steps.length}
        </Text>
      </View>

      <View style={styles.steps}>
        {steps.map((step) => (
          <View key={step.title} style={styles.step}>
            <View style={[styles.bullet, step.done && styles.bulletDone]}>
              {step.done ? (
                <Feather name="check" size={12} color={IconTones.success.color} />
              ) : null}
            </View>

            <View style={styles.stepText}>
              <Text style={[styles.stepTitle, step.done && styles.stepTitleDone]}>
                {step.title}
              </Text>
              {/* The payoff goes once the step is done: a finished step is a tick, not a pitch. */}
              {step.done ? null : <Text style={Type.caption}>{step.payoff}</Text>}
            </View>

            {step.done ? null : (
              <Pressable
                onPress={() => router.push(step.href)}
                accessibilityRole="button"
                accessibilityLabel={`${step.action} — ${step.title}`}
                hitSlop={8}
                style={styles.action}>
                <Text style={styles.actionLabel}>{step.action}</Text>
                <Feather name="chevron-right" size={13} color={AuraColors.brand.default} />
              </Pressable>
            )}
          </View>
        ))}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: { ...Surfaces.card, gap: 14 },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  headText: { flex: 1, gap: 4 },
  progress: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  track: { flex: 1, flexDirection: 'row', gap: 4 },
  segment: {
    flex: 1,
    height: 4,
    borderRadius: Radius.pill,
    backgroundColor: AuraColors.surface.selected,
  },
  segmentDone: { backgroundColor: AuraColors.brand.default },
  steps: { gap: 12 },
  step: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  bullet: {
    width: 20,
    height: 20,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: AuraColors.surface.selected,
  },
  bulletDone: { backgroundColor: IconTones.success.bg },
  stepText: { flex: 1, gap: 2 },
  stepTitle: { fontFamily: Font.semibold, fontSize: 13, color: AuraColors.content.default },
  stepTitleDone: { color: AuraColors.content.muted },
  action: { flexDirection: 'row', alignItems: 'center', gap: 1 },
  actionLabel: { fontFamily: Font.semibold, fontSize: 12, color: AuraColors.brand.default },
});
