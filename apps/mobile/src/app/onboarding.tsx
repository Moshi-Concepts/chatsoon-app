import { Redirect, router, Stack } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

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
import { Button, Card, Icon, Screen, Text } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth';
import { showError } from '@/lib/dialogs';
import { useMe, useUpdateProfile } from '@/lib/queries';

// First run: signed in, but no profile yet. The profile is what people get when they scan your QR.
export default function OnboardingScreen() {
  const { status, signOut } = useAuth();
  const me = useMe();
  const update = useUpdateProfile();

  const [values, setValues] = useState(() => profileToForm(null));
  const [errors, setErrors] = useState<ProfileFormErrors>({});
  const [avatar, setAvatar] = useState<AvatarValue>({ key: null, url: null });
  const [uploading, setUploading] = useState(false);

  if (status === 'signedOut') return <Redirect href="/sign-in" />;
  if (!me.data) {
    if (me.isError) {
      return (
        <AccountLoadError
          error={me.error}
          onRetry={() => void me.refetch()}
          retrying={me.isFetching}
          onSignOut={() => void signOut()}
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
    try {
      await update.mutateAsync(parsed.input);
      router.replace('/contacts');
    } catch (err) {
      update.reset();
      showError(err, "Couldn't create your profile");
    }
  };

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
              onPress={saving ? undefined : () => void signOut()}>
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
  header: { alignItems: 'center', gap: Spacing.three },
  lead: { maxWidth: 360 },
  privacy: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.three },
  privacyText: { flex: 1 },
  footer: { gap: Spacing.three },
});
