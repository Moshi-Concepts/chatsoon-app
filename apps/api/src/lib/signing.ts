import type { Env } from '../env';

// Signed, time-limited URLs for private R2 objects, served by GET /files/*.
// R2 stays private; the Worker checks the HMAC before streaming the object.

const enc = new TextEncoder();

async function hmacHex(secret: string, data: string): Promise<string> {
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
