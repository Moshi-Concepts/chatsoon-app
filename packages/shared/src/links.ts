import { APP_SCHEME, PROFILE_PATH_PREFIX, WEB_ORIGIN } from './constants';
import { isValidSlug } from './slug';
import type { LinkKey } from './types';

// Pure string helpers shared by the Worker and the app (Hermes and react-native-web).
// No URL, TextEncoder or other host APIs: React Native's URL polyfill is incomplete.

export type LinkTarget = LinkKey | 'email' | 'phone';

/** Profile link keys in display order. */
export const LINK_KEYS: readonly LinkKey[] = ['x', 'telegram', 'linkedin', 'website', 'youtube'];

const LINK_LABELS: Record<LinkTarget, string> = {
  x: 'X',
  telegram: 'Telegram',
  linkedin: 'LinkedIn',
  website: 'Website',
  youtube: 'YouTube',
  email: 'Email',
  phone: 'Phone',
};

/** Human label for a link field: 'x' -> 'X', 'linkedin' -> 'LinkedIn'. */
export function linkLabel(key: LinkTarget): string {
  return LINK_LABELS[key];
}

// ---- Primitives ----

const TRIM_CHAR = /[\s\u200B-\u200D\u2060\uFEFF]/;

/** Trims whitespace plus the zero-width characters that copy/paste and QR generators leave behind. */
export function cleanText(value: string): string {
  // A scan instead of /\s+$/, which backtracks quadratically on long inner runs of whitespace.
  let start = 0;
  let end = value.length;
  while (start < end && TRIM_CHAR.test(value.charAt(start))) start++;
  while (end > start && TRIM_CHAR.test(value.charAt(end - 1))) end--;
  return start === 0 && end === value.length ? value : value.slice(start, end);
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Percent-encodes raw non-ASCII runs (e.g. a LinkedIn id typed in Chinese). Null on lone surrogates. */
function encodeNonAscii(value: string): string | null {
  try {
    return value.replace(/[^\x00-\x7F]+/g, (run) => encodeURIComponent(run));
  } catch {
    return null;
  }
}

/** Value of one query parameter in a raw query string ('?a=1&b=2' or 'a=1&b=2'). Names are case-insensitive. */
function queryParam(query: string, name: string): string | null {
  for (const pair of query.replace(/^[?#]/, '').split('&')) {
    const eq = pair.indexOf('=');
    const key = eq === -1 ? pair : pair.slice(0, eq);
    if (key.toLowerCase() === name) return safeDecode((eq === -1 ? '' : pair.slice(eq + 1)).replace(/\+/g, ' '));
  }
  return null;
}

/**
 * The local part zod's z.email() accepts, so anything that passes here also passes the app's emailSchema.
 * It also keeps out '?', '&', '=', '#', '%' and '/', which would turn 'mailto:' links into header injection
 * ('you?bcc=them@evil.com').
 */
const EMAIL_LOCAL = /^[A-Za-z0-9_'+-]+(?:\.[A-Za-z0-9_'+-]+)*$/;
const EMAIL_DOMAIN = /^(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+(?:[A-Za-z]{2,63}|xn--[A-Za-z0-9-]{1,59})$/;

/** A plausible email address ('peter@example.com'). Surrounding whitespace is ignored. */
export function isEmail(value: string): boolean {
  const v = cleanText(value);
  if (v.length > 254) return false;
  const at = v.lastIndexOf('@');
  if (at < 1) return false;
  const local = v.slice(0, at);
  return (
    local.length <= 64 && !local.endsWith("'") && EMAIL_LOCAL.test(local) && EMAIL_DOMAIN.test(v.slice(at + 1))
  );
}

/** X handle rules: 1 to 15 letters, digits or underscores. */
export function isXHandle(value: string): boolean {
  return /^[A-Za-z0-9_]{1,15}$/.test(value);
}

/** Telegram username rules: 4 to 32 characters, starts with a letter, then letters, digits or underscores. */
export function isTelegramHandle(value: string): boolean {
  return /^[A-Za-z][A-Za-z0-9_]{3,31}$/.test(value);
}

// ---- Handles ----

const HANDLE_HOST_PREFIX =
  /^(?:https?:\/\/)?(?:(?:www|mobile|m)\.)?(?:t\.me|telegram\.me|telegram\.dog|x\.com|twitter\.com)(?:\/+|$)/i;
/** App deep links that carry the handle in a query parameter. */
const HANDLE_APP_LINK = /^(?:tg:\/\/resolve|twitter:\/\/user)\?/i;

const stripAt = (value: string) => cleanText(value).replace(/^@+/, '');

/** The network whose link (web or app) `value` is, or null for a bare handle or any other text. */
function handleNetwork(value: string): 'telegram' | 'x' | null {
  const v = cleanText(value);
  const prefix = HANDLE_HOST_PREFIX.exec(v)?.[0] ?? HANDLE_APP_LINK.exec(v)?.[0];
  if (prefix) return /x\.com|twitter/i.test(prefix) ? 'x' : 'telegram';
  return TELEGRAM_SUBDOMAIN_URL.test(v) ? 'telegram' : null;
}

/**
 * Strips a leading '@', whitespace and known URL prefixes:
 * '@peter', 't.me/peter', 'https://x.com/peter?s=21', 'tg://resolve?domain=peter' -> 'peter'.
 * Other values are only trimmed and lose a leading '@', any query or hash, and trailing slashes.
 */
export function normalizeHandle(value: string): string {
  const v = cleanText(value);

  if (HANDLE_APP_LINK.test(v)) {
    const query = v.slice(v.indexOf('?'));
    return stripAt(queryParam(query, 'domain') ?? queryParam(query, 'screen_name') ?? '');
  }

  // 'https://peter.t.me' is Telegram's subdomain form of t.me/peter.
  const subdomain = TELEGRAM_SUBDOMAIN_URL.exec(v)?.[1];
  if (subdomain && subdomain.toLowerCase() !== 'www') return subdomain;

  const prefix = HANDLE_HOST_PREFIX.exec(v);
  if (!prefix) return stripAt(v.replace(/[?#].*$/, '').replace(/\/+$/, ''));

  const rest = v.slice(prefix[0].length);
  // x.com/intent/user?screen_name=peter
  const screenName = queryParam(/\?[^#]*/.exec(rest)?.[0] ?? '', 'screen_name');
  if (screenName && /^intent\//i.test(rest)) return stripAt(screenName);
  const segments = rest.replace(/[?#].*$/, '').split('/').filter(Boolean);
  // t.me/s/<channel> is the public web preview of a channel.
  const handle = segments[0]?.toLowerCase() === 's' && segments.length > 1 ? segments[1] : segments[0];
  return stripAt(handle ?? '');
}

// ---- Chatsoon profile links ----

const WEB_HOST = WEB_ORIGIN.replace(/^https?:\/\//, '').replace(/\./g, '\\.');
const PROFILE_SEGMENT = PROFILE_PATH_PREFIX.replace(/^\/|\/$/g, '');
const PROFILE_WEB_URL = new RegExp(
  `^(?:https?:\\/\\/)?(?:www\\.)?${WEB_HOST}\\/${PROFILE_SEGMENT}\\/([^/?#]+)\\/*(?:[?#].*)?$`,
  'i',
);
const PROFILE_APP_URL = new RegExp(`^${APP_SCHEME}:\\/\\/\\/?${PROFILE_SEGMENT}\\/([^/?#]+)\\/*(?:[?#].*)?$`, 'i');

/**
 * Slug of a Chatsoon profile link, or null. Accepts 'https://chatsoon.app/id/peter-bui-7f3a'
 * (http, www, trailing slash, query and hash allowed) and 'chatsoon://id/peter-bui-7f3a'.
 */
export function profileSlugFromUrl(value: string): string | null {
  const v = cleanText(value);
  const match = PROFILE_WEB_URL.exec(v) ?? PROFILE_APP_URL.exec(v);
  if (!match?.[1]) return null;
  // Some QR generators upper-case URLs to fit alphanumeric mode. Slugs are always lower case.
  const slug = safeDecode(match[1]).toLowerCase();
  return isValidSlug(slug) ? slug : null;
}

// ---- Social profile URLs ----

export type SocialProfile =
  | { network: 'telegram'; handle: string }
  | { network: 'x'; handle: string }
  | { network: 'linkedin'; url: string };

/** t.me paths that are features, not usernames. Paths starting with '+' (invites, phone links) are rejected too. */
const TELEGRAM_RESERVED = new Set([
  'addemoji',
  'addlist',
  'addstickers',
  'addtheme',
  'bg',
  'boost',
  'c',
  'confirmphone',
  'contact',
  'giftcode',
  'invoice',
  'iv',
  'joinchat',
  'login',
  'm',
  'proxy',
  's',
  'setlanguage',
  'share',
  'socks',
]);

/** Top-level x.com paths that are product pages, not profiles. */
const X_RESERVED = new Set([
  'about',
  'account',
  'compose',
  'download',
  'explore',
  'hashtag',
  'help',
  'home',
  'i',
  'intent',
  'jobs',
  'login',
  'logout',
  'messages',
  'notifications',
  'oauth',
  'privacy',
  'search',
  'settings',
  'share',
  'signup',
  'tos',
]);

const TELEGRAM_URL = /^(?:https?:\/\/)?(?:www\.)?(?:t\.me|telegram\.me|telegram\.dog)\/([^?#]*)(?:[?#].*)?$/i;
const TELEGRAM_SUBDOMAIN_URL = /^(?:https?:\/\/)?([A-Za-z0-9_]+)\.t\.me\/*(?:[?#].*)?$/i;
const TG_RESOLVE = /^tg:\/\/resolve\?(.*)$/i;
const X_URL = /^(?:https?:\/\/)?(?:(?:www|mobile|m)\.)?(?:x|twitter)\.com\/([^?#]*)(\?[^#]*)?(?:#.*)?$/i;
const X_APP_URL = /^twitter:\/\/user\?(.*)$/i;
const LINKEDIN_HOST = /^(?:https?:\/\/)?((?:[A-Za-z0-9-]+\.)*linkedin\.com|lnkd\.in)(?=[/?#]|$)/i;
const LINKEDIN_PROFILE_PATH = /^\/(?:(?:comm|mwlite)\/)?(in|pub)\/([^?#]+)/i;
/** Characters allowed in a LinkedIn public profile id, plus valid percent-escapes and raw non-ASCII letters. */
const LINKEDIN_ID = /^(?:[A-Za-z0-9_.~-]|%[0-9A-Fa-f]{2}|[^\x00-\x7F\s])+$/;

function telegramProfile(value: string): SocialProfile | null {
  const resolve = TG_RESOLVE.exec(value);
  if (resolve) {
    const domain = queryParam(resolve[1] ?? '', 'domain');
    return domain && isTelegramHandle(domain) ? { network: 'telegram', handle: domain } : null;
  }
  const sub = TELEGRAM_SUBDOMAIN_URL.exec(value);
  if (sub?.[1] && sub[1].toLowerCase() !== 'www') {
    return isTelegramHandle(sub[1]) ? { network: 'telegram', handle: sub[1] } : null;
  }
  const match = TELEGRAM_URL.exec(value);
  const first = match?.[1]?.split('/').filter(Boolean)[0];
  if (!first || first.startsWith('+') || TELEGRAM_RESERVED.has(first.toLowerCase())) return null;
  const handle = first.replace(/^@/, '');
  return isTelegramHandle(handle) ? { network: 'telegram', handle } : null;
}

function xProfile(value: string): SocialProfile | null {
  const app = X_APP_URL.exec(value);
  if (app) {
    const name = queryParam(app[1] ?? '', 'screen_name');
    return name && isXHandle(name) ? { network: 'x', handle: name } : null;
  }
  const match = X_URL.exec(value);
  if (!match) return null;
  const segments = (match[1] ?? '').split('/').filter(Boolean);
  const first = segments[0];
  if (!first) return null;
  if (first.toLowerCase() === 'intent' && /^(?:user|follow)$/i.test(segments[1] ?? '')) {
    const name = queryParam(match[2] ?? '', 'screen_name');
    return name && isXHandle(name) ? { network: 'x', handle: name } : null;
  }
  // Only bare profile URLs: x.com/<handle>/status/... is a post, not a person.
  if (segments.length !== 1 || X_RESERVED.has(first.toLowerCase())) return null;
  const handle = first.replace(/^@/, '');
  return isXHandle(handle) ? { network: 'x', handle } : null;
}

/** 'au.linkedin.com', 'm.linkedin.com' and bare 'linkedin.com' all become 'www.linkedin.com'. */
function linkedInHost(host: string): string {
  const h = host.toLowerCase();
  return h === 'linkedin.com' || /^(?:[a-z]{2}|m|mobile|www)\.linkedin\.com$/.test(h) ? 'www.linkedin.com' : h;
}

/** Canonical https URL for a LinkedIn member profile (/in/<id> or /pub/...), or null for anything else. */
export function linkedInProfileUrl(value: string): string | null {
  const v = cleanText(value);
  const host = LINKEDIN_HOST.exec(v);
  if (!host?.[1] || host[1].toLowerCase() === 'lnkd.in') return null;
  const path = LINKEDIN_PROFILE_PATH.exec(v.slice(host[0].length));
  if (!path?.[1] || !path[2]) return null;
  const kind = path[1].toLowerCase();
  const segments = path[2].split('/').filter(Boolean);
  // /in/<id>/details/... still identifies <id>. /pub/<name>/<a>/<b>/<c> needs the whole path.
  const id = kind === 'in' ? segments.slice(0, 1) : segments;
  if (id.length === 0 || !id.every((segment) => LINKEDIN_ID.test(segment))) return null;
  const encoded = encodeNonAscii(id.join('/'));
  return encoded ? `https://www.linkedin.com/${kind}/${encoded}` : null;
}

/**
 * Recognises a Telegram, X or LinkedIn profile link, with or without scheme, plus tg:// and twitter:// app links.
 * Invites, posts, search pages and other non-profile paths return null.
 */
export function parseSocialUrl(value: string): SocialProfile | null {
  const v = cleanText(value);
  if (!v || /\s/.test(v)) return null;
  const telegram = telegramProfile(v);
  if (telegram) return telegram;
  const x = xProfile(v);
  if (x) return x;
  const linkedin = linkedInProfileUrl(v);
  return linkedin ? { network: 'linkedin', url: linkedin } : null;
}

// ---- Tappable URLs ----

/** One DNS label: letters, digits, hyphens (not at either end) or raw non-ASCII (IDN). */
const HOST_LABEL = /^(?:[A-Za-z0-9]|[^\x00-\xA0])(?:(?:[A-Za-z0-9-]|[^\x00-\xA0]){0,61}(?:[A-Za-z0-9]|[^\x00-\xA0]))?$/;
/** Characters never valid unencoded in a URL, and risky wherever a link is rendered. */
const UNSAFE_URL_CHARS = /[\s<>"`\\]/;

function isValidHost(host: string): boolean {
  const name = host.replace(/:\d{1,5}$/, '');
  const labels = name.split('.');
  const tld = labels[labels.length - 1] ?? '';
  return (
    name.length <= 253 &&
    labels.length >= 2 &&
    labels.every((label) => HOST_LABEL.test(label)) &&
    tld.length >= 2 &&
    !/^\d+$/.test(tld)
  );
}

/**
 * Normalises a website value to an http(s) URL: adds https:// when there's no scheme and lower-cases the host.
 * Other schemes (javascript:, data:, mailto:, ...), credentials in the URL and malformed hosts give null.
 */
function toWebUrl(value: string): string | null {
  const v = cleanText(value);
  if (!v || UNSAFE_URL_CHARS.test(v)) return null;

  let scheme = 'https';
  let rest = v.replace(/^\/\//, '');
  const withScheme = /^([A-Za-z][A-Za-z0-9+.-]*):(.*)$/.exec(v);
  // 'example.com:8080' has a dot before the colon, so it's a host and port, not a scheme.
  if (withScheme?.[1] && !withScheme[1].includes('.')) {
    const s = withScheme[1].toLowerCase();
    const afterScheme = withScheme[2] ?? '';
    if ((s !== 'http' && s !== 'https') || !afterScheme.startsWith('//')) return null;
    scheme = s;
    rest = afterScheme.slice(2);
  }

  const match = /^([^/?#]+)(.*)$/.exec(rest);
  if (!match?.[1]) return null;
  const host = match[1].toLowerCase();
  if (host.includes('@') || !isValidHost(host)) return null;
  return `${scheme}://${host}${match[2] ?? ''}`;
}

function toLinkedInUrl(value: string): string | null {
  const v = cleanText(value);
  const host = LINKEDIN_HOST.exec(v);
  if (host?.[1]) {
    if (UNSAFE_URL_CHARS.test(v)) return null;
    const path = v
      .slice(host[0].length)
      .replace(/[?#].*$/, '')
      .replace(/\/+$/, '');
    const encoded = encodeNonAscii(path);
    // linkedin.com on its own isn't anyone's profile.
    return encoded ? `https://${linkedInHost(host[1])}${encoded}` : null;
  }
  // Any other URL or domain isn't LinkedIn.
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(v) || v.includes('.')) return null;
  const id = v.replace(/^@/, '').replace(/^\/?in\//i, '').replace(/\/+$/, '');
  if (id.length < 2 || id.length > 100 || !LINKEDIN_ID.test(id)) return null;
  const encoded = encodeNonAscii(id);
  return encoded ? `https://www.linkedin.com/in/${encoded}` : null;
}

function toYouTubeUrl(value: string): string | null {
  const v = cleanText(value);
  // '@handle', or a bare 'handle' with no dot, slash or colon, is a YouTube handle. Anything else is a URL.
  const handle = v.startsWith('@') ? v.slice(1) : /^[^./:]+$/.test(v) ? v : null;
  if (handle === null) return toWebUrl(v);
  // YouTube handles: letters (any script), digits, '_', '-', '.' and the middle dot.
  if (handle.length > 100 || !/^(?:[A-Za-z0-9_.\u00B7-]|[^\x00-\x7F\s])+$/.test(handle)) return null;
  const encoded = encodeNonAscii(handle);
  return encoded ? `https://www.youtube.com/@${encoded}` : null;
}

function toMailtoUrl(value: string): string | null {
  const email = cleanText(cleanText(value).replace(/^mailto:/i, ''));
  return isEmail(email) ? `mailto:${email}` : null;
}

function toTelUrl(value: string): string | null {
  // No phone number is this long, and it keeps the regexes below cheap on junk.
  if (value.length > 100) return null;
  // Drops URI params (';ext=12'), dial pauses (',123'), extensions ('ext 12', 'x12', '#12')
  // and the '(0)' trunk prefix in '+61 (0)4...'.
  const v = cleanText(
    cleanText(safeDecode(value))
      .replace(/^tel:/i, '')
      .replace(/[;,][\s\S]*$/, '')
      .replace(/\s*(?:ext\.?|extension|x|#)\s*\d{1,6}\s*$/i, '')
      .replace(/\(0\)/g, ''),
  );
  if (/[A-Za-z]/.test(v)) return null;
  const digits = v.replace(/\D/g, '');
  if (digits.length < 3 || digits.length > 17) return null;
  // '(+61) 412 345 678' is how many cards print an international number.
  return `tel:${/^[\s(]*\+/.test(v) ? '+' : ''}${digits}`;
}

/** Turns a stored profile/contact value into a tappable URL, or null if it can't. */
export function toLinkUrl(key: LinkKey | 'email' | 'phone', value: string | null | undefined): string | null {
  if (!value || !cleanText(value)) return null;
  switch (key) {
    case 'x': {
      const network = handleNetwork(value);
      const handle = normalizeHandle(value);
      // A t.me link isn't an X profile, and 'x.com/home' or 'x.com/intent/tweet?...' is a page, not a profile.
      // A bare handle is taken as typed.
      if (network === 'telegram' || (network === 'x' && X_RESERVED.has(handle.toLowerCase()))) return null;
      return isXHandle(handle) ? `https://x.com/${handle}` : null;
    }
    case 'telegram': {
      const handle = normalizeHandle(value);
      // An x.com link isn't a Telegram profile. 't.me/joinchat/...', 't.me/share/...' and the like are features.
      if (handleNetwork(value) === 'x' || TELEGRAM_RESERVED.has(handle.toLowerCase())) return null;
      return isTelegramHandle(handle) ? `https://t.me/${handle}` : null;
    }
    case 'linkedin':
      return toLinkedInUrl(value);
    case 'website':
      return toWebUrl(value);
    case 'youtube':
      return toYouTubeUrl(value);
    case 'email':
      return toMailtoUrl(value);
    case 'phone':
      return toTelUrl(value);
    default:
      return null;
  }
}

/**
 * Short text to show for a link: '@peter' for X and Telegram, 'linkedin.com/in/peter', 'example.com/about'.
 * Null when toLinkUrl can't make a link from the value.
 */
export function displayLink(key: LinkKey | 'email' | 'phone', value: string | null | undefined): string | null {
  const url = toLinkUrl(key, value);
  if (!url || !value) return null;
  switch (key) {
    case 'x':
    case 'telegram':
      return `@${normalizeHandle(value)}`;
    case 'email':
      return url.slice('mailto:'.length);
    case 'phone':
      return cleanText(value).replace(/^tel:/i, '');
    default:
      return safeDecode(url.replace(/^https?:\/\/(?:www\.)?/i, '').replace(/\/+$/, ''));
  }
}
