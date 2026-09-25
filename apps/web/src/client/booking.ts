/// <reference lib="dom" />
// Booking dialog for the server-rendered profile page (WP-C4), ported from
// apps/mobile/src/components/booking/{booking-sheet,booking-embed.web}.tsx: a native <dialog> holding
// an iframe, created lazily and only for rows that can embed (`data-embed` non-empty). Other rows keep
// their default new-tab link behaviour (docs/profile-page-dom.md "Book a meeting").

import { openDialog, qsa, wireDialogFocusReturn } from './dom';

export interface BookingConfig {
  first: string;
}

/** A plain primary click, no modifier keys, on a row that can embed. Anything else keeps the
 * default link behaviour (a modified click, a middle click, or a row with no `data-embed`). */
export function shouldOpenInDialog(
  event: Pick<MouseEvent, 'button' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'metaKey'>,
  embed: string | null | undefined,
): boolean {
  if (event.button !== 0) return false;
  if (event.ctrlKey || event.shiftKey || event.altKey || event.metaKey) return false;
  return !!embed;
}

let dialog: HTMLDialogElement | null = null;
let titleEl: HTMLElement | null = null;
let subtitleEl: HTMLElement | null = null;
let openInTabLink: HTMLAnchorElement | null = null;
let bodyEl: HTMLElement | null = null;

function createDialog(): HTMLDialogElement {
  const el = document.createElement('dialog');
  el.className = 'booking-dialog';
  el.setAttribute('aria-labelledby', 'booking-dialog-label');

  const header = document.createElement('div');
  header.className = 'dialog-header';

  const heading = document.createElement('div');
  titleEl = document.createElement('h2');
  titleEl.id = 'booking-dialog-label';
  subtitleEl = document.createElement('p');
  subtitleEl.className = 'dialog-subtitle';
  heading.append(titleEl, subtitleEl);

  openInTabLink = document.createElement('a');
  openInTabLink.className = 'button';
  openInTabLink.target = '_blank';
  openInTabLink.rel = 'noopener noreferrer';
  openInTabLink.textContent = 'Open in new tab';

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'dialog-close';
  closeBtn.setAttribute('aria-label', 'Close');
  closeBtn.textContent = '×';
  closeBtn.addEventListener('click', () => el.close());

  header.append(heading, openInTabLink, closeBtn);

  bodyEl = document.createElement('div');
  bodyEl.className = 'dialog-body';

  el.append(header, bodyEl);
  document.body.appendChild(el);

  // The iframe is created only while the dialog is open, so it stops loading in the background once closed.
  el.addEventListener('close', () => bodyEl?.replaceChildren());
  wireDialogFocusReturn(el);

  return el;
}

function ensureDialog(): HTMLDialogElement {
  dialog ??= createDialog();
  return dialog;
}

function openBookingDialog(opener: HTMLElement, embedUrl: string, openUrl: string, label: string, provider: string, first: string) {
  const el = ensureDialog();
  if (titleEl) titleEl.textContent = label;
  if (subtitleEl) subtitleEl.textContent = `with ${first} · ${provider}`;
  if (openInTabLink) openInTabLink.href = openUrl;

  const iframe = document.createElement('iframe');
  iframe.title = `Booking calendar: ${label}`;
  iframe.src = embedUrl;
  bodyEl?.replaceChildren(iframe);

  openDialog(el, opener);
}

/** Wires every `a.booking-row` on the page: embeddable rows open the dialog, others keep their href. */
export function initBooking(config: BookingConfig, root: ParentNode = document): void {
  for (const row of qsa<HTMLAnchorElement>(root, 'a.booking-row')) {
    row.addEventListener('click', (event) => {
      const embed = row.dataset.embed;
      if (!shouldOpenInDialog(event, embed)) return;
      event.preventDefault();
      openBookingDialog(row, embed as string, row.href, row.dataset.label ?? row.textContent ?? '', row.dataset.provider ?? '', config.first);
    });
  }
}
