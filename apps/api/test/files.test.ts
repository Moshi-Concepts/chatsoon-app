import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';

import { signedFileUrl } from '../src/lib/signing';
import { MAX_PHOTO_BYTES } from '../src/routes/files';
import { call, signIn } from './helpers';

// Minimal JPEG: SOI, APP0 (JFIF), SOF0 (200x100), EOI.
const JPEG = new Uint8Array([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00,
  0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x64, 0x00, 0xc8, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11,
  0x01, 0xff, 0xd9,
]);
const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00,
  0x10, 0x00, 0x00, 0x00, 0x10, 0x08, 0x02, 0x00, 0x00, 0x00,
]);
const ascii = (s: string) => [...s].map((ch) => ch.charCodeAt(0));
const WEBP = new Uint8Array([...ascii('RIFF'), 0x24, 0, 0, 0, ...ascii('WEBPVP8 '), 0, 0, 0, 0]);
const HEIC = new Uint8Array([0, 0, 0, 0x18, ...ascii('ftypheic'), 0, 0, 0, 0, ...ascii('mif1heic')]);
const AVIF = new Uint8Array([0, 0, 0, 0x18, ...ascii('ftypavif'), 0, 0, 0, 0, ...ascii('mif1miaf')]);

type Upload = { key: string; url: string };
type ErrorBody = { error: { code: string; message: string } };

function uploadForm(token: string, bytes: Uint8Array, type = 'image/jpeg', purpose = 'card') {
  const form = new FormData();
  form.append('file', new Blob([bytes], { type }), 'photo.jpg');
  return call(`/files?purpose=${purpose}`, { method: 'POST', token, body: form });
}

function uploadRaw(token: string, bytes: Uint8Array, type = 'image/jpeg', purpose = 'card') {
  return call(`/files?purpose=${purpose}`, { method: 'POST', token, body: bytes, headers: { 'Content-Type': type } });
}

/** Path and query of a signed URL, for call(). */
const pathOf = (url: string) => {
  const u = new URL(url);
  return u.pathname + u.search;
};

async function hmacHex(data: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(env.FILE_SIGNING_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, '0')).join('');
}

async function countObjects(prefix: string) {
  return (await env.FILES.list({ prefix })).objects.length;
}

let alice: { token: string; userId: string };
let bob: { token: string; userId: string };

beforeAll(async () => {
  alice = await signIn('files-alice@example.com');
  bob = await signIn('files-bob@example.com');
});

describe('POST /files', () => {
  it('requires a session', async () => {
    const form = new FormData();
    form.append('file', new Blob([JPEG], { type: 'image/jpeg' }), 'photo.jpg');
    const res = await call('/files?purpose=card', { method: 'POST', body: form });
    expect(res.status).toBe(401);
  });

  it('rejects an unknown purpose', async () => {
    const res = await uploadForm(alice.token, JPEG, 'image/jpeg', 'banner');
    expect(res.status).toBe(400);
    expect(((await res.json()) as ErrorBody).error.code).toBe('bad_request');
  });

  it('stores a JPEG under the caller and returns a signed URL', async () => {
    const res = await uploadForm(alice.token, JPEG);
    expect(res.status).toBe(201);
    const body = (await res.json()) as Upload;
    expect(body.key).toMatch(new RegExp(`^u/${alice.userId}/card/[0-9a-f-]{36}\\.jpg$`));
    expect(body.url).toContain(`${env.API_ORIGIN}/files/`);
    expect(body.url).toMatch(/[?&]exp=\d+&sig=[0-9a-f]{64}$/);

    const object = await env.FILES.head(body.key);
    expect(object?.httpMetadata?.contentType).toBe('image/jpeg');
    expect(object?.customMetadata).toEqual({ userId: alice.userId, purpose: 'card' });
  });

  it('accepts a raw image body and trusts the bytes over the declared type', async () => {
    const res = await uploadRaw(alice.token, PNG, 'image/jpeg', 'avatar');
    expect(res.status).toBe(201);
    const { key } = (await res.json()) as Upload;
    expect(key).toMatch(new RegExp(`^u/${alice.userId}/avatar/.+\\.png$`));
    expect((await env.FILES.head(key))?.httpMetadata?.contentType).toBe('image/png');
  });

  it('detects WebP and HEIC from their magic bytes', async () => {
    const webp = (await (await uploadForm(alice.token, WEBP, 'application/octet-stream')).json()) as Upload;
    expect(webp.key).toMatch(/\.webp$/);
    expect((await env.FILES.head(webp.key))?.httpMetadata?.contentType).toBe('image/webp');

    const heic = (await (await uploadForm(alice.token, HEIC, 'image/heic')).json()) as Upload;
    expect(heic.key).toMatch(/\.heic$/);
    expect((await env.FILES.head(heic.key))?.httpMetadata?.contentType).toBe('image/heic');
  });

  it('rejects a text file disguised as image/jpeg and stores nothing', async () => {
    const before = await countObjects(`u/${bob.userId}/`);
    const text = new TextEncoder().encode('hello, this is not a photo');
    const res = await uploadForm(bob.token, text, 'image/jpeg');
    expect(res.status).toBe(400);
    expect(((await res.json()) as ErrorBody).error.code).toBe('bad_request');

    const raw = await uploadRaw(bob.token, text, 'image/jpeg');
    expect(raw.status).toBe(400);
    expect(await countObjects(`u/${bob.userId}/`)).toBe(before);
  });

  it('rejects other image formats such as AVIF', async () => {
    const res = await uploadForm(bob.token, AVIF, 'image/avif');
    expect(res.status).toBe(400);
  });

  it('rejects a form without a file field, an empty file and a non-image body', async () => {
    const form = new FormData();
    form.append('photo', new Blob([JPEG], { type: 'image/jpeg' }), 'photo.jpg');
    expect((await call('/files?purpose=card', { method: 'POST', token: bob.token, body: form })).status).toBe(400);

    expect((await uploadForm(bob.token, new Uint8Array(0))).status).toBe(400);

    const json = await call('/files?purpose=card', { method: 'POST', token: bob.token, json: { file: 'x' } });
    expect(json.status).toBe(400);
  });

  it('accepts a file of exactly the size limit', async () => {
    const bytes = new Uint8Array(MAX_PHOTO_BYTES);
    bytes.set(JPEG);
    const res = await uploadForm(bob.token, bytes);
    expect(res.status).toBe(201);
    const { key } = (await res.json()) as Upload;
    expect((await env.FILES.head(key))?.size).toBe(MAX_PHOTO_BYTES);
  });

  it('rejects oversize uploads with 413', async () => {
    const bytes = new Uint8Array(MAX_PHOTO_BYTES + 1);
    bytes.set(JPEG);
    const before = await countObjects(`u/${bob.userId}/`);

    const multipart = await uploadForm(bob.token, bytes);
    expect(multipart.status).toBe(413);
    expect(((await multipart.json()) as ErrorBody).error.code).toBe('payload_too_large');

    const raw = await uploadRaw(bob.token, bytes);
    expect(raw.status).toBe(413);
    expect(((await raw.json()) as ErrorBody).error.code).toBe('payload_too_large');

    expect(await countObjects(`u/${bob.userId}/`)).toBe(before);
  });
});

