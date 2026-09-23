import type { Contact } from '@chatsoon/shared';
import { CARD_PLACEHOLDER_NAME } from '@chatsoon/shared';
import { useQueryClient } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams, useNavigation } from 'expo-router';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { CardPhoto } from '@/components/capture/card-photo';
import { ProgressSteps, type StepState } from '@/components/capture/progress-steps';
import { StatusPanel } from '@/components/capture/status-panel';
import {
  ContactForm,
  valuesFromContact,
  valuesToInput,
  type ContactFormValues,
} from '@/components/contacts/contact-form';
import { Button, EmptyState, Icon, Screen, Text } from '@/components/ui';
import { Radius, Spacing, type ThemeColor } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { api, ApiError } from '@/lib/api';
import { confirm, showAlert, showError } from '@/lib/dialogs';
import { resolveLocalImageUri } from '@/lib/image';
import {
  discardOutboxItem,
  getOutboxItem,
  retryOutboxItem,
  syncOutboxNow,
  useOutboxItem,
  useOutboxReady,
  type ContactOutboxItem,
} from '@/lib/outbox';
import { putContactInCache, removeContactFromCache, useContact, useDeleteContact } from '@/lib/queries';

/** After this long in the progress state, reassure the user they can leave. */
const SLOW_MS = 15_000;

function leave() {
  if (router.canGoBack()) router.back();
  else router.replace('/contacts');
}

export default function CardReviewScreen() {
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const ready = useOutboxReady();
  const item = useOutboxItem(id);
  const pending = item?.kind === 'contact' ? item : undefined;
  // While the card is still in the outbox there is nothing to fetch yet.
  const query = useContact(ready && !pending ? id : undefined);
  const qc = useQueryClient();
  const deleteContact = useDeleteContact();
  const navigation = useNavigation();
  const [discarding, setDiscarding] = useState(false);

  /** After a discard: skip the contact's own page if that's where the user came from (it's gone now). */
  const leaveDiscarded = () => {
    const state = navigation.getState();
    const prev = state ? state.routes[state.index - 1] : undefined;
    const fromContact =
      prev?.name === 'contact/[id]/index' && (prev.params as { id?: string } | undefined)?.id === id;
    if (fromContact) router.dismiss(2);
    else leave();
  };

  const discard = async () => {
    if (!id) return;
    const ok = await confirm({
      title: 'Discard this card?',
      message: 'The contact and its photo will be deleted.',
      confirmText: 'Discard',
      destructive: true,
    });
    if (!ok) return;
    setDiscarding(true);
    try {
      // Check the outbox now, not at render time: the card may have finished sending meanwhile.
      if (getOutboxItem(id)) await discardOutboxItem(id);
      else await deleteContact.mutateAsync(id);
      leaveDiscarded();
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        // Already deleted (e.g. on another device).
        removeContactFromCache(qc, id);
        leaveDiscarded();
        return;
      }
      setDiscarding(false);
      showError(err, "Couldn't discard the card");
    }
  };

  let content: ReactNode;
  if (!id) {
    content = <NotFound />;
  } else if (discarding) {
    content = <Loading title="Discarding..." />;
  } else if (!ready) {
    content = <Loading title="Loading the card..." />;
  } else if (pending) {
    content = <PendingCard item={pending} onDiscard={() => void discard()} />;
  } else if (query.data) {
    content = <ReviewForm contact={query.data} onDiscard={() => void discard()} />;
  } else if (query.isError) {
    content =
      query.error instanceof ApiError && query.error.status === 404 ? (
        <NotFound />
      ) : (
        <Screen>
          <EmptyState
            icon="cloud-offline-outline"
            title="Couldn't load the card"
            message={query.error.message}
            action={
              <Button
                title="Try again"
                fullWidth={false}
                loading={query.isFetching}
                onPress={() => void query.refetch()}
              />
            }
          />
        </Screen>
      );
  } else {
    content = <Loading title="Loading the card..." />;
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Review card' }} />
      {content}
    </>
  );
}

