import { Pressable, StyleSheet, View } from 'react-native';

import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { Icon } from './icon';
import { Text } from './text';

/**
 * A small accessible checkbox row: an icon (checkbox / square-outline) plus a label, both tappable.
 * The UI kit had no checkbox before issue #7's Connect form tips opt-in, so this is a minimal one
 * built from Pressable + Icon, following the same accessibility pattern as PriorityPicker's
 * accessibilityRole="radio" (components/contacts/priority.tsx): react-native-web doesn't bridge
 * accessibilityState.checked to aria-checked for a custom role (axe: aria-required-attr), so the
 * cross-platform aria-checked prop is set explicitly too.
 */
export function Checkbox({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={() => onChange(!checked)}
      disabled={disabled}
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled }}
      aria-checked={checked}
      accessibilityLabel={label}
      style={({ pressed }) => [styles.row, pressed && !disabled ? { backgroundColor: theme.surfaceAlt } : null]}>
      <Icon name={checked ? 'checkbox' : 'square-outline'} size={20} color={checked ? 'primary' : 'textSecondary'} />
      <View style={styles.labelWrap}>
        <Text variant="body">{label}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    minHeight: 44,
    borderRadius: 8,
  },
  labelWrap: { flex: 1 },
});
