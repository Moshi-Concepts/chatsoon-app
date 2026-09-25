import { describe, expect, it } from 'vitest';

import { shouldOpenInDialog } from '../src/client/booking';

const plainClick = { button: 0, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false };

describe('shouldOpenInDialog', () => {
  it('opens the dialog for a plain primary click on a row with an embed url', () => {
    expect(shouldOpenInDialog(plainClick, 'https://calendly.com/x?embed_domain=chatsoon.app')).toBe(true);
  });

  it('keeps the default link for a row with no embed url', () => {
    expect(shouldOpenInDialog(plainClick, null)).toBe(false);
    expect(shouldOpenInDialog(plainClick, undefined)).toBe(false);
    expect(shouldOpenInDialog(plainClick, '')).toBe(false);
  });

  it('keeps the default link for a middle or right click', () => {
    expect(shouldOpenInDialog({ ...plainClick, button: 1 }, 'https://embed')).toBe(false);
    expect(shouldOpenInDialog({ ...plainClick, button: 2 }, 'https://embed')).toBe(false);
  });

  it('keeps the default link for any modified click, so cmd/ctrl-click still opens a new tab', () => {
    expect(shouldOpenInDialog({ ...plainClick, ctrlKey: true }, 'https://embed')).toBe(false);
    expect(shouldOpenInDialog({ ...plainClick, shiftKey: true }, 'https://embed')).toBe(false);
    expect(shouldOpenInDialog({ ...plainClick, altKey: true }, 'https://embed')).toBe(false);
    expect(shouldOpenInDialog({ ...plainClick, metaKey: true }, 'https://embed')).toBe(false);
  });
});
