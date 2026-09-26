import type { Contact } from '@chatsoon/shared';
import { useQueryClient } from '@tanstack/react-query';
import { router, Stack, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState, type ReactElement } from 'react';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';

import { ContactListSkeleton, ContactRow } from '@/components/contacts/contact-row';
import { FilterBar } from '@/components/contacts/filter-bar';
import { FollowUpSection } from '@/components/contacts/follow-up-section';
import { HeaderIconButton } from '@/components/contacts/header-button';
import { OutboxSection } from '@/components/contacts/outbox-section';
import {
  ALL_CONTACTS,
  buildSearchIndex,
  dueContacts,
  filterContacts,
  FOLLOW_UP_FILTER,
  type ContactFilter,
} from '@/components/contacts/search';
import { SearchField } from '@/components/contacts/search-field';
import { isReadingCard, needsReview, plural } from '@/components/contacts/source';
import { DeletionBanner } from '@/components/deletion-banner';
import { ContactsReferralBanner } from '@/components/referrals/contacts-banner';
import { Button, EmptyState, Icon, Screen, Text } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useOutbox } from '@/lib/outbox';
import { qk, useContacts, useEvents, useMe, useTags } from '@/lib/queries';

function sameFilter(a: ContactFilter, b: ContactFilter): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'tag' && b.kind === 'tag') return a.id === b.id;
  if (a.kind === 'event' && b.kind === 'event') return a.id === b.id;
  return true;
}

/** Cards still being read or waiting for review open the review screen, which shows progress or the form. */
function openContact(contact: Contact) {
  const status = contact.extractionStatus;
  if (needsReview(status) || isReadingCard(status)) router.push(`/card-review/${contact.id}`);
  else router.push(`/contact/${contact.id}`);
}

