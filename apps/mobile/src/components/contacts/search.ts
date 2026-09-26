import type { Contact } from '@chatsoon/shared';
import { isFollowUpDue } from '@chatsoon/shared';

export type ContactFilter =
  | { kind: 'all' }
  | { kind: 'tag'; id: string }
  | { kind: 'event'; id: string }
  | { kind: 'followUp' };

export const ALL_CONTACTS: ContactFilter = { kind: 'all' };
/** The "To follow up" filter chip (issue #33): every contact due for a follow-up right now. */
export const FOLLOW_UP_FILTER: ContactFilter = { kind: 'followUp' };

/** Contacts due for a follow-up right now (issue #33), most overdue first: never followed up with
 * their due date passed, or due again after a "Remind me again". */
export function dueContacts(contacts: Contact[], now: Date = new Date()): Contact[] {
  return contacts
    .filter((c) => isFollowUpDue(c, now))
    .sort((a, b) => new Date(a.followUpDueAt!).getTime() - new Date(b.followUpDueAt!).getTime());
}

export type SearchEntry = { contact: Contact; text: string };

/** Lowercase and strip accents, so "jose" finds "José". */
export function normalizeSearch(value: string): string {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

/** Precomputes the searchable text of each contact: its fields, tag names and event name. */
export function buildSearchIndex(
  contacts: Contact[],
  tagNames: Map<string, string>,
  eventNames: Map<string, string>,
): SearchEntry[] {
  return contacts.map((contact) => {
    const parts = [
      contact.name,
      contact.company,
      contact.role,
      contact.email,
      contact.phone,
      // Digits only, so "0412345" finds "0412 345 678".
      contact.phone ? contact.phone.replace(/\D/g, '') : null,
      contact.telegram,
      contact.telegram ? `@${contact.telegram}` : null,
      contact.xHandle,
      contact.xHandle ? `@${contact.xHandle}` : null,
      contact.notes,
      contact.eventId ? eventNames.get(contact.eventId) : null,
      ...contact.tagIds.map((id) => tagNames.get(id)),
    ];
    return { contact, text: normalizeSearch(parts.filter(Boolean).join('\n')) };
  });
}

/** Every word of the query has to appear somewhere in the contact. */
export function filterContacts(index: SearchEntry[], query: string, filter: ContactFilter, now: Date = new Date()): Contact[] {
  const words = normalizeSearch(query).split(/\s+/).filter(Boolean);
  const result: Contact[] = [];
  for (const { contact, text } of index) {
    if (filter.kind === 'tag' && !contact.tagIds.includes(filter.id)) continue;
    if (filter.kind === 'event' && contact.eventId !== filter.id) continue;
    if (filter.kind === 'followUp' && !isFollowUpDue(contact, now)) continue;
    if (words.every((w) => text.includes(w))) result.push(contact);
  }
  return result;
}
