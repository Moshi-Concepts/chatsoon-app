/// <reference lib="dom" />
// Connect form behaviour for the server-rendered profile page (WP-C4), ported from
// apps/mobile/src/components/web/connect-form.tsx. The form and its fields already exist in the
// server-rendered HTML (docs/profile-page-dom.md "Connect form"); this module only wires it up.

import { CONNECT_FORM_MAX, connectErrorMessage } from '@chatsoon/shared/src/profile-page';
import type { ConnectFormResponse } from '@chatsoon/shared/src/types';

import { contactLinks, errorFromBody, qs, type ContactLink } from './dom';
import { mountTurnstile, once, type TurnstileWidget } from './turnstile';

export interface ConnectConfig {
  api: string;
  slug: string;
  sitekey: string;
  first: string;
}

export interface ConnectFormValues {
  name: string;
  contact: string;
  note: string;
}

export type ConnectFieldErrors = Partial<Record<'name' | 'contact' | 'note', string>>;

/** Required fields and CONNECT_FORM_MAX lengths, checked before any network call. */
export function validateConnectForm(values: ConnectFormValues): ConnectFieldErrors | null {
  const errors: ConnectFieldErrors = {};
  const name = values.name.trim();
  const contact = values.contact.trim();

  if (!name) errors.name = 'Name is required';
  else if (name.length > CONNECT_FORM_MAX.name) errors.name = `Keep it under ${CONNECT_FORM_MAX.name} characters`;

  if (!contact) errors.contact = 'Add an email or handle';
  else if (contact.length > CONNECT_FORM_MAX.contact) {
    errors.contact = `Keep it under ${CONNECT_FORM_MAX.contact} characters`;
  }

  if (values.note.length > CONNECT_FORM_MAX.note) errors.note = `Keep it under ${CONNECT_FORM_MAX.note} characters`;

  return Object.keys(errors).length ? errors : null;
}

export interface ConnectPayload {
  name: string;
  contact: string;
  note: string;
  turnstileToken: string;
}

export function buildConnectPayload(values: ConnectFormValues, turnstileToken: string): ConnectPayload {
  return { name: values.name.trim(), contact: values.contact.trim(), note: values.note.trim(), turnstileToken };
}

/** connect-form.tsx's `errorMessage`: the shared mapping first, then the server's own message. */
export function mapConnectError(status: number, code: string, serverMessage: string | null): string {
  return connectErrorMessage(status, code) ?? serverMessage ?? 'Something went wrong. Please try again.';
}

export interface ConnectSuccessContent {
  heading: string;
  pills: ContactLink[];
  saveContactHref: string | null;
}

/** What to show in #connect-success for a given API response, mirroring ConnectForm's success card. */
export function buildSuccessContent(config: ConnectConfig, data: ConnectFormResponse): ConnectSuccessContent {
  return {
    heading: `Sent. ${config.first} now has your details.`,
    pills: contactLinks(data.contact),
    saveContactHref: data.contact
      ? (data.vcardUrl ?? `${config.api}/id/${encodeURIComponent(config.slug)}/vcard`)
      : null,
  };
}

function readValues(form: HTMLFormElement): ConnectFormValues {
  const data = new FormData(form);
  return {
    name: String(data.get('name') ?? ''),
    contact: String(data.get('contact') ?? ''),
    note: String(data.get('note') ?? ''),
  };
}

async function safeJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

/** Polls the token set by the Turnstile callback, so submit can wait for a challenge that started
 * only when the visitor interacted with the form. Resolves null if nothing arrives in time. */
function waitForToken(getToken: () => string | null, timeoutMs = 20_000): Promise<string | null> {
  const existing = getToken();
  if (existing) return Promise.resolve(existing);
  return new Promise((resolve) => {
    const start = Date.now();
    const tick = () => {
      const token = getToken();
      if (token) {
        resolve(token);
      } else if (Date.now() - start >= timeoutMs) {
        resolve(null);
      } else {
        setTimeout(tick, 150);
      }
    };
    tick();
  });
}

