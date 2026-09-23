import { Link, Stack } from 'expo-router';
import { Platform, StyleSheet } from 'react-native';

import { Button, EmptyState, Screen } from '@/components/ui';
import { PageHead } from '@/components/web/page-head';
import { WebPage } from '@/components/web/web-page';

export default function NotFoundScreen() {
  const isWeb = Platform.OS === 'web';
  const body = (
    <EmptyState
      icon="compass-outline"
      title="Page not found"
      message="The link might be broken, or the page may have moved."
      action={
        <Link href="/" replace asChild>
          <Button title="Go to Chatsoon" icon="home-outline" fullWidth={false} style={styles.centreButton} />
        </Link>
      }
    />
  );
  return (
    <>
      <Stack.Screen options={{ title: 'Not found', headerShown: !isWeb }} />
      <PageHead title="Page not found" noIndex />
      {isWeb ? (
        <WebPage contentWidth={560}>{body}</WebPage>
      ) : (
        <Screen contentStyle={styles.centre}>{body}</Screen>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  centre: { flex: 1, justifyContent: 'center' },
  centreButton: { alignSelf: 'center' },
});
