import { Stack, router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet } from 'react-native';

import { Button, Card, Screen, Text, TextField } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth';
import { showAlert, showError } from '@/lib/dialogs';
import { deleteExportedFiles, exportContactsCsv } from '@/lib/export';
import { formatScheduledDeletion } from '@/lib/format';
import { useScheduleDeletion } from '@/lib/queries';

const CONFIRM_WORD = 'DELETE';

export default function DeleteAccountScreen() {
  const { clearSession } = useAuth();
  const scheduleDeletion = useScheduleDeletion();
  const [exporting, setExporting] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);

  const canDelete = confirmText.trim() === CONFIRM_WORD;

  const exportContacts = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      await exportContactsCsv();
    } catch (err) {
      showError(err, "Couldn't export your contacts");
    }
    setExporting(false);
  };

  const deleteAccount = async () => {
    if (!canDelete || deleting) return;
    setDeleting(true);
    try {
      const result = await scheduleDeletion.mutateAsync();
      // The account is scheduled (or, for the reviewer, already gone) on the server now, so a local
      // clean-up hiccup must not report a failure. Sessions are revoked for an immediate delete; a
      // scheduled one leaves the session valid, but signing out locally is exactly what's wanted here.
      deleteExportedFiles();
      await clearSession().catch(() => undefined);
      router.replace('/sign-in');
      if (result.status === 'deleted') {
        showAlert('Account deleted', 'Your account and all of your data have been removed.');
      } else {
        showAlert(
          'Account scheduled for deletion',
          `Your account will be deleted on ${formatScheduledDeletion(result.deleteAfter)}. We've emailed you a link to cancel. You can also sign in again and tap Cancel deletion.`,
        );
      }
    } catch (err) {
      setDeleting(false);
      showError(err, "Couldn't delete your account");
    }
  };

  return (
    <Screen contentStyle={styles.content}>
      <Stack.Screen options={{ title: 'Delete account' }} />

      <Text variant="body" color="textSecondary">
        Deleting your account permanently removes your profile, contacts, notes, tags, connections and photos. Your
        public profile goes offline straight away, and everything is deleted 24 hours later. You can cancel any time
        before then.
      </Text>

      <Card style={styles.card}>
        <Text variant="subheading">Before you go: export your contacts</Text>
        <Text variant="callout" color="textSecondary">
          Download all your contacts as a CSV file you can open in Excel, Google Sheets or Numbers.
        </Text>
        <Button
          title="Export contacts (CSV)"
          icon="download-outline"
          variant="secondary"
          loading={exporting}
          onPress={() => void exportContacts()}
        />
      </Card>

      <Card style={styles.card}>
        <TextField
          label="Type DELETE to confirm"
          placeholder="DELETE"
          value={confirmText}
          onChangeText={setConfirmText}
          autoCapitalize="characters"
          autoCorrect={false}
          hint="Use capital letters, exactly as shown."
          editable={!deleting}
        />
        <Button
          title="Delete my account"
          variant="danger"
          icon="trash-outline"
          disabled={!canDelete}
          loading={deleting}
          onPress={() => void deleteAccount()}
        />
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: Spacing.five, paddingBottom: Spacing.five },
  card: { gap: Spacing.three },
});
