/// <reference lib="dom" />
// This suite otherwise runs under vitest's 'node' environment with no DOM lib at all (see the note
// below and vitest.config.ts) - the reference above only brings in the *types* (ParentNode) used to
// describe the fakes, matching how every src/client/*.ts file pulls in the DOM lib for itself.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { initCopy } from '../src/client/copy';

// The suite runs under vitest's 'node' environment (see vitest.config.ts) like every other client
// test here, so `document`/`window`/`navigator` don't exist for real. initCopy only touches a handful
// of DOM methods, so plain fake objects (and vi.stubGlobal for the couple of true globals it reaches
// for) are enough to exercise it end to end, the same way the rest of this suite tests pure functions
// pulled out of the other client/*.ts modules - this one just has less to pull out.

type FakeButton = {
  dataset: { copy?: string };
  querySelector: (selector: string) => { textContent: string } | null;
  getAttribute: (name: string) => string | null;
  setAttribute: (name: string, value: string) => void;
  addEventListener: (type: string, handler: () => void) => void;
  click: () => void;
  span: { textContent: string };
};

function makeCopyButton(copy: string | undefined, text: string, ariaLabel: string | null = null): FakeButton {
  const span = { textContent: text };
  let label = ariaLabel;
  let onClick: (() => void) | undefined;
  return {
    dataset: { copy },
    querySelector: (selector) => (selector === 'span' ? span : null),
    getAttribute: (name) => (name === 'aria-label' ? label : null),
    setAttribute: (name, value) => {
      if (name === 'aria-label') label = value;
    },
    addEventListener: (type, handler) => {
      if (type === 'click') onClick = handler;
    },
    click: () => onClick?.(),
    span,
  };
}

function fakeRoot(buttons: FakeButton[]) {
  return { querySelectorAll: () => buttons } as unknown as ParentNode;
}

// initCopy awaits a promise chain (copyText) before touching the DOM again. Fake timers are active in
// every test here (for the "Copied" reset), so flushing with a real setTimeout would hang forever -
// advanceTimersByTimeAsync(0) drives the fake timer queue and lets pending microtasks settle too.
const flush = () => vi.advanceTimersByTimeAsync(0);

describe('initCopy', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('copies the data-copy value via the Clipboard API and shows "Copied" for ~1.5s', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });

    const button = makeCopyButton('peterbui', 'peterbui', 'Copy Discord username peterbui');
    initCopy(fakeRoot([button]));

    button.click();
    await flush();

    expect(writeText).toHaveBeenCalledWith('peterbui');
    expect(button.span.textContent).toBe('Copied');
    expect(button.getAttribute('aria-label')).toBe('Copied');

    await vi.advanceTimersByTimeAsync(1500);
    expect(button.span.textContent).toBe('peterbui');
    expect(button.getAttribute('aria-label')).toBe('Copy Discord username peterbui');
  });

  it('falls back to selecting the label text when the Clipboard API throws or is unavailable', async () => {
    vi.stubGlobal('navigator', { clipboard: undefined });
    const range = { selectNodeContents: vi.fn() };
    const selection = { removeAllRanges: vi.fn(), addRange: vi.fn() };
    const execCommand = vi.fn().mockReturnValue(true);
    vi.stubGlobal('document', { createRange: () => range, execCommand });
    vi.stubGlobal('window', { getSelection: () => selection });

    const button = makeCopyButton('peterbui', 'peterbui');
    initCopy(fakeRoot([button]));

    button.click();
    await flush();

    expect(range.selectNodeContents).toHaveBeenCalledWith(button.span);
    expect(execCommand).toHaveBeenCalledWith('copy');
    expect(button.span.textContent).toBe('Copied');
  });

  it('does nothing when the Clipboard API and the selection fallback both fail', async () => {
    vi.stubGlobal('navigator', { clipboard: undefined });
    vi.stubGlobal('document', {
      createRange: () => {
        throw new Error('no document');
      },
    });
    vi.stubGlobal('window', { getSelection: () => null });

    const button = makeCopyButton('peterbui', 'peterbui');
    initCopy(fakeRoot([button]));

    button.click();
    await flush();

    expect(button.span.textContent).toBe('peterbui');
  });

  it('ignores a button with no data-copy value or no label span', () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn() } });
    const missingValue = makeCopyButton(undefined, 'peterbui');
    const missingSpan: FakeButton = { ...makeCopyButton('peterbui', 'peterbui'), querySelector: () => null };

    expect(() => initCopy(fakeRoot([missingValue, missingSpan]))).not.toThrow();
    missingValue.click();
    missingSpan.click();
  });
});
