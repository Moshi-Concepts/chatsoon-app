import { cleanText } from './links';
import type { BookingLink, BookingProvider } from './types';

// Booking link parsing: same rules as links.ts, no URL class (React Native's polyfill is incomplete).
// A link must be on a known booking host, so a booking link can't be used for phishing.

export const MAX_BOOKING_LINKS = 5;
export const BOOKING_LABEL_MAX = 40;
export const BOOKING_URL_MAX = 500;
export const BOOKING_URL_HINT =
  'Use a booking link from Calendly, Google Calendar, Cal.com, HubSpot, Microsoft Bookings, Zoom, SavvyCal or TidyCal.';

const PROVIDER_NAMES: Record<BookingProvider, string> = {
  calendly: 'Calendly',
  google: 'Google Calendar',
  calcom: 'Cal.com',
  hubspot: 'HubSpot',
  microsoft: 'Microsoft Bookings',
  zoom: 'Zoom Scheduler',
  savvycal: 'SavvyCal',
  tidycal: 'TidyCal',
};

/** Human name for a booking provider: 'calendly' -> 'Calendly'. */
export function bookingProviderName(provider: BookingProvider): string {
  return PROVIDER_NAMES[provider];
}

// ---- Reserved first segments: the product's own pages, not a person's booking page. ----

const CALENDLY_RESERVED = new Set([
  'app', 'login', 'signup', 'pages', 'blog', 'resources', 'integrations', 'help', 'pricing', 'enterprise',
  'event_types', 'dashboard', 'about', 'legal', 'privacy', 'terms', 'features', 'solutions', 'customers',
  'careers', 'partners', 'apps', 'api', 'oauth', 'cookies', 'security', 'contact', 'sales',
]);

const CALCOM_RESERVED = new Set([
  'login', 'signup', 'auth', 'pricing', 'blog', 'docs', 'apps', 'enterprise', 'settings', 'bookings',
  'event-types', 'availability', 'workflows', 'insights', 'api', 'embed', 'about', 'privacy', 'terms',
  'security', 'careers', 'features',
]);

const SAVVYCAL_TIDYCAL_RESERVED = new Set([
  'login', 'signup', 'register', 'pricing', 'blog', 'features', 'about', 'privacy', 'terms', 'help', 'api',
  'dashboard',
]);

const HUBSPOT_HOST = /^meetings(?:-[a-z0-9]+)?\.hubspot\.com$/;

/** A path segment: letters, digits, `._~@+-` and valid `%XX` escapes. Nothing else, so no `<`, spaces or `:`. */
const SEGMENT = /^(?:[A-Za-z0-9._~@+-]|%[0-9A-Fa-f]{2})+$/;

/**
 * Strips a validated http(s) scheme and returns the rest, the input unchanged when there's no scheme,
 * or null for `//` (protocol-relative) or any other scheme (`javascript:`, `data:`, `mailto:`, ...).
 */
function stripScheme(value: string): string | null {
  if (value.startsWith('//')) return null;
  const match = /^([A-Za-z][A-Za-z0-9+.-]*):(.*)$/.exec(value);
  if (!match) return value;
  const scheme = (match[1] ?? '').toLowerCase();
  // A dot before the colon is a host with a port ('calendly.com:8080'), not a scheme.
  if (scheme.includes('.')) return value;
  const after = match[2] ?? '';
  return (scheme === 'http' || scheme === 'https') && after.startsWith('//') ? after.slice(2) : null;
}

function segmentsProvider(
  provider: BookingProvider,
  host: string,
  segments: string[],
  min: number,
  max: number,
  reserved?: Set<string>,
): { provider: BookingProvider; url: string } | null {
  if (segments.length < min || segments.length > max) return null;
  if (reserved?.has((segments[0] ?? '').toLowerCase())) return null;
  return { provider, url: `https://${host}/${segments.join('/')}` };
}

