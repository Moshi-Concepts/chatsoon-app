import { parseBookingUrl, suggestBookingLabel, type BookingLink, type Contact } from '@chatsoon/shared';
import { useQueryClient } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { BookingLinksCard } from '@/components/booking';
import { CardPhoto } from '@/components/contacts/card-photo';
import { ChannelList, contactChannels, QuickActions } from '@/components/contacts/contact-channels';
import { HeaderTextButton } from '@/components/contacts/header-button';
import { Pill } from '@/components/contacts/pill';
import { PriorityMeter } from '@/components/contacts/priority';
import { isReadingCard, needsReview, sourceIcon, sourceLabel } from '@/components/contacts/source';
import { ReportDialog } from '@/components/moderation/report-dialog';
import { Avatar, Button, Card, Chip, EmptyState, Icon, ListRow, Screen, Section, Text } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { ApiError } from '@/lib/api';
import { confirm, showError } from '@/lib/dialogs';
import { relativeTime, roleLine } from '@/lib/format';
import { discardOutboxItem, getOutboxItem, useOutboxItem, useOutboxReady } from '@/lib/outbox';
import {
  qk,
  removeContactFromCache,
  useBlock,
  useContact,
  useDeleteContact,
  useEvents,
  usePublicProfile,
  useTags,
} from '@/lib/queries';

function leave() {
  if (router.canGoBack()) router.back();
  else router.replace('/contacts');
}

const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;

