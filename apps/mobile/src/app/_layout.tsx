import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import Head from 'expo-router/head';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { AuthProvider, useAuth } from '@/lib/auth';
import { OutboxSync } from '@/lib/outbox';

void SplashScreen.preventAutoHideAsync();

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false },
      mutations: { retry: 0 },
    },
  });
}

function RootStack() {
  const { status } = useAuth();
  const scheme = useColorScheme();
  const colors = Colors[scheme === 'dark' ? 'dark' : 'light'];

  useEffect(() => {
    if (status !== 'loading') void SplashScreen.hideAsync();
  }, [status]);

  if (status === 'loading') return null;

  return (
    <>
      {Platform.OS === 'web' ? (
        // Default tab title; pages that set their own override it.
        <Head>
          <title>Chatsoon</title>
        </Head>
      ) : null}
      <Stack
        screenOptions={{
          headerTintColor: colors.primary,
          headerTitleStyle: { color: colors.text },
          headerStyle: { backgroundColor: colors.background },
          headerShadowVisible: false,
          headerBackButtonDisplayMode: 'minimal',
          contentStyle: { backgroundColor: colors.background },
        }}>
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="sign-in" options={{ headerShown: false }} />
        <Stack.Screen name="auth-complete" options={{ headerShown: false }} />
        <Stack.Screen name="cancel-deletion" options={{ headerShown: false }} />
        <Stack.Screen name="onboarding" options={{ headerShown: false, gestureEnabled: false }} />
        <Stack.Screen name="(app)" options={{ headerShown: false }} />
        <Stack.Screen name="id/[slug]" options={{ title: '' }} />
        <Stack.Screen name="privacy" options={{ title: 'Privacy policy' }} />
        <Stack.Screen name="terms" options={{ title: 'Terms of use' }} />
        <Stack.Screen name="support" options={{ title: 'Support' }} />
        <Stack.Screen name="accessibility" options={{ title: 'Accessibility statement' }} />
      </Stack>
      {status === 'signedIn' ? <OutboxSync /> : null}
    </>
  );
}

export default function RootLayout() {
  const scheme = useColorScheme();
  const [queryClient] = useState(makeQueryClient);
  const navTheme = scheme === 'dark' ? DarkTheme : DefaultTheme;
  const colors = Colors[scheme === 'dark' ? 'dark' : 'light'];

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <ThemeProvider
              value={{
                ...navTheme,
                colors: {
                  ...navTheme.colors,
                  primary: colors.primary,
                  background: colors.background,
                  card: colors.surface,
                  text: colors.text,
                  border: colors.border,
                },
              }}>
              <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
              <RootStack />
            </ThemeProvider>
          </AuthProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
