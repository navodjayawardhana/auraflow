import { Tabs, useRouter, useSegments } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { NavBar, type NavItem } from '@/components/nav-bar';
import { QuickActionsSheet, type QuickAction } from '@/components/quick-actions-sheet';
import { AuraColors } from '@/constants/theme';
import { BleProvider } from '@/context/ble-context';
import { IotProvider } from '@/context/iot-context';

/**
 * Four tabs are places; the ＋ holds tasks.
 *
 * Six destinations do not fit five slots, and the alternatives — an icon-only bar, or a
 * "More" tab — both hide something the user does often. Splitting on *place versus task*
 * keeps navigation about where you are and puts the things you do behind one button.
 */
const TABS: NavItem[] = [
  { key: 'index', label: 'Today', icon: 'sun' },
  { key: 'insights', label: 'Insights', icon: 'trending-up' },
  { key: 'device', label: 'Device', icon: 'activity' },
  { key: 'profile', label: 'Profile', icon: 'user' },
];

const ACTIONS: QuickAction[] = [
  {
    key: 'move',
    title: 'Movement session',
    subtitle: 'Follow the guide or let the camera count — gated on today’s recovery',
    icon: 'video',
    tone: 'brand',
    isPrimary: true,
    badge: 'AR',
  },
  {
    key: 'meal',
    title: 'Log a meal',
    subtitle: 'Look up a barcode, or enter your own estimate',
    icon: 'coffee',
    tone: 'success',
  },
  {
    key: 'checkin',
    title: 'Morning check-in',
    subtitle: 'A minute on the node for a seated resting rate',
    icon: 'sunrise',
    tone: 'vital',
  },
  {
    key: 'night',
    title: 'Log last night',
    subtitle: 'Sleep, and an overnight resting rate from a wearable',
    icon: 'moon',
    tone: 'stage',
  },
  {
    key: 'water',
    title: 'Nutrition',
    subtitle: 'Today’s meals, macros and water',
    icon: 'droplet',
    tone: 'accent',
  },
];

/**
 * Screens the floating bar must not be drawn over.
 *
 * Two reasons, one outcome. `move` is a full-bleed camera, and the bar and its ＋ would sit
 * on top of the user's own feet — the part of the frame the rep counter depends on seeing.
 * The other three anchor something to the bottom edge themselves: a Save bar on the two
 * logging screens, a composer on the assistant. A floating bar over a Save button is not a
 * navigation aid, it is a hidden control.
 *
 * All four are `href: null` and reached by `router.push`, so they are already places you
 * leave by their own close button rather than by switching tab.
 */
const SCREENS_WITHOUT_NAV_BAR = new Set([
  'move',
  // The guided figure is the full height of the screen and the count sits on the bottom
  // edge, so the bar would cover the same thing it covers over the camera.
  'move-guided',
  'log-night',
  'log-meal',
  // Its Save bar is anchored to the bottom edge like the other two logging screens.
  'morning-checkin',
  'assistant',
]);

export default function AppLayout() {
  return (
    // Nested, not siblings: the Bluetooth provider is the inner one only so that
    // `useLiveVitals` — which merges the two — sits under both. Neither transport reads
    // the other's state.
    <IotProvider>
      <BleProvider>
        <AppShell />
      </BleProvider>
    </IotProvider>
  );
}

function AppShell() {
  const router = useRouter();
  const segments = useSegments();
  const [activeKey, setActiveKey] = useState('index');
  const [isSheetOpen, setIsSheetOpen] = useState(false);

  // Compared as a plain string: expo-router's generated route union is only refreshed when
  // the dev server runs, so narrowing against it here would break the typecheck on any
  // machine that has not started the app since a screen was added.
  const route = (segments as string[])[segments.length - 1] ?? '';
  const hidesNavBar = SCREENS_WITHOUT_NAV_BAR.has(route);

  function select(key: string) {
    setActiveKey(key);
    router.replace(key === 'index' ? '/(app)' : (`/${key}` as never));
  }

  function runAction(key: string) {
    setIsSheetOpen(false);

    const destination =
      key === 'move'
        ? '/move'
        : key === 'meal'
          ? '/log-meal'
          : key === 'checkin'
            ? '/morning-checkin'
            : key === 'night'
              ? '/log-night'
              : key === 'water'
                ? '/meals'
                : null;

    if (destination !== null) router.push(destination as never);
  }

  return (
    <View style={{ flex: 1, backgroundColor: AuraColors.surface.sunken }}>
      <Tabs
        screenOptions={{ headerShown: false }}
        // The bar is drawn by NavBar below; expo-router's own is hidden rather than
        // restyled, because a floating bar with a protruding button cannot be expressed
        // through tabBarStyle without fighting its layout.
        tabBar={() => null}>
        <Tabs.Screen name="index" />
        <Tabs.Screen name="insights" />
        <Tabs.Screen name="device" />
        <Tabs.Screen name="profile" />
        <Tabs.Screen name="meals" options={{ href: null }} />
        <Tabs.Screen name="log-meal" options={{ href: null }} />
        <Tabs.Screen name="log-night" options={{ href: null }} />
        <Tabs.Screen name="morning-checkin" options={{ href: null }} />
        <Tabs.Screen name="places" options={{ href: null }} />
        <Tabs.Screen name="reminders" options={{ href: null }} />
        <Tabs.Screen name="body-profile" options={{ href: null }} />
        <Tabs.Screen name="plan" options={{ href: null }} />
        <Tabs.Screen name="plan-history" options={{ href: null }} />
        <Tabs.Screen name="assistant" options={{ href: null }} />
        <Tabs.Screen name="move" options={{ href: null }} />
        <Tabs.Screen name="move-guided" options={{ href: null }} />
      </Tabs>

      {hidesNavBar ? null : (
        <NavBar
          items={TABS}
          activeKey={activeKey}
          onSelect={select}
          isSheetOpen={isSheetOpen}
          onTogglePlus={() => setIsSheetOpen((open) => !open)}
        />
      )}

      <QuickActionsSheet
        visible={isSheetOpen}
        actions={ACTIONS}
        onSelect={runAction}
        onClose={() => setIsSheetOpen(false)}
      />
    </View>
  );
}
