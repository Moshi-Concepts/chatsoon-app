import type { GetReferralResponse } from '@chatsoon/shared';

// The referral hub's header card and the Me/QR tab progress lines (issue #11, docs/referrals.md
// "Referral hub", "What the user sees") all describe the same three stages: progress toward the
// founder/early-adopter milestone, then toward the reward, then done. One place to compute them so
// the ring's fill, its center label and the text line under it can never disagree with each other.
// Mirrors the API's own (private) `buildProgressLine` in apps/api/src/lib/referrals.ts, used for email
// subject lines - kept separate since that one has no notion of a ring or a center label.

export interface ReferralProgress {
  /** 0 to 1, for the progress ring's fill. */
  ratio: number;
  /** e.g. "3/10", for the ring's center label. */
  centerLabel: string;
  /** e.g. "3 of 10 to Founding member", "14 of 20 to your reward", or "20 of 20" once at/past it. */
  line: string;
}

type Summary = Pick<GetReferralResponse, 'qualifiedCount' | 'founderThreshold' | 'claimThreshold' | 'founderSpotsLeft'>;

export function referralProgress({ qualifiedCount, founderThreshold, claimThreshold, founderSpotsLeft }: Summary): ReferralProgress {
  if (qualifiedCount < founderThreshold) {
    const label = founderSpotsLeft > 0 ? 'Founding member' : 'Early adopter';
    return {
      ratio: founderThreshold > 0 ? qualifiedCount / founderThreshold : 0,
      centerLabel: `${qualifiedCount}/${founderThreshold}`,
      line: `${qualifiedCount} of ${founderThreshold} to ${label}`,
    };
  }
  const capped = Math.min(qualifiedCount, claimThreshold);
  return {
    ratio: claimThreshold > 0 ? capped / claimThreshold : 0,
    centerLabel: `${capped}/${claimThreshold}`,
    line: qualifiedCount >= claimThreshold ? `${claimThreshold} of ${claimThreshold}` : `${qualifiedCount} of ${claimThreshold} to your reward`,
  };
}
