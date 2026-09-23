import { ALLOWED_UPLOAD_TYPES, MAX_UPLOAD_BYTES, type UploadPurpose, type UploadResponse } from '@chatsoon/shared';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import { contacts } from '../db/schema';
import type { AppEnv } from '../env';
import { getDb } from '../lib/db';
import { ApiError, badRequest, forbidden, limit, notFound, parseJson, userKey } from '../lib/errors';
import { requireAuth } from '../lib/middleware';
import { fileKey, isCardKey, signedFileUrl, verifyFileSignature } from '../lib/signing';

// POST /files uploads a photo to private R2. GET /files/* serves it back behind an HMAC signature.
// DELETE /files/card removes a card photo that no contact uses (a queued card the app discarded).

type ImageType = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/heic';

const PURPOSES: readonly UploadPurpose[] = ['avatar', 'card'];
const EXTENSIONS: Record<ImageType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
};
/**
 * Largest photo stored. The app re-encodes every photo to a JPEG of at most 1600 px before uploading
 * (well under 1 MB), so this only bounds what one account can put in storage.
 */
export const MAX_PHOTO_BYTES = Math.min(MAX_UPLOAD_BYTES, 3 * 1024 * 1024);
/** Room for multipart boundaries and part headers on top of the file itself. */
const MULTIPART_OVERHEAD = 64 * 1024;
/** Clients may cache a signed file for up to a day, and never past its expiry. */
const MAX_CACHE_SECONDS = 86400;