export default function ContactDetailScreen() {
  const theme = useTheme();
  const qc = useQueryClient();
  const params = useLocalSearchParams<{ id: string }>();
  const id = typeof params.id === 'string' ? params.id : undefined;

  // While deleting or blocking, keep showing the contact but stop the query, so removing it from
  // the cache doesn't refetch a 404 and flash "not found" during the transition away.
  const [frozen, setFrozen] = useState<Contact | null>(null);
  const query = useContact(frozen ? undefined : id);
  // Deleted elsewhere: the refetch 404s while the copy seeded from the list is still in `data`.
  const gone = !frozen && query.error instanceof ApiError && query.error.status === 404;
  const contact = frozen ?? (gone ? undefined : query.data);

  useEffect(() => {
    if (gone) qc.setQueryData<Contact[]>(qk.contacts, (list) => list?.filter((c) => c.id !== id));
  }, [gone, id, qc]);

  const tags = useTags();
  const events = useEvents();
  // Linked contact: load their booking links and contact details (WhatsApp, Signal, a newer phone)
  // live, so anything added or changed after connecting still shows up.
  const linkedProfile = usePublicProfile(contact?.linkedSlug ?? undefined);
  // A card still in the outbox is being uploaded or read on this device.
  const outboxItem = useOutboxItem(id);
  const outboxReady = useOutboxReady();
  const deleteContact = useDeleteContact();
  const block = useBlock();
  const [reporting, setReporting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  async function refresh() {
    setRefreshing(true);
    try {
      await Promise.all([query.refetch(), tags.refetch()]);
    } finally {
      setRefreshing(false);
    }
  }

  if (!contact) {
    const notFound = !id || gone;
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Contact', headerTitle: '' }} />
        {notFound || query.isError ? (
          <EmptyState
            icon={notFound ? 'person-outline' : 'cloud-offline-outline'}
            title={notFound ? 'Contact not found' : "Couldn't load this contact"}
            message={notFound ? 'It may have been deleted.' : query.error?.message}
            action={
              notFound ? (
                <Button title="Back to contacts" variant="secondary" fullWidth={false} onPress={leave} />
              ) : (
                <Button
                  title="Try again"
                  icon="refresh"
                  variant="secondary"
                  fullWidth={false}
                  loading={query.isFetching}
                  onPress={() => void query.refetch()}
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

  const c = contact;
  const subtitle = roleLine(c.role, c.company);
  const eventName = c.eventId ? events.data?.find((e) => e.id === c.eventId)?.name : undefined;
  const added = relativeTime(c.createdAt);
  const metLine = eventName ? `Met at ${eventName} · ${added}` : `Added ${added}`;
  const linked = !!c.linkedUserId;
  // WhatsApp and Signal (and a phone newer than the one copied at connect time) come live from the
  // linked profile; a contact that isn't linked to a Chatsoon user has no live profile to read.
  const channels = contactChannels(c, linked ? linkedProfile.data?.contact : undefined);
  const tagList = (tags.data ?? []).filter((t) => c.tagIds.includes(t.id));
  // Until the tag names load, go by the ids so the "add tags" hint doesn't flash.
  const hasTags = tags.data ? tagList.length > 0 : c.tagIds.length > 0;
  // "Reading" with nothing in the outbox means the read stopped (e.g. the app was signed out
  // mid-way), so offer the review screen, where it can be retried, instead of a spinner.
  const reading = isReadingCard(c.extractionStatus) && (!outboxReady || outboxItem?.kind === 'contact');
  const review = needsReview(c.extractionStatus) || (isReadingCard(c.extractionStatus) && !reading);
  const profileSlug = c.linkedSlug;
  // Sent with the Connect form on my public page by someone without an account: there is no
  // profile to report or block, so the message itself can be reported.
  const connectMessage = !linked && c.source === 'web_connect';
  // No linked user: a card or QR photographed with a Calendly (or similar) link as the website.
  const websiteBooking = !linked && c.website ? parseBookingUrl(c.website) : null;
  const websiteBookingLink: BookingLink | null = websiteBooking
    ? { label: suggestBookingLabel(websiteBooking.url), url: websiteBooking.url, provider: websiteBooking.provider }
    : null;
  // `frozen` stays set after a successful delete or block, so nothing re-enables while the screen closes.
  const busy = !!frozen || deleteContact.isPending || block.isPending;

  async function onDelete() {
    const ok = await confirm({
      title: 'Delete this contact?',
      message: `${c.name} will be removed from your contacts, with their notes and tags. This can't be undone.`,
      confirmText: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    setFrozen(c);
    try {
      // A card still syncing: stop the outbox first, so it doesn't carry on with a deleted contact.
      if (getOutboxItem(c.id)) await discardOutboxItem(c.id);
      await deleteContact.mutateAsync(c.id);
      leave();
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        // Already gone (deleted on another device).
        removeContactFromCache(qc, c.id);
        leave();
        return;
      }
      setFrozen(null);
      showError(err, "Couldn't delete the contact");
    }
  }

  async function onBlock() {
    if (!c.linkedUserId) return;
    const ok = await confirm({
      title: `Block ${c.name}?`,
      message:
        `${firstName(c.name)} won't be able to connect with you again, ` +
        "and they'll be removed from your contacts.",
      confirmText: 'Block',
      destructive: true,
    });
    if (!ok) return;
    setFrozen(c);
    try {
      await block.mutateAsync({ targetUserId: c.linkedUserId });
      removeContactFromCache(qc, c.id);
      router.dismissTo('/contacts');
    } catch (err) {
      setFrozen(null);
      showError(err, "Couldn't block");
    }
  }

  return (
    <Screen refreshing={refreshing} onRefresh={frozen ? undefined : () => void refresh()}>
      <Stack.Screen
        options={{
          // The name is in the hero below; `title` still names the browser tab on web.
          title: c.name,
          headerTitle: '',
          headerRight: () => (
            <HeaderTextButton title="Edit" disabled={busy} onPress={() => router.push(`/contact/${c.id}/edit`)} />
          ),
        }}
      />

      <View style={styles.hero}>
        <Avatar name={c.name} size={88} />
        <View style={styles.heroText}>
          <Text variant="title" align="center" selectable>
            {c.name}
          </Text>
          {subtitle ? (
            <Text variant="callout" color="textSecondary" align="center">
              {subtitle}
            </Text>
          ) : null}
          <Text variant="caption" color="textTertiary" align="center">
            {metLine}
          </Text>
        </View>
        <View style={styles.badges}>
          {linked ? (
            <Pill label="Connected on Chatsoon" icon="shield-checkmark" tone="success" size="md" />
          ) : (
            <Pill label={sourceLabel(c.source)} icon={sourceIcon(c.source)} size="md" />
          )}
        </View>
      </View>

      {review ? (
        <Card style={[styles.banner, { backgroundColor: theme.warningSoft, borderColor: theme.warningSoft }]}>
          <Icon name="alert-circle" size={22} color="warning" />
          <View style={styles.bannerBody}>
            <Text variant="bodyStrong">Check the details from this card</Text>
            <Text variant="caption" color="textSecondary">
              {c.extractionStatus === 'needs_review'
                ? 'Confirm what we read before you rely on it.'
                : c.extractionStatus === 'failed'
                  ? "We couldn't read this card. Fill in the details yourself."
                  : "This card hasn't been read yet. Try again, or fill in the details yourself."}
            </Text>
          </View>
          <Button
            title="Review"
            size="sm"
            fullWidth={false}
            onPress={() => router.push(`/card-review/${c.id}`)}
          />
        </Card>
      ) : reading ? (
        <Card style={[styles.banner, { backgroundColor: theme.primarySoft, borderColor: theme.primarySoft }]}>
          <ActivityIndicator color={theme.primary} />
          <View style={styles.bannerBody}>
            <Text variant="bodyStrong">Reading the card…</Text>
            <Text variant="caption" color="textSecondary">
              The details will appear here when they&apos;re ready.
            </Text>
          </View>
        </Card>
      ) : null}

      <QuickActions channels={channels} />

      {linked ? (
        linkedProfile.data ? <BookingLinksCard links={linkedProfile.data.bookingLinks} ownerName={c.name} /> : null
      ) : websiteBookingLink ? (
        <BookingLinksCard links={[websiteBookingLink]} ownerName={c.name} />
      ) : null}

      {c.cardImageUrl ? <CardPhoto uri={c.cardImageUrl} name={c.name} /> : null}

      {channels.length > 0 ? (
        <Section title="Contact details">
          <ChannelList channels={channels} />
        </Section>
      ) : null}

      {tagList.length > 0 ? (
        <Section title="Tags" inset={false}>
          <View style={styles.tags}>
            {tagList.map((tag) => (
              <Chip key={tag.id} label={tag.name} />
            ))}
          </View>
        </Section>
      ) : null}

      {c.priority ? (
        <Section title="Priority">
          <View style={styles.padded}>
            <PriorityMeter value={c.priority} />
          </View>
        </Section>
      ) : null}

      {c.notes ? (
        <Section title="Notes">
          <View style={styles.padded}>
            <Text variant="body" selectable>
              {c.notes}
            </Text>
          </View>
        </Section>
      ) : null}

      {!hasTags && !c.priority && !c.notes ? (
        <Card style={styles.hint}>
          <Icon name="create-outline" size={20} color="textSecondary" />
          <Text variant="callout" color="textSecondary" style={styles.hintText}>
            Add tags, a priority or notes so you can find and follow up with {firstName(c.name)} later.
          </Text>
          <Button
            title="Edit"
            size="sm"
            variant="secondary"
            fullWidth={false}
            disabled={busy}
            onPress={() => router.push(`/contact/${c.id}/edit`)}
          />
        </Card>
      ) : null}

      {linked ? (
        <Section title="Chatsoon" footer="Blocking removes them from your contacts and stops them connecting with you.">
          {profileSlug ? (
            <ListRow
              title="View profile"
              icon="person-circle-outline"
              iconColor="primary"
              divider
              onPress={() => router.push({ pathname: '/id/[slug]', params: { slug: profileSlug } })}
            />
          ) : null}
          <ListRow
            title={`Report ${firstName(c.name)}`}
            icon="flag-outline"
            divider
            chevron={false}
            onPress={() => setReporting(true)}
          />
          <ListRow
            title={`Block ${firstName(c.name)}`}
            icon="ban-outline"
            destructive
            chevron={false}
            right={block.isPending ? <ActivityIndicator color={theme.danger} /> : undefined}
            onPress={busy ? undefined : () => void onBlock()}
          />
        </Section>
      ) : null}

      {connectMessage ? (
        <Section title="Connect form" footer="Sent from your public page. Report it if it's abusive, then delete it.">
          <ListRow
            title={`Report ${firstName(c.name)}`}
            icon="flag-outline"
            chevron={false}
            onPress={busy ? undefined : () => setReporting(true)}
          />
        </Section>
      ) : null}

      <Button
        title="Delete contact"
        icon="trash-outline"
        variant="dangerSoft"
        loading={deleteContact.isPending}
        disabled={busy}
        onPress={() => void onDelete()}
        style={styles.delete}
      />

      {linked ? (
        <ReportDialog
          visible={reporting}
          onClose={() => setReporting(false)}
          targetUserId={c.linkedUserId}
          targetName={c.name}
        />
      ) : connectMessage ? (
        <ReportDialog visible={reporting} onClose={() => setReporting(false)} contactId={c.id} targetName={c.name} />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 240 },
  hero: { alignItems: 'center', gap: Spacing.three, paddingTop: Spacing.two },
  heroText: { alignItems: 'center', gap: Spacing.one },
  badges: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: Spacing.two },
  banner: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, borderRadius: Radius.lg },
  bannerBody: { flex: 1, gap: 2 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  padded: { padding: Spacing.four },
  hint: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  hintText: { flex: 1 },
  delete: { marginTop: Spacing.four },
});
