import { emailSchema, otpSchema } from '@chatsoon/shared';
import { Redirect, router, Stack, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { BackHandler, Platform, StyleSheet, TextInput, View } from 'react-native';

import { Logo, Wordmark } from '@/components/brand';
import { Button, Screen, Text, TextField } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';

const CODE_LENGTH = 6;
const RESEND_COOLDOWN_MS = 30_000;

type Step = 'email' | 'code';

/** Turns Better Auth / API errors into something a person can act on. */
function authErrorMessage(err: unknown, step: Step): string {
  if (err instanceof ApiError) {
    if (err.status === 0) return err.message;
    if (err.status === 429 || err.code === 'rate_limited') {
      return 'Too many attempts. Please wait a minute, then try again.';
    }
    switch (err.code) {
      case 'INVALID_OTP':
        return "That code isn't right. Check the latest email from us and try again.";
      case 'OTP_EXPIRED':
        return 'That code has expired. Tap "Resend code" to get a new one.';
      case 'TOO_MANY_ATTEMPTS':
        return 'Too many wrong codes. Tap "Resend code" to get a new one.';
      case 'INVALID_EMAIL':
        return 'Enter a valid email address.';
    }
    if (err.status >= 500) return 'Something went wrong on our side. Please try again.';
    if (step === 'code' && err.status === 400) return "That code isn't right. Please try again.";
    return err.message;
  }
  return 'Something went wrong. Please try again.';
}

export default function SignInScreen() {
  const { status, sendCode, verifyCode } = useAuth();

  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  // Guards against a second verify before the re-render: iOS code autofill can fire onChangeText twice.
  const verifyingRef = useRef(false);
  const [resending, setResending] = useState(false);
  const codeRef = useRef<TextInput>(null);

  // Resend cooldown, tracked as a deadline so it stays right if the app is backgrounded.
  const [resendAt, setResendAt] = useState(0);
  const [now, setNow] = useState(0);
  const secondsLeft = Math.max(0, Math.ceil((resendAt - now) / 1000));

  useEffect(() => {
    if (resendAt === 0) return;
    const id = setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (t >= resendAt) clearInterval(id);
    }, 1000);
    return () => clearInterval(id);
  }, [resendAt]);

  const startCooldown = () => {
    const t = Date.now();
    setNow(t);
    setResendAt(t + RESEND_COOLDOWN_MS);
  };

  const backToEmail = useCallback(() => {
    setStep('email');
    setCode('');
    setCodeError(null);
    setNotice(null);
  }, []);

  // Android back on the code step returns to the email step instead of leaving the app.
  useFocusEffect(
    useCallback(() => {
      if (step !== 'code' || Platform.OS !== 'android') return;
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        backToEmail();
        return true;
      });
      return () => sub.remove();
    }, [step, backToEmail]),
  );

  // The Redirect is skipped while verifying so it doesn't race the replace below.
  if (status === 'signedIn' && !verifying) return <Redirect href="/" />;

  const focusCode = () => codeRef.current?.focus();

  const submitEmail = async () => {
    if (sending) return;
    const parsed = emailSchema.safeParse(email);
    if (!parsed.success) {
      setEmailError(email.trim() ? 'Enter a valid email address, like you@company.com' : 'Enter your email');
      return;
    }
    setEmailError(null);
    setSending(true);
    try {
      await sendCode(parsed.data);
    } catch (err) {
      setSending(false);
      setEmailError(authErrorMessage(err, 'email'));
      return;
    }
    setSending(false);
    setEmail(parsed.data);
    setCode('');
    setCodeError(null);
    setNotice(null);
    startCooldown();
    setStep('code');
  };

  const submitCode = async (value: string) => {
    if (verifyingRef.current) return;
    const parsed = otpSchema.safeParse(value);
    if (!parsed.success) {
      setCodeError(parsed.error.issues[0]?.message ?? 'Enter the 6 digit code');
      return;
    }
    verifyingRef.current = true;
    setCodeError(null);
    setNotice(null);
    setVerifying(true);
    try {
      await verifyCode(email, parsed.data);
    } catch (err) {
      verifyingRef.current = false;
      setVerifying(false);
      setCode('');
      setCodeError(authErrorMessage(err, 'code'));
      // Wait for the input to become editable again before focusing it.
      setTimeout(focusCode, 50);
      return;
    }
    router.replace('/');
  };

  const onCodeChange = (value: string) => {
    setCode(value);
    if (codeError) setCodeError(null);
    if (value.length === CODE_LENGTH) void submitCode(value);
  };

  const resend = async () => {
    if (resending || secondsLeft > 0) return;
    setResending(true);
    setCodeError(null);
    setNotice(null);
    try {
      await sendCode(email);
    } catch (err) {
      setResending(false);
      setCodeError(authErrorMessage(err, 'code'));
      return;
    }
    setResending(false);
    setCode('');
    setNotice('We sent you a new code.');
    startCooldown();
    codeRef.current?.focus();
  };

  return (
    <Screen edges={['top', 'bottom']} contentStyle={styles.content}>
      <Stack.Screen options={{ title: 'Sign in' }} />

      <View style={styles.brand}>
        <Logo size={72} accessibilityLabel={null} />
        <Wordmark size="lg" tagline />
      </View>

      {step === 'email' ? (
        <View style={styles.form}>
          <View style={styles.intro}>
            <Text variant="heading" align="center" accessibilityRole="header">
              Sign in or create an account
            </Text>
            <Text variant="callout" color="textSecondary" align="center">
              Enter your email and we'll send you a 6 digit code. No password needed.
            </Text>
          </View>
          <TextField
            label="Email"
            placeholder="you@company.com"
            value={email}
            onChangeText={(v) => {
              setEmail(v);
              if (emailError) setEmailError(null);
            }}
            error={emailError}
            icon="mail-outline"
            autoFocus
            keyboardType="email-address"
            autoComplete="email"
            textContentType="emailAddress"
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
            inputMode="email"
            returnKeyType="send"
            submitBehavior="submit"
            onSubmitEditing={() => void submitEmail()}
            editable={!sending}
            maxLength={254}
          />
          <Button
            title="Send code"
            icon="arrow-forward"
            onPress={() => void submitEmail()}
            loading={sending}
            disabled={!email.trim()}
          />
        </View>
      ) : (
        <View style={styles.form}>
          <View style={styles.intro}>
            <Text variant="heading" align="center" accessibilityRole="header">
              Check your email
            </Text>
            <Text variant="callout" color="textSecondary" align="center">
              Code sent to{' '}
              <Text variant="callout" style={styles.strong}>
                {email}
              </Text>
            </Text>
          </View>

          <CodeInput
            inputRef={codeRef}
            value={code}
            onChange={onCodeChange}
            hasError={!!codeError}
            disabled={verifying}
          />

          <View style={styles.message} accessibilityLiveRegion="polite">
            {codeError ? (
              <Text variant="caption" color="danger" align="center">
                {codeError}
              </Text>
            ) : (
              <Text variant="caption" color="textTertiary" align="center">
                {notice ?? "Can't find it? Check your spam or promotions folder."}
              </Text>
            )}
          </View>

          <Button
            title="Continue"
            onPress={() => void submitCode(code)}
            loading={verifying}
            disabled={code.length !== CODE_LENGTH}
          />

          <View style={styles.links}>
            <Button
              title={secondsLeft > 0 ? `Resend code in ${secondsLeft}s` : 'Resend code'}
              variant="ghost"
              size="sm"
              fullWidth={false}
              onPress={() => void resend()}
              loading={resending}
              disabled={secondsLeft > 0 || verifying}
            />
            <Button
              title="Use a different email"
              variant="ghost"
              size="sm"
              fullWidth={false}
              onPress={backToEmail}
              disabled={verifying}
            />
          </View>
        </View>
      )}

      <Text variant="caption" color="textTertiary" align="center" style={styles.legal}>
        By continuing you agree to our{' '}
        <Text
          variant="captionStrong"
          color="primary"
          accessibilityRole="link"
          onPress={() => router.push('/terms')}>
          Terms
        </Text>{' '}
        and{' '}
        <Text
          variant="captionStrong"
          color="primary"
          accessibilityRole="link"
          onPress={() => router.push('/privacy')}>
          Privacy Policy
        </Text>
        .
      </Text>
    </Screen>
  );
}

