import type { ApiErrorBody, ApiErrorCode } from '@chatsoon/shared';
import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { z } from 'zod';

export class ApiError extends Error {
  constructor(
    public status: ContentfulStatusCode,
    public code: ApiErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export const badRequest = (message = 'Bad request') => new ApiError(400, 'bad_request', message);
export const unauthorized = (message = 'Sign in required') => new ApiError(401, 'unauthorized', message);
export const forbidden = (message = 'Not allowed') => new ApiError(403, 'forbidden', message);
export const notFound = (message = 'Not found') => new ApiError(404, 'not_found', message);
export const conflict = (message = 'Conflict') => new ApiError(409, 'conflict', message);
export const rateLimited = (message = 'Too many requests, try again in a minute') =>
  new ApiError(429, 'rate_limited', message);

export function errorBody(code: ApiErrorCode, message: string): ApiErrorBody {
  return { error: { code, message } };
}

export function onError(err: Error, c: Context) {
  if (err instanceof ApiError) return c.json(errorBody(err.code, err.message), err.status);
  if (err instanceof z.ZodError) {
    const first = err.issues[0];
    const where = first?.path.length ? `${first.path.join('.')}: ` : '';
    return c.json(errorBody('bad_request', `${where}${first?.message ?? 'Invalid input'}`), 400);
  }
  console.error('Unhandled error', err);
  return c.json(errorBody('internal', 'Something went wrong'), 500);
}

/** Parses a JSON body with a zod schema. Throws ZodError / ApiError, handled by onError. */
export async function parseJson<T extends z.ZodType>(c: Context, schema: T): Promise<z.output<T>> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw badRequest('Body must be JSON');
  }
  return schema.parse(body);
}

/**
 * Uses a rate limiter binding. A null key or missing binding always passes, so pass
 * `ipKey(c)` for IP based limits: it is null locally and in tests (no cf-connecting-ip).
 */
export async function limit(limiter: RateLimit | undefined, key: string | null) {
  if (!limiter || !key) return;
  const { success } = await limiter.limit({ key });
  if (!success) throw rateLimited();
}

/** The caller's IP from Cloudflare, or null when not behind Cloudflare. */
export function ipKey(c: Context, scope = ''): string | null {
  const ip = c.req.header('cf-connecting-ip');
  return ip ? `${scope}:${ip}` : null;
}

export function clientIp(c: Context): string | null {
  return c.req.header('cf-connecting-ip') ?? null;
}
