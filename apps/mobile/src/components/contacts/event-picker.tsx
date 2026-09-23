import type { ChatsoonEvent } from '@chatsoon/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { Chip, Text } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { qk, useCreateEvent, useEvents } from '@/lib/queries';

import { InlineCreate } from './inline-create';

/** Pick one event or none, or create a new one inline. */
export function EventPicker({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (eventId: string | null) => void;
}) {
  const theme = useTheme();
  const qc = useQueryClient();
  const events = useEvents();
  const createEvent = useCreateEvent();
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create(raw: string) {
    const name = raw.trim();
    if (!name) return;
    setError(null);
    const existing = events.data?.find((e) => e.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      onChange(existing.id);
      setAdding(false);
      return;
    }
    try {
      const event = await createEvent.mutateAsync(name);
      qc.setQueryData<ChatsoonEvent[]>(qk.events, (list) =>
        list && !list.some((e) => e.id === event.id) ? [...list, event] : list,
      );
      onChange(event.id);
      setAdding(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create the event.");
    }
  }

  if (events.isPending) {
    return (
      <View style={styles.status}>
        <ActivityIndicator color={theme.textTertiary} />
        <Text variant="caption" color="textSecondary">
          Loading events
        </Text>
      </View>
    );
  }

  if (events.isError && !events.data) {
    return (
      <View style={styles.status}>
        <Text variant="caption" color="textSecondary">
          Couldn&apos;t load events.
        </Text>
        <Pressable onPress={() => void events.refetch()} accessibilityRole="button" hitSlop={8}>
          <Text variant="captionStrong" color="primary">
            Try again
          </Text>
        </Pressable>
      </View>
    );
  }

  const known = events.data.some((e) => e.id === value);
  return (
    <View style={styles.wrap}>
      <View style={styles.chips}>
        <Chip label="None" selected={!value || !known} onPress={() => onChange(null)} />
        {events.data.map((event) => {
          const on = event.id === value;
          return (
            <Chip
              key={event.id}
              label={event.name}
              icon={on ? 'checkmark' : 'calendar-outline'}
              selected={on}
              onPress={() => onChange(on ? null : event.id)}
            />
          );
        })}
        {adding ? null : (
          <Chip
            label="New event"
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
          placeholder="Event name"
          maxLength={80}
          loading={createEvent.isPending}
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
