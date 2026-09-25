import { profileUrl } from '@chatsoon/shared';
import * as Brightness from 'expo-brightness';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { router, Stack, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, AppState, Platform, Share, StyleSheet, useWindowDimensions, View } from 'react-native';

import { ProfileQrCard } from '@/components/profile';
import { Avatar, Button, Screen, Text } from '@/components/ui';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { showAlert, showError } from '@/lib/dialogs';
import { useMe, useReferral } from '@/lib/queries';

/** Screen padding (16) plus the card's quiet zone on each side, roughly. */
const QR_SIDE_SPACE = 88;
const QR_MAX = 280;

/**
 * Turns the screen up to full brightness while the app is in the foreground and puts it back
 * afterwards. Returns the function that stops it. Any failure just leaves brightness alone.
 */
function boostBrightness(): () => void {
  let active = true;
  let raised = false;
  let previous: number | null = null;
  // Bumped by every raise and restore, so a raise still reading the old level when the app
  // flips inactive and back gives way to the newer one instead of saving full brightness as
  // the level to go back to.
  let generation = 0;

  const raise = async () => {
    const run = ++generation;
    try {
      // Read the level each time: the user may have changed it (Control Center) while away.
      const level = raised ? previous : await Brightness.getBrightnessAsync();
      if (!active || run !== generation || AppState.currentState !== 'active') return;
      previous = level;
      raised = true;
      await Brightness.setBrightnessAsync(1);
    } catch {
      // Brightness is a nicety; never block the QR on it.
    }
  };

  const restore = async () => {
    generation++;
    if (!raised) return;
    raised = false;
    try {
      // Android: hand control back to the system setting. iOS: put the old level back.
      if (Platform.OS === 'android') await Brightness.restoreSystemBrightnessAsync();
      else if (previous !== null) await Brightness.setBrightnessAsync(previous);
    } catch {
      // ignore
    }
  };

  void raise();
  // iOS keeps a changed brightness after the user leaves the app, so restore it on background.
  const sub = AppState.addEventListener('change', (state) => {
    if (state === 'active') void raise();
    else void restore();
  });
  return () => {
    active = false;
    sub.remove();
    void restore();
  };
}

/** Full brightness while the screen is focused (native only), so the code scans in a dim room. */
function useMaxBrightness() {
  useFocusEffect(
    useCallback(() => {
      if (Platform.OS === 'web') return;
      return boostBrightness();
    }, []),
  );
}

/** Copies the link. Returns false (after telling the user) when the clipboard is unavailable. */
async function copyToClipboard(url: string): Promise<boolean> {
  try {
    await Clipboard.setStringAsync(url);
  } catch (err) {
    showError(err, "Couldn't copy the link");
    return false;
  }
  if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  return true;
}

/**
 * Native share sheet on iOS and Android. On web: the Web Share API where the browser has it,
 * otherwise the link is copied. Returns true when it fell back to copying.
 */
async function shareProfileLink(url: string, displayName: string): Promise<boolean> {
  if (Platform.OS !== 'web') {
    // iOS shares the URL as a link (with a preview); Android only reads `message`.
    const content = Platform.OS === 'ios' ? { url } : { message: url, title: 'My Chatsoon profile' };
    try {
      await Share.share(content, { dialogTitle: 'Share your profile' });
    } catch (err) {
      showError(err, "Couldn't open the share sheet");
    }
    return false;
  }
  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      await navigator.share({ title: `${displayName} on Chatsoon`, url });
      return false;
    } catch (err) {
      // Closing the share sheet is not an error.
      if (err instanceof Error && err.name === 'AbortError') return false;
    }
  }
  if (!(await copyToClipboard(url))) return false;
  showAlert('Link copied', 'Paste it anywhere to share your profile.');
  return true;
}

export default function MyQrScreen() {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const me = useMe();
  const referral = useReferral();
  const profile = me.data?.profile;
  const [copied, setCopied] = useState(false);

  useMaxBrightness();

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);

  if (!profile) {
    return (
      <Screen edges={[]} contentStyle={styles.loading}>
        <Stack.Screen options={{ title: 'My QR' }} />
        <ActivityIndicator color={theme.primary} />
      </Screen>
    );
  }

  const url = profileUrl(profile.slug);
  const displayUrl = url.replace(/^https?:\/\//, '');
  const qrSize = Math.max(180, Math.min(QR_MAX, Math.min(width, MaxContentWidth) - QR_SIDE_SPACE));
  // The QR payload only, not the displayed/shared/copied link (issue #11, docs/referrals.md "Entry
  // points"): plain while referrals are off or the code hasn't loaded yet, so a printed/cached code
  // never breaks.
  const qrValue = referral.data?.enabled && referral.data.code ? `${url}?ref=${referral.data.code}` : url;

  const copyLink = async () => {
    if (await copyToClipboard(url)) setCopied(true);
  };

  const share = async () => {
    if (await shareProfileLink(url, profile.displayName)) setCopied(true);
  };

  return (
    <Screen
      edges={[]}
      contentStyle={styles.content}
      onRefresh={() => void me.refetch()}
      refreshing={me.isRefetching}>
      <Stack.Screen options={{ title: 'My QR' }} />

      <View style={styles.person}>
        <Avatar name={profile.displayName} uri={profile.avatarUrl} size={56} />
        <View style={styles.personText}>
          <Text variant="subheading" numberOfLines={1}>
            {profile.displayName}
          </Text>
          {profile.headline ? (
            <Text variant="callout" color="textSecondary" numberOfLines={2}>
              {profile.headline}
            </Text>
          ) : null}
        </View>
      </View>

      <ProfileQrCard
        value={qrValue}
        size={qrSize}
        accessibilityLabel={`QR code for ${profile.displayName}'s Chatsoon profile`}
      />

      <View style={styles.caption}>
        <Text variant="captionStrong" color="primary" align="center" selectable numberOfLines={1}>
          {displayUrl}
        </Text>
        <Text variant="caption" color="textTertiary" align="center">
          Anyone can scan this with their phone camera to see your profile and connect, even without the app.
        </Text>
      </View>

      <View style={styles.actions}>
        <View style={styles.row}>
          <Button title="Share" icon="share-outline" onPress={() => void share()} style={styles.flex} />
          <Button
            title={copied ? 'Copied' : 'Copy link'}
            icon={copied ? 'checkmark' : 'copy-outline'}
            variant="secondary"
            onPress={() => void copyLink()}
            accessibilityLabel={copied ? 'Link copied' : 'Copy link'}
            style={styles.flex}
          />
        </View>
        <Button title="Scan someone" icon="scan-outline" variant="ghost" onPress={() => router.push('/scan')} />
        {referral.data?.enabled ? (
          <Button
            title="Invite friends and earn points"
            variant="ghost"
            size="sm"
            onPress={() => router.push('/referrals')}
          />
        ) : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  loading: { flexGrow: 1, alignItems: 'center', justifyContent: 'center' },
  content: { gap: Spacing.five, paddingTop: Spacing.two },
  person: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, alignSelf: 'center', maxWidth: '100%' },
  personText: { flexShrink: 1, gap: 2 },
  caption: { gap: Spacing.one, paddingHorizontal: Spacing.four },
  actions: { gap: Spacing.two },
  row: { flexDirection: 'row', gap: Spacing.three },
  flex: { flex: 1 },
});
