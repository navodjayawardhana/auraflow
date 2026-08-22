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

/** Shorter than sign-in's hero: this form has four fields to make room for. */
const HERO_HEIGHT = 268;

interface FieldErrors {
  name?: string;
  email?: string;
  password?: string;
}

export default function RegisterScreen() {
  const { signUp } = useAuth();
  const insets = useSafeAreaInsets();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirmation, setPasswordConfirmation] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit() {
    setFieldErrors({});
    setFormError(null);

    if (password !== passwordConfirmation) {
      setFieldErrors({ password: 'Passwords do not match.' });
      return;
    }
    if (password.length < 10) {
      setFieldErrors({ password: 'Password must be at least 10 characters.' });
      return;
    }

    setIsSubmitting(true);

    try {
      await signUp(name, email, password, passwordConfirmation);
    } catch (error) {
      if (error instanceof ApiError && error.isValidation) {
        setFieldErrors({
          name: error.fieldError('name'),
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

        <View style={[styles.heroContent, { paddingTop: insets.top + 24 }]}>
          <View style={styles.lockup}>
            <LogoMark size={38} color="#ffffff" />
            <Text style={styles.wordmarkText}>
              Aura<Text style={styles.wordmarkFlow}>Flow</Text>
            </Text>
          </View>

          <View style={styles.welcome}>
            <Text style={styles.headline}>Create your account</Text>
            <Text style={styles.subtitle}>
              Two nights of sleep data is all it takes to see your first recovery score.
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
            label="Name"
            placeholder="Your name"
            value={name}
            onChangeText={setName}
            error={fieldErrors.name}
            autoComplete="name"
            icon="user"
            tone="brand"
          />

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
            tone="accent"
          />

          <TextField
            label="Password"
            placeholder="At least 10 characters"
            isPassword
            value={password}
            onChangeText={setPassword}
            error={fieldErrors.password}
            autoComplete="password-new"
            icon="lock"
            tone="stage"
          />

          <TextField
            label="Confirm password"
            placeholder="••••••••"
            isPassword
            value={passwordConfirmation}
            onChangeText={setPasswordConfirmation}
            autoComplete="password-new"
            icon="lock"
            tone="stage"
          />

          <View style={styles.submit}>
            <PrimaryButton
              label="Create account"
              onPress={handleSubmit}
              loading={isSubmitting}
              disabled={!name || !email || !password || !passwordConfirmation}
            />
          </View>

          <View style={styles.privacy}>
            <Feather name="shield" size={13} color={AuraColors.content.muted} />
            <Text style={Type.caption}>Your health data is encrypted and private</Text>
          </View>

          <Text style={styles.switchLine}>
            Already have an account?{' '}
            <Link href="/(auth)/login" style={styles.switchLink}>
              Sign in
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