describe('GET /files/*', () => {
  let upload: Upload;

  beforeAll(async () => {
    upload = (await (await uploadForm(alice.token, JPEG)).json()) as Upload;
  });

  it('serves the bytes for a valid signature without a session', async () => {
    const res = await call(pathOf(upload.url));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/jpeg');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('Content-Security-Policy')).toContain('sandbox');
    expect(res.headers.get('ETag')).toBeTruthy();

    const cache = res.headers.get('Cache-Control') ?? '';
    const maxAge = Number(cache.match(/^private, max-age=(\d+)$/)?.[1]);
    const exp = Number(new URL(upload.url).searchParams.get('exp'));
    expect(maxAge).toBeGreaterThan(0);
    expect(maxAge).toBeLessThanOrEqual(exp - Math.floor(Date.now() / 1000));

    expect(new Uint8Array(await res.arrayBuffer())).toEqual(JPEG);
  });

  it('caps Cache-Control at one day for long-lived links', async () => {
    const url = await signedFileUrl(env, upload.key, 7 * 24 * 3600);
    const res = await call(pathOf(url));
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('private, max-age=86400');
    await res.body?.cancel();
  });

  it('answers 304 to a revalidation with a matching ETag', async () => {
    const first = await call(pathOf(upload.url));
    const etag = first.headers.get('ETag') ?? '';
    await first.body?.cancel();

    const cached = await call(pathOf(upload.url), { headers: { 'If-None-Match': etag } });
    expect(cached.status).toBe(304);
    expect(cached.headers.get('ETag')).toBe(etag);
    expect(cached.headers.get('Cache-Control')).toMatch(/^private, max-age=\d+$/);
    expect(await cached.text()).toBe('');

    const stale = await call(pathOf(upload.url), { headers: { 'If-None-Match': '"something-else"' } });
    expect(stale.status).toBe(200);
    expect(new Uint8Array(await stale.arrayBuffer())).toEqual(JPEG);

    // Revalidation never skips the signature check.
    const unsigned = await call(`/files/${upload.key}`, { headers: { 'If-None-Match': etag } });
    expect(unsigned.status).toBe(403);
  });

  it('rejects a path that is not valid percent-encoding with 403', async () => {
    const { search } = new URL(upload.url);
    const res = await call(`/files/u/%E0%A4%A/card/x.jpg${search}`);
    expect(res.status).toBe(403);
  });

  it('rejects a tampered signature with 403', async () => {
    const url = new URL(upload.url);
    const sig = url.searchParams.get('sig') ?? '';
    url.searchParams.set('sig', (sig[0] === 'a' ? 'b' : 'a') + sig.slice(1));
    const res = await call(url.pathname + url.search);
    expect(res.status).toBe(403);
    expect(((await res.json()) as ErrorBody).error.code).toBe('forbidden');
  });

  it('rejects an expired link with 403, even with a correct HMAC', async () => {
    const exp = Math.floor(Date.now() / 1000) - 60;
    const sig = await hmacHex(`${upload.key}:${exp}`);
    const res = await call(`/files/${upload.key}?exp=${exp}&sig=${sig}`);
    expect(res.status).toBe(403);
  });

  it('rejects a moved expiry, a missing signature, and a signature for another key', async () => {
    const url = new URL(upload.url);
    const exp = Number(url.searchParams.get('exp'));
    url.searchParams.set('exp', String(exp + 3600));
    expect((await call(url.pathname + url.search)).status).toBe(403);

    expect((await call(`/files/${upload.key}`)).status).toBe(403);

    const other = (await (await uploadForm(bob.token, JPEG)).json()) as Upload;
    const otherQuery = new URL(other.url).search;
    expect((await call(`/files/${upload.key}${otherQuery}`)).status).toBe(403);
  });

  it('returns 404 for a correctly signed key that does not exist', async () => {
    const url = await signedFileUrl(env, `u/${alice.userId}/card/00000000-0000-0000-0000-000000000000.jpg`);
    const res = await call(pathOf(url));
    expect(res.status).toBe(404);
    expect(((await res.json()) as ErrorBody).error.code).toBe('not_found');
  });
});
