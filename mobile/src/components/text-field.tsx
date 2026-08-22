import { Feather } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { PlaceholderColor, Type } from '@/constants/design';
import { AuraColors, IconTones } from '@/constants/theme';

interface TextFieldProps extends TextInputProps {
  label: string;
  error?: string;
  isPassword?: boolean;
  icon?: keyof typeof Feather.glyphMap;
  tone?: keyof typeof IconTones;
}

export function TextField({
  label,
  error,
  isPassword,
  icon,
  tone = 'brand',
  onFocus,
  onBlur,
  ...inputProps
}: TextFieldProps) {
  const [isRevealed, setIsRevealed] = useState(false);
  const focus = useSharedValue(0);

  const borderStyle = useAnimatedStyle(() => ({
    borderColor: error
      ? AuraColors.danger
      : interpolateColor(
          focus.value,
          [0, 1],
          [AuraColors.surface.selected, AuraColors.brand.default],
        ),
  }));

  // The canvas draws a 4px spread ring, which React Native has no equivalent for. A
  // padded outer View fading its own background is the substitute — and it animates
  // opacity rather than padding, because animating layout would shift the field 4px on
  // every focus.
  const ringStyle = useAnimatedStyle(() => ({ opacity: focus.value * 0.14 }));

  const badge = IconTones[tone];

  return (
    <View style={styles.wrap}>
      <Text style={Type.fieldLabel}>{label}</Text>

      <View style={styles.ringWrap}>
        <Animated.View
          style={[styles.ring, ringStyle, { backgroundColor: AuraColors.brand.default }]}
          pointerEvents="none"
        />

        <Animated.View style={[styles.field, borderStyle]}>
          {icon ? (
            <View style={[styles.icon, { backgroundColor: badge.bg }]}>
              <Feather name={icon} size={16} color={badge.color} />
            </View>
          ) : null}

          <TextInput
            style={styles.input}
            placeholderTextColor={PlaceholderColor}
            secureTextEntry={isPassword && !isRevealed}
            onFocus={(e) => {
              focus.value = withTiming(1, { duration: 150 });
              onFocus?.(e);
            }}
            onBlur={(e) => {
              focus.value = withTiming(0, { duration: 150 });
              onBlur?.(e);
            }}
            {...inputProps}
          />

          {isPassword ? (
            <Pressable
              onPress={() => setIsRevealed((v) => !v)}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={isRevealed ? 'Hide password' : 'Show password'}
              style={styles.reveal}>
              <Feather
                name={isRevealed ? 'eye-off' : 'eye'}
                size={18}
                color={AuraColors.content.muted}
              />
            </Pressable>
          ) : null}
        </Animated.View>
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 7 },
  ringWrap: { position: 'relative' },
  ring: { position: 'absolute', top: -4, left: -4, right: -4, bottom: -4, borderRadius: 999 },
  field: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingLeft: 8,
    paddingRight: 16,
    borderRadius: 999,
    borderWidth: 1,
    backgroundColor: AuraColors.surface.default,
  },
  icon: { width: 36, height: 36, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  input: { flex: 1, ...Type.input },
  reveal: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  error: { ...Type.caption, color: AuraColors.danger },
});
