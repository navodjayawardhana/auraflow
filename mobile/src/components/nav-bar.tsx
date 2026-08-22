import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GradientAxis, Layout, Radius, Shadows, Type } from '@/constants/design';
import { AuraColors, IconTones } from '@/constants/theme';

export const NAV_HEIGHT = 66;
const PLUS_SIZE = 56;
const SLOT_WIDTH = 62;

export interface NavItem {
  key: string;
  label: string;
  icon: keyof typeof Feather.glyphMap;
}

function Slot({ item, isActive, onPress }: { item: NavItem; isActive: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityState={{ selected: isActive }}
      accessibilityLabel={item.label}
      hitSlop={{ top: 10, bottom: 10 }}
      style={styles.slot}>
      {/* Only the pill and the two colours change. Scaling the icon or swapping to a
          filled variant would give the state two signals competing to say one thing. */}
      <View style={[styles.iconFrame, isActive && styles.iconFrameActive]}>
        <Feather
          name={item.icon}
          size={19}
          color={isActive ? AuraColors.brand.default : '#94a3b8'}
        />
      </View>
      <Text style={isActive ? Type.navActive : Type.navInactive}>{item.label}</Text>
    </Pressable>
  );
}

interface NavBarProps {
  items: NavItem[];
  activeKey: string;
  onSelect: (key: string) => void;
  isSheetOpen: boolean;
  onTogglePlus: () => void;
}

/**
 * A floating bar with a raised action button.
 *
 * The ＋ is a sibling of the bar rather than a child with a negative margin: on Android a
 * child that overflows its parent is clipped whatever `overflow` says, and an `elevation`
 * shadow never renders outside parent bounds. Positioning it in the same absolute layer
 * and giving it a higher elevation — which is also Android's z-order — is what makes it
 * sit above the bar rather than behind it.
 */
export function NavBar({ items, activeKey, onSelect, isSheetOpen, onTogglePlus }: NavBarProps) {
  const insets = useSafeAreaInsets();
  const bottom = Math.max(insets.bottom + 4, 22);

  const open = useSharedValue(0);

  // In an effect rather than at render: Reanimated's strict mode warns about writing to a
  // shared value while React is rendering, and it is right to — a render can be discarded
  // or replayed, and the animation would run for one that never reached the screen.
  useEffect(() => {
    open.value = withTiming(isSheetOpen ? 1 : 0, { duration: 200 });
  }, [isSheetOpen, open]);

  const plusStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${interpolate(open.value, [0, 1], [0, 45])}deg` }],
  }));

  const closedStyle = useAnimatedStyle(() => ({ opacity: 1 - open.value }));

  // Split so the middle slot can be an empty spacer the ＋ sits over.
  const left = items.slice(0, 2);
  const right = items.slice(2);

  return (
    <>
      <View style={[styles.bar, { bottom }]}>
        {left.map((item) => (
          <Slot
            key={item.key}
            item={item}
            isActive={item.key === activeKey}
            onPress={() => onSelect(item.key)}
          />
        ))}

        {/* Keeps space-between honest; the ＋ is drawn in its own layer. */}
        <View style={styles.spacer} />

        {right.map((item) => (
          <Slot
            key={item.key}
            item={item}
            isActive={item.key === activeKey}
            onPress={() => onSelect(item.key)}
          />
        ))}
      </View>

      <Pressable
        onPress={onTogglePlus}
        accessibilityRole="button"
        accessibilityLabel={isSheetOpen ? 'Close quick actions' : 'Open quick actions'}
        accessibilityState={{ expanded: isSheetOpen }}
        style={[styles.plus, { bottom: bottom + NAV_HEIGHT - 26 }]}>
        <Animated.View style={[StyleSheet.absoluteFill, styles.plusFace, closedStyle]}>
          <LinearGradient
            colors={[AuraColors.brand.default, AuraColors.accent.default]}
            start={GradientAxis.deg135.start}
            end={GradientAxis.deg135.end}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>

        <View style={[StyleSheet.absoluteFill, styles.plusFace, styles.plusOpen]} />

        <Animated.View style={plusStyle}>
          <Feather name="plus" size={24} color="#ffffff" />
        </Animated.View>
      </Pressable>
    </>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    left: Layout.navInset,
    right: Layout.navInset,
    height: NAV_HEIGHT,
    backgroundColor: AuraColors.surface.default,
    borderRadius: Radius.nav,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    ...Shadows.nav,
  },
  slot: { width: SLOT_WIDTH, alignItems: 'center', gap: 3 },
  spacer: { width: SLOT_WIDTH },
  iconFrame: {
    width: 38,
    height: 26,
    borderRadius: Radius.navPill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconFrameActive: { backgroundColor: IconTones.brand.bg },
  plus: {
    position: 'absolute',
    alignSelf: 'center',
    width: PLUS_SIZE,
    height: PLUS_SIZE,
    borderRadius: Radius.plus,
    alignItems: 'center',
    justifyContent: 'center',
    ...Shadows.plus,
  },
  plusFace: { borderRadius: Radius.plus, overflow: 'hidden' },
  // Sits beneath the gradient face and shows through as it fades on open.
  plusOpen: { backgroundColor: AuraColors.content.default, zIndex: -1 },
});
