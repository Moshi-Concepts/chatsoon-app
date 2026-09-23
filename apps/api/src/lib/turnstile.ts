import type { Env } from '../env';

export const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

interface SiteverifyResponse {
  success?: boolean;
  'error-codes'?: string[];
}

/**
 * Checks a Turnstile token with Cloudflare's siteverify API.
 * Fails closed: a network error, timeout or non-2xx reply counts as a failed check.
 */
export async function verifyTurnstile(env: Env, token: string, remoteIp: string | null): Promise<boolean> {
  if (!env.TURNSTILE_SECRET) {
    console.error('TURNSTILE_SECRET is not set');
    return false;
  }

  const form = new FormData();
  form.append('secret', env.TURNSTILE_SECRET);
  form.append('response', token);
  if (remoteIp) form.append('remoteip', remoteIp);

  try {
    const res = await fetch(TURNSTILE_VERIFY_URL, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      console.error(`Turnstile siteverify returned ${res.status}`);
      return false;
    }
    const data = (await res.json()) as SiteverifyResponse;
    if (data.success !== true) console.warn('Turnstile rejected token', data['error-codes'] ?? []);
    return data.success === true;
  } catch (err) {
    console.error('Turnstile siteverify failed', err);
    return false;
  }
}
