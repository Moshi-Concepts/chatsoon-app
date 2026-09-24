import { Text as RNText, type TextProps as RNTextProps } from 'react-native';

import { Fonts, Type, type ThemeColor, type TypeVariant } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type TextProps = RNTextProps & {
  variant?: TypeVariant;
  color?: ThemeColor;
  align?: 'left' | 'center' | 'right';
};

// Some theme colours are tuned for solid fills (buttons, badges) and don't meet 4.5:1 as text.
// These aliases swap them for a text-safe token at render time, so callers keep saying color="primary".
const TEXT_ALIAS = { primary: 'primaryText', success: 'successText', danger: 'dangerText' } as const;

export function Text({ variant = 'body', color = 'text', align, style, ...rest }: TextProps) {
  const theme = useTheme();
  return (
    <RNText
      style={[
        { fontFamily: Fonts.sans, color: theme[TEXT_ALIAS[color as keyof typeof TEXT_ALIAS] ?? color], textAlign: align },
        Type[variant],
        style,
      ]}
      {...rest}
    />
  );
}
