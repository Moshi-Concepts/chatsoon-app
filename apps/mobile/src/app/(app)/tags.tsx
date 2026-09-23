import type { Tag } from '@chatsoon/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, View } from 'react-native';

import { plural } from '@/components/contacts/source';
import { Button, EmptyState, Icon, ListRow, Screen, Section, Text, TextField } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { ApiError } from '@/lib/api';
import { confirm, showError } from '@/lib/dialogs';
import { qk, useContacts, useCreateTag, useDeleteTag, useTags } from '@/lib/queries';

const MAX_TAG_LENGTH = 40;

export default function TagsScreen() {
  const theme = useTheme();
  const qc = useQueryClient();
  const tags = useTags();
  const contacts = useContacts();
  const createTag = useCreateTag();
  const deleteTag = useDeleteTag();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of contacts.data ?? []) for (const id of c.tagIds) map.set(id, (map.get(id) ?? 0) + 1);
    return map;
  }, [contacts.data]);

  const trimmed = name.trim();

  async function add() {
    if (!trimmed || createTag.isPending) return;
    const existing = tags.data?.find((t) => t.name.toLowerCase() === trimmed.toLowerCase());
    if (existing) {
      setError(`You already have a tag called "${existing.name}".`);
      return;
    }
    setError(null);
    try {
      const tag = await createTag.mutateAsync(trimmed);
      qc.setQueryData<Tag[]>(qk.tags, (list) => (list && !list.some((t) => t.id === tag.id) ? [...list, tag] : list));
      setName('');
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't add the tag.");
    }
  }

  async function remove(tag: Tag) {
    const used = counts.get(tag.id) ?? 0;
    const ok = await confirm({
      title: `Delete "${tag.name}"?`,
      message: !contacts.data
        ? 'It will be removed from any contacts that use it. The contacts themselves stay.'
        : used > 0
          ? `It will be removed from ${plural(used, 'contact')}. The contacts themselves stay.`
          : 'No contacts use this tag.',
      confirmText: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    try {
      await deleteTag.mutateAsync(tag.id);
    } catch (err) {
      // Already deleted (e.g. on another device): that's what the user wanted.
      if (!(err instanceof ApiError && err.status === 404)) {
        showError(err, "Couldn't delete the tag");
        return;
      }
      void qc.invalidateQueries({ queryKey: qk.contacts });
    }
    qc.setQueryData<Tag[]>(qk.tags, (list) => list?.filter((t) => t.id !== tag.id));
  }

  async function refresh() {
    setRefreshing(true);
    try {
      await Promise.all([tags.refetch(), contacts.refetch()]);
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <Screen refreshing={refreshing} onRefresh={() => void refresh()}>
      <Stack.Screen options={{ title: 'Tags' }} />

      <Section title="New tag" inset={false}>
        <View style={styles.addRow}>
          <View style={styles.flex}>
            <TextField
              value={name}
              onChangeText={(text) => {
                setName(text);
                setError(null);
              }}
              placeholder="e.g. Speaker, Follow up this week"
              accessibilityLabel="New tag name"
              icon="pricetag-outline"
              maxLength={MAX_TAG_LENGTH}
              autoCapitalize="sentences"
              autoCorrect={false}
              autoComplete="off"
              enterKeyHint="done"
              submitBehavior="submit"
              onSubmitEditing={() => void add()}
            />
          </View>
          <Button
            title="Add"
            size="md"
            fullWidth={false}
            loading={createTag.isPending}
            disabled={!trimmed}
            onPress={() => void add()}
          />
        </View>
        {error ? (
          <View accessibilityRole="alert" accessibilityLiveRegion="polite">
            <InlineError message={error} />
          </View>
        ) : null}
      </Section>

      {tags.isPending ? (
        <View style={styles.center}>
          <ActivityIndicator color={theme.primary} />
        </View>
      ) : tags.isError && !tags.data ? (
        <EmptyState
          icon="cloud-offline-outline"
          title="Couldn't load your tags"
          message={tags.error.message}
          action={
            <Button
              title="Try again"
              icon="refresh"
              variant="secondary"
              fullWidth={false}
              loading={tags.isFetching}
              onPress={() => void tags.refetch()}
            />
          }
        />
      ) : tags.data.length === 0 ? (
        <EmptyState
          icon="pricetags-outline"
          title="No tags yet"
          message="Tags group the people you meet, like Investor, Sponsor or Speaker. Add one above."
        />
      ) : (
        <Section
          title={`Your tags (${tags.data.length})`}
          footer="Tags are private to you. Deleting a tag doesn't delete any contacts.">
          {tags.data.map((tag, i) => {
            const used = counts.get(tag.id) ?? 0;
            const deleting = deleteTag.isPending && deleteTag.variables === tag.id;
            return (
              <ListRow
                key={tag.id}
                title={tag.name}
                subtitle={contacts.data ? (used > 0 ? plural(used, 'contact') : 'Not used yet') : undefined}
                icon="pricetag-outline"
                iconColor="primary"
                divider={i < tags.data.length - 1}
                right={
                  deleting ? (
                    <View style={styles.trash}>
                      <ActivityIndicator color={theme.danger} />
                    </View>
                  ) : (
                    <Pressable
                      onPress={() => void remove(tag)}
                      disabled={deleteTag.isPending}
                      hitSlop={6}
                      accessibilityRole="button"
                      accessibilityLabel={`Delete tag ${tag.name}`}
                      style={({ pressed }) => [styles.trash, { opacity: pressed ? 0.6 : 1 }]}>
                      <Icon name="trash-outline" size={20} color="danger" />
                    </Pressable>
                  )
                }
              />
            );
          })}
        </Section>
      )}
    </Screen>
  );
}

function InlineError({ message }: { message: string }) {
  return (
    <View style={styles.error}>
      <Icon name="alert-circle" size={16} color="danger" />
      <Text variant="caption" color="danger" style={styles.flex}>
        {message}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  error: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  center: { alignItems: 'center', justifyContent: 'center', paddingVertical: Spacing.seven },
  trash: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', marginVertical: -Spacing.two },
});
