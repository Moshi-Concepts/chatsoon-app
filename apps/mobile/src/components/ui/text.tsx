import { Text as RNText, type TextProps as RNTextProps } from 'react-native';

import { Fonts, Type, type ThemeColor, type TypeVariant } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type TextProps = RNTextProps & {
  variant?: TypeVariant;
  color?: ThemeColor;
  align?: 'left' | 'center' | 'right';
};

export function Text({ variant = 'body', color = 'text', align, style, ...rest }: TextProps) {
  const theme = useTheme();
  return (
    <RNText
      style={[{ fontFamily: Fonts.sans, color: theme[color], textAlign: align }, Type[variant], style]}
      {...rest}
    />
  );
}
