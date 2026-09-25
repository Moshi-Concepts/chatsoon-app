import { Pressable, StyleSheet } from 'react-native';

import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { Icon, type IconName } from './icon';
import { Text } from './text';

export function Chip({
  label,
  selected,
  onPress,
  icon,
  count,
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  icon?: IconName;
  /** Shown after the label in a muted style, e.g. "Investor · 3". Also drives the accessibility label. */
  count?: number;
}) {
  const theme = useTheme();
  const accessibilityLabel = count == null ? undefined : `${label}, ${count} ${count === 1 ? 'contact' : 'contacts'}`;
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      // 36 + 4 + 4 = a 44pt target; with the usual 8pt gaps, neighbours' slop touches but never overlaps.
      hitSlop={4}
      accessibilityRole={onPress ? 'button' : 'text'}
      accessibilityState={{ selected: !!selected }}
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [
        styles.chip,
        {
          backgroundColor: selected ? theme.primary : theme.surface,
          borderColor: selected ? theme.primary : theme.border,
          opacity: pressed ? 0.8 : 1,
        },
      ]}>
      {icon ? <Icon name={icon} size={14} color={selected ? 'onPrimary' : 'textSecondary'} /> : null}
      <Text variant="captionStrong" color={selected ? 'onPrimary' : 'text'}>
        {label}
      </Text>
      {count != null ? (
        <Text
          variant="captionStrong"
          color={selected ? 'onPrimary' : 'textSecondary'}
          style={selected ? styles.countSelected : undefined}>
          · {count}
        </Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    paddingHorizontal: Spacing.three,
    height: 36,
    borderRadius: Radius.pill,
    borderWidth: 1,
  },
  countSelected: { opacity: 0.75 },
});
