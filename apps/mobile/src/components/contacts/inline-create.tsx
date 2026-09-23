import { useState } from 'react';
import { Pressable, StyleSheet, View, type TextInputProps } from 'react-native';

import { Button, Icon, Text, TextField } from '@/components/ui';
import { Spacing } from '@/constants/theme';

/** A one-line "name it and add it" field, used for new tags and events inside the contact form. */
export function InlineCreate({
  placeholder,
  maxLength,
  autoCapitalize = 'words',
  loading,
  error,
  onCreate,
  onCancel,
}: {
  placeholder: string;
  maxLength: number;
  autoCapitalize?: TextInputProps['autoCapitalize'];
  loading: boolean;
  error: string | null;
  onCreate: (name: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const canAdd = name.trim().length > 0 && !loading;
  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <View style={styles.field}>
          <TextField
            value={name}
            onChangeText={setName}
            placeholder={placeholder}
            accessibilityLabel={placeholder}
            maxLength={maxLength}
            autoFocus
            autoCapitalize={autoCapitalize}
            autoCorrect={false}
            autoComplete="off"
            enterKeyHint="done"
            onSubmitEditing={() => canAdd && onCreate(name)}
          />
        </View>
        <Button
          title="Add"
          size="md"
          fullWidth={false}
          loading={loading}
          disabled={!canAdd}
          onPress={() => onCreate(name)}
        />
        <Pressable
          onPress={onCancel}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Cancel"
          style={styles.cancel}>
          <Icon name="close" size={22} color="textSecondary" />
        </Pressable>
      </View>
      {error ? (
        <Text variant="caption" color="danger">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  field: { flex: 1 },
  cancel: { width: 36, height: 44, alignItems: 'center', justifyContent: 'center' },
});
