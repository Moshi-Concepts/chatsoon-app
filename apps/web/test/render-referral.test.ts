import { describe, expect, it } from 'vitest';

import type { PublicReferralProfile } from '@chatsoon/shared/src/referrals';

import { escapeHtml } from '../src/render/escape';
import { renderReferral, renderReferralNotFound, type ReferralAssets } from '../src/render/referral';

const CODE = 'ABCD2345';

const REFERRAL: PublicReferralProfile = {
  displayName: 'Peter Bui',
  slug: 'peter-bui-5ec50167',
  avatarVersion: 'abcdef0123456789',
  headline: 'Building Chatsoon',
  ogVersion: 'fedcba9876543210',
};

const ASSETS: ReferralAssets = { islandUrl: '/_p/referral-testhash.js' };

describe('renderReferral', () => {
  it('renders the inviter name, the code, and the Continue-on-web CTA', () => {
    const html = renderReferral(CODE, REFERRAL, ASSETS);
    expect(html).toContain(`${REFERRAL.displayName} invited you to Chatsoon`);
    expect(html).toContain(`data-code="${CODE}"`);
    expect(html).toContain(`Your invite code is <strong>${CODE}</strong>`);
    expect(html).toContain('<a class="button button-primary button-block" href="/sign-in">Continue on web</a>');
  });

  it('reuses the data-copy island handler for the Copy button', () => {
    const html = renderReferral(CODE, REFERRAL, ASSETS);
    expect(html).toContain(`data-copy="${CODE}"`);
    expect(html).toContain(`aria-label="Copy invite code ${CODE}"`);
    expect(html).toContain('<span>Copy</span>');
  });

  it('is noindex', () => {
    const html = renderReferral(CODE, REFERRAL, ASSETS);
    expect(html).toContain('<meta name="robots" content="noindex">');
  });

  it('shows the coming-soon line (same markup/class as home.ts) when the store URLs are null', () => {
    const html = renderReferral(CODE, REFERRAL, ASSETS);
    expect(html).toContain('class="coming-soon text-callout"');
    expect(html).toContain('Coming soon to the App Store and Google Play');
    expect(html).not.toContain('store-buttons');
  });

  it('renders the headline when present, and omits it when absent', () => {
    const withHeadline = renderReferral(CODE, REFERRAL, ASSETS);
    expect(withHeadline).toContain(`<p class="profile-headline">${escapeHtml(REFERRAL.headline!)}</p>`);

    // .profile-headline's own CSS rule is always present (one shared stylesheet, css.ts), so this
    // checks for the actual markup, not the bare class-name substring.
    const withoutHeadline = renderReferral(CODE, { ...REFERRAL, headline: null }, ASSETS);
    expect(withoutHeadline).not.toMatch(/<p class="profile-headline"/);
  });

  it('never renders phone, WhatsApp or Signal values or links (there are none on this DTO to begin with)', () => {
    const html = renderReferral(CODE, REFERRAL, ASSETS);
    expect(html).not.toContain('tel:');
    expect(html).not.toContain('wa.me');
    expect(html).not.toContain('signal.me');
  });

  it('builds the avatar from avatarVersion via our own /id/<slug>/photo route, never a signed URL', () => {
    const html = renderReferral(CODE, REFERRAL, ASSETS);
    expect(html).toContain(`src="/id/${REFERRAL.slug}/photo?v=${REFERRAL.avatarVersion}"`);
    expect(html).not.toContain('files/u/');
    expect(html).not.toMatch(/[?&]sig=/);
  });

  it('renders initials with no avatarVersion', () => {
    const html = renderReferral(CODE, { ...REFERRAL, avatarVersion: null }, ASSETS);
    expect(html).not.toContain('class="referral-avatar"');
    expect(html).toContain('class="avatar"');
    expect(html).toContain('PB'); // initials of "Peter Bui"
  });

  it("uses the inviter's personalised card for og:image when ogVersion is present", () => {
    const html = renderReferral(CODE, REFERRAL, ASSETS);
    expect(html).toContain(`content="https://chatsoon.app/id/${REFERRAL.slug}/og.jpg?v=${REFERRAL.ogVersion}"`);
  });

  it('falls back to the default share image when ogVersion is null', () => {
    const html = renderReferral(CODE, { ...REFERRAL, ogVersion: null }, ASSETS);
    expect(html).not.toContain('/og.jpg?v=');
    expect(html).toContain('chatsoon-5a6e4ad4.jpg');
  });

  it('loads the referral island as the only external script', () => {
    const html = renderReferral(CODE, REFERRAL, ASSETS);
    const srcScripts = [...html.matchAll(/<script[^>]*\bsrc="([^"]+)"/g)].map((m) => m[1]);
    expect(srcScripts).toEqual([ASSETS.islandUrl]);
  });

  it('escapes a hostile display name and headline', () => {
    const evil: PublicReferralProfile = {
      ...REFERRAL,
      displayName: `A <script>alert(1)</script> & "Name"`,
      headline: `Head<line> & "quote"`,
    };
    const html = renderReferral(CODE, evil, ASSETS);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('Head<line>');
  });
});

describe('renderReferralNotFound', () => {
  it('renders a plain 404 with the coming-soon line and no invite-code UI', () => {
    const html = renderReferralNotFound('/r/BADCODE1');
    expect(html).toContain('Invite not found');
    expect(html).toContain('Coming soon to the App Store and Google Play');
    // The bad code isn't echoed into the visible body — only the canonical/og:url reflect the
    // requested path, same as status.ts's renderNotFound does for an invalid /id/:slug.
    expect(html).not.toContain('Your invite code is');
    expect(html).not.toContain('data-copy');
  });

  it('is noindex', () => {
    const html = renderReferralNotFound('/r/BADCODE1');
    expect(html).toContain('<meta name="robots" content="noindex">');
  });
});