function Loading({ title }: { title: string }) {
  return (
    <Screen contentStyle={styles.centered}>
      <StatusPanel busy title={title} />
    </Screen>
  );
}

function NotFound() {
  return (
    <Screen>
      <EmptyState
        icon="id-card-outline"
        title="Card not found"
        message="It may have been discarded or deleted."
        action={<Button title="Go to contacts" fullWidth={false} onPress={() => router.dismissTo('/contacts')} />}
      />
    </Screen>
  );
}

// ---- Still in the outbox: uploading, waiting for a connection, or failed to send ----

function stepStates(item: ContactOutboxItem): { upload: StepState; create: StepState; extract: StepState } {
  const sending = item.status === 'sending';
  const uploaded = !!item.imageKey || !item.photo;
  const created = !!item.created;
  const current: 'upload' | 'create' | 'extract' = !uploaded ? 'upload' : !created ? 'create' : 'extract';
  const state = (step: typeof current, done: boolean): StepState =>
    done ? 'done' : step === current && sending ? 'active' : 'todo';
  return {
    upload: state('upload', uploaded),
    create: state('create', created),
    extract: state('extract', false),
  };
}

function PendingCard({ item, onDiscard }: { item: ContactOutboxItem; onDiscard: () => void }) {
  const photo = item.photo ? resolveLocalImageUri(item.photo.uri) : null;
  const [retrying, setRetrying] = useState(false);
  const [slow, setSlow] = useState(false);
  const waiting = item.status === 'queued' && !!item.waiting;
  const inProgress = item.status !== 'failed' && !waiting;

  useEffect(() => {
    if (!inProgress) return;
    const timer = setTimeout(() => setSlow(true), SLOW_MS);
    return () => clearTimeout(timer);
  }, [inProgress]);

  const run = async (task: () => Promise<void>) => {
    setRetrying(true);
    try {
      await task();
    } finally {
      setRetrying(false);
    }
  };
  const retry = () => run(() => retryOutboxItem(item.id));
  const syncNow = () =>
    run(async () => {
      await syncOutboxNow();
      const after = getOutboxItem(item.id);
      if (after?.status === 'queued' && after.waiting === 'offline') {
        showAlert("You're still offline", "We'll read this card as soon as you're back online.");
      }
    });

  if (item.status === 'failed') {
    return (
      <Screen
        footer={
          <View style={styles.row}>
            <Button title="Discard" variant="dangerSoft" onPress={onDiscard} style={styles.flex} />
            <Button title="Try again" loading={retrying} onPress={() => void retry()} style={styles.wide} />
          </View>
        }>
        <CardPhoto uri={photo} />
        <StatusPanel
          icon="alert-circle-outline"
          tone="danger"
          title="Couldn't send this card"
          message={item.error ?? 'Something went wrong. Try again.'}
        />
      </Screen>
    );
  }

  if (waiting) {
    const offline = item.waiting === 'offline';
    return (
      <Screen
        footer={
          <View style={styles.row}>
            <Button title="Discard" variant="dangerSoft" onPress={onDiscard} style={styles.flex} />
            <Button title="Done" onPress={leave} style={styles.wide} />
          </View>
        }>
        <CardPhoto uri={photo} />
        <StatusPanel
          icon={offline ? 'cloud-offline-outline' : 'time-outline'}
          tone="warning"
          title="Saved"
          message={
            offline
              ? "We'll read this card when you're back online."
              : "The server is busy right now. We'll try again in a moment."
          }>
          <Button title="Try now" variant="ghost" icon="refresh" loading={retrying} onPress={() => void syncNow()} />
        </StatusPanel>
      </Screen>
    );
  }

  const steps = stepStates(item);
  return (
    <Screen footer={<Button title="Finish later" variant="secondary" onPress={leave} />}>
      <CardPhoto uri={photo} />
      <StatusPanel
        busy
        title="Reading the card..."
        message={
          slow
            ? "Still working on it. You can leave this screen and we'll finish in the background."
            : 'This usually takes a few seconds.'
        }
      />
      <ProgressSteps
        steps={[
          ...(item.photo ? [{ label: 'Upload photo', state: steps.upload }] : []),
          { label: 'Save contact', state: steps.create },
          { label: 'Read the details', state: steps.extract },
        ]}
      />
    </Screen>
  );
}

