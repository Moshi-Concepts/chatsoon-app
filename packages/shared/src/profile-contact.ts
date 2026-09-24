import { cleanText } from './links';
import type { ProfileContact, ProfileContactKey } from './types';

// Phone, WhatsApp and Signal on profiles (issue #3). Telegram stays in links.ts: it's always public,
// with different visibility rules, so it doesn't belong in this registry.
//
// Pure string code shared by the Worker and the app (Hermes and react-native-web): no URL,
// TextEncoder or other host APIs. Local queryParam/safeDecode instead of importing links.ts's,
// so this module stays self-contained.

/** Contact keys in display order. */
export const CONTACT_KEYS: readonly ProfileContactKey[] = ['phone', 'whatsapp', 'signal'];

export const CONTACT_LABELS: Record<ProfileContactKey, string> = {
  phone: 'Mobile',
  whatsapp: 'WhatsApp',
  signal: 'Signal',
};

/** Field length caps. Phone is 40 to match contacts.phone (CONTACT_FIELD_MAX in apps/api/src/lib/profiles.ts). */
export const CONTACT_MAX: Record<ProfileContactKey, number> = {
  phone: 40,
  whatsapp: 200,
  signal: 300,
};

export const CONTACT_HINTS: Record<ProfileContactKey, string> = {
  phone: 'Include your country code, like +61 491 570 156.',
  whatsapp: 'Enter your WhatsApp number with your country code, like +61 491 570 156, or paste your wa.me link.',
  signal: 'Enter your Signal number with your country code, or paste your Signal username link (signal.me/#eu/…).',
};

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Value of one query parameter in a raw query string ('?a=1&b=2'). Names are case-insensitive. No '+'-as-space:
 * these values are phone numbers, not form text, and a literal '+' must survive. */
