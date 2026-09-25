import type { Env } from '../env';

// Apple's OAuth client secret isn't a fixed string: it's a JWT (ES256), signed with the private key
// from the .p8 file Apple issues for a key id, that Apple accepts for up to 6 months. Better Auth
// 1.7.5's `AppleOptions.clientSecret` (node_modules/@better-auth/core/src/social-providers/apple.ts)
// is a plain string with no hook to generate one lazily, so this signs it ourselves with WebCrypto
// and caches it for the isolate's lifetime.

interface CachedSecret {
  /** Identifies which config produced `token`, so a changed env (e.g. between test runs) regenerates. */
  key: string;
  token: string;
  /** Unix seconds. */
  exp: number;
}

let cache: CachedSecret | null = null;

const enc = new TextEncoder();

function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlJson(value: unknown): string {
  return base64url(enc.encode(JSON.stringify(value)));
}

/** Decodes a PEM PKCS8 private key (the .p8 file's contents) to raw DER bytes. */
function pemToDer(pem: string): ArrayBuffer {
  const base64 = pem.replace(/-----BEGIN PRIVATE KEY-----/, '').replace(/-----END PRIVATE KEY-----/, '').replace(/\s+/g, '');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

/** Apple accepts up to 6 months; regenerated well before that so a single token's lifetime never
 * needs a redeploy, and refreshed a day ahead of its own expiry so a slow request never straddles it. */
const SECRET_LIFETIME_SECONDS = 150 * 24 * 60 * 60;
const REFRESH_MARGIN_SECONDS = 24 * 60 * 60;

/**
 * Signs (and caches) Apple's client secret JWT from APPLE_TEAM_ID / APPLE_KEY_ID / APPLE_CLIENT_ID /
 * APPLE_PRIVATE_KEY. Returns null when any of those env vars is missing, so Apple sign-in is simply
 * left out of socialProviders rather than failing.
 */
export async function appleClientSecret(env: Env): Promise<string | null> {
  const clientId = env.APPLE_CLIENT_ID;
  const teamId = env.APPLE_TEAM_ID;
  const keyId = env.APPLE_KEY_ID;
  const privateKey = env.APPLE_PRIVATE_KEY;
  if (!clientId || !teamId || !keyId || !privateKey) return null;

  const cacheKey = `${teamId}:${keyId}:${clientId}`;
  const now = Math.floor(Date.now() / 1000);
  if (cache && cache.key === cacheKey && cache.exp - now > REFRESH_MARGIN_SECONDS) return cache.token;

  const key = await crypto.subtle.importKey('pkcs8', pemToDer(privateKey), { name: 'ECDSA', namedCurve: 'P-256' }, false, [
    'sign',
  ]);
  const exp = now + SECRET_LIFETIME_SECONDS;
  const header = base64urlJson({ alg: 'ES256', kid: keyId });
  const payload = base64urlJson({ iss: teamId, iat: now, exp, aud: 'https://appleid.apple.com', sub: clientId });
  const signingInput = `${header}.${payload}`;
  // WebCrypto's ECDSA signature is raw R||S (32 bytes each for P-256), which is exactly the format
  // JWS ES256 expects - no DER-to-raw conversion needed.
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(signingInput));
  const token = `${signingInput}.${base64url(new Uint8Array(signature))}`;
  cache = { key: cacheKey, token, exp };
  return token;
}

/** Test-only: clears the isolate cache so a test can exercise regeneration deterministically. */
export function resetAppleClientSecretCacheForTests(): void {
  cache = null;
}
