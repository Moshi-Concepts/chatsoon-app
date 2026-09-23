import { sanitizeDraft, type ContactDraft } from '@chatsoon/shared';
import * as Crypto from 'expo-crypto';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  ContactForm,
  valuesFromDraft,
  valuesToInput,
  type ContactFormValues,
} from '@/components/contacts/contact-form';
import { Icon, Text } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useCurrentEvent } from '@/lib/current-event';
import { enqueueContact } from '@/lib/outbox';

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * The QR scanner passes the parsed fields as JSON. The param can also arrive in a deep link, so it's
 * untrusted: sanitizeDraft keeps known text fields, cut to the schema's limits, and only safe links.
 * Anything malformed just means an empty form.
 */
function parseDraft(raw: string | undefined): ContactDraft {
  if (!raw) return {};
  try {
    return sanitizeDraft(JSON.parse(raw));
  } catch {
    return {};
  }
}

export default function NewContactScreen() {
  const theme = useTheme();
  const params = useLocalSearchParams<{ draft?: string | string[]; source?: string | string[] }>();
  const { eventId } = useCurrentEvent();
  const rawDraft = first(params.draft);
  const draft = useMemo(() => parseDraft(rawDraft), [rawDraft]);
  // "Scanned QR code" only when the scan actually filled something in.
  const source = first(params.source) === 'qr_scan' && Object.keys(draft).length > 0 ? 'qr_scan' : 'manual';
  // One id per screen, so saving again after an error can't create a second copy.
  const [id] = useState(() => Crypto.randomUUID());

  const initial: ContactFormValues = { ...valuesFromDraft(draft), eventId };

  async function save(values: ContactFormValues) {
    await enqueueContact({ ...valuesToInput(values), id, source });
    if (router.canGoBack()) router.back();
    else router.replace('/contacts');
  }

  return (
    <>
      <Stack.Screen options={{ title: 'New contact' }} />
      <ContactForm
        initial={initial}
        onSubmit={save}
        submitLabel="Save contact"
        // Most QR codes carry a handle or link but no name, so start there.
        autoFocusName={!draft.name}
        header={
          source === 'qr_scan' ? (
            <View style={[styles.banner, { backgroundColor: theme.primarySoft }]}>
              <Icon name="qr-code-outline" size={20} color="primary" />
              <Text variant="callout" color="primary" style={styles.bannerText}>
                Filled in from the QR code. Check the details, then save.
              </Text>
            </View>
          ) : undefined
        }
      />
    </>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.four,
    borderRadius: Radius.lg,
  },
  bannerText: { flex: 1 },
});
