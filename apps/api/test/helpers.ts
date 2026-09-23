import { exports } from 'cloudflare:workers';

import { capturedEmails } from '../src/lib/email';

const BASE = 'http://localhost:8787';

/** Calls the Worker in-process. */
export function call(path: string, init: RequestInit & { token?: string; json?: unknown } = {}) {
  const headers = new Headers(init.headers);
  if (init.token) headers.set('Authorization', `Bearer ${init.token}`);
  let body = init.body;
  if (init.json !== undefined) {
    headers.set('Content-Type', 'application/json');
    body = JSON.stringify(init.json);
  }
  return (exports as unknown as { default: Fetcher }).default.fetch(new Request(BASE + path, { ...init, headers, body }));
}

/** Signs in (creating the user on first use) with email OTP. Returns the bearer token and user id. */
export async function signIn(email: string, code?: string): Promise<{ token: string; userId: string }> {
  const send = await call('/auth/email-otp/send-verification-otp', { method: 'POST', json: { email, type: 'sign-in' } });
  if (!send.ok) throw new Error(`send code failed ${send.status}: ${await send.text()}`);
  let otp = code;
  if (!otp) {
    const mail = [...capturedEmails()].reverse().find((m) => m.to === email);
    otp = mail?.text.match(/\b(\d{6})\b/)?.[1];
    if (!otp) throw new Error(`no code captured for ${email}`);
  }
  const res = await call('/auth/sign-in/email-otp', { method: 'POST', json: { email, otp } });
  if (!res.ok) throw new Error(`sign in failed ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { token: string; user: { id: string } };
  return { token: res.headers.get('set-auth-token') ?? data.token, userId: data.user.id };
}

/** Signs in and creates a profile. */
export async function signUpWithProfile(email: string, displayName: string) {
  const s = await signIn(email);
  const res = await call('/me/profile', { method: 'PUT', token: s.token, json: { displayName } });
  if (!res.ok) throw new Error(`profile failed ${res.status}: ${await res.text()}`);
  const profile = (await res.json()) as { slug: string };
  return { ...s, slug: profile.slug };
}
