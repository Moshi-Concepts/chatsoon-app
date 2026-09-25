import type { Env } from '../env';

// Signed, time-limited URLs: for private R2 objects (served by GET /files/*) and for the vCard
// of a 'connections' profile (served by GET /id/:slug/vcard). Both share one HMAC secret and the
// same expiry-rounding trick so repeated calls return the same URL and clients can cache it.

const enc = new TextEncoder();

/** Exported for lib/unsubscribe.ts, which HMACs a lead's email or a user id the same way. */
export async function hmacHex(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, '0')).join('');
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Keys look like u/<userId>/<purpose>/<uuid>.<ext>. */
export function fileKey(userId: string, purpose: 'avatar' | 'card', ext: string): string {
  return `u/${userId}/${purpose}/${crypto.randomUUID()}.${ext}`;
}

/** True when an R2 key belongs to this user. Always check before trusting a client-sent key. */
export function ownsKey(userId: string, key: string): boolean {
  return key.startsWith(`u/${userId}/`) && !key.includes('..');
}

export const userPrefix = (userId: string) => `u/${userId}/`;

/** Card photos live under u/<me>/card/ (POST /files?purpose=card). Never my avatar or anyone else's file. */
export const isCardKey = (userId: string, key: string) =>
  ownsKey(userId, key) && key.startsWith(`${userPrefix(userId)}card/`);

/**
 * Signed URL valid for at least `ttlSeconds`. Expiry is rounded up to the hour so
 * repeated calls return the same URL and clients can cache the image.
 */
export async function signedFileUrl(env: Env, key: string, ttlSeconds = 3600): Promise<string> {
  const exp = Math.ceil((Math.floor(Date.now() / 1000) + ttlSeconds) / 3600) * 3600;
  const sig = await hmacHex(env.FILE_SIGNING_SECRET, `${key}:${exp}`);
  const path = key.split('/').map(encodeURIComponent).join('/');
  return `${env.API_ORIGIN}/files/${path}?exp=${exp}&sig=${sig}`;
}

export async function verifyFileSignature(env: Env, key: string, exp: string, sig: string): Promise<boolean> {
  const expNum = Number(exp);
  if (!Number.isFinite(expNum) || expNum < Date.now() / 1000) return false;
  const expected = await hmacHex(env.FILE_SIGNING_SECRET, `${key}:${expNum}`);
  return timingSafeEqual(expected, sig);
}

/**
 * Signed URL to GET /id/:slug/vcard that carries the owner's phone and messaging details, valid for
 * at least `ttlSeconds`. Only ever offered alongside `contact` on a 'connections' profile, to a
 * viewer who may already see it (§2 of the plan): the owner, an accepted connection, or a Connect
 * form sender. Expiry is rounded up to the hour, same trick as signedFileUrl.
 */
export async function signedVcardUrl(env: Env, slug: string, ttlSeconds = 3600): Promise<string> {
  const exp = Math.ceil((Math.floor(Date.now() / 1000) + ttlSeconds) / 3600) * 3600;
  const sig = await hmacHex(env.FILE_SIGNING_SECRET, `vcard:${slug}:${exp}`);
  return `${env.API_ORIGIN}/id/${slug}/vcard?exp=${exp}&sig=${sig}`;
}

/**
 * Checks a GET /id/:slug/vcard signature against `slug` specifically, so a signature minted for one
 * slug never verifies for another. A bad or expired signature must never throw: the caller falls
 * back to the plain (no-contact) vCard rather than an error.
 */
export async function verifyVcardSignature(env: Env, slug: string, exp: string, sig: string): Promise<boolean> {
  const expNum = Number(exp);
  if (!Number.isFinite(expNum) || expNum < Date.now() / 1000) return false;
  const expected = await hmacHex(env.FILE_SIGNING_SECRET, `vcard:${slug}:${expNum}`);
  return timingSafeEqual(expected, sig);
}
