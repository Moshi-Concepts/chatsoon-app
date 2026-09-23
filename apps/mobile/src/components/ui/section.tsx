import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { Spacing } from '@/constants/theme';

import { Card } from './card';
import { Text } from './text';

/** Titled group, e.g. a block of settings rows. Children are usually ListRow with divider. */
export function Section({
  title,
  footer,
  children,
  inset = true,
}: {
  title?: string;
  footer?: string;
  children: ReactNode;
  /** Wrap children in a Card (default true). */
  inset?: boolean;
}) {
  return (
    <View style={styles.wrap}>
      {title ? (
        <Text variant="captionStrong" color="textSecondary" style={styles.title}>
          {title.toUpperCase()}
        </Text>
      ) : null}
      {inset ? <Card padded={false}>{children}</Card> : children}
      {footer ? (
        <Text variant="caption" color="textTertiary" style={styles.title}>
          {footer}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.two },
  title: { paddingHorizontal: Spacing.one, letterSpacing: 0.4 },
});
