import { describe, expect, it } from 'vitest';

import { profileUrl } from './constants';
import { parseQr, sanitizeDraft, type QrParseResult } from './qr';
import { buildVCard } from './vcard';

const contact = (source: string, draft: Record<string, string>): QrParseResult =>
  ({ kind: 'contact', source, draft }) as QrParseResult;

describe('parseQr: Chatsoon profiles', () => {
  it.each([
    'https://chatsoon.app/id/peter-bui-7f3a',
    'http://chatsoon.app/id/peter-bui-7f3a',
    'https://www.chatsoon.app/id/peter-bui-7f3a/',
    'https://chatsoon.app/id/peter-bui-7f3a?utm_source=qr#connect',
    'HTTPS://CHATSOON.APP/ID/PETER-BUI-7F3A',
    'chatsoon://id/peter-bui-7f3a',
    '\n  https://chatsoon.app/id/peter-bui-7f3a  \n',
  ])('%j', (raw) => {
    expect(parseQr(raw)).toEqual({ kind: 'chatsoon', slug: 'peter-bui-7f3a' });
  });

  it('recognises the reviewer demo profile URL built from constants', () => {
    expect(parseQr(profileUrl('alex-rivera-demo'))).toEqual({ kind: 'chatsoon', slug: 'alex-rivera-demo' });
  });

  it('treats other chatsoon.app pages and invalid slugs as plain websites', () => {
    expect(parseQr('https://chatsoon.app/privacy')).toEqual(contact('url', { website: 'https://chatsoon.app/privacy' }));
    expect(parseQr('https://chatsoon.app/id/peter_bui')).toEqual(
      contact('url', { website: 'https://chatsoon.app/id/peter_bui' }),
    );
    expect(parseQr('chatsoon://id/not a slug')).toEqual({ kind: 'unknown', raw: 'chatsoon://id/not a slug' });
  });
});

describe('parseQr: vCard', () => {
  it('parses an iPhone contact QR', () => {
    const raw = [
      'BEGIN:VCARD',
      'VERSION:3.0',
      'N:Rivera;Alex;;;',
      'FN:Alex Rivera',
      'ORG:Northwind Labs;',
      'TITLE:Head of Partnerships',
      'EMAIL;type=INTERNET;type=WORK;type=pref:alex@northwind.io',
      'TEL;type=CELL;type=VOICE;type=pref:+65 9123 4567',
      'item1.URL;type=pref:https://northwind.io',
      'item1.X-ABLabel:_$!<HomePage>!$_',
      'X-SOCIALPROFILE;type=twitter:https://twitter.com/alexrivera',
      'END:VCARD',
    ].join('\r\n');
    expect(parseQr(raw)).toEqual(
      contact('vcard', {
        name: 'Alex Rivera',
        company: 'Northwind Labs',
        role: 'Head of Partnerships',
        email: 'alex@northwind.io',
        phone: '+65 9123 4567',
        website: 'https://northwind.io',
        xHandle: 'alexrivera',
      }),
    );
  });

  it('parses a card generator vCard with LF line endings and surrounding whitespace', () => {
    const raw = `\n ${[
      'BEGIN:VCARD',
      'VERSION:3.0',
      'N:Tan;Mei Ling',
      'FN:Mei Ling Tan',
      'ORG:Lion City Capital',
      'TEL;TYPE=work,voice:+65 6123 4567',
      'EMAIL:meiling@lioncity.vc',
      'URL:https://lioncity.vc',
      'END:VCARD',
    ].join('\n')}\n`;
    expect(parseQr(raw)).toEqual(
      contact('vcard', {
        name: 'Mei Ling Tan',
        company: 'Lion City Capital',
        phone: '+65 6123 4567',
        email: 'meiling@lioncity.vc',
        website: 'https://lioncity.vc',
      }),
    );
  });

  it('parses a Chatsoon vCard as a contact, not an auto-connect', () => {
    const raw = buildVCard({
      displayName: 'Peter Bui',
      company: 'Moshi Concepts Inc.',
      links: { telegram: 'peterbui' },
      profileUrl: profileUrl('peter-bui-7f3a'),
    });
    expect(parseQr(raw)).toEqual(
      contact('vcard', {
        name: 'Peter Bui',
        company: 'Moshi Concepts Inc.',
        telegram: 'peterbui',
        website: 'https://chatsoon.app/id/peter-bui-7f3a',
      }),
    );
  });

  it('is unknown when the vCard has nothing usable', () => {
    const raw = 'BEGIN:VCARD\r\nVERSION:3.0\r\nBDAY:1990-01-01\r\nEND:VCARD';
    expect(parseQr(raw)).toEqual({ kind: 'unknown', raw });
  });

  it('cuts oversized fields to the contact schema limits', () => {
    const raw = `BEGIN:VCARD\r\nVERSION:3.0\r\nFN:${'N'.repeat(200)}\r\nNOTE:${'n'.repeat(6000)}\r\nEND:VCARD`;
    const result = parseQr(raw);
    expect(result.kind).toBe('contact');
    if (result.kind !== 'contact') return;
    expect(result.draft.name).toHaveLength(120);
    expect(result.draft.notes).toHaveLength(5000);
  });
});

