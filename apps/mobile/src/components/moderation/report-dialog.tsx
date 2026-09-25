import { REPORT_REASONS, type ReportReason } from '@chatsoon/shared';
import { REPORT_REASON_LABELS } from '@chatsoon/shared/src/profile-page';
import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Icon, Text, TextField } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useReport } from '@/lib/queries';

// Used by: id/[slug] (public profile) and contact/[id] (linked contacts and Connect form messages).

export type ReportDialogProps = {
  visible: boolean;
  onClose: () => void;
  /** Who is being reported. One of targetSlug / targetUserId / contactId is required. */
  targetSlug?: string | null;
  targetUserId?: string | null;
  /**
   * A Connect form message in my contacts (source web_connect). The sender has no account, so the
   * message itself is reported. Signed in only.
   */
  contactId?: string | null;
  targetName: string;
};

// Labels moved to packages/shared/src/profile-page.ts (REPORT_REASON_LABELS) so the web island can
// share them without importing this component.
const REASON_LABELS: Record<ReportReason, { title: string; subtitle: string }> = REPORT_REASON_LABELS;

/** Modal to pick a reason, add details and send POST /reports. Works signed in or out. */
export function ReportDialog({ visible, onClose, ...target }: ReportDialogProps) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      {/* Content unmounts when the modal hides, so each opening starts fresh. */}
      <ReportSheet onClose={onClose} {...target} />
    </Modal>
  );
}

