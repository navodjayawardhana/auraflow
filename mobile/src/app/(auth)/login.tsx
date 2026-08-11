import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';

import { useAuth } from '@/context/auth-context';
import { ApiError } from '@/services/api-client';

export default function LoginScreen() {
  const { signIn } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const canSubmit = email.trim().length > 0 && password.length > 0 && !isSubmitting;

  async function handleSubmit() {
    if (!canSubmit) return;

    setError(null);
    setIsSubmitting(true);

    try {
      await signIn(email.trim(), password);
      // No navigation here: the auth gate reacts to the user appearing. Routing from
      // two places would race.
    } catch (caught) {
      // The API deliberately does not reveal whether the address exists, so neither can
      // this screen. Showing its message verbatim keeps that property.
      setError(
        caught instanceof ApiError
          ? (caught.fieldError('email') ?? caught.message)
          : 'Something went wrong. Please try again.',
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-surface"
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerClassName="grow justify-center p-four gap-two"
        keyboardShouldPersistTaps="handled"
      >
        <Text className="text-4xl font-bold text-content">AuraFlow</Text>
        <Text className="mb-four text-base text-content-muted">
          Work with your body, not against it.
        </Text>

        <View className="gap-two">
          <Text className="text-sm font-semibold text-content" nativeID="email-label">
            Email
          </Text>
          <TextInput
            className="h-touch rounded-xl border border-surface-selected px-three text-base text-content"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            textContentType="emailAddress"
            editable={!isSubmitting}
            accessibilityLabelledBy="email-label"
            testID="login-email"
          />

          <Text className="text-sm font-semibold text-content" nativeID="password-label">
            Password
          </Text>
          <TextInput
            className="h-touch rounded-xl border border-surface-selected px-three text-base text-content"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete="current-password"
            textContentType="password"
            editable={!isSubmitting}
            onSubmitEditing={handleSubmit}
            accessibilityLabelledBy="password-label"
            testID="login-password"
          />

          {error ? (
            <Text className="text-sm text-danger" accessibilityRole="alert" testID="login-error">
              {error}
            </Text>
          ) : null}

          <Pressable
            className={`mt-three h-touch items-center justify-center rounded-xl bg-brand ${
              canSubmit ? '' : 'opacity-50'
            }`}
            onPress={handleSubmit}
            disabled={!canSubmit}
            accessibilityRole="button"
            accessibilityState={{ disabled: !canSubmit, busy: isSubmitting }}
            testID="login-submit"
          >
            {isSubmitting ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <Text className="text-base font-semibold text-white">Sign in</Text>
            )}
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
