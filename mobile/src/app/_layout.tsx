// The mqtt client is a Node library running in a JS engine that has neither of these
// globals. Shimmed here, before anything imports it, because a missing Buffer surfaces
// as an opaque crash inside the library rather than a resolution error.
import { Buffer } from 'buffer';
import process from 'process';

if (typeof global.Buffer === 'undefined') {
  global.Buffer = Buffer;
}
if (typeof global.process === 'undefined') {
  global.process = process;
}

/* The imports below deliberately sit after the shim. Hoisting them would let a module
   that transitively pulls in `mqtt` evaluate before `global.Buffer` exists, which fails
   as an opaque crash inside the library rather than a resolution error. */
/* eslint-disable import/first */
import {
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_800ExtraBold,
} from '@expo-google-fonts/plus-jakarta-sans';
import { DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Stack, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { AuraColors } from '@/constants/theme';
import { AuthProvider, useAuth } from '@/context/auth-context';
import { useReminderRuntime } from '@/hooks/use-reminder-runtime';
import { configureNotificationHandler } from '@/services/notification-service';
/* eslint-enable import/first */

SplashScreen.preventAutoHideAsync();

/**
 * At module scope, alongside the splash call, because a notification arriving before the
 * handler is registered is shown with the platform default rather than the one chosen in
 * `notification-service` — and the one that arrives first is the one delivered during a cold
 * launch, which is exactly the case worth getting right.
 */
configureNotificationHandler();

/**
 * The app is light-only by design. The tokens have no dark variants, so honouring the
 * system scheme would give dark navigation chrome around light screens — a half-built
 * dark mode reads as a defect rather than a feature.
 */
const navigationTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: AuraColors.surface.default,
    card: AuraColors.surface.default,
    text: AuraColors.content.default,
    primary: AuraColors.brand.default,
    border: AuraColors.surface.selected,
  },
};

// The single navigation decision point for the whole app. Screens never call
// router.replace/push to (app) or (auth) root after sign-in/out themselves —
// they just let auth state change and this effect react, so there is never a
// race between two places deciding where the user should be.
function AuthGate({ fontsReady }: { fontsReady: boolean }) {
  const { user, isRestoring } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  // Here rather than in `(app)/_layout` because both halves of it outlive that group: the
  // schedule has to be reconciled on a cold launch that lands on the login screen, and a
  // tapped reminder arrives before any group has mounted.
  useReminderRuntime();

  // One gate, not two: the session restore and the font load both have to finish before
  // anything is worth showing, so they hide the splash together.
  const isReady = fontsReady && !isRestoring;

  useEffect(() => {
    if (isReady) {
      SplashScreen.hideAsync();
    }
  }, [isReady]);

  useEffect(() => {
    if (!isReady) return;

    const inAuthGroup = segments[0] === '(auth)';

    if (!user && !inAuthGroup) {
      router.replace('/(auth)/login');
    } else if (user && inAuthGroup) {
      router.replace('/(app)');
    }
  }, [user, isReady, segments, router]);

  if (!isReady) {
    return (
      <View style={styles.gate}>
        <ActivityIndicator color={AuraColors.brand.default} />
      </View>
    );
  }

  return <Stack screenOptions={{ headerShown: false }} />;
}

const styles = StyleSheet.create({
  gate: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: AuraColors.surface.default,
  },
});

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_800ExtraBold,
  });

  // A failed font load falls back to the system face rather than blocking the app —
  // wrong typography is a smaller problem than a permanent splash screen.
  const fontsReady = fontsLoaded || fontError !== null;

  return (
    <ThemeProvider value={navigationTheme}>
      <AuthProvider>
        <AuthGate fontsReady={fontsReady} />
      </AuthProvider>
    </ThemeProvider>
  );
}
