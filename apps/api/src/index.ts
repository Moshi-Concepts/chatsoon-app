import type { AuthProvidersResponse } from '@chatsoon/shared';
import { SOCIAL_PROVIDERS, SOCIAL_VALIDATION_PROVIDERS } from '@chatsoon/shared';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';

import type { AppEnv, Env } from './env';
import { allowedOrigins, buildSocialProviders, createAuth, otpRateLimit } from './lib/auth';
import { getDb } from './lib/db';
import { runDueDeletions } from './lib/deletion';
import { errorBody, onError } from './lib/errors';
import { runReferralQualification, sweepReferralInvites } from './lib/referrals';
import { runEmailSequences } from './lib/sequences';
import { accountRoutes } from './routes/account';
import { connectionsRoutes } from './routes/connections';
import { contactsRoutes } from './routes/contacts';
import { emailRoutes } from './routes/email';
import { eventsRoutes } from './routes/events';
import { extractRoutes } from './routes/extract';
import { filesRoutes } from './routes/files';
import { moderationRoutes } from './routes/moderation';
import { pagesRoutes } from './routes/pages';
import { profileRoutes } from './routes/profile';
import { publicRoutes } from './routes/public';
import { referralsRoutes } from './routes/referrals';
import { tagsRoutes } from './routes/tags';

// Route table (MVP). Each module owns its paths:
//   /auth/*                                   Better Auth (email OTP, plus social sign-in once a
//                                              provider is configured, issue #24), lib/auth.ts
//   GET  /auth-providers (no auth)             enabled social providers, index.ts
//   GET  /id/:slug  GET /id/:slug/vcard  POST /id/:slug/connect      routes/public.ts
//   GET  /me  PUT /me/profile                                         routes/profile.ts
//   DELETE /me  POST/DELETE /me/deletion  GET /me/export.csv           routes/account.ts
//   POST /account-deletion/cancel (no auth)                            routes/account.ts
//   POST /connections/scan                                            routes/connections.ts
//   GET/POST /contacts  GET/PUT/DELETE /contacts/:id                  routes/contacts.ts
//   POST/DELETE/PATCH /contacts/:id/follow-up (issue #33)              routes/contacts.ts
//   GET/POST /tags  DELETE /tags/:id                                  routes/tags.ts
//   GET/POST /events                                                  routes/events.ts
//   POST /files  GET /files/*  DELETE /files/card                     routes/files.ts
//   POST /extract/card                                                routes/extract.ts
//   POST /reports  POST /blocks  DELETE /blocks/:userId               routes/moderation.ts
//   GET /_pages/profile/:slug  GET /_pages/og/:slug (secret-gated)     routes/pages.ts
//   GET/POST /email/unsubscribe (no auth)                              routes/email.ts

const app = new Hono<AppEnv>();

app.use('*', async (c, next) => {
  const origins = allowedOrigins(c.env);
  return cors({
    origin: (origin) => (origins.includes(origin) ? origin : null),
    // X-Chatsoon-Device (issue #11): sent on POST /me/referral/attribute only.
    allowHeaders: ['Content-Type', 'Authorization', 'X-Chatsoon-Device'],
    // PATCH: only /contacts/:id/follow-up (issue #33, "Remind me again").
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    exposeHeaders: ['set-auth-token', 'Content-Disposition'],
    credentials: true,
    maxAge: 86400,
  })(c, next);
});

// Every JSON body is small (the largest, a contact with notes and 50 tags, is under 32 KB). Capping
// them before anything reads a body stops a huge one from using up the isolate's memory, including
// on the anonymous routes and Better Auth. Photo uploads have their own cap in routes/files.ts.
const jsonBodyLimit = bodyLimit({
  maxSize: 64 * 1024,
  // The default throws an HTTPException, which onError would turn into a 500.
  onError: (c) => c.json(errorBody('payload_too_large', 'Request body is too large'), 413),
});
app.use('*', (c, next) => (c.req.path === '/files' ? next() : jsonBodyLimit(c, next)));

app.onError(onError);
app.notFound((c) => c.json(errorBody('not_found', 'Not found'), 404));

app.get('/', (c) => c.json({ name: 'chatsoon-api', ok: true }));
app.get('/health', (c) => c.json({ ok: true }));
// Nothing on api.chatsoon.app is meant for search engines; the public pages live on chatsoon.app.
app.get('/robots.txt', (c) => c.text('User-agent: *\nDisallow: /\n', 200, { 'Cache-Control': 'public, max-age=86400' }));

app.on(['GET', 'POST'], '/auth/*', otpRateLimit, async (c) => (await createAuth(c.env, c.executionCtx)).handler(c.req.raw));

/**
 * Enabled social providers (issue #24, plus `linkProviders` for issue #11), in display order.
 * Outside `/auth/*` since that basePath belongs to Better Auth. `providers` is the sign-in screen's
 * button list, unchanged since issue #24. `linkProviders` is what the Connected accounts screen can
 * offer (docs/referrals.md "Account linking"): every provider in `SOCIAL_VALIDATION_PROVIDERS` that's
 * configured, which includes `twitter` (X) once its secrets are set even though X never appears in
 * `providers` - it can't sign anyone in (lib/social-providers.ts's twitterGetUserInfo never returns a
 * real email), only link. Cached briefly since it changes only when secrets are added or removed.
 */
app.get('/auth-providers', async (c) => {
  const configured = await buildSocialProviders(c.env);
  const body: AuthProvidersResponse = {
    providers: SOCIAL_PROVIDERS.filter((p) => p in configured),
    linkProviders: SOCIAL_VALIDATION_PROVIDERS.filter((p) => p in configured),
  };
  c.header('Cache-Control', 'public, max-age=300');
  return c.json(body);
});

app.route('/', publicRoutes);
app.route('/', profileRoutes);
app.route('/', accountRoutes);
app.route('/', connectionsRoutes);
app.route('/', contactsRoutes);
app.route('/', tagsRoutes);
app.route('/', eventsRoutes);
app.route('/', filesRoutes);
app.route('/', extractRoutes);
app.route('/', moderationRoutes);
app.route('/', pagesRoutes);
app.route('/', emailRoutes);
app.route('/', referralsRoutes);

/**
 * The wrangler.jsonc `triggers.crons` entry (every 10 minutes): finishes any account deletion
 * (issue #8) whose grace period has passed, sends any due tips-email (issue #7) step or nudge, runs
 * the referral qualification sweep (issue #11), and sweeps expired/converted referral invites.
 * Each job gets its own `waitUntil`/`catch` so a failure in one never affects the others; within each
 * job, the row-processing functions isolate failures row by row the same way.
 */
async function scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
  ctx.waitUntil(runDueDeletions(env, Date.now()).catch((err) => console.error('runDueDeletions failed', err)));
  ctx.waitUntil(runEmailSequences(env, Date.now()).catch((err) => console.error('runEmailSequences failed', err)));
  ctx.waitUntil(
    runReferralQualification(env, getDb(env), Date.now()).catch((err) => console.error('runReferralQualification failed', err)),
  );
  ctx.waitUntil(sweepReferralInvites(getDb(env), Date.now()).catch((err) => console.error('sweepReferralInvites failed', err)));
}

// Cloudflare calls `.fetch` and `.scheduled` on whatever this module exports as default; `app.fetch`
// is already bound to `app` (a Hono class-field arrow function), so pulling it out here doesn't
// change how requests are handled, or how existing tests that import `app`'s default export work.
export default { fetch: app.fetch, scheduled };
