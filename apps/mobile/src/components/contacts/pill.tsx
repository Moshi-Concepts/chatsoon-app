import { StyleSheet, View } from 'react-native';

import { Icon, Text, type IconName } from '@/components/ui';
import { Radius, Spacing, type ThemeColor } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type PillTone = 'neutral' | 'primary' | 'accent' | 'warning' | 'success' | 'danger';

const TONES: Record<PillTone, { bg: ThemeColor; fg: ThemeColor }> = {
  neutral: { bg: 'surfaceAlt', fg: 'textSecondary' },
  primary: { bg: 'primarySoft', fg: 'primary' },
  accent: { bg: 'accentSoft', fg: 'accent' },
  warning: { bg: 'warningSoft', fg: 'warning' },
  success: { bg: 'successSoft', fg: 'success' },
  danger: { bg: 'dangerSoft', fg: 'danger' },
};

/** Small read-only label: a tag in a list row, a status, a badge. */
export function Pill({
  label,
  icon,
  tone = 'neutral',
  size = 'sm',
}: {
  label: string;
  icon?: IconName;
  tone?: PillTone;
  size?: 'sm' | 'md';
}) {
  const theme = useTheme();
  const { bg, fg } = TONES[tone];
  const md = size === 'md';
  return (
    <View style={[styles.pill, md && styles.md, { backgroundColor: theme[bg] }]}>
      {icon ? <Icon name={icon} size={md ? 14 : 12} color={fg} /> : null}
      <Text variant={md ? 'captionStrong' : 'small'} color={fg} numberOfLines={1} style={styles.label}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    height: 22,
    maxWidth: 160,
    paddingHorizontal: Spacing.two,
    borderRadius: Radius.pill,
  },
  md: { height: 28, maxWidth: 260, paddingHorizontal: Spacing.three },
  label: { flexShrink: 1 },
});
