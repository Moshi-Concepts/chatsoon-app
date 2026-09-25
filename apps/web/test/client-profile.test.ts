import { describe, expect, it } from 'vitest';

import { readConfig } from '../src/client/profile';

const full = { slug: 'peter-bui-5ec50167', api: 'https://api.chatsoon.app', sitekey: 'sk', first: 'Peter' };

describe('readConfig', () => {
  it('reads the #page data attributes', () => {
    expect(readConfig({ ...full, visibility: 'public' })).toEqual({ ...full, visibility: 'public' });
  });

  it('defaults visibility to connections when absent or anything other than "public"', () => {
    expect(readConfig({ ...full })?.visibility).toBe('connections');
    expect(readConfig({ ...full, visibility: 'connections' })?.visibility).toBe('connections');
    expect(readConfig({ ...full, visibility: 'nonsense' })?.visibility).toBe('connections');
  });

  it('is null when a required attribute is missing', () => {
    expect(readConfig({ api: full.api, sitekey: full.sitekey, first: full.first })).toBeNull();
    expect(readConfig({ slug: full.slug, sitekey: full.sitekey, first: full.first })).toBeNull();
    expect(readConfig({ slug: full.slug, api: full.api, first: full.first })).toBeNull();
    expect(readConfig({ slug: full.slug, api: full.api, sitekey: full.sitekey })).toBeNull();
  });
});
