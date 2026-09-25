import { describe, expect, it } from 'vitest';

import {
  LINK_KEYS,
  LINK_PREFIXES,
  canonicalLinkValue,
  cleanText,
  displayLink,
  isEmail,
  isTelegramHandle,
  isXHandle,
  linkFieldValue,
  linkLabel,
  linkedInProfileUrl,
  normalizeHandle,
  parseSocialUrl,
  profileSlugFromUrl,
  stripTrackingParams,
  toLinkUrl,
} from './links';

describe('normalizeHandle', () => {
  it.each([
    ['peter', 'peter'],
    ['  @peter  ', 'peter'],
    ['@@peter', 'peter'],
    ['t.me/peter', 'peter'],
    ['https://t.me/peter', 'peter'],
    ['http://www.t.me/peter/', 'peter'],
    ['telegram.me/peter', 'peter'],
    ['https://telegram.dog/peter', 'peter'],
    ['https://t.me/s/durov', 'durov'],
    ['https://t.me/peter?start=hello', 'peter'],
    ['tg://resolve?domain=peter&start=abc', 'peter'],
    ['x.com/peter', 'peter'],
    ['https://x.com/peter?s=21', 'peter'],
    ['https://twitter.com/peter?s=09#top', 'peter'],
    ['https://www.twitter.com/@peter', 'peter'],
    ['https://mobile.twitter.com/peter', 'peter'],
    ['HTTPS://X.COM/PeterBui', 'PeterBui'],
    ['https://x.com/peter/status/123', 'peter'],
    ['https://x.com/intent/user?screen_name=peter', 'peter'],
    ['twitter://user?screen_name=peter', 'peter'],
    ['peter/', 'peter'],
    ['peter?ref=card', 'peter'],
    ['\u200Bpeter\uFEFF', 'peter'],
    ['https://peterbui.t.me', 'peterbui'],
    ['peterbui.t.me/', 'peterbui'],
  ])('%j -> %j', (input, expected) => {
    expect(normalizeHandle(input)).toBe(expected);
  });

  it('keeps the case the user typed', () => {
    expect(normalizeHandle('@PeterBui')).toBe('PeterBui');
  });

  it('returns an empty string for empty input or a bare domain', () => {
    expect(normalizeHandle('')).toBe('');
    expect(normalizeHandle('   ')).toBe('');
    expect(normalizeHandle('@')).toBe('');
    expect(normalizeHandle('https://t.me/')).toBe('');
  });

  it('does not treat look-alike domains as known prefixes', () => {
    expect(normalizeHandle('x.company/peter')).toBe('x.company/peter');
    expect(normalizeHandle('https://twitter.com.evil.io/peter')).toBe('https://twitter.com.evil.io/peter');
  });
});

describe('handle validators', () => {
  it('validates X handles', () => {
    expect(isXHandle('peter_bui')).toBe(true);
    expect(isXHandle('ev')).toBe(true);
    expect(isXHandle('a'.repeat(15))).toBe(true);
    expect(isXHandle('a'.repeat(16))).toBe(false);
    expect(isXHandle('peter.bui')).toBe(false);
    expect(isXHandle('Peter Bui')).toBe(false);
    expect(isXHandle('')).toBe(false);
  });

  it('validates Telegram usernames', () => {
    expect(isTelegramHandle('durov')).toBe(true);
    expect(isTelegramHandle('peter_bui_bot')).toBe(true);
    expect(isTelegramHandle('jobs')).toBe(true);
    expect(isTelegramHandle('abc')).toBe(false);
    expect(isTelegramHandle('1peter')).toBe(false);
    expect(isTelegramHandle('a'.repeat(33))).toBe(false);
    expect(isTelegramHandle('peter-bui')).toBe(false);
  });
});

describe('isEmail', () => {
  it.each([
    'peter@example.com',
    'peter.bui+events@example.co.uk',
    'PETER@EXAMPLE.COM',
    "o'connor@example.ie",
    'hello@chatsoon.app',
    'user@sub.domain.xn--p1ai',
    '  peter@example.com  ',
  ])('accepts %j', (value) => {
    expect(isEmail(value)).toBe(true);
  });

  it.each([
    '',
    'peter',
    'peter@',
    '@example.com',
    'peter@example',
    'peter@@example.com',
    'peter bui@example.com',
    '.peter@example.com',
    'peter.@example.com',
    'pe..ter@example.com',
    'peter@-example.com',
    'peter@example.c',
    'mailto:peter@example.com',
    `${'a'.repeat(65)}@example.com`,
  ])('rejects %j', (value) => {
    expect(isEmail(value)).toBe(false);
  });

  it.each([
    'you?bcc=them@evil.com',
    'you&cc=them@evil.com',
    'a=b@example.com',
    'a#b@example.com',
    'a%40b@example.com',
    'a/b@example.com',
    "peter'@example.com",
    '"peter bui"@example.com',
  ])('rejects %j, which the app form would reject or a mailto: link would misread', (value) => {
    expect(isEmail(value)).toBe(false);
  });
});

