import { isValidSlug, type PublicProfile } from '@chatsoon/shared';
import { useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { Link, Stack, router, useLocalSearchParams, useNavigation } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, View } from 'react-native';

import { ReportDialog } from '@/components/moderation/report-dialog';
import { Button, Card, EmptyState, Icon, Screen, Text, type IconName } from '@/components/ui';
import { ConnectForm } from '@/components/web/connect-form';
import { PageHead } from '@/components/web/page-head';
import { ProfileCard, firstName } from '@/components/web/profile-card';
import { WebPage } from '@/components/web/web-page';
import { Radius, Spacing, type ThemeColor } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useCurrentEvent } from '@/lib/current-event';
import { confirm, showError } from '@/lib/dialogs';
import { roleLine } from '@/lib/format';
import { qk, useBlock, useMe, usePublicProfile, useScanConnect, useUnblock } from '@/lib/queries';

// Public profile at chatsoon.app/id/<slug>. Universal links, app links and chatsoon://id/<slug> land here too.
//   Signed out on the web: Connect form (Turnstile), vCard, report.
//   Signed out in the app: sign in to connect, vCard, report.
//   Signed in: connect (auto-accept), report and block, unblock someone I blocked, or "this is you" on your own profile.

/** Where sign in and onboarding return to afterwards, so the person can still connect. */
const returnHere = (p: PublicProfile) => ({ next: `/id/${p.slug}` });

export default function PublicProfileScreen() {
  const params = useLocalSearchParams<{ slug: string }>();
  const slug = typeof params.slug === 'string' ? params.slug.trim().toLowerCase() : '';
  const valid = isValidSlug(slug);
  const { status } = useAuth();
  // Opened from a link on a cold start, this is the only screen in the stack, so there's no back button.
  const canGoBack = useNavigation().canGoBack();
  const query = usePublicProfile(valid ? slug : undefined);
  const profile = query.data;
  const signedIn = status === 'signedIn';
  const publicWeb = Platform.OS === 'web' && !signedIn;
  const notFound = !valid || (query.error instanceof ApiError && query.error.status === 404);

  let content: ReactNode;
  if (notFound) content = <ProfileNotFound />;
  else if (profile) content = <ProfileBody profile={profile} signedIn={signedIn} />;
  else if (query.isPending) content = <ProfileLoading />;
  else
    content = (
      <EmptyState
        icon="cloud-offline-outline"
        title="Couldn't load this profile"
        message={query.error?.message ?? 'Check your connection and try again.'}
        action={
          <Button
            title="Try again"
            icon="refresh"
            variant="secondary"
            fullWidth={false}
            style={styles.centreButton}
            loading={query.isFetching}
            onPress={() => void query.refetch()}
          />
        }
      />
    );

  return (
    <>
      <Stack.Screen
        options={{
          title: profile?.displayName ?? '',
          headerShown: !publicWeb,
          headerLeft: canGoBack ? undefined : () => <LeaveButton />,
        }}
      />
      <PageHead
        title={profile?.displayName ?? (notFound ? 'Profile not found' : 'Profile')}
        description={profile ? describe(profile) : undefined}
        noIndex
      />
      {publicWeb ? <WebPage contentWidth={520}>{content}</WebPage> : <Screen>{content}</Screen>}
    </>
  );
}

/** Header button for a profile opened straight from a link: leaves to the app's home (contacts or sign in). */
function LeaveButton() {
  return (
    <Pressable
      onPress={() => router.replace('/')}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel="Go to Chatsoon"
      style={({ pressed }) => [styles.leave, { opacity: pressed ? 0.6 : 1 }]}>
      <Icon name={Platform.OS === 'android' ? 'arrow-back' : 'chevron-back'} size={26} color="primary" />
    </Pressable>
  );
}

function describe(p: PublicProfile): string {
  const about = [p.headline, roleLine(p.role, p.company)].filter(Boolean).join(' · ');
  const cta = `Connect with ${firstName(p.displayName)} on Chatsoon.`;
  return about ? `${p.displayName}: ${about}. ${cta}` : cta;
}

function ProfileLoading() {
  const theme = useTheme();
  return (
    <View style={styles.loading} accessibilityLabel="Loading profile">
      <ActivityIndicator size="large" color={theme.primary} />
    </View>
  );
}

function ProfileNotFound() {
  return (
    <EmptyState
      icon="person-remove-outline"
      title="Profile not found"
      message="This profile doesn't exist or was removed."
      action={
        <Link href="/" replace asChild>
          <Button title="Go to Chatsoon" variant="secondary" fullWidth={false} style={styles.centreButton} />
        </Link>
      }
    />
  );
}