/**
 * Percent-decodes a segment for comparison. A decoded '/' (from '%2f'/'%2F') would smuggle an extra path
 * separator into what we're treating as a single segment, so that decode is rejected outright.
 */
function decodeSegment(segment: string): string | null {
  const decoded = safeDecode(segment);
  return decoded.includes('/') ? null : decoded;
}

/**
 * Resolves '.' and '..' segments per RFC 3986 §5.2.4 (literal or percent-encoded), so a segment-count or
 * reserved-word check can't be bypassed by an un-resolved '../': any RFC 3986-conformant client normalizes
 * 'calendly.com/x/../app' to '/app' before requesting it, so the un-resolved form must be judged and
 * canonicalised as '/app' too. Returns null for a '%2f'-smuggled separator (see decodeSegment) or a '..'
 * with nothing to consume. Segments that aren't '.'/'..' are kept in their original (undecoded) form.
 */
function resolveDotSegments(rawSegments: string[]): string[] | null {
  const resolved: string[] = [];
  for (const raw of rawSegments) {
    const decoded = decodeSegment(raw);
    if (decoded === null) return null;
    if (decoded === '.') continue;
    if (decoded === '..') {
      if (resolved.length === 0) return null;
      resolved.pop();
      continue;
    }
    resolved.push(raw);
  }
  return resolved;
}

/** `calendar/[u/<n>/]appointments/schedules/<id>`, dropping the `/u/<n>/` viewer segment. */
function googleCalendarSchedule(segments: string[]): { provider: 'google'; url: string } | null {
  if (segments[0] !== 'calendar') return null;
  let rest = segments.slice(1);
  if (rest[0] === 'u') {
    if (!/^\d+$/.test(rest[1] ?? '')) return null;
    rest = rest.slice(2);
  }
  const [section, kind, id] = rest;
  if (rest.length !== 3 || section !== 'appointments' || kind !== 'schedules' || !/^[A-Za-z0-9_-]+$/.test(id ?? '')) {
    return null;
  }
  return { provider: 'google', url: `https://calendar.google.com/calendar/appointments/schedules/${id}` };
}

/** `book/<page>[/...]` (2-4 segments) or `bookwithme/user/<id>[/...]` (3-5 segments), query kept if it's clean. */
function microsoftBooking(host: string, segments: string[], query: string): { provider: 'microsoft'; url: string } | null {
  const first = (segments[0] ?? '').toLowerCase();
  const isBook = first === 'book' && segments.length >= 2 && segments.length <= 4;
  const isBookWithMe =
    first === 'bookwithme' && (segments[1] ?? '').toLowerCase() === 'user' && segments.length >= 3 && segments.length <= 5;
  if (!isBook && !isBookWithMe) return null;
  if (query && !/^[A-Za-z0-9=&_.%-]*$/.test(query)) return null;
  const suffix = query ? `?${query}` : '';
  return { provider: 'microsoft', url: `https://${host}/${segments.join('/')}${suffix}` };
}

