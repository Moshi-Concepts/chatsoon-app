import { parseBookingUrl } from './booking';
import { APP_NAME, COPYRIGHT } from './constants';
import {
  cleanText,
  isDiscordDiscriminator,
  isDiscordUsername,
  isEmail,
  isTelegramHandle,
  isXHandle,
  linkedInProfileUrl,
  normalizeHandle,
  parseSocialUrl,
  profileSlugFromUrl,
  toLinkUrl,
  type SocialProfile,
} from './links';
import { CONTACT_LABELS, contactUrl } from './profile-contact';
import type { ContactDraft } from './qr';
import type { ProfileContact, ProfileLinks } from './types';

// vCard 3.0 writer (RFC 2426) and a lenient reader for vCard 2.1, 3.0 and 4.0 (RFC 6350) and MECARD.
// Pure string code: no TextEncoder/TextDecoder, so it runs the same in Hermes and Workers.

export interface VCardProfile {
  displayName: string;
  headline?: string | null;
  company?: string | null;
  role?: string | null;
  links?: ProfileLinks;
  profileUrl: string;
  bookingLinks?: { label: string; url: string }[];
  /** Phone, WhatsApp and Signal. Only values that pass contactUrl are written. */
  contact?: ProfileContact;
}

const CRLF = '\r\n';
const MAX_LINE_OCTETS = 75;

// ---- Writing ----

/** Escapes a TEXT value: backslash, comma, semicolon and newlines. */
function escapeText(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/\\/g, '\\\\')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;')
    .replace(/\n/g, '\\n');
}

function utf8Length(text: string): number {
  let bytes = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }
  return bytes;
}

/**
 * Folds a content line at 75 octets (continuation lines start with one space).
 * Never splits a UTF-8 character, a surrogate pair or a backslash escape.
 */
export function foldLine(line: string): string {
  const units: string[] = [];
  for (const char of line) {
    const last = units.length - 1;
    if (units[last] === '\\') units[last] += char;
    else units.push(char);
  }
  let out = '';
  let size = 0;
  for (const unit of units) {
    const bytes = utf8Length(unit);
    if (size + bytes > MAX_LINE_OCTETS) {
      out += `${CRLF} `;
      size = 1;
    }
    out += unit;
    size += bytes;
  }
  return out;
}

/** Han, kana and Hangul: names in these scripts are written family name first. */
const CJK = /[\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF]/;

/**
 * 'Peter Bui' -> family 'Bui', given 'Peter'. A CJK name with a space is family name first ('<family> <given>').
 * A single word (or a CJK name without spaces) is the given name.
 */
function splitName(name: string): { family: string; given: string } {
  const parts = name.split(' ').filter(Boolean);
  if (parts.length < 2) return { family: '', given: parts.join(' ') };
  if (CJK.test(parts[0] ?? '')) return { family: parts[0] ?? '', given: parts.slice(1).join(' ') };
  return { family: parts[parts.length - 1] ?? '', given: parts.slice(0, -1).join(' ') };
}

const singleLine = (value: string | null | undefined) => cleanText((value ?? '').replace(/\s+/g, ' '));

