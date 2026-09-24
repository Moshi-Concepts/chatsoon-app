import { describe, expect, it } from 'vitest';

import { profileUrl } from './constants';
import { buildVCard, foldLine, parseMeCard, parseVCard, type VCardProfile } from './vcard';

const crlf = (...lines: string[]) => `${lines.join('\r\n')}\r\n`;

/** UTF-8 octet count, computed by hand so the test doesn't depend on TextEncoder. */
function octets(text: string): number {
  let n = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    n += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }
  return n;
}

function physicalLines(vcard: string): string[] {
  expect(vcard.endsWith('\r\n')).toBe(true);
  // No bare CR or LF anywhere: every line break is CRLF.
  expect(vcard.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
  return vcard.slice(0, -2).split('\r\n');
}

const peter: VCardProfile = {
  displayName: 'Peter Bui',
  headline: 'Building Chatsoon. Cardano and Midnight.',
  company: 'Moshi Concepts Inc.',
  role: 'Founder',
  links: {
    x: '@peterbui',
    telegram: 't.me/peterbui',
    linkedin: 'https://www.linkedin.com/in/peter-bui/',
    website: 'moshiconcepts.com',
    youtube: '@peterbui',
  },
  profileUrl: profileUrl('peter-bui-7f3a'),
};

describe('buildVCard', () => {
  it('writes a complete vCard 3.0 with CRLF line endings', () => {
    expect(buildVCard(peter)).toBe(
      crlf(
        'BEGIN:VCARD',
        'VERSION:3.0',
        'PRODID:-//Moshi Concepts Inc.//Chatsoon//EN',
        'N:Bui;Peter;;;',
        'FN:Peter Bui',
        'ORG:Moshi Concepts Inc.',
        'TITLE:Founder',
        'NOTE:Building Chatsoon. Cardano and Midnight.',
        'item1.URL:https://chatsoon.app/id/peter-bui-7f3a',
        'item1.X-ABLabel:Chatsoon',
        'URL:https://moshiconcepts.com',
        'X-SOCIALPROFILE;TYPE=twitter:https://x.com/peterbui',
        'X-SOCIALPROFILE;TYPE=telegram:https://t.me/peterbui',
        'X-SOCIALPROFILE;TYPE=linkedin:https://www.linkedin.com/in/peter-bui',
        'X-SOCIALPROFILE;TYPE=youtube:https://www.youtube.com/@peterbui',
        'END:VCARD',
      ),
    );
  });

  it('writes only the name and profile URL for a minimal profile', () => {
    expect(buildVCard({ displayName: 'Alex Rivera', profileUrl: profileUrl('alex-rivera-demo') })).toBe(
      crlf(
        'BEGIN:VCARD',
        'VERSION:3.0',
        'PRODID:-//Moshi Concepts Inc.//Chatsoon//EN',
        'N:Rivera;Alex;;;',
        'FN:Alex Rivera',
        'item1.URL:https://chatsoon.app/id/alex-rivera-demo',
        'item1.X-ABLabel:Chatsoon',
        'END:VCARD',
      ),
    );
  });

  it('skips empty and junk links', () => {
    const vcard = buildVCard({
      displayName: 'Alex Rivera',
      headline: '   ',
      company: null,
      role: '',
      links: { x: 'not a handle', telegram: '', website: 'javascript:alert(1)', linkedin: 'https://example.com/me' },
      profileUrl: profileUrl('alex-rivera-demo'),
    });
    expect(vcard).not.toMatch(/X-SOCIALPROFILE|ORG|TITLE|NOTE|javascript|example\.com/);
    // Only the profile URL is left.
    expect(vcard.match(/^(?:item\d+\.)?URL:.*$/gm)).toEqual(['item1.URL:https://chatsoon.app/id/alex-rivera-demo']);
  });

  it('adds one item pair per booking link right after the profile URL, numbered from item2', () => {
    const lines = physicalLines(
      buildVCard({
        ...peter,
        links: {},
        bookingLinks: [
          { label: 'Crypto chat', url: 'https://calendly.com/chatwithpete/crypto-chat' },
          { label: '30 min', url: 'https://calendly.com/chatwithpete/30min' },
        ],
      }),
    );
    expect(lines).toContain('item1.URL:https://chatsoon.app/id/peter-bui-7f3a');
    expect(lines).toContain('item2.URL:https://calendly.com/chatwithpete/crypto-chat');
    expect(lines).toContain('item2.X-ABLabel:Crypto chat');
    expect(lines).toContain('item3.URL:https://calendly.com/chatwithpete/30min');
    expect(lines).toContain('item3.X-ABLabel:30 min');
  });

  it('escapes a booking label and skips a link that no longer parses', () => {
    const vcard = buildVCard({
      ...peter,
      links: {},
      bookingLinks: [
        { label: 'Sales, EMEA; APAC', url: 'https://cal.com/peter/30min' },
        { label: 'Stale', url: 'https://example.com/gone' },
      ],
    });
    expect(vcard).toContain('item2.URL:https://cal.com/peter/30min');
    expect(vcard).toContain('item2.X-ABLabel:Sales\\, EMEA\\; APAC');
    expect(vcard).not.toMatch(/item3\.|example\.com|Stale/);
  });

  it('never includes an email address, even when one is typed into a link field', () => {
    const vcard = buildVCard({
      ...peter,
      links: {
        website: 'peter@example.com',
        x: 'peter@example.com',
        telegram: 'peter@example.com',
        linkedin: 'peter@example.com',
        youtube: 'mailto:peter@example.com',
      },
    });
    expect(vcard).not.toMatch(/EMAIL/i);
    expect(vcard).not.toMatch(/mailto/i);
    expect(vcard).not.toContain('peter@example.com');
  });

  it.each([
    ['Madonna', 'N:;Madonna;;;', 'FN:Madonna'],
    ['Mary Jane Watson', 'N:Watson;Mary Jane;;;', 'FN:Mary Jane Watson'],
    ['  Peter    Bui  ', 'N:Bui;Peter;;;', 'FN:Peter Bui'],
    ['张伟', 'N:;张伟;;;', 'FN:张伟'],
    ['山田 太郎', 'N:山田;太郎;;;', 'FN:山田 太郎'],
    ['김 민준', 'N:김;민준;;;', 'FN:김 민준'],
    ['Smith, Jr.; John', 'N:John;Smith\\, Jr.\\;;;;', 'FN:Smith\\, Jr.\\; John'],
  ])('splits %j into N and FN', (displayName, n, fn) => {
    const lines = physicalLines(buildVCard({ displayName, profileUrl: profileUrl('x-1') }));
    expect(lines).toContain(n);
    expect(lines).toContain(fn);
  });

  it('escapes backslashes, commas, semicolons and newlines in text values', () => {
    const lines = physicalLines(
      buildVCard({
        displayName: 'Peter Bui',
        company: 'Smith, Jones; Partners',
        role: 'C:\\Ops',
        headline: 'Line one\nLine two\r\nLine three',
        profileUrl: profileUrl('peter-bui-7f3a'),
      }),
    );
    expect(lines).toContain('ORG:Smith\\, Jones\\; Partners');
    expect(lines).toContain('TITLE:C:\\\\Ops');
    expect(lines).toContain('NOTE:Line one\\nLine two\\nLine three');
  });

  it('folds long lines at 75 octets without splitting UTF-8 characters, emoji or escapes', () => {
    const headline = `Founder 🚀 of 示例科技有限公司, Ελληνικά and émojis 👩🏽‍💻🇦🇺; ${'building in public, '.repeat(6)}done`;
    const profile: VCardProfile = {
      displayName: 'Nguyễn Thị Minh Khai 阮氏明開 🌸',
      company: '株式会社サンプル・テクノロジーズ・インターナショナル・ホールディングス・ジャパン',
      headline,
      profileUrl: profileUrl('nguyen-thi-minh-khai-1a2b'),
      links: { website: `https://example.com/${'a'.repeat(120)}` },
    };
    const vcard = buildVCard(profile);
    const lines = physicalLines(vcard);

    for (const line of lines) {
      expect(octets(line)).toBeLessThanOrEqual(75);
      // A split surrogate pair would leave a lone surrogate at a line edge.
      expect(line).not.toMatch(/^ ?[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/);
      // An escape pair is never split across lines.
      expect(line).not.toMatch(/(?:^|[^\\])(?:\\\\)*\\$/);
    }
    // Continuation lines start with exactly one space.
    expect(lines.filter((l) => l.startsWith(' ')).length).toBeGreaterThan(3);

    const parsed = parseVCard(vcard);
    expect(parsed.name).toBe(profile.displayName);
    expect(parsed.company).toBe(profile.company);
    expect(parsed.notes).toBe(headline);
    expect(parsed.website).toBe(profile.links?.website);
  });
});

describe('foldLine', () => {
  it('leaves lines of 75 octets or fewer alone', () => {
    const line = `NOTE:${'a'.repeat(70)}`;
    expect(foldLine(line)).toBe(line);
  });

  it('folds at exactly 75 octets and continues with a space', () => {
    const folded = foldLine(`NOTE:${'a'.repeat(100)}`);
    const [first, second] = folded.split('\r\n');
    expect(octets(first ?? '')).toBe(75);
    expect(second).toBe(` ${'a'.repeat(30)}`);
  });

  it('keeps multi-byte characters whole', () => {
    // 5 + 23 * 3 = 74 octets, so the next 3-octet character must move to the next line.
    const folded = foldLine(`NOTE:${'张'.repeat(30)}`);
    const [first = '', ...rest] = folded.split('\r\n');
    expect(octets(first)).toBe(74);
    expect(first + rest.map((l) => l.slice(1)).join('')).toBe(`NOTE:${'张'.repeat(30)}`);
  });
});

describe('parseVCard', () => {
  it('reads an iPhone contact share (vCard 3.0)', () => {
    const vcard = crlf(
      'BEGIN:VCARD',
      'VERSION:3.0',
      'PRODID:-//Apple Inc.//iPhone OS 17.5.1//EN',
      'N:Rivera;Alex;;;',
      'FN:Alex Rivera',
      'ORG:Northwind Labs;',
      'TITLE:Head of Partnerships',
      'EMAIL;type=INTERNET;type=WORK;type=pref:alex@northwind.io',
      'EMAIL;type=INTERNET;type=HOME:alex.rivera@gmail.com',
      'TEL;type=CELL;type=VOICE;type=pref:+65 9123 4567',
      'TEL;type=WORK;type=VOICE:+65 6123 4567',
      'item1.ADR;type=WORK;type=pref:;;1 Raffles Place;Singapore;;048616;Singapore',
      'item1.X-ABADR:sg',
      'item2.URL;type=pref:https://northwind.io',
      'item2.X-ABLabel:_$!<HomePage>!$_',
      'X-SOCIALPROFILE;type=twitter:https://twitter.com/alexrivera',
      'X-SOCIALPROFILE;type=linkedin:https://www.linkedin.com/in/alex-rivera-sg',
      'IMPP;X-SERVICE-TYPE=Telegram;type=pref:x-apple:alexrivera',
      'NOTE:Met at Token2049\\nInterested in the Q4 sponsor package',
      'PHOTO;ENCODING=b;TYPE=JPEG:/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a',
      ' HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIy',
      'END:VCARD',
    );
    expect(parseVCard(vcard)).toEqual({
      name: 'Alex Rivera',
      company: 'Northwind Labs',
      role: 'Head of Partnerships',
      email: 'alex@northwind.io',
      phone: '+65 9123 4567',
      website: 'https://northwind.io',
      xHandle: 'alexrivera',
      linkedinUrl: 'https://www.linkedin.com/in/alex-rivera-sg',
      telegram: 'alexrivera',
      notes: 'Met at Token2049\nInterested in the Q4 sponsor package',
    });
  });

  it('reads iOS social profiles that only carry x-user', () => {
    const vcard = crlf(
      'BEGIN:VCARD',
      'VERSION:3.0',
      'FN:Alex Rivera',
      'X-SOCIALPROFILE;type=twitter;x-user=alexrivera:x-apple:alexrivera',
      'X-SOCIALPROFILE;type=Telegram;x-user=alex_rivera_sg:x-apple:alex_rivera_sg',
      'END:VCARD',
    );
    expect(parseVCard(vcard)).toEqual({ name: 'Alex Rivera', xHandle: 'alexrivera', telegram: 'alex_rivera_sg' });
  });

  it('reads a Google Contacts export (escaped colons, item groups, social URLs)', () => {
    const vcard = crlf(
      'BEGIN:VCARD',
      'VERSION:3.0',
      'FN:Priya Sharma',
      'N:Sharma;Priya;;;',
      'EMAIL;TYPE=INTERNET;TYPE=WORK:priya@example.in',
      'TEL;TYPE=CELL:+91 98765 43210',
      'ORG:Example Ventures',
      'TITLE:Partner',
      'item1.URL:https\\://t.me/priyasharma',
      'item1.X-ABLabel:Telegram',
      'item2.URL:https\\://www.linkedin.com/in/priya-sharma-vc?utm_source=share',
      'item2.X-ABLabel:LinkedIn',
      'item3.URL:https\\://x.com/priyasharma_vc',
      'item3.X-ABLabel:X',
      'URL;TYPE=WORK:https\\://example.in',
      'NOTE:Investor\\, seed stage\\; fintech',
      'CATEGORIES:myContacts',
      'END:VCARD',
    );
    expect(parseVCard(vcard)).toEqual({
      name: 'Priya Sharma',
      email: 'priya@example.in',
      phone: '+91 98765 43210',
      company: 'Example Ventures',
      role: 'Partner',
      telegram: 'priyasharma',
      linkedinUrl: 'https://www.linkedin.com/in/priya-sharma-vc',
      xHandle: 'priyasharma_vc',
      website: 'https://example.in',
      notes: 'Investor, seed stage; fintech',
    });
  });

  it('reads an Android contact share (vCard 2.1, quoted-printable UTF-8, soft line breaks)', () => {
    const vcard = crlf(
      'BEGIN:VCARD',
      'VERSION:2.1',
      'N;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:=E5=BC=A0;=E4=BC=9F;;;',
      'FN;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:=E5=BC=A0=E4=BC=9F',
      'TEL;CELL:+86 138 0013 8000',
      'TEL;WORK;PREF:+86 21 1234 5678',
      'EMAIL;WORK:zhangwei@example.cn',
      'ORG;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:=E7=A4=BA=E4=BE=8B=E7=A7=91=E6=8A=80=E6=9C=89=E9=99=90=E5=85=AC=E5=8F=B8',
      'TITLE;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:=E9=A6=96=E5=B8=AD=E6=89=A7=E8=A1=8C=E5=AE=98',
      'NOTE;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:=E5=9C=A8Token2049=E8=AE=A4=E8=AF=86=0D=0A=',
      'Follow up=20next week',
      'PHOTO;ENCODING=BASE64;JPEG:/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a',
      ' HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIy',
      '',
      'END:VCARD',
    );
    expect(parseVCard(vcard)).toEqual({
      name: '张伟',
      phone: '+86 21 1234 5678',
      email: 'zhangwei@example.cn',
      company: '示例科技有限公司',
      role: '首席执行官',
      notes: '在Token2049认识\nFollow up next week',
    });
  });

  it('decodes quoted-printable in other charsets', () => {
    const vcard = (fn: string) => crlf('BEGIN:VCARD', 'VERSION:2.1', fn, 'END:VCARD');
    expect(parseVCard(vcard('FN;CHARSET=ISO-8859-1;ENCODING=QUOTED-PRINTABLE:Ren=E9 Dupont')).name).toBe('René Dupont');
    expect(parseVCard(vcard('FN;CHARSET=windows-1252;QUOTED-PRINTABLE:=93Chip=94 M=FCller')).name).toBe('“Chip” Müller');
    expect(parseVCard(vcard('FN;ENCODING=QUOTED-PRINTABLE:Jos=C3=A9 Garc=C3=ADa')).name).toBe('José García');
    // Not valid UTF-8 and no charset: fall back to Windows-1252 instead of garbage.
    expect(parseVCard(vcard('FN;ENCODING=QUOTED-PRINTABLE:J=FCrgen M=FCller')).name).toBe('Jürgen Müller');
  });

  it('reads vCard 4.0 (PREF=1, tel: URIs, quoted parameters, SOCIALPROFILE)', () => {
    const vcard = crlf(
      'BEGIN:VCARD',
      'VERSION:4.0',
      'FN:Dr. Ana María López',
      'N:López;Ana;María;Dr.;',
      'ORG:Universidad Example;Physics',
      'TITLE:Researcher',
      'EMAIL;TYPE=work:ana@example.es',
      'EMAIL;TYPE=home;PREF=1:ana.lopez@example.com',
      'TEL;VALUE=uri;TYPE="voice,cell";PREF=1:tel:+34-600-123-456;ext=12',
      'URL:https://x.com/analopez',
      'SOCIALPROFILE;SERVICE-TYPE=Telegram:https://t.me/analopez',
      'IMPP;PREF=1:xmpp:ana@example.es',
      'NOTE:Quantum sensing',
      'END:VCARD',
    );
    expect(parseVCard(vcard)).toEqual({
      name: 'Dr. Ana María López',
      company: 'Universidad Example',
      role: 'Researcher',
      email: 'ana.lopez@example.com',
      phone: '+34-600-123-456',
      xHandle: 'analopez',
      telegram: 'analopez',
      notes: 'Quantum sensing',
    });
  });

  it('composes the name from N when FN is missing or empty', () => {
    expect(parseVCard(crlf('BEGIN:VCARD', 'VERSION:3.0', 'N:Doe;John;Quincy;Dr.;Jr.', 'END:VCARD')).name).toBe(
      'Dr. John Quincy Doe Jr.',
    );
    expect(parseVCard(crlf('BEGIN:VCARD', 'VERSION:3.0', 'FN:', 'N:Doe;Jane;;;', 'END:VCARD')).name).toBe('Jane Doe');
    expect(parseVCard(crlf('BEGIN:VCARD', 'VERSION:3.0', 'N:李;娜;;;', 'END:VCARD')).name).toBe('李娜');
    expect(parseVCard(crlf('BEGIN:VCARD', 'VERSION:3.0', 'N:O\\;Brien;Pat;;;', 'END:VCARD')).name).toBe('Pat O;Brien');
    expect(parseVCard(crlf('BEGIN:VCARD', 'VERSION:3.0', 'NICKNAME:Sunny,Sun', 'END:VCARD')).name).toBe('Sunny');
  });

  it('unfolds 3.0 continuation lines (space or tab) and LF-only input', () => {
    const vcard = [
      'BEGIN:VCARD',
      'VERSION:3.0',
      'FN:Peter',
      '  Bui',
      'NOTE:This is a lo',
      ' ng note that was fol',
      '\tded twice',
      'END:VCARD',
    ].join('\n');
    expect(parseVCard(vcard)).toEqual({ name: 'Peter Bui', notes: 'This is a long note that was folded twice' });
  });

  it('keeps the whitespace when unfolding vCard 2.1 (RFC 822 folding)', () => {
    const vcard = crlf('BEGIN:VCARD', 'VERSION:2.1', 'FN:Peter', ' Bui', 'NOTE:Folded at', ' a space', 'END:VCARD');
    expect(parseVCard(vcard)).toEqual({ name: 'Peter Bui', notes: 'Folded at a space' });
  });

  it('handles 2.1 bare parameters and case-insensitive names', () => {
    const vcard = crlf(
      'begin:vcard',
      'version:2.1',
      'fn:Sam Lee',
      'email;internet:sam@example.org',
      'tel;cell;voice:+44 7700 900123',
      'url:www.samlee.dev',
      'end:vcard',
    );
    expect(parseVCard(vcard)).toEqual({
      name: 'Sam Lee',
      email: 'sam@example.org',
      phone: '+44 7700 900123',
      website: 'https://www.samlee.dev',
    });
  });

  it('prefers a PREF email over an earlier one, otherwise the first', () => {
    const base = ['BEGIN:VCARD', 'VERSION:3.0', 'FN:Kim'];
    expect(
      parseVCard(crlf(...base, 'EMAIL:first@example.com', 'EMAIL;TYPE=pref:second@example.com', 'END:VCARD')).email,
    ).toBe('second@example.com');
    expect(parseVCard(crlf(...base, 'EMAIL:first@example.com', 'EMAIL:second@example.com', 'END:VCARD')).email).toBe(
      'first@example.com',
    );
    expect(parseVCard(crlf(...base, 'EMAIL:not an email', 'EMAIL:real@example.com', 'END:VCARD')).email).toBe(
      'real@example.com',
    );
  });

  it('ranks vCard 4.0 PREF values: 1 beats 2, and any PREF beats none', () => {
    const vcard = crlf(
      'BEGIN:VCARD',
      'VERSION:4.0',
      'FN:Kim',
      'EMAIL:none@example.com',
      'EMAIL;PREF=2:two@example.com',
      'EMAIL;PREF=1:one@example.com',
      'TEL;VALUE=uri:tel:+1-555-000-0001',
      'TEL;VALUE=uri;PREF=3:tel:+1-555-000-0003',
      'TEL;VALUE=uri;PREF=2:tel:+1-555-000-0002',
      'END:VCARD',
    );
    expect(parseVCard(vcard)).toEqual({ name: 'Kim', email: 'one@example.com', phone: '+1-555-000-0002' });
  });

  it('drops an email that would smuggle recipients into a mailto: link', () => {
    const vcard = crlf('BEGIN:VCARD', 'VERSION:3.0', 'FN:Eve', 'EMAIL:you?bcc=them@evil.com', 'END:VCARD');
    expect(parseVCard(vcard)).toEqual({ name: 'Eve' });
  });

  it('reads an Outlook export (vCard 2.1, bare PREF, ORG with department)', () => {
    const vcard = crlf(
      'BEGIN:VCARD',
      'VERSION:2.1',
      'N;LANGUAGE=en-au:Nguyen;Linh',
      'FN:Linh Nguyen',
      'ORG:Harbour Capital;Investments',
      'TITLE:Associate',
      'TEL;WORK;VOICE:+61 2 9000 0000',
      'TEL;CELL;VOICE:+61 400 000 111',
      'EMAIL;PREF;INTERNET:linh.nguyen@harbourcap.com.au',
      'URL;WORK:https://www.harbourcap.com.au',
      'X-MS-OL-DEFAULT-POSTAL-ADDRESS:0',
      'REV:20260901T010203Z',
      'END:VCARD',
    );
    expect(parseVCard(vcard)).toEqual({
      name: 'Linh Nguyen',
      company: 'Harbour Capital',
      role: 'Associate',
      phone: '+61 2 9000 0000',
      email: 'linh.nguyen@harbourcap.com.au',
      website: 'https://www.harbourcap.com.au',
    });
  });

  it('reads a Samsung contact share (vCard 2.1, quoted-printable Vietnamese, X-ANDROID-CUSTOM)', () => {
    const vcard = crlf(
      'BEGIN:VCARD',
      'VERSION:2.1',
      'N;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:Nguy=E1=BB=85n;Minh;;;',
      'FN;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:Minh Nguy=E1=BB=85n',
      'TEL;HOME:028 3822 1234',
      'TEL;CELL;PREF:+84 90 123 4567',
      'EMAIL;HOME:minh@example.vn',
      'X-ANDROID-CUSTOM:vnd.android.cursor.item/nickname;Minnie;1;;;;;;;;;;;;;',
      'END:VCARD',
    );
    expect(parseVCard(vcard)).toEqual({ name: 'Minh Nguyễn', phone: '+84 90 123 4567', email: 'minh@example.vn' });
  });

  it('does not let a stray soft line break swallow the END line', () => {
    const vcard = crlf(
      'BEGIN:VCARD',
      'VERSION:2.1',
      'FN;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:Ren=C3=A9 Dupont=',
      'END:VCARD',
      'BEGIN:VCARD',
      'VERSION:2.1',
      'FN:Second Person',
      'EMAIL:second@example.com',
      'END:VCARD',
    );
    expect(parseVCard(vcard)).toEqual({ name: 'René Dupont' });
  });

  it('shows list values in N components space-separated', () => {
    expect(
      parseVCard(crlf('BEGIN:VCARD', 'VERSION:4.0', 'N:Stevenson;John;Philip,Paul;Dr.;Jr.,M.D.', 'END:VCARD')).name,
    ).toBe('Dr. John Philip Paul Stevenson Jr. M.D.');
  });

  it('reads Telegram from IMPP URIs and X-TELEGRAM / X-TWITTER / X-LINKEDIN extensions', () => {
    const vcard = crlf(
      'BEGIN:VCARD',
      'VERSION:3.0',
      'FN:Kai',
      'IMPP:skype:kai.live',
      'IMPP:tg://resolve?domain=kai_builds',
      'X-TWITTER:@kaibuilds',
      'X-LINKEDIN:kai-builds',
      'END:VCARD',
    );
    expect(parseVCard(vcard)).toEqual({
      name: 'Kai',
      telegram: 'kai_builds',
      xHandle: 'kaibuilds',
      linkedinUrl: 'https://www.linkedin.com/in/kai-builds',
    });
    expect(parseVCard(crlf('BEGIN:VCARD', 'VERSION:3.0', 'X-TELEGRAM:@kai_builds', 'END:VCARD'))).toEqual({
      telegram: 'kai_builds',
    });
  });

  it('routes URLs: social profiles to their fields, the first other URL to website', () => {
    const vcard = crlf(
      'BEGIN:VCARD',
      'VERSION:3.0',
      'FN:Mia',
      'URL:https://twitter.com/mia_eth?s=21',
      'URL:https://mia.example.com',
      'URL:https://blog.example.com',
      'URL:https://t.me/joinchat/AAAAAEkk2WdoDrB4-Q8-gg',
      'URL:javascript:alert(1)',
      'END:VCARD',
    );
    expect(parseVCard(vcard)).toEqual({ name: 'Mia', xHandle: 'mia_eth', website: 'https://mia.example.com' });
  });

  it('only reads the first card and ignores unknown or broken lines', () => {
    const vcard = crlf(
      'BEGIN:VCARD',
      'VERSION:3.0',
      'FN:First Person',
      'this line has no colon',
      ':empty name',
      'X-UNKNOWN;FOO=bar:ignored',
      'BDAY:1990-01-01',
      'END:VCARD',
      'BEGIN:VCARD',
      'VERSION:3.0',
      'FN:Second Person',
      'EMAIL:second@example.com',
      'END:VCARD',
    );
    expect(parseVCard(vcard)).toEqual({ name: 'First Person' });
  });

  it('is lenient about a missing BEGIN line', () => {
    expect(parseVCard('FN:No Begin\nEMAIL:nobegin@example.com')).toEqual({
      name: 'No Begin',
      email: 'nobegin@example.com',
    });
  });

  it('returns an empty draft for junk', () => {
    expect(parseVCard('')).toEqual({});
    expect(parseVCard('hello world')).toEqual({});
    expect(parseVCard('BEGIN:VCARD\r\nEND:VCARD')).toEqual({});
    expect(parseVCard('BEGIN:VCARD\r\nVERSION:3.0\r\nFN:   \r\nEMAIL:nope\r\nTEL:call me\r\nEND:VCARD')).toEqual({});
  });

  it('round-trips a CJK name with a space', () => {
    const vcard = buildVCard({ displayName: '山田 太郎', company: '株式会社サンプル', profileUrl: profileUrl('yamada-1a2b') });
    expect(parseVCard(vcard)).toMatchObject({ name: '山田 太郎', company: '株式会社サンプル' });
    // Without FN, the name comes back from N family-first.
    expect(parseVCard(vcard.replace(/^FN:.*\r\n/m, '')).name).toBe('山田太郎');
  });

  it('round-trips buildVCard output', () => {
    expect(parseVCard(buildVCard(peter))).toEqual({
      name: 'Peter Bui',
      company: 'Moshi Concepts Inc.',
      role: 'Founder',
      notes: 'Building Chatsoon. Cardano and Midnight.',
      website: 'https://moshiconcepts.com',
      xHandle: 'peterbui',
      telegram: 'peterbui',
      linkedinUrl: 'https://www.linkedin.com/in/peter-bui',
    });
  });

  it('round-trips special characters and falls back to the profile URL as website', () => {
    const profile: VCardProfile = {
      displayName: 'Zoë “Z” O’Connor-Nakamura',
      company: 'Smith, Jones; Partners \\ Co',
      role: 'VP, Growth; APAC',
      headline: 'Line one\nLine two, with commas; and semicolons \\o/',
      profileUrl: profileUrl('zoe-oconnor-9x8y'),
    };
    expect(parseVCard(buildVCard(profile))).toEqual({
      name: profile.displayName,
      company: profile.company,
      role: profile.role,
      notes: profile.headline,
      website: 'https://chatsoon.app/id/zoe-oconnor-9x8y',
    });
  });
});

describe('parseMeCard', () => {
  it('reads a typical generator MECARD', () => {
    expect(
      parseMeCard(
        'MECARD:N:Doe,John;ORG:Example Corp;TEL:+12125551212;EMAIL:john.doe@example.com;URL:http\\://www.example.com;ADR:76 9th Avenue, New York, NY 10011;NOTE:Met at the booth;;',
      ),
    ).toEqual({
      name: 'John Doe',
      company: 'Example Corp',
      phone: '+12125551212',
      email: 'john.doe@example.com',
      website: 'http://www.example.com',
      notes: 'Met at the booth',
    });
  });

  it('handles escapes, unescaped URL colons and social URLs', () => {
    expect(
      parseMeCard(
        'MECARD:N:Bui,Peter;ORG:Moshi Concepts\\; Inc.;TITLE:Founder;NOTE:Token2049\\: booth 12\\, level 2;URL:https://t.me/peterbui;URL:https://www.linkedin.com/in/peter-bui;;',
      ),
    ).toEqual({
      name: 'Peter Bui',
      company: 'Moshi Concepts; Inc.',
      role: 'Founder',
      notes: 'Token2049: booth 12, level 2',
      telegram: 'peterbui',
      linkedinUrl: 'https://www.linkedin.com/in/peter-bui',
    });
  });

  it('reads a Japanese DoCoMo MECARD (family name first, no space)', () => {
    expect(parseMeCard('MECARD:N:山田,太郎;SOUND:ヤマダ,タロウ;TEL:09012345678;EMAIL:taro@example.jp;;')).toEqual({
      name: '山田太郎',
      phone: '09012345678',
      email: 'taro@example.jp',
    });
  });

  it('accepts a single-part name, lower-case prefix, nickname fallback and missing terminator', () => {
    expect(parseMeCard('mecard:N:Peter Bui;TEL:+61400111222')).toEqual({ name: 'Peter Bui', phone: '+61400111222' });
    expect(parseMeCard('MECARD:NICKNAME:Sunny;EMAIL:sunny@example.com;;')).toEqual({
      name: 'Sunny',
      email: 'sunny@example.com',
    });
    expect(parseMeCard('MECARD:N:Doe\\, Jr.,John;;').name).toBe('John Doe, Jr.');
  });

  it('reads BIZCARD', () => {
    expect(
      parseMeCard(
        'BIZCARD:N:Sean;X:Doe;T:Software Engineer;C:Example Corp;A:1 Main St;B:+12125551212;E:sean@example.com;;',
      ),
    ).toEqual({
      name: 'Sean Doe',
      role: 'Software Engineer',
      company: 'Example Corp',
      phone: '+12125551212',
      email: 'sean@example.com',
    });
  });

  it('returns an empty draft for junk', () => {
    expect(parseMeCard('')).toEqual({});
    expect(parseMeCard('MECARD:')).toEqual({});
    expect(parseMeCard('MECARD:;;')).toEqual({});
    expect(parseMeCard('MECARD:EMAIL:nope;TEL:abc;;')).toEqual({});
    expect(parseMeCard('WIFI:S:Home;T:WPA;P:secret;;')).toEqual({});
  });
});
