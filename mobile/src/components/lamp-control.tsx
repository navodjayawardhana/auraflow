import { Feather } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Font, Surfaces, Type } from '@/constants/design';
import { AuraColors } from '@/constants/theme';
import { useIot } from '@/context/iot-context';
import type { LightMode } from '@/types';

const MODES: { mode: LightMode; label: string; icon: keyof typeof Feather.glyphMap }[] = [
  { mode: 'off', label: 'Off', icon: 'power' },
  { mode: 'focus', label: 'Focus', icon: 'zap' },
  { mode: 'break', label: 'Break', icon: 'coffee' },
  { mode: 'sleep', label: 'Sleep', icon: 'moon' },
  { mode: 'alert', label: 'Alert', icon: 'bell' },
];

const BRIGHTNESS = [25, 50, 75, 100];

export function LampControl() {
  const { light, setLight, isDeviceOnline } = useIot();

  // Everything reflects the retained state topic rather than local optimism: the node's
  // physical button changes the mode too, and a UI that disagreed with the lamp in the
  // room would be worse than one that lags by a few hundred milliseconds.
  const mode = light?.mode ?? null;
  const brightness = light?.brightness ?? null;

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Text style={Type.cardTitle}>Lamp</Text>
        {light ? (
          <Text style={styles.state}>
            {light.source === 'button'
              ? 'changed on the device'
              : `${light.mode[0].toUpperCase()}${light.mode.slice(1)} · ${light.brightness}%`}
          </Text>
        ) : null}
      </View>

      <View style={styles.chips}>
        {MODES.map(({ mode: value, label, icon }) => {
          const isActive = mode === value;

          return (
            <Pressable
              key={value}
              onPress={() => setLight(value)}
              accessibilityRole="button"
              accessibilityState={{ selected: isActive }}
              accessibilityLabel={`Set lamp to ${label}`}
              style={[styles.chip, isActive && styles.chipActive]}>
              <Feather
                name={icon}
                size={14}
                color={isActive ? '#ffffff' : AuraColors.content.muted}
              />
              <Text style={[styles.chipLabel, isActive && styles.chipLabelActive]}>{label}</Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.brightness}>
        <Text style={Type.tileLabel}>Brightness</Text>
        <View style={styles.brightnessRow}>
          {BRIGHTNESS.map((value) => {
            const isActive = brightness === value;

            return (
              <Pressable
                key={value}
                onPress={() => setLight(mode ?? 'focus', value)}
                accessibilityRole="button"
                accessibilityState={{ selected: isActive }}
                accessibilityLabel={`Set brightness to ${value} percent`}
                style={[styles.level, isActive && styles.levelActive]}>
                <Text style={[styles.levelLabel, isActive && styles.levelLabelActive]}>
                  {value}%
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {mode === 'alert' ? (
        <Text style={styles.momentary}>Alert is momentary — it reverts after a few seconds.</Text>
      ) : null}

      {!isDeviceOnline ? (
        <Text style={Type.caption}>Commands will apply when the node comes back online.</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { ...Surfaces.card, gap: 14 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  state: { fontFamily: Font.regular, fontSize: 11, color: AuraColors.content.muted },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 36,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: AuraColors.surface.sunken,
  },
  chipActive: { backgroundColor: AuraColors.brand.default },
  chipLabel: { fontFamily: Font.semibold, fontSize: 13, color: AuraColors.content.muted },
  chipLabelActive: { color: '#ffffff' },
  brightness: { gap: 8 },
  brightnessRow: { flexDirection: 'row', gap: 8 },
  level: {
    flex: 1,
    minHeight: 40,
    borderRadius: 12,
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  levelActive: { backgroundColor: AuraColors.brand.default },
  levelLabel: { fontFamily: Font.semibold, fontSize: 13, color: AuraColors.content.muted },
  levelLabelActive: { fontFamily: Font.semibold, color: '#ffffff' },
  momentary: { ...Type.caption, color: AuraColors.caution },
});
