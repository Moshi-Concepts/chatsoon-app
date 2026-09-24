import { describe, expect, it } from 'vitest';

import { contactInputSchema, profileInputSchema } from './schemas';
import {
  CONTACT_HINTS,
  changedKeys,
  contactUrl,
  displayContact,
  parseIntlPhone,
  profileContactChannels,
} from './profile-contact';

describe('parseIntlPhone', () => {
  it.each([
    ['+61 491 570 156', '+61491570156'],
    ['(+61) 491 570 156', '+61491570156'],
    ['+61 (0) 491 570 156', '+61491570156'],
    ['+61-491.570.156', '+61491570156'],
    ['tel:+61491570156', '+61491570156'],
    ['TEL:+61491570156', '+61491570156'],
    ['+1 415 555 0132', '+14155550132'],
    ['+39 06 1234 5678', '+390612345678'],
    ['+290 1234', '+2901234'], // 7 digits: the minimum
    ['＋６１ ４９１ ５７０ １５６', '+61491570156'], // full-width digits and plus sign (NFKC)
    ['​ +61 491 570 156 ​', '+61491570156'], // wrapped in NBSP and zero-width chars
  ])('accepts %j as %j', (input, expected) => {
    expect(parseIntlPhone(input)).toBe(expected);
  });

  it.each([
    [''],
    ['0491 570 156'], // trunk '0', not '+'
    ['0061 491 570 156'], // '00' international prefix: differs by country, can't be mapped to '+'
    ['000'],
    ['+61 000'], // too few digits
    ['+0 123 4567'], // first digit after '+' must be 1-9
    ['+1234567890123456'], // 16 digits: one over the limit
    ['+61 491 570 156 ext 12'], // no extensions
    ['+1 800 FLOWERS'], // letters
    ['*21*+61491570156#'], // dial code wrapper
    ['++61491570156'], // a second '+'
    ['+61 491 +570'], // a second '+', mid-string
    ['+61/491570156'], // a slash
    ['javascript:alert(1)'],
    [`+${'1'.repeat(70)}`], // 65+ characters
  ])('rejects %j', (input) => {
    expect(parseIntlPhone(input)).toBeNull();
  });
});

describe("contactUrl('whatsapp')", () => {
  it.each([
    ['a typed number', '+61 491 570 156', 'https://wa.me/61491570156'],
    ['a wa.me link with a leading +, with the query dropped', 'https://wa.me/+61491570156?text=Hi', 'https://wa.me/61491570156'],
    ['a bare wa.me digit link with www and a trailing slash', 'https://www.wa.me/61491570156/', 'https://wa.me/61491570156'],
    [
      'a WhatsApp Business API link with a percent-encoded +',
      'https://api.whatsapp.com/send?foo=bar&phone=%2B61491570156',
      'https://wa.me/61491570156',
    ],
    ['a whatsapp:// app deep link', 'whatsapp://send?phone=+61491570156', 'https://wa.me/61491570156'],
    ['a wa.me/message link, lower-casing the kind, code as typed', 'https://wa.me/Message/AbC123XY', 'https://wa.me/message/AbC123XY'],
    ['a wa.me/qr link', 'https://wa.me/qr/AbC123XY', 'https://wa.me/qr/AbC123XY'],
  ])('accepts %s', (_label, input, expected) => {
    expect(contactUrl('whatsapp', input)).toBe(expected);
  });

  it.each([
    ['chat.whatsapp.com/AbC'],
    ['whatsapp.com/channel/x'],
    ['wa.link/x'],
    ['https://wa.me.evil.com/61491570156'], // host matched exactly, never by suffix
    ['evilwa.me/61491570156'],
    ['wa.me/0491570156'], // digits re-checked as a phone number, and '0491...' isn't one
    ['wa.me'], // no path
    ['wa.me/614 91570156'], // whitespace inside
    ['wa.me/61@491570156'], // '@' inside
  ])('rejects %j', (input) => {
    expect(contactUrl('whatsapp', input)).toBeNull();
  });
});

