import { describe, expect, it } from 'vitest';

import { call, signIn } from './helpers';

describe('health and auth', () => {
  it('responds on /health', async () => {
    const res = await call('/health');
    expect(res.status).toBe(200);
  });

  it('signs in with an emailed code and resolves the session with the bearer token', async () => {
    const { token } = await signIn('health@example.com');
    const res = await call('/auth/get-session', { token });
    const data = (await res.json()) as { user: { email: string } };
    expect(data.user.email).toBe('health@example.com');
  });
});
