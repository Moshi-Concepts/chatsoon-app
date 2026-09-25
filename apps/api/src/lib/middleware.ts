import type { MiddlewareHandler } from 'hono';

import type { AppEnv } from '../env';
import { createAuth } from './auth';
import { unauthorized } from './errors';

/** Resolves the Better Auth session from the Authorization bearer token. Sets c.var.user. */
export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const auth = await createAuth(c.env, c.executionCtx);
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) throw unauthorized();
  c.set('user', { id: session.user.id, email: session.user.email });
  await next();
};

/** Like requireAuth, but continues without a user when there is no valid session. */
export const optionalAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const hasCreds = c.req.header('authorization') || c.req.header('cookie');
  if (hasCreds) {
    const auth = await createAuth(c.env, c.executionCtx);
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (session) c.set('user', { id: session.user.id, email: session.user.email });
  }
  await next();
};
