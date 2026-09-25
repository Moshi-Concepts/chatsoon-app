import { Link, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Logo, Wordmark } from '@/components/brand';
import { Button, Screen, Text } from '@/components/ui';
import { PageHead } from '@/components/web/page-head';
import { Spacing } from '@/constants/theme';
import { api, ApiError } from '@/lib/api';

// Reached from the "scheduled" email's cancel link (issue #8): https://chatsoon.app/cancel-deletion?token=...
// Outside the (app) auth group so it works signed out. Never auto-POSTs on load (email scanners open
// links), so cancellation only happens on the button press.

type Status = 'ready' | 'missing' | 'pending' | 'success' | 'invalid';

export default function CancelDeletionScreen() {
  const { token: rawToken } = useLocalSearchParams<{ token?: string }>();
  const token = typeof rawToken === 'string' ? rawToken.trim() : '';

  const [status, setStatus] = useState<Status>(token ? 'ready' : 'missing');
  const [maskedEmail, setMaskedEmail] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const cancel = async () => {
    if (status === 'pending') return;
    setStatus('pending');
    try {
      const res = await api.accountDeletion.cancelByToken(token);
      setMaskedEmail(res.email);
      setStatus('success');
    } catch (err) {
      setErrorMessage(err instanceof ApiError && err.code !== 'invalid_token' ? err.message : null);
      setStatus('invalid');
    }
  };

  return (
    <>
      <Stack.Screen options={{ title: 'Cancel account deletion', headerShown: false }} />
      <PageHead title="Cancel account deletion" noIndex />
      <Screen contentStyle={styles.content}>
        <View style={styles.brand}>
          <Logo size={64} accessibilityLabel={null} />
          <Wordmark size="md" />
        </View>

        {status === 'success' ? (
          <View style={styles.body}>
            <Text variant="heading" align="center" accessibilityRole="header">
              Your account is safe
            </Text>
            <Text variant="callout" color="textSecondary" align="center">
              Deletion cancelled for {maskedEmail}.
            </Text>
            <SignInButton />
          </View>
        ) : status === 'invalid' ? (
          <View style={styles.body}>
            <Text variant="heading" align="center" accessibilityRole="header">
              This link isn&apos;t valid
            </Text>
            <Text variant="callout" color="textSecondary" align="center">
              {errorMessage ??
                'This link has expired or was already used. If your account still exists, sign in to check.'}
            </Text>
            <SignInButton />
          </View>
        ) : status === 'missing' ? (
          <View style={styles.body}>
            <Text variant="heading" align="center" accessibilityRole="header">
              This link isn&apos;t valid
            </Text>
            <Text variant="callout" color="textSecondary" align="center">
              This link is missing its cancellation code. If your account still exists, sign in to check.
            </Text>
            <SignInButton />
          </View>
        ) : (
          <View style={styles.body}>
            <Text variant="heading" align="center" accessibilityRole="header">
              Cancel account deletion
            </Text>
            <Text variant="callout" color="textSecondary" align="center">
              Keep your Chatsoon account and turn your public profile back on.
            </Text>
            <Button title="Keep my account" onPress={() => void cancel()} loading={status === 'pending'} />
          </View>
        )}
      </Screen>
    </>
  );
}

function SignInButton() {
  return (
    <Link href="/sign-in" replace asChild>
      <Button title="Sign in" variant="secondary" />
    </Link>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, justifyContent: 'center', maxWidth: 440, gap: Spacing.six, paddingVertical: Spacing.five },
  brand: { alignItems: 'center', gap: Spacing.three },
  body: { gap: Spacing.four },
});