/** Canonical https URL and provider, or null when `value` isn't a supported booking link. */
export function parseBookingUrl(value: string): { provider: BookingProvider; url: string } | null {
  const v = cleanText(value);
  if (!v || /\s/.test(v) || v.length > BOOKING_URL_MAX) return null;

  const afterScheme = stripScheme(v);
  if (!afterScheme) return null;

  const boundary = afterScheme.search(/[/?#]/);
  const authority = boundary === -1 ? afterScheme : afterScheme.slice(0, boundary);
  const rest = boundary === -1 ? '' : afterScheme.slice(boundary);
  if (!authority || authority.includes('@') || authority.includes(':')) return null;
  const host = authority.toLowerCase().replace(/^www\./, '');

  const hash = rest.indexOf('#');
  const beforeHash = hash === -1 ? rest : rest.slice(0, hash);
  const q = beforeHash.indexOf('?');
  const pathPart = q === -1 ? beforeHash : beforeHash.slice(0, q);
  const query = q === -1 ? '' : beforeHash.slice(q + 1);

  const rawSegments = pathPart.split('/').filter(Boolean);
  if (!rawSegments.every((s) => SEGMENT.test(s))) return null;
  const segments = resolveDotSegments(rawSegments);
  if (!segments) return null;

  if (host === 'calendly.com') return segmentsProvider('calendly', host, segments, 1, 3, CALENDLY_RESERVED);
  if (host === 'cal.com') return segmentsProvider('calcom', host, segments, 1, 3, CALCOM_RESERVED);
  if (host === 'savvycal.com') return segmentsProvider('savvycal', host, segments, 1, 2, SAVVYCAL_TIDYCAL_RESERVED);
  if (host === 'tidycal.com') return segmentsProvider('tidycal', host, segments, 1, 2, SAVVYCAL_TIDYCAL_RESERVED);
  if (host === 'scheduler.zoom.us') return segmentsProvider('zoom', host, segments, 1, 2);
  if (HUBSPOT_HOST.test(host)) return segmentsProvider('hubspot', host, segments, 1, 2);
  if (host === 'calendar.app.google') {
    return segments.length === 1 && /^[A-Za-z0-9]+$/.test(segments[0] ?? '')
      ? { provider: 'google', url: `https://${host}/${segments[0]}` }
      : null;
  }
  if (host === 'calendar.google.com') return googleCalendarSchedule(segments);
  if (host === 'outlook.office365.com' || host === 'outlook.office.com') return microsoftBooking(host, segments, query);
  return null;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** 'crypto-chat' -> 'Crypto chat', '30min' -> '30 min'. Decodes, then spaces out separators and digit/letter runs. */
function humanizeSegment(segment: string): string {
  const spaced = safeDecode(segment)
    .replace(/[-_]+/g, ' ')
    .replace(/([0-9])([A-Za-z])/g, '$1 $2')
    .replace(/([A-Za-z])([0-9])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
  if (!spaced) return 'Book a meeting';
  const capitalized = spaced.charAt(0).toUpperCase() + spaced.slice(1);
  return capitalized.slice(0, BOOKING_LABEL_MAX);
}

/**
 * Label for a canonical booking URL: the last path segment, humanised, capped at `BOOKING_LABEL_MAX`.
 * 'Book a meeting' instead for a Google or Microsoft link, a single-segment link on any other provider
 * (the user's own page, not a specific event), or a segment that looks like an opaque id.
 */
export function suggestBookingLabel(url: string): string {
  const parsed = parseBookingUrl(url);
  if (!parsed) return 'Book a meeting';
  if (parsed.provider === 'google' || parsed.provider === 'microsoft') return 'Book a meeting';

  const segments = parsed.url.replace(/^https:\/\/[^/]+\/?/, '').split('/').filter(Boolean);
  if (segments.length <= 1) return 'Book a meeting';

  const last = segments[segments.length - 1] ?? '';
  if (last.length > 24 && !last.includes('-') && !last.includes('_')) return 'Book a meeting';
  return humanizeSegment(last);
}

/** URL the app's WebView (and new tabs) load. Today this is the canonical URL. */
export function bookingOpenUrl(link: Pick<BookingLink, 'url' | 'provider'>): string {
  return link.url;
}

/** iframe URL for the web page, or null when the provider isn't embeddable there. */
export function bookingEmbedUrl(link: Pick<BookingLink, 'url' | 'provider'>, embedDomain: string): string | null {
  switch (link.provider) {
    case 'calendly':
      return `${link.url}?embed_domain=${encodeURIComponent(embedDomain)}&embed_type=Inline`;
    case 'google':
      // Only the schedules form embeds; a calendar.app.google short link can't be checked, so it opens in a new tab.
      return link.url.startsWith('https://calendar.google.com/') ? `${link.url}?gv=true` : null;
    case 'hubspot':
      return `${link.url}?embed=true`;
    default:
      return null;
  }
}
