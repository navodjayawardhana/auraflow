import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Link, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
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
import { requestPasswordReset } from '@/services/auth-service';
import {
  RESET_CODE_TTL_MINUTES,
  readPendingReset,
  rememberPendingReset,
} from '@/services/pending-reset';

/** Three fields plus a resend row, so the hero gives back what the form needs. */
const HERO_HEIGHT = 236;

/** Mirrors ResetCode::LENGTH on the API. */
const CODE_LENGTH = 6;

/**
 * Mirrors NewPasswordRules on the API, which is the authority — this copy only exists so
 * the phone can catch a too-short password without spending one of the five attempts the
 * server allows against the code. It must never be the *only* check, and it must never be
 * laxer: registration is held to exactly the same rule.
 */
const MIN_PASSWORD_LENGTH = 10;

/**
 * Long enough that a double tap cannot burn two of the five requests the API allows in a
 * quarter of an hour, short enough that somebody whose mail genuinely never arrived is
 * not left staring at a dead button.
 */
const RESEND_COOLDOWN_SECONDS = 30;

interface FieldErrors {
  code?: string;
  password?: string;
}

export default function ResetPasswordScreen() {
  const { completePasswordReset } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const params = useLocalSearchParams<{ email?: string }>();

  const [email, setEmail] = useState(params.email ?? '');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirmation, setPasswordConfirmation] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN_SECONDS);

  /**
   * The address survives the app being killed.
   *
   * Reading the code means leaving AuraFlow, and Android is entirely willing to reclaim a
   * backgrounded app while its user is in a mail client. Coming back to a screen that has
   * forgotten which address it was resetting — while holding a code that is still valid —
   * is the single worst place this flow could drop somebody, so the address is recovered
   * from the pending-reset marker rather than trusted to survive in a navigation param.
   *
   * If there is no marker either, the code it would refer to has expired or was never
   * requested, and the honest place to be is the screen with the button that issues one.
   */
  const [isLookingUp, setIsLookingUp] = useState(() => (params.email ?? '') === '');

  useEffect(() => {
    if (!isLookingUp) return;

    let cancelled = false;

    (async () => {
      const remembered = await readPendingReset();
      if (cancelled) return;

      if (remembered === null) {
        router.replace('/(auth)/forgot-password');
        return;
      }

      setEmail(remembered);
      setIsLookingUp(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [isLookingUp, router]);

  // One interval for the whole screen, ticking only while there is something to count.
  useEffect(() => {
    if (cooldown <= 0) return;

    const timer = setInterval(() => setCooldown((seconds) => Math.max(0, seconds - 1)), 1000);

    return () => clearInterval(timer);
  }, [cooldown]);

  async function handleSubmit() {
    setFieldErrors({});
    setFormError(null);
    setNotice(null);

    // Checked here as well as on the server so a mismatched confirmation costs nothing.
    // The API counts every submission against both the per-code attempt bound and the
    // rate limiter, and spending one of five guesses on a typo in a field the phone
    // could have caught would be this screen's fault, not the user's.
    if (password !== passwordConfirmation) {
      setFieldErrors({ password: 'Passwords do not match.' });
      return;
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      setFieldErrors({ password: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` });
      return;
    }

    setIsSubmitting(true);

    try {
      await completePasswordReset(email, code.trim(), password, passwordConfirmation);
      // Nothing to navigate to. The auth state changing is what moves the app, and the
      // root layout is the only place that decides where — see the note on AuthGate.
    } catch (error) {
      if (error instanceof ApiError && error.isValidation) {
        // Expiry, a wrong code, an exhausted code and a throttle all arrive as a message
        // on `code`, phrased by the server so the app never has to guess which happened.
        setFieldErrors({
          code: error.fieldError('code'),
          password: error.fieldError('password') ?? error.fieldError('email'),
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

  /**
   * A new code, without starting the flow over.
   *
   * The previous code stops working the moment the server writes the replacement, so the
   * field is cleared — leaving the old digits sitting there would invite the person to
   * spend one of their five attempts on a code that is already dead.
   */
  async function handleResend() {
    setFieldErrors({});
    setFormError(null);
    setNotice(null);
    setIsResending(true);

    try {
      await requestPasswordReset({ email });
      await rememberPendingReset(email);

      setCode('');
      setCooldown(RESEND_COOLDOWN_SECONDS);
      setNotice('A new code is on its way. The previous one no longer works.');
    } catch (error) {
      if (error instanceof ApiError && error.isValidation) {
        setFormError(error.fieldError('email') ?? error.message);
      } else if (error instanceof ApiError) {
        setFormError(error.message);
      } else {
        setFormError('Something went wrong.');
      }
    } finally {
      setIsResending(false);
    }
  }

  // Held here rather than rendered mid-flight: the screen is about to be replaced by the
  // forgot-password screen or filled in with a recovered address, and flashing an empty
  // form between the two reads as a glitch.
  if (isLookingUp) {
    return (
      <View style={styles.gate}>
        <ActivityIndicator color={AuraColors.brand.default} />
      </View>
    );
  }

  const canResend = cooldown === 0 && !isResending && !isSubmitting;

  return (
    <View style={styles.screen}>
      <LinearGradient
        colors={Gradients.hero}
        locations={[0, 0.46, 1]}
        start={GradientAxis.deg158.start}
        end={GradientAxis.deg158.end}
        style={styles.hero}>
        <HeroDecoration height={HERO_HEIGHT} />

        <View style={[styles.heroContent, { paddingTop: insets.top + 22 }]}>
          <View style={styles.lockup}>
            <LogoMark size={34} color="#ffffff" />
            <Text style={styles.wordmarkText}>
              Aura<Text style={styles.wordmarkFlow}>Flow</Text>
            </Text>
          </View>

          <View style={styles.welcome}>
            <Text style={styles.headline}>Check your email</Text>
            <Text style={styles.subtitle}>
              We sent a {CODE_LENGTH}-digit code to <Text style={styles.address}>{email}</Text>. It
              works for {RESET_CODE_TTL_MINUTES} minutes.
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
          {notice ? <Text style={styles.notice}>{notice}</Text> : null}

          <TextField
            label="Code from your email"
            placeholder="000000"
            value={code}
            onChangeText={setCode}
            error={fieldErrors.code}
            keyboardType="number-pad"
            // The OS offers the code straight from the notification with this set, which
            // is the whole ergonomic argument for a code over a link.
            autoComplete="one-time-code"
            textContentType="oneTimeCode"
            maxLength={CODE_LENGTH}
            autoFocus
            icon="hash"
            tone="brand"
          />

          <TextField
            label="New password"
            placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
            isPassword
            value={password}
            onChangeText={setPassword}
            error={fieldErrors.password}
            autoComplete="password-new"
            icon="lock"
            tone="accent"
          />

          <TextField
            label="Confirm new password"
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
              label={isSubmitting ? 'Setting your password…' : 'Set password and sign in'}
              onPress={handleSubmit}
              loading={isSubmitting}
              disabled={code.length !== CODE_LENGTH || !password || !passwordConfirmation}
            />
          </View>

          {/*
            Always present, never hidden behind an error. Somebody whose mail never
            arrived should not have to guess wrong five times to be offered another one.
          */}
          <Pressable
            onPress={handleResend}
            disabled={!canResend}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityState={{ disabled: !canResend, busy: isResending }}
            accessibilityLabel="Send a new code"
            style={styles.resend}>
            <Feather
              name="refresh-cw"
              size={13}
              color={canResend ? AuraColors.brand.default : AuraColors.content.muted}
            />
            <Text style={[styles.resendLabel, !canResend && styles.resendLabelIdle]}>
              {isResending
                ? 'Sending…'
                : cooldown > 0
                  ? `Send a new code in ${cooldown}s`
                  : 'Send a new code'}
            </Text>
          </Pressable>

          <View style={styles.privacy}>
            <Feather name="shield" size={13} color={AuraColors.content.muted} />
            <Text style={[Type.caption, styles.privacyText]}>
              Setting a new password signs you out on every other device.
            </Text>
          </View>

          <Text style={styles.switchLine}>
            Wrong address?{' '}
            <Link href="/(auth)/forgot-password" style={styles.switchLink}>
              Start over
            </Link>
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: AuraColors.surface.default },
  gate: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: AuraColors.surface.default,
  },
  flex: { flex: 1 },
  hero: { height: HERO_HEIGHT, overflow: 'hidden' },
  heroContent: { paddingHorizontal: Layout.gutter, gap: 18 },
  lockup: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  wordmarkText: {
    fontFamily: Font.bold,
    fontSize: 20,
    letterSpacing: -0.5,
    color: '#ffffff',
  },
  wordmarkFlow: { fontFamily: Font.regular, color: '#7ef9ff' },
  welcome: { gap: 8 },
  headline: {
    fontFamily: Font.bold,
    fontSize: 26,
    lineHeight: 30,
    letterSpacing: -0.7,
    color: '#ffffff',
  },
  subtitle: {
    fontFamily: Font.regular,
    fontSize: 14,
    lineHeight: 21,
    color: 'rgba(255,255,255,0.76)',
    maxWidth: 296,
  },
  address: { fontFamily: Font.semibold, color: '#ffffff' },
  form: { paddingHorizontal: Layout.gutter, paddingTop: 22, paddingBottom: 40, gap: 16 },
  submit: { marginTop: 4 },
  resend: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  resendLabel: { fontFamily: Font.semibold, fontSize: 13, color: AuraColors.brand.default },
  resendLabelIdle: { color: AuraColors.content.muted },
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
  notice: { ...Type.caption, color: AuraColors.brand.default, textAlign: 'center' },
});
