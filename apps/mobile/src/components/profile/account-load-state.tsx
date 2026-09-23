import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, EmptyState } from '@/components/ui';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { isNetworkError } from '@/lib/api';

/** Full-screen spinner shown while the signed-in account loads. */
export function AccountLoading() {
  const theme = useTheme();
  return (
    <View
      style={[styles.fill, { backgroundColor: theme.background }]}
      accessibilityLabel="Loading your account"
      accessibilityRole="progressbar">
      <ActivityIndicator size="large" color={theme.primary} />
    </View>
  );
}

/** Full-screen error with retry, for when GET /me fails (usually because the device is offline). */
export function AccountLoadError({
  error,
  onRetry,
  retrying,
  onSignOut,
}: {
  error: unknown;
  onRetry: () => void;
  retrying?: boolean;
  onSignOut?: () => void;
}) {
  const theme = useTheme();
  const offline = isNetworkError(error);
  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: theme.background }]}>
      <View style={styles.column}>
        <EmptyState
          icon={offline ? 'cloud-offline-outline' : 'alert-circle-outline'}
          title={offline ? "You're offline" : "Couldn't load your account"}
          message={
            offline
              ? 'Chatsoon needs a connection to load your profile. Check your internet and try again.'
              : 'Something went wrong on our side. Please try again in a moment.'
          }
          action={
            <View style={styles.actions}>
              <Button title="Try again" icon="refresh" onPress={onRetry} loading={retrying} />
              {onSignOut ? <Button title="Sign out" variant="ghost" onPress={onSignOut} /> : null}
            </View>
          }
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  column: { width: '100%', maxWidth: MaxContentWidth, paddingHorizontal: Spacing.five },
  actions: { alignSelf: 'stretch', gap: Spacing.two },
});
