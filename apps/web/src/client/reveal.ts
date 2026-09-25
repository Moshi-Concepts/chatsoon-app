/// <reference lib="dom" />
// Number reveal for `public`-visibility profiles (WP-C4, docs/profile-page-dom.md "Phone and
// messaging chips"). The chips start as `<button data-reveal="key">` with just the channel label; a
// tap fetches the real numbers and swaps every chip for a link, the same contactUrl/displayContact
// pair the app's ContactPills uses. Failures are swallowed: the DOM contract requires a clean console,
// and there's nothing actionable a visitor can do about a failed reveal anyway.

import type { ProfileContact, ProfileContactKey } from '@chatsoon/shared/src/types';

import { contactLinks, qs, qsa, type ContactLink } from './dom';

export interface RevealConfig {
  api: string;
  slug: string;
}

function replaceChipsWithLinks(container: HTMLElement, links: ContactLink[]): void {
  const byKey = new Map(links.map((link) => [link.key, link]));
  for (const button of qsa<HTMLButtonElement>(container, 'button[data-reveal]')) {
    const key = button.dataset.reveal as ProfileContactKey | undefined;
    const link = key ? byKey.get(key) : undefined;
    if (!link) continue;
    const anchor = document.createElement('a');
    anchor.href = link.href;
    anchor.className = button.className;
    anchor.textContent = link.label;
    if (link.newTab) {
      anchor.target = '_blank';
      anchor.rel = 'noopener noreferrer';
    }
    button.replaceWith(anchor);
  }
}

/** Wires every `[data-reveal]` chip inside `#contact-chips`: the first tap fetches the profile once
 * and swaps in links for every chip the response has a usable value for. */
export function initReveal(config: RevealConfig, root: ParentNode = document): void {
  const chips = qs<HTMLElement>(root, '#contact-chips');
  if (!chips) return;
  const buttons = qsa<HTMLButtonElement>(chips, 'button[data-reveal]');
  if (!buttons.length) return;

  let requested = false;
  const reveal = async () => {
    if (requested) return;
    requested = true;
    try {
      const res = await fetch(`${config.api}/id/${encodeURIComponent(config.slug)}`, { credentials: 'omit' });
      if (!res.ok) return;
      const data = (await res.json()) as { contact?: ProfileContact };
      const links = contactLinks(data.contact);
      if (links.length) replaceChipsWithLinks(chips, links);
    } catch {
      // Swallowed: the console must stay clean on a failed reveal (docs/profile-page-dom.md).
    }
  };

  for (const button of buttons) button.addEventListener('click', () => void reveal());
}
