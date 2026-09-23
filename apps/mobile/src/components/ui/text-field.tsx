import { forwardRef, useState } from 'react';
import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';

import { Fonts, Radius, Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { Icon, type IconName } from './icon';
import { Text } from './text';

export type TextFieldProps = TextInputProps & {
  label?: string;
  hint?: string;
  error?: string | null;
  icon?: IconName;
};

export const TextField = forwardRef<TextInput, TextFieldProps>(function TextField(
  { label, hint, error, icon, style, multiline, onFocus, onBlur, ...rest },
  ref,
) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.wrap}>
      {label ? (
        <Text variant="captionStrong" color="textSecondary">
          {label}
        </Text>
      ) : null}
      <View
        style={[
          styles.box,
          {
            backgroundColor: theme.surface,
            borderColor: error ? theme.danger : focused ? theme.primary : theme.border,
            minHeight: multiline ? 96 : 50,
            alignItems: multiline ? 'flex-start' : 'center',
          },
        ]}>
        {icon ? (
          <View style={multiline ? styles.iconTop : undefined}>
            <Icon name={icon} size={18} color="textTertiary" />
          </View>
        ) : null}
        <TextInput
          ref={ref}
          placeholderTextColor={theme.textTertiary}
          multiline={multiline}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          style={[
            styles.input,
            Type.body,
            { color: theme.text, fontFamily: Fonts.sans, textAlignVertical: multiline ? 'top' : 'center' },
            multiline && styles.multiline,
            style,
          ]}
          {...rest}
        />
      </View>
      {error ? (
        <Text variant="caption" color="danger">
          {error}
        </Text>
      ) : hint ? (
        <Text variant="caption" color="textTertiary">
          {hint}
        </Text>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  box: {
    flexDirection: 'row',
    borderWidth: 1.5,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.four,
    gap: Spacing.two,
  },
  iconTop: { paddingTop: 14 },
  // outlineStyle removes the browser focus ring on web; the border shows focus instead.
  input: { flex: 1, paddingVertical: Spacing.three, outlineStyle: 'none' } as object,
  multiline: { minHeight: 90 },
});
