import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { Icon, type IconName } from './icon';
import { Text } from './text';

export function EmptyState({
  icon,
  title,
  message,
  action,
}: {
  icon: IconName;
  title: string;
  message?: string;
  action?: ReactNode;
}) {
  const theme = useTheme();
  return (
    <View style={styles.wrap}>
      <View style={[styles.badge, { backgroundColor: theme.primarySoft }]}>
        <Icon name={icon} size={30} color="primary" />
      </View>
      <Text variant="heading" align="center">
        {title}
      </Text>
      {message ? (
        <Text variant="callout" color="textSecondary" align="center" style={styles.message}>
          {message}
        </Text>
      ) : null}
      {action ? <View style={styles.action}>{action}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center', paddingVertical: Spacing.seven, gap: Spacing.three },
  badge: { width: 72, height: 72, borderRadius: Radius.xl, alignItems: 'center', justifyContent: 'center' },
  message: { maxWidth: 320 },
  action: { marginTop: Spacing.three, alignSelf: 'stretch', alignItems: 'center' },
});
