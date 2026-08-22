import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Link } from 'expo-router';
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
import { useAuth } from '@/context/auth-context';
import { ApiError } from '@/services/api-client';

const HERO_HEIGHT = 372;

export default function LoginScreen() {
  const { signIn } = useAuth();
  const insets = useSafeAreaInsets();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit() {
    setFieldErrors({});
    setFormError(null);
    setIsSubmitting(true);

    try {
      await signIn(email, password);
    } catch (error) {
      if (error instanceof ApiError && error.isValidation) {
        setFieldErrors({
          email: error.fieldError('email'),
          password: error.fieldError('password'),
        });
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

        <View style={[styles.heroContent, { paddingTop: insets.top + 30 }]}>
          <View style={styles.lockup}>
            <LogoMark size={46} color="#ffffff" />
            <View style={styles.wordmark}>
              <Text style={styles.wordmarkText}>
                Aura<Text style={styles.wordmarkFlow}>Flow</Text>
              </Text>
              <Text style={styles.tagline}>WORK WITH YOUR BODY</Text>
            </View>
          </View>

          <View style={styles.welcome}>
            <Text style={styles.headline}>Welcome back</Text>
            <Text style={styles.subtitle}>
              Your recovery score is waiting. Sign in to see how ready your body is today.
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
            error={fieldErrors.email}
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
            icon="mail"
            tone="brand"
          />

          <TextField
            label="Password"
            placeholder="••••••••"
            isPassword
            value={password}
            onChangeText={setPassword}
            error={fieldErrors.password}
            autoComplete="password"
            icon="lock"
            tone="accent"
          />

          <View style={styles.submit}>
            <PrimaryButton
              label="Sign in"
              onPress={handleSubmit}
              loading={isSubmitting}
              disabled={!email || !password}
            />
          </View>

          <View style={styles.privacy}>
            <Feather name="shield" size={13} color={AuraColors.content.muted} />
            <Text style={Type.caption}>Your health data is encrypted and private</Text>
          </View>

          <Text style={styles.switchLine}>
            Don&apos;t have an account?{' '}
            <Link href="/(auth)/register" style={styles.switchLink}>
              Sign up
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
  heroContent: { paddingHorizontal: Layout.gutter, gap: 26 },
  lockup: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  wordmark: { gap: 3 },
  wordmarkText: {
    fontFamily: Font.bold,
    fontSize: 27,
    letterSpacing: -0.5,
    color: '#ffffff',
  },
  wordmarkFlow: { fontFamily: Font.regular, color: '#7ef9ff' },
  tagline: {
    fontFamily: Font.semibold,
    fontSize: 10,
    letterSpacing: 3,
    color: 'rgba(255,255,255,0.6)',
  },
  welcome: { gap: 8 },
  headline: {
    fontFamily: Font.bold,
    fontSize: 30,
    lineHeight: 34.5,
    letterSpacing: -0.7,
    color: '#ffffff',
  },
  subtitle: {
    fontFamily: Font.regular,
    fontSize: 14,
    lineHeight: 21,
    color: 'rgba(255,255,255,0.76)',
    maxWidth: 268,
  },
  form: { paddingHorizontal: Layout.gutter, paddingTop: 22, paddingBottom: 40, gap: 16 },
  submit: { marginTop: 4 },
  privacy: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  switchLine: {
    fontFamily: Font.regular,
    fontSize: 14,
    textAlign: 'center',
    color: AuraColors.content.muted,
  },
  switchLink: { fontFamily: Font.semibold, color: AuraColors.brand.default },
  error: { ...Type.caption, color: AuraColors.danger, textAlign: 'center' },
});
