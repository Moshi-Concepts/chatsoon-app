import type { ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { Spacing, type ThemeColor } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { Icon, type IconName } from './icon';
import { Text } from './text';

export type ListRowProps = {
  title: string;
  subtitle?: string | null;
  icon?: IconName;
  iconColor?: ThemeColor;
  left?: ReactNode;
  right?: ReactNode;
  onPress?: () => void;
  chevron?: boolean;
  destructive?: boolean;
  /** Draw a hairline under the row (for grouped lists). */
  divider?: boolean;
  accessibilityLabel?: string;
};

export function ListRow({
  title,
  subtitle,
  icon,
  iconColor,
  left,
  right,
  onPress,
  chevron = !!onPress,
  destructive,
  divider,
  accessibilityLabel,
}: ListRowProps) {
  const theme = useTheme();
  const leading =
    left ?? (icon ? <Icon name={icon} size={20} color={iconColor ?? (destructive ? 'danger' : 'textSecondary')} /> : null);
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={accessibilityLabel ?? title}
      // Rows usually span an unpadded, overflow:hidden Card (Section); global.css gives this an
      // inward focus ring instead of the default outward one, which the card would clip.
      {...(Platform.OS === 'web' ? { dataSet: { focusRing: 'inset' } } : {})}
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: pressed && onPress ? theme.surfaceAlt : 'transparent' },
        divider && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.border },
      ]}>
      {leading}
      <View style={styles.body}>
        <Text variant="body" color={destructive ? 'danger' : 'text'} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="caption" color="textSecondary" numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right}
      {chevron ? <Icon name="chevron-forward" size={18} color="textTertiary" /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.four,
    paddingVertical: 14,
    minHeight: 52,
  },
  body: { flex: 1, gap: 2 },
});