describe('toLinkUrl', () => {
  it('returns null for empty values', () => {
    for (const key of [...LINK_KEYS, 'email', 'phone'] as const) {
      expect(toLinkUrl(key, null)).toBeNull();
      expect(toLinkUrl(key, undefined)).toBeNull();
      expect(toLinkUrl(key, '')).toBeNull();
      expect(toLinkUrl(key, '   ')).toBeNull();
    }
  });

  describe('x', () => {
    it.each([
      ['peterbui', 'https://x.com/peterbui'],
      ['@peterbui', 'https://x.com/peterbui'],
      ['https://twitter.com/peterbui', 'https://x.com/peterbui'],
      ['x.com/peterbui?s=21', 'https://x.com/peterbui'],
    ])('%j -> %j', (value, expected) => {
      expect(toLinkUrl('x', value)).toBe(expected);
    });

    it.each(['Peter Bui', 'peter.bui', 'https://instagram.com/peter', 'javascript:alert(1)', '@'])(
      'rejects %j',
      (value) => {
        expect(toLinkUrl('x', value)).toBeNull();
      },
    );

    it.each(['https://x.com/home', 'https://twitter.com/intent/tweet?text=hi', 'x.com/search?q=chatsoon', 'x.com/i/flow/login'])(
      'rejects the X page %j',
      (value) => {
        expect(toLinkUrl('x', value)).toBeNull();
      },
    );

    it.each(['t.me/peterbui', 'https://telegram.me/peterbui', 'tg://resolve?domain=peterbui', 'https://peterbui.t.me'])(
      'rejects the Telegram link %j',
      (value) => {
        expect(toLinkUrl('x', value)).toBeNull();
      },
    );

    it('keeps profiles reached through intent links and the author of a post', () => {
      expect(toLinkUrl('x', 'https://x.com/intent/user?screen_name=peterbui')).toBe('https://x.com/peterbui');
      expect(toLinkUrl('x', 'https://x.com/peterbui/status/1790000000000000000')).toBe('https://x.com/peterbui');
    });
  });

  describe('telegram', () => {
    it.each([
      ['peterbui', 'https://t.me/peterbui'],
      ['@peterbui', 'https://t.me/peterbui'],
      ['https://t.me/peterbui', 'https://t.me/peterbui'],
      ['telegram.me/peterbui', 'https://t.me/peterbui'],
      ['tg://resolve?domain=peterbui', 'https://t.me/peterbui'],
      ['https://peterbui.t.me', 'https://t.me/peterbui'],
    ])('%j -> %j', (value, expected) => {
      expect(toLinkUrl('telegram', value)).toBe(expected);
    });

    it.each([
      'pb',
      'peter bui',
      '+61412345678',
      'https://t.me/+AbCdEfGh',
      'peter@example.com',
      'https://t.me/joinchat/AAAAAEkk2WdoDrB4-Q8-gg',
      't.me/share/url?url=https://chatsoon.app',
      'https://t.me/addstickers/Animals',
      'https://x.com/peterbui',
      'twitter://user?screen_name=peterbui',
    ])('rejects %j', (value) => {
      expect(toLinkUrl('telegram', value)).toBeNull();
    });
  });

  describe('linkedin', () => {
    it.each([
      ['https://www.linkedin.com/in/peter-bui', 'https://www.linkedin.com/in/peter-bui'],
      ['http://linkedin.com/in/peter-bui/', 'https://www.linkedin.com/in/peter-bui'],
      ['linkedin.com/in/peter-bui', 'https://www.linkedin.com/in/peter-bui'],
      ['au.linkedin.com/in/peter-bui', 'https://www.linkedin.com/in/peter-bui'],
      [
        'https://www.linkedin.com/in/peter-bui?utm_source=share&utm_medium=ios_app',
        'https://www.linkedin.com/in/peter-bui',
      ],
      ['https://www.linkedin.com/company/moshi-concepts', 'https://www.linkedin.com/company/moshi-concepts'],
      ['https://lnkd.in/gAbC123', 'https://lnkd.in/gAbC123'],
      ['peter-bui', 'https://www.linkedin.com/in/peter-bui'],
      ['@peter-bui', 'https://www.linkedin.com/in/peter-bui'],
      ['in/peter-bui', 'https://www.linkedin.com/in/peter-bui'],
      ['张伟', 'https://www.linkedin.com/in/%E5%BC%A0%E4%BC%9F'],
      ['%E5%BC%A0%E4%BC%9F', 'https://www.linkedin.com/in/%E5%BC%A0%E4%BC%9F'],
    ])('%j -> %j', (value, expected) => {
      expect(toLinkUrl('linkedin', value)).toBe(expected);
    });

    it.each([
      'https://example.com/in/peter',
      'peter bui',
      'javascript:alert(1)',
      'peter@example.com',
      'https://www.linkedin.com/in/<script>',
      'x',
      'https://www.linkedin.com/',
      'linkedin.com',
      'https://lnkd.in',
      '%%',
      'peter%zz',
    ])('rejects %j', (value) => {
      expect(toLinkUrl('linkedin', value)).toBeNull();
    });
  });

  describe('website', () => {
    it.each([
      ['example.com', 'https://example.com'],
      ['www.example.com', 'https://www.example.com'],
      ['https://example.com', 'https://example.com'],
      ['http://example.com/about?x=1#team', 'http://example.com/about?x=1#team'],
      ['HTTPS://Example.COM/Path', 'https://example.com/Path'],
      ['example.com:8080/app', 'https://example.com:8080/app'],
      ['//example.com', 'https://example.com'],
      ['münchen.de', 'https://münchen.de'],
      ['  moshiconcepts.com  ', 'https://moshiconcepts.com'],
    ])('%j -> %j', (value, expected) => {
      expect(toLinkUrl('website', value)).toBe(expected);
    });

    it.each([
      'javascript:alert(1)',
      'JavaScript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox',
      'file:///etc/passwd',
      'mailto:peter@example.com',
      'ftp://example.com',
      'https://user:pass@example.com',
      'https://example.com@evil.com',
      'peter@example.com',
      'localhost',
      'http://',
      'hello world',
      'example',
      'https://example.com/<script>',
      'https://-bad-.com',
      'http://192.168.0.1',
      'http:example.com',
    ])('rejects %j', (value) => {
      expect(toLinkUrl('website', value)).toBeNull();
    });
  });

  describe('youtube', () => {
    it.each([
      ['@peterbui', 'https://www.youtube.com/@peterbui'],
      ['@peter.bui', 'https://www.youtube.com/@peter.bui'],
      ['peterbui', 'https://www.youtube.com/@peterbui'],
      ['youtube.com/@peterbui', 'https://youtube.com/@peterbui'],
      ['https://www.youtube.com/channel/UC123', 'https://www.youtube.com/channel/UC123'],
      ['youtu.be/dQw4w9WgXcQ', 'https://youtu.be/dQw4w9WgXcQ'],
      ['@peter_bui-99', 'https://www.youtube.com/@peter_bui-99'],
      ['@ヤマダ', 'https://www.youtube.com/@%E3%83%A4%E3%83%9E%E3%83%80'],
    ])('%j -> %j', (value, expected) => {
      expect(toLinkUrl('youtube', value)).toBe(expected);
    });

    it.each(['@', '@peter bui', 'javascript:alert(1)', '@peter/videos', '@peter%bui', "@peter'bui", '@peter　bui'])(
      'rejects %j',
      (value) => {
        expect(toLinkUrl('youtube', value)).toBeNull();
      },
    );
  });

  describe('email', () => {
    it('makes mailto links', () => {
      expect(toLinkUrl('email', 'peter@example.com')).toBe('mailto:peter@example.com');
      expect(toLinkUrl('email', ' mailto:peter@example.com ')).toBe('mailto:peter@example.com');
    });

    it('rejects junk', () => {
      expect(toLinkUrl('email', 'peter')).toBeNull();
      expect(toLinkUrl('email', 'peter@example.com?bcc=x@y.com')).toBeNull();
    });

    it('never builds a mailto: link that adds recipients or headers', () => {
      expect(toLinkUrl('email', 'you?bcc=them@evil.com')).toBeNull();
      expect(toLinkUrl('email', 'mailto:you&cc=them@evil.com')).toBeNull();
    });
  });

  describe('phone', () => {
    it.each([
      ['+61 412 345 678', 'tel:+61412345678'],
      ['+61 (0) 412 345 678', 'tel:+61412345678'],
      ['(02) 9876 5432', 'tel:0298765432'],
      ['+1-555-123-4567', 'tel:+15551234567'],
      ['+1 555.123.4567 ext. 89', 'tel:+15551234567'],
      ['+1 555 123 4567 x89', 'tel:+15551234567'],
      ['tel:+65%206123%204567', 'tel:+6561234567'],
      ['tel:+1-555-123-4567;ext=12', 'tel:+15551234567'],
      ['000', 'tel:000'],
      ['(+61) 412 345 678', 'tel:+61412345678'],
      ['( +65 ) 6123 4567', 'tel:+6561234567'],
      ['+61 412 345 678,,123', 'tel:+61412345678'],
    ])('%j -> %j', (value, expected) => {
      expect(toLinkUrl('phone', value)).toBe(expected);
    });

    it.each(['call me', '12', '1-800-FLOWERS', '+', '1234567890123456789', `+61 ${' '.repeat(200)}412`])('rejects %j', (value) => {
      expect(toLinkUrl('phone', value)).toBeNull();
    });
  });
});