/** vCard 3.0 text for a public profile (never includes the owner's email). */
export function buildVCard(p: VCardProfile): string {
  const name = singleLine(p.displayName);
  const { family, given } = splitName(name);
  const lines = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `PRODID:-//${escapeText(COPYRIGHT)}//${APP_NAME}//EN`,
    `N:${escapeText(family)};${escapeText(given)};;;`,
    `FN:${escapeText(name)}`,
  ];

  const company = singleLine(p.company);
  if (company) lines.push(`ORG:${escapeText(company)}`);
  const role = singleLine(p.role);
  if (role) lines.push(`TITLE:${escapeText(role)}`);
  const headline = cleanText(p.headline ?? '');
  if (headline) lines.push(`NOTE:${escapeText(headline)}`);

  const contact = p.contact ?? {};
  const phone = contactUrl('phone', contact.phone);
  if (phone) lines.push(`TEL;TYPE=CELL:${phone.replace(/^tel:/i, '')}`);

  // URIs are not TEXT values, so they aren't escaped. The profile URL comes first: it's the card's own link.
  // The item group gives it a 'Chatsoon' label in iOS and Google Contacts; other readers ignore X-ABLabel.
  const profileUrl = cleanText(p.profileUrl);
  if (/^https?:\/\/[^\s<>"`\\]+$/i.test(profileUrl)) {
    lines.push(`item1.URL:${profileUrl}`, `item1.X-ABLabel:${escapeText(APP_NAME)}`);
  }

  // One item pair per booking link, right after the profile URL. Only re-parsing links are trusted.
  let item = 2;
  for (const link of p.bookingLinks ?? []) {
    if (!parseBookingUrl(link.url)) continue;
    lines.push(`item${item}.URL:${link.url}`, `item${item}.X-ABLabel:${escapeText(link.label)}`);
    item++;
  }

  const links = p.links ?? {};
  const website = toLinkUrl('website', links.website);
  if (website) lines.push(`URL:${website}`);
  const x = toLinkUrl('x', links.x);
  if (x) lines.push(`X-SOCIALPROFILE;TYPE=twitter:${x}`);
  const telegram = toLinkUrl('telegram', links.telegram);
  if (telegram) lines.push(`X-SOCIALPROFILE;TYPE=telegram:${telegram}`);
  // A Discord id writes a real URL, like the other socials. A username or legacy discriminator has no
  // URL (toLinkUrl returns null for them), so it's written as escaped TEXT instead of a bare URI.
  const discordUrl = toLinkUrl('discord', links.discord);
  const discordRaw = cleanText(links.discord ?? '');
  if (discordUrl) {
    lines.push(`X-SOCIALPROFILE;TYPE=discord:${discordUrl}`);
  } else if (discordRaw && (isDiscordUsername(discordRaw) || isDiscordDiscriminator(discordRaw))) {
    lines.push(`X-SOCIALPROFILE;TYPE=discord:${escapeText(discordRaw)}`);
  }
  const linkedin = toLinkUrl('linkedin', links.linkedin);
  if (linkedin) lines.push(`X-SOCIALPROFILE;TYPE=linkedin:${linkedin}`);
  const youtube = toLinkUrl('youtube', links.youtube);
  if (youtube) lines.push(`X-SOCIALPROFILE;TYPE=youtube:${youtube}`);

  // WhatsApp and Signal as item pairs, continuing the booking links' item counter (not restarting it).
  const whatsapp = contactUrl('whatsapp', contact.whatsapp);
  if (whatsapp) {
    lines.push(`item${item}.URL:${whatsapp}`, `item${item}.X-ABLabel:${CONTACT_LABELS.whatsapp}`);
    item++;
  }
  const signal = contactUrl('signal', contact.signal);
  if (signal) {
    lines.push(`item${item}.URL:${signal}`, `item${item}.X-ABLabel:${CONTACT_LABELS.signal}`);
    item++;
  }

  lines.push('END:VCARD');
  return lines.map(foldLine).join(CRLF) + CRLF;
}

// ---- Character decoding (quoted-printable payloads) ----

/** Windows-1252 code points for bytes 0x80 to 0x9F. 0 means undefined, which decodes as the byte itself. */
const CP1252_HIGH = [
  0x20ac, 0, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0, 0x017d, 0,
  0, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0, 0x017e, 0x0178,
];

function decodeCp1252(bytes: number[]): string {
  let out = '';
  for (const b of bytes) out += String.fromCharCode(b >= 0x80 && b <= 0x9f ? CP1252_HIGH[b - 0x80] || b : b);
  return out;
}

/** Continuation bytes that follow a UTF-8 lead byte, or -1 for a byte that can't start a character. */
function utf8Extra(lead: number): number {
  if (lead < 0x80) return 0;
  if (lead >= 0xc2 && lead <= 0xdf) return 1;
  if (lead >= 0xe0 && lead <= 0xef) return 2;
  if (lead >= 0xf0 && lead <= 0xf4) return 3;
  return -1;
}

/** Strict UTF-8 decoder. Null when the bytes aren't valid UTF-8. */
function decodeUtf8(bytes: number[]): string | null {
  let out = '';
  for (let i = 0; i < bytes.length; ) {
    const b = bytes[i] ?? 0;
    const extra = utf8Extra(b);
    if (extra < 0 || i + extra >= bytes.length) return null;
    let code = extra === 0 ? b : b & (0x3f >> extra);
    for (let k = 1; k <= extra; k++) {
      const next = bytes[i + k] ?? 0;
      if ((next & 0xc0) !== 0x80) return null;
      code = (code << 6) | (next & 0x3f);
    }
    const min = [0, 0x80, 0x800, 0x10000][extra] ?? 0;
    if (code < min || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return null;
    out += String.fromCodePoint(code);
    i += extra + 1;
  }
  return out;
}

function utf8Bytes(char: string, into: number[]): void {
  const code = char.codePointAt(0) ?? 0;
  if (code < 0x80) into.push(code);
  else if (code < 0x800) into.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
  else if (code < 0x10000) into.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
  else {
    into.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 0x3f), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
  }
}

