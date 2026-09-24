import { bookingOpenUrl, type BookingLink } from '@chatsoon/shared';
import { useState } from 'react';
import { ActivityIndicator, Linking, StyleSheet, View } from 'react-native';
import WebView from 'react-native-webview';

import { Button, Text } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { showError } from '@/lib/dialogs';

// http(s) loads in the webview; about: is the blank page it starts on. Anything else (mailto:,
// tel:, zoommtg:, intent:) goes to the system handler instead.
const WEBVIEW_SCHEMES = /^(https?|about):/i;

/** Native booking embed: react-native-webview loading the link top-level. */
export function BookingEmbed({ link }: { link: BookingLink; embedDomain: string }) {
  const theme = useTheme();
  const url = bookingOpenUrl(link);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  // Bumped to remount the WebView (a fresh `key`) for "Try again".
  const [attempt, setAttempt] = useState(0);

  if (failed) {
    return (
      <View style={styles.center}>
        <Text variant="body" color="textSecondary" align="center">
          Couldn&apos;t load the booking page
        </Text>
        <View style={styles.actions}>
          <Button
            title="Try again"
            variant="secondary"
            fullWidth={false}
            onPress={() => {
              setFailed(false);
              setLoading(true);
              setAttempt((a) => a + 1);
            }}
          />
          <Button
            title="Open in browser"
            fullWidth={false}
            onPress={() => void Linking.openURL(url).catch((err: unknown) => showError(err, "Couldn't open the link"))}
          />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.flex}>
      <WebView
        key={attempt}
        source={{ uri: url }}
        style={styles.flex}
        setSupportMultipleWindows={false}
        allowsBackForwardNavigationGestures
        onShouldStartLoadWithRequest={(request) => {
          // Frames inside the page (payment forms, captchas, about:srcdoc) always load. iOS only sets isTopFrame.
          if (request.isTopFrame === false || WEBVIEW_SCHEMES.test(request.url)) return true;
          Linking.openURL(request.url).catch(() => {});
          return false;
        }}
        onLoadEnd={() => setLoading(false)}
        onError={() => {
          setLoading(false);
          setFailed(true);
        }}
      />
      {loading ? (
        <View style={[StyleSheet.absoluteFill, styles.loading, { backgroundColor: theme.surface }]}>
          <ActivityIndicator color={theme.primary} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.four, padding: Spacing.five },
  actions: { flexDirection: 'row', gap: Spacing.three },
  loading: { alignItems: 'center', justifyContent: 'center' },
});
