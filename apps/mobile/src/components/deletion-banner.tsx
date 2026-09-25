import { StyleSheet, View } from 'react-native';

import { Button, Icon, Text } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { showAlert, showError } from '@/lib/dialogs';
import { formatScheduledDeletion } from '@/lib/format';
import { useCancelDeletion } from '@/lib/queries';

/**
 * Warning banner shown while an account deletion is pending (issue #8). `me.tsx` shows the full
 * version; `contacts.tsx` shows the `compact` one so a returning user notices there too.
 */
export function DeletionBanner({ deleteAfter, compact = false }: { deleteAfter: string; compact?: boolean }) {
  const theme = useTheme();
  const cancelDeletion = useCancelDeletion();
  const when = formatScheduledDeletion(deleteAfter);

  const cancel = () => {
    if (cancelDeletion.isPending) return;
    cancelDeletion.mutate(undefined, {
      onSuccess: () => showAlert('Deletion cancelled', 'Your account and public profile are back.'),
      onError: (err) => showError(err, "Couldn't cancel deletion"),
    });
  };

  if (compact) {
    return (
      <View style={[styles.compactWrap, { backgroundColor: theme.dangerSoft }]}>
        <Icon name="warning" size={16} color="danger" />
        <Text variant="caption" color="danger" style={styles.flex}>
          Account deletion scheduled for {when}.
        </Text>
        <Button
          title="Cancel"
          variant="dangerSoft"
          size="sm"
          fullWidth={false}
          loading={cancelDeletion.isPending}
          onPress={cancel}
        />
      </View>
    );
  }

  return (
    <View style={[styles.wrap, { backgroundColor: theme.dangerSoft }]}>
      <View style={styles.row}>
        <Icon name="warning" size={20} color="danger" />
        <Text variant="bodyStrong" color="danger" style={styles.flex}>
          Your account will be deleted on {when}. Your public profile is offline.
        </Text>
      </View>
      <Button title="Cancel deletion" variant="dangerSoft" loading={cancelDeletion.isPending} onPress={cancel} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderRadius: Radius.lg, padding: Spacing.four, gap: Spacing.three },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  compactWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  flex: { flex: 1 },
});
