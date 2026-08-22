import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInUp } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/primary-button';
import { Font, Layout, Radius, Shadows, Surfaces, Type } from '@/constants/design';
import { AuraColors, IconTones } from '@/constants/theme';
import { useContextAwareness } from '@/hooks/use-context-awareness';
import { CONTEXTS, type Context } from '@/ml/focus-features';

const META: Record<Context, { label: string; icon: keyof typeof Feather.glyphMap }> = {
  HOME: { label: 'Home', icon: 'home' },
  'WORK/SCHOOL': { label: 'Work or school', icon: 'briefcase' },
  HOME_OFFICE: { label: 'Home office', icon: 'monitor' },
  GYM: { label: 'Gym', icon: 'activity' },
  OUTDOORS: { label: 'Outdoors', icon: 'sun' },
  TRANSIT: { label: 'Transit', icon: 'navigation' },
  ENTERTAINMENT: { label: 'Out', icon: 'music' },
};

export default function PlacesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { status, coordinates, places, requestPermission, tagCurrentPlace, forgetPlace } =
    useContextAwareness();
  const [saving, setSaving] = useState<Context | null>(null);

  async function tag(context: Context) {
    setSaving(context);
    await tagCurrentPlace(META[context].label, context);
    setSaving(null);
  }

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 14 }]}
        showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <View style={styles.headerText}>
            <Text style={Type.screenTitle}>Your places</Text>
            <Text style={Type.meta}>Tag where you are so AuraFlow can tell work from home</Text>
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

        <Animated.View entering={FadeInUp.duration(400)} style={styles.privacy}>
          <Feather name="shield" size={14} color={AuraColors.content.muted} />
          <Text style={styles.privacyText}>
            Coordinates stay on this phone — they are never sent to the server. AuraFlow only
            reads your position while the app is open, never in the background.
          </Text>
        </Animated.View>

        {status === 'denied' ? (
          <Animated.View entering={FadeInUp.delay(60).duration(400)} style={styles.card}>
            <Text style={Type.cardTitle}>Location is off</Text>
            <Text style={Type.prose}>
              Without it AuraFlow can&apos;t tell where you are, and the focus forecast falls back
              to population averages for that part of its input.
            </Text>
            <PrimaryButton label="Allow location" onPress={requestPermission} />
          </Animated.View>
        ) : null}

        {places.length > 0 ? (
          <Animated.View entering={FadeInUp.delay(80).duration(400)} style={styles.card}>
            <Text style={Type.cardTitle}>Tagged</Text>

            {places.map((place) => (
              <View key={place.id} style={styles.placeRow}>
                <View style={[styles.placeIcon, { backgroundColor: IconTones.brand.bg }]}>
                  <Feather name={META[place.context].icon} size={17} color={IconTones.brand.color} />
                </View>

                <View style={styles.placeText}>
                  <Text style={Type.rowTitle}>{place.label}</Text>
                  <Text style={Type.caption}>within {place.radiusMeters} m</Text>
                </View>

                <Pressable
                  onPress={() => forgetPlace(place.id)}
                  accessibilityRole="button"
                  accessibilityLabel={`Forget ${place.label}`}
                  hitSlop={10}
                  style={styles.forget}>
                  <Feather name="trash-2" size={16} color={AuraColors.content.muted} />
                </Pressable>
              </View>
            ))}
          </Animated.View>
        ) : null}

        <Animated.View entering={FadeInUp.delay(140).duration(400)} style={styles.card}>
          <View style={styles.tagHead}>
            <Text style={Type.cardTitle}>
              {places.length > 0 ? 'Tag somewhere else' : 'Tag where you are now'}
            </Text>
            <Text style={Type.caption}>Stand where you want to tag, then pick what it is.</Text>
          </View>

          <View style={styles.chips}>
            {CONTEXTS.map((context) => {
              const isDisabled = coordinates === null || saving !== null;

              return (
                <Pressable
                  key={context}
                  onPress={() => tag(context)}
                  disabled={isDisabled}
                  accessibilityRole="button"
                  accessibilityLabel={`Tag this location as ${META[context].label}`}
                  style={[styles.chip, isDisabled && styles.chipDisabled]}>
                  <Feather name={META[context].icon} size={14} color={AuraColors.brand.default} />
                  <Text style={styles.chipLabel}>
                    {saving === context ? 'Saving…' : META[context].label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {coordinates === null && status !== 'denied' ? (
            <Text style={Type.caption}>Finding your position…</Text>
          ) : null}
        </Animated.View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: AuraColors.surface.sunken },
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
  privacy: { ...Surfaces.panel, flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  privacyText: {
    flex: 1,
    fontFamily: Font.regular,
    fontSize: 11,
    lineHeight: 16,
    color: AuraColors.content.muted,
  },
  card: { ...Surfaces.card, gap: 14 },
  placeRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  placeIcon: {
    width: 40,
    height: 40,
    borderRadius: Radius.iconMedium,
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeText: { flex: 1, gap: 2 },
  forget: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  tagHead: { gap: 4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    minHeight: 40,
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: AuraColors.surface.sunken,
  },
  chipDisabled: { opacity: 0.45 },
  chipLabel: { fontFamily: Font.semibold, fontSize: 13, color: AuraColors.content.default },
});
