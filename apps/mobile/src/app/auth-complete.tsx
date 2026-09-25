import { Redirect, router, Stack } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Logo, Wordmark } from '@/components/brand';
import { Button, Screen, Text } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth';

// Landed on after a social sign-in redirect (issue #24): the provider sent the browser back to
// api.chatsoon.app/auth/callback/<provider>, Better Auth set its session cookie there, and redirected
// here. Signed out, outside the (app) auth group, like sign-in - reached before a session exists.
//
// completeSocialSignIn() (lib/auth.tsx) calls GET https://api.chatsoon.app/auth/get-session with
// `credentials: 'include'` so that cookie goes along, reads the bearer token back, and stores it
// exactly like the email code flow. This is safe because:
//   - the cookie is only ever sent to api.chatsoon.app, our own API - nowhere else, and never to a
//     third party;
//   - the API's CORS only allows our own configured origins (apps/api/src/index.ts), so no other site
//     could make this same call and get a token back even if it tried;
//   - the token itself never appears in a URL (query string, redirect, or otherwise) - it's read from
//     a JSON response body / response header and kept in memory until it's stored in the same
//     platform-appropriate secure storage the email code flow already uses.
// Once the token is stored, the cookie has done its one job; it isn't needed again (the app only ever
// authenticates with the bearer token from here on - see apps/mobile/src/lib/api.ts), so nothing here
// depends on it surviving, even though Better Auth doesn't give us a way to clear it from this page.

type Status = 'working' | 'error';

export default function AuthCompleteScreen() {
  const { status, completeSocialSignIn } = useAuth();
  const [screenStatus, setScreenStatus] = useState<Status>('working');
  // StrictMode / fast refresh can mount effects twice; a second run must not exchange the same
  // (now-consumed) cookie session again and double-report an error.
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    completeSocialSignIn()
      .then(() => router.replace('/'))
      .catch(() => setScreenStatus('error'));
  }, [completeSocialSignIn]);

  // Already got there (e.g. a fast reload after success): don't get stuck on this screen.
  if (status === 'signedIn') return <Redirect href="/" />;

  return (
    <>
      <Stack.Screen options={{ title: 'Signing you in', headerShown: false }} />
      <Screen contentStyle={styles.content}>
        <View style={styles.brand}>
          <Logo size={64} accessibilityLabel={null} />
          <Wordmark size="md" />
        </View>

        {screenStatus === 'error' ? (
          <View style={styles.body}>
            <Text variant="heading" align="center" accessibilityRole="header">
              We couldn&apos;t sign you in
            </Text>
            <Text variant="callout" color="textSecondary" align="center">
              Something went wrong finishing your sign-in. Try again, or use your email instead.
            </Text>
            <Button
              title="Back to sign in"
              variant="secondary"
              onPress={() => router.replace('/sign-in?error=social')}
            />
          </View>
        ) : (
          <View style={styles.body} accessibilityLiveRegion="polite">
            <Text variant="heading" align="center" accessibilityRole="header">
              Signing you in
            </Text>
            <Text variant="callout" color="textSecondary" align="center">
              Just a moment...
            </Text>
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
