import { describe, expect, it } from 'vitest';

import {
  BOOKING_URL_HINT,
  bookingEmbedUrl,
  bookingOpenUrl,
  bookingProviderName,
  parseBookingUrl,
  suggestBookingLabel,
} from './booking';
import { bookingLinkInputSchema, bookingLinksSchema, profileInputSchema } from './schemas';

const OFFENSIVE = 'Please remove offensive language';

describe('parseBookingUrl', () => {
  it("parses Peter's own links, dropping the query and picking the right label", () => {
    const cryptoChat = parseBookingUrl('https://calendly.com/chatwithpete/crypto-chat?back=1&month=2026-09');
    expect(cryptoChat).toEqual({ provider: 'calendly', url: 'https://calendly.com/chatwithpete/crypto-chat' });
    expect(suggestBookingLabel(cryptoChat!.url)).toBe('Crypto chat');

    const thirtyMin = parseBookingUrl('https://calendly.com/chatwithpete/30min?back=1&month=2026-09');
    expect(thirtyMin).toEqual({ provider: 'calendly', url: 'https://calendly.com/chatwithpete/30min' });
    expect(suggestBookingLabel(thirtyMin!.url)).toBe('30 min');
  });

  describe('calendly.com', () => {
    it('accepts 1 to 3 segments and rejects a reserved first one or too many', () => {
      expect(parseBookingUrl('calendly.com/chatwithpete')).toEqual({
        provider: 'calendly',
        url: 'https://calendly.com/chatwithpete',
      });
      expect(parseBookingUrl('calendly.com/team/event/round-2')).toEqual({
        provider: 'calendly',
        url: 'https://calendly.com/team/event/round-2',
      });
      expect(parseBookingUrl('calendly.com/app')).toBeNull();
      expect(parseBookingUrl('calendly.com/pricing/anything')).toBeNull();
      expect(parseBookingUrl('calendly.com/a/b/c/d')).toBeNull();
    });
  });

  describe('calendar.app.google', () => {
    it('accepts exactly one alphanumeric segment', () => {
      expect(parseBookingUrl('https://calendar.app.google/AbC123')).toEqual({
        provider: 'google',
        url: 'https://calendar.app.google/AbC123',
      });
      expect(parseBookingUrl('https://calendar.app.google/ab-c')).toBeNull();
      expect(parseBookingUrl('https://calendar.app.google/a/b')).toBeNull();
    });
  });

  describe('calendar.google.com', () => {
    it('accepts the appointments/schedules path and drops /u/<n>/', () => {
      expect(parseBookingUrl('https://calendar.google.com/calendar/appointments/schedules/AAxx_yy-1')).toEqual({
        provider: 'google',
        url: 'https://calendar.google.com/calendar/appointments/schedules/AAxx_yy-1',
      });
      expect(parseBookingUrl('https://calendar.google.com/calendar/u/0/appointments/schedules/AAxx1')).toEqual({
        provider: 'google',
        url: 'https://calendar.google.com/calendar/appointments/schedules/AAxx1',
      });
    });

    it('rejects a bad id, a non-numeric viewer index or the wrong shape', () => {
      expect(parseBookingUrl('https://calendar.google.com/calendar/appointments/schedules/bad id')).toBeNull();
      expect(parseBookingUrl('https://calendar.google.com/calendar/u/abc/appointments/schedules/AAxx1')).toBeNull();
      expect(parseBookingUrl('https://calendar.google.com/calendar/appointments/AAxx1')).toBeNull();
      expect(parseBookingUrl('https://calendar.google.com/appointments/schedules/AAxx1')).toBeNull();
    });
  });

  describe('cal.com', () => {
    it('accepts 1 to 3 segments and rejects a reserved first one', () => {
      expect(parseBookingUrl('cal.com/peter/30min')).toEqual({ provider: 'calcom', url: 'https://cal.com/peter/30min' });
      expect(parseBookingUrl('cal.com/login')).toBeNull();
    });
  });

  describe('hubspot', () => {
    it('accepts the base and regional hosts with 1 or 2 segments', () => {
      expect(parseBookingUrl('https://meetings.hubspot.com/peter')).toEqual({
        provider: 'hubspot',
        url: 'https://meetings.hubspot.com/peter',
      });
      expect(parseBookingUrl('https://meetings-eu1.hubspot.com/peter/intro')).toEqual({
        provider: 'hubspot',
        url: 'https://meetings-eu1.hubspot.com/peter/intro',
      });
      expect(parseBookingUrl('https://meetings.hubspot.com/peter/intro/extra')).toBeNull();
    });

    it('does not match a look-alike host by suffix', () => {
      expect(parseBookingUrl('https://meetings.hubspot.com.evil.com/peter')).toBeNull();
      expect(parseBookingUrl('https://evilmeetings.hubspot.com/peter')).toBeNull();
    });
  });

  describe('microsoft', () => {
    it('accepts book/<page> (2-4 segments) and bookwithme/user/<id> (3-5 segments)', () => {
      expect(parseBookingUrl('https://outlook.office365.com/book/SalesTeam')).toEqual({
        provider: 'microsoft',
        url: 'https://outlook.office365.com/book/SalesTeam',
      });
      expect(parseBookingUrl('https://outlook.office.com/bookwithme/user/1234abc')).toEqual({
        provider: 'microsoft',
        url: 'https://outlook.office.com/bookwithme/user/1234abc',
      });
      expect(parseBookingUrl('https://outlook.office365.com/book/a/b/c/d')).toBeNull();
      expect(parseBookingUrl('https://outlook.office.com/bookwithme/staff/1234abc')).toBeNull();
    });

    it('keeps a clean query and rejects one with disallowed characters', () => {
      expect(parseBookingUrl('https://outlook.office365.com/book/SalesTeam?ownerEmail=a%40b.com&anon=true')).toEqual({
        provider: 'microsoft',
        url: 'https://outlook.office365.com/book/SalesTeam?ownerEmail=a%40b.com&anon=true',
      });
      expect(parseBookingUrl('https://outlook.office365.com/book/SalesTeam?a=1+2')).toBeNull();
    });
  });

  describe('scheduler.zoom.us', () => {
    it('accepts 1 or 2 segments', () => {
      expect(parseBookingUrl('https://scheduler.zoom.us/peter')).toEqual({
        provider: 'zoom',
        url: 'https://scheduler.zoom.us/peter',
      });
      expect(parseBookingUrl('https://scheduler.zoom.us/peter/intro/extra')).toBeNull();
    });
  });

  describe('savvycal.com and tidycal.com', () => {
    it('accept 1 or 2 segments and reject a reserved first one', () => {
      expect(parseBookingUrl('https://savvycal.com/peter')).toEqual({
        provider: 'savvycal',
        url: 'https://savvycal.com/peter',
      });
      expect(parseBookingUrl('https://savvycal.com/login')).toBeNull();
      expect(parseBookingUrl('https://tidycal.com/peter/meeting')).toEqual({
        provider: 'tidycal',
        url: 'https://tidycal.com/peter/meeting',
      });
      expect(parseBookingUrl('https://tidycal.com/dashboard')).toBeNull();
    });
  });

  it('accepts no scheme and http, always outputting https', () => {
    expect(parseBookingUrl('calendly.com/chatwithpete')?.url).toBe('https://calendly.com/chatwithpete');
    expect(parseBookingUrl('http://calendly.com/chatwithpete')?.url).toBe('https://calendly.com/chatwithpete');
  });

  it('drops a leading www. and lower-cases the host, but keeps path case', () => {
    expect(parseBookingUrl('https://www.calendly.com/chatwithpete')?.url).toBe('https://calendly.com/chatwithpete');
    expect(parseBookingUrl('HTTPS://CALENDLY.COM/ChatWithPete')?.url).toBe('https://calendly.com/ChatWithPete');
  });

  it('drops a trailing slash and a fragment', () => {
    expect(parseBookingUrl('https://calendly.com/chatwithpete/')?.url).toBe('https://calendly.com/chatwithpete');
    expect(parseBookingUrl('https://calendly.com/chatwithpete/30min#top')?.url).toBe(
      'https://calendly.com/chatwithpete/30min',
    );
  });

  it('ignores leading/trailing whitespace but rejects whitespace inside the value', () => {
    expect(parseBookingUrl('  https://calendly.com/chatwithpete  ')?.url).toBe('https://calendly.com/chatwithpete');
    expect(parseBookingUrl('https://calendly.com/peter bui')).toBeNull();
  });

  it('rejects a value over BOOKING_URL_MAX characters', () => {
    expect(parseBookingUrl(`https://calendly.com/${'a'.repeat(490)}`)).toBeNull();
  });

  it('rejects other schemes and protocol-relative URLs', () => {
    expect(parseBookingUrl('javascript:alert(1)')).toBeNull();
    expect(parseBookingUrl('data:text/html,<script>')).toBeNull();
    expect(parseBookingUrl('mailto:peter@example.com')).toBeNull();
    expect(parseBookingUrl('//calendly.com/chatwithpete')).toBeNull();
  });

  it('rejects credentials and a port in the authority', () => {
    expect(parseBookingUrl('https://user:pass@calendly.com/chatwithpete')).toBeNull();
    expect(parseBookingUrl('https://calendly.com:8443/chatwithpete')).toBeNull();
  });

  it('rejects look-alike hosts (never matches by suffix)', () => {
    expect(parseBookingUrl('https://calendly.com.evil.com/chatwithpete')).toBeNull();
    expect(parseBookingUrl('https://evilcalendly.com/chatwithpete')).toBeNull();
  });

  it('rejects unsafe characters in the path', () => {
    expect(parseBookingUrl('https://calendly.com/pe<ter')).toBeNull();
    expect(parseBookingUrl('https://calendly.com/pe"ter')).toBeNull();
  });

  it('rejects an unsupported host', () => {
    expect(parseBookingUrl('https://example.com/chatwithpete')).toBeNull();
  });

  it('resolves dot-segments before the reserved-word and segment-count checks', () => {
    // An un-resolved '../' would let a validated link's real destination (after normalization by any
    // RFC 3986-conformant client) be a reserved product page instead of the per-person page it claims to be.
    expect(parseBookingUrl('https://calendly.com/x/../app')).toBeNull();
    expect(parseBookingUrl('https://calendly.com/./app')).toBeNull();
    expect(parseBookingUrl('https://calendly.com/../app')).toBeNull();
    expect(parseBookingUrl('https://savvycal.com/./login')).toBeNull();
    expect(parseBookingUrl('https://tidycal.com/./dashboard')).toBeNull();
    // A percent-encoded dot-segment is resolved the same way.
    expect(parseBookingUrl('https://calendly.com/x/%2e%2e/app')).toBeNull();
    // No reserved word to bypass here, so it just canonicalises to its real (resolved) destination.
    expect(parseBookingUrl('https://outlook.office365.com/book/x/../y')).toEqual({
      provider: 'microsoft',
      url: 'https://outlook.office365.com/book/y',
    });
  });

  it('rejects a percent-encoded slash smuggling an extra path separator into a segment', () => {
    expect(parseBookingUrl('https://calendly.com/app%2Fxyz')).toBeNull();
    expect(parseBookingUrl('https://calendly.com/chatwithpete%2f30min')).toBeNull();
  });
});

