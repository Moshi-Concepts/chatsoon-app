import { describe, expect, it } from 'vitest';

import { DISCORD_EPOCH_MS, discordCreatedAt, discordEligible, xEligible } from './social';

describe('discordCreatedAt', () => {
  it('decodes a known snowflake to the right creation date', () => {
    // Discord's own docs example snowflake: 175928847299117063 -> 2016-04-30T11:18:25.796Z.
    // https://discord.com/developers/docs/reference#snowflakes
    expect(discordCreatedAt('175928847299117063')).toBe(Date.parse('2016-04-30T11:18:25.796Z'));
  });

  it('decodes the epoch id (0) to the Discord epoch itself', () => {
    expect(discordCreatedAt('0')).toBe(DISCORD_EPOCH_MS);
  });
});

describe('discordEligible', () => {
  const DAY_MS = 86_400_000;
  const minAgeDays = 90;
  // Comfortably after DISCORD_EPOCH_MS so every `createdAt` below is a valid (positive) snowflake.
  const now = 2_000_000_000_000;

  /** Builds a Discord id whose decoded creation time is exactly `unixMs` (exact round trip with discordCreatedAt). */
  const snowflakeCreatedAt = (unixMs: number) => (BigInt(unixMs - DISCORD_EPOCH_MS) << 22n).toString();

  it('is false without mfa, even for an old account', () => {
    const id = snowflakeCreatedAt(now - minAgeDays * DAY_MS);
    expect(discordEligible({ providerAccountId: id, mfaEnabled: false }, minAgeDays, now)).toBe(false);
  });

  it('is false one millisecond under the boundary (created one ms too recently)', () => {
    const id = snowflakeCreatedAt(now - minAgeDays * DAY_MS + 1);
    expect(discordEligible({ providerAccountId: id, mfaEnabled: true }, minAgeDays, now)).toBe(false);
  });

  it('is true at exactly the boundary (created exactly minAgeDays ago)', () => {
    const id = snowflakeCreatedAt(now - minAgeDays * DAY_MS);
    expect(discordEligible({ providerAccountId: id, mfaEnabled: true }, minAgeDays, now)).toBe(true);
  });

  it('is true comfortably past the boundary with mfa on', () => {
    const id = snowflakeCreatedAt(now - (minAgeDays + 10) * DAY_MS);
    expect(discordEligible({ providerAccountId: id, mfaEnabled: true }, minAgeDays, now)).toBe(true);
  });
});

describe('xEligible', () => {
  const minFollowers = 50;

  it('is false when unverified, regardless of followers', () => {
    expect(xEligible({ verified: false, identityVerified: false, followersCount: 10_000 }, minFollowers)).toBe(false);
  });

  it("never counts verified_type 'none' as verified (caller passes verified: false for it)", () => {
    // The caller is responsible for mapping `verified_type === 'none'` to `verified: false`
    // (lib/auth.ts's twitter getUserInfo); this asserts xEligible itself never treats an
    // otherwise-truthy `verified` as enough without also checking it, i.e. no accidental OR-bypass.
    expect(xEligible({ verified: false, identityVerified: false, followersCount: 1000 }, minFollowers)).toBe(false);
  });

  it('is false one follower under the boundary', () => {
    expect(xEligible({ verified: true, identityVerified: false, followersCount: minFollowers - 1 }, minFollowers)).toBe(
      false,
    );
  });

  it('is true at exactly the follower boundary when verified', () => {
    expect(xEligible({ verified: true, identityVerified: false, followersCount: minFollowers }, minFollowers)).toBe(true);
  });

  it('is true at exactly the follower boundary when only identity verified', () => {
    expect(xEligible({ verified: false, identityVerified: true, followersCount: minFollowers }, minFollowers)).toBe(
      true,
    );
  });

  it('is true well past the boundary when both verified and identity verified', () => {
    expect(xEligible({ verified: true, identityVerified: true, followersCount: minFollowers + 1000 }, minFollowers)).toBe(
      true,
    );
  });
});
