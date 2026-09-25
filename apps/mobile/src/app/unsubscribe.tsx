import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Logo, Wordmark } from '@/components/brand';
import { Button, Screen, Text } from '@/components/ui';
import { PageHead } from '@/components/web/page-head';
import { Spacing } from '@/constants/theme';
import { api } from '@/lib/api';

// Reached from a tips email's unsubscribe link (issue #7): GET /email/unsubscribe on the API 302s to
// https://chatsoon.app/unsubscribe?token=... . Outside the (app) auth group so it works signed out.
// Never auto-POSTs on load (email scanners open links, and RFC 8058's one-click POST is what a
// compliant mail client uses instead of a page load at all), so unsubscribing only happens on the
// button press. Structure copied from cancel-deletion.tsx (issue #8), which has the same shape.

type Status = 'ready' | 'missing' | 'pending' | 'success' | 'invalid';

export default function UnsubscribeScreen() {
  const { token: rawToken } = useLocalSearchParams<{ token?: string }>();
  const token = typeof rawToken === 'string' ? rawToken.trim() : '';

  const [status, setStatus] = useState<Status>(token ? 'ready' : 'missing');

  const unsubscribe = async () => {
    if (status === 'pending') return;
    setStatus('pending');
    try {
      await api.email.unsubscribe(token);
      setStatus('success');
    } catch {
      // invalid_token, a network failure, or anything else: the spec shows the same "isn't valid"
      // copy either way, rather than a generic error message.
      setStatus('invalid');
    }
  };

  return (
    <>
      <Stack.Screen options={{ title: 'Unsubscribe', headerShown: false }} />
      <PageHead title="Unsubscribe from Chatsoon tips" noIndex />
      <Screen contentStyle={styles.content}>
        <View style={styles.brand}>
          <Logo size={64} accessibilityLabel={null} />
          <Wordmark size="md" />
        </View>

        {status === 'success' ? (
          <View style={styles.body}>
            <Text variant="heading" align="center" accessibilityRole="header">
              You&apos;re unsubscribed
            </Text>
            <Text variant="callout" color="textSecondary" align="center">
              You won&apos;t get any more tips emails.
            </Text>
          </View>
        ) : status === 'invalid' || status === 'missing' ? (
          <View style={styles.body}>
            <Text variant="heading" align="center" accessibilityRole="header">
              This unsubscribe link isn&apos;t valid
            </Text>
            <Text variant="callout" color="textSecondary" align="center">
              Email hello@chatsoon.app and we&apos;ll remove you.
            </Text>
          </View>
        ) : (
          <View style={styles.body}>
            <Text variant="heading" align="center" accessibilityRole="header">
              Unsubscribe from Chatsoon tips
            </Text>
            <Text variant="callout" color="textSecondary" align="center">
              Stop tips emails about setting up and using Chatsoon. You&apos;ll still get emails you need, like
              sign-in codes.
            </Text>
            <Button title="Unsubscribe" onPress={() => void unsubscribe()} loading={status === 'pending'} />
          </View>
        )}
      </Screen>
    </>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, justifyContent: 'center', maxWidth: 440, gap: Spacing.six, paddingVertical: Spacing.five },
  brand: { alignItems: 'center', gap: Spacing.three },
  body: { gap: Spacing.four },
});
