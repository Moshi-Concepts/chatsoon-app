import { Redirect, Stack } from 'expo-router';
import { Platform } from 'react-native';

import { Landing } from '@/components/web/landing';
import { useAuth } from '@/lib/auth';

/** Entry: signed in -> contacts. Signed out: the app goes to sign in, the website shows the landing page. */
export default function Index() {
  const { status } = useAuth();

  if (status === 'loading') return null;
  if (status === 'signedIn') return <Redirect href="/contacts" />;
  if (Platform.OS !== 'web') return <Redirect href="/sign-in" />;

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <Landing />
    </>
  );
}
