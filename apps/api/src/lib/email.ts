import { APP_NAME, BADGE_LABELS, COPYRIGHT, SUPPORT_EMAIL, TAGLINE, type Badge } from '@chatsoon/shared';

import type { Env } from '../env';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
  /** Extra headers Resend should set, e.g. the RFC 8058 List-Unsubscribe pair on a tips email. */
  headers?: Record<string, string>;
}

/** In 'log' mode every message is also pushed here (synchronously) so tests can read sign-in codes. */
export function capturedEmails(): EmailMessage[] {
  const g = globalThis as { __chatsoonSentEmails?: EmailMessage[] };
  return (g.__chatsoonSentEmails ??= []);
}

const RESEND_URL = 'https://api.resend.com/emails';
/** Per attempt. Three slow attempts plus the waits still finish inside waitUntil's 30 seconds. */
const SEND_TIMEOUT_MS = 8_000;
const SEND_ATTEMPTS = 3;
const MAX_RETRY_WAIT_MS = 2_000;

/** Resend answers 429 above the account's per-second limit (a burst of sign-ins). 5xx is transient. */
const isRetryable = (status: number) => status === 429 || status >= 500;

/** Retry-After (seconds) when Resend sends it, capped, else a short linear backoff. */
function retryWaitMs(res: Response, attempt: number): number {
  const header = res.headers.get('retry-after');
  const seconds = header === null ? Number.NaN : Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, MAX_RETRY_WAIT_MS);
  return 500 * attempt;
}