describe('bookingProviderName', () => {
  it('names every provider', () => {
    expect(bookingProviderName('calendly')).toBe('Calendly');
    expect(bookingProviderName('google')).toBe('Google Calendar');
    expect(bookingProviderName('calcom')).toBe('Cal.com');
    expect(bookingProviderName('hubspot')).toBe('HubSpot');
    expect(bookingProviderName('microsoft')).toBe('Microsoft Bookings');
    expect(bookingProviderName('zoom')).toBe('Zoom Scheduler');
    expect(bookingProviderName('savvycal')).toBe('SavvyCal');
    expect(bookingProviderName('tidycal')).toBe('TidyCal');
  });
});

describe('suggestBookingLabel', () => {
  it('humanises the last path segment: separators and digit/letter boundaries', () => {
    expect(suggestBookingLabel('https://calendly.com/chatwithpete/crypto-chat')).toBe('Crypto chat');
    expect(suggestBookingLabel('https://calendly.com/chatwithpete/30min')).toBe('30 min');
    expect(suggestBookingLabel('https://meetings.hubspot.com/peter/intro_call')).toBe('Intro call');
  });

  it("falls back to 'Book a meeting' for a single-segment (user-page) link on any provider", () => {
    expect(suggestBookingLabel('https://calendly.com/chatwithpete')).toBe('Book a meeting');
    expect(suggestBookingLabel('https://cal.com/peter')).toBe('Book a meeting');
    expect(suggestBookingLabel('https://savvycal.com/peter')).toBe('Book a meeting');
    expect(suggestBookingLabel('https://tidycal.com/peter')).toBe('Book a meeting');
    expect(suggestBookingLabel('https://meetings.hubspot.com/peter')).toBe('Book a meeting');
    expect(suggestBookingLabel('https://scheduler.zoom.us/peter')).toBe('Book a meeting');
  });

  it("falls back to 'Book a meeting' for any Google or Microsoft link", () => {
    expect(suggestBookingLabel('https://calendar.app.google/AbC123')).toBe('Book a meeting');
    expect(suggestBookingLabel('https://calendar.google.com/calendar/appointments/schedules/AAxx1')).toBe(
      'Book a meeting',
    );
    expect(suggestBookingLabel('https://outlook.office365.com/book/SalesTeam')).toBe('Book a meeting');
  });

  it("falls back to 'Book a meeting' for an opaque id (long, no dash or underscore)", () => {
    const opaque = 'a'.repeat(25);
    expect(suggestBookingLabel(`https://cal.com/peter/${opaque}`)).toBe('Book a meeting');
    // Long but hyphenated is a real event slug, not an opaque id.
    expect(suggestBookingLabel(`https://cal.com/peter/${'a'.repeat(20)}-event-name`)).not.toBe('Book a meeting');
  });

  it('caps the label at BOOKING_LABEL_MAX and returns Book a meeting for an unparseable url', () => {
    const longSlug = 'word-'.repeat(20);
    expect(suggestBookingLabel(`https://cal.com/peter/${longSlug}`).length).toBeLessThanOrEqual(40);
    expect(suggestBookingLabel('not a booking link')).toBe('Book a meeting');
  });
});

