import { describe, expect, it, vi } from 'vitest';

import { once, turnstileOptions, turnstileSize } from '../src/client/turnstile';

describe('once', () => {
  it('calls fn only once for overlapping calls, and every caller gets the same result', async () => {
    const fn = vi.fn(() => Promise.resolve('token'));
    const loader = once(fn);

    const [a, b] = await Promise.all([loader(), loader()]);

    expect(fn).toHaveBeenCalledTimes(1);
    expect(a).toBe('token');
    expect(b).toBe('token');
  });

  it('clears the memo on failure, so the next call retries', async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error('nope')).mockResolvedValueOnce('token');
    const loader = once(fn);

    await expect(loader()).rejects.toThrow('nope');
    await expect(loader()).resolves.toBe('token');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('does not call fn again once it has already succeeded', async () => {
    const fn = vi.fn(() => Promise.resolve('token'));
    const loader = once(fn);

    await loader();
    await loader();

    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('turnstileSize', () => {
  it('is flexible at 300px and wider, compact below it', () => {
    expect(turnstileSize(300)).toBe('flexible');
    expect(turnstileSize(320)).toBe('flexible');
    expect(turnstileSize(299)).toBe('compact');
    expect(turnstileSize(0)).toBe('compact');
  });
});

describe('turnstileOptions', () => {
  it('carries the sitekey and size through, with theme auto', () => {
    const options = turnstileOptions('site-key', 'compact', () => {});
    expect(options).toMatchObject({ sitekey: 'site-key', size: 'compact', theme: 'auto' });
  });

  it('reports the token via onToken on success, and null on expiry, timeout or error', () => {
    const onToken = vi.fn();
    const options = turnstileOptions('site-key', 'flexible', onToken) as Record<string, (...args: unknown[]) => void>;

    options.callback!('a-token');
    expect(onToken).toHaveBeenLastCalledWith('a-token');

    options['expired-callback']!();
    expect(onToken).toHaveBeenLastCalledWith(null);

    options['timeout-callback']!();
    expect(onToken).toHaveBeenLastCalledWith(null);

    options['error-callback']!();
    expect(onToken).toHaveBeenLastCalledWith(null);
  });
});
