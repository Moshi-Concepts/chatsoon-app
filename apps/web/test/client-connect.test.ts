import { describe, expect, it } from 'vitest';

import { buildConnectPayload, buildSuccessContent, mapConnectError, validateConnectForm } from '../src/client/connect';

describe('validateConnectForm', () => {
  const valid = { name: 'Jordan Lee', contact: 'jordan@example.com', note: '' };

  it('passes a valid submission', () => {
    expect(validateConnectForm(valid)).toBeNull();
  });

  it('requires a name', () => {
    expect(validateConnectForm({ ...valid, name: '  ' })).toEqual({ name: 'Name is required' });
  });

  it('requires a contact', () => {
    expect(validateConnectForm({ ...valid, contact: '' })).toEqual({ contact: 'Add an email or handle' });
  });

  it('rejects a name over CONNECT_FORM_MAX.name characters', () => {
    const errors = validateConnectForm({ ...valid, name: 'a'.repeat(121) });
    expect(errors?.name).toMatch(/120/);
  });

  it('rejects a contact over CONNECT_FORM_MAX.contact characters', () => {
    const errors = validateConnectForm({ ...valid, contact: 'a'.repeat(201) });
    expect(errors?.contact).toMatch(/200/);
  });

  it('rejects a note over CONNECT_FORM_MAX.note characters', () => {
    const errors = validateConnectForm({ ...valid, note: 'a'.repeat(1001) });
    expect(errors?.note).toMatch(/1000/);
  });

  it('allows an empty, optional note', () => {
    expect(validateConnectForm({ ...valid, note: '' })).toBeNull();
  });
});

describe('buildConnectPayload', () => {
  it('trims every field and carries the token through', () => {
    expect(buildConnectPayload({ name: ' Jordan ', contact: ' jordan@example.com ', note: ' hi ' }, 'tok')).toEqual({
      name: 'Jordan',
      contact: 'jordan@example.com',
      note: 'hi',
      turnstileToken: 'tok',
    });
  });
});

describe('mapConnectError', () => {
  it('maps captcha_failed, rate_limited and a 404 to the shared copy', () => {
    expect(mapConnectError(403, 'captcha_failed', 'server said no')).toMatch(/spam check failed/);
    expect(mapConnectError(429, 'rate_limited', 'server said no')).toMatch(/Too many attempts/);
    expect(mapConnectError(404, 'not_found', 'server said no')).toMatch(/isn't available any more/);
  });

  it('falls back to the server message, then a generic one', () => {
    expect(mapConnectError(500, 'internal', 'server exploded')).toBe('server exploded');
    expect(mapConnectError(500, 'internal', null)).toBe('Something went wrong. Please try again.');
  });
});

describe('buildSuccessContent', () => {
  const config = { api: 'https://api.chatsoon.app', slug: 'peter-bui-5ec50167', sitekey: 'sk', first: 'Peter' };

  it('greets the visitor by the owner\'s first name', () => {
    expect(buildSuccessContent(config, { ok: true }).heading).toBe('Sent. Peter now has your details.');
  });

  it('builds pills from the response contact', () => {
    const content = buildSuccessContent(config, { ok: true, contact: { phone: '+61491570156' } });
    expect(content.pills).toEqual([{ key: 'phone', href: 'tel:+61491570156', label: '+61491570156', newTab: false }]);
  });

  it('uses the response vcardUrl when present, and the API default otherwise', () => {
    const withUrl = buildSuccessContent(config, { ok: true, contact: { phone: '+61491570156' }, vcardUrl: 'https://signed' });
    expect(withUrl.saveContactHref).toBe('https://signed');

    const withoutUrl = buildSuccessContent(config, { ok: true, contact: { phone: '+61491570156' } });
    expect(withoutUrl.saveContactHref).toBe('https://api.chatsoon.app/id/peter-bui-5ec50167/vcard');
  });

  it('has no save-contact link when the response carries no contact', () => {
    expect(buildSuccessContent(config, { ok: true }).saveContactHref).toBeNull();
  });
});
