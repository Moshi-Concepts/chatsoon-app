import { describe, expect, it } from 'vitest';

import { contactLinks, errorFromBody } from '../src/client/dom';

describe('contactLinks', () => {
  it('returns nothing for an empty or missing contact', () => {
    expect(contactLinks(undefined)).toEqual([]);
    expect(contactLinks(null)).toEqual([]);
    expect(contactLinks({})).toEqual([]);
  });

  it('builds one link per usable channel, in phone/whatsapp/signal order', () => {
    const links = contactLinks({ signal: '+61491570156', phone: '+61491570156', whatsapp: '+61491570157' });
    expect(links.map((l) => l.key)).toEqual(['phone', 'whatsapp', 'signal']);
  });

  it('opens tel: in the same tab and wa.me/signal.me in a new tab', () => {
    const links = contactLinks({ phone: '+61491570156', whatsapp: '+61491570157', signal: '+61491570158' });
    const byKey = Object.fromEntries(links.map((l) => [l.key, l]));
    expect(byKey.phone).toMatchObject({ href: 'tel:+61491570156', newTab: false });
    expect(byKey.whatsapp).toMatchObject({ href: 'https://wa.me/61491570157', newTab: true });
    expect(byKey.signal).toMatchObject({ href: 'https://signal.me/#p/+61491570158', newTab: true });
  });

  it('drops a channel whose stored value is unusable, even if the key is present', () => {
    // Mirrors ContactPills: re-derives from contactUrl rather than trusting the key list, so a legacy
    // invalid value (or one injected onto the object) never renders a broken pill.
    const links = contactLinks({ phone: 'not-a-number' });
    expect(links).toEqual([]);
  });

  it('labels a WhatsApp message/qr link and a Signal username link without a number', () => {
    const links = contactLinks({ whatsapp: 'https://wa.me/message/ABC123', signal: 'https://signal.me/#eu/abcDEF012345678901234' });
    const byKey = Object.fromEntries(links.map((l) => [l.key, l]));
    expect(byKey.whatsapp?.label).toBe('WhatsApp link');
    expect(byKey.signal?.label).toBe('Signal username link');
  });
});

describe('errorFromBody', () => {
  it('reads {error:{code,message}}', () => {
    expect(errorFromBody({ error: { code: 'captcha_failed', message: 'nope' } })).toEqual({
      code: 'captcha_failed',
      message: 'nope',
    });
  });

  it('falls back to internal/null for anything else', () => {
    expect(errorFromBody(null)).toEqual({ code: 'internal', message: null });
    expect(errorFromBody({})).toEqual({ code: 'internal', message: null });
    expect(errorFromBody('oops')).toEqual({ code: 'internal', message: null });
  });
});
