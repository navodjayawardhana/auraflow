import { Feather } from '@expo/vector-icons';
import { useEffect, type ReactNode } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
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
import { useBle, type BleReadiness } from '@/context/ble-context';
import { useIot } from '@/context/iot-context';

/**
 * One node, at two ranges.
 *
 * Bluetooth and the broker are not two kinds of device, they are two distances to the same
 * one: *nearby* is a radio in this room and needs no network at all, *remote* is a node
 * announcing itself on a retained status topic from anywhere both ends are online. Shown
 * as two sections of one list rather than two screens, because the question a person is
 * asking — "which node am I using?" — does not change between them.
 *
 * Both halves are real discovery. Neither is a configured list.
 */

function ScanningPulse({ isActive }: { isActive: boolean }) {
  const scale = useSharedValue(1);
  const opacity = useSharedValue(0);

  useEffect(() => {
    if (!isActive) {
      // Stopped rather than merely hidden: an off-screen animation still drives the UI
      // thread, and this one runs on a screen people leave open.
      scale.value = withTiming(1, { duration: 200 });
      opacity.value = withTiming(0, { duration: 200 });
      return;
    }

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
  }, [isActive, scale, opacity]);

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

function NodeRow({
  title,
  subtitle,
  icon,
  isOnline,
  isSelected,
  selectedLabel,
  onConnect,
}: {
  title: string;
  subtitle: string;
  icon: keyof typeof Feather.glyphMap;
  isOnline: boolean;
  isSelected: boolean;
  selectedLabel: string;
  onConnect: () => void;
}) {
  return (
    <Pressable
      onPress={onConnect}
      accessibilityRole="button"
      accessibilityState={{ selected: isSelected }}
      accessibilityLabel={`${title}, ${subtitle}${isSelected ? `, ${selectedLabel.toLowerCase()}` : ''}`}
      style={[styles.row, isSelected && styles.rowSelected]}>
      <View
        style={[
          styles.rowIcon,
          { backgroundColor: isOnline ? '#0052ff1a' : AuraColors.surface.raised },
        ]}>
        <Feather
          name={icon}
          size={18}
          color={isOnline ? AuraColors.brand.default : AuraColors.content.muted}
        />
      </View>

      <View style={styles.rowText}>
        <Text style={Type.rowTitle}>{title}</Text>
        <View style={styles.statusLine}>
          <View
            style={[
              styles.dot,
              { backgroundColor: isOnline ? AuraColors.success : AuraColors.content.muted },
            ]}
          />
          <Text style={Type.caption}>{subtitle}</Text>
        </View>
      </View>

      {isSelected ? (
        <View style={styles.statusLine}>
          <Feather name="check-circle" size={15} color={AuraColors.brand.default} />
          <Text style={styles.action}>{selectedLabel}</Text>
        </View>
      ) : (
        <Text style={styles.action}>Connect</Text>
      )}
    </Pressable>
  );
}

function SectionHead({
  icon,
  title,
  hint,
  trailing,
}: {
  icon: keyof typeof Feather.glyphMap;
  title: string;
  hint: string;
  trailing?: ReactNode;
}) {
  return (
    <View style={styles.sectionHead}>
      <Feather name={icon} size={14} color={AuraColors.content.muted} />
      <View style={styles.sectionText}>
        <Text style={styles.sectionTitle}>{title}</Text>
        <Text style={styles.sectionHint}>{hint}</Text>
      </View>
      {trailing}
    </View>
  );
}

/**
 * What the radio has to say for itself, and what a person can do about it.
 *
 * Every branch ends in either an action or a reason there is none — a state that only
 * describes a failure leaves someone tapping a button that was never going to work.
 */
function radioMessage(readiness: BleReadiness): { text: string; action: 'scan' | 'settings' | null } {
  switch (readiness) {
    case 'off':
      return {
        text: 'Bluetooth is switched off on this phone. Turn it on, then scan again.',
        action: 'scan',
      };
    case 'permission-denied':
      return {
        text: 'AuraFlow needs Bluetooth permission to see what is in the room. Nothing about your location is collected or stored.',
        action: 'scan',
      };
    case 'permission-blocked':
      return {
        text: 'Bluetooth permission is turned off for AuraFlow, and Android will not ask again from here.',
        action: 'settings',
      };
    case 'unsupported':
      return {
        text: "This phone's Bluetooth does not support Low Energy, so nearby pairing is not possible on it. The node is still reachable over Wi-Fi below.",
        action: null,
      };
    case 'unavailable':
      return {
        // The single most likely state during development, and the one whose fix is a
        // different binary rather than a different setting — so it says so plainly rather
        // than reading as a fault with the phone or the node.
        text: 'Bluetooth needs a development build of AuraFlow; this one is running in Expo Go. Everything below still works over Wi-Fi.',
        action: null,
      };
    default:
      return { text: '', action: null };
  }
}

export function DevicePicker() {
  const { discovered, selectedDeviceId, selectDevice, status } = useIot();
  const ble = useBle();
  const { checkReadiness, stopScan } = ble;

  // Asked once on open so the nearby section can say what it is before anyone taps. It
  // prompts for nothing — the permission dialog belongs to the Scan button.
  useEffect(() => {
    checkReadiness();
  }, [checkReadiness]);

  useEffect(() => {
    // A scan left running is one of the fastest ways to flatten a battery, and leaving
    // this screen is the clearest possible signal that nobody is watching the results.
    return () => stopScan();
  }, [stopScan]);

  const isScanning = ble.status === 'scanning';
  const canScan = ble.readiness !== 'unsupported' && ble.readiness !== 'unavailable';
  const radio = radioMessage(ble.readiness);

  return (
    <Animated.View entering={FadeInUp.duration(400)} style={styles.card}>
      <View style={styles.head}>
        <ScanningPulse isActive={isScanning} />
        <Text style={Type.cardTitle}>{isScanning ? 'Scanning…' : 'Find your node'}</Text>
        <Text style={[Type.prose, styles.centreText]}>
          Nearby is Bluetooth and needs no network at all. Remote goes through the broker, so
          the node can be in another building. Either way it is the same node.
        </Text>
      </View>

      <View style={styles.section}>
        <SectionHead
          icon="bluetooth"
          title="Nearby"
          hint="Bluetooth · in this room, no internet"
          trailing={
            canScan ? (
              <Pressable
                onPress={() => (isScanning ? ble.stopScan() : ble.startScan())}
                accessibilityRole="button"
                accessibilityLabel={isScanning ? 'Stop scanning' : 'Scan for nearby nodes'}
                style={styles.scanButton}>
                {isScanning ? (
                  <ActivityIndicator size="small" color={AuraColors.brand.default} />
                ) : null}
                <Text style={styles.action}>{isScanning ? 'Stop' : 'Scan'}</Text>
              </Pressable>
            ) : undefined
          }
        />

        {ble.readiness !== 'ready' && ble.readiness !== 'unknown' ? (
          <View style={styles.notice}>
            <Feather name="alert-circle" size={14} color={AuraColors.content.muted} />
            <View style={styles.noticeBody}>
              <Text style={styles.noticeText}>{radio.text}</Text>
              {radio.action === 'settings' ? (
                <Pressable
                  onPress={() => Linking.openSettings()}
                  accessibilityRole="button"
                  style={styles.noticeAction}>
                  <Text style={styles.action}>Open app settings</Text>
                </Pressable>
              ) : null}
              {radio.action === 'scan' ? (
                <Pressable
                  onPress={() => ble.startScan()}
                  accessibilityRole="button"
                  style={styles.noticeAction}>
                  <Text style={styles.action}>Try again</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        ) : null}

        {ble.nearby.map((peripheral) => (
          <NodeRow
            key={peripheral.id}
            title={peripheral.name}
            subtitle={
              ble.connectedId === peripheral.id
                ? 'Paired over Bluetooth'
                : ble.status === 'connecting' || ble.status === 'reconnecting'
                  ? 'Connecting…'
                  : 'In range'
            }
            icon="bluetooth"
            isOnline
            isSelected={ble.connectedId === peripheral.id}
            selectedLabel="Paired"
            onConnect={() => ble.connectTo(peripheral.id)}
          />
        ))}

        {ble.readiness === 'ready' && ble.nearby.length === 0 ? (
          <Text style={styles.sectionEmpty}>
            {isScanning
              ? 'Listening for the heart-rate service the node advertises…'
              : 'Nothing paired yet. Scan with the node powered and within a few metres.'}
          </Text>
        ) : null}

        {ble.error !== null ? <Text style={styles.error}>{ble.error}</Text> : null}
      </View>

      <View style={styles.section}>
        <SectionHead icon="wifi" title="Remote" hint="Broker · anywhere, both ends online" />

        {discovered.map((item) => (
          <NodeRow
            key={item.id}
            title={item.id}
            subtitle={item.isOnline ? 'Online' : 'Last seen offline'}
            icon="cpu"
            isOnline={item.isOnline}
            isSelected={item.id === selectedDeviceId}
            selectedLabel="Connected"
            onConnect={() => selectDevice(item.id)}
          />
        ))}

        {discovered.length === 0 ? (
          <Text style={styles.sectionEmpty}>
            {status === 'error'
              ? "Can't reach the broker — check this phone's internet connection."
              : 'No node has announced itself. Nodes appear here within a second of coming online.'}
          </Text>
        ) : null}
      </View>

      <View style={styles.note}>
        <Feather name="info" size={14} color={AuraColors.content.muted} />
        <Text style={styles.noteText}>
          Pairing nearby is what makes a movement session work in a basement. The remote
          choice is remembered for the lamp and the diagnostics, which travel over Wi-Fi.
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

  section: { gap: 8 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 30 },
  sectionText: { flex: 1 },
  sectionTitle: {
    fontFamily: Font.semibold,
    fontSize: 12,
    letterSpacing: 0.6,
    color: AuraColors.content.default,
  },
  sectionHint: { fontFamily: Font.regular, fontSize: 11, color: AuraColors.content.muted },
  sectionEmpty: {
    fontFamily: Font.regular,
    fontSize: 11,
    lineHeight: 16,
    color: AuraColors.content.muted,
  },
  scanButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    minHeight: 44,
    paddingHorizontal: 6,
    justifyContent: 'center',
  },

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

  notice: { ...Surfaces.panel, flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  noticeBody: { flex: 1, gap: 2 },
  noticeText: {
    fontFamily: Font.regular,
    fontSize: 11,
    lineHeight: 16,
    color: AuraColors.content.muted,
  },
  noticeAction: { minHeight: 44, justifyContent: 'center' },

  error: { ...Type.caption, color: AuraColors.danger },
  note: { ...Surfaces.panel, flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  noteText: {
    flex: 1,
    fontFamily: Font.regular,
    fontSize: 11,
    lineHeight: 16,
    color: AuraColors.content.muted,
  },
});
