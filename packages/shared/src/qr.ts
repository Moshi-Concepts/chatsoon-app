import { cleanText, isEmail, parseSocialUrl, profileSlugFromUrl, toLinkUrl } from './links';
import type { ExtractedCard } from './types';
import { parseMeCard, parseVCard } from './vcard';

/** Fields a QR code can prefill on the add-contact form. */
export type ContactDraft = Partial<ExtractedCard> & { notes?: string | null };

export type QrContactSource = 'vcard' | 'mecard' | 'telegram' | 'linkedin' | 'x' | 'url' | 'email' | 'phone';

export type QrParseResult =
  /** A Chatsoon profile QR (https://chatsoon.app/id/<slug> or chatsoon://id/<slug>). */
  | { kind: 'chatsoon'; slug: string }
  | { kind: 'contact'; source: QrContactSource; draft: ContactDraft }
  | { kind: 'unknown'; raw: string };

/** Max lengths, matching contactCreateSchema. */
const DRAFT_LIMITS: Record<keyof ContactDraft, number> = {
  name: 120,
  company: 120,
  role: 120,
  email: 254,
  phone: 40,
  telegram: 100,
  xHandle: 100,
  linkedinUrl: 300,
  website: 300,
  notes: 5000,
};
const DRAFT_FIELDS = Object.keys(DRAFT_LIMITS) as (keyof ContactDraft)[];

/** Cuts to `max` UTF-16 units without leaving half a surrogate pair. */
function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  const code = value.charCodeAt(max - 1);
  return cleanText(value.slice(0, code >= 0xd800 && code <= 0xdbff ? max - 1 : max));
}

/**
 * Keeps the known draft fields that are non-empty strings, trimmed and cut to the contact schema's limits.
 * Website and LinkedIn values must be safe http(s) links (too long or unsafe ones are dropped).
 * Safe for untrusted input such as a `?draft=` route param.
 */
export function sanitizeDraft(value: unknown): ContactDraft {
  if (!value || typeof value !== 'object') return {};
  const input = value as Record<string, unknown>;
  const draft: ContactDraft = {};
  for (const field of DRAFT_FIELDS) {
    const raw = Object.prototype.hasOwnProperty.call(input, field) ? input[field] : undefined;
    if (typeof raw !== 'string') continue;
    let v = field === 'notes' ? cleanText(raw.replace(/\r\n?/g, '\n')) : cleanText(raw.replace(/\s+/g, ' '));
    if (field === 'website' || field === 'linkedinUrl') {
      const url = toLinkUrl(field === 'website' ? 'website' : 'linkedin', v);
      if (!url || url.length > DRAFT_LIMITS[field]) continue;
      v = url;
    }
    if (v) draft[field] = truncate(v, DRAFT_LIMITS[field]);
  }
  return draft;
}

function decode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** First valid address in 'mailto:a@x.com,b@x.com?subject=Hi' or 'mailto:?to=a@x.com'. */
function mailtoAddress(uri: string): string | null {
  const body = uri.replace(/^mailto:/i, '');
  const q = body.indexOf('?');
  const path = q === -1 ? body : body.slice(0, q);
  const to = q === -1 ? '' : (/(?:^|&)to=([^&]*)/i.exec(body.slice(q + 1))?.[1] ?? '');
  const candidates = [...decode(path).split(/[,;]/), ...decode(to).split(/[,;]/)];
  return candidates.map((c) => cleanText(c)).find((c) => isEmail(c)) ?? null;
}

/** 'MATMSG:TO:peter@example.com;SUB:Hello;BODY:Hi;;' (the DoCoMo email QR format). */
function matmsgAddress(text: string): string | null {
  const to = /(?:^MATMSG:|;)TO:((?:\\.|[^;])*)/i.exec(text)?.[1];
  const email = to ? cleanText(to.replace(/\\(.)/g, '$1')) : '';
  return isEmail(email) ? email : null;
}

/** Number in 'tel:+61412345678', 'sms:+614...?body=Hi', 'sms:+614...,+615...' or 'SMSTO:+614...:Hi'. */
function phoneFromUri(uri: string): string | null {
  const match = /^(tel|sms|smsto|mms|mmsto):([\s\S]*)$/i.exec(uri);
  if (!match?.[1]) return null;
  let number = match[2] ?? '';
  if (/to$/i.test(match[1])) number = number.split(':')[0] ?? '';
  // The first recipient, without URI params, a message body or dial pauses.
  number = cleanText(decode(number.split(/[?;,]/)[0] ?? ''));
  return toLinkUrl('phone', number) ? number : null;
}

export function parseQr(raw: string): QrParseResult {
  const unknown: QrParseResult = { kind: 'unknown', raw };
  const text = cleanText(raw);
  if (!text) return unknown;

  const contact = (source: QrContactSource, draft: ContactDraft): QrParseResult => {
    const clean = sanitizeDraft(draft);
    return Object.keys(clean).length > 0 ? { kind: 'contact', source, draft: clean } : unknown;
  };

  const slug = profileSlugFromUrl(text);
  if (slug) return { kind: 'chatsoon', slug };

  if (/^BEGIN:VCARD/i.test(text)) return contact('vcard', parseVCard(text));
  if (/^(?:MECARD|BIZCARD):/i.test(text)) return contact('mecard', parseMeCard(text));

  if (/^MATMSG:/i.test(text)) {
    const email = matmsgAddress(text);
    return email ? contact('email', { email }) : unknown;
  }
  if (/^mailto:/i.test(text)) {
    const email = mailtoAddress(text);
    return email ? contact('email', { email }) : unknown;
  }
  if (/^(?:tel|sms|smsto|mms|mmsto):/i.test(text)) {
    const phone = phoneFromUri(text);
    return phone ? contact('phone', { phone }) : unknown;
  }

  const social = parseSocialUrl(text);
  if (social?.network === 'telegram') return contact('telegram', { telegram: social.handle });
  if (social?.network === 'x') return contact('x', { xHandle: social.handle });
  if (social?.network === 'linkedin') return contact('linkedin', { linkedinUrl: social.url });

  if (isEmail(text)) return contact('email', { email: text });

  if (/^(?:https?:\/\/|www\.)/i.test(text)) {
    const website = toLinkUrl('website', text);
    return website ? contact('url', { website }) : unknown;
  }

  return unknown;
}
