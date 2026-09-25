import type { Contact } from '@chatsoon/shared';
import type { QueryClient } from '@tanstack/react-query';

// Query keys and cache writers. Kept apart from queries.ts (which needs auth) so the outbox can
// use them without an import cycle.

export const qk = {
  me: ['me'] as const,
  authProviders: ['auth-providers'] as const,
  contacts: ['contacts'] as const,
  contact: (id: string) => ['contacts', id] as const,
  tags: ['tags'] as const,
  events: ['events'] as const,
  profile: (slug: string) => ['profile', slug] as const,
  referral: ['referral'] as const,
  connectedAccounts: ['connected-accounts'] as const,
};

/** Writes a contact into both the list and detail caches. */
export function putContactInCache(qc: QueryClient, contact: Contact) {
  qc.setQueryData<Contact[]>(qk.contacts, (list) => {
    if (!list) return list;
    const rest = list.filter((c) => c.id !== contact.id);
    return [contact, ...rest];
  });
  qc.setQueryData(qk.contact(contact.id), contact);
}

export function removeContactFromCache(qc: QueryClient, id: string) {
  qc.setQueryData<Contact[]>(qk.contacts, (list) => list?.filter((c) => c.id !== id));
  qc.removeQueries({ queryKey: qk.contact(id) });
}