describe('bookingOpenUrl', () => {
  it('returns the link url unchanged', () => {
    expect(bookingOpenUrl({ url: 'https://calendly.com/chatwithpete/30min', provider: 'calendly' })).toBe(
      'https://calendly.com/chatwithpete/30min',
    );
  });
});

describe('bookingEmbedUrl', () => {
  const embedDomain = 'chatsoon.app';

  it('builds an embed URL for Calendly, the Google schedules form and HubSpot', () => {
    expect(bookingEmbedUrl({ url: 'https://calendly.com/chatwithpete/30min', provider: 'calendly' }, embedDomain)).toBe(
      'https://calendly.com/chatwithpete/30min?embed_domain=chatsoon.app&embed_type=Inline',
    );
    expect(
      bookingEmbedUrl(
        { url: 'https://calendar.google.com/calendar/appointments/schedules/AAxx1', provider: 'google' },
        embedDomain,
      ),
    ).toBe('https://calendar.google.com/calendar/appointments/schedules/AAxx1?gv=true');
    expect(bookingEmbedUrl({ url: 'https://meetings.hubspot.com/peter', provider: 'hubspot' }, embedDomain)).toBe(
      'https://meetings.hubspot.com/peter?embed=true',
    );
  });

  it('returns null for a calendar.app.google short link and every other provider', () => {
    expect(bookingEmbedUrl({ url: 'https://calendar.app.google/AbC123', provider: 'google' }, embedDomain)).toBeNull();
    expect(bookingEmbedUrl({ url: 'https://cal.com/peter', provider: 'calcom' }, embedDomain)).toBeNull();
    expect(bookingEmbedUrl({ url: 'https://outlook.office365.com/book/SalesTeam', provider: 'microsoft' }, embedDomain)).toBeNull();
    expect(bookingEmbedUrl({ url: 'https://scheduler.zoom.us/peter', provider: 'zoom' }, embedDomain)).toBeNull();
    expect(bookingEmbedUrl({ url: 'https://savvycal.com/peter', provider: 'savvycal' }, embedDomain)).toBeNull();
    expect(bookingEmbedUrl({ url: 'https://tidycal.com/peter', provider: 'tidycal' }, embedDomain)).toBeNull();
  });
});

