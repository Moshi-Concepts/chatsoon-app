import { APP_NAME } from '@chatsoon/shared';
import { Link } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { Button } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';

import { BrandMark } from './brand-mark';
import { Container } from './layout';

export function SiteHeader() {
  const theme = useTheme();
  const { status } = useAuth();
  const signedIn = status === 'signedIn';
  return (
    <View role="banner" style={[styles.bar, { borderBottomColor: theme.border }]}>
      <Container style={styles.row}>
        <Link href="/" asChild>
          <Pressable accessibilityLabel={`${APP_NAME} home`} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
            <BrandMark />
          </Pressable>
        </Link>
        <Link href={signedIn ? '/contacts' : '/sign-in'} asChild>
          <Button
            title={signedIn ? 'Open Chatsoon' : 'Sign in'}
            variant="secondary"
            size="sm"
            fullWidth={false}
            style={styles.button}
          />
        </Link>
      </Container>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { borderBottomWidth: StyleSheet.hairlineWidth },
  button: { alignSelf: 'center' },
  row: {
    height: 64,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
  },
});