function ReportSheet({ onClose, targetSlug, targetUserId, contactId, targetName }: Omit<ReportDialogProps, 'visible'>) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const asSheet = width < 600;
  const report = useReport();
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState('');
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    if (!report.isPending) onClose();
  };

  const send = () => {
    if (!reason) {
      setError('Choose a reason for your report.');
      return;
    }
    if (!targetSlug && !targetUserId && !contactId) {
      setError("We couldn't tell who you're reporting. Close this and try again.");
      return;
    }
    setError(null);
    report.mutate(
      contactId
        ? { contactId, reason, details: details.trim() || null }
        : {
            targetSlug: targetSlug || undefined,
            targetUserId: targetUserId || undefined,
            reason,
            details: details.trim() || null,
          },
      { onError: (err) => setError(err.message || "Your report didn't send. Please try again.") },
    );
  };

  const sent = report.isSuccess;

  return (
    <KeyboardAvoidingView
      style={[styles.backdrop, asSheet ? styles.backdropSheet : styles.backdropCentred]}
      // Android too: with edge-to-edge the modal window isn't resized for the keyboard. Padding only
      // covers the overlap it measures, so it adds nothing where the system already made room.
      behavior={Platform.OS === 'web' ? undefined : 'padding'}>
      <Pressable
        style={[StyleSheet.absoluteFill, { backgroundColor: theme.overlay }]}
        onPress={close}
        accessibilityRole="button"
        accessibilityLabel="Close"
      />
      <View
        role="dialog"
        aria-modal
        accessibilityLabel={`Report ${targetName}`}
        style={[
          styles.panel,
          asSheet ? styles.panelSheet : styles.panelCentred,
          {
            backgroundColor: theme.surface,
            borderColor: theme.border,
            paddingBottom: (asSheet ? insets.bottom : 0) + Spacing.five,
          },
        ]}>
        <View style={styles.header}>
          <Text variant="heading" style={styles.flex} numberOfLines={2}>
            {sent ? 'Report sent' : `Report ${targetName}`}
          </Text>
          <Pressable
            onPress={close}
            disabled={report.isPending}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Close"
            style={({ pressed }) => [styles.close, { backgroundColor: theme.surfaceAlt, opacity: pressed ? 0.7 : 1 }]}>
            <Icon name="close" size={18} color="textSecondary" />
          </Pressable>
        </View>

        {sent ? (
          <View style={styles.success}>
            <View style={[styles.successBadge, { backgroundColor: theme.successSoft }]}>
              <Icon name="checkmark-circle" size={34} color="success" />
            </View>
            <Text variant="body" align="center">
              Thanks. We review reports within 24 hours.
            </Text>
            <Text variant="caption" color="textSecondary" align="center">
              {targetName} won&apos;t be told who reported them.
            </Text>
            <Button title="Done" onPress={onClose} style={styles.doneButton} />
          </View>
        ) : (
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.body}
            keyboardShouldPersistTaps="handled"
            bounces={false}>
            <Text variant="callout" color="textSecondary">
              Why are you reporting {targetName}? They won&apos;t be told who reported them.
            </Text>

            <View role="radiogroup" style={[styles.reasons, { borderColor: theme.border }]}>
              {REPORT_REASONS.map((r, i) => {
                const selected = reason === r;
                return (
                  <Pressable
                    key={r}
                    onPress={() => {
                      setReason(r);
                      setError(null);
                    }}
                    disabled={report.isPending}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: selected, disabled: report.isPending }}
                    accessibilityLabel={REASON_LABELS[r].title}
                    style={({ pressed }) => [
                      styles.reason,
                      i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border },
                      { backgroundColor: selected ? theme.primarySoft : pressed ? theme.surfaceAlt : 'transparent' },
                    ]}>
                    <Icon
                      name={selected ? 'radio-button-on' : 'radio-button-off'}
                      size={22}
                      color={selected ? 'primary' : 'textTertiary'}
                    />
                    <View style={styles.flex}>
                      <Text variant="bodyStrong">{REASON_LABELS[r].title}</Text>
                      <Text variant="caption" color="textSecondary">
                        {REASON_LABELS[r].subtitle}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>

            <TextField
              label="Details (optional)"
              placeholder="Anything that helps us review this report"
              value={details}
              onChangeText={setDetails}
              multiline
              maxLength={1000}
              autoCapitalize="sentences"
              editable={!report.isPending}
            />

            {error ? (
              <View style={[styles.error, { backgroundColor: theme.dangerSoft }]} accessibilityRole="alert">
                <Icon name="alert-circle-outline" size={18} color="danger" />
                <Text variant="caption" color="danger" style={styles.flex}>
                  {error}
                </Text>
              </View>
            ) : null}

            <View style={styles.actions}>
              <Button
                title="Send report"
                icon="flag-outline"
                onPress={send}
                loading={report.isPending}
                disabled={!reason}
              />
              <Button title="Cancel" variant="ghost" onPress={close} disabled={report.isPending} />
            </View>

            <Text variant="caption" color="textTertiary" align="center">
              If someone is in immediate danger, contact your local emergency services.
            </Text>
          </ScrollView>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  backdrop: { flex: 1 },
  backdropSheet: { justifyContent: 'flex-end' },
  backdropCentred: { justifyContent: 'center', alignItems: 'center', padding: Spacing.five },
  panel: {
    borderWidth: StyleSheet.hairlineWidth,
    paddingTop: Spacing.five,
    paddingHorizontal: Spacing.five,
    gap: Spacing.four,
    maxHeight: '92%',
  },
  panelSheet: { borderTopLeftRadius: Radius.xl, borderTopRightRadius: Radius.xl },
  panelCentred: { width: '100%', maxWidth: 460, borderRadius: Radius.xl },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  close: { width: 32, height: 32, borderRadius: Radius.pill, alignItems: 'center', justifyContent: 'center' },
  scroll: { flexGrow: 0 },
  body: { gap: Spacing.four },
  reasons: { borderWidth: StyleSheet.hairlineWidth, borderRadius: Radius.md, overflow: 'hidden' },
  reason: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
    minHeight: 56,
  },
  error: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    padding: Spacing.three,
    borderRadius: Radius.md,
  },
  actions: { gap: Spacing.one },
  success: { alignItems: 'center', gap: Spacing.three, paddingTop: Spacing.two },
  successBadge: { width: 64, height: 64, borderRadius: Radius.xl, alignItems: 'center', justifyContent: 'center' },
  doneButton: { alignSelf: 'stretch', marginTop: Spacing.two },
});