describe('bookingLinkInputSchema', () => {
  it('canonicalises the url and fills in a missing or empty label', () => {
    expect(
      bookingLinkInputSchema.parse({ url: 'https://calendly.com/chatwithpete/crypto-chat?back=1&month=2026-09' }),
    ).toEqual({ url: 'https://calendly.com/chatwithpete/crypto-chat', label: 'Crypto chat' });
    expect(
      bookingLinkInputSchema.parse({ url: 'https://calendly.com/chatwithpete/30min?back=1&month=2026-09', label: '   ' }),
    ).toEqual({ url: 'https://calendly.com/chatwithpete/30min', label: '30 min' });
  });

  it('keeps a label the user typed', () => {
    expect(bookingLinkInputSchema.parse({ url: 'https://cal.com/peter/30min', label: 'Quick chat' })).toEqual({
      url: 'https://cal.com/peter/30min',
      label: 'Quick chat',
    });
  });

  it('rejects a url that does not parse, with the BOOKING_URL_HINT message on the url field', () => {
    const result = bookingLinkInputSchema.safeParse({ url: 'https://example.com/not-a-booking-link' });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['url']);
    expect(result.error?.issues[0]?.message).toBe(BOOKING_URL_HINT);
  });

  it('rejects an offensive label even when the url is fine', () => {
    const result = bookingLinkInputSchema.safeParse({ url: 'https://cal.com/peter', label: 'fuck off' });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(OFFENSIVE);
  });

  it('rejects an offensive url', () => {
    const result = bookingLinkInputSchema.safeParse({ url: 'https://cal.com/fuckyou' });
    expect(result.success).toBe(false);
    expect(result.error?.issues.some((i) => i.message === OFFENSIVE)).toBe(true);
  });
});