/**
 * Decodes '=XX' escapes to bytes, then decodes the bytes with the given charset
 * (UTF-8 when unknown, falling back to Windows-1252 when the bytes aren't valid UTF-8).
 */
function decodeQuotedPrintable(value: string, charset: string): string {
  const singleByte = /^(?:iso88591|latin1|l1|windows1252|cp1252|usascii|ascii)$/.test(
    charset.toLowerCase().replace(/[^a-z0-9]/g, ''),
  );
  const bytes: number[] = [];
  // A trailing '=' is a soft line break with nothing after it.
  const chars = Array.from(value.endsWith('=') ? value.slice(0, -1) : value);
  for (let i = 0; i < chars.length; i++) {
    const char = chars[i] ?? '';
    const hex = char === '=' ? `${chars[i + 1] ?? ''}${chars[i + 2] ?? ''}` : '';
    const code = char.codePointAt(0) ?? 0;
    if (/^[0-9A-Fa-f]{2}$/.test(hex)) {
      bytes.push(parseInt(hex, 16));
      i += 2;
    } else if (singleByte && code <= 0xff) {
      bytes.push(code);
    } else {
      // Unencoded non-ASCII text (invalid QP, but it happens): keep the character.
      utf8Bytes(char, bytes);
    }
  }
  return singleByte ? decodeCp1252(bytes) : (decodeUtf8(bytes) ?? decodeCp1252(bytes));
}

// ---- Reading ----

interface VCardProperty {
  /** Upper case, group prefix ('item1.') removed. */
  name: string;
  /** Upper-case parameter names to their values. 2.1 bare parameters ('CELL', 'QUOTED-PRINTABLE') are normalised. */
  params: Map<string, string[]>;
  /** Decoded (quoted-printable) but still escaped value. */
  value: string;
}

const BARE_ENCODINGS = new Set(['QUOTED-PRINTABLE', 'BASE64', 'B', '8BIT', '7BIT']);

