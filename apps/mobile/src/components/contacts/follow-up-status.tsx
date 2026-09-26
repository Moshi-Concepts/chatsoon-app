import {
  FOLLOW_UP_CHANNEL_LABELS,
  REMIND_DAY_OPTIONS,
  REMIND_OPTION_LABELS,
  type Contact,
  type RemindDays,
} from '@chatsoon/shared';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, Card, Icon, Text } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { isNetworkError } from '@/lib/api';
import { showAlert, showError } from '@/lib/dialogs';
import { dueLabel, shortDate } from '@/lib/format';
import { useRemindFollowUp, useUndoFollowUp } from '@/lib/queries';

import { FollowUpSheet, type FollowUpPrevious } from './follow-up-sheet';

const OFFLINE_TITLE = "You're offline";
const OFFLINE_MESSAGE = 'Connect to the internet and try again.';
/** About 8s, or until dismissed by tapping Undo (issue #33). */
const UNDO_WINDOW_MS = 8_000;

/**
 * The contact page's follow-up block (issue #33): the status line, the "Follow up" button that opens
 * the draft sheet, an inline Undo right after marking, and "Remind me again" once a follow-up exists.
 */
export function FollowUpStatus({ contact, eventName }: { contact: Contact; eventName?: string | null }) {
  const theme = useTheme();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [undo, setUndo] = useState<{ contactId: string; previous: FollowUpPrevious } | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const undoFollowUp = useUndoFollowUp(contact.id);
  const remind = useRemindFollowUp(contact.id);
  const [remindPending, setRemindPending] = useState<RemindDays | 'never' | null>(null);

  useEffect(
    () => () => {
      if (undoTimer.current) clearTimeout(undoTimer.current);
    },
    [],
  );

  // Navigating to a different contact (or an Undo elsewhere) drops a stale banner.
  useEffect(() => {
    setUndo((current) => (current?.contactId === contact.id ? current : null));
  }, [contact.id]);

  function handleFollowedUp(previous: FollowUpPrevious) {
    if (undoTimer.current) clearTimeout(undoTimer.current);
    setUndo({ contactId: contact.id, previous });
    undoTimer.current = setTimeout(() => setUndo(null), UNDO_WINDOW_MS);
  }

  function dismissUndo() {
    if (undoTimer.current) clearTimeout(undoTimer.current);
    setUndo(null);
  }

  async function onUndo() {
    if (!undo || undoFollowUp.isPending) return;
    try {
      await undoFollowUp.mutateAsync({ previous: undo.previous });
      dismissUndo();
    } catch (err) {
      if (isNetworkError(err)) showAlert(OFFLINE_TITLE, OFFLINE_MESSAGE);
      else showError(err, "Couldn't undo");
    }
  }

  async function chooseRemind(days: RemindDays | null) {
    if (remindPending) return;
    setRemindPending(days ?? 'never');
    try {
      await remind.mutateAsync({ remindInDays: days });
    } catch (err) {
      if (isNetworkError(err)) showAlert(OFFLINE_TITLE, OFFLINE_MESSAGE);
      else showError(err, "Couldn't set a reminder");
    } finally {
      setRemindPending(null);
    }
  }

  const status = contact.followedUpAt
    ? `Followed up on ${shortDate(contact.followedUpAt)} via ${FOLLOW_UP_CHANNEL_LABELS[contact.followUpChannel ?? 'copy']}`
    : contact.followUpDueAt
      ? `Not followed up yet · ${dueLabel(contact.followUpDueAt)}`
      : null;

  const showUndo = undo?.contactId === contact.id;

  return (
    <View style={styles.wrap}>
      {status ? (
        <View style={styles.statusRow} accessibilityRole="text" accessibilityLabel={status}>
          <Icon
            name={contact.followedUpAt ? 'checkmark-circle-outline' : 'time-outline'}
            size={16}
            color={contact.followedUpAt ? 'success' : 'textSecondary'}
          />
          <Text variant="caption" color="textSecondary">
            {status}
          </Text>
        </View>
      ) : null}

      {showUndo ? (
        <View style={[styles.undoRow, { backgroundColor: theme.successSoft }]} accessibilityRole="alert">
          <Icon name="checkmark-circle" size={16} color="success" />
          <Text variant="caption" color="success" style={styles.flex}>
            Marked as followed up
          </Text>
          <Button
            title="Undo"
            variant="ghost"
            size="sm"
            fullWidth={false}
            loading={undoFollowUp.isPending}
            onPress={() => void onUndo()}
          />
        </View>
      ) : null}

      <Button title="Follow up" icon="paper-plane-outline" onPress={() => setSheetOpen(true)} />

      {contact.followedUpAt ? (
        <Card style={styles.remindCard}>
          <Text variant="captionStrong" color="textSecondary">
            Remind me again
          </Text>
          <View style={styles.remindRow}>
            {REMIND_DAY_OPTIONS.map((days) => (
              <Button
                key={days}
                title={REMIND_OPTION_LABELS[days]}
                size="sm"
                variant="secondary"
                fullWidth={false}
                loading={remindPending === days}
                disabled={!!remindPending && remindPending !== days}
                onPress={() => void chooseRemind(days)}
              />
            ))}
            <Button
              title="Never"
              size="sm"
              variant="ghost"
              fullWidth={false}
              loading={remindPending === 'never'}
              disabled={!!remindPending && remindPending !== 'never'}
              onPress={() => void chooseRemind(null)}
            />
          </View>
        </Card>
      ) : null}

      <FollowUpSheet
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        contact={contact}
        eventName={eventName}
        onFollowedUp={handleFollowedUp}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.three },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  undoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderRadius: Radius.md,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
  },
  flex: { flex: 1 },
  remindCard: { gap: Spacing.two },
  remindRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
});
