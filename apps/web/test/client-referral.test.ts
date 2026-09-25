/// <reference lib="dom" />
// This suite runs under vitest's 'node' environment with no DOM lib at all (see vitest.config.ts and
// client-copy.test.ts's own note) — plain fake globals via vi.stubGlobal are enough to exercise the
// pure functions src/client/referral.ts exports.

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  captureReferralFromSearch,
  normalizeReferralCode,
  writeReferralCookie,
  writeReferralLocalStorage,
} from '../src/client/referral';

// A real, valid 8-char code from REFERRAL_CODE_ALPHABET (packages/shared/src/referrals.ts: Crockford
// base32 with 0/O/1/I also removed).
const VALID_CODE = 'ABCD2345';

describe('normalizeReferralCode', () => {
  it('trims and uppercases a valid code', () => {
    expect(normalizeReferralCode(` ${VALID_CODE.toLowerCase()} `)).toBe(VALID_CODE);
  });

  it('returns null for anything that is not a real referral code', () => {
    expect(normalizeReferralCode(null)).toBeNull();
    expect(normalizeReferralCode(undefined)).toBeNull();
    expect(normalizeReferralCode('')).toBeNull();
    expect(normalizeReferralCode('short')).toBeNull();
    expect(normalizeReferralCode('ABCD23I5')).toBeNull(); // 'I' isn't in the alphabet
    expect(normalizeReferralCode('ABCD23O5')).toBeNull(); // neither is 'O'
  });
});

describe('writeReferralCookie', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('sets cs_ref with the documented attributes', () => {
    const doc = { cookie: '' };
    vi.stubGlobal('document', doc);
    writeReferralCookie(VALID_CODE);
    expect(doc.cookie).toBe(`cs_ref=${VALID_CODE}; Path=/; Max-Age=2592000; SameSite=Lax; Secure`);
  });

  it('never throws when document.cookie is blocked', () => {
    vi.stubGlobal('document', {
      get cookie() {
        return '';
      },
      set cookie(_v: string) {
        throw new Error('blocked');
      },
    });
    expect(() => writeReferralCookie(VALID_CODE)).not.toThrow();
  });
});

describe('writeReferralLocalStorage', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('stores the code under cs_ref', () => {
    const store: Record<string, string> = {};
    vi.stubGlobal('localStorage', { setItem: (k: string, v: string) => (store[k] = v) });
    writeReferralLocalStorage(VALID_CODE);
    expect(store.cs_ref).toBe(VALID_CODE);
  });

  it('never throws when localStorage is blocked', () => {
    vi.stubGlobal('localStorage', {
      setItem: () => {
        throw new Error('blocked');
      },
    });
    expect(() => writeReferralLocalStorage(VALID_CODE)).not.toThrow();
  });
});

describe('captureReferralFromSearch', () => {
  afterEach(() => vi.unstubAllGlobals());

  function stubStorage() {
    const doc = { cookie: '' };
    const store: Record<string, string> = {};
    vi.stubGlobal('document', doc);
    vi.stubGlobal('localStorage', { setItem: (k: string, v: string) => (store[k] = v) });
    return { doc, store };
  }

  it('writes the cookie and localStorage for a valid ?ref= (any case)', () => {
    const { doc, store } = stubStorage();
    captureReferralFromSearch(`?ref=${VALID_CODE.toLowerCase()}`);
    expect(doc.cookie).toBe(`cs_ref=${VALID_CODE}; Path=/; Max-Age=2592000; SameSite=Lax; Secure`);
    expect(store.cs_ref).toBe(VALID_CODE);
  });

  it('ignores a missing ref param', () => {
    const { doc, store } = stubStorage();
    captureReferralFromSearch('');
    captureReferralFromSearch('?other=1');
    expect(doc.cookie).toBe('');
    expect(store.cs_ref).toBeUndefined();
  });

  it('ignores an invalid ref param', () => {
    const { doc, store } = stubStorage();
    captureReferralFromSearch('?ref=not-a-real-code');
    expect(doc.cookie).toBe('');
    expect(store.cs_ref).toBeUndefined();
  });
});
