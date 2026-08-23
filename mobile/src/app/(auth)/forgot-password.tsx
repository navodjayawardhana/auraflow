import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Link, useRouter } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { HeroCurve } from '@/components/hero-curve';
import { HeroDecoration } from '@/components/hero-decoration';
import { LogoMark } from '@/components/logo-mark';
import { PrimaryButton } from '@/components/primary-button';
import { TextField } from '@/components/text-field';
import { Font, GradientAxis, Gradients, Layout, Type } from '@/constants/design';
import { AuraColors } from '@/constants/theme';
import { ApiError } from '@/services/api-client';
import { requestPasswordReset } from '@/services/auth-service';
import { RESET_CODE_TTL_MINUTES, rememberPendingReset } from '@/services/pending-reset';

/** One field, so the hero can take the space the sign-up form needs for four. */
const HERO_HEIGHT = 268;

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [email, setEmail] = useState('');
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit() {
    setFieldError(undefined);
    setFormError(null);
    setIsSubmitting(true);

    try {
      await requestPasswordReset({ email: email.trim() });

      // Written before navigating, so the marker exists even if the OS reclaims the app
      // while the person is reading their mail on the very next screen.
      await rememberPendingReset(email.trim());

      // `replace`, not `push`. Going back to this screen from the code screen would offer
      // a second "send code" button that quietly invalidates the code they are holding.
      // "Send a new code" lives on the next screen instead, where it says what it does.
      router.replace({ pathname: '/(auth)/reset-password', params: { email: email.trim() } });
    } catch (error) {
      if (error instanceof ApiError && error.isValidation) {
        // A 429 arrives here too — the API reports its throttle as a field error on
        // `email`, exactly as the login route does, so there is no separate branch.
        setFieldError(error.fieldError('email'));
      } else if (error instanceof ApiError) {
        setFormError(error.message);
      } else {
        setFormError('Something went wrong.');
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <View style={styles.screen}>
      <LinearGradient
        colors={Gradients.hero}
        locations={[0, 0.46, 1]}
        start={GradientAxis.deg158.start}
        end={GradientAxis.deg158.end}
        style={styles.hero}>
        <HeroDecoration height={HERO_HEIGHT} />

        <View style={[styles.heroContent, { paddingTop: insets.top + 24 }]}>
          <View style={styles.lockup}>
            <LogoMark size={38} color="#ffffff" />
            <Text style={styles.wordmarkText}>
              Aura<Text style={styles.wordmarkFlow}>Flow</Text>
            </Text>
          </View>

          <View style={styles.welcome}>
            <Text style={styles.headline}>Forgot your password?</Text>
            <Text style={styles.subtitle}>
              Tell us your email address and we&apos;ll send you a {RESET_CODE_TTL_MINUTES}-minute
              code to get back in.
            </Text>
          </View>
        </View>

        <HeroCurve />
      </LinearGradient>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.form}
          showsVerticalScrollIndicator={false}>
          {formError ? <Text style={styles.error}>{formError}</Text> : null}

          <TextField
            label="Email"
            placeholder="you@example.com"
            value={email}
            onChangeText={setEmail}
            error={fieldError}
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
            autoFocus
            icon="mail"
            tone="brand"
            onSubmitEditing={email ? handleSubmit : undefined}
            returnKeyType="send"
          />

          <View style={styles.submit}>
            <PrimaryButton
              // The label carries the progress. The button shows a spinner while the
              // request is in flight, and a person who has just tapped "send" wants to
              // know a mail is being sent, not read the word "loading".
              label={isSubmitting ? 'Sending your code…' : 'Send me a code'}
              onPress={handleSubmit}
              loading={isSubmitting}
              disabled={!email}
            />
          </View>

          {/*
            The hedge is deliberate and it is the same one the server gives back. Telling
            somebody "no account uses that address" would turn this form into a free
            membership list, so the app must not promise a mail is coming either.
          */}
          <View style={styles.privacy}>
            <Feather name="shield" size={13} color={AuraColors.content.muted} />
            <Text style={[Type.caption, styles.privacyText]}>
              If the address is registered, a code is on its way. We never say whether it is.
            </Text>
          </View>

          <Text style={styles.switchLine}>
            Remembered it?{' '}
            <Link href="/(auth)/login" style={styles.switchLink}>
              Back to sign in
            </Link>
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: AuraColors.surface.default },
  flex: { flex: 1 },
  hero: { height: HERO_HEIGHT, overflow: 'hidden' },
  heroContent: { paddingHorizontal: Layout.gutter, gap: 20 },
  lockup: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  wordmarkText: {
    fontFamily: Font.bold,
    fontSize: 22,
    letterSpacing: -0.5,
    color: '#ffffff',
  },
  wordmarkFlow: { fontFamily: Font.regular, color: '#7ef9ff' },
  welcome: { gap: 8 },
  headline: {
    fontFamily: Font.bold,
    fontSize: 28,
    lineHeight: 32,
    letterSpacing: -0.7,
    color: '#ffffff',
  },
  subtitle: {
    fontFamily: Font.regular,
    fontSize: 14,
    lineHeight: 21,
    color: 'rgba(255,255,255,0.76)',
    maxWidth: 280,
  },
  form: { paddingHorizontal: Layout.gutter, paddingTop: 22, paddingBottom: 40, gap: 16 },
  submit: { marginTop: 4 },
  privacy: { flexDirection: 'row', alignItems: 'flex-start', gap: 7, paddingHorizontal: 4 },
  privacyText: { flex: 1 },
  switchLine: {
    fontFamily: Font.regular,
    fontSize: 14,
    textAlign: 'center',
    color: AuraColors.content.muted,
  },
  switchLink: { fontFamily: Font.semibold, color: AuraColors.brand.default },
  error: { ...Type.caption, color: AuraColors.danger, textAlign: 'center' },
});
