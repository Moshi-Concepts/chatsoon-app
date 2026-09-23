import type { ChatsoonEvent } from '@chatsoon/shared';
import { eventInputSchema } from '@chatsoon/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { Button, Card, Chip, Icon, Text, TextField } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useCurrentEvent } from '@/lib/current-event';
import { qk, useCreateEvent, useEvents } from '@/lib/queries';

import { selectionFeedback } from './feedback';

/**
 * "Current event" selector for the Add tab. New contacts and QR connections are tagged with the
 * chosen event until it is changed or cleared.
 */
export function CurrentEventPicker() {
  const theme = useTheme();
  const qc = useQueryClient();
  const { eventId, setEventId } = useCurrentEvent();
  const events = useEvents();
  const createEvent = useCreateEvent();
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const list = events.data ?? [];
  const current = eventId ? list.find((e) => e.id === eventId) : undefined;

  // The saved event no longer exists for this account (deleted, or another account's): forget it.
  const stale = !!eventId && events.isSuccess && !events.isFetching && !current;
  useEffect(() => {
    if (stale) setEventId(null);
  }, [stale, setEventId]);

  const choose = (id: string | null) => {
    selectionFeedback();
    setEventId(id);
    setOpen(false);
    setAdding(false);
  };

  const addEvent = async () => {
    const parsed = eventInputSchema.safeParse({ name });
    if (!parsed.success) {
      setError('Give the event a name');
      return;
    }
    setError(null);
    try {
      const event = await createEvent.mutateAsync(parsed.data.name);
      // Add it to the cached list straight away so the selection shows before the refetch lands.
      qc.setQueryData<ChatsoonEvent[]>(qk.events, (prev) => [...(prev ?? []).filter((e) => e.id !== event.id), event]);
      setName('');
      choose(event.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't add the event");
    }
  };

  const summary = current ? current.name : eventId && events.isPending ? 'Loading...' : 'No event';

  return (
    <View style={styles.wrap}>
      <Card padded={false}>
        <Pressable
          onPress={() => setOpen((v) => !v)}
          accessibilityRole="button"
          accessibilityLabel={`Current event: ${summary}`}
          accessibilityHint={open ? 'Hides the event list' : 'Shows events to choose from'}
          accessibilityState={{ expanded: open }}
          style={({ pressed }) => [styles.header, pressed && { backgroundColor: theme.surfaceAlt }]}>
          <View style={[styles.badge, { backgroundColor: theme.accentSoft }]}>
            <Icon name="calendar" size={20} color="accent" />
          </View>
          <View style={styles.headerText}>
            <Text variant="small" color="textSecondary" style={styles.eyebrow}>
              CURRENT EVENT
            </Text>
            <Text variant="subheading" numberOfLines={1}>
              {summary}
            </Text>
          </View>
          <Text variant="captionStrong" color="primary">
            {open ? 'Done' : 'Change'}
          </Text>
        </Pressable>

        {open ? (
          <View style={[styles.body, { borderTopColor: theme.border }]}>
            {events.isPending ? (
              <View style={styles.loading}>
                <ActivityIndicator color={theme.primary} />
              </View>
            ) : events.isError ? (
              <View style={styles.errorRow}>
                <Text variant="callout" color="textSecondary" style={styles.flex}>
                  Couldn&apos;t load your events.
                </Text>
                <Button
                  title="Retry"
                  size="sm"
                  variant="secondary"
                  fullWidth={false}
                  loading={events.isFetching}
                  onPress={() => void events.refetch()}
                />
              </View>
            ) : (
              <View style={styles.chips}>
                <Chip label="No event" icon="close-circle-outline" selected={!eventId} onPress={() => choose(null)} />
                {list.map((event) => (
                  <Chip
                    key={event.id}
                    label={event.name}
                    selected={event.id === eventId}
                    onPress={() => choose(event.id)}
                  />
                ))}
                {!adding ? <Chip label="New event" icon="add" onPress={() => setAdding(true)} /> : null}
              </View>
            )}

            {adding ? (
              <View style={styles.addRow}>
                <View style={styles.flex}>
                  <TextField
                    value={name}
                    onChangeText={(v) => {
                      setName(v);
                      if (error) setError(null);
                    }}
                    placeholder="Event name, e.g. Web Summit"
                    accessibilityLabel="New event name"
                    autoFocus
                    autoCapitalize="words"
                    autoCorrect={false}
                    returnKeyType="done"
                    maxLength={80}
                    onSubmitEditing={() => void addEvent()}
                    error={error}
                    editable={!createEvent.isPending}
                  />
                </View>
                <Button
                  title="Add"
                  size="md"
                  fullWidth={false}
                  loading={createEvent.isPending}
                  disabled={!name.trim()}
                  onPress={() => void addEvent()}
                  style={styles.addButton}
                />
              </View>
            ) : null}
          </View>
        ) : null}
      </Card>
      <Text variant="caption" color="textTertiary" style={styles.footnote}>
        {current
          ? `New contacts and connections are tagged with ${current.name}.`
          : 'Pick the event you are at and new contacts are tagged with it.'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.two },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
    minHeight: 64,
  },
  badge: { width: 40, height: 40, borderRadius: Radius.sm, alignItems: 'center', justifyContent: 'center' },
  headerText: { flex: 1, gap: 2 },
  eyebrow: { letterSpacing: 0.6 },
  body: {
    borderTopWidth: StyleSheet.hairlineWidth,
    padding: Spacing.four,
    gap: Spacing.four,
  },
  loading: { paddingVertical: Spacing.three, alignItems: 'center' },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  addRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two },
  addButton: { marginTop: 3 },
  footnote: { paddingHorizontal: Spacing.one },
});
