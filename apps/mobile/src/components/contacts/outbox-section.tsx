import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { Icon, Section, Text, type IconName } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { confirm, showError } from '@/lib/dialogs';
import { discardOutboxItem, flushOutbox, retryOutboxItem, type OutboxItem } from '@/lib/outbox';

function itemIcon(item: OutboxItem): IconName {
  if (item.kind === 'connect') return 'qr-code-outline';
  return item.photo ? 'card-outline' : 'person-outline';
}

function statusText(item: OutboxItem): string {
  if (item.status === 'sending') return 'Syncing…';
  if (item.status === 'failed') return "Couldn't sync, tap to retry";
  if (item.waiting === 'offline') return 'Waiting to sync · Offline';
  if (item.waiting === 'retry') return 'Waiting to sync · Retrying soon';
  return 'Waiting to sync';
}

function OutboxRow({ item, last }: { item: OutboxItem; last: boolean }) {
  const theme = useTheme();
  const failed = item.status === 'failed';
  const sending = item.status === 'sending';

  async function send() {
    try {
      if (failed) await retryOutboxItem(item.id);
      else await flushOutbox();
    } catch (err) {
      showError(err, "Couldn't sync");
    }
  }

  async function discard() {
    const ok = await confirm({
      title: item.kind === 'connect' ? 'Discard this connection?' : 'Discard this contact?',
      message:
        item.kind === 'connect'
          ? `Your connection with ${item.label} hasn't been sent yet. Discarding cancels it.`
          : `"${item.label}" hasn't finished syncing. Discarding deletes it from this device` +
            (item.created ? ' and your account.' : '.'),
      confirmText: 'Discard',
      destructive: true,
    });
    if (!ok) return;
    try {
      await discardOutboxItem(item.id);
    } catch (err) {
      showError(err, "Couldn't discard");
    }
  }

  // The row and its discard button are siblings: on web a button inside a button is invalid HTML.
  return (
    <View
      style={[styles.rowWrap, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.border }]}>
      <Pressable
        onPress={() => void send()}
        disabled={sending}
        accessibilityRole="button"
        accessibilityLabel={[item.label, statusText(item), failed ? item.error : null].filter(Boolean).join(', ')}
        accessibilityState={{ busy: sending }}
        style={({ pressed }) => [styles.row, { backgroundColor: pressed ? theme.surfaceAlt : 'transparent' }]}>
        <View style={[styles.badge, { backgroundColor: failed ? theme.dangerSoft : theme.warningSoft }]}>
          {sending ? (
            <ActivityIndicator size="small" color={theme.warning} />
          ) : (
            <Icon
              name={failed ? 'alert-circle-outline' : itemIcon(item)}
              size={20}
              color={failed ? 'danger' : 'warning'}
            />
          )}
        </View>
        <View style={styles.body}>
          <Text variant="bodyStrong" numberOfLines={1}>
            {item.label}
          </Text>
          <Text variant="caption" color={failed ? 'danger' : 'textSecondary'} numberOfLines={1}>
            {statusText(item)}
          </Text>
          {failed && item.error ? (
            <Text variant="caption" color="textTertiary" numberOfLines={2}>
              {item.error}
            </Text>
          ) : null}
        </View>
      </Pressable>
      {sending ? null : (
        <Pressable
          onPress={() => void discard()}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={`Discard ${item.label}`}
          style={({ pressed }) => [styles.discard, { opacity: pressed ? 0.6 : 1 }]}>
          <Icon name="close" size={20} color="textTertiary" />
        </Pressable>
      )}
    </View>
  );
}

/** Contacts and connections saved on this device that have not reached the server yet. */
export function OutboxSection({ items }: { items: OutboxItem[] }) {
  return (
    <Section title="Not synced yet">
      {items.map((item, i) => (
        <OutboxRow key={item.id} item={item} last={i === items.length - 1} />
      ))}
    </Section>
  );
}

const styles = StyleSheet.create({
  rowWrap: { flexDirection: 'row', alignItems: 'center', paddingRight: Spacing.two },
  row: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingLeft: Spacing.four,
    paddingVertical: Spacing.three,
  },
  badge: { width: 40, height: 40, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, gap: 2 },
  discard: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
});
