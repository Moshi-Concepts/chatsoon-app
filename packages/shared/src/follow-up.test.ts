import { describe, expect, it } from 'vitest';

import {
  composeFollowUpMessage,
  followUpChannelAvailable,
  followUpDueAt,
  followUpMailtoUrl,
  followUpSignature,
  followUpSmsWebUrl,
  followUpTemplateBody,
  followUpWhatsAppUrl,
  isFollowUpDue,
  remindDueAt,
} from './follow-up';

const day = (n: number) => n * 24 * 60 * 60 * 1000;

describe('followUpDueAt', () => {
  const createdAt = new Date('2026-09-26T10:00:00.000Z');

  it('is due immediately for priority 5 or 4', () => {
    expect(followUpDueAt(5, createdAt)).toEqual(createdAt);
    expect(followUpDueAt(4, createdAt)).toEqual(createdAt);
  });

  it('is due the next day for priority 3 or no priority', () => {
    const expected = new Date(createdAt.getTime() + day(1));
    expect(followUpDueAt(3, createdAt)).toEqual(expected);
    expect(followUpDueAt(null, createdAt)).toEqual(expected);
    expect(followUpDueAt(undefined, createdAt)).toEqual(expected);
  });

  it('is due in two days for priority 2 or 1', () => {
    const expected = new Date(createdAt.getTime() + day(2));
    expect(followUpDueAt(2, createdAt)).toEqual(expected);
    expect(followUpDueAt(1, createdAt)).toEqual(expected);
  });
});

describe('isFollowUpDue', () => {
  const now = new Date('2026-09-26T12:00:00.000Z');

  it('is false with no due date', () => {
    expect(isFollowUpDue({ followUpDueAt: null }, now)).toBe(false);
  });

  it('is true once the due date has passed, and false before it', () => {
    expect(isFollowUpDue({ followUpDueAt: new Date(now.getTime() - 1000).toISOString() }, now)).toBe(true);
    expect(isFollowUpDue({ followUpDueAt: now.toISOString() }, now)).toBe(true);
    expect(isFollowUpDue({ followUpDueAt: new Date(now.getTime() + 1000).toISOString() }, now)).toBe(false);
  });
});

describe('remindDueAt', () => {
  const from = new Date('2026-09-26T10:00:00.000Z');

  it('adds the chosen number of days', () => {
    expect(remindDueAt(3, from)).toEqual(new Date(from.getTime() + day(3)));
    expect(remindDueAt(7, from)).toEqual(new Date(from.getTime() + day(7)));
    expect(remindDueAt(14, from)).toEqual(new Date(from.getTime() + day(14)));
  });

  it('is null for "Never"', () => {
    expect(remindDueAt(null, from)).toBeNull();
  });
});

describe('follow-up message', () => {
  it('builds the template body with and without an event', () => {
    expect(followUpTemplateBody('Marcus', 'Token2049')).toBe(
      "Hi Marcus, great to meet you at Token2049! Let's keep in touch.",
    );
    expect(followUpTemplateBody('Marcus', null)).toBe("Hi Marcus, great to meet you! Let's keep in touch.");
    expect(followUpTemplateBody('Marcus', undefined)).toBe("Hi Marcus, great to meet you! Let's keep in touch.");
  });

  it('always appends the fixed signature after the body', () => {
    const body = followUpTemplateBody('Marcus', null);
    const signature = followUpSignature('Peter Bui', 'https://chatsoon.app/r/ABCD1234');
    expect(signature).toBe('Chat soon,\nPeter Bui\n\nGet your own Chatsoon profile: https://chatsoon.app/r/ABCD1234');
    expect(composeFollowUpMessage(body, signature)).toBe(
      "Hi Marcus, great to meet you! Let's keep in touch.\n\n" +
        'Chat soon,\nPeter Bui\n\nGet your own Chatsoon profile: https://chatsoon.app/r/ABCD1234',
    );
  });
});

describe('followUpChannelAvailable', () => {
  const base = { phone: null, email: null, telegram: null, linkedinUrl: null, xHandle: null };

  it('is available only when the contact has usable data for it', () => {
    expect(followUpChannelAvailable('whatsapp', base)).toBe(false);
    expect(followUpChannelAvailable('whatsapp', { ...base, phone: '+61 491 570 156' })).toBe(true);
    expect(followUpChannelAvailable('sms', { ...base, phone: '+61 491 570 156' })).toBe(true);
    expect(followUpChannelAvailable('email', base)).toBe(false);
    expect(followUpChannelAvailable('email', { ...base, email: 'marcus@example.com' })).toBe(true);
    expect(followUpChannelAvailable('telegram', { ...base, telegram: 'marcus_chen' })).toBe(true);
    expect(followUpChannelAvailable('linkedin', { ...base, linkedinUrl: 'https://linkedin.com/in/marcus' })).toBe(
      true,
    );
    expect(followUpChannelAvailable('x', { ...base, xHandle: 'marcus' })).toBe(true);
  });

  it('copy is always available', () => {
    expect(followUpChannelAvailable('copy', base)).toBe(true);
  });
});

describe('send target URLs', () => {
  it('builds a WhatsApp deep link with the digits and encoded text', () => {
    expect(followUpWhatsAppUrl('+61 491 570 156', "Hi there!")).toBe(
      'https://wa.me/61491570156?text=Hi%20there!',
    );
    expect(followUpWhatsAppUrl(null, 'x')).toBeNull();
    expect(followUpWhatsAppUrl('not a phone', 'x')).toBeNull();
  });

  it('builds an sms: link with the ?& separator', () => {
    expect(followUpSmsWebUrl('+61 491 570 156', 'Hi there!')).toBe('sms:+61491570156?&body=Hi%20there!');
    expect(followUpSmsWebUrl(null, 'x')).toBeNull();
  });

  it('builds a mailto: link with a fixed subject and the encoded body', () => {
    expect(followUpMailtoUrl('marcus@example.com', 'Hi there!')).toBe(
      'mailto:marcus@example.com?subject=Great%20to%20meet%20you&body=Hi%20there!',
    );
    expect(followUpMailtoUrl(null, 'x')).toBeNull();
    expect(followUpMailtoUrl('not an email', 'x')).toBeNull();
  });
});
