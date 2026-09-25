import { ApiError } from './api';

// Shared between onboarding.tsx's "Did someone invite you?" field and the hub's "Enter a code" row -
// both call POST /me/referral/attribute the same way (issue #11, docs/referrals.md "How attribution
// works"), so both need the exact same friendly copy for the same error codes.

export function referralAttributeErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case 'referral_self':
        return "That's your own code - ask your friend for theirs.";
      case 'referral_window_closed':
        return 'Referral codes only work in your first two weeks on Chatsoon.';
      case 'referral_already_attributed':
        return "You've already used a referral code.";
      case 'not_found':
        return "We couldn't find that code. Double-check it and try again.";
      case 'referral_disabled':
        return 'Referrals are turned off right now.';
    }
    if (err.status === 0) return err.message;
  }
  return "That code didn't work. Please try again.";
}
