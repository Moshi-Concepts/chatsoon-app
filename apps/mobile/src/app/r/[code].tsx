import { isValidReferralCode } from '@chatsoon/shared';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';

import { Logo, Wordmark } from '@/components/brand';
import { Screen, Text } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth';
import { usePublicReferral, useReferral } from '@/lib/queries';
import { setPendingReferralCode } from '@/lib/storage';

// Universal/app link target (issue #11, docs/referrals.md "How attribution works", "Mobile files").
// Signed-out capable, outside the (app) auth group, like sign-in.tsx: stores the code, shows who
// invited the visitor, then routes on - it never renders the hub itself.

export default function ReferralLinkScreen() {
  const params = useLocalSearchParams<{ code?: string }>();
  const code = typeof params.code === 'string' ? params.code.trim().toUpperCase() : '';
  const valid = isValidReferralCode(code);
  const { status } = useAuth();
  const inviter = usePublicReferral(valid ? code : undefined);
  // Only fires while signed in (the hook itself gates on that); tells us whether the caller is still
  // inside the attribution window, per the task's routing rule below.
  const referral = useReferral();
  const stored = useRef(false);

  useEffect(() => {
    if (!valid || stored.current) return;
    stored.current = true;
    void setPendingReferralCode(code);
  }, [valid, code]);

  useEffect(() => {
    if (status === 'loading') return;
    if (status === 'signedOut') {
      // Wait for the inviter's name so the sign-in screen can show "Invited by <name>" - but only when
      // there's actually a lookup in flight: an invalid code leaves `inviter` permanently disabled
      // (react-query never settles a disabled query), which must not hang this redirect forever.
      if (valid && inviter.isPending) return;
      router.replace({ pathname: '/sign-in', params: inviter.data ? { invitedBy: inviter.data.displayName } : {} });
      return;
    }
    // Signed in. Wait for /me/referral so canEnterCode is known - unless it errored (e.g. no profile
    // yet), in which case '/' falls through the (app) layout's own guard straight to onboarding.
    if (referral.isPending) return;
    if (referral.isError || !referral.data) {
      router.replace('/');
      return;
    }
    router.replace(referral.data.enabled && referral.data.canEnterCode ? '/referrals' : '/');
  }, [status, valid, inviter.isPending, inviter.data, referral.isPending, referral.isError, referral.data]);

  return (
    <>
      <Stack.Screen options={{ headerShown: false, title: 'Invite' }} />
      <Screen contentStyle={styles.content}>
        <View style={styles.brand}>
          <Logo size={56} accessibilityLabel={null} />
          <Wordmark size="md" />
        </View>
        <View style={styles.body} accessibilityLiveRegion="polite">
          <Text variant="heading" align="center" accessibilityRole="header">
            {inviter.data ? `Invited by ${inviter.data.displayName}` : 'Opening your invite...'}
          </Text>
        </View>
      </Screen>
    </>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, justifyContent: 'center', maxWidth: 440, gap: Spacing.six, paddingVertical: Spacing.five },
  brand: { alignItems: 'center', gap: Spacing.three },
  body: { gap: Spacing.four },
});
