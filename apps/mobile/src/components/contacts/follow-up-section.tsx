import type { Contact } from '@chatsoon/shared';
import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { Avatar, Button, Card, Icon, Text } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { dueLabel } from '@/lib/format';

/**
 * "Follow up · N due" (issue #33), shown at the top of the Contacts tab when any contact is due:
 * up to 3 contacts due for a follow-up right now, most overdue first, each with a small "Follow up"
 * action. Both the row and the action open the contact page, where the draft sheet lives - there's
 * no reason to duplicate it here. "See all" applies the "To follow up" filter instead of listing
 * every due contact in this card.
 */
export function FollowUpSection({ due, onSeeAll }: { due: Contact[]; onSeeAll: () => void }) {
  if (due.length === 0) return null;
  const shown = due.slice(0, 3);

  return (
    <Card padded={false} style={styles.card}>
      <View style={styles.header}>
        <Icon name="time-outline" size={18} color="primary" />
        <Text variant="bodyStrong" style={styles.flex}>
          Follow up · {due.length} due
        </Text>
        {due.length > shown.length ? (
          <Pressable
            onPress={onSeeAll}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="See all contacts due for a follow-up">
            <Text variant="captionStrong" color="primary">
              See all
            </Text>
          </Pressable>
        ) : null}
      </View>
      {shown.map((contact, i) => (
        <FollowUpRow key={contact.id} contact={contact} last={i === shown.length - 1} />
      ))}
    </Card>
  );
}

function FollowUpRow({ contact, last }: { contact: Contact; last: boolean }) {
  const theme = useTheme();
  const open = () => router.push(`/contact/${contact.id}`);
  return (
    // The row and its action are siblings, not nested: on web a button inside a button is invalid HTML.
    <View
      style={[styles.rowWrap, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.border }]}>
      <Pressable
        onPress={open}
        accessibilityRole="button"
        accessibilityLabel={`${contact.name}, ${dueLabel(contact.followUpDueAt!)}`}
        style={({ pressed }) => [styles.row, { backgroundColor: pressed ? theme.surfaceAlt : 'transparent' }]}>
        <Avatar name={contact.name} size={36} />
        <View style={styles.rowBody}>
          <Text variant="bodyStrong" numberOfLines={1}>
            {contact.name}
          </Text>
          <Text variant="caption" color="textSecondary" numberOfLines={1}>
            {dueLabel(contact.followUpDueAt!)}
          </Text>
        </View>
      </Pressable>
      <Button title="Follow up" size="sm" variant="secondary" fullWidth={false} onPress={open} style={styles.action} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { marginHorizontal: Spacing.four, marginTop: Spacing.two },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    padding: Spacing.four,
    paddingBottom: Spacing.two,
  },
  flex: { flex: 1 },
  rowWrap: { flexDirection: 'row', alignItems: 'center', paddingRight: Spacing.three },
  row: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingLeft: Spacing.four,
    paddingVertical: Spacing.three,
  },
  rowBody: { flex: 1, gap: 2 },
  action: { marginLeft: Spacing.two },
});
