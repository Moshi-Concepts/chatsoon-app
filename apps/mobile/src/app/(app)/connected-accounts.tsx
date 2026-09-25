import { SOCIAL_VALIDATION_PROVIDERS, type SocialIneligibleReason, type SocialValidationProvider } from '@chatsoon/shared';
import { Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, View } from 'react-native';

import { Button, Card, Icon, ListRow, Screen, Text, type IconName } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { ApiError } from '@/lib/api';
import { showAlert, showError } from '@/lib/dialogs';
import { formatDate } from '@/lib/format';
import { useAuthProviders, useConnectedAccounts, useLinkSocial } from '@/lib/queries';

// Connected accounts (issue #11, docs/referrals.md "Account linking"). Connect/Reconnect reuse Better
// Auth's `linkSocial` the same redirect-based way the existing social *sign-in* flow works
// (lib/auth.tsx, social-sign-in-buttons.tsx) - which is web only in 1.0 (docs/native-pending.md: native
// needs expo-apple-authentication / an expo-auth-session browser flow per provider, not a plain
// redirect). Rather than build a second, different native flow with `expo-web-browser`'s
// `openAuthSessionAsync` and a `chatsoon://` deep-link callback (its own chunk of native-only plumbing,
// still blocked on the same "no native social flow yet" gap sign-in has), this screen follows the exact
// same precedent: implement web fully, and on native show read-only status for whatever is already
// connected with a pointer to the web app for adding a new one. See docs/native-pending.md.

const isWeb = Platform.OS === 'web';

const PROVIDER_META: Record<SocialValidationProvider, { label: string; icon: IconName }> = {
  google: { label: 'Google', icon: 'logo-google' },
  apple: { label: 'Apple', icon: 'logo-apple' },
  discord: { label: 'Discord', icon: 'logo-discord' },
  linkedin: { label: 'LinkedIn', icon: 'logo-linkedin' },
  twitter: { label: 'X', icon: 'logo-x' },
};

const REASON_TEXT: Record<SocialIneligibleReason, string> = {
  discord_age: 'Discord account needs to be 90+ days old',
  discord_mfa: 'Turn on two-factor authentication in Discord, then reconnect',
  x_not_verified: 'X account needs to be verified or ID verified',
  x_followers: 'X account needs 50+ followers',
};

/** Better Auth appends its own `?error=<code>` to whatever errorCallbackURL we passed (same pattern as
 * sign-in.tsx's readSocialError), on top of our own `?link_error=1&provider=`. Reads and clears both. */
function readLinkResult(): { linked?: SocialValidationProvider; errorProvider?: SocialValidationProvider; error?: string } | null {
  if (!isWeb || typeof window === 'undefined') return null;
  const url = new URL(window.location.href);
  const linked = url.searchParams.get('linked');
  const linkError = url.searchParams.get('link_error');
  const provider = url.searchParams.get('provider');
  const errors = url.searchParams.getAll('error');
  if (!linked && !linkError && errors.length === 0) return null;
  url.searchParams.delete('linked');
  url.searchParams.delete('link_error');
  url.searchParams.delete('provider');
  url.searchParams.delete('error');
  url.searchParams.delete('error_description');
  window.history.replaceState(null, '', url.toString());
  return {
    linked: isSocialValidationProvider(linked) ? linked : undefined,
    errorProvider: linkError ? (isSocialValidationProvider(provider) ? provider : undefined) : undefined,
    error: linkError ? (errors[errors.length - 1] ?? undefined) : undefined,
  };
}

function isSocialValidationProvider(value: string | null): value is SocialValidationProvider {
  return !!value && (SOCIAL_VALIDATION_PROVIDERS as readonly string[]).includes(value);
}

function linkErrorMessage(code: string | undefined, providerLabel: string): string {
  switch (code) {
    case 'account_already_linked_to_different_user':
      return `That ${providerLabel} account is already connected to another Chatsoon account.`;
    case 'unable_to_get_user_info':
      return `${providerLabel} didn't respond. Try again in a few minutes.`;
    case 'email_not_verified':
      return `That ${providerLabel} account's email isn't verified yet. Verify it there, then try again.`;
    default:
      return `Couldn't connect ${providerLabel}. Please try again.`;
  }
}

