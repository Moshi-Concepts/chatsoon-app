import type { SocialProvider } from '@chatsoon/shared';
import { StyleSheet, View } from 'react-native';

import { Button, type IconName } from '@/components/ui';
import { Spacing } from '@/constants/theme';

// Web only (issue #24): native social sign-in needs native libraries (expo-apple-authentication, an
// expo-auth-session browser flow) that don't exist yet - see docs/native-pending.md.

const CONFIG: Record<SocialProvider, { label: string; icon: IconName; variant: 'apple' | 'secondary' }> = {
  // Apple's own guidance: a full-width button, "Continue with Apple", solid black or white per theme.
  apple: { label: 'Continue with Apple', icon: 'logo-apple', variant: 'apple' },
  // The others don't mandate a specific look; a neutral outlined button with the provider's logo
  // (the app's existing `secondary` variant) reads as a sign-in option without competing with Apple's.
  google: { label: 'Continue with Google', icon: 'logo-google', variant: 'secondary' },
  linkedin: { label: 'Continue with LinkedIn', icon: 'logo-linkedin', variant: 'secondary' },
  discord: { label: 'Continue with Discord', icon: 'logo-discord', variant: 'secondary' },
};

export type SocialSignInButtonsProps = {
  /** From GET /auth-providers (useAuthProviders), already in display order. */
  providers: SocialProvider[];
  onPress: (provider: SocialProvider) => void;
  /** The provider currently redirecting, if any. Disables every button and shows that one loading. */
  pending: SocialProvider | null;
};

export function SocialSignInButtons({ providers, onPress, pending }: SocialSignInButtonsProps) {
  if (providers.length === 0) return null;
  return (
    <View style={styles.wrap}>
      {providers.map((provider) => {
        const { label, icon, variant } = CONFIG[provider];
        return (
          <Button
            key={provider}
            title={label}
            icon={icon}
            variant={variant}
            onPress={() => onPress(provider)}
            loading={pending === provider}
            disabled={pending !== null && pending !== provider}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.three },
});