function ProfileBody({ profile, signedIn }: { profile: PublicProfile; signedIn: boolean }) {
  const [reporting, setReporting] = useState(false);
  const openReport = () => setReporting(true);

  return (
    <View style={styles.body}>
      <ProfileCard profile={profile} />
      {signedIn ? (
        <MemberActions profile={profile} onReport={openReport} />
      ) : Platform.OS === 'web' ? (
        <VisitorActions profile={profile} onReport={openReport} />
      ) : (
        <SignedOutAppActions profile={profile} onReport={openReport} />
      )}
      <ReportDialog
        visible={reporting}
        onClose={() => setReporting(false)}
        targetSlug={profile.slug}
        targetName={profile.displayName}
      />
    </View>
  );
}

/** Signed in, in the app or on the web. */
function MemberActions({ profile, onReport }: { profile: PublicProfile; onReport: () => void }) {
  const theme = useTheme();
  const qc = useQueryClient();
  const me = useMe();
  const scan = useScanConnect();
  const block = useBlock();
  const unblock = useUnblock();
  const { eventId } = useCurrentEvent();
  const first = firstName(profile.displayName);

  if (me.isPending) {
    return (
      <View style={styles.actionsLoading}>
        <ActivityIndicator color={theme.primary} />
      </View>
    );
  }

  if (me.data?.profile?.slug === profile.slug) {
    return (
      <Card style={styles.ownCard}>
        <View style={styles.ownRow}>
          <View style={[styles.iconBadge, { backgroundColor: theme.primarySoft }]}>
            <Icon name="eye-outline" size={20} color="primary" />
          </View>
          <View style={styles.flex}>
            <Text variant="bodyStrong">This is your public profile</Text>
            <Text variant="caption" color="textSecondary">
              It&apos;s what people see when they scan your QR code. Your email is never shown.
            </Text>
          </View>
        </View>
        <Button title="Edit profile" icon="create-outline" variant="secondary" onPress={() => router.push('/profile-edit')} />
      </Card>
    );
  }

  // The API refuses to connect with someone I blocked, so offer Unblock instead of Connect and Block.
  if (profile.blockedByMe) {
    const unblockUser = async () => {
      const ok = await confirm({
        title: `Unblock ${profile.displayName}?`,
        message: `You'll be able to connect with ${first} again. They won't be told.`,
        confirmText: 'Unblock',
      });
      if (!ok) return;
      unblock.mutate(profile.slug, {
        // Show Connect straight away; useUnblock also refetches the profile.
        onSuccess: () => qc.setQueryData(qk.profile(profile.slug), { ...profile, blockedByMe: false }),
        onError: (err) => showError(err, `Couldn't unblock ${first}`),
      });
    };
    return (
      <View style={styles.actions}>
        <Card style={styles.signInCard}>
          <Text variant="subheading">You blocked {first}</Text>
          <Text variant="callout" color="textSecondary">
            {first} can&apos;t see your profile or connect with you. Unblock {first} to connect again.
          </Text>
          <Button
            title={`Unblock ${first}`}
            icon="lock-open-outline"
            variant="secondary"
            loading={unblock.isPending}
            onPress={() => void unblockUser()}
          />
        </Card>
        <View style={styles.safety}>
          <QuietAction icon="flag-outline" label="Report" accessibilityLabel={`Report ${profile.displayName}`} onPress={onReport} />
        </View>
      </View>
    );
  }

  const connect = () => {
    scan.mutate(
      { slug: profile.slug, eventId },
      {
        onSuccess: ({ contact }) => {
          if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          // With no history (opened from a link), load the tabs underneath so the contact has a way back.
          router.replace(`/contact/${contact.id}`, router.canGoBack() ? undefined : { withAnchor: true });
        },
        onError: (err) => showError(err, `Couldn't connect with ${first}`),
      },
    );
  };

  const blockUser = async () => {
    const ok = await confirm({
      title: `Block ${profile.displayName}?`,
      message: `${first} will be removed from your contacts and won't be able to connect with you. They won't be told. You can unblock them later from their profile.`,
      confirmText: 'Block',
      destructive: true,
    });
    if (!ok) return;
    block.mutate(
      { targetSlug: profile.slug },
      {
        onSuccess: () => router.replace('/contacts'),
        onError: (err) => showError(err, `Couldn't block ${first}`),
      },
    );
  };

  return (
    <View style={styles.actions}>
      {me.data && !me.data.profile ? (
        // Connecting swaps cards, so the API needs mine first (onboarding was left unfinished).
        <Card style={styles.signInCard}>
          <Text variant="subheading">Create your profile to connect</Text>
          <Text variant="callout" color="textSecondary">
            Add your name first, so {first} gets your card when you connect.
          </Text>
          <Button
            title="Create my profile"
            icon="person-circle-outline"
            onPress={() => router.push({ pathname: '/onboarding', params: returnHere(profile) })}
          />
        </Card>
      ) : (
        <>
          <Button
            title={`Connect with ${first}`}
            icon="person-add-outline"
            onPress={connect}
            loading={scan.isPending}
            disabled={block.isPending}
          />
          <Text variant="caption" color="textTertiary" align="center">
            You&apos;ll both get each other&apos;s card.
          </Text>
        </>
      )}
      <View style={styles.safety}>
        <QuietAction icon="flag-outline" label="Report" accessibilityLabel={`Report ${profile.displayName}`} onPress={onReport} />
        <QuietAction
          icon="ban-outline"
          label={block.isPending ? 'Blocking…' : 'Block'}
          accessibilityLabel={`Block ${profile.displayName}`}
          color="danger"
          disabled={block.isPending || scan.isPending}
          onPress={() => void blockUser()}
        />
      </View>
    </View>
  );
}