describe("contactUrl('signal')", () => {
  // TODO(peter): swap for a real signal.me/#eu/... link once you send one.
  const EU_FIXTURE = 'TODOReplaceWithARealSignalUsernameLink123';

  it('turns a number into a #p link', () => {
    expect(contactUrl('signal', '+61 491 570 156')).toBe('https://signal.me/#p/+61491570156');
  });

  it('rewrites sgnl:// to https:// and decodes the percent-encoded +', () => {
    expect(contactUrl('signal', 'sgnl://signal.me/#p/%2B61491570156')).toBe('https://signal.me/#p/+61491570156');
  });

  it('passes an #eu username link through unchanged', () => {
    expect(contactUrl('signal', `https://signal.me/#eu/${EU_FIXTURE}`)).toBe(`https://signal.me/#eu/${EU_FIXTURE}`);
  });

  it.each([
    ['peter.42'], // a bare username: nothing a saved value can open
    ['https://signal.group/#CjQKIGZha2Vncm91cGlkZmFrZWZha2VmYWtlZmFrZWZha2Vm'], // a group invite, not a contact
    [`https://signal.me/#eu/${'a'.repeat(10)}<script>${'a'.repeat(10)}`], // '<' inside the id
    [`https://signal.me/#eu/${'a'.repeat(10)}"quote"${'a'.repeat(10)}`], // '"' inside the id
    ['signal.me'], // no path
  ])('rejects %j', (input) => {
    expect(contactUrl('signal', input)).toBeNull();
  });
});

describe('displayContact', () => {
  it('phone: shown as typed, with a tel: prefix stripped', () => {
    expect(displayContact('phone', '+61 491 570 156')).toBe('+61 491 570 156');
    expect(displayContact('phone', 'tel:+61491570156')).toBe('+61491570156');
    expect(displayContact('phone', '000')).toBeNull();
  });

  it('whatsapp: a typed number is shown as typed, a pasted link as +<digits>', () => {
    expect(displayContact('whatsapp', '+61 491 570 156')).toBe('+61 491 570 156');
    expect(displayContact('whatsapp', 'https://wa.me/+61491570156')).toBe('+61491570156');
    expect(displayContact('whatsapp', 'https://wa.me/message/AbC123XY')).toBe('WhatsApp link');
    expect(displayContact('whatsapp', 'https://wa.me/qr/AbC123XY')).toBe('WhatsApp link');
    expect(displayContact('whatsapp', 'not a number')).toBeNull();
  });

  it('signal: a typed number is shown as typed, a pasted link as +<digits>, a username link named', () => {
    expect(displayContact('signal', '+61 491 570 156')).toBe('+61 491 570 156');
    expect(displayContact('signal', 'https://signal.me/#p/+61491570156')).toBe('+61491570156');
    expect(displayContact('signal', 'https://signal.me/#eu/TODOReplaceWithARealSignalUsernameLink123')).toBe(
      'Signal username link',
    );
    expect(displayContact('signal', 'peter.42')).toBeNull();
  });
});

describe('profileContactChannels', () => {
  it('returns only usable keys, in CONTACT_KEYS order, whatever the insertion order', () => {
    expect(profileContactChannels({ signal: '+61 491 570 156', phone: '+61 491 570 156' })).toEqual([
      'phone',
      'signal',
    ]);
    expect(profileContactChannels({ phone: '000', whatsapp: '+61 491 570 156' })).toEqual(['whatsapp']);
    expect(profileContactChannels({})).toEqual([]);
  });
});

describe('changedKeys', () => {
  it('returns only the keys whose value differs, with the new value', () => {
    expect(
      changedKeys({ phone: 'a', whatsapp: 'b', signal: 'c' }, { phone: 'a', whatsapp: 'B', signal: '' }),
    ).toEqual({ whatsapp: 'B', signal: '' });
    expect(changedKeys({ phone: 'a' }, { phone: 'a' })).toEqual({});
  });
});

describe('contactInputSchema', () => {
  it('turns an empty string into null', () => {
    expect(contactInputSchema.parse({ phone: '' })).toEqual({ phone: null });
  });

  it('rejects a 41-character phone with the phone hint', () => {
    const result = contactInputSchema.safeParse({ phone: '1'.repeat(41) });
    expect(result.success).toBe(false);
    expect(result.success || result.error.issues[0]?.message).toBe(CONTACT_HINTS.phone);
  });

  it('rejects an invalid phone with the phone hint', () => {
    const result = contactInputSchema.safeParse({ phone: '000' });
    expect(result.success).toBe(false);
    expect(result.success || result.error.issues[0]?.message).toBe(CONTACT_HINTS.phone);
  });

  it('rejects offensive text in signal', () => {
    expect(contactInputSchema.safeParse({ signal: 'fuck you' }).success).toBe(false);
  });

  it('strips an unknown key', () => {
    const parsed = contactInputSchema.parse({ phone: '+61 491 570 156', wechat: 'peter42' } as never);
    expect(parsed).not.toHaveProperty('wechat');
    expect(parsed.phone).toBe('+61 491 570 156');
  });
});

describe('profileInputSchema', () => {
  it('leaves `contact` undefined when not provided', () => {
    expect(profileInputSchema.parse({ displayName: 'Peter Bui' }).contact).toBeUndefined();
  });
});
