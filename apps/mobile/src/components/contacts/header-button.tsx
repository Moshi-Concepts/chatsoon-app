import { Pressable, StyleSheet } from 'react-native';

import { Icon, Text, type IconName } from '@/components/ui';
import { Spacing } from '@/constants/theme';

/** Icon-only button for a navigation header (headerRight). */
export function HeaderIconButton({
  icon,
  label,
  onPress,
}: {
  icon: IconName;
  /** Read by screen readers, since there is no visible text. */
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.button, { opacity: pressed ? 0.6 : 1 }]}>
      <Icon name={icon} size={28} color="primary" />
    </Pressable>
  );
}

/** Text button for a navigation header, e.g. "Edit". */
export function HeaderTextButton({
  title,
  onPress,
  disabled,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => [styles.button, { opacity: disabled ? 0.4 : pressed ? 0.6 : 1 }]}>
      <Text variant="bodyStrong" color="primary">
        {title}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { paddingHorizontal: Spacing.two, minHeight: 36, alignItems: 'center', justifyContent: 'center' },
});
