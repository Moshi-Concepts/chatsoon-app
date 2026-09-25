import { forwardRef, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, TextInput, View, type TextInputProps } from 'react-native';

import { Fonts, Radius, Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { Icon, type IconName } from './icon';
import { Text } from './text';

export type TextFieldProps = TextInputProps & {
  label?: string;
  hint?: string;
  error?: string | null;
  icon?: IconName;
  /**
   * Fixed, non-editable text shown inside the input's left edge before the editable text (e.g.
   * 'youtube.com/@'). Tapping it focuses the input. Combine with an `accessibilityLabel` that reads
   * the prefix out, since screen readers don't see this text as part of the input's own value.
   */
  prefix?: string;
};

export const TextField = forwardRef<TextInput, TextFieldProps>(function TextField(
  { label, hint, error, icon, prefix, style, multiline, onFocus, onBlur, ...rest },
  ref,
) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);
  const innerRef = useRef<TextInput>(null);
  const setRef = (node: TextInput | null) => {
    innerRef.current = node;
    if (typeof ref === 'function') ref(node);
    else if (ref) ref.current = node;
  };
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
        {prefix ? (
          <Pressable onPress={() => innerRef.current?.focus()} hitSlop={4}>
            <Text variant="body" color="textTertiary" style={styles.prefix}>
              {prefix}
            </Text>
          </Pressable>
        ) : null}
        <TextInput
          ref={setRef}
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
  // No vertical padding of its own: it sits inline with the input's own paddingVertical so the two
  // baselines line up, on both native and react-native-web (a Pressable defaults to block on web).
  prefix: (Platform.OS === 'web' ? { display: 'inline' } : {}) as object,
});
