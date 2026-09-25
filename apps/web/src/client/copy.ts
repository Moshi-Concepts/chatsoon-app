/// <reference lib="dom" />
// Copy-to-clipboard chips (WP-C4, docs/profile-page-dom.md "Links": the Discord username chip,
// issue #21). Wired generically for every `<button data-copy>` in the page, not just Discord's, so any
// future copy chip gets the same behaviour for free. Failures are swallowed where nothing actionable
// remains (the DOM contract requires a clean console) - the selection fallback below is the last resort,
// not a silent failure.

import { qsa } from './dom';

const COPIED_LABEL = 'Copied';
const RESET_MS = 1500;

/** Selects `el`'s text so the user can copy it themselves, when the Clipboard API can't. */
function selectText(el: Element): void {
  const range = document.createRange();
  range.selectNodeContents(el);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

async function copyText(text: string, fallback: Element): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Falls through to the selection fallback below (a denied permission, an insecure context, etc).
  }
  try {
    selectText(fallback);
    // execCommand is deprecated but still the only synchronous fallback when the async Clipboard API
    // isn't available - selecting the text at least lets the user copy it themselves either way.
    return document.execCommand('copy');
  } catch {
    return false;
  }
}

/**
 * Wires every `[data-copy]` button in `root`: a tap copies its `data-copy` value, swaps its label
 * `<span>` to "Copied" (and its aria-label to match) for about 1.5s, then restores both.
 */
export function initCopy(root: ParentNode = document): void {
  for (const button of qsa<HTMLButtonElement>(root, 'button[data-copy]')) {
    const value = button.dataset.copy;
    const label = button.querySelector('span');
    if (!value || !label) continue;
    const originalText = label.textContent ?? '';
    const originalLabel = button.getAttribute('aria-label');
    let resetTimer: ReturnType<typeof setTimeout> | undefined;

    button.addEventListener('click', () => {
      void (async () => {
        if (!(await copyText(value, label))) return;
        clearTimeout(resetTimer);
        label.textContent = COPIED_LABEL;
        if (originalLabel) button.setAttribute('aria-label', COPIED_LABEL);
        resetTimer = setTimeout(() => {
          label.textContent = originalText;
          if (originalLabel) button.setAttribute('aria-label', originalLabel);
        }, RESET_MS);
      })();
    });
  }
}