export default function ContactsScreen() {
  const theme = useTheme();
  const qc = useQueryClient();
  const me = useMe();
  const contacts = useContacts();
  const tags = useTags();
  const events = useEvents();
  const outbox = useOutbox();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<ContactFilter>(ALL_CONTACTS);
  const [refreshing, setRefreshing] = useState(false);

  // Tabs stay mounted, so pick up new contacts (web connects, other devices) when the tab comes
  // back into view. Only stale queries refetch, and an in-flight fetch is reused.
  useFocusEffect(
    useCallback(() => {
      for (const queryKey of [qk.contacts, qk.tags]) {
        void qc.refetchQueries({ queryKey, exact: true, stale: true, type: 'active' }, { cancelRefetch: false });
      }
    }, [qc]),
  );

  const all = useMemo(() => contacts.data ?? [], [contacts.data]);
  const tagNames = useMemo(() => new Map((tags.data ?? []).map((t) => [t.id, t.name])), [tags.data]);
  const eventNames = useMemo(() => new Map((events.data ?? []).map((e) => [e.id, e.name])), [events.data]);
  const usedEvents = useMemo(() => {
    const ids = new Set(all.map((c) => c.eventId));
    return (events.data ?? []).filter((e) => ids.has(e.id));
  }, [all, events.data]);
  // Per-tag and per-event contact counts, shown on the filter chips.
  const tagCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of all) {
      for (const id of c.tagIds) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return counts;
  }, [all]);
  const eventCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of all) {
      if (c.eventId) counts.set(c.eventId, (counts.get(c.eventId) ?? 0) + 1);
    }
    return counts;
  }, [all]);
  const index = useMemo(() => buildSearchIndex(all, tagNames, eventNames), [all, tagNames, eventNames]);
  // Recomputed with the list, not on a timer: due dates only matter to the minute, and every write
  // that could change them (creating, following up, a remind) already refreshes `all`.
  const due = useMemo(() => dueContacts(all), [all]);

  // A filter on a tag that was deleted, an event with no contacts left, or "To follow up" once
  // nothing is due any more, falls back to All.
  const active: ContactFilter =
    (filter.kind === 'tag' && !tagNames.has(filter.id)) ||
    (filter.kind === 'event' && !usedEvents.some((e) => e.id === filter.id)) ||
    (filter.kind === 'followUp' && due.length === 0)
      ? ALL_CONTACTS
      : filter;
  const visible = useMemo(() => filterContacts(index, query, active), [index, query, active]);

  // An item can briefly be both sent and still in the outbox; the real contact wins.
  const pending = useMemo(() => {
    const ids = new Set(all.map((c) => c.id));
    return outbox.items.filter((item) => item.kind !== 'contact' || !ids.has(item.id));
  }, [all, outbox.items]);

  const filtering = query.trim() !== '' || active.kind !== 'all';
  const filterName =
    active.kind === 'tag'
      ? tagNames.get(active.id)
      : active.kind === 'event'
        ? eventNames.get(active.id)
        : active.kind === 'followUp'
          ? 'To follow up'
          : undefined;

  function toggleFilter(next: ContactFilter) {
    setFilter(sameFilter(active, next) ? ALL_CONTACTS : next);
  }

  function clearFilters() {
    setQuery('');
    setFilter(ALL_CONTACTS);
  }

  async function refresh() {
    setRefreshing(true);
    try {
      await Promise.all([contacts.refetch(), tags.refetch(), events.refetch(), outbox.flush()]);
    } finally {
      setRefreshing(false);
    }
  }

  const header = (
    <View style={styles.listHeader}>
      {contacts.isError && contacts.data ? (
        // A refresh failed but there is a list to show: keep it, and say it may be out of date.
        <View accessibilityRole="alert" style={[styles.notice, { backgroundColor: theme.warningSoft }]}>
          <Icon name="cloud-offline-outline" size={18} color="warning" />
          <Text variant="caption" style={styles.flex}>
            Couldn&apos;t refresh. Showing your saved list.
          </Text>
        </View>
      ) : null}
      {pending.length > 0 ? <OutboxSection items={pending} /> : null}
      {all.length > 0 ? (
        <Text variant="caption" color="textSecondary" style={styles.summary}>
          {filtering ? `${visible.length} of ${plural(all.length, 'contact')}` : plural(all.length, 'contact')}
          {filterName ? ` · ${filterName}` : ''}
        </Text>
      ) : null}
    </View>
  );

  let empty: ReactElement | null = null;
  if (contacts.isPending) {
    empty = <ContactListSkeleton />;
  } else if (contacts.isError && !contacts.data) {
    empty = (
      <EmptyState
        icon="cloud-offline-outline"
        title="Couldn't load your contacts"
        message={contacts.error.message}
        action={
          <Button
            title="Try again"
            icon="refresh"
            variant="secondary"
            fullWidth={false}
            loading={contacts.isFetching}
            onPress={() => void contacts.refetch()}
          />
        }
      />
    );
  } else if (all.length === 0) {
    empty =
      pending.length > 0 ? null : (
        <EmptyState
          icon="people-outline"
          title="Your contacts will show up here"
          message="Scan someone's QR code, photograph a business card, or add people by hand."
          action={
            <View style={styles.emptyActions}>
              <Button title="Scan a QR" icon="scan-outline" onPress={() => router.push('/scan')} />
              <Button
                title="Add manually"
                icon="create-outline"
                variant="secondary"
                onPress={() => router.push('/contact/new')}
              />
            </View>
          }
        />
      );
  } else {
    empty = (
      <EmptyState
        icon="search-outline"
        title="No matches"
        message={
          query.trim()
            ? `Nobody matches "${query.trim()}"${filterName ? ` in ${filterName}` : ''}.`
            : `No contacts in ${filterName ?? 'this filter'} yet.`
        }
        action={
          <Button
            title={query.trim() ? 'Clear search' : 'Show all contacts'}
            variant="secondary"
            fullWidth={false}
            onPress={clearFilters}
          />
        }
      />
    );
  }

  return (
    <Screen scroll={false} padded={false} edges={[]} contentStyle={styles.screen}>
      <Stack.Screen
        options={{
          title: 'Contacts',
          headerRight: () => <HeaderIconButton icon="add" label="Add contact" onPress={() => router.push('/add')} />,
        }}
      />

      {me.data?.deletionScheduledFor ? (
        <View style={styles.bannerWrap}>
          <DeletionBanner deleteAfter={me.data.deletionScheduledFor} compact />
        </View>
      ) : null}
      <ContactsReferralBanner />
      <FollowUpSection due={due} onSeeAll={() => setFilter(FOLLOW_UP_FILTER)} />

      {all.length > 0 ? (
        <View style={styles.toolbar}>
          <View style={styles.search}>
            <SearchField
              value={query}
              onChangeText={setQuery}
              placeholder="Search name, company, tag, notes"
              accessibilityLabel="Search contacts"
            />
          </View>
          <FilterBar
            active={active}
            totalCount={all.length}
            tags={tags.data ?? []}
            tagCounts={tagCounts}
            events={usedEvents}
            eventCounts={eventCounts}
            dueCount={due.length}
            onSelectAll={() => setFilter(ALL_CONTACTS)}
            onToggleFilter={toggleFilter}
          />
        </View>
      ) : null}

      <FlatList
        data={visible}
        keyExtractor={(c) => c.id}
        renderItem={({ item, index: i }) => (
          <ContactRow
            contact={item}
            tagNames={tagNames}
            first={i === 0}
            last={i === visible.length - 1}
            onPress={() => openContact(item)}
          />
        )}
        ListHeaderComponent={header}
        ListEmptyComponent={contacts.isPending || !empty ? empty : <View style={styles.emptyFill}>{empty}</View>}
        style={styles.flex}
        contentContainerStyle={styles.listContent}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void refresh()}
            tintColor={theme.primary}
            colors={[theme.primary]}
          />
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  screen: { gap: 0 },
  // Gap and bottom padding are 4pt less than they look: the chip row adds 4pt above and below.
  toolbar: { paddingTop: Spacing.two, paddingBottom: Spacing.two, gap: Spacing.two },
  bannerWrap: { paddingHorizontal: Spacing.four, paddingTop: Spacing.two },
  search: { paddingHorizontal: Spacing.four },
  listContent: { flexGrow: 1, paddingHorizontal: Spacing.four, paddingBottom: Spacing.six },
  listHeader: { gap: Spacing.four, paddingBottom: Spacing.two },
  summary: { paddingHorizontal: Spacing.one },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Radius.md,
  },
  emptyFill: { flex: 1, justifyContent: 'center', paddingBottom: Spacing.seven },
  emptyActions: { width: '100%', maxWidth: 320, gap: Spacing.three },
});
