import { type ExtractedCard, normalizeHandle } from '@chatsoon/shared';
import { z } from 'zod';

import type { Env } from '../env';

// Business card and badge extraction with Claude (Messages API over fetch, no SDK in the Worker).
// The reply is constrained to a JSON schema (structured outputs), then sanitised before it
// touches a contact.

const MESSAGES_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_MODEL = 'claude-haiku-4-5';

/** Formats Claude can read. HEIC is not one of them. */
const SUPPORTED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
/** Claude API limit per image, measured base64-encoded (about 7.5 MB of raw bytes). */
const MAX_BASE64_LENGTH = 10_000_000;
/** Claude API limit per image side. */
const MAX_DIMENSION = 8000;

const TIMEOUT_MS = 25_000;
const MAX_ATTEMPTS = 2;
const RETRY_DELAY_MS = 750;
/** Rate limited, server errors and overloaded (529). */
const RETRY_STATUSES = new Set([429, 500, 502, 503, 504, 529]);

/** Extraction could not run or produced nothing usable. `message` is safe to show the user. */
export class ExtractError extends Error {}

export const EXTRACT_FAILED_MESSAGE = "Couldn't read the card. Fill in the details yourself.";

const SYSTEM_PROMPT = `You transcribe contact details from a photo of a business card or a conference or event badge.

Rules:
- Report only text that is actually printed on the card or badge. Never guess, infer, complete or look anything up. Use null for any field that is not printed or that you cannot read clearly.
- name: the full name of the person the card or badge belongs to. Never a company, brand, event or job title. If it is printed in all capitals, write it in normal capitalisation ("PETER BUI" becomes "Peter Bui").
- company: the person's company or organisation.
- role: the person's job title or position. If it is printed in all capitals, write it in normal capitalisation. On badges, ticket or badge types such as Speaker, Attendee, Delegate, VIP, Press, Sponsor, Staff or Exhibitor are not a role.
- email: the person's email address, all lowercase. Prefer a personal address over a generic one such as info@ or hello@.
- phone: the person's phone number as printed, including the + country code when shown. Prefer mobile over office. Never a fax number.
- telegram: the Telegram username only, without "@" or "t.me/". A handle printed next to a Telegram logo counts.
- xHandle: the X (Twitter) username only, without "@" or "x.com/". A handle printed next to an X or Twitter logo counts.
- linkedinUrl: the LinkedIn profile as a full URL, for example https://www.linkedin.com/in/peterbui. Null when no LinkedIn profile is printed.
- website: the website printed on the card as a full URL starting with https://. Not a LinkedIn, X or Telegram link, and never derived from an email address.
- Ignore the event name, sponsor logos and QR codes.
- If the image is not a business card or badge, return null for every field.`;

const USER_PROMPT = 'Extract the contact details printed on this business card or badge.';

const CARD_FIELDS = [
  'name',
  'company',
  'role',
  'email',
  'phone',
  'telegram',
  'xHandle',
  'linkedinUrl',
  'website',
] as const satisfies readonly (keyof ExtractedCard)[];

const nullableString = { anyOf: [{ type: 'string' }, { type: 'null' }] };

const CARD_SCHEMA = {
  type: 'object',
  properties: Object.fromEntries(CARD_FIELDS.map((f) => [f, nullableString])),
  required: [...CARD_FIELDS],
  additionalProperties: false,
};

interface MessagesResponse {
  stop_reason?: string | null;
  content?: { type: string; text?: string }[];
  error?: { type?: string; message?: string };
}

/**
 * Reads a business card or badge photo with Claude and returns the sanitised fields.
 * Throws ExtractError when the key is missing, the image can't be sent, or the call fails.
 */
