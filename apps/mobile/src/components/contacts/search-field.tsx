import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Icon } from '@/components/ui';
import { Fonts, Radius, Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export function SearchField({
  value,
  onChangeText,
  placeholder = 'Search',
  accessibilityLabel = 'Search',
}: {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  accessibilityLabel?: string;
}) {
  const theme = useTheme();
  return (
    <View style={[styles.box, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <Icon name="search" size={18} color="textTertiary" />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.textTertiary}
        accessibilityLabel={accessibilityLabel}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="off"
        inputMode="search"
        enterKeyHint="search"
        style={[styles.input, Type.body, { color: theme.text, fontFamily: Fonts.sans }]}
      />
      {value ? (
        <Pressable
          onPress={() => onChangeText('')}
          // 18 + 13 + 13 = a 44pt target.
          hitSlop={13}
          accessibilityRole="button"
          accessibilityLabel="Clear search">
          <Icon name="close-circle" size={18} color="textTertiary" />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    height: 46,
    paddingHorizontal: Spacing.three,
    borderRadius: Radius.md,
    borderWidth: 1,
  },
  // outlineStyle removes the browser focus ring on web.
  input: { flex: 1, height: '100%', paddingVertical: 0, outlineStyle: 'none' } as object,
});
