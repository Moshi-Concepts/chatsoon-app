import { isValidSlug, type ProfileInput } from '@chatsoon/shared';
import { Redirect, router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { Logo } from '@/components/brand';
import {
  AccountLoadError,
  AccountLoading,
  AvatarPicker,
  parseProfileForm,
  ProfileFields,
  profileToForm,
  type AvatarValue,
  type ProfileFormErrors,
} from '@/components/profile';
import { Avatar, Button, Card, Icon, Screen, Text, TextField } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { confirm, showError } from '@/lib/dialogs';
import { useOutbox } from '@/lib/outbox';
import { useAttributeReferral, useMe, useReferral, useUpdateProfile } from '@/lib/queries';
import { referralAttributeErrorMessage } from '@/lib/referral-errors';
import { clearPendingReferralCode, getPendingReferralCode } from '@/lib/storage';

/** `?next=/id/<slug>`: set up from a profile's "Create my profile", go back there to connect. Profile paths only. */
function profileReturnPath(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = /^\/id\/([a-z0-9-]+)$/.exec(value);
  return match && isValidSlug(match[1]) ? value : null;
}

// First run: signed in, but no profile yet. The profile is what people get when they scan your QR.
export default function OnboardingScreen() {
  const theme = useTheme();
  const { status, signOut } = useAuth();
  const me = useMe();
  const update = useUpdateProfile();
  const next = profileReturnPath(useLocalSearchParams<{ next?: string }>().next);
  const { items: unsynced } = useOutbox();

  const [values, setValues] = useState(() => profileToForm(null));
  const [errors, setErrors] = useState<ProfileFormErrors>({});
  const [avatar, setAvatar] = useState<AvatarValue>({ key: null, url: null });
  const [uploading, setUploading] = useState(false);

  // "Did someone invite you?" (issue #11, docs/referrals.md "Onboarding"): a second step shown right
  // after the profile saves, since GET /me/referral (which says whether referrals are on, and whether
  // this account can still enter a code) needs the profile this same screen is about to create.
  const [step, setStep] = useState<'profile' | 'invite'>('profile');
  const referral = useReferral(step === 'invite');
  const attribute = useAttributeReferral();
  const [inviteCode, setInviteCode] = useState('');
  const [inviteSource, setInviteSource] = useState<'typed' | 'link'>('typed');
  const [attributing, setAttributing] = useState(false);

  useEffect(() => {
    if (step !== 'invite') return;
    void getPendingReferralCode().then((pending) => {
      if (pending) {
        setInviteCode(pending.code);
        setInviteSource('link');
      }
    });
  }, [step]);

  const finish = () => {
    // A fresh account: show the one-time "How Chatsoon works" intro (issue #32) before Contacts.
    // `next` means this signup came from a public profile's "Create my profile" and already has a
    // specific place to return to, so it skips straight there instead.
    if (next) router.dismissTo(next);
    else router.replace('/intro');
  };

  // Once we know whether referrals are on and this account can still enter a code, either show the
  // step or skip straight past it - never block onboarding on this feature being on at all.
  useEffect(() => {
    if (step !== 'invite' || referral.isPending) return;
    if (referral.isError || !referral.data?.enabled || !referral.data.canEnterCode) finish();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- finish() is stable enough for this effect's purpose
  }, [step, referral.isPending, referral.isError, referral.data]);

  const submitInvite = async () => {
    if (attributing) return;
    const trimmed = inviteCode.trim();
    if (!trimmed) {
      finish();
      return;
    }
    setAttributing(true);
    try {
      await attribute.mutateAsync({ code: trimmed, source: inviteSource });
    } catch (err) {
      showError(err, referralAttributeErrorMessage(err));
      // Never block onboarding on this - fall through to finish() regardless.
    }
    await clearPendingReferralCode();
    setAttributing(false);
    finish();
  };

  // Social sign-in prefill (issue #24): a name from the provider fills the name field when it's still
  // empty (never overwrites something typed in already), and an offered provider photo is fetched into
  // R2 only if the person accepts it.
  const [providerPhotoDismissed, setProviderPhotoDismissed] = useState(false);
  const [fetchingProviderPhoto, setFetchingProviderPhoto] = useState(false);
  const providerName = me.data?.user.name;
  useEffect(() => {
    if (!providerName) return;
    setValues((v) => (v.displayName.trim() ? v : { ...v, displayName: providerName }));
  }, [providerName]);

  const providerImage = me.data?.user.image;
  const useProviderPhoto = async () => {
    if (fetchingProviderPhoto) return;
    setFetchingProviderPhoto(true);
    try {
      const { avatarKey } = await api.me.avatarFromProvider();
      // The provider's own URL previews instantly; the saved key (an R2 upload, like any other
      // avatar) is what PUT /me/profile actually stores.
      setAvatar({ key: avatarKey, url: providerImage ?? null });
    } catch (err) {
      showError(err, "Couldn't use that photo");
    }
    setProviderPhotoDismissed(true);
    setFetchingProviderPhoto(false);
  };

  // Signing out wipes captures that haven't synced, so warn first (same as the Me tab).
  const confirmSignOut = async () => {
    const pending = unsynced.length;
    if (pending > 0) {
      const ok = await confirm({
        title: 'Sign out?',
        message: `${pending} ${pending === 1 ? "contact hasn't" : "contacts haven't"} synced yet and will be lost if you sign out now.`,
        confirmText: 'Sign out',
        destructive: true,
      });
      if (!ok) return;
    }
    await signOut();
  };

  if (status === 'signedOut') return <Redirect href="/sign-in" />;
  if (!me.data) {
    if (me.isError) {
      return (
        <AccountLoadError
          error={me.error}
          onRetry={() => void me.refetch()}
          retrying={me.isFetching}
          onSignOut={() => void confirmSignOut()}
        />
      );
    }
    return <AccountLoading />;
  }
  // Already set up. Skipped while saving so it doesn't race the replace in submit().
  if (me.data.profile && update.isIdle) return <Redirect href="/contacts" />;

  const email = me.data.user.email;
  const saving = update.isPending || update.isSuccess;

  const submit = async () => {
    if (saving || uploading) return;
    const parsed = parseProfileForm(values, avatar.key, { withLinks: false });
    if (!parsed.ok) {
      setErrors(parsed.errors);
      return;
    }
    setErrors({});
    // Onboarding's own form has no links section (only the profile editor does), so a Discord
    // username from a social sign-in is carried straight into the saved profile rather than shown
    // and re-typed here; the person can still see and change it right after, in "Edit profile".
    const discordUsername = me.data?.socialPrefill?.discord;
    const input: ProfileInput = discordUsername ? { ...parsed.input, links: { discord: discordUsername } } : parsed.input;
    try {
      await update.mutateAsync(input);
      setStep('invite');
    } catch (err) {
      update.reset();
      showError(err, "Couldn't create your profile");
    }
  };

  if (step === 'invite') {
    if (referral.isPending || !referral.data) {
      return (
        <Screen edges={['top', 'bottom']} contentStyle={styles.loadingInvite}>
          <Stack.Screen options={{ title: 'Create your profile', headerShown: false }} />
          <ActivityIndicator color={theme.primary} />
        </Screen>
      );
    }
    // useEffect above already redirects past this render once referral.data says to skip it, but that
    // effect hasn't necessarily run yet on this same render - render nothing rather than flash the form.
    if (!referral.data.enabled || !referral.data.canEnterCode) return null;

    return (
      <Screen
        edges={['top', 'bottom']}
        contentStyle={styles.content}
        footer={
          <View style={styles.footer}>
            <Button title="Continue" icon="arrow-forward" onPress={() => void submitInvite()} loading={attributing} />
            <Button title="Skip" variant="ghost" onPress={finish} disabled={attributing} />
          </View>
        }>
        <Stack.Screen options={{ title: 'Did someone invite you?', headerShown: false }} />

        <View style={styles.header}>
          <Logo size={48} accessibilityLabel={null} />
          <Text variant="title" align="center" accessibilityRole="header">
            Did someone invite you?
          </Text>
          <Text variant="callout" color="textSecondary" align="center" style={styles.lead}>
            Enter their code and you earn a point.
          </Text>
        </View>

        <TextField
          label="Invite code"
          placeholder="ABCD2345"
          value={inviteCode}
          onChangeText={(v) => {
            setInviteCode(v.toUpperCase());
            setInviteSource('typed');
          }}
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={8}
          returnKeyType="done"
          editable={!attributing}
          onSubmitEditing={() => void submitInvite()}
        />
      </Screen>
    );
  }

  return (
    <Screen
      edges={['top', 'bottom']}
      contentStyle={styles.content}
      footer={
        <View style={styles.footer}>
          <Button
            title="Continue"
            icon="arrow-forward"
            onPress={() => void submit()}
            loading={saving}
            disabled={uploading}
          />
          <Text variant="caption" color="textTertiary" align="center">
            Signed in as {email}.{' '}
            <Text
              variant="captionStrong"
              color="primary"
              accessibilityRole="button"
              onPress={saving ? undefined : () => void confirmSignOut()}>
              Not you?
            </Text>
          </Text>
        </View>
      }>
      <Stack.Screen options={{ title: 'Create your profile' }} />

      <View style={styles.header}>
        <Logo size={48} accessibilityLabel={null} />
        <Text variant="title" align="center" accessibilityRole="header">
          Create your profile
        </Text>
        <Text variant="callout" color="textSecondary" align="center" style={styles.lead}>
          Your profile is what people get when they scan your QR code. Only your name is required, and you
          can change everything later.
        </Text>
      </View>

      <AvatarPicker
        name={values.displayName}
        value={avatar}
        onChange={setAvatar}
        onUploadingChange={setUploading}
        disabled={saving}
      />

      {providerImage && !avatar.key && !providerPhotoDismissed ? (
        <Card style={styles.providerPhoto}>
          <Avatar name={values.displayName || '?'} uri={providerImage} size={40} />
          <Text variant="caption" color="textSecondary" style={styles.providerPhotoText}>
            Use your sign-in photo as your profile photo?
          </Text>
          <View style={styles.providerPhotoActions}>
            <Button
              title="Use it"
              variant="secondary"
              size="sm"
              fullWidth={false}
              onPress={() => void useProviderPhoto()}
              loading={fetchingProviderPhoto}
            />
            <Button
              title="No thanks"
              variant="ghost"
              size="sm"
              fullWidth={false}
              onPress={() => setProviderPhotoDismissed(true)}
              disabled={fetchingProviderPhoto}
            />
          </View>
        </Card>
      ) : null}

      <ProfileFields
        values={values}
        errors={errors}
        onChange={(next) => {
          setValues(next);
          if (errors.displayName && next.displayName.trim()) setErrors({});
        }}
        onSubmit={() => void submit()}
        editable={!saving}
      />

      <Card style={styles.privacy}>
        <Icon name="lock-closed-outline" size={20} color="primary" />
        <Text variant="caption" color="textSecondary" style={styles.privacyText}>
          People who scan your code see your name, photo, headline, company, role and links. Your email
          is never shown.
        </Text>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: Spacing.five, paddingTop: Spacing.five, paddingBottom: Spacing.four },
  loadingInvite: { flexGrow: 1, alignItems: 'center', justifyContent: 'center' },
  header: { alignItems: 'center', gap: Spacing.three },
  lead: { maxWidth: 360 },
  privacy: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.three },
  privacyText: { flex: 1 },
  footer: { gap: Spacing.three },
  providerPhoto: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, flexWrap: 'wrap' },
  providerPhotoText: { flex: 1, minWidth: 140 },
  providerPhotoActions: { flexDirection: 'row', gap: Spacing.two },
});
