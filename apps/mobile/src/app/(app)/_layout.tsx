import { Redirect, Stack } from 'expo-router';

import { AccountLoadError, AccountLoading } from '@/components/profile';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { confirm } from '@/lib/dialogs';
import { useOutbox } from '@/lib/outbox';
import { useMe } from '@/lib/queries';

// Deep links into a signed-in screen (e.g. a contact) get the tabs underneath, so back always works.
export const unstable_settings = { anchor: '(tabs)' };

// Guard for every signed-in screen: signed out -> /sign-in, no profile yet -> /onboarding.
export default function AppLayout() {
  const theme = useTheme();
  const { status, signOut } = useAuth();
  const me = useMe();
  // Subscribing also loads the saved outbox after a cold start, so the count below is real.
  const { items: unsynced } = useOutbox();

  // Signing out wipes captures that haven't synced, so warn first (same as the Me tab). Offline
  // at an event is exactly when this screen shows up with photos still queued.
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
  // Keep showing the app if a background refetch fails; only block when there is nothing cached.
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
      <Stack.Screen name="intro" options={{ headerShown: false, gestureEnabled: false }} />
      <Stack.Screen name="contact/new" />
      <Stack.Screen name="contact/[id]/index" />
      <Stack.Screen name="contact/[id]/edit" />
      <Stack.Screen name="tags" />
      <Stack.Screen name="scan" options={{ headerShown: false, presentation: 'fullScreenModal' }} />
      <Stack.Screen name="card" options={{ presentation: 'fullScreenModal' }} />
      <Stack.Screen name="card-review/[id]" />
      <Stack.Screen name="profile-edit" />
      <Stack.Screen name="delete-account" />
      <Stack.Screen name="referrals/index" options={{ title: 'Invite friends' }} />
      <Stack.Screen name="referrals/invite" options={{ title: 'Invite contacts' }} />
      <Stack.Screen name="connected-accounts" options={{ title: 'Connected accounts' }} />
    </Stack>
  );
}