describe('linkLabel', () => {
  it('labels every link field', () => {
    expect(linkLabel('x')).toBe('X');
    expect(linkLabel('telegram')).toBe('Telegram');
    expect(linkLabel('linkedin')).toBe('LinkedIn');
    expect(linkLabel('website')).toBe('Website');
    expect(linkLabel('youtube')).toBe('YouTube');
    expect(linkLabel('email')).toBe('Email');
    expect(linkLabel('phone')).toBe('Phone');
  });

  it('lists the profile link keys in display order', () => {
    expect(LINK_KEYS).toEqual(['x', 'telegram', 'linkedin', 'website', 'youtube']);
  });
});

describe('displayLink', () => {
  it.each([
    ['x', 'https://x.com/peterbui', '@peterbui'],
    ['telegram', 't.me/peterbui', '@peterbui'],
    ['linkedin', 'https://www.linkedin.com/in/peter-bui/', 'linkedin.com/in/peter-bui'],
    ['website', 'https://www.example.com/', 'example.com'],
    ['website', 'example.com/about', 'example.com/about'],
    ['youtube', '@peterbui', 'youtube.com/@peterbui'],
    ['email', 'peter@example.com', 'peter@example.com'],
    ['phone', '+61 412 345 678', '+61 412 345 678'],
    ['linkedin', '张伟', 'linkedin.com/in/张伟'],
  ] as const)('%s %j -> %j', (key, value, expected) => {
    expect(displayLink(key, value)).toBe(expected);
  });

  it('returns null when there is no valid link', () => {
    expect(displayLink('website', 'javascript:alert(1)')).toBeNull();
    expect(displayLink('x', '')).toBeNull();
    expect(displayLink('email', null)).toBeNull();
  });
});

