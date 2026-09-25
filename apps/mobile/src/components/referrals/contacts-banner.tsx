import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, Icon, Text } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useReferral } from '@/lib/queries';
import { dismissReferralBanner, isReferralBannerDismissed } from '@/lib/storage';

// Contacts tab banner (issue #11, docs/referrals.md "What the user sees"): shown once after
// attribution, while the user has no eligible social account connected yet - connecting one is what
// makes their own referral (and, from here on, referrals they send) actually count.
//
// Rendered directly under the Contacts tab's header (contacts.tsx), not inside Screen's own padded
// column, so this component supplies its own horizontal/top margin - and, since it can render null
// (referrals off, no attribution, social already connected, or already dismissed), that margin only
// ever shows up alongside real content.

export function ContactsReferralBanner() {
  const theme = useTheme();
  const referral = useReferral();
  const [dismissed, setDismissed] = useState<boolean | null>(null);

  useEffect(() => {
    void isReferralBannerDismissed().then(setDismissed);
  }, []);

  const attribution = referral.data?.attribution;
  if (!referral.data?.enabled || !attribution || attribution.checklist.social || dismissed !== false) return null;

  const dismiss = () => {
    setDismissed(true);
    void dismissReferralBanner();
  };

  return (
    <View style={[styles.wrap, { backgroundColor: theme.primarySoft }]}>
      <View style={styles.row}>
        <Icon name="link-outline" size={18} color="primary" />
        <Text variant="caption" color="text" style={styles.flex}>
          Connect a social account so {attribution.referrerName}&apos;s invite counts (and yours will too).
        </Text>
      </View>
      <View style={styles.actions}>
        <Button title="Connect" size="sm" fullWidth={false} onPress={() => router.push('/connected-accounts')} />
        <Button title="Dismiss" variant="ghost" size="sm" fullWidth={false} onPress={dismiss} accessibilityLabel="Dismiss" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: Spacing.two,
    borderRadius: Radius.md,
    padding: Spacing.three,
    marginHorizontal: Spacing.four,
    marginTop: Spacing.two,
  },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two },
  flex: { flex: 1 },
  actions: { flexDirection: 'row', gap: Spacing.two },
});
