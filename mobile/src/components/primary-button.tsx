import { LinearGradient } from 'expo-linear-gradient';
import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import { GradientAxis, Shadows, Type } from '@/constants/design';
import { AuraColors } from '@/constants/theme';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

interface PrimaryButtonProps {
  label: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  variant?: 'brand' | 'danger' | 'quiet';
}

export function PrimaryButton({
  label,
  onPress,
  loading = false,
  disabled = false,
  variant = 'brand',
}: PrimaryButtonProps) {
  const isDisabled = disabled || loading;
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <AnimatedPressable
      onPress={onPress}
      onPressIn={() => {
        scale.value = withSpring(0.97, { damping: 16, stiffness: 320 });
      }}
      onPressOut={() => {
        scale.value = withSpring(1, { damping: 16, stiffness: 320 });
      }}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      accessibilityLabel={label}
      style={[
        styles.button,
        variant === 'danger' && styles.danger,
        variant === 'quiet' && styles.quiet,
        isDisabled && styles.disabled,
        animatedStyle,
        // A shadow tinted with the button's own colour, dropped when disabled — a lifted
        // control that cannot be pressed reads as a bug.
        !isDisabled && variant === 'brand' ? Shadows.cta : null,
        !isDisabled && variant === 'danger' ? styles.dangerShadow : null,
      ]}>
      {variant === 'brand' && !isDisabled ? (
        <LinearGradient
          colors={[AuraColors.brand.default, AuraColors.accent.default]}
          start={GradientAxis.deg100.start}
          end={GradientAxis.deg100.end}
          style={StyleSheet.absoluteFill}
        />
      ) : null}

      {loading ? (
        <ActivityIndicator color={variant === 'quiet' ? AuraColors.brand.default : '#ffffff'} />
      ) : (
        <Text style={[Type.button, variant === 'quiet' && styles.quietLabel]}>{label}</Text>
      )}
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  button: {
    height: 52,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    backgroundColor: AuraColors.brand.default,
  },
  danger: { backgroundColor: AuraColors.danger },
  dangerShadow: {
    shadowColor: AuraColors.danger,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.28,
    shadowRadius: 12,
    elevation: 6,
  },
  quiet: {
    backgroundColor: AuraColors.surface.default,
    borderWidth: 1,
    borderColor: AuraColors.surface.selected,
  },
  quietLabel: { color: AuraColors.brand.default },
  disabled: { backgroundColor: '#cbd5e1' },
});
