import { Feather } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInUp } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DevicePicker } from '@/components/device-picker';
import { LampControl } from '@/components/lamp-control';
import { LiveBiometricsCard } from '@/components/live-biometrics-card';
import { Font, Layout, Surfaces, Type } from '@/constants/design';
import { AuraColors } from '@/constants/theme';
import { useBle } from '@/context/ble-context';
import { useIot } from '@/context/iot-context';
import { useLiveVitals } from '@/hooks/use-live-vitals';

function formatUptime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

/** Below -80 dBm the node's own display already warns about the link. */
function signalLabel(rssi: number): string {
  if (rssi >= -60) return 'strong';
  if (rssi >= -75) return 'fair';
  return 'weak';
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.diagnosticRow}>
      <Text style={styles.diagnosticLabel}>{label}</Text>
      <Text style={styles.diagnosticValue}>{value}</Text>
    </View>
  );
}

export default function DeviceScreen() {
  const insets = useSafeAreaInsets();
  const { device, selectedDeviceId, forgetDevice } = useIot();
  const ble = useBle();
  const { isNodeReachable, isConnecting, source, hasNode } = useLiveVitals();
  const [isPairing, setIsPairing] = useState(false);

  const showPicker = !hasNode || isPairing;

  /**
   * The one place the transport is named rather than merged away.
   *
   * `useLiveVitals` exists so no screen has to care which radio delivered a number, and
   * none of them do — but "no reading" has a different fix depending on which path was
   * meant to carry it, and this is the screen someone opens to find that out.
   */
  const overBluetooth = source === 'ble';

  async function forget() {
    // Both, or the node is only half forgotten: dropping the broker pairing while a BLE
    // link stayed up would leave readings arriving from a device the user just removed.
    await ble.disconnect();
    await forgetDevice();
  }

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 14 }]}
        showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <View style={styles.headerText}>
            <Text style={Type.screenTitle}>Device</Text>
            <Text style={Type.meta}>
              {overBluetooth
                ? `${selectedDeviceId ?? 'Nearby node'} · over Bluetooth`
                : (selectedDeviceId ?? 'No node connected')}
            </Text>
          </View>

          {hasNode ? (
            <View style={styles.pill}>
              <View
                style={[
                  styles.pillDot,
                  {
                    backgroundColor: isNodeReachable
                      ? AuraColors.success
                      : AuraColors.content.muted,
                  },
                ]}
              />
              <Text style={styles.pillLabel}>
                {isNodeReachable ? 'Connected' : isConnecting ? 'Connecting' : 'Offline'}
              </Text>
              <Feather
                name={ble.isConnected ? 'bluetooth' : 'wifi'}
                size={12}
                color={AuraColors.content.muted}
              />
            </View>
          ) : null}
        </View>

        {showPicker ? (
          <>
            <DevicePicker />
            {hasNode ? (
              <Pressable
                onPress={() => setIsPairing(false)}
                accessibilityRole="button"
                style={styles.textAction}>
                <Text style={styles.textActionLabel}>Done</Text>
              </Pressable>
            ) : null}
          </>
        ) : (
          <>
            <Animated.View entering={FadeInUp.duration(400)}>
              <LiveBiometricsCard />
            </Animated.View>

            <Animated.View entering={FadeInUp.delay(80).duration(400)}>
              <LampControl />
            </Animated.View>

            <Animated.View entering={FadeInUp.delay(160).duration(400)} style={styles.card}>
              <View style={styles.diagnosticHead}>
                <Feather name="cpu" size={15} color={AuraColors.content.muted} />
                <Text style={styles.diagnosticTitle}>Diagnostics</Text>
              </View>

              {device ? (
                <>
                  <Row
                    label="Wi-Fi signal"
                    value={`${device.rssi} dBm (${signalLabel(device.rssi)})`}
                  />
                  <Row label="Local address" value={device.ip} />
                  <Row label="Uptime" value={formatUptime(device.uptime_s)} />
                  <Row label="Free memory" value={`${Math.round(device.heap_free_b / 1024)} KB`} />
                  <Row
                    label="Pulse sensor"
                    value={device.pulse_sensor ? 'detected' : 'not detected'}
                  />
                  {device.sensor_die_temp_c !== undefined ? (
                    <Row label="Sensor temperature" value={`${device.sensor_die_temp_c} °C`} />
                  ) : null}
                </>
              ) : (
                // The node reports its health every 30 s, so this is genuinely empty for
                // up to half a minute after connecting. Saying so beats a blank card — and
                // over Bluetooth alone it is empty permanently, because every figure here
                // is a fact about the node's network rather than about the node.
                <Text style={Type.caption}>
                  {overBluetooth
                    ? 'Diagnostics travel over Wi-Fi, so they are unavailable on a Bluetooth-only link. The reading above is not.'
                    : "Waiting for the node's next health report — it sends one every 30 seconds."}
                </Text>
              )}
            </Animated.View>

            <View style={styles.actions}>
              <Pressable
                onPress={() => setIsPairing(true)}
                accessibilityRole="button"
                accessibilityLabel="Connect a different node"
                style={styles.action}>
                <Feather name="refresh-cw" size={14} color={AuraColors.brand.default} />
                <Text style={styles.actionLabel}>Change node</Text>
              </Pressable>

              <Pressable
                onPress={forget}
                accessibilityRole="button"
                accessibilityLabel="Forget this node"
                style={styles.action}>
                <Feather name="x-circle" size={14} color={AuraColors.content.muted} />
                <Text style={[styles.actionLabel, styles.actionMuted]}>Forget</Text>
              </Pressable>
            </View>
          </>
        )}
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
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 4 },
  headerText: { flex: 1, gap: 4 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: '#f1f5f9',
  },
  pillDot: { width: 7, height: 7, borderRadius: 999 },
  pillLabel: { fontFamily: Font.semibold, fontSize: 11, color: AuraColors.content.muted },
  card: { ...Surfaces.card, gap: 11 },
  diagnosticHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  diagnosticTitle: { fontFamily: Font.semibold, fontSize: 13, color: AuraColors.content.default },
  diagnosticRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  diagnosticLabel: { fontFamily: Font.regular, fontSize: 12, color: AuraColors.content.muted },
  diagnosticValue: {
    fontFamily: Font.semibold,
    fontSize: 12,
    color: AuraColors.content.default,
    fontVariant: ['tabular-nums'],
  },
  actions: { flexDirection: 'row', justifyContent: 'center', gap: 24 },
  action: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44 },
  actionLabel: { fontFamily: Font.semibold, fontSize: 13, color: AuraColors.brand.default },
  actionMuted: { color: AuraColors.content.muted },
  textAction: { alignSelf: 'center', minHeight: 44, justifyContent: 'center' },
  textActionLabel: { fontFamily: Font.semibold, fontSize: 14, color: AuraColors.brand.default },
});