describe('profileSlugFromUrl', () => {
  it.each([
    'https://chatsoon.app/id/peter-bui-7f3a',
    'http://chatsoon.app/id/peter-bui-7f3a',
    'https://www.chatsoon.app/id/peter-bui-7f3a',
    'https://chatsoon.app/id/peter-bui-7f3a/',
    'https://chatsoon.app/id/peter-bui-7f3a?ref=qr',
    'https://chatsoon.app/id/peter-bui-7f3a#connect',
    'chatsoon.app/id/peter-bui-7f3a',
    'HTTPS://CHATSOON.APP/ID/PETER-BUI-7F3A',
    'chatsoon://id/peter-bui-7f3a',
    'chatsoon:///id/peter-bui-7f3a',
    '  https://chatsoon.app/id/peter-bui-7f3a\n',
  ])('%j -> peter-bui-7f3a', (value) => {
    expect(profileSlugFromUrl(value)).toBe('peter-bui-7f3a');
  });

  it.each([
    'https://chatsoon.app/id/',
    'https://chatsoon.app/id/peter_bui',
    'https://chatsoon.app/id/peter-bui/extra',
    'https://chatsoon.app/privacy',
    'https://chatsoon.app.evil.com/id/peter-bui',
    'https://evilchatsoon.app/id/peter-bui',
    'https://example.com/id/peter-bui',
    'chatsoon://contact/peter-bui',
    'otherapp://id/peter-bui',
    `https://chatsoon.app/id/${'a'.repeat(101)}`,
  ])('rejects %j', (value) => {
    expect(profileSlugFromUrl(value)).toBeNull();
  });
});

