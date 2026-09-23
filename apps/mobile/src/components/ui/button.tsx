import { ActivityIndicator, Pressable, StyleSheet, View, type PressableProps, type ViewStyle } from 'react-native';

import { Radius, Spacing, type ThemeColor } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { Icon, type IconName } from './icon';
import { Text } from './text';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'dangerSoft';

export type ButtonProps = Omit<PressableProps, 'style' | 'children'> & {
  title: string;
  variant?: Variant;
  size?: 'md' | 'lg' | 'sm';
  icon?: IconName;
  loading?: boolean;
  fullWidth?: boolean;
  style?: ViewStyle;
};

const palette: Record<Variant, { bg: ThemeColor | 'transparent'; fg: ThemeColor; border?: ThemeColor }> = {
  primary: { bg: 'primary', fg: 'onPrimary' },
  secondary: { bg: 'surface', fg: 'text', border: 'border' },
  ghost: { bg: 'transparent', fg: 'primary' },
  danger: { bg: 'danger', fg: 'onPrimary' },
  dangerSoft: { bg: 'dangerSoft', fg: 'danger' },
};

export function Button({
  title,
  variant = 'primary',
  size = 'lg',
  icon,
  loading,
  disabled,
  fullWidth = true,
  style,
  ...rest
}: ButtonProps) {
  const theme = useTheme();
  const p = palette[variant];
  const height = size === 'lg' ? 52 : size === 'md' ? 44 : 36;
  const isDisabled = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!isDisabled, busy: !!loading }}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.base,
        {
          height,
          paddingHorizontal: size === 'sm' ? Spacing.three : Spacing.five,
          backgroundColor: p.bg === 'transparent' ? 'transparent' : theme[p.bg],
          borderColor: p.border ? theme[p.border] : 'transparent',
          borderWidth: p.border ? StyleSheet.hairlineWidth * 2 : 0,
          alignSelf: fullWidth ? 'stretch' : 'flex-start',
          opacity: isDisabled ? 0.5 : pressed ? 0.85 : 1,
        },
        style,
      ]}
      {...rest}>
      {loading ? (
        <ActivityIndicator color={theme[p.fg]} />
      ) : (
        <View style={styles.row}>
          {icon ? <Icon name={icon} size={size === 'sm' ? 16 : 20} color={p.fg} /> : null}
          <Text variant={size === 'sm' ? 'captionStrong' : 'bodyStrong'} color={p.fg}>
            {title}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
});
