import type {
  BlockInput,
  Contact,
  ContactCreateInput,
  ContactUpdateInput,
  ProfileInput,
  ReportInput,
} from '@chatsoon/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from './api';
import { useAuth } from './auth';
import { putContactInCache, qk, removeContactFromCache } from './cache';

export { putContactInCache, qk, removeContactFromCache };

// ---- Me / profile ----

export function useMe() {
  const { status } = useAuth();
  return useQuery({ queryKey: qk.me, queryFn: api.me.get, enabled: status === 'signedIn' });
}

export function useUpdateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ProfileInput) => api.me.updateProfile(input),
    onSuccess: (profile) => {
      qc.setQueryData(qk.me, (me: Awaited<ReturnType<typeof api.me.get>> | undefined) =>
        me ? { ...me, profile } : me,
      );
      void qc.invalidateQueries({ queryKey: qk.me });
      // Your own public page (/id/<slug>) may be open under the editor: refetch it rather than
      // writing MyProfile into it (the public shape has fewer fields).
      void qc.invalidateQueries({ queryKey: qk.profile(profile.slug) });
    },
  });
}

/** Public profile by slug. Works signed in or out. */
export function usePublicProfile(slug: string | undefined) {
  return useQuery({
    queryKey: qk.profile(slug ?? ''),
    queryFn: () => api.profiles.get(slug!),
    enabled: !!slug,
    retry: (count, err) => (err as { status?: number }).status !== 404 && count < 2,
  });
}

// ---- Contacts ----

/** All of my contacts, newest first. Search and tag filtering happen client-side over this list. */
export function useContacts() {
  const { status } = useAuth();
  return useQuery({
    queryKey: qk.contacts,
    queryFn: async () => (await api.contacts.list()).contacts,
    enabled: status === 'signedIn',
  });
}

/** One contact. Seeds from the list cache so detail screens render instantly. */
export function useContact(id: string | undefined) {
  const qc = useQueryClient();
  const { status } = useAuth();
  return useQuery({
    queryKey: qk.contact(id ?? ''),
    queryFn: () => api.contacts.get(id!),
    enabled: status === 'signedIn' && !!id,
    retry: (count, err) => (err as { status?: number }).status !== 404 && count < 1,
    initialData: () => qc.getQueryData<Contact[]>(qk.contacts)?.find((c) => c.id === id),
    initialDataUpdatedAt: () => qc.getQueryState(qk.contacts)?.dataUpdatedAt,
  });
}

export function useCreateContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ContactCreateInput) => api.contacts.create(input),
    onSuccess: (contact) => putContactInCache(qc, contact),
  });
}

export function useUpdateContact(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ContactUpdateInput) => api.contacts.update(id, input),
    onSuccess: (contact) => putContactInCache(qc, contact),
  });
}

export function useDeleteContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.contacts.remove(id),
    onSuccess: (_void, id) => removeContactFromCache(qc, id),
  });
}

// ---- Connect ----

export function useScanConnect() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ slug, eventId }: { slug: string; eventId?: string | null }) =>
      api.connections.scan(slug, eventId),
    onSuccess: ({ contact }) => putContactInCache(qc, contact),
  });
}

// ---- Tags & events ----

export function useTags() {
  const { status } = useAuth();
  return useQuery({
    queryKey: qk.tags,
    queryFn: async () => (await api.tags.list()).tags,
    enabled: status === 'signedIn',
  });
}

export function useCreateTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => api.tags.create(name),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.tags }),
  });
}

export function useDeleteTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.tags.remove(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.tags });
      void qc.invalidateQueries({ queryKey: qk.contacts });
    },
  });
}

export function useEvents() {
  const { status } = useAuth();
  return useQuery({
    queryKey: qk.events,
    queryFn: async () => (await api.events.list()).events,
    enabled: status === 'signedIn',
    staleTime: 10 * 60 * 1000,
  });
}

export function useCreateEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => api.events.create(name),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.events }),
  });
}

// ---- Moderation ----

export function useReport() {
  return useMutation({ mutationFn: (input: ReportInput) => api.moderation.report(input) });
}

export function useBlock() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: BlockInput) => api.moderation.block(input),
    // Blocking removes their card from my contacts on the server.
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.contacts }),
  });
}

/** Unblock by user id or public slug. Refreshes that profile so the page can offer Connect again. */
export function useUnblock() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (idOrSlug: string) => api.moderation.unblock(idOrSlug),
    onSuccess: (_void, idOrSlug) => void qc.invalidateQueries({ queryKey: qk.profile(idOrSlug) }),
  });
}
