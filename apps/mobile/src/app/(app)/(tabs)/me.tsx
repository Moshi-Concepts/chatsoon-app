import { APP_NAME, COPYRIGHT, profileUrl } from '@chatsoon/shared';
import Constants from 'expo-constants';
import { router, Stack } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, View } from 'react-native';

import { Avatar, Button, Card, ListRow, Screen, Section, Text } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { confirm, showAlert, showError } from '@/lib/dialogs';
import { deleteExportedFiles, exportContactsCsv } from '@/lib/export';
import { roleLine } from '@/lib/format';
import { useOutbox } from '@/lib/outbox';
import { useMe } from '@/lib/queries';

const YEAR = new Date().getFullYear();

/**
 * The version people see, e.g. "1.0.0". No build number: EAS manages those remotely
 * (appVersionSource "remote"), so the one in the bundled app config is not the real build.
 */
function appVersion(): string {
  return Constants.expoConfig?.version ?? '1.0.0';
}

export default function MeScreen() {
  const theme = useTheme();
  const me = useMe();
  const { signOut, clearSession } = useAuth();
  const { items: unsynced } = useOutbox();
  const [exporting, setExporting] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const profile = me.data?.profile;
  if (!me.data || !profile) {
    return (
      <Screen edges={[]} contentStyle={styles.loading}>
        <Stack.Screen options={{ title: 'Me' }} />
        <ActivityIndicator color={theme.primary} />
      </Screen>
    );
  }

  const email = me.data.user.email;
  const url = profileUrl(profile.slug);
  const subtitle = roleLine(profile.role, profile.company);
  const busy = signingOut || deleting;

  const openPublicPage = async () => {
    if (Platform.OS === 'web') {
      window.open(url, '_blank', 'noopener,noreferrer');
      return;
    }
    try {
      await WebBrowser.openBrowserAsync(url, { controlsColor: theme.primary, toolbarColor: theme.background });
    } catch (err) {
      showError(err, "Couldn't open your page");
    }
  };

  const exportContacts = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      await exportContactsCsv();
    } catch (err) {
      showError(err, "Couldn't export your contacts");
    }
    setExporting(false);
  };

  const confirmSignOut = async () => {
    const pending = unsynced.length;
    const ok = await confirm({
      title: 'Sign out?',
      message:
        pending > 0
          ? `${pending} ${pending === 1 ? "contact hasn't" : "contacts haven't"} synced yet and will be lost if you sign out now.`
          : 'You can sign back in any time with your email.',
      confirmText: 'Sign out',
      destructive: pending > 0,
    });
    if (!ok) return;
    setSigningOut(true);
    try {
      await signOut();
    } catch (err) {
      setSigningOut(false);
      showError(err, "Couldn't sign out");
      return;
    }
    deleteExportedFiles();
    router.replace('/sign-in');
  };

  const confirmDelete = async () => {
    const ok = await confirm({
      title: 'Delete your account?',
      message:
        "This permanently deletes your profile, contacts, notes, tags and photos. It can't be undone.",
      confirmText: 'Delete account',
      destructive: true,
    });
    if (!ok) return;
    setDeleting(true);
    try {
      await api.me.deleteAccount();
    } catch (err) {
      setDeleting(false);
      showError(err, "Couldn't delete your account");
      return;
    }
    // The account is gone on the server now, so a local clean-up hiccup must not report
    // "Couldn't delete". Its sessions are revoked too, so a token left in storage just gets a
    // 401 on the next launch, which signs out.
    deleteExportedFiles();
    await clearSession().catch(() => undefined);
    router.replace('/sign-in');
    showAlert('Account deleted', 'Your account and all of your data have been removed.');
  };

  return (
    <Screen edges={[]} onRefresh={() => void me.refetch()} refreshing={me.isRefetching} contentStyle={styles.content}>
      <Stack.Screen options={{ title: 'Me' }} />

      <Card style={styles.profileCard}>
        <View style={styles.person}>
          <Avatar name={profile.displayName} uri={profile.avatarUrl} size={64} />
          <View style={styles.personText}>
            <Text variant="heading" numberOfLines={1}>
              {profile.displayName}
            </Text>
            {profile.headline ? (
              <Text variant="callout" color="textSecondary" numberOfLines={2}>
                {profile.headline}
              </Text>
            ) : null}
            {subtitle ? (
              <Text variant="caption" color="textTertiary" numberOfLines={1}>
                {subtitle}
              </Text>
            ) : null}
          </View>
        </View>
        <Text variant="caption" color="primary" numberOfLines={1} selectable>
          {url.replace(/^https?:\/\//, '')}
        </Text>
        <View style={styles.cardActions}>
          <Button
            title="Edit profile"
            icon="create-outline"
            variant="secondary"
            size="sm"
            fullWidth={false}
            onPress={() => router.push('/profile-edit')}
          />
          <Button
            title="View my public page"
            icon="open-outline"
            variant="secondary"
            size="sm"
            fullWidth={false}
            onPress={() => void openPublicPage()}
            accessibilityHint="Opens your public profile in the browser"
          />
        </View>
      </Card>

      <Section title="Contacts">
        <ListRow icon="pricetags-outline" title="Manage tags" onPress={() => router.push('/tags')} divider />
        <ListRow
          icon="download-outline"
          title="Export contacts (CSV)"
          subtitle="A spreadsheet of everyone you've saved"
          onPress={exporting ? undefined : () => void exportContacts()}
          chevron={!exporting}
          right={exporting ? <ActivityIndicator color={theme.primary} /> : undefined}
        />
      </Section>

      <Section title="Legal and help">
        <ListRow
          icon="shield-checkmark-outline"
          title="Privacy policy"
          onPress={() => router.push('/privacy')}
          divider
        />
        <ListRow icon="document-text-outline" title="Terms of use" onPress={() => router.push('/terms')} divider />
        <ListRow icon="help-circle-outline" title="Support" onPress={() => router.push('/support')} />
      </Section>

      <Section
        title="Account"
        footer="Deleting your account permanently removes your profile, contacts, notes, tags and photos.">
        <ListRow icon="mail-outline" title={email} subtitle="Signed in with this email" divider />
        <ListRow
          icon="log-out-outline"
          title="Sign out"
          onPress={busy ? undefined : () => void confirmSignOut()}
          chevron={false}
          right={signingOut ? <ActivityIndicator color={theme.primary} /> : undefined}
          divider
        />
        <ListRow
          icon="trash-outline"
          title="Delete account"
          destructive
          onPress={busy ? undefined : () => void confirmDelete()}
          chevron={false}
          right={deleting ? <ActivityIndicator color={theme.danger} /> : undefined}
        />
      </Section>

      <View style={styles.about}>
        <Text variant="small" color="textTertiary" align="center">
          {APP_NAME} {appVersion()}
        </Text>
        <Text variant="small" color="textTertiary" align="center">
          © {YEAR} {COPYRIGHT}
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  loading: { flexGrow: 1, alignItems: 'center', justifyContent: 'center' },
  content: { gap: Spacing.five, paddingBottom: Spacing.four },
  profileCard: { gap: Spacing.three },
  person: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  personText: { flex: 1, gap: 2 },
  cardActions: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, marginTop: Spacing.one },
  about: { gap: 2, paddingTop: Spacing.two },
});