/** Sends a transactional email via EMAIL_PROVIDER ('resend' | 'log'). Throws on provider errors. */
export async function sendEmail(env: Env, msg: EmailMessage): Promise<void> {
  if (env.EMAIL_PROVIDER === 'log') {
    capturedEmails().push(msg);
    console.log(`[email:log] to=${msg.to} subject=${msg.subject}\n${msg.text}`);
    return;
  }
  if (env.EMAIL_PROVIDER !== 'resend') {
    throw new Error(`Unknown EMAIL_PROVIDER "${String(env.EMAIL_PROVIDER)}", expected "resend" or "log"`);
  }
  if (!env.RESEND_API_KEY) throw new Error('RESEND_API_KEY is not set, cannot send email');

  const body = JSON.stringify({
    from: env.EMAIL_FROM,
    to: [msg.to],
    reply_to: msg.replyTo ?? SUPPORT_EMAIL,
    subject: msg.subject,
    text: msg.text,
    ...(msg.html ? { html: msg.html } : {}),
    // The Resend API takes an object of extra headers to set on the outgoing message.
    ...(msg.headers ? { headers: msg.headers } : {}),
  });
  // One key for every attempt, so a retry after a lost response never delivers the email twice.
  const idempotencyKey = crypto.randomUUID();

  for (let attempt = 1; ; attempt++) {
    const res = await fetch(RESEND_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
      body,
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    if (res.ok) return;
    // Reading the body also releases the connection before a retry.
    const detail = (await res.text().catch(() => '')).slice(0, 500);
    if (attempt < SEND_ATTEMPTS && isRetryable(res.status)) {
      await new Promise((resolve) => setTimeout(resolve, retryWaitMs(res, attempt)));
      continue;
    }
    throw new Error(`Resend rejected email to ${msg.to} (${res.status}): ${detail || res.statusText}`);
  }
}

// ---------------------------------------------------------------------------
// Templates. Inline CSS and table layout only: most mail clients drop <style> blocks.
// ---------------------------------------------------------------------------

const BRAND = '#5146E5';
const INK = '#12131A';
const MUTED = '#5C5F72';
const FAINT = '#8A8DA1';
const PAGE = '#F6F6FA';
const CODE_BG = '#ECEBFF';
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const MONO = "'SF Mono', SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace";

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

/** The sign-in code email. The code appears once in the text body, as a standalone number. */
export function signInCodeEmail(code: string): RenderedEmail {
  const year = new Date().getUTCFullYear();
  const subject = `${code} is your ${APP_NAME} code`;

  const text = [
    `Your ${APP_NAME} sign-in code is:`,
    '',
    code,
    '',
    'Enter it in the app to sign in. It expires in 10 minutes.',
    '',
    "If you didn't request this, you can ignore this email. Nobody can sign in without the code.",
    '',
    '--',
    `${APP_NAME}. ${TAGLINE}`,
    `Questions? ${SUPPORT_EMAIL}`,
    `© ${year} ${COPYRIGHT}`,
  ].join('\n');

  const safeCode = escapeHtml(code);
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background-color:${PAGE};-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${PAGE};">Your ${APP_NAME} code is ${safeCode}. It expires in 10 minutes.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${PAGE};">
  <tr>
    <td align="center" style="padding:40px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;">
        <tr>
          <td style="padding:0 8px 20px 8px;font-family:${FONT};font-size:22px;line-height:28px;font-weight:700;color:${BRAND};letter-spacing:-0.3px;">${APP_NAME}</td>
        </tr>
        <tr>
          <td style="background-color:#FFFFFF;border-radius:16px;padding:36px 32px;border:1px solid #E2E2EC;">
            <p style="margin:0 0 8px 0;font-family:${FONT};font-size:20px;line-height:28px;font-weight:700;color:${INK};">Your sign-in code</p>
            <p style="margin:0 0 24px 0;font-family:${FONT};font-size:15px;line-height:22px;color:${MUTED};">Enter this code in ${APP_NAME} to sign in.</p>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td align="center" style="background-color:${CODE_BG};border-radius:12px;padding:20px 12px;font-family:${MONO};font-size:36px;line-height:44px;font-weight:700;letter-spacing:10px;color:${BRAND};">${safeCode}</td>
              </tr>
            </table>
            <p style="margin:24px 0 0 0;font-family:${FONT};font-size:15px;line-height:22px;color:${INK};">This code expires in 10 minutes.</p>
            <p style="margin:12px 0 0 0;font-family:${FONT};font-size:14px;line-height:21px;color:${MUTED};">If you didn't request this, you can ignore this email. Nobody can sign in without the code.</p>
          </td>
        </tr>
        <tr>
          <td style="padding:24px 8px 0 8px;font-family:${FONT};font-size:12px;line-height:18px;color:${FAINT};">
            ${APP_NAME}. ${TAGLINE}<br>
            Questions? <a href="mailto:${SUPPORT_EMAIL}" style="color:${BRAND};text-decoration:none;">${SUPPORT_EMAIL}</a><br>
            &copy; ${year} ${escapeHtml(COPYRIGHT)}
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;

  return { subject, text, html };
}

// ---------------------------------------------------------------------------
// Account deletion (issue #8). Nothing the user typed ever goes into either of these.
// ---------------------------------------------------------------------------

/** "Sunday 27 September 2026 at 09:30 UTC". Always UTC, spelled out so it reads the same in every timezone. */
function formatDeletionTime(date: Date): string {
  const weekday = date.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
  const month = date.toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' });
  const day = date.getUTCDate();
  const year = date.getUTCFullYear();
  const hh = String(date.getUTCHours()).padStart(2, '0');
  const mm = String(date.getUTCMinutes()).padStart(2, '0');
  return `${weekday} ${day} ${month} ${year} at ${hh}:${mm} UTC`;
}

/** Shared footer, identical to signInCodeEmail's, factored out for the two templates below. */
function footerHtml(year: number): string {
  return `<tr>
          <td style="padding:24px 8px 0 8px;font-family:${FONT};font-size:12px;line-height:18px;color:${FAINT};">
            ${APP_NAME}. ${TAGLINE}<br>
            Questions? <a href="mailto:${SUPPORT_EMAIL}" style="color:${BRAND};text-decoration:none;">${SUPPORT_EMAIL}</a><br>
            &copy; ${year} ${escapeHtml(COPYRIGHT)}
          </td>
        </tr>`;
}

function shellHtml(subject: string, preheader: string, cardHtml: string, footer?: string): string {
  const year = new Date().getUTCFullYear();
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background-color:${PAGE};-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${PAGE};">${escapeHtml(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${PAGE};">
  <tr>
    <td align="center" style="padding:40px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;">
        <tr>
          <td style="padding:0 8px 20px 8px;font-family:${FONT};font-size:22px;line-height:28px;font-weight:700;color:${BRAND};letter-spacing:-0.3px;">${APP_NAME}</td>
        </tr>
        <tr>
          <td style="background-color:#FFFFFF;border-radius:16px;padding:36px 32px;border:1px solid #E2E2EC;">
            ${cardHtml}
          </td>
        </tr>
        ${footer ?? footerHtml(year)}
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

function ctaButtonHtml(url: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="border-radius:10px;background-color:${BRAND};">
                  <a href="${url}" style="display:inline-block;padding:14px 24px;font-family:${FONT};font-size:15px;font-weight:700;color:#FFFFFF;text-decoration:none;">${escapeHtml(label)}</a>
                </td>
              </tr>
            </table>`;
}

/**
 * Sent when a deletion is first scheduled (POST /me/deletion, everyone but the reviewer account).
 * The cancel link carries the one-time token; the account can also be cancelled by signing in.
 */
export function scheduledDeletionEmail(deleteAfter: Date, cancelUrl: string): RenderedEmail {
  const subject = 'Your Chatsoon account will be deleted';
  const when = formatDeletionTime(deleteAfter);

  const text = [
    `Your ${APP_NAME} account is scheduled to be deleted on ${when}.`,
    '',
    "Your public profile is already offline: it can't be found, scanned or connected with while this is pending.",
    '',
    'Changed your mind? Cancel here:',
    cancelUrl,
    '',
    'or sign in and tap Cancel deletion.',
    '',
    `If you didn't ask for this, cancel it and contact ${SUPPORT_EMAIL}.`,
    '',
    '--',
    `${APP_NAME}. ${TAGLINE}`,
    `Questions? ${SUPPORT_EMAIL}`,
    `© ${new Date().getUTCFullYear()} ${COPYRIGHT}`,
  ].join('\n');

  const safeWhen = escapeHtml(when);
  const cardHtml = `<p style="margin:0 0 8px 0;font-family:${FONT};font-size:20px;line-height:28px;font-weight:700;color:${INK};">Your account will be deleted</p>
            <p style="margin:0 0 20px 0;font-family:${FONT};font-size:15px;line-height:22px;color:${MUTED};">Your ${APP_NAME} account is scheduled to be deleted on <strong style="color:${INK};">${safeWhen}</strong>.</p>
            <p style="margin:0 0 24px 0;font-family:${FONT};font-size:15px;line-height:22px;color:${MUTED};">Your public profile is already offline: it can't be found, scanned or connected with while this is pending.</p>
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="border-radius:10px;background-color:${BRAND};">
                  <a href="${cancelUrl}" style="display:inline-block;padding:14px 24px;font-family:${FONT};font-size:15px;font-weight:700;color:#FFFFFF;text-decoration:none;">Cancel deletion</a>
                </td>
              </tr>
            </table>
            <p style="margin:20px 0 0 0;font-family:${FONT};font-size:14px;line-height:21px;color:${MUTED};">Or sign in and tap Cancel deletion.</p>
            <p style="margin:12px 0 0 0;font-family:${FONT};font-size:13px;line-height:19px;color:${FAINT};">If you didn't ask for this, use the button above and contact <a href="mailto:${SUPPORT_EMAIL}" style="color:${BRAND};">${SUPPORT_EMAIL}</a>.</p>`;

  return { subject, text, html: shellHtml(subject, `Your ${APP_NAME} account is scheduled to be deleted on ${when}.`, cardHtml) };
}

/** Sent once the account and every row and file it owned are actually gone (runDueDeletions, or immediately for the reviewer). */
export function accountDeletedEmail(): RenderedEmail {
  const subject = 'Your Chatsoon account has been deleted';

  const text = [
    `Your ${APP_NAME} account and everything in it have been permanently deleted.`,
    '',
    'Backups that include your data will roll off within 30 days.',
    '',
    "This is the last email we'll send you.",
    '',
    '--',
    `${APP_NAME}. ${TAGLINE}`,
    `Questions? ${SUPPORT_EMAIL}`,
    `© ${new Date().getUTCFullYear()} ${COPYRIGHT}`,
  ].join('\n');

  const cardHtml = `<p style="margin:0 0 8px 0;font-family:${FONT};font-size:20px;line-height:28px;font-weight:700;color:${INK};">Your account has been deleted</p>
            <p style="margin:0 0 20px 0;font-family:${FONT};font-size:15px;line-height:22px;color:${MUTED};">Your ${APP_NAME} account and everything in it have been permanently deleted.</p>
            <p style="margin:0 0 20px 0;font-family:${FONT};font-size:15px;line-height:22px;color:${MUTED};">Backups that include your data will roll off within 30 days.</p>
            <p style="margin:0;font-family:${FONT};font-size:14px;line-height:21px;color:${FAINT};">This is the last email we'll send you.</p>`;

  return {
    subject,
    text,
    html: shellHtml(subject, `Your ${APP_NAME} account and everything in it have been permanently deleted.`, cardHtml),
  };
}

// ---------------------------------------------------------------------------
// Tips emails (issue #7): the lead nurture sequence (people who opted in on the public Connect
// form but don't have an account) and the new-account nudges. Both are marketing, not transactional,
// so every one of these - unlike every template above - carries the sender/support line, a reason
// for getting it, and the RFC 8058 one-click unsubscribe link (lib/unsubscribe.ts builds the token
// and the matching List-Unsubscribe headers; this file only lays out the copy). Nothing the
// recipient or anyone else typed (a name, a note, profile text) ever appears in these: the copy is
// fixed, and the only per-recipient value is a Chatsoon-assigned profile slug (nudge step 2).
// ---------------------------------------------------------------------------

function tipsFooterText(consentLine: string, unsubscribeUrl: string): string {
  return [consentLine, `Unsubscribe: ${unsubscribeUrl}`, `${APP_NAME}, by ${COPYRIGHT} · ${SUPPORT_EMAIL}`].join(
    '\n',
  );
}

function tipsFooterHtml(consentLine: string, unsubscribeUrl: string): string {
  return `<tr>
          <td style="padding:24px 8px 0 8px;font-family:${FONT};font-size:12px;line-height:18px;color:${FAINT};">
            ${escapeHtml(consentLine)}<br>
            <a href="${unsubscribeUrl}" style="color:${BRAND};text-decoration:none;">Unsubscribe</a><br>
            ${APP_NAME}, by ${escapeHtml(COPYRIGHT)} &middot; <a href="mailto:${SUPPORT_EMAIL}" style="color:${BRAND};text-decoration:none;">${SUPPORT_EMAIL}</a>
          </td>
        </tr>`;
}

const LEAD_CONSENT_LINE = "You're getting this because you asked for tips when you connected with someone on Chatsoon.";
const NUDGE_CONSENT_LINE = "You're getting this because you have a Chatsoon account. Turn these off in Me › Tips emails.";

/**
 * The three-step lead nurture sequence (lib/sequences.ts `runEmailSequences`), for someone who
 * opted in on the public Connect form but doesn't have a Chatsoon account yet. `signInUrl` is
 * `${WEB_ORIGIN}/sign-in`, built by the caller so this file stays free of env-specific URLs.
 */
export function leadStepEmail(step: 1 | 2 | 3, signInUrl: string, unsubscribeUrl: string): RenderedEmail {
  const copy: Record<1 | 2 | 3, { subject: string; lead: string }> = {
    1: {
      subject: 'Create your free Chatsoon profile',
      lead: 'You said yes to tips on setting up your own free Chatsoon profile: a digital business card people can save with one tap.',
    },
    2: {
      subject: 'Your digital business card, ready in a minute',
      lead: 'A Chatsoon profile is your digital business card: a QR code and link people can scan or tap to save your details instantly, no app required on their end.',
    },
    3: {
      subject: 'Last reminder: your free Chatsoon profile',
      lead: 'Last reminder: your free Chatsoon profile is still waiting whenever you want it. It only takes a minute to set up.',
    },
  };
  const { subject, lead } = copy[step];

  const text = [lead, '', 'Set yours up:', signInUrl, '', tipsFooterText(LEAD_CONSENT_LINE, unsubscribeUrl)].join('\n');

  const cardHtml = `<p style="margin:0 0 8px 0;font-family:${FONT};font-size:20px;line-height:28px;font-weight:700;color:${INK};">${escapeHtml(subject)}</p>
            <p style="margin:0 0 24px 0;font-family:${FONT};font-size:15px;line-height:22px;color:${MUTED};">${escapeHtml(lead)}</p>
            ${ctaButtonHtml(signInUrl, 'Set up my profile')}`;

  return { subject, text, html: shellHtml(subject, lead, cardHtml, tipsFooterHtml(LEAD_CONSENT_LINE, unsubscribeUrl)) };
}

/**
 * The two-step new-account nudge sequence (lib/sequences.ts `runEmailSequences`). Step 1 only ever
 * sends when the profile is still incomplete; step 2 always sends and includes the account's own
 * profile link (`ctaUrl`, e.g. `chatsoon.app/id/<slug>`), never the display name.
 */
export function nudgeEmail(step: 1 | 2, ctaUrl: string, unsubscribeUrl: string): RenderedEmail {
  if (step === 1) {
    const subject = 'Finish your Chatsoon profile';
    const lead = 'Add a photo, headline and links, so people remember you.';
    const text = [lead, '', 'Finish your profile:', ctaUrl, '', tipsFooterText(NUDGE_CONSENT_LINE, unsubscribeUrl)].join(
      '\n',
    );
    const cardHtml = `<p style="margin:0 0 8px 0;font-family:${FONT};font-size:20px;line-height:28px;font-weight:700;color:${INK};">${escapeHtml(subject)}</p>
            <p style="margin:0 0 24px 0;font-family:${FONT};font-size:15px;line-height:22px;color:${MUTED};">${escapeHtml(lead)}</p>
            ${ctaButtonHtml(ctaUrl, 'Finish my profile')}`;
    return { subject, text, html: shellHtml(subject, lead, cardHtml, tipsFooterHtml(NUDGE_CONSENT_LINE, unsubscribeUrl)) };
  }

  const subject = 'Put your Chatsoon link in your bio';
  // The link itself is Chatsoon's own data (a slug we assigned), not anything the user typed.
  const linkText = ctaUrl.replace(/^https?:\/\//, '');
  const lead = `Add ${linkText} to your X and LinkedIn bios so the people you meet can find you.`;
  const text = [lead, '', ctaUrl, '', tipsFooterText(NUDGE_CONSENT_LINE, unsubscribeUrl)].join('\n');
  const cardHtml = `<p style="margin:0 0 8px 0;font-family:${FONT};font-size:20px;line-height:28px;font-weight:700;color:${INK};">${escapeHtml(subject)}</p>
            <p style="margin:0 0 24px 0;font-family:${FONT};font-size:15px;line-height:22px;color:${MUTED};">Add <strong style="color:${INK};">${escapeHtml(linkText)}</strong> to your X and LinkedIn bios so the people you meet can find you.</p>
            ${ctaButtonHtml(ctaUrl, 'View my profile')}`;
  return { subject, text, html: shellHtml(subject, lead, cardHtml, tipsFooterHtml(NUDGE_CONSENT_LINE, unsubscribeUrl)) };
}

// ---------------------------------------------------------------------------
// Referrals (issue #11, docs/referrals.md "Emails"). The Invite email is marketing-style, same
// consent/unsubscribe shape as the tips emails above (one send, never a follow-up, per the doc's
// "Compliance" section). Qualified is tips-gated (email_prefs.tips_opt_out_at) so it reuses the same
// footer; Milestone badge and Claim ready are transactional (always sent, plain footer, no unsubscribe).
// ---------------------------------------------------------------------------

/** Collapses to one line and trims: profile fields (a display name, headline, company) are free text
 * a user chose, and none of it may ever break a subject line or inject a second header line. */
function oneLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

const REFERRAL_INVITE_CONSENT_LINE_PREFIX = 'You were sent this because';

/**
 * To the invitee, from EMAIL_FROM, no reply-to override. `inviterName` is always present (a display
 * name is required to have a profile at all); `inviterHeadline`/`inviterCompany` are optional, both
 * escaped and collapsed to one line, same as `inviterName`, before they ever reach the subject or body.
 * Nothing the invitee typed goes anywhere near this template - there is no invitee input at all.
 */
export function referralInviteEmail(opts: {
  inviterName: string;
  inviterHeadline: string | null;
  inviterCompany: string | null;
  link: string;
  unsubscribeUrl: string;
}): RenderedEmail {
  const name = oneLine(opts.inviterName);
  const subject = `${name} invited you to Chatsoon`;
  const about = [opts.inviterHeadline, opts.inviterCompany].map((v) => (v ? oneLine(v) : null)).filter(Boolean).join(' at ');
  const consentLine = `${REFERRAL_INVITE_CONSENT_LINE_PREFIX} ${name} entered your address in Chatsoon. We won't email you again unless you sign up.`;

  const introLines = [
    `${name}${about ? ` (${about})` : ''} thinks you'd like Chatsoon.`,
    `Chatsoon is a digital business card and contact book: a QR code and link people can scan or tap to save your details instantly, then keep track of everyone they meet.`,
  ];

  const text = [...introLines, '', 'Set up your profile:', opts.link, '', tipsFooterText(consentLine, opts.unsubscribeUrl)].join('\n');

  const cardHtml = `<p style="margin:0 0 8px 0;font-family:${FONT};font-size:20px;line-height:28px;font-weight:700;color:${INK};">${escapeHtml(subject)}</p>
            <p style="margin:0 0 12px 0;font-family:${FONT};font-size:15px;line-height:22px;color:${MUTED};">${escapeHtml(introLines[0]!)}</p>
            <p style="margin:0 0 24px 0;font-family:${FONT};font-size:15px;line-height:22px;color:${MUTED};">${escapeHtml(introLines[1]!)}</p>
            ${ctaButtonHtml(opts.link, 'Set up my profile')}`;

  return { subject, text, html: shellHtml(subject, introLines[0]!, cardHtml, tipsFooterHtml(consentLine, opts.unsubscribeUrl)) };
}

const REFERRAL_CONSENT_LINE = "You're getting this because someone you referred to Chatsoon just qualified. Turn these off in Me › Tips emails.";

/**
 * To the referrer, tips-gated (email_prefs.tips_opt_out_at - lib/sequences.ts's `tipsEmailsEnabled`).
 * `referredName` is the qualified referral's own display name (their profile is public by definition
 * once qualified: it must exist and be published). `progressLine` is one of "N of 10 to Founding
 * member" / "N of 10 to Early adopter" / "N of 20 to your reward", built by lib/referrals.ts.
 */
export function referralQualifiedEmail(referredName: string, progressLine: string, unsubscribeUrl: string): RenderedEmail {
  const name = oneLine(referredName);
  const subject = `${name} just qualified as your referral. ${progressLine}`;
  const lead = `${name} just qualified as your referral.`;

  const text = [lead, progressLine, '', tipsFooterText(REFERRAL_CONSENT_LINE, unsubscribeUrl)].join('\n');
  const cardHtml = `<p style="margin:0 0 8px 0;font-family:${FONT};font-size:20px;line-height:28px;font-weight:700;color:${INK};">${escapeHtml(lead)}</p>
            <p style="margin:0;font-family:${FONT};font-size:15px;line-height:22px;color:${MUTED};">${escapeHtml(progressLine)}</p>`;
  return { subject, text, html: shellHtml(subject, lead, cardHtml, tipsFooterHtml(REFERRAL_CONSENT_LINE, unsubscribeUrl)) };
}

/**
 * To the referrer, always sent (transactional): once, when the 10th qualified referral lands.
 * `seq` is the founder number (1..REFERRAL_FOUNDER_CAP), present only for `badge === 'founder'`.
 */
export function referralMilestoneEmail(badge: Badge, seq: number | null, awardedAt: Date): RenderedEmail {
  const label = BADGE_LABELS[badge];
  const subject = badge === 'founder' ? `You're Chatsoon Founding member #${seq}` : `You're a Chatsoon ${label}`;
  const when = formatDeletionTime(awardedAt); // same "Sunday 27 September 2026 at 09:30 UTC" formatting

  const lead = `${subject}.`;
  const body = `You've referred enough people to Chatsoon to earn the ${label} badge, awarded on ${when}. It shows next to your name on your profile card and public page, for good.`;

  const text = [
    lead,
    '',
    body,
    '',
    '--',
    `${APP_NAME}. ${TAGLINE}`,
    `Questions? ${SUPPORT_EMAIL}`,
    `© ${new Date().getUTCFullYear()} ${COPYRIGHT}`,
  ].join('\n');

  const cardHtml = `<p style="margin:0 0 8px 0;font-family:${FONT};font-size:20px;line-height:28px;font-weight:700;color:${INK};">${escapeHtml(lead)}</p>
            <p style="margin:0;font-family:${FONT};font-size:15px;line-height:22px;color:${MUTED};">${escapeHtml(body)}</p>`;
  return { subject, text, html: shellHtml(subject, lead, cardHtml) };
}

/** To the referrer, always sent (transactional): once, when the 20th qualified referral lands. */
export function referralClaimReadyEmail(): RenderedEmail {
  const subject = 'You can claim your Chatsoon reward';
  const lead = "You've referred 20 people who qualified. Your reward on Learn Cardano Bounties is ready to claim.";
  const body = 'Open the Referrals tab in Chatsoon and tap Claim reward.';

  const text = [lead, '', body, '', '--', `${APP_NAME}. ${TAGLINE}`, `Questions? ${SUPPORT_EMAIL}`, `© ${new Date().getUTCFullYear()} ${COPYRIGHT}`].join(
    '\n',
  );
  const cardHtml = `<p style="margin:0 0 8px 0;font-family:${FONT};font-size:20px;line-height:28px;font-weight:700;color:${INK};">${escapeHtml(subject)}</p>
            <p style="margin:0 0 20px 0;font-family:${FONT};font-size:15px;line-height:22px;color:${MUTED};">${escapeHtml(lead)}</p>
            <p style="margin:0;font-family:${FONT};font-size:14px;line-height:21px;color:${FAINT};">${escapeHtml(body)}</p>`;
  return { subject, text, html: shellHtml(subject, lead, cardHtml) };
}
