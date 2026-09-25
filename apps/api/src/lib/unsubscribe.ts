import { SUPPORT_EMAIL } from '@chatsoon/shared';

import type { Env } from '../env';
import { hmacHex, timingSafeEqual } from './signing';

// One-click unsubscribe tokens for tips emails (issue #7). No raw token is ever stored: the token
// itself carries who it's for (a lead's email, or a signed-in user's id) plus an HMAC over it, using
// the same FILE_SIGNING_SECRET as signed file/vcard URLs, verified by recomputing at unsubscribe
// time. That means POST /email/unsubscribe (routes/email.ts) needs no lookup to know which table to
// update, and there is no `*_token_hash` column to keep in sync with it.

export type UnsubscribeKind = 'lead' | 'user';

function base64UrlEncodeText(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecodeText(value: string): string | null {
  try {
    const padded = value.replace(/-/g, '+').replace(/_/g, '/');
    const withPad = padded + '='.repeat((4 - (padded.length % 4)) % 4);
    const binary = atob(withPad);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

/** A token for `id` (a lowercased lead email, or a user id). Stable: the same inputs always mint the same token. */
export async function unsubscribeToken(env: Env, kind: UnsubscribeKind, id: string): Promise<string> {
  const sig = await hmacHex(env.FILE_SIGNING_SECRET, `unsub:${kind}:${id}`);
  return base64UrlEncodeText(`${kind}:${id}:${sig}`);
}

export interface ParsedUnsubscribeToken {
  kind: UnsubscribeKind;
  id: string;
}

/**
 * Verifies a token minted by `unsubscribeToken`. Never throws: a malformed, tampered or unknown-kind
 * token is just null, same as an expired/bad file signature (verifyFileSignature).
 * A lead's `id` (its email) may itself contain ':' in rare cases, so the signature - always fixed-width
 * hex - is peeled off from the end rather than split on the first colon.
 */
export async function verifyUnsubscribeToken(env: Env, token: string): Promise<ParsedUnsubscribeToken | null> {
  const raw = base64UrlDecodeText(token);
  if (!raw) return null;
  const firstColon = raw.indexOf(':');
  const lastColon = raw.lastIndexOf(':');
  if (firstColon < 0 || lastColon <= firstColon) return null;

  const kind = raw.slice(0, firstColon);
  const id = raw.slice(firstColon + 1, lastColon);
  const sig = raw.slice(lastColon + 1);
  if ((kind !== 'lead' && kind !== 'user') || !id || !sig) return null;

  const expected = await hmacHex(env.FILE_SIGNING_SECRET, `unsub:${kind}:${id}`);
  return timingSafeEqual(expected, sig) ? { kind, id } : null;
}

/** The link every tips email carries: `GET` redirects to the web unsubscribe page; `POST` is the one-click action. */
export function unsubscribeUrl(env: Env, token: string): string {
  return `${env.API_ORIGIN}/email/unsubscribe?token=${encodeURIComponent(token)}`;
}

/**
 * RFC 8058 one-click unsubscribe headers, required on every tips email. `List-Unsubscribe-Post`
 * tells a compliant mail client it may POST the URL with no user interaction (no login page, no
 * "are you sure"); `List-Unsubscribe` gives both the link and a mailto fallback for clients that
 * don't support the one-click form.
 */
export function listUnsubscribeHeaders(url: string): Record<string, string> {
  return {
    'List-Unsubscribe': `<${url}>, <mailto:${SUPPORT_EMAIL}?subject=unsubscribe>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  };
}