export async function extractCard(env: Env, bytes: ArrayBuffer, mediaType: string): Promise<ExtractedCard> {
  if (!env.ANTHROPIC_API_KEY) {
    throw new ExtractError("Card reading isn't available right now. Fill in the details yourself.");
  }
  const image = new Uint8Array(bytes);
  checkImage(image, mediaType);

  const res = await postMessages(env.ANTHROPIC_API_KEY, {
    model: env.EXTRACT_MODEL || DEFAULT_MODEL,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: toBase64(image) } },
          { type: 'text', text: USER_PROMPT },
        ],
      },
    ],
    output_config: { format: { type: 'json_schema', schema: CARD_SCHEMA } },
  });

  const data = (await res.json().catch(() => ({}))) as MessagesResponse;
  if (!res.ok) {
    console.error('Anthropic API error', res.status, data.error?.type, data.error?.message);
    throw new ExtractError(EXTRACT_FAILED_MESSAGE);
  }
  if (data.stop_reason === 'refusal' || data.stop_reason === 'max_tokens') {
    console.error('Card extraction stopped early', data.stop_reason);
    throw new ExtractError(EXTRACT_FAILED_MESSAGE);
  }
  const text = data.content?.find((b) => b.type === 'text')?.text;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text ?? '');
  } catch {
    console.error('Card extraction returned invalid JSON');
    throw new ExtractError(EXTRACT_FAILED_MESSAGE);
  }
  if (!parsed || typeof parsed !== 'object') throw new ExtractError(EXTRACT_FAILED_MESSAGE);
  return sanitizeCard(parsed as Record<string, unknown>);
}

/** Rejects images Claude would refuse, with a message the user can act on. */
function checkImage(image: Uint8Array, mediaType: string) {
  if (!SUPPORTED_TYPES.has(mediaType)) {
    throw new ExtractError("This photo format can't be read. Retake the photo, or fill in the details yourself.");
  }
  const tooLarge = "This photo is too large to read. Retake it at a lower resolution, or fill in the details yourself.";
  if (image.byteLength === 0) throw new ExtractError(EXTRACT_FAILED_MESSAGE);
  if (Math.ceil(image.byteLength / 3) * 4 > MAX_BASE64_LENGTH) throw new ExtractError(tooLarge);
  const size = imageSize(image, mediaType);
  if (size && (size.width > MAX_DIMENSION || size.height > MAX_DIMENSION)) throw new ExtractError(tooLarge);
}

async function postMessages(apiKey: string, body: unknown): Promise<Response> {
  const init = {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
    },
    body: JSON.stringify(body),
  };
  for (let attempt = 1; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(MESSAGES_URL, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (err) {
      console.error('Anthropic API unreachable', err);
      throw new ExtractError(EXTRACT_FAILED_MESSAGE);
    }
    if (attempt >= MAX_ATTEMPTS || !RETRY_STATUSES.has(res.status)) return res;
    await res.body?.cancel();
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
  }
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

const ascii = (b: Uint8Array, start: number, end: number) => String.fromCharCode(...b.subarray(start, end));

/** Pixel size read from the image header, or null when it can't be read. */
function imageSize(b: Uint8Array, mediaType: string): { width: number; height: number } | null {
  const at = (i: number) => b[i] ?? 0;
  const u16be = (i: number) => (at(i) << 8) | at(i + 1);
  const u16le = (i: number) => at(i) | (at(i + 1) << 8);
  const u24le = (i: number) => at(i) | (at(i + 1) << 8) | (at(i + 2) << 16);
  const u32be = (i: number) => at(i) * 2 ** 24 + ((at(i + 1) << 16) | (at(i + 2) << 8) | at(i + 3));

  switch (mediaType) {
    case 'image/png':
      return b.length >= 24 ? { width: u32be(16), height: u32be(20) } : null;
    case 'image/gif':
      return b.length >= 10 ? { width: u16le(6), height: u16le(8) } : null;
    case 'image/webp': {
      if (b.length < 30) return null;
      const chunk = ascii(b, 12, 16);
      if (chunk === 'VP8 ') return { width: u16le(26) & 0x3fff, height: u16le(28) & 0x3fff };
      if (chunk === 'VP8L') {
        const bits = at(21) | (at(22) << 8) | (at(23) << 16) | (at(24) << 24);
        return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
      }
      if (chunk === 'VP8X') return { width: u24le(24) + 1, height: u24le(27) + 1 };
      return null;
    }
    case 'image/jpeg': {
      // Walk the segments to the first start-of-frame marker.
      let i = 2;
      while (i + 9 <= b.length) {
        if (at(i) !== 0xff) return null;
        const marker = at(i + 1);
        if (marker === 0xff) {
          i += 1;
        } else if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
          i += 2;
        } else if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { width: u16be(i + 7), height: u16be(i + 5) };
        } else if (marker === 0xd9 || marker === 0xda) {
          return null;
        } else {
          i += 2 + u16be(i + 2);
        }
      }
      return null;
    }
    default:
      return null;
  }
}

