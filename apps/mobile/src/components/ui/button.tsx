import { ActivityIndicator, Pressable, StyleSheet, View, type PressableProps, type ViewStyle } from 'react-native';

import { Radius, Spacing, type ThemeColor } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { Icon, type IconName } from './icon';
import { Text } from './text';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'dangerSoft' | 'inverse';

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
  // White background, primary-coloured text: for a primary action placed on a solid `primary` surface
  // (e.g. the "Get your own free profile" promo card), where the ordinary `primary` variant would
  // disappear into its own background.
  inverse: { bg: 'onPrimary', fg: 'primary' },
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
  // `Text`'s `color` prop aliases 'primary' to 'primaryText', a token tuned for use on dark/soft
  // surfaces (design.ts). `inverse`'s label sits on a solid white (`onPrimary`) button face instead,
  // where `primaryText` (e.g. dark mode's #8F88FF) falls well under 4.5:1 — so override with the raw
  // `primary` token, which is what `Icon`/`ActivityIndicator` below already use unaliased.
  const labelColorOverride = variant === 'inverse' ? theme[p.fg] : undefined;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!isDisabled, busy: !!loading }}
      disabled={isDisabled}
      // Small buttons are 36pt tall: reach a 44pt target (callers can still override).
      hitSlop={size === 'sm' ? 4 : undefined}
      style={({ pressed }) => [
        styles.base,
        {
          // A minimum, so the largest accessibility text sizes can still grow the button.
          minHeight: height,
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
          {/* One line: in narrow side-by-side footers a long label shrinks instead of breaking mid-word. */}
          <Text
            variant={size === 'sm' ? 'captionStrong' : 'bodyStrong'}
            color={p.fg}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.7}
            style={labelColorOverride ? [styles.label, { color: labelColorOverride }] : styles.label}>
            {title}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, maxWidth: '100%' },
  label: { flexShrink: 1 },
});
