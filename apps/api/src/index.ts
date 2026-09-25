import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';

import type { AppEnv } from './env';
import { allowedOrigins, createAuth, otpRateLimit } from './lib/auth';
import { errorBody, onError } from './lib/errors';
import { accountRoutes } from './routes/account';
import { connectionsRoutes } from './routes/connections';
import { contactsRoutes } from './routes/contacts';
import { eventsRoutes } from './routes/events';
import { extractRoutes } from './routes/extract';
import { filesRoutes } from './routes/files';
import { moderationRoutes } from './routes/moderation';
import { pagesRoutes } from './routes/pages';
import { profileRoutes } from './routes/profile';
import { publicRoutes } from './routes/public';
import { tagsRoutes } from './routes/tags';

// Route table (MVP). Each module owns its paths:
//   /auth/*                                   Better Auth (email OTP), lib/auth.ts
//   GET  /id/:slug  GET /id/:slug/vcard  POST /id/:slug/connect      routes/public.ts
//   GET  /me  PUT /me/profile                                         routes/profile.ts
//   DELETE /me  GET /me/export.csv                                    routes/account.ts
//   POST /connections/scan                                            routes/connections.ts
//   GET/POST /contacts  GET/PUT/DELETE /contacts/:id                  routes/contacts.ts
//   GET/POST /tags  DELETE /tags/:id                                  routes/tags.ts
//   GET/POST /events                                                  routes/events.ts
//   POST /files  GET /files/*  DELETE /files/card                     routes/files.ts
//   POST /extract/card                                                routes/extract.ts
//   POST /reports  POST /blocks  DELETE /blocks/:userId               routes/moderation.ts
//   GET /_pages/profile/:slug  GET /_pages/og/:slug (secret-gated)     routes/pages.ts

const app = new Hono<AppEnv>();

app.use('*', async (c, next) => {
  const origins = allowedOrigins(c.env);
  return cors({
    origin: (origin) => (origins.includes(origin) ? origin : null),
    allowHeaders: ['Content-Type', 'Authorization'],
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
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

app.on(['GET', 'POST'], '/auth/*', otpRateLimit, (c) => createAuth(c.env, c.executionCtx).handler(c.req.raw));

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

export default app;