/**
 * Six digit boxes backed by one invisible TextInput laid over them, so paste and the iOS
 * "from Mail" one-time-code suggestion fill every box at once.
 */
function CodeInput({
  value,
  onChange,
  hasError,
  disabled,
  inputRef,
}: {
  value: string;
  onChange: (value: string) => void;
  hasError: boolean;
  disabled: boolean;
  inputRef: RefObject<TextInput | null>;
}) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);
  const activeIndex = Math.min(value.length, CODE_LENGTH - 1);

  return (
    <View style={styles.codeWrap}>
      <View style={styles.boxes} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        {Array.from({ length: CODE_LENGTH }, (_, i) => {
          const digit = value[i] ?? '';
          const active = focused && !disabled && i === activeIndex;
          return (
            <View
              key={i}
              style={[
                styles.box,
                {
                  backgroundColor: theme.surface,
                  borderColor: hasError ? theme.danger : active ? theme.primary : theme.border,
                  opacity: disabled ? 0.6 : 1,
                },
              ]}>
              {digit ? (
                <Text style={styles.digit}>{digit}</Text>
              ) : active ? (
                <View style={[styles.caret, { backgroundColor: theme.primary }]} />
              ) : null}
            </View>
          );
        })}
      </View>
      {/*
        No maxLength: it would cut a pasted " 123 456" before the digits are pulled out.
        onChangeText keeps the first six digits, which also absorbs iOS pasting an autofilled
        code twice. The selection is pinned to the end so tapping a box never puts the
        (hidden) cursor in the middle of the code.
      */}
      <TextInput
        ref={inputRef}
        value={value}
        onChangeText={(text) => onChange(text.replace(/\D/g, '').slice(0, CODE_LENGTH))}
        selection={{ start: value.length, end: value.length }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        autoFocus
        editable={!disabled}
        keyboardType="number-pad"
        inputMode="numeric"
        textContentType="oneTimeCode"
        autoComplete="one-time-code"
        caretHidden
        accessibilityLabel="6 digit code"
        accessibilityHint="Enter the code from the email we sent you"
        style={[styles.hiddenInput, { color: 'transparent' }]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, justifyContent: 'center', maxWidth: 440, gap: Spacing.six, paddingVertical: Spacing.five },
  brand: { alignItems: 'center', gap: Spacing.three },
  form: { gap: Spacing.four },
  intro: { gap: Spacing.two, marginBottom: Spacing.one },
  strong: { fontWeight: '600' },
  message: { minHeight: 18 },
  links: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: Spacing.two },
  legal: { maxWidth: 320, alignSelf: 'center' },
  codeWrap: { position: 'relative' },
  boxes: { flexDirection: 'row', justifyContent: 'center', gap: Spacing.two },
  box: {
    flex: 1,
    maxWidth: 56,
    height: 64,
    borderWidth: 1.5,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  digit: { fontSize: 28, lineHeight: 34, fontWeight: '700', fontVariant: ['tabular-nums'] },
  caret: { width: 2, height: 28, borderRadius: 1 },
  // Nearly invisible rather than opacity 0: iOS skips touches on fully transparent views.
  // 16px text stops mobile Safari zooming in on focus.
  hiddenInput: {
    ...StyleSheet.absoluteFill,
    opacity: 0.02,
    fontSize: 16,
    textAlign: 'center',
    outlineStyle: 'none',
  } as object,
});