function queryParam(query: string, name: string): string | null {
  for (const pair of query.replace(/^[?#]/, '').split('&')) {
    const eq = pair.indexOf('=');
    const key = eq === -1 ? pair : pair.slice(0, eq);
    if (key.toLowerCase() === name) return safeDecode(eq === -1 ? '' : pair.slice(eq + 1));
  }
  return null;
}

const INTL_PHONE = /^\+[1-9]\d{6,14}$/;

/**
 * Parses an international phone number to E.164 ('+61491570156'), or null. International dialling
 * prefixes ('00', '011', ...) differ by country, so they can't be mapped to '+' safely: a leading '+'
 * is required. No extensions: the number shown is the number dialled.
 */
export function parseIntlPhone(value: string): string | null {
  if (!value) return null;
  let v = cleanText(value).normalize('NFKC');
  if (!v || v.length > 64) return null;
  v = v.replace(/^tel:/i, '').replace(/\(0\)/g, '');
  v = v.replace(/[\s().\- ​-‍⁠﻿]/g, '');
  return INTL_PHONE.test(v) ? v : null;
}

// ---- WhatsApp ----

const WA_ME_DIGITS = /^(?:https?:\/\/)?(?:www\.)?wa\.me\/(\+)?(\d+)\/?(?:\?\S*)?$/i;
const WA_ME_CODE = /^(?:https?:\/\/)?(?:www\.)?wa\.me\/(message|qr)\/([A-Za-z0-9]{4,64})$/i;
const WHATSAPP_SEND = /^(?:https:\/\/(?:api|web|www)\.whatsapp\.com\/send\/?|whatsapp:\/\/send\/?)(\?\S*)?$/i;

function whatsappUrl(value: string): string | null {
  const number = parseIntlPhone(value);
  if (number) return `https://wa.me/${number.slice(1)}`;

  const digits = WA_ME_DIGITS.exec(value);
  if (digits) {
    const e164 = parseIntlPhone(`+${digits[2] ?? ''}`);
    return e164 ? `https://wa.me/${e164.slice(1)}` : null;
  }

  const code = WA_ME_CODE.exec(value);
  if (code) return `https://wa.me/${(code[1] ?? '').toLowerCase()}/${code[2] ?? ''}`;

  const send = WHATSAPP_SEND.exec(value);
  if (send) {
    const phone = send[1] ? queryParam(send[1], 'phone') : null;
    const e164 = phone ? parseIntlPhone(phone) : null;
    return e164 ? `https://wa.me/${e164.slice(1)}` : null;
  }

  return null;
}

// ---- Signal ----

const SIGNAL_P = /^(?:https?:\/\/)?signal\.me\/#p\/(\S+)$/i;
const SIGNAL_EU = /^(?:https?:\/\/)?signal\.me\/#eu\/([A-Za-z0-9_-]{20,300})$/i;

function signalUrl(value: string): string | null {
  const number = parseIntlPhone(value);
  if (number) return `https://signal.me/#p/${number}`;

  // sgnl:// is Signal's own app scheme for the same links; rewrite it to https and apply the same rules.
  const v = value.replace(/^sgnl:\/\//i, 'https://');

  const p = SIGNAL_P.exec(v);
  if (p) {
    const e164 = parseIntlPhone(safeDecode(p[1] ?? ''));
    return e164 ? `https://signal.me/#p/${e164}` : null;
  }

  const eu = SIGNAL_EU.exec(v);
  if (eu) return `https://signal.me/#eu/${eu[1]}`;

  return null;
}

/**
 * Normalises a stored contact value into a tappable URL, or null. Always https (wa.me / signal.me),
 * never whatsapp:// or sgnl://, so no app query scheme is needed and a profile can't pre-fill a
 * phishing message. Hosts are matched exactly, never by suffix, case-insensitively.
 */
export function contactUrl(key: ProfileContactKey, value: string | null | undefined): string | null {
  if (!value) return null;
  const v = cleanText(value);
  if (!v) return null;
  switch (key) {
    case 'phone': {
      const e164 = parseIntlPhone(v);
      return e164 ? `tel:${e164}` : null;
    }
    case 'whatsapp':
      return whatsappUrl(v);
    case 'signal':
      return signalUrl(v);
    default:
      return null;
  }
}

/**
 * Short text for a contact value: null when `contactUrl` is null. Phone is shown as typed. WhatsApp and
 * Signal show a typed number as typed, a pasted number link as '+<digits>', and a link that carries no
 * number ('wa.me/message', 'wa.me/qr', a Signal username link) as a short description.
 */
export function displayContact(key: ProfileContactKey, value: string | null | undefined): string | null {
  const url = contactUrl(key, value);
  if (!url || !value) return null;
  const v = cleanText(value);

  if (key === 'phone') return v.replace(/^tel:/i, '');

  // Typed directly as a number: show as typed, whatever form it was in (spaces, dashes, sgnl://, ...).
  if (parseIntlPhone(v)) return v;

  if (key === 'whatsapp') {
    if (/\/(?:message|qr)\//i.test(url)) return 'WhatsApp link';
    return `+${url.replace(/^https:\/\/wa\.me\//i, '')}`;
  }

  // signal
  if (url.includes('/#eu/')) return 'Signal username link';
  return url.replace(/^https:\/\/signal\.me\/#p\//i, '');
}

/** Keys of `c` with a usable value, in CONTACT_KEYS order. */
export function profileContactChannels(c: ProfileContact): ProfileContactKey[] {
  return CONTACT_KEYS.filter((key) => contactUrl(key, c[key]) !== null);
}

/** Keys whose value differs between `before` and `after`, with `after`'s value. Like mergeLinks: this is
 * the diff a PUT sends, not the merge itself (undefined keeps a value server-side, null/'' removes it). */
export function changedKeys<K extends string>(
  before: Record<K, string>,
  after: Record<K, string>,
): Partial<Record<K, string>> {
  const out: Partial<Record<K, string>> = {};
  for (const key of Object.keys(after) as K[]) {
    if (before[key] !== after[key]) out[key] = after[key];
  }
  return out;
}