describe('bookingLinksSchema', () => {
  it('allows up to MAX_BOOKING_LINKS and rejects one more with the fixed message', () => {
    const five = Array.from({ length: 5 }, (_, i) => ({ url: `https://cal.com/peter/event-${i}` }));
    expect(bookingLinksSchema.parse(five)).toHaveLength(5);

    const six = [...five, { url: 'https://cal.com/peter/event-6' }];
    const result = bookingLinksSchema.safeParse(six);
    expect(result.success).toBe(false);
    expect(result.error?.issues.some((i) => i.message === 'Add up to 5 booking links')).toBe(true);
  });

  it('flags a duplicate canonical url on the second occurrence', () => {
    const result = bookingLinksSchema.safeParse([
      { url: 'https://calendly.com/chatwithpete/30min' },
      { url: 'calendly.com/chatwithpete/30min?ref=card' },
    ]);
    expect(result.success).toBe(false);
    expect(result.error?.issues).toContainEqual(
      expect.objectContaining({ path: [1, 'url'], message: "You've added this booking link already" }),
    );
  });

  it('does not flag two different links', () => {
    expect(
      bookingLinksSchema.parse([{ url: 'https://cal.com/peter/crypto-chat' }, { url: 'https://cal.com/peter/30min' }]),
    ).toHaveLength(2);
  });

  it('flags a duplicate hidden behind an un-resolved dot-segment', () => {
    const result = bookingLinksSchema.safeParse([
      { url: 'https://cal.com/peter/30min' },
      { url: 'https://cal.com/peter/x/../30min' },
    ]);
    expect(result.success).toBe(false);
    expect(result.error?.issues).toContainEqual(
      expect.objectContaining({ path: [1, 'url'], message: "You've added this booking link already" }),
    );
  });
});

describe('profileInputSchema.bookingLinks', () => {
  const base = { displayName: 'Peter Bui' };

  it('is optional, so omitting it parses fine', () => {
    expect(profileInputSchema.parse(base).bookingLinks).toBeUndefined();
  });

  it('accepts an empty array (clears the links) and a populated one', () => {
    expect(profileInputSchema.parse({ ...base, bookingLinks: [] }).bookingLinks).toEqual([]);
    expect(
      profileInputSchema.parse({ ...base, bookingLinks: [{ url: 'https://cal.com/peter/30min' }] }).bookingLinks,
    ).toEqual([{ url: 'https://cal.com/peter/30min', label: '30 min' }]);
  });
});