// ---- Sanitising ----
// Lengths match contactFields in @chatsoon/shared so the result always fits a contact.

const isEmail = z.email();

function clean(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.replace(/\s+/g, ' ').trim();
  return s && s.toLowerCase() !== 'null' ? s : null;
}

const plainText = (v: unknown, max: number) => clean(v)?.slice(0, max).trim() || null;

function email(v: unknown): string | null {
  const s = clean(v)
    ?.replace(/^mailto:/i, '')
    .replace(/\s/g, '')
    .toLowerCase();
  return s && s.length <= 254 && isEmail.safeParse(s).success ? s : null;
}

function phone(v: unknown): string | null {
  // Drops a printed label such as "M:", "Mobile:" or "Tel.:" (also covers tel: URIs).
  const s = clean(v)
    ?.replace(/^[a-z][a-z .]{0,11}:\s*/i, '')
    .trim();
  if (!s || s.length > 40 || !/^\+?[\d\s().\-/]+((ext\.?|x)\s*\d+)?$/i.test(s)) return null;
  const digits = s.replace(/\D/g, '').length;
  return digits >= 5 && digits <= 20 ? s : null;
}

/** Telegram and X usernames: letters, digits and underscores only. */
function handle(v: unknown, max: number): string | null {
  const s = clean(v);
  if (!s) return null;
  const h = normalizeHandle(s).replace(/^@/, '');
  return /^\w+$/.test(h) && h.length <= max ? h : null;
}

function parseUrl(s: string): URL | null {
  try {
    const url = new URL(s);
    const plain = (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password;
    return plain && url.hostname.includes('.') ? url : null;
  } catch {
    return null;
  }
}

function linkedinUrl(v: unknown): string | null {
  const raw = clean(v);
  if (!raw) return null;
  let s = raw.replace(/\s/g, '');
  if (!/^https?:\/\//i.test(s)) {
    if (/^([\w-]+\.)?linkedin\.com\//i.test(s)) s = `https://${s}`;
    // A bare profile id such as "peterbui". Never a printed name like "Peter Bui".
    else if (/^@?[\w-]{3,100}$/.test(raw)) s = `https://www.linkedin.com/in/${raw.replace(/^@/, '')}`;
    else return null;
  }
  const url = parseUrl(s);
  // A bare linkedin.com link points at no one.
  if (!url || !/(^|\.)linkedin\.com$/i.test(url.hostname) || url.pathname.replace(/\/+$/, '') === '') return null;
  s = `https://${url.host}${url.pathname}${url.search}`;
  return s.length <= 300 ? s : null;
}

function website(v: unknown): string | null {
  let s = clean(v)?.replace(/\s/g, '');
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  const url = parseUrl(s);
  if (!url) return null;
  s = `https://${url.host}${url.pathname === '/' ? '' : url.pathname}${url.search}${url.hash}`;
  return s.length <= 300 ? s : null;
}

/** Trims, validates and caps every field. Anything unusable becomes null. */
function sanitizeCard(raw: Record<string, unknown>): ExtractedCard {
  return {
    name: plainText(raw.name, 120),
    company: plainText(raw.company, 120),
    role: plainText(raw.role, 120),
    email: email(raw.email),
    phone: phone(raw.phone),
    telegram: handle(raw.telegram, 32),
    xHandle: handle(raw.xHandle, 15),
    linkedinUrl: linkedinUrl(raw.linkedinUrl),
    website: website(raw.website),
  };
}