describe('parseQr: MECARD', () => {
  it('parses a MECARD from a card generator', () => {
    expect(
      parseQr('MECARD:N:Bui,Peter;ORG:Moshi Concepts;TEL:+61400111222;EMAIL:peter@example.com;URL:https\\://moshiconcepts.com;NOTE:Token2049 Singapore;;'),
    ).toEqual(
      contact('mecard', {
        name: 'Peter Bui',
        company: 'Moshi Concepts',
        phone: '+61400111222',
        email: 'peter@example.com',
        website: 'https://moshiconcepts.com',
        notes: 'Token2049 Singapore',
      }),
    );
  });

  it('parses BIZCARD as mecard', () => {
    expect(parseQr('BIZCARD:N:Sean;X:Doe;C:Example Corp;E:sean@example.com;;')).toEqual(
      contact('mecard', { name: 'Sean Doe', company: 'Example Corp', email: 'sean@example.com' }),
    );
  });

  it('is unknown when the MECARD has nothing usable', () => {
    expect(parseQr('MECARD:;;')).toEqual({ kind: 'unknown', raw: 'MECARD:;;' });
  });
});

describe('parseQr: Telegram', () => {
  it.each([
    ['https://t.me/peterbui', 'peterbui'],
    ['t.me/peterbui', 'peterbui'],
    ['http://telegram.me/peterbui', 'peterbui'],
    ['https://t.me/peterbui?start=chatsoon', 'peterbui'],
    ['https://t.me/Peter_Bui', 'Peter_Bui'],
    ['tg://resolve?domain=peterbui', 'peterbui'],
    ['https://peterbui.t.me/', 'peterbui'],
  ])('%j', (raw, telegram) => {
    expect(parseQr(raw)).toEqual(contact('telegram', { telegram }));
  });

  it.each([
    'https://t.me/joinchat/AAAAAEkk2WdoDrB4-Q8-gg',
    'https://t.me/+AbCdEfGhIjk',
    'https://t.me/s/durov',
    'https://t.me/addstickers/Animals',
  ])('treats the non-profile link %j as a website', (raw) => {
    expect(parseQr(raw)).toEqual(contact('url', { website: raw }));
  });

  it('is unknown for tg:// links that are not usernames', () => {
    expect(parseQr('tg://join?invite=AbCdEf').kind).toBe('unknown');
  });
});

describe('parseQr: LinkedIn', () => {
  it.each([
    [
      'https://www.linkedin.com/in/peter-bui-7a1b2c3d?utm_source=share&utm_campaign=share_via&utm_content=profile&utm_medium=ios_app',
      'https://www.linkedin.com/in/peter-bui-7a1b2c3d',
    ],
    [
      'https://www.linkedin.com/in/peter-bui-7a1b2c3d?utm_source=share&utm_campaign=share_via&utm_content=profile&utm_medium=android_app',
      'https://www.linkedin.com/in/peter-bui-7a1b2c3d',
    ],
    ['http://linkedin.com/in/peter-bui/', 'https://www.linkedin.com/in/peter-bui'],
    ['linkedin.com/in/peter-bui', 'https://www.linkedin.com/in/peter-bui'],
    ['https://sg.linkedin.com/in/peter-bui', 'https://www.linkedin.com/in/peter-bui'],
    ['https://www.linkedin.com/pub/peter-bui/12/345/678', 'https://www.linkedin.com/pub/peter-bui/12/345/678'],
    ['https://www.linkedin.com/in/%E5%BC%A0%E4%BC%9F', 'https://www.linkedin.com/in/%E5%BC%A0%E4%BC%9F'],
    // LinkedIn app 'My QR code' and share links on Android, with a trailing slash before the query.
    ['https://www.linkedin.com/in/peter-bui-7a1b2c3d/?originalSubdomain=sg', 'https://www.linkedin.com/in/peter-bui-7a1b2c3d'],
    ['HTTPS://WWW.LINKEDIN.COM/IN/PETER-BUI', 'https://www.linkedin.com/in/PETER-BUI'],
  ])('%j', (raw, linkedinUrl) => {
    expect(parseQr(raw)).toEqual(contact('linkedin', { linkedinUrl }));
  });

  it('treats company pages and short links as websites', () => {
    expect(parseQr('https://www.linkedin.com/company/moshi-concepts')).toEqual(
      contact('url', { website: 'https://www.linkedin.com/company/moshi-concepts' }),
    );
    expect(parseQr('https://lnkd.in/gAbC123')).toEqual(contact('url', { website: 'https://lnkd.in/gAbC123' }));
  });
});

