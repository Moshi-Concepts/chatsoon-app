import { APP_NAME, COPYRIGHT, SUPPORT_EMAIL, TAGLINE } from '@chatsoon/shared';

import type { Env } from '../env';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
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
