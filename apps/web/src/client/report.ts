/// <reference lib="dom" />
// Anonymous "Report profile" dialog for the server-rendered profile page (WP-C4), ported from
// apps/mobile/src/components/moderation/report-dialog.tsx. The visitor here is always signed out
// (docs/profile-page-dom.md's Report button has no session), so this only ever sends the
// `{targetSlug, reason, details}` shape of POST /reports — never the signed-in `contactId` shape.
//
// Checked against apps/api/src/routes/moderation.ts: an anonymous report needs no Turnstile token,
// just a per-IP rate limit (REPORT_LIMITER, 10/60s) shared with signed-in reporters.

import { REPORT_REASONS, type ReportReason } from '@chatsoon/shared/src/constants';
import { REPORT_REASON_LABELS } from '@chatsoon/shared/src/profile-page';

import { errorFromBody, openDialog, qs, wireDialogFocusReturn } from './dom';

export interface ReportConfig {
  api: string;
  slug: string;
  first: string;
}

export interface ReportPayload {
  targetSlug: string;
  reason: ReportReason;
  details: string | null;
}

export function buildReportPayload(targetSlug: string, reason: ReportReason, details: string): ReportPayload {
  const trimmed = details.trim();
  return { targetSlug, reason, details: trimmed || null };
}

/** report-dialog.tsx's own fallback ("Your report didn't send. Please try again."), plus the two
 * codes a public, Turnstile-free endpoint can actually return. */
export function mapReportError(status: number, code: string, serverMessage: string | null): string {
  if (code === 'rate_limited') return 'Too many reports. Please wait a minute and try again.';
  if (status === 404) return "This profile isn't available any more.";
  return serverMessage ?? "Your report didn't send. Please try again.";
}

let dialog: HTMLDialogElement | null = null;

function buildReasonField(reason: ReportReason): HTMLLabelElement {
  const { title, subtitle } = REPORT_REASON_LABELS[reason];
  const label = document.createElement('label');
  label.className = 'report-reason';

  const input = document.createElement('input');
  input.type = 'radio';
  input.name = 'reason';
  input.value = reason;
  input.required = true;

  const text = document.createElement('span');
  const strong = document.createElement('strong');
  strong.textContent = title;
  const small = document.createElement('small');
  small.textContent = subtitle;
  text.append(strong, document.createElement('br'), small);

  label.append(input, text);
  return label;
}

function buildDialogContent(el: HTMLDialogElement, config: ReportConfig): void {
  const header = document.createElement('div');
  header.className = 'dialog-header';
  const heading = document.createElement('h2');
  heading.id = 'report-dialog-label';
  heading.textContent = `Report ${config.first}`;
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.setAttribute('aria-label', 'Close');
  closeBtn.className = 'dialog-close';
  closeBtn.textContent = '×';
  closeBtn.addEventListener('click', () => el.close());
  header.append(heading, closeBtn);

  const form = document.createElement('form');
  form.className = 'report-form';

  const intro = document.createElement('p');
  intro.textContent = `Why are you reporting ${config.first}? They won't be told who reported them.`;

  const group = document.createElement('div');
  group.setAttribute('role', 'radiogroup');
  group.setAttribute('aria-label', 'Reason');
  for (const reason of REPORT_REASONS) group.appendChild(buildReasonField(reason));

  const detailsLabel = document.createElement('label');
  detailsLabel.htmlFor = 'report-details';
  detailsLabel.textContent = 'Details (optional)';
  const details = document.createElement('textarea');
  details.id = 'report-details';
  details.name = 'details';
  details.maxLength = 1000;

  const errorEl = document.createElement('p');
  errorEl.id = 'report-error';
  errorEl.setAttribute('role', 'alert');
  errorEl.hidden = true;

  const actions = document.createElement('div');
  actions.className = 'dialog-actions';
  const submitBtn = document.createElement('button');
  submitBtn.type = 'submit';
  submitBtn.className = 'button primary';
  submitBtn.textContent = 'Send report';
  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', () => el.close());
  actions.append(submitBtn, cancelBtn);

  form.append(intro, group, detailsLabel, details, errorEl, actions);

  const success = document.createElement('div');
  success.className = 'report-success';
  success.hidden = true;
  const sentHeading = document.createElement('p');
  sentHeading.setAttribute('role', 'alert');
  sentHeading.textContent = 'Thanks. We review reports within 24 hours.';
  const privacy = document.createElement('p');
  privacy.textContent = `${config.first} won't be told who reported them.`;
  const doneBtn = document.createElement('button');
  doneBtn.type = 'button';
  doneBtn.className = 'button';
  doneBtn.textContent = 'Done';
  doneBtn.addEventListener('click', () => el.close());
  success.append(sentHeading, privacy, doneBtn);

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void submit();
  });

  async function submit() {
    const selected = new FormData(form).get('reason') as ReportReason | null;
    if (!selected) {
      errorEl.textContent = 'Choose a reason for your report.';
      errorEl.hidden = false;
      return;
    }
    errorEl.hidden = true;
    submitBtn.disabled = true;
    cancelBtn.disabled = true;
    try {
      const res = await fetch(`${config.api}/reports`, {
        method: 'POST',
        credentials: 'omit',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildReportPayload(config.slug, selected, details.value)),
      });
      let body: unknown = null;
      try {
        body = await res.json();
      } catch {
        body = null;
      }
      if (!res.ok) {
        const { code, message } = errorFromBody(body);
        errorEl.textContent = mapReportError(res.status, code, message);
        errorEl.hidden = false;
        return;
      }
      form.hidden = true;
      success.hidden = false;
    } catch {
      errorEl.textContent = "Your report didn't send. Please try again.";
      errorEl.hidden = false;
    } finally {
      submitBtn.disabled = false;
      cancelBtn.disabled = false;
    }
  }

  el.replaceChildren(header, form, success);
}

function ensureDialog(): HTMLDialogElement {
  if (!dialog) {
    dialog = document.createElement('dialog');
    dialog.className = 'report-dialog';
    dialog.setAttribute('aria-labelledby', 'report-dialog-label');
    document.body.appendChild(dialog);
    wireDialogFocusReturn(dialog);
  }
  return dialog;
}

/** Wires the `#report` button to open a fresh report dialog every time (state resets on each open,
 * like ReportSheet unmounting on close). */
export function initReport(config: ReportConfig, root: ParentNode = document): void {
  const button = qs<HTMLButtonElement>(root, '#report');
  if (!button) return;
  button.addEventListener('click', () => {
    const el = ensureDialog();
    buildDialogContent(el, config);
    openDialog(el, button);
  });
}