describe('parseQr: X / Twitter', () => {
  it.each([
    ['https://x.com/peterbui', 'peterbui'],
    ['https://x.com/peterbui?s=21', 'peterbui'],
    ['https://twitter.com/peterbui?s=09', 'peterbui'],
    ['https://mobile.twitter.com/PeterBui/', 'PeterBui'],
    ['x.com/peterbui', 'peterbui'],
    ['https://twitter.com/intent/user?screen_name=peterbui', 'peterbui'],
    ['twitter://user?screen_name=peterbui', 'peterbui'],
  ])('%j', (raw, xHandle) => {
    expect(parseQr(raw)).toEqual(contact('x', { xHandle }));
  });

  it.each([
    'https://x.com/home',
    'https://x.com/i/flow/login',
    'https://x.com/intent/tweet?text=hello',
    'https://x.com/share?url=https://chatsoon.app',
    'https://x.com/search?q=token2049',
    'https://x.com/hashtag/Token2049',
    'https://x.com/explore',
    'https://x.com/peterbui/status/1790000000000000000',
  ])('treats the non-profile link %j as a website', (raw) => {
    expect(parseQr(raw)).toEqual(contact('url', { website: raw }));
  });
});

describe('parseQr: email', () => {
  it.each([
    ['mailto:peter@example.com', 'peter@example.com'],
    ['MAILTO:PETER@EXAMPLE.COM', 'PETER@EXAMPLE.COM'],
    ['mailto:peter@example.com?subject=Nice%20to%20meet%20you&body=Hi', 'peter@example.com'],
    ['mailto:peter%2Bevents@example.com', 'peter+events@example.com'],
    ['mailto:peter@example.com,sam@example.com', 'peter@example.com'],
    ['mailto:?to=peter@example.com&subject=Hi', 'peter@example.com'],
    ['MATMSG:TO:peter@example.com;SUB:Hello;BODY:Nice to meet you;;', 'peter@example.com'],
    ['peter@example.com', 'peter@example.com'],
    ['  peter.bui+token2049@example.co.uk ', 'peter.bui+token2049@example.co.uk'],
  ])('%j', (raw, email) => {
    expect(parseQr(raw)).toEqual(contact('email', { email }));
  });

  it.each(['mailto:', 'mailto:not-an-email', 'MATMSG:SUB:Hello;;', 'mailto:you%3Fbcc%3Dthem@evil.com'])(
    'is unknown for %j',
    (raw) => {
      expect(parseQr(raw)).toEqual({ kind: 'unknown', raw });
    },
  );

  it('never prefills an address that would smuggle extra recipients into a mailto: link', () => {
    expect(parseQr('MECARD:N:Bui,Peter;EMAIL:you?bcc=them@evil.com;;')).toEqual(contact('mecard', { name: 'Peter Bui' }));
    expect(parseQr('you&cc=them@evil.com')).toEqual({ kind: 'unknown', raw: 'you&cc=them@evil.com' });
  });
});

describe('parseQr: phone', () => {
  it.each([
    ['tel:+61412345678', '+61412345678'],
    ['TEL:+1-555-123-4567', '+1-555-123-4567'],
    ['tel:+65%206123%204567', '+65 6123 4567'],
    ['tel:+15551234567;ext=12', '+15551234567'],
    ['SMSTO:+61412345678:Nice to meet you', '+61412345678'],
    ['SMSTO:+61412345678:Nice to meet you\nSee you at Token2049', '+61412345678'],
    ['sms:+61412345678?body=Hi', '+61412345678'],
    ['sms:+61412345678,+61400000000?body=Hi', '+61412345678'],
    ['tel:(+61)%20412%20345%20678', '(+61) 412 345 678'],
  ])('%j', (raw, phone) => {
    expect(parseQr(raw)).toEqual(contact('phone', { phone }));
  });

  it.each(['tel:', 'tel:call-me', 'tel:12'])('is unknown for %j', (raw) => {
    expect(parseQr(raw)).toEqual({ kind: 'unknown', raw });
  });
});

