import type { MyProfile } from '@chatsoon/shared';
import { profileUrl } from '@chatsoon/shared';
import * as Clipboard from 'expo-clipboard';
import { router, Stack, useNavigation } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import {
  AvatarPicker,
  parseProfileForm,
  ProfileFields,
  profileToForm,
  sameProfileForm,
  type AvatarValue,
  type ProfileFormErrors,
} from '@/components/profile';
import { Button, Card, Icon, Screen, Text } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { confirm, showAlert, showError } from '@/lib/dialogs';
import { useMe, useUpdateProfile } from '@/lib/queries';

export default function ProfileEditScreen() {
  const theme = useTheme();
  const me = useMe();
  const profile = me.data?.profile;

  if (!profile) {
    return (
      <Screen contentStyle={styles.loading}>
        <Stack.Screen options={{ title: 'Edit profile' }} />
        <ActivityIndicator color={theme.primary} />
      </Screen>
    );
  }
  return <ProfileEditForm profile={profile} />;
}

function ProfileEditForm({ profile }: { profile: MyProfile }) {
  const theme = useTheme();
  const navigation = useNavigation();
  const update = useUpdateProfile();

  const [initial] = useState(() => profileToForm(profile));
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState<ProfileFormErrors>({});
  const [avatar, setAvatar] = useState<AvatarValue>({ key: profile.avatarKey, url: profile.avatarUrl });
  const [uploading, setUploading] = useState(false);
  const [copied, setCopied] = useState(false);
  // Set once saved so leaving the screen skips the unsaved-changes prompt.
  const leaving = useRef(false);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);

  const dirty = !sameProfileForm(values, initial) || avatar.key !== profile.avatarKey;
  const url = profileUrl(profile.slug);

  usePreventRemove(dirty, ({ data }) => {
    if (leaving.current) {
      navigation.dispatch(data.action);
      return;
    }
    void confirm({
      title: 'Discard changes?',
      message: "You've made changes to your profile that haven't been saved.",
      confirmText: 'Discard',
      cancelText: 'Keep editing',
      destructive: true,
    }).then((ok) => {
      if (ok) navigation.dispatch(data.action);
    });
  });

  const save = async () => {
    if (update.isPending || uploading) return;
    const parsed = parseProfileForm(values, avatar.key);
    if (!parsed.ok) {
      setErrors(parsed.errors);
      showAlert('Check your profile', Object.values(parsed.errors)[0]);
      return;
    }
    setErrors({});
    try {
      await update.mutateAsync(parsed.input);
      leaving.current = true;
      if (router.canGoBack()) router.back();
      else router.replace('/me');
    } catch (err) {
      showError(err, "Couldn't save your profile");
    }
  };

  const copyLink = async () => {
    try {
      await Clipboard.setStringAsync(url);
      setCopied(true);
    } catch (err) {
      showError(err, "Couldn't copy the link");
    }
  };

  return (
    <Screen
      contentStyle={styles.content}
      footer={
        <Button
          title="Save changes"
          onPress={() => void save()}
          loading={update.isPending}
          disabled={!dirty || uploading}
        />
      }>
      <Stack.Screen options={{ title: 'Edit profile' }} />

      <AvatarPicker
        name={values.displayName}
        value={avatar}
        onChange={setAvatar}
        onUploadingChange={setUploading}
        disabled={update.isPending}
      />

      <ProfileFields
        values={values}
        errors={errors}
        onChange={(next) => {
          setValues(next);
          if (Object.keys(errors).length) setErrors({});
        }}
        withLinks
        onSubmit={() => void save()}
        editable={!update.isPending}
      />

      <View style={styles.group}>
        <Text variant="captionStrong" color="textSecondary" style={styles.groupTitle} accessibilityRole="header">
          YOUR PUBLIC LINK
        </Text>
        <Card style={styles.linkCard}>
          <Icon name="link-outline" size={20} color="textTertiary" />
          <Text variant="callout" style={styles.linkText} numberOfLines={1} selectable>
            {url.replace(/^https?:\/\//, '')}
          </Text>
          <Pressable
            onPress={() => void copyLink()}
            accessibilityRole="button"
            accessibilityLabel={copied ? 'Link copied' : 'Copy your public link'}
            hitSlop={8}
            style={({ pressed }) => [
              styles.copy,
              { backgroundColor: pressed ? theme.primarySoft : 'transparent' },
            ]}>
            <Icon name={copied ? 'checkmark' : 'copy-outline'} size={20} color={copied ? 'success' : 'primary'} />
          </Pressable>
        </Card>
        <Text variant="caption" color="textTertiary" style={styles.note}>
          Your link never changes, even if you change your name, so QR codes you've already shared keep
          working.
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  loading: { flexGrow: 1, alignItems: 'center', justifyContent: 'center' },
  content: { gap: Spacing.six, paddingTop: Spacing.two, paddingBottom: Spacing.five },
  group: { gap: Spacing.two },
  groupTitle: { paddingHorizontal: Spacing.one, letterSpacing: 0.4 },
  note: { paddingHorizontal: Spacing.one },
  linkCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingVertical: Spacing.two },
  linkText: { flex: 1 },
  copy: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
});