describe('parseSocialUrl', () => {
  it.each([
    ['https://t.me/peterbui', { network: 'telegram', handle: 'peterbui' }],
    ['t.me/peterbui', { network: 'telegram', handle: 'peterbui' }],
    ['https://telegram.me/peterbui', { network: 'telegram', handle: 'peterbui' }],
    ['https://peterbui.t.me', { network: 'telegram', handle: 'peterbui' }],
    ['tg://resolve?domain=peterbui', { network: 'telegram', handle: 'peterbui' }],
    ['https://x.com/peterbui', { network: 'x', handle: 'peterbui' }],
    ['https://twitter.com/peterbui?s=21', { network: 'x', handle: 'peterbui' }],
    ['https://twitter.com/intent/follow?screen_name=peterbui', { network: 'x', handle: 'peterbui' }],
    ['twitter://user?screen_name=peterbui', { network: 'x', handle: 'peterbui' }],
    ['https://www.linkedin.com/in/peter-bui', { network: 'linkedin', url: 'https://www.linkedin.com/in/peter-bui' }],
    ['https://linkedin.com/comm/in/peter-bui', { network: 'linkedin', url: 'https://www.linkedin.com/in/peter-bui' }],
    [
      'https://www.linkedin.com/in/peter-bui/details/experience/',
      { network: 'linkedin', url: 'https://www.linkedin.com/in/peter-bui' },
    ],
    [
      'https://www.linkedin.com/pub/peter-bui/12/345/678',
      { network: 'linkedin', url: 'https://www.linkedin.com/pub/peter-bui/12/345/678' },
    ],
  ])('%j', (value, expected) => {
    expect(parseSocialUrl(value)).toEqual(expected);
  });

  it.each([
    'https://t.me/joinchat/AAAAAEkk2WdoDrB4-Q8-gg',
    'https://t.me/+AbCdEfGhIjk',
    'https://t.me/+61412345678',
    'https://t.me/s/durov',
    'https://t.me/c/1234567/89',
    'https://t.me/addstickers/Animals',
    'https://t.me/share/url?url=https://example.com',
    'https://t.me/abc',
    'https://x.com/home',
    'https://x.com/i/flow/login',
    'https://x.com/search?q=chatsoon',
    'https://x.com/hashtag/Token2049',
    'https://x.com/intent/tweet?text=hi',
    'https://x.com/share?url=https://example.com',
    'https://x.com/peterbui/status/1234567890',
    'https://x.com/explore',
    'https://www.linkedin.com/company/moshi-concepts',
    'https://www.linkedin.com/feed/',
    'https://lnkd.in/gAbC123',
    'https://example.com/in/peter',
    'https://t.me/peter bui',
    '',
  ])('rejects %j', (value) => {
    expect(parseSocialUrl(value)).toBeNull();
  });
});

describe('linkedInProfileUrl', () => {
  it('keeps percent-encoded ids and encodes raw non-ASCII ones', () => {
    expect(linkedInProfileUrl('https://www.linkedin.com/in/%E5%BC%A0%E4%BC%9F-123')).toBe(
      'https://www.linkedin.com/in/%E5%BC%A0%E4%BC%9F-123',
    );
    expect(linkedInProfileUrl('https://cn.linkedin.com/in/张伟')).toBe('https://www.linkedin.com/in/%E5%BC%A0%E4%BC%9F');
  });
});

describe('cleanText', () => {
  it('trims whitespace and zero-width characters but keeps inner spacing', () => {
    expect(cleanText('\uFEFF\u200B  Peter  Bui \n')).toBe('Peter  Bui');
    expect(cleanText('\u00A0\u2060\t\r\n')).toBe('');
    expect(cleanText('peter')).toBe('peter');
  });

  it('stays linear on long inner runs of whitespace (a hostile QR or paste)', () => {
    const value = `a${' '.repeat(100_000)}b`;
    const start = Date.now();
    expect(cleanText(`  ${value}  `)).toBe(value);
    expect(normalizeHandle(value)).toBe(value);
    expect(toLinkUrl('website', value)).toBeNull();
    expect(Date.now() - start).toBeLessThan(1000);
  });
});

describe('LINK_PREFIXES', () => {
  it('has a fixed prefix for every handle network, and none for website', () => {
    expect(LINK_PREFIXES).toEqual({
      x: 'x.com/',
      telegram: 't.me/',
      linkedin: 'linkedin.com/in/',
      youtube: 'youtube.com/@',
    });
    expect(LINK_PREFIXES.website).toBeUndefined();
  });
});