/** HEIF brands used for HEIC photos (iPhone camera and others). */
const HEIC_BRANDS = new Set(['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'hevm', 'hevs']);
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const tooLarge = () =>
  new ApiError(413, 'payload_too_large', `Photos can be up to ${Math.round(MAX_PHOTO_BYTES / 1024 / 1024)} MB`);

export const filesRoutes = new Hono<AppEnv>();

filesRoutes.post('/files', requireAuth, async (c) => {
  const purpose = c.req.query('purpose') as UploadPurpose;
  if (!PURPOSES.includes(purpose)) throw badRequest('purpose must be avatar or card');
  await limit(c.env.UPLOAD_LIMITER, `upload:${c.var.user.id}`);

  const bytes = await readUpload(c.req.raw);
  // Trust the bytes, not the client's content type.
  const type = sniffImageType(bytes);
  if (!type || !(ALLOWED_UPLOAD_TYPES as readonly string[]).includes(type)) {
    throw badRequest('Upload a JPEG, PNG, WebP or HEIC photo');
  }

  const userId = c.var.user.id;
  const key = fileKey(userId, purpose, EXTENSIONS[type]);
  await c.env.FILES.put(key, bytes, {
    httpMetadata: { contentType: type },
    customMetadata: { userId, purpose },
  });
  const body: UploadResponse = { key, url: await signedFileUrl(c.env, key) };
  return c.json(body, 201);
});

const cardKeySchema = z.object({ key: z.string().trim().min(1).max(300) });

/**
 * Deletes a card photo the app uploaded but never attached to a contact: the user discarded a
 * queued card after its upload. Takes the key from `?key=` or a JSON body `{ key }`. Only keys
 * under my own card prefix, and only when none of my contacts uses it. 204 when it's already gone.
 */
filesRoutes.delete('/files/card', requireAuth, async (c) => {
  const userId = c.var.user.id;
  await limit(c.env.WRITE_LIMITER, userKey(c, 'card-delete', userId));
  const fromQuery = c.req.query('key');
  const { key } = fromQuery !== undefined ? cardKeySchema.parse({ key: fromQuery }) : await parseJson(c, cardKeySchema);
  if (!isCardKey(userId, key)) throw badRequest('Invalid card image');

  const [used] = await getDb(c.env)
    .select({ id: contacts.id })
    .from(contacts)
    .where(and(eq(contacts.userId, userId), eq(contacts.cardImageKey, key)))
    .limit(1);
  if (!used) await c.env.FILES.delete(key);
  return c.body(null, 204);
});

// No auth: the signature is the permission. Keys and expiries are covered by the HMAC.
filesRoutes.get('/files/*', async (c) => {
  const encoded = new URL(c.req.url).pathname.slice('/files/'.length);
  const invalid = () => forbidden('This link is invalid or has expired');
  let key: string;
  try {
    key = encoded.split('/').map(decodeURIComponent).join('/');
  } catch {
    throw invalid();
  }
  const exp = c.req.query('exp');
  const sig = c.req.query('sig');
  if (!key || !exp || !sig || !(await verifyFileSignature(c.env, key, exp, sig))) throw invalid();

  // A cached copy that still matches comes back without a body: answer 304.
  const ifNoneMatch = c.req.header('if-none-match');
  const object = await c.env.FILES.get(key, {
    onlyIf: new Headers(ifNoneMatch ? { 'if-none-match': ifNoneMatch } : {}),
  });
  if (!object) throw notFound('File not found');

  const maxAge = Math.max(0, Math.min(Math.floor(Number(exp) - Date.now() / 1000), MAX_CACHE_SECONDS));
  const headers = {
    ETag: object.httpEtag,
    'Cache-Control': `private, max-age=${maxAge}`,
    'X-Content-Type-Options': 'nosniff',
    // User-uploaded bytes: never let them run as a page, even when opened directly.
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
  };
  if (!('body' in object)) return new Response(null, { status: 304, headers });
  return new Response(object.body, {
    headers: { ...headers, 'Content-Type': object.httpMetadata?.contentType ?? 'application/octet-stream' },
  });
});

/** The uploaded bytes, from multipart field "file" or a raw image/* body. */
async function readUpload(req: Request): Promise<Uint8Array> {
  const contentType = req.headers.get('content-type') ?? '';
  const kind = contentType.toLowerCase();

  if (kind.startsWith('multipart/form-data')) {
    const body = await readCapped(req, MAX_PHOTO_BYTES + MULTIPART_OVERHEAD);
    let form: FormData;
    try {
      // The boundary is case sensitive, so pass the header through untouched.
      form = await new Response(body, { headers: { 'content-type': contentType } }).formData();
    } catch {
      throw badRequest('Could not read the upload');
    }
    const file = form.get('file');
    if (!file || typeof file === 'string') throw badRequest('Attach the photo as the "file" field');
    if (file.size > MAX_PHOTO_BYTES) throw tooLarge();
    return new Uint8Array(await file.arrayBuffer());
  }

  if (kind.startsWith('image/')) return readCapped(req, MAX_PHOTO_BYTES);

  throw badRequest('Send the photo as multipart/form-data');
}

/** Reads the whole body, failing with 413 as soon as it passes `max` bytes. */
async function readCapped(req: Request, max: number): Promise<Uint8Array> {
  if (Number(req.headers.get('content-length') ?? 0) > max) throw tooLarge();
  if (!req.body) return new Uint8Array(0);

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = value as Uint8Array;
    size += chunk.byteLength;
    if (size > max) {
      await reader.cancel();
      throw tooLarge();
    }
    chunks.push(chunk);
  }

  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

const ascii = (b: Uint8Array, start: number, end: number) => String.fromCharCode(...b.subarray(start, end));

/** Detects the image type from its magic bytes. Null for anything else. */
function sniffImageType(b: Uint8Array): ImageType | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 8 && PNG_SIGNATURE.every((v, i) => b[i] === v)) return 'image/png';
  if (b.length >= 12 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP') return 'image/webp';

  // ISO base media file: [size]['ftyp'][major brand][minor version][compatible brands...]
  if (b.length >= 12 && ascii(b, 4, 8) === 'ftyp') {
    const boxSize = (((b[0] ?? 0) << 24) >>> 0) + ((b[1] ?? 0) << 16) + ((b[2] ?? 0) << 8) + (b[3] ?? 0);
    const end = Math.min(boxSize >= 16 ? boxSize : 16, b.length, 256);
    const major = ascii(b, 8, 12);
    const compatible: string[] = [];
    for (let i = 16; i + 4 <= end; i += 4) compatible.push(ascii(b, i, i + 4));
    // mif1/msf1 are generic HEIF brands (AVIF uses them too), so require a HEIC brand alongside.
    if (HEIC_BRANDS.has(major)) return 'image/heic';
    if ((major === 'mif1' || major === 'msf1') && compatible.some((brand) => HEIC_BRANDS.has(brand))) {
      return 'image/heic';
    }
  }
  return null;
}
