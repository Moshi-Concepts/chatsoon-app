import { describe, expect, it } from 'vitest';

import { buildReportPayload, mapReportError } from '../src/client/report';

describe('buildReportPayload', () => {
  it('trims details and turns blank details into null', () => {
    expect(buildReportPayload('peter-bui-5ec50167', 'spam', '  looks like a scam  ')).toEqual({
      targetSlug: 'peter-bui-5ec50167',
      reason: 'spam',
      details: 'looks like a scam',
    });
    expect(buildReportPayload('peter-bui-5ec50167', 'other', '   ')).toEqual({
      targetSlug: 'peter-bui-5ec50167',
      reason: 'other',
      details: null,
    });
  });
});

describe('mapReportError', () => {
  it('maps rate_limited and a 404 to their own copy', () => {
    expect(mapReportError(429, 'rate_limited', 'server said no')).toMatch(/Too many reports/);
    expect(mapReportError(404, 'not_found', 'server said no')).toMatch(/isn't available any more/);
  });

  it('falls back to the server message, then report-dialog.tsx\'s own generic fallback', () => {
    expect(mapReportError(500, 'internal', 'server exploded')).toBe('server exploded');
    expect(mapReportError(500, 'internal', null)).toBe("Your report didn't send. Please try again.");
  });
});
