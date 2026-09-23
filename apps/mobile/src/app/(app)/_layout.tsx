import { Redirect, Stack } from 'expo-router';

import { AccountLoadError, AccountLoading } from '@/components/profile';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { useMe } from '@/lib/queries';

// Deep links into a signed-in screen (e.g. a contact) get the tabs underneath, so back always works.
export const unstable_settings = { anchor: '(tabs)' };

// Guard for every signed-in screen: signed out -> /sign-in, no profile yet -> /onboarding.
export default function AppLayout() {
  const theme = useTheme();
  const { status, signOut } = useAuth();
  const me = useMe();

  if (status === 'signedOut') return <Redirect href="/sign-in" />;
  // Keep showing the app if a background refetch fails; only block when there is nothing cached.
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
  if (!me.data.profile) return <Redirect href="/onboarding" />;

  return (
    <Stack
      screenOptions={{
        headerTintColor: theme.primary,
        headerTitleStyle: { color: theme.text },
        headerStyle: { backgroundColor: theme.background },
        headerShadowVisible: false,
        headerBackButtonDisplayMode: 'minimal',
        contentStyle: { backgroundColor: theme.background },
        // Screens set their own titles; this stops the route name flashing before they do.
        title: '',
      }}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="contact/new" />
      <Stack.Screen name="contact/[id]/index" />
      <Stack.Screen name="contact/[id]/edit" />
      <Stack.Screen name="tags" />
      <Stack.Screen name="scan" options={{ headerShown: false, presentation: 'fullScreenModal' }} />
      <Stack.Screen name="card" options={{ presentation: 'fullScreenModal' }} />
      <Stack.Screen name="card-review/[id]" />
      <Stack.Screen name="profile-edit" />
    </Stack>
  );
}