export default function ConnectedAccountsScreen() {
  const theme = useTheme();
  const connected = useConnectedAccounts();
  const authProviders = useAuthProviders();
  const linkSocial = useLinkSocial();
  const [pending, setPending] = useState<SocialValidationProvider | null>(null);

  useEffect(() => {
    const result = readLinkResult();
    if (!result) return;
    if (result.linked) {
      showAlert('Connected', `${PROVIDER_META[result.linked].label} is now connected.`);
    } else if (result.error !== undefined) {
      const label = result.errorProvider ? PROVIDER_META[result.errorProvider].label : 'that account';
      showAlert("Couldn't connect", linkErrorMessage(result.error, label));
    }
  }, []);

  const connectedByProvider = new Map((connected.data ?? []).map((row) => [row.provider, row]));
  // Configured providers the screen can offer to link (docs/referrals.md: "providers ∪ linkProviders
  // from /auth-providers"). Native has no `/auth-providers` fetch (see the file comment above), so it
  // only ever lists providers it already has a connected-accounts row for.
  const configured = new Set<SocialValidationProvider>([
    ...(authProviders.data?.providers ?? []),
    ...(authProviders.data?.linkProviders ?? []),
    ...connectedByProvider.keys(),
  ]);
  const rows = SOCIAL_VALIDATION_PROVIDERS.filter((p) => configured.has(p));

  const connect = (provider: SocialValidationProvider) => {
    if (pending || typeof window === 'undefined') return;
    setPending(provider);
    const origin = window.location.origin;
    linkSocial.mutate(
      {
        provider,
        callbackURL: `${origin}/connected-accounts?linked=${provider}`,
        errorCallbackURL: `${origin}/connected-accounts?link_error=1&provider=${provider}`,
      },
      {
        onSuccess: ({ url }) => {
          window.location.href = url;
        },
        onError: (err) => {
          setPending(null);
          if (err instanceof ApiError && err.code === 'account_already_linked_to_different_user') {
            showAlert("Couldn't connect", linkErrorMessage(err.code, PROVIDER_META[provider].label));
            return;
          }
          showError(err, `Couldn't connect ${PROVIDER_META[provider].label}`);
        },
      },
    );
  };

  const loading = connected.isPending || (isWeb && authProviders.isPending);

  return (
    <Screen edges={['bottom']} contentStyle={styles.content}>
      <Stack.Screen options={{ title: 'Connected accounts' }} />

      <Text variant="callout" color="textSecondary">
        Connect Google, Apple, LinkedIn, X or Discord to confirm you&apos;re a real person. Discord counts once the
        account is 90+ days old with two-factor authentication on. X counts once it&apos;s verified or ID verified
        with 50+ followers.
      </Text>

      {!isWeb ? (
        <View style={[styles.nativeNote, { backgroundColor: theme.surfaceAlt }]}>
          <Icon name="information-circle-outline" size={18} color="textSecondary" />
          <Text variant="caption" color="textSecondary" style={styles.flex}>
            Open chatsoon.app in your browser and go to Me &gt; Connected accounts to connect a new one.
          </Text>
        </View>
      ) : null}

      {loading ? (
        <ActivityIndicator color={theme.primary} style={styles.loading} />
      ) : rows.length === 0 ? (
        <Text variant="callout" color="textSecondary">
          No providers are set up yet.
        </Text>
      ) : (
        <Card padded={false}>
          {rows.map((provider, i) => (
            <ProviderRow
              key={provider}
              provider={provider}
              row={connectedByProvider.get(provider)}
              divider={i < rows.length - 1}
              connecting={pending === provider}
              onConnect={isWeb ? () => connect(provider) : undefined}
            />
          ))}
        </Card>
      )}
    </Screen>
  );
}

function ProviderRow({
  provider,
  row,
  divider,
  connecting,
  onConnect,
}: {
  provider: SocialValidationProvider;
  row: { connectedAt: string; label?: string; eligible: boolean; reason?: SocialIneligibleReason } | undefined;
  divider: boolean;
  connecting: boolean;
  onConnect?: () => void;
}) {
  const meta = PROVIDER_META[provider];

  if (!row) {
    return (
      <ListRow
        icon={meta.icon}
        title={meta.label}
        subtitle={onConnect ? undefined : 'Connect from chatsoon.app'}
        divider={divider}
        chevron={false}
        right={onConnect ? <Button title="Connect" size="sm" fullWidth={false} loading={connecting} onPress={onConnect} /> : undefined}
      />
    );
  }

  if (row.eligible) {
    return (
      <ListRow
        icon={meta.icon}
        title={meta.label}
        subtitle={row.label ? `Connected · ${row.label}` : `Connected since ${formatDate(row.connectedAt)}`}
        divider={divider}
        chevron={false}
        right={<Icon name="checkmark-circle" size={20} color="success" />}
      />
    );
  }

  return (
    <ListRow
      icon={meta.icon}
      title={meta.label}
      subtitle={`Connected, not yet eligible${row.reason ? ` · ${REASON_TEXT[row.reason]}` : ''}`}
      divider={divider}
      chevron={false}
      right={onConnect ? <Button title="Reconnect" variant="secondary" size="sm" fullWidth={false} loading={connecting} onPress={onConnect} /> : undefined}
    />
  );
}

const styles = StyleSheet.create({
  content: { gap: Spacing.four, paddingBottom: Spacing.six },
  flex: { flex: 1 },
  loading: { paddingVertical: Spacing.six },
  nativeNote: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, borderRadius: 12, padding: Spacing.three },
});
