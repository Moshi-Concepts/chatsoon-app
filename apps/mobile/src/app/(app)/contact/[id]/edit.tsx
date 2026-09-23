import { router, Stack, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import {
  ContactForm,
  valuesFromContact,
  valuesToInput,
  type ContactFormValues,
} from '@/components/contacts/contact-form';
import { isReadingCard, needsReview } from '@/components/contacts/source';
import { Button, EmptyState, Screen } from '@/components/ui';
import { useTheme } from '@/hooks/use-theme';
import { ApiError } from '@/lib/api';
import { getOutboxItem } from '@/lib/outbox';
import { useContact, useUpdateContact } from '@/lib/queries';

function leave() {
  if (router.canGoBack()) router.back();
  else router.replace('/contacts');
}

export default function EditContactScreen() {
  const theme = useTheme();
  const params = useLocalSearchParams<{ id: string }>();
  const id = typeof params.id === 'string' ? params.id : undefined;
  const contact = useContact(id);
  const update = useUpdateContact(id ?? '');

  if (!contact.data) {
    const notFound = !id || (contact.error instanceof ApiError && contact.error.status === 404);
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Edit contact' }} />
        {notFound || contact.isError ? (
          <EmptyState
            icon={notFound ? 'person-outline' : 'cloud-offline-outline'}
            title={notFound ? 'Contact not found' : "Couldn't load this contact"}
            message={notFound ? 'It may have been deleted.' : contact.error?.message}
            action={
              notFound ? (
                <Button
                  title="Back to contacts"
                  variant="secondary"
                  fullWidth={false}
                  onPress={() => router.dismissTo('/contacts')}
                />
              ) : (
                <Button
                  title="Try again"
                  icon="refresh"
                  variant="secondary"
                  fullWidth={false}
                  loading={contact.isFetching}
                  onPress={() => void contact.refetch()}
                />
              )
            }
          />
        ) : (
          <View style={styles.center}>
            <ActivityIndicator color={theme.primary} />
          </View>
        )}
      </Screen>
    );
  }

  const current = contact.data;

  async function save(values: ContactFormValues) {
    const status = current.extractionStatus;
    // Saving an unreviewed card from here counts as reviewing it. So does saving one whose read
    // stopped (not in the outbox any more); one still being read on this device is left alone.
    const confirms = needsReview(status) || (isReadingCard(status) && !getOutboxItem(current.id));
    await update.mutateAsync({
      ...valuesToInput(values),
      ...(confirms ? { extractionStatus: 'confirmed' as const } : {}),
    });
    leave();
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Edit contact' }} />
      <ContactForm
        key={current.id}
        initial={valuesFromContact(current)}
        onSubmit={save}
        submitLabel="Save changes"
        secondaryAction={{ label: 'Cancel', onPress: leave }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 240 },
});