describe('parseQr: websites', () => {
  it.each([
    ['https://example.com', 'https://example.com'],
    ['https://example.com/about?ref=qr#team', 'https://example.com/about?ref=qr#team'],
    ['HTTP://EXAMPLE.COM/Menu', 'http://example.com/Menu'],
    ['www.example.com', 'https://www.example.com'],
    ['https://www.youtube.com/@peterbui', 'https://www.youtube.com/@peterbui'],
    ['https://instagram.com/peterbui', 'https://instagram.com/peterbui'],
  ])('%j', (raw, website) => {
    expect(parseQr(raw)).toEqual(contact('url', { website }));
  });

  it('is unknown when the URL is unsafe or too long for the contact', () => {
    for (const raw of ['https://example.com/<script>', 'https://user:pw@example.com', `https://example.com/${'a'.repeat(300)}`]) {
      expect(parseQr(raw)).toEqual({ kind: 'unknown', raw });
    }
  });
});

describe('parseQr: junk', () => {
  it.each([
    '',
    '   ',
    '\n\t',
    'hello world',
    '12345',
    '@peterbui',
    'peterbui',
    'WIFI:S:Home Network;T:WPA;P:secret;;',
    'otpauth://totp/Example:peter@example.com?secret=JBSWY3DPEHPK3PXP&issuer=Example',
    'bitcoin:1BoatSLRHtKNngkdXEeobR76b53LETtpyT?amount=0.01',
    'geo:1.2839,103.8515',
    'javascript:alert(1)',
    'data:text/html,<b>hi</b>',
    'ftp://example.com/file.txt',
    'file:///etc/passwd',
    'https://',
    '4006381333931',
    '{"name":"Peter"}',
    'BEGIN:VEVENT\nSUMMARY:Token2049\nEND:VEVENT',
  ])('%j is unknown and keeps the raw text', (raw) => {
    expect(parseQr(raw)).toEqual({ kind: 'unknown', raw });
  });

  it('handles the largest QR payloads quickly', () => {
    // A version 40 QR holds at most 4296 characters.
    const inputs = [
      `x${' '.repeat(4294)}y`,
      `https://example.com/${'/'.repeat(4000)}a`,
      `tel:${' '.repeat(4000)}1`,
      `BEGIN:VCARD\r\nNOTE;ENCODING=QUOTED-PRINTABLE:${'=41'.repeat(1400)}\r\nEND:VCARD`,
      `MECARD:${'N:a;'.repeat(1000)};`,
    ];
    const start = Date.now();
    for (const raw of inputs) parseQr(raw);
    expect(Date.now() - start).toBeLessThan(1000);
  });
});

describe('sanitizeDraft', () => {
  it('keeps known string fields, trimmed, and drops everything else', () => {
    expect(
      sanitizeDraft({
        name: '  Peter   Bui ',
        company: 42,
        role: null,
        email: ' peter@example.com ',
        telegram: 'peterbui',
        notes: '  Line one\r\nLine two  ',
        website: 'example.com',
        linkedinUrl: 'peter-bui',
        extra: 'ignored',
      }),
    ).toEqual({
      name: 'Peter Bui',
      email: 'peter@example.com',
      telegram: 'peterbui',
      notes: 'Line one\nLine two',
      website: 'https://example.com',
      linkedinUrl: 'https://www.linkedin.com/in/peter-bui',
    });
  });

  it('reads only own properties of parsed route params', () => {
    expect(sanitizeDraft(JSON.parse('{"__proto__":{"name":"Injected"},"company":"Acme"}'))).toEqual({ company: 'Acme' });
    expect(sanitizeDraft(Object.create({ name: 'Inherited' }))).toEqual({});
  });

  it('drops unsafe links', () => {
    expect(sanitizeDraft({ name: 'X', website: 'javascript:alert(1)', linkedinUrl: 'data:text/html,hi' })).toEqual({
      name: 'X',
    });
  });

  it('cuts text to the schema limits without splitting emoji', () => {
    const draft = sanitizeDraft({ name: `${'a'.repeat(119)}😀`, phone: '1'.repeat(50) });
    expect(draft.name).toBe('a'.repeat(119));
    expect(draft.phone).toHaveLength(40);
  });

  it('accepts anything without throwing', () => {
    for (const value of [null, undefined, 'text', 42, [], true]) expect(sanitizeDraft(value)).toEqual({});
  });
});