/** Signed out on the web: the visitor who scanned a QR code with their phone camera. */
function VisitorActions({ profile, onReport }: { profile: PublicProfile; onReport: () => void }) {
  const theme = useTheme();
  const [sent, setSent] = useState(false);
  return (
    <View style={styles.actions}>
      <ConnectForm slug={profile.slug} firstName={firstName(profile.displayName)} onSent={() => setSent(true)} />
      {sent ? null : (
        <Card style={styles.promo}>
          <View style={styles.promoRow}>
            <View style={[styles.iconBadge, { backgroundColor: theme.primarySoft }]}>
              <Icon name="qr-code-outline" size={20} color="primary" />
            </View>
            <View style={styles.flex}>
              <Text variant="bodyStrong">Get your own profile</Text>
              <Text variant="caption" color="textSecondary">
                Share your QR, scan business cards and follow up with everyone you meet at events.
              </Text>
            </View>
          </View>
          <Link href="/" asChild>
            <Button title="Get Chatsoon" size="md" variant="secondary" />
          </Link>
        </Card>
      )}
      <View style={styles.safety}>
        <QuietAction icon="flag-outline" label="Report profile" onPress={onReport} />
      </View>
    </View>
  );
}

/** Signed out in the app, e.g. a universal link opened before signing in. */
function SignedOutAppActions({ profile, onReport }: { profile: PublicProfile; onReport: () => void }) {
  const first = firstName(profile.displayName);
  return (
    <View style={styles.actions}>
      <Card style={styles.signInCard}>
        <Text variant="subheading">Connect with {first}</Text>
        <Text variant="callout" color="textSecondary">
          Sign in to Chatsoon to swap cards with {first}. You&apos;ll both get each other&apos;s details.
        </Text>
        <Button
          title="Sign in to connect"
          icon="log-in-outline"
          onPress={() => router.push({ pathname: '/sign-in', params: returnHere(profile) })}
        />
      </Card>
      <View style={styles.safety}>
        <QuietAction icon="flag-outline" label="Report profile" onPress={onReport} />
      </View>
    </View>
  );
}

function QuietAction({
  icon,
  label,
  onPress,
  disabled,
  color = 'textSecondary',
  accessibilityLabel,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  color?: ThemeColor;
  accessibilityLabel?: string;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: !!disabled }}
      style={({ pressed, hovered }) => [
        styles.quiet,
        { backgroundColor: pressed || hovered ? theme.surfaceAlt : 'transparent', opacity: disabled ? 0.5 : 1 },
      ]}>
      <Icon name={icon} size={16} color={color} />
      <Text variant="captionStrong" color={color}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  centreButton: { alignSelf: 'center' },
  leave: { minWidth: 36, minHeight: 36, alignItems: 'center', justifyContent: 'center' },
  body: { gap: Spacing.five },
  loading: { paddingVertical: 96, alignItems: 'center', justifyContent: 'center' },
  actions: { gap: Spacing.four },
  actionsLoading: { paddingVertical: Spacing.five, alignItems: 'center' },
  ownCard: { gap: Spacing.four },
  ownRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  iconBadge: { width: 40, height: 40, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  promo: { gap: Spacing.four },
  promoRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  signInCard: { gap: Spacing.three, padding: Spacing.five },
  safety: { flexDirection: 'row', justifyContent: 'center', gap: Spacing.two },
  quiet: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: Spacing.three,
    height: 36,
    borderRadius: Radius.pill,
  },
});
