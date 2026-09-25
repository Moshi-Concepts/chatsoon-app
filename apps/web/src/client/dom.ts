/// <reference lib="dom" />
// Small, framework-free DOM helpers shared by the island's other modules (WP-C4). No tsconfig.json
// in this package carries the DOM lib (server-side render/server code deliberately compiles without
// it), so every client/*.ts file that touches `document`/`window` pulls the DOM lib in for itself
// with this directive; tsconfig.client.json also sets it, for editors and the dedicated client
// typecheck run.

import { CONTACT_KEYS, contactUrl, displayContact } from '@chatsoon/shared/src/profile-contact';
import type { ProfileContact, ProfileContactKey } from '@chatsoon/shared/src/types';

export function qs<T extends Element = Element>(root: ParentNode, selector: string): T | null {
  return root.querySelector<T>(selector);
}

export function qsa<T extends Element = Element>(root: ParentNode, selector: string): T[] {
  return Array.from(root.querySelectorAll<T>(selector));
}

/** One contact channel resolved to a tappable link. */
export interface ContactLink {
  key: ProfileContactKey;
  href: string;
  label: string;
  /** false only for `tel:` (opens in the same tab). wa.me and signal.me always open a new tab. */
  newTab: boolean;
}

/**
 * Builds the "how to reach {first}" links from a contact object, in CONTACT_KEYS order. Mirrors
 * apps/mobile/src/components/web/contact-pills.tsx's ContactPills: it re-derives from
 * contactUrl/displayContact rather than trusting whatever channel keys happen to be present, so a
 * channel with an unusable stored value (or one the caller injected) never renders a broken pill.
 */
export function contactLinks(contact: ProfileContact | null | undefined): ContactLink[] {
  if (!contact) return [];
  const links: ContactLink[] = [];
  for (const key of CONTACT_KEYS) {
    const href = contactUrl(key, contact[key]);
    const label = displayContact(key, contact[key]);
    if (href && label) links.push({ key, href, label, newTab: key !== 'phone' });
  }
  return links;
}

/** Remembers, per dialog, which element to refocus when it closes. */
const dialogOpeners = new WeakMap<HTMLDialogElement, HTMLElement>();

/**
 * Shows `dialog` modally and remembers `opener` (defaulting to whatever currently has focus), so
 * `wireDialogFocusReturn` can restore focus to it once the dialog closes — including on Escape,
 * which fires 'cancel' then 'close' on a native <dialog> with no extra wiring needed here.
 */
export function openDialog(dialog: HTMLDialogElement, opener?: HTMLElement | null): void {
  const target = opener ?? (document.activeElement as HTMLElement | null);
  if (target) dialogOpeners.set(dialog, target);
  dialog.showModal();
}

/** Wires `dialog`, once, to return focus to its opener on close. Call right after creating it. */
export function wireDialogFocusReturn(dialog: HTMLDialogElement): void {
  dialog.addEventListener('close', () => {
    const opener = dialogOpeners.get(dialog);
    if (opener && document.contains(opener)) opener.focus();
  });
}

/** `{code, message}` out of an `{error:{code,message}}` API error body (apps/api/src/lib/errors.ts'
 * `errorBody`), or safe defaults for a body that isn't shaped like one (a non-JSON error page, a
 * network failure that never reached the server). Shared by connect.ts and report.ts. */
export function errorFromBody(body: unknown): { code: string; message: string | null } {
  if (body && typeof body === 'object' && 'error' in body) {
    const err = (body as { error?: { code?: string; message?: string } }).error;
    return { code: err?.code ?? 'internal', message: err?.message ?? null };
  }
  return { code: 'internal', message: null };
}