function renderSuccess(container: HTMLElement, content: ConnectSuccessContent): void {
  const nodes: Node[] = [];

  const heading = document.createElement('p');
  heading.setAttribute('role', 'alert');
  heading.textContent = content.heading;
  nodes.push(heading);

  if (content.pills.length) {
    const pillList = document.createElement('div');
    pillList.className = 'pills';
    for (const pill of content.pills) {
      const a = document.createElement('a');
      a.href = pill.href;
      a.className = 'chip';
      a.textContent = pill.label;
      if (pill.newTab) {
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
      }
      pillList.appendChild(a);
    }
    nodes.push(pillList);
  }

  if (content.saveContactHref) {
    const save = document.createElement('a');
    save.className = 'button';
    save.rel = 'nofollow';
    save.href = content.saveContactHref;
    save.textContent = 'Save contact';
    nodes.push(save);
  }

  container.replaceChildren(...nodes);
}

/** Wires the Connect form: lazy Turnstile, client-side validation, submit and its success/error states. */
export function initConnect(config: ConnectConfig, root: ParentNode = document): void {
  const form = qs<HTMLFormElement>(root, '#connect-form');
  const turnstileContainer = form && qs<HTMLElement>(form, '#turnstile');
  const errorEl = form && qs<HTMLElement>(root, '#connect-error');
  const successEl = qs<HTMLElement>(root, '#connect-success');
  const submitBtn = form && qs<HTMLButtonElement>(form, 'button[type="submit"]');
  if (!form || !turnstileContainer || !errorEl || !successEl || !submitBtn) return;

  let token: string | null = null;
  let widget: TurnstileWidget | null = null;

  const ensureTurnstile = once(async () => {
    widget = mountTurnstile(turnstileContainer, config.sitekey, (t) => {
      token = t;
    });
  });

  // Injected on the visitor's first interaction with the form, or on submit — never at page load.
  form.addEventListener('focusin', () => void ensureTurnstile());
  form.addEventListener('pointerdown', () => void ensureTurnstile());

  const showError = (message: string) => {
    errorEl.textContent = message;
    errorEl.hidden = false;
  };
  const clearError = () => {
    errorEl.hidden = true;
    errorEl.textContent = '';
  };

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void handleSubmit();
  });

  // A function expression, not a declaration: declarations are hoisted, so TS would (correctly, given
  // hoisting) refuse to treat `form`/`successEl`/`submitBtn` as narrowed non-null inside it. Defining
  // it here, after the guard above, lets the narrowing carry through.
  const handleSubmit = async () => {
    void ensureTurnstile();
    const values = readValues(form);
    const fieldErrors = validateConnectForm(values);
    if (fieldErrors) {
      showError(Object.values(fieldErrors)[0] ?? 'Please check the form and try again.');
      return;
    }
    clearError();

    const originalLabel = submitBtn?.textContent ?? 'Send';
    if (submitBtn) submitBtn.textContent = "Checking you're human…";
    try {
      const turnstileToken = await waitForToken(() => token);
      if (!turnstileToken) {
        showError('The spam check failed. Please complete it again and resend.');
        return;
      }

      const res = await fetch(`${config.api}/id/${encodeURIComponent(config.slug)}/connect`, {
        method: 'POST',
        credentials: 'omit',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildConnectPayload(values, turnstileToken)),
      });
      const body = await safeJson(res);

      if (!res.ok) {
        const { code, message } = errorFromBody(body);
        showError(mapConnectError(res.status, code, message));
        return;
      }

      form.hidden = true;
      renderSuccess(successEl, buildSuccessContent(config, body as ConnectFormResponse));
      successEl.hidden = false;
    } catch {
      showError('Something went wrong. Please check your connection and try again.');
    } finally {
      widget?.reset();
      if (submitBtn) submitBtn.textContent = originalLabel;
    }
  };
}
