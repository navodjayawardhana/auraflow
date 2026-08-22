import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInUp } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/primary-button';
import {
  Font,
  GradientAxis,
  Layout,
  Radius,
  Shadows,
  Surfaces,
  Type,
} from '@/constants/design';
import { AuraColors, IconTones } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import { useContextAwareness } from '@/hooks/use-context-awareness';

function LinkRow({
  icon,
  tone,
  title,
  detail,
  onPress,
}: {
  icon: keyof typeof Feather.glyphMap;
  tone: keyof typeof IconTones;
  title: string;
  detail: string;
  onPress?: () => void;
}) {
  const badge = IconTones[tone];

  return (
    <Pressable
      onPress={onPress}
      disabled={onPress === undefined}
      accessibilityRole={onPress ? 'button' : 'text'}
      accessibilityLabel={`${title}. ${detail}`}
      style={styles.row}>
      <View style={[styles.rowIcon, { backgroundColor: badge.bg }]}>
        <Feather name={icon} size={17} color={badge.color} />
      </View>

      <View style={styles.rowText}>
        <Text style={Type.tileLabel}>{title}</Text>
        <Text style={styles.rowDetail}>{detail}</Text>
      </View>

      {onPress ? <Feather name="chevron-right" size={18} color="#94a3b8" /> : null}
    </Pressable>
  );
}

export default function ProfileScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, signOut, signOutEverywhere } = useAuth();
  const { places } = useContextAwareness();

  const initial = user?.name?.trim().charAt(0).toUpperCase() ?? '?';

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 14 }]}
        showsVerticalScrollIndicator={false}>
        <Animated.View entering={FadeInUp.duration(400)} style={styles.identity}>
          <View style={styles.avatar}>
            <LinearGradient
              colors={[AuraColors.brand.default, AuraColors.accent.default]}
              start={GradientAxis.deg135.start}
              end={GradientAxis.deg135.end}
              style={StyleSheet.absoluteFill}
            />
            <Text style={styles.initial}>{initial}</Text>
          </View>

          <Text style={styles.name}>{user?.name}</Text>
          <Text style={Type.meta}>{user?.email}</Text>
        </Animated.View>

        <Animated.View entering={FadeInUp.delay(80).duration(400)} style={styles.card}>
          <LinkRow
            icon="map-pin"
            tone="brand"
            title="Your places"
            detail={
              places.length === 0
                ? 'None tagged yet — tap to add home or work'
                : `${places.length} tagged · stays on this phone`
            }
            onPress={() => router.push('/places')}
          />
          <LinkRow
            icon="message-circle"
            tone="accent"
            title="Assistant"
            detail="Grounded on your own figures"
            onPress={() => router.push('/assistant')}
          />
          <LinkRow
            icon="shield"
            tone="stage"
            title="Session token"
            detail="Stored in the device keychain, never in plain storage"
          />
        </Animated.View>

        <Animated.View entering={FadeInUp.delay(160).duration(400)} style={styles.card}>
          <Text style={Type.cardTitle}>Your data</Text>
          <Text style={Type.prose}>
            Coordinates and cached figures stay on this device. Signing out clears the cache
            before it clears the token, so nothing readable is left behind.
          </Text>
        </Animated.View>

        <Animated.View entering={FadeInUp.delay(240).duration(400)} style={styles.actions}>
          <PrimaryButton label="Sign out" onPress={signOut} />
          <PrimaryButton
            label="Sign out on all devices"
            variant="danger"
            onPress={signOutEverywhere}
          />
          <Text style={styles.actionNote}>
            Signing out everywhere revokes every token issued to your account.
          </Text>
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
  identity: { alignItems: 'center', gap: 8, paddingVertical: 12 },
  avatar: {
    width: 84,
    height: 84,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    ...Shadows.cta,
  },
  initial: { fontFamily: Font.bold, fontSize: 34, color: '#ffffff' },
  name: {
    fontFamily: Font.bold,
    fontSize: 24,
    letterSpacing: -0.5,
    color: AuraColors.content.default,
  },
  card: { ...Surfaces.card, gap: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44 },
  rowIcon: {
    width: 40,
    height: 40,
    borderRadius: Radius.iconMedium,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: { flex: 1, gap: 2 },
  rowDetail: { fontFamily: Font.regular, fontSize: 13, color: AuraColors.content.default },
  actions: { gap: 12 },
  actionNote: { ...Type.caption, textAlign: 'center' },
});
