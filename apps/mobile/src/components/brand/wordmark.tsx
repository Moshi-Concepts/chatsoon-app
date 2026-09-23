import { APP_NAME, TAGLINE } from '@chatsoon/shared';
import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui';
import { Spacing } from '@/constants/theme';

import { Logo } from './logo';

type Size = 'sm' | 'md' | 'lg';

const NAME_SIZE: Record<Size, number> = { sm: 20, md: 28, lg: 36 };

export type WordmarkProps = {
  size?: Size;
  /** Show "Meet people. Follow up." under the name. */
  tagline?: boolean;
  /** Show the mark to the left of the name. */
  withLogo?: boolean;
  align?: 'left' | 'center';
};

/** "Chatsoon" set in the brand style, with an optional tagline and mark. */
export function Wordmark({ size = 'md', tagline = false, withLogo = false, align = 'center' }: WordmarkProps) {
  const fontSize = NAME_SIZE[size];
  const center = align === 'center';
  return (
    <View
      style={[styles.wrap, { alignItems: center ? 'center' : 'flex-start' }]}
      accessible
      accessibilityRole="header"
      accessibilityLabel={tagline ? `${APP_NAME}. ${TAGLINE}` : APP_NAME}>
      <View style={styles.row}>
        {withLogo ? <Logo size={Math.round(fontSize * 1.25)} accessibilityLabel={null} /> : null}
        <Text style={[styles.name, { fontSize, lineHeight: Math.round(fontSize * 1.2) }]}>{APP_NAME}</Text>
      </View>
      {tagline ? (
        <Text
          variant={size === 'sm' ? 'caption' : 'callout'}
          color="textSecondary"
          align={center ? 'center' : 'left'}>
          {TAGLINE}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.one },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  name: { fontWeight: '800', letterSpacing: -0.6 },
});