// ---- On the server: check and confirm the details ----

function ReviewForm({ contact, onDiscard }: { contact: Contact; onDiscard: () => void }) {
  const qc = useQueryClient();
  const [rereading, setRereading] = useState(false);
  const rereadTask = useRef<Promise<void> | null>(null);

  const fromContact = valuesFromContact(contact);
  // The placeholder name must never be saved: make the user type the real one.
  const initial: ContactFormValues = {
    ...fromContact,
    name: fromContact.name === CARD_PLACEHOLDER_NAME ? '' : fromContact.name,
  };

  const save = async (values: ContactFormValues) => {
    // A re-read that finished after the save would mark the card as unreviewed again.
    if (rereadTask.current) await rereadTask.current;
    const updated = await api.contacts.update(contact.id, { ...valuesToInput(values), extractionStatus: 'confirmed' });
    putContactInCache(qc, updated);
    // Opened from the contact's own page: go back to it rather than stacking a second copy.
    router.dismissTo(`/contact/${updated.id}`);
  };

  const reread = () => {
    const imageKey = contact.cardImageKey;
    if (!imageKey || rereadTask.current) return;
    setRereading(true);
    rereadTask.current = (async () => {
      try {
        // Fields the user hasn't touched pick up the new values (ContactForm merges them in).
        const { contact: updated } = await api.extract.card(contact.id, imageKey);
        putContactInCache(qc, updated);
      } catch (err) {
        if (err instanceof ApiError && err.code === 'extraction_failed') {
          showAlert("Still couldn't read it", 'Try a sharper photo with less glare, or fill in the details below.');
        } else {
          showError(err, "Couldn't read the card");
        }
      } finally {
        rereadTask.current = null;
        setRereading(false);
      }
    })();
  };

  return (
    <ContactForm
      initial={initial}
      onSubmit={save}
      submitLabel="Save contact"
      secondaryAction={{ label: 'Discard', onPress: onDiscard, destructive: true }}
      header={
        <View style={styles.header}>
          <CardPhoto uri={contact.cardImageUrl} />
          <ReviewBanner contact={contact} onReread={contact.cardImageKey ? reread : undefined} rereading={rereading} />
        </View>
      }
    />
  );
}

function ReviewBanner({
  contact,
  onReread,
  rereading,
}: {
  contact: Contact;
  onReread?: () => void;
  rereading: boolean;
}) {
  const theme = useTheme();
  const status = contact.extractionStatus;
  if (status === 'confirmed' || status === 'none') return null;

  const read = status === 'needs_review';
  // pending / processing: the card reached the server but was never read (e.g. it was busy).
  const unread = status === 'pending' || status === 'processing';
  const bg: ThemeColor = read ? 'primarySoft' : 'warningSoft';
  const fg: ThemeColor = read ? 'primary' : 'warning';
  const message = read
    ? 'We read these details from the card. Check them, then save.'
    : unread
      ? "This card hasn't been read yet. Read it now, or fill in the details below."
      : "We couldn't read this card. Fill in the details below.";
  return (
    <View style={[styles.banner, { backgroundColor: theme[bg] }]} accessibilityLiveRegion="polite">
      <Icon name={read ? 'sparkles' : unread ? 'time-outline' : 'alert-circle'} size={20} color={fg} />
      <Text variant="callout" color={read ? 'primary' : 'text'} style={styles.flex}>
        {message}
      </Text>
      {!read && onReread ? (
        <Button
          title={unread ? 'Read card' : 'Try again'}
          size="sm"
          variant="secondary"
          fullWidth={false}
          loading={rereading}
          onPress={onReread}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  wide: { flex: 2 },
  row: { flexDirection: 'row', gap: Spacing.three },
  centered: { flexGrow: 1, justifyContent: 'center' },
  header: { gap: Spacing.three },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.four,
    borderRadius: Radius.lg,
  },
});