describe('stripTrackingParams', () => {
  it.each([
    ['https://example.com/?utm_source=x&utm_medium=y', 'https://example.com/'],
    ['example.com/?utm_source=x', 'example.com/'],
    ['https://example.com/page?a=1&utm_campaign=z&b=2', 'https://example.com/page?a=1&b=2'],
    ['https://example.com/page?UTM_Source=x', 'https://example.com/page'],
    ['https://example.com/?fbclid=abc', 'https://example.com/'],
    ['https://example.com/?gclid=abc', 'https://example.com/'],
    ['https://example.com/?dclid=abc', 'https://example.com/'],
    ['https://example.com/?msclkid=abc', 'https://example.com/'],
    ['https://example.com/?mc_cid=1&mc_eid=2', 'https://example.com/'],
    ['https://example.com/?igshid=abc', 'https://example.com/'],
    ['https://youtube.com/watch?v=123&si=abc', 'https://youtube.com/watch?v=123'],
    ['https://open.spotify.com/track/1?si=abc', 'https://open.spotify.com/track/1'],
    ['https://instagram.com/p/1?igsh=abc', 'https://instagram.com/p/1'],
    ['https://www.linkedin.com/in/peter?trk=x&trackingId=y&lipi=z&originalSubdomain=au', 'https://www.linkedin.com/in/peter'],
    ['https://example.com/?ref_src=twsrc&ref_url=https://x.com', 'https://example.com/'],
    ['https://x.com/peter?s=20', 'https://x.com/peter'],
    ['https://twitter.com/peter?t=abc&s=09', 'https://twitter.com/peter'],
    ['https://www.x.com/peter?s=20', 'https://www.x.com/peter'],
    ['https://mobile.twitter.com/peter?s=20', 'https://mobile.twitter.com/peter'],
    // 's' and 't' are only special-cased for X - a website keeps them.
    ['https://example.com/?s=20&t=abc', 'https://example.com/?s=20&t=abc'],
    // Non-tracking params and the hash survive.
    ['https://example.com/?a=1&utm_source=x#section', 'https://example.com/?a=1#section'],
    ['https://example.com/#utm_source=x', 'https://example.com/#utm_source=x'],
    // No query at all: unchanged.
    ['https://example.com/page', 'https://example.com/page'],
    ['peter', 'peter'],
    ['', ''],
  ])('%j -> %j', (input, expected) => {
    expect(stripTrackingParams(input)).toBe(expected);
  });

  it('never throws on unparseable input', () => {
    expect(stripTrackingParams('?a=1')).toBe('?a=1');
    expect(stripTrackingParams('not a url at all')).toBe('not a url at all');
    expect(() => stripTrackingParams('%%%')).not.toThrow();
  });

  it('does not add a scheme the caller did not type', () => {
    expect(stripTrackingParams('example.com/?utm_source=x')).not.toMatch(/^https?:\/\//);
  });
});

describe('linkFieldValue', () => {
  it('gives an empty handle for empty input', () => {
    for (const key of LINK_KEYS) expect(linkFieldValue(key, '')).toEqual({ mode: 'handle', handle: '' });
    for (const key of LINK_KEYS) expect(linkFieldValue(key, null)).toEqual({ mode: 'handle', handle: '' });
    for (const key of LINK_KEYS) expect(linkFieldValue(key, undefined)).toEqual({ mode: 'handle', handle: '' });
  });

  describe('x', () => {
    it.each([
      ['peterbui', 'peterbui'],
      ['@peterbui', 'peterbui'],
      ['https://x.com/peterbui', 'peterbui'],
      ['https://twitter.com/peterbui?s=21', 'peterbui'],
      ['https://mobile.twitter.com/peterbui', 'peterbui'],
    ])('%j -> handle %j', (stored, handle) => {
      expect(linkFieldValue('x', stored)).toEqual({ mode: 'handle', handle });
    });

    it('falls back to url mode for a reserved page or a Telegram link', () => {
      expect(linkFieldValue('x', 'https://x.com/home')).toEqual({ mode: 'url', url: 'https://x.com/home' });
      expect(linkFieldValue('x', 't.me/peterbui')).toEqual({ mode: 'url', url: 't.me/peterbui' });
    });
  });

  describe('telegram', () => {
    it.each([
      ['peterbui', 'peterbui'],
      ['@peterbui', 'peterbui'],
      ['https://t.me/peterbui', 'peterbui'],
      ['https://telegram.me/peterbui', 'peterbui'],
    ])('%j -> handle %j', (stored, handle) => {
      expect(linkFieldValue('telegram', stored)).toEqual({ mode: 'handle', handle });
    });

    it('falls back to url mode for a reserved path or an X link', () => {
      expect(linkFieldValue('telegram', 'https://t.me/joinchat/AAAAAEkk2WdoDrB4-Q8-gg')).toEqual({
        mode: 'url',
        url: 'https://t.me/joinchat/AAAAAEkk2WdoDrB4-Q8-gg',
      });
      expect(linkFieldValue('telegram', 'https://x.com/peterbui')).toEqual({
        mode: 'url',
        url: 'https://x.com/peterbui',
      });
    });
  });

  describe('linkedin', () => {
    it.each([
      ['https://www.linkedin.com/in/peter-bui', 'peter-bui'],
      ['https://www.linkedin.com/in/peter-bui/', 'peter-bui'],
      ['linkedin.com/in/peter-bui', 'peter-bui'],
      ['peter-bui', 'peter-bui'],
      ['@peter-bui', 'peter-bui'],
      ['张伟', '张伟'],
      ['https://cn.linkedin.com/in/%E5%BC%A0%E4%BC%9F', '张伟'],
    ])('%j -> handle %j', (stored, handle) => {
      expect(linkFieldValue('linkedin', stored)).toEqual({ mode: 'handle', handle });
    });

    it('falls back to url mode for a company page or a /pub/ url', () => {
      expect(linkFieldValue('linkedin', 'https://www.linkedin.com/company/moshi-concepts')).toEqual({
        mode: 'url',
        url: 'https://www.linkedin.com/company/moshi-concepts',
      });
      expect(linkFieldValue('linkedin', 'https://www.linkedin.com/pub/peter-bui/12/345/678')).toEqual({
        mode: 'url',
        url: 'https://www.linkedin.com/pub/peter-bui/12/345/678',
      });
    });
  });

  describe('youtube', () => {
    it.each([
      ['@peterbui', 'peterbui'],
      ['peterbui', 'peterbui'],
      ['youtube.com/@peterbui', 'peterbui'],
      ['https://www.youtube.com/@peterbui', 'peterbui'],
      ['https://m.youtube.com/@peterbui', 'peterbui'],
      ['https://youtube.com/@peterbui/', 'peterbui'],
    ])('%j -> handle %j', (stored, handle) => {
      expect(linkFieldValue('youtube', stored)).toEqual({ mode: 'handle', handle });
    });

    it('falls back to url mode for a channel or /c/ url', () => {
      expect(linkFieldValue('youtube', 'https://www.youtube.com/channel/UC123')).toEqual({
        mode: 'url',
        url: 'https://www.youtube.com/channel/UC123',
      });
      expect(linkFieldValue('youtube', 'https://www.youtube.com/c/PeterBui')).toEqual({
        mode: 'url',
        url: 'https://www.youtube.com/c/PeterBui',
      });
    });
  });

  it('is always url mode for website', () => {
    expect(linkFieldValue('website', 'example.com')).toEqual({ mode: 'url', url: 'example.com' });
  });
});

describe('canonicalLinkValue', () => {
  it('keeps an empty string empty', () => {
    for (const key of LINK_KEYS) expect(canonicalLinkValue(key, '')).toBe('');
    for (const key of LINK_KEYS) expect(canonicalLinkValue(key, '   ')).toBe('');
  });

  describe('x', () => {
    it.each([
      ['peterbui', 'peterbui'],
      ['@peterbui', 'peterbui'],
      ['ChatSoonApp', 'ChatSoonApp'],
      ['https://x.com/ChatSoonApp?s=20', 'ChatSoonApp'],
      ['https://twitter.com/peterbui', 'peterbui'],
      ['https://mobile.twitter.com/peterbui?s=09', 'peterbui'],
      ['https://x.com/peterbui/', 'peterbui'],
    ])('%j -> %j', (input, expected) => {
      expect(canonicalLinkValue('x', input)).toBe(expected);
    });

    it('keeps an unreduced value cleaned but as entered', () => {
      expect(canonicalLinkValue('x', 'https://x.com/home')).toBe('https://x.com/home');
      expect(canonicalLinkValue('x', 'https://instagram.com/peter')).toBe('https://instagram.com/peter');
      expect(canonicalLinkValue('x', 'Peter Bui')).toBe('Peter Bui');
    });
  });

  describe('telegram', () => {
    it.each([
      ['peterbui', 'peterbui'],
      ['@peterbui', 'peterbui'],
      ['name', 'name'],
      ['https://t.me/peterbui', 'peterbui'],
      ['telegram.me/peterbui', 'peterbui'],
      ['https://peterbui.t.me', 'peterbui'],
    ])('%j -> %j', (input, expected) => {
      expect(canonicalLinkValue('telegram', input)).toBe(expected);
    });

    it('keeps an unreduced value cleaned but as entered', () => {
      expect(canonicalLinkValue('telegram', 'https://t.me/joinchat/AAAAAEkk2WdoDrB4-Q8-gg')).toBe(
        'https://t.me/joinchat/AAAAAEkk2WdoDrB4-Q8-gg',
      );
    });
  });

  describe('linkedin', () => {
    it.each([
      ['peter-bui', 'https://www.linkedin.com/in/peter-bui'],
      ['@peter-bui', 'https://www.linkedin.com/in/peter-bui'],
      ['https://www.linkedin.com/in/peter-bui', 'https://www.linkedin.com/in/peter-bui'],
      ['https://www.linkedin.com/in/peter-bui/', 'https://www.linkedin.com/in/peter-bui'],
      [
        'https://www.linkedin.com/in/peter-bui?utm_source=share&utm_medium=ios_app&trk=x',
        'https://www.linkedin.com/in/peter-bui',
      ],
      ['au.linkedin.com/in/peter-bui', 'https://www.linkedin.com/in/peter-bui'],
      ['张伟', 'https://www.linkedin.com/in/%E5%BC%A0%E4%BC%9F'],
    ])('%j -> %j', (input, expected) => {
      expect(canonicalLinkValue('linkedin', input)).toBe(expected);
    });

    it('keeps a company page or /pub/ url cleaned but not reduced', () => {
      expect(canonicalLinkValue('linkedin', 'https://www.linkedin.com/company/moshi-concepts?trk=x')).toBe(
        'https://www.linkedin.com/company/moshi-concepts',
      );
      expect(canonicalLinkValue('linkedin', 'https://www.linkedin.com/pub/peter-bui/12/345/678')).toBe(
        'https://www.linkedin.com/pub/peter-bui/12/345/678',
      );
    });
  });

  describe('youtube', () => {
    it.each([
      ['peterbui', 'https://www.youtube.com/@peterbui'],
      ['@peterbui', 'https://www.youtube.com/@peterbui'],
      ['youtube.com/@peterbui', 'https://www.youtube.com/@peterbui'],
      ['https://www.youtube.com/@peterbui?si=abc123', 'https://www.youtube.com/@peterbui'],
      ['https://m.youtube.com/@peterbui', 'https://www.youtube.com/@peterbui'],
      ['https://youtube.com/@peterbui/', 'https://www.youtube.com/@peterbui'],
    ])('%j -> %j', (input, expected) => {
      expect(canonicalLinkValue('youtube', input)).toBe(expected);
    });

    it('keeps a channel or /c/ url cleaned but not reduced', () => {
      expect(canonicalLinkValue('youtube', 'https://www.youtube.com/channel/UC123?si=abc')).toBe(
        'https://www.youtube.com/channel/UC123',
      );
    });
  });

  describe('website', () => {
    it.each([
      ['example.com', 'example.com'],
      ['https://example.com', 'https://example.com'],
      ['https://example.com/?utm_source=newsletter', 'https://example.com/'],
      ['www.example.com/about?utm_campaign=x&ref=y', 'www.example.com/about?ref=y'],
    ])('%j -> %j', (input, expected) => {
      expect(canonicalLinkValue('website', input)).toBe(expected);
    });
  });

  it('produces values toLinkUrl always accepts', () => {
    expect(toLinkUrl('linkedin', canonicalLinkValue('linkedin', 'https://www.linkedin.com/in/x'))).toBe(
      'https://www.linkedin.com/in/x',
    );
    expect(toLinkUrl('youtube', canonicalLinkValue('youtube', 'https://www.youtube.com/@x'))).toBe(
      'https://www.youtube.com/@x',
    );
    expect(toLinkUrl('x', canonicalLinkValue('x', 'ChatSoonApp'))).toBe('https://x.com/ChatSoonApp');
    expect(toLinkUrl('telegram', canonicalLinkValue('telegram', 'name'))).toBe('https://t.me/name');

    // And directly, per the issue's explicit checks.
    expect(toLinkUrl('linkedin', 'https://www.linkedin.com/in/x')).toBe('https://www.linkedin.com/in/x');
    expect(toLinkUrl('youtube', 'https://www.youtube.com/@x')).toBe('https://www.youtube.com/@x');
    expect(toLinkUrl('x', 'ChatSoonApp')).toBe('https://x.com/ChatSoonApp');
    expect(toLinkUrl('telegram', 'name')).toBe('https://t.me/name');
  });
});

describe('displayLink with canonical values', () => {
  it.each([
    ['x', 'ChatSoonApp', '@ChatSoonApp'],
    ['linkedin', 'https://www.linkedin.com/in/x', 'linkedin.com/in/x'],
    ['youtube', 'https://www.youtube.com/@x', 'youtube.com/@x'],
    ['telegram', 'name', '@name'],
  ] as const)('%s %j -> %j', (key, value, expected) => {
    expect(displayLink(key, value)).toBe(expected);
  });
});
