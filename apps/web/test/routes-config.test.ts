import { describe, expect, it } from 'vitest';

import { ROUTES_JSON_INCLUDE } from '../src/server/routes-config';

// scripts/build.ts's writeRoutesJson uses this list verbatim for dist/_routes.json's `include`. Pulled
// out to its own module (see routes-config.ts's own comment) so this test can check it without running
// the rest of scripts/build.ts.
describe('ROUTES_JSON_INCLUDE', () => {
  it('includes /r/* alongside the existing profile and sitemap routes (issue #11)', () => {
    expect(ROUTES_JSON_INCLUDE).toContain('/r/*');
    expect(ROUTES_JSON_INCLUDE).toEqual(['/id/*', '/sitemap-profiles.xml', '/r/*']);
  });
});
