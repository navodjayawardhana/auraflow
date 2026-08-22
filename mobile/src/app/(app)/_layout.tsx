import { Tabs, useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { NavBar, type NavItem } from '@/components/nav-bar';
import { QuickActionsSheet, type QuickAction } from '@/components/quick-actions-sheet';
import { AuraColors } from '@/constants/theme';
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
    subtitle: 'Camera counts your reps, gated on today’s recovery',
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
    key: 'night',
    title: 'Log last night',
    subtitle: 'Sleep and resting heart rate',
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

export default function AppLayout() {
  return (
    <IotProvider>
      <AppShell />
    </IotProvider>
  );
}

function AppShell() {
  const router = useRouter();
  const [activeKey, setActiveKey] = useState('index');
  const [isSheetOpen, setIsSheetOpen] = useState(false);

  function select(key: string) {
    setActiveKey(key);
    router.replace(key === 'index' ? '/(app)' : (`/${key}` as never));
  }

  function runAction(key: string) {
    setIsSheetOpen(false);

    const destination =
      key === 'meal' ? '/log-meal' : key === 'night' ? '/log-night' : key === 'water' ? '/meals' : null;

    // The movement session is not built yet; the sheet is where it will live.
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
        <Tabs.Screen name="places" options={{ href: null }} />
        <Tabs.Screen name="assistant" options={{ href: null }} />
      </Tabs>

      <NavBar
        items={TABS}
        activeKey={activeKey}
        onSelect={select}
        isSheetOpen={isSheetOpen}
        onTogglePlus={() => setIsSheetOpen((open) => !open)}
      />

      <QuickActionsSheet
        visible={isSheetOpen}
        actions={ACTIONS}
        onSelect={runAction}
        onClose={() => setIsSheetOpen(false)}
      />
    </View>
  );
}
