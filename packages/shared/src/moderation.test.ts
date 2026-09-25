import { describe, expect, it } from 'vitest';

import { hasObjectionableText } from './moderation';
import { connectFormSchema, profileInputSchema } from './schemas';

const OFFENSIVE = 'Please remove offensive language';

describe('hasObjectionableText', () => {
  it.each([
    'fuck',
    'Shit happens',
    'You are a CUNT.',
    'total bullshit artist',
    'what a motherfucker',
    'hi!fuck you',
    'shit!',
    'Dickheads welcome',
    'nigger',
    'faggots',
  ])('blocks %j', (text) => {
    expect(hasObjectionableText(text)).toBe(true);
  });

  it.each([
    'sh1t',
    '5hit',
    '$hit',
    'sh!t',
    'a55hole',
    'a$$hole',
    'b!tch',
    'fvck',
    'cvnt',
    'n1gg3r',
    'fuuuuuuck',
    'SHIIIIIT',
    'asssssshole',
  ])('blocks the leetspeak or stretched spelling %j', (text) => {
    expect(hasObjectionableText(text)).toBe(true);
  });

  it.each([
    'fück',
    'ＦＵＣＫ',
    'fu\u200bck',
    'fu\u00adck',
    's\u0336h\u0336i\u0336t\u0336',
    '\u0441unt', // Cyrillic es
    'f\u03c5ck', // Greek upsilon
    'f u c k',
    'S.H.I.T.',
    'f-u-c-k-i-n-g',
    'what a f u c k i n g joke',
  ])('blocks the disguised spelling %j', (text) => {
    expect(hasObjectionableText(text)).toBe(true);
  });

  it.each([
    'Scunthorpe United',
    'Charles Dickens',
    'Claud Cockburn',
    'Matt Hancock',
    'Dick Smith',
    'Kike García',
    'Phuc Nguyen',
    'Tran Thi Bich',
    'Ahmet Kunt',
    'Aditya Shitole',
    'Niger and Nigeria',
    'a niggling doubt',
    'Shiitake and shitake mushrooms',
    'Risk assessment, Sussex and Essex',
    'Classic cocktails',
    'Flame retardant coatings',
    'Top 5 tips, class of 2015',
    'A B C D E',
    'hello@chatsoon.app',
    'f*ck', // self-censored
    '',
  ])('allows %j', (text) => {
    expect(hasObjectionableText(text)).toBe(false);
  });

  it('stays fast on long hostile input', () => {
    const start = Date.now();
    for (const text of ['$'.repeat(1e6), 'a '.repeat(5e5), 's'.repeat(1e6), 'a$'.repeat(5e5), 'ab '.repeat(3e5)]) {
      expect(hasObjectionableText(text)).toBe(false);
    }
    expect(Date.now() - start).toBeLessThan(1000);
  });
});

describe('profileInputSchema moderation', () => {
  const valid = {
    displayName: '  Peter Smith ',
    headline: 'Building Chatsoon',
    company: 'Mesh With Us',
    role: '',
    links: { website: 'meshwithus.com.au', x: '@peter' },
    avatarKey: null,
  };

  it('still parses a valid profile', () => {
    expect(profileInputSchema.parse(valid)).toEqual({
      displayName: 'Peter Smith',
      headline: 'Building Chatsoon',
      company: 'Mesh With Us',
      role: null,
      links: { website: 'meshwithus.com.au', x: '@peter' },
      avatarKey: null,
    });
  });

  it.each([
    [{ displayName: 'Sh1t Head' }, ['displayName']],
    [{ headline: 'Professional a$$hole' }, ['headline']],
    [{ company: 'Fuck Corp' }, ['company']],
    [{ role: 'Chief bullshit officer' }, ['role']],
    [{ links: { x: '@fuck_you' } }, ['links', 'x']],
  ])('rejects offensive text in %j', (patch, path) => {
    const result = profileInputSchema.safeParse({ ...valid, ...patch });
    expect(result.success).toBe(false);
    expect(result.error?.issues).toEqual([expect.objectContaining({ path, message: OFFENSIVE })]);
  });
});

describe('connectFormSchema moderation', () => {
  const valid = { name: 'Jane Doe', contact: 'jane@example.com', note: 'Great chat at the expo', turnstileToken: 't' };

  it('still parses a valid form', () => {
    expect(connectFormSchema.parse({ ...valid, note: '  ' })).toEqual({ ...valid, note: null, tipsOptIn: false });
    expect(connectFormSchema.parse(valid).note).toBe('Great chat at the expo');
  });

  it.each([
    [{ name: 'F U C K' }, ['name']],
    [{ note: 'You are a worthless c\u200bunt' }, ['note']],
  ])('rejects offensive text in %j', (patch, path) => {
    const result = connectFormSchema.safeParse({ ...valid, ...patch });
    expect(result.success).toBe(false);
    expect(result.error?.issues).toEqual([expect.objectContaining({ path, message: OFFENSIVE })]);
  });
});
