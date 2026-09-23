import type { Tag } from '@chatsoon/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { Chip, Text } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { qk, useCreateTag, useTags } from '@/lib/queries';

import { InlineCreate } from './inline-create';

/** Tag chips that toggle, plus an inline "New tag" that creates and selects a tag. */
export function TagPicker({
  selected,
  onToggle,
}: {
  selected: string[];
  onToggle: (tagId: string, on: boolean) => void;
}) {
  const theme = useTheme();
  const qc = useQueryClient();
  const tags = useTags();
  const createTag = useCreateTag();
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create(raw: string) {
    const name = raw.trim();
    if (!name) return;
    setError(null);
    const existing = tags.data?.find((t) => t.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      onToggle(existing.id, true);
      setAdding(false);
      return;
    }
    try {
      const tag = await createTag.mutateAsync(name);
      // Show the new chip straight away; the invalidation in useCreateTag refetches the list.
      qc.setQueryData<Tag[]>(qk.tags, (list) => (list && !list.some((t) => t.id === tag.id) ? [...list, tag] : list));
      onToggle(tag.id, true);
      setAdding(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create the tag.");
    }
  }

  if (tags.isPending) {
    return (
      <View style={styles.status}>
        <ActivityIndicator color={theme.textTertiary} />
        <Text variant="caption" color="textSecondary">
          Loading tags
        </Text>
      </View>
    );
  }

  if (tags.isError && !tags.data) {
    return (
      <View style={styles.status}>
        <Text variant="caption" color="textSecondary">
          Couldn&apos;t load your tags.
        </Text>
        <Pressable onPress={() => void tags.refetch()} accessibilityRole="button" hitSlop={8}>
          <Text variant="captionStrong" color="primary">
            Try again
          </Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.chips}>
        {tags.data.map((tag) => {
          const on = selected.includes(tag.id);
          return (
            <Chip
              key={tag.id}
              label={tag.name}
              selected={on}
              icon={on ? 'checkmark' : undefined}
              onPress={() => onToggle(tag.id, !on)}
            />
          );
        })}
        {adding ? null : (
          <Chip
            label="New tag"
            icon="add"
            onPress={() => {
              setError(null);
              setAdding(true);
            }}
          />
        )}
      </View>
      {adding ? (
        <InlineCreate
          placeholder="Tag name"
          maxLength={40}
          autoCapitalize="sentences"
          loading={createTag.isPending}
          error={error}
          onCreate={(name) => void create(name)}
          onCancel={() => setAdding(false)}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.three },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  status: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, minHeight: 32 },
});
