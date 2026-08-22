import { Feather } from '@expo/vector-icons';
import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  FadeInUp,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { Font, Radius, Surfaces, Type } from '@/constants/design';
import { AuraColors } from '@/constants/theme';
import { useIot } from '@/context/iot-context';
import type { DiscoveredDevice } from '@/types';

function ScanningPulse() {
  const scale = useSharedValue(1);
  const opacity = useSharedValue(0.35);

  useEffect(() => {
    scale.value = withRepeat(
      withSequence(
        withTiming(1.35, { duration: 1200, easing: Easing.out(Easing.quad) }),
        withTiming(1, { duration: 0 }),
      ),
      -1,
    );
    opacity.value = withRepeat(
      withSequence(
        withTiming(0, { duration: 1200, easing: Easing.out(Easing.quad) }),
        withTiming(0.35, { duration: 0 }),
      ),
      -1,
    );
  }, [scale, opacity]);

  const ring = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));

  return (
    <View style={styles.pulseWrap}>
      <Animated.View style={[styles.pulseRing, ring]} pointerEvents="none" />
      <View style={styles.pulseCore}>
        <Feather name="radio" size={22} color={AuraColors.content.inverse} />
      </View>
    </View>
  );
}

function DeviceRow({
  item,
  isSelected,
  onConnect,
}: {
  item: DiscoveredDevice;
  isSelected: boolean;
  onConnect: () => void;
}) {
  return (
    <Pressable
      onPress={onConnect}
      accessibilityRole="button"
      accessibilityState={{ selected: isSelected }}
      accessibilityLabel={`${item.id}, ${item.isOnline ? 'online' : 'offline'}${
        isSelected ? ', connected' : ''
      }`}
      style={[styles.row, isSelected && styles.rowSelected]}>
      <View
        style={[
          styles.rowIcon,
          { backgroundColor: item.isOnline ? '#0052ff1a' : AuraColors.surface.raised },
        ]}>
        <Feather
          name="cpu"
          size={18}
          color={item.isOnline ? AuraColors.brand.default : AuraColors.content.muted}
        />
      </View>

      <View style={styles.rowText}>
        <Text style={Type.rowTitle}>{item.id}</Text>
        <View style={styles.statusLine}>
          <View
            style={[
              styles.dot,
              { backgroundColor: item.isOnline ? AuraColors.success : AuraColors.content.muted },
            ]}
          />
          <Text style={Type.caption}>{item.isOnline ? 'Online' : 'Last seen offline'}</Text>
        </View>
      </View>

      {isSelected ? (
        <View style={styles.statusLine}>
          <Feather name="check-circle" size={15} color={AuraColors.brand.default} />
          <Text style={styles.action}>Connected</Text>
        </View>
      ) : (
        <Text style={styles.action}>Connect</Text>
      )}
    </Pressable>
  );
}

/**
 * Real discovery, not a configured list: every node announces itself on a retained
 * status topic, so this shows what is actually reachable right now.
 */
export function DevicePicker() {
  const { discovered, selectedDeviceId, selectDevice, status } = useIot();

  return (
    <Animated.View entering={FadeInUp.duration(400)} style={styles.card}>
      <View style={styles.head}>
        <ScanningPulse />
        <Text style={Type.cardTitle}>
          {discovered.length === 0 ? 'Looking for your node…' : 'Nearby AuraFlow nodes'}
        </Text>
        <Text style={[Type.prose, styles.centreText]}>
          {discovered.length === 0
            ? 'Power your node and make sure it has Wi-Fi. It announces itself automatically.'
            : 'Pick the node to pair with. Your choice is remembered.'}
        </Text>
      </View>

      {discovered.length > 0 ? (
        <View style={styles.list}>
          {discovered.map((item) => (
            <DeviceRow
              key={item.id}
              item={item}
              isSelected={item.id === selectedDeviceId}
              onConnect={() => selectDevice(item.id)}
            />
          ))}
        </View>
      ) : null}

      {status === 'error' ? (
        <Text style={styles.error}>
          Can&apos;t reach the broker — check this phone&apos;s internet connection.
        </Text>
      ) : null}

      <View style={styles.note}>
        <Feather name="info" size={14} color={AuraColors.content.muted} />
        <Text style={styles.noteText}>
          Nodes are found over Wi-Fi rather than Bluetooth, so your phone and the node do not
          need to be in the same room — only both online.
        </Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: { ...Surfaces.card, gap: 16 },
  head: { alignItems: 'center', gap: 8 },
  centreText: { textAlign: 'center' },

  pulseWrap: { width: 80, height: 80, alignItems: 'center', justifyContent: 'center' },
  pulseRing: {
    position: 'absolute',
    width: 80,
    height: 80,
    borderRadius: Radius.pill,
    backgroundColor: AuraColors.brand.bright,
  },
  pulseCore: {
    width: 56,
    height: 56,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: AuraColors.brand.default,
  },

  list: { gap: 8 },
  row: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: Radius.row,
    backgroundColor: AuraColors.surface.sunken,
  },
  rowSelected: { backgroundColor: '#0052ff14' },
  rowIcon: {
    width: 40,
    height: 40,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: { flex: 1, gap: 3 },
  statusLine: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  dot: { width: 7, height: 7, borderRadius: Radius.pill },
  action: { fontFamily: Font.semibold, fontSize: 13, color: AuraColors.brand.default },

  error: { ...Type.caption, textAlign: 'center', color: AuraColors.danger },
  note: { ...Surfaces.panel, flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  noteText: {
    flex: 1,
    fontFamily: Font.regular,
    fontSize: 11,
    lineHeight: 16,
    color: AuraColors.content.muted,
  },
});