/** Splits on `separator` outside double quotes. */
function splitOutsideQuotes(text: string, separator: string): string[] {
  const parts: string[] = [];
  let current = '';
  let quoted = false;
  for (const char of text) {
    if (char === '"') quoted = !quoted;
    if (char === separator && !quoted) {
      parts.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  parts.push(current);
  return parts;
}

/** Splits a structured value ('Bui;Peter;;;') on unescaped separators, keeping escapes for unescapeText. */
function splitEscaped(value: string, separator: string): string[] {
  const parts: string[] = [];
  let current = '';
  for (let i = 0; i < value.length; i++) {
    const char = value.charAt(i);
    if (char === '\\' && i + 1 < value.length) {
      current += char + value.charAt(i + 1);
      i++;
    } else if (char === separator) {
      parts.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  parts.push(current);
  return parts;
}

/** Undoes TEXT escaping: '\n' and '\N' are newlines, any other '\x' is x (covers '\,', '\;', '\\' and 'http\://'). */
function unescapeText(value: string): string {
  return value.replace(/\\([\s\S])/g, (_, char: string) => (char === 'n' || char === 'N' ? '\n' : char));
}

function isQuotedPrintableLine(line: string): boolean {
  const colon = line.indexOf(':');
  return colon > 0 && /QUOTED-PRINTABLE/i.test(line.slice(0, colon));
}

/**
 * Joins folded lines. 3.0/4.0 drop the line break and one leading space or tab; 2.1 keeps the whitespace
 * (RFC 822 folding). Quoted-printable values also continue after a soft line break ('=' at end of line).
 */
function unfold(text: string, keepFoldWhitespace: boolean): string[] {
  const lines: string[] = [];
  for (const line of text.split(/\r\n|\r|\n/)) {
    const last = lines.length - 1;
    const previous = lines[last];
    // A stray '=' on the last value must not swallow the END line.
    const softBreak = previous?.endsWith('=') && isQuotedPrintableLine(previous) && !/^END:VCARD\s*$/i.test(line);
    if (previous !== undefined && softBreak) {
      lines[last] = previous.slice(0, -1) + line;
    } else if (previous !== undefined && /^[ \t]/.test(line)) {
      lines[last] = previous + (keepFoldWhitespace ? line : line.slice(1));
    } else {
      lines.push(line);
    }
  }
  return lines;
}

function parseProperty(line: string): VCardProperty | null {
  let colon = -1;
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line.charAt(i);
    if (char === '"') quoted = !quoted;
    else if (char === ':' && !quoted) {
      colon = i;
      break;
    }
  }
  if (colon <= 0) return null;

  const [nameWithGroup = '', ...rawParams] = splitOutsideQuotes(line.slice(0, colon), ';');
  const name = nameWithGroup.slice(nameWithGroup.lastIndexOf('.') + 1).trim().toUpperCase();
  const params = new Map<string, string[]>();
  const add = (key: string, values: string[]) => params.set(key, [...(params.get(key) ?? []), ...values]);
  for (const raw of rawParams) {
    const eq = raw.indexOf('=');
    if (eq === -1) {
      const bare = raw.trim().toUpperCase();
      if (bare) add(BARE_ENCODINGS.has(bare) ? 'ENCODING' : 'TYPE', [bare]);
      continue;
    }
    const values = splitOutsideQuotes(raw.slice(eq + 1), ',').map((v) => v.trim().replace(/^"|"$/g, ''));
    add(raw.slice(0, eq).trim().toUpperCase(), values);
  }

  let value = line.slice(colon + 1);
  const encoding = (params.get('ENCODING')?.[0] ?? '').toUpperCase();
  // Binary payloads (PHOTO, LOGO, KEY, SOUND) carry nothing a contact draft needs.
  if (encoding === 'B' || encoding === 'BASE64') return null;
  if (encoding === 'QUOTED-PRINTABLE') value = decodeQuotedPrintable(value, params.get('CHARSET')?.[0] ?? 'utf-8');
  return { name, params, value };
}

/** Properties of the first vCard in `text` (everything, if there's no BEGIN:VCARD line). */
function readProperties(text: string): VCardProperty[] {
  const version = /^VERSION:\s*([\d.]+)/im.exec(text)?.[1] ?? '3.0';
  const lines = unfold(text, version.startsWith('2'));
  const hasBegin = lines.some((l) => /^BEGIN:VCARD\s*$/i.test(l));
  const properties: VCardProperty[] = [];
  let inside = !hasBegin;
  for (const line of lines) {
    if (/^BEGIN:VCARD\s*$/i.test(line)) {
      inside = true;
      continue;
    }
    if (/^END:VCARD\s*$/i.test(line)) {
      if (hasBegin) break;
      continue;
    }
    if (!inside) continue;
    const property = parseProperty(line);
    if (property) properties.push(property);
  }
  return properties;
}

/** Lower-case values of the TYPE-like parameters (TYPE, SERVICE-TYPE, X-SERVICE-TYPE). */
function serviceTypes(property: VCardProperty): string[] {
  return ['TYPE', 'SERVICE-TYPE', 'X-SERVICE-TYPE'].flatMap((key) =>
    (property.params.get(key) ?? []).flatMap((v) => v.toLowerCase().split(',')).map((v) => v.trim()),
  );
}

/**
 * How preferred a value is: 1 is most preferred (vCard 4.0 PREF=1 to 100; 2.1/3.0 TYPE=pref counts as 1).
 * Values with no preference rank last.
 */
function preference(property: VCardProperty): number {
  const pref = Number.parseInt(property.params.get('PREF')?.[0] ?? '', 10);
  if (pref >= 1) return pref;
  return property.params.has('PREF') || serviceTypes(property).includes('pref') ? 1 : Number.POSITIVE_INFINITY;
}

/** Display name from N components (family, given, additional, prefix, suffix). CJK names are family-first, unspaced. */
function composeName(components: string[]): string {
  const [family = '', given = '', additional = '', prefix = '', suffix = ''] = components.map(singleLine);
  const parts = CJK.test(family + given)
    ? [prefix, family + given, suffix]
    : [prefix, given, additional, family, suffix];
  return parts.filter(Boolean).join(' ');
}

type DraftField = keyof ContactDraft;

/**
 * Collects parsed values. The first valid value for a field wins, except email and phone,
 * where the most preferred value wins (ties go to the first).
 */
class DraftBuilder {
  private readonly draft: ContactDraft = {};
  private readonly websites: string[] = [];
  private profileUrl: string | null = null;
  private readonly ranked = new Map<'email' | 'phone', { value: string; rank: number }>();

  set(field: DraftField, value: string | null | undefined): void {
    const v = field === 'notes' ? cleanText(value ?? '') : singleLine(value);
    if (v && !this.draft[field]) this.draft[field] = v;
  }

  private rank(field: 'email' | 'phone', value: string, rank: number): void {
    const current = this.ranked.get(field);
    if (!current || rank < current.rank) this.ranked.set(field, { value, rank });
  }

  email(value: string, rank = Number.POSITIVE_INFINITY): void {
    const email = cleanText(cleanText(value).replace(/^mailto:/i, ''));
    if (isEmail(email)) this.rank('email', email, rank);
  }

  phone(value: string, rank = Number.POSITIVE_INFINITY): void {
    // 4.0 writes TEL as a URI: 'tel:+1-555-555-0100;ext=12'.
    const phone = singleLine(cleanText(value).replace(/^tel:/i, '').replace(/;[\s\S]*$/, ''));
    if (toLinkUrl('phone', phone)) this.rank('phone', phone, rank);
  }

  social(profile: SocialProfile): void {
    if (profile.network === 'x') this.set('xHandle', profile.handle);
    else if (profile.network === 'telegram') this.set('telegram', profile.handle);
    else this.set('linkedinUrl', profile.url);
  }

  /** Routes a URL: social profiles to their fields, a Chatsoon profile link as a fallback website, else website. */
  url(value: string): void {
    const social = parseSocialUrl(value);
    if (social) return this.social(social);
    const url = toLinkUrl('website', value);
    if (!url) return;
    if (profileSlugFromUrl(url)) this.profileUrl ??= url;
    else this.websites.push(url);
  }

  telegram(value: string | undefined): void {
    const handle = value ? normalizeHandle(value) : '';
    if (isTelegramHandle(handle)) this.set('telegram', handle);
  }

  x(value: string | undefined): void {
    const handle = value ? normalizeHandle(value) : '';
    if (isXHandle(handle)) this.set('xHandle', handle);
  }

  linkedin(value: string | undefined): void {
    if (value) this.set('linkedinUrl', linkedInProfileUrl(value) ?? toLinkUrl('linkedin', value));
  }

  build(): ContactDraft {
    for (const [field, { value }] of this.ranked) this.draft[field] = value;
    this.set('website', this.websites[0] ?? this.profileUrl);
    return this.draft;
  }
}

/** Strips the pseudo-schemes iOS and others put in front of IM and social usernames ('x-apple:peter'). */
const stripImScheme = (value: string) => cleanText(value).replace(/^(?:x-apple|telegram|tg|twitter|x):(?!\/\/)/i, '');

function applySocialProfile(builder: DraftBuilder, property: VCardProperty): void {
  const types = serviceTypes(property);
  const user = property.params.get('X-USER')?.[0];
  const value = stripImScheme(unescapeText(property.value));
  if (types.includes('twitter') || types.includes('x')) {
    builder.x(user && isXHandle(normalizeHandle(user)) ? user : value);
  } else if (types.includes('telegram')) {
    builder.telegram(user && isTelegramHandle(normalizeHandle(user)) ? user : value);
  } else if (types.includes('linkedin')) {
    builder.linkedin(parseSocialUrl(value) || !user ? value : user);
  } else {
    const social = parseSocialUrl(value);
    if (social) builder.social(social);
  }
}

function applyImpp(builder: DraftBuilder, property: VCardProperty): void {
  const raw = cleanText(unescapeText(property.value));
  const isTelegram =
    serviceTypes(property).includes('telegram') ||
    /^(?:telegram|tg):/i.test(raw) ||
    parseSocialUrl(raw)?.network === 'telegram';
  if (isTelegram) builder.telegram(stripImScheme(raw));
}

/** Parses vCard 2.1/3.0/4.0 text into contact fields. */
export function parseVCard(text: string): ContactDraft {
  const builder = new DraftBuilder();
  let fullName = '';
  let structuredName = '';
  let nickname = '';
  let roleFallback = '';
  const notes: string[] = [];

  for (const property of readProperties(text)) {
    const { name, value } = property;
    switch (name) {
      case 'FN':
        fullName ||= singleLine(unescapeText(value));
        break;
      case 'N':
        // Each component can be a comma-separated list ('Philip,Paul'): show it space-separated.
        structuredName ||= composeName(
          splitEscaped(value, ';').map((part) => splitEscaped(part, ',').map(unescapeText).join(' ')),
        );
        break;
      case 'NICKNAME':
        nickname ||= singleLine(unescapeText(splitEscaped(value, ',')[0] ?? ''));
        break;
      case 'ORG':
        builder.set('company', unescapeText(splitEscaped(value, ';')[0] ?? ''));
        break;
      case 'TITLE':
        builder.set('role', unescapeText(value));
        break;
      case 'ROLE':
        roleFallback ||= singleLine(unescapeText(value));
        break;
      case 'EMAIL':
        builder.email(unescapeText(value), preference(property));
        break;
      case 'TEL':
        builder.phone(unescapeText(value), preference(property));
        break;
      case 'URL':
        builder.url(cleanText(unescapeText(value)));
        break;
      case 'X-SOCIALPROFILE':
      case 'SOCIALPROFILE':
        applySocialProfile(builder, property);
        break;
      case 'IMPP':
        applyImpp(builder, property);
        break;
      case 'X-TELEGRAM':
        builder.telegram(stripImScheme(unescapeText(value)));
        break;
      case 'X-TWITTER':
        builder.x(stripImScheme(unescapeText(value)));
        break;
      case 'X-LINKEDIN':
        builder.linkedin(cleanText(unescapeText(value)));
        break;
      case 'NOTE': {
        const note = cleanText(unescapeText(value).replace(/\r\n?/g, '\n'));
        if (note) notes.push(note);
        break;
      }
    }
  }

  builder.set('name', fullName || structuredName || nickname);
  builder.set('role', roleFallback);
  builder.set('notes', notes.join('\n\n'));
  return builder.build();
}

// ---- MECARD ----

/** MECARD escapes ('\;', '\:', '\,', '\\') are a backslash before the literal character. */
const unescapeMeCard = (value: string) => value.replace(/\\([\s\S])/g, '$1');

/**
 * Parses a MECARD ('MECARD:N:Bui,Peter;TEL:+61400111222;EMAIL:peter@example.com;;') or the older
 * BIZCARD format into contact fields.
 */
export function parseMeCard(text: string): ContactDraft {
  const match = /^(MECARD|BIZCARD):/i.exec(cleanText(text));
  if (!match?.[1]) return {};
  const isBizCard = match[1].toUpperCase() === 'BIZCARD';
  const builder = new DraftBuilder();
  let name = '';
  let nickname = '';
  let firstName = '';
  let lastName = '';

  for (const field of splitEscaped(cleanText(text).slice(match[0].length), ';')) {
    const colon = field.indexOf(':');
    if (colon <= 0) continue;
    const key = field.slice(0, colon).trim().toUpperCase();
    const raw = field.slice(colon + 1);
    const value = unescapeMeCard(raw);

    if (isBizCard) {
      if (key === 'N') firstName ||= singleLine(value);
      else if (key === 'X') lastName ||= singleLine(value);
      else if (key === 'T') builder.set('role', value);
      else if (key === 'C') builder.set('company', value);
      else if (key === 'B' || key === 'M') builder.phone(value);
      else if (key === 'E') builder.email(value);
      else if (key === 'U' || key === 'URL') builder.url(cleanText(value));
      continue;
    }

    switch (key) {
      case 'N': {
        // 'Last,First' per the DoCoMo spec. A plain 'Peter Bui' is used as is.
        const [last = '', first = ''] = splitEscaped(raw, ',').map(unescapeMeCard);
        name ||= first ? composeName([last, first]) : singleLine(last);
        break;
      }
      case 'NICKNAME':
        nickname ||= singleLine(value);
        break;
      case 'TEL':
      case 'TEL-AV':
        builder.phone(value);
        break;
      case 'EMAIL':
        builder.email(value);
        break;
      case 'URL':
        builder.url(cleanText(value));
        break;
      case 'ORG':
        builder.set('company', value);
        break;
      case 'TITLE':
        builder.set('role', value);
        break;
      case 'NOTE':
        builder.set('notes', value);
        break;
    }
  }

  builder.set('name', isBizCard ? singleLine(`${firstName} ${lastName}`) : name || nickname);
  return builder.build();
}
