/// <reference lib="dom" />
// Cloudflare Turnstile for the server-rendered Connect form (WP-C4), ported from
// apps/mobile/src/components/web/turnstile.tsx. Two differences from the app's version: the script is
// injected lazily (on first focusin/pointerdown in the form, or on submit — never at page load, see
// profile.ts/connect.ts) rather than on mount, and there's exactly one widget on the page, so this
// module keeps its state at module scope instead of behind a React ref.

export const TURNSTILE_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

export interface TurnstileApi {
  render: (container: HTMLElement, options: Record<string, unknown>) => string | null | undefined;
  reset: (widgetId: string) => void;
  remove: (widgetId: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

/**
 * Wraps an async `fn` so overlapping calls share one in-flight promise, and a rejection clears the
 * memo so the next call retries instead of replaying the same failure forever. Kept DOM-free and
 * generic so the "load once" behaviour is unit-testable without a real script tag.
 */
export function once<T>(fn: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | null = null;
  return () => {
    if (!pending) {
      pending = fn().catch((err: unknown) => {
        pending = null;
        throw err;
      });
    }
    return pending;
  };
}

/** Loads the Turnstile script at most once per page (module-level memo via `once`). */
export const loadTurnstile: () => Promise<TurnstileApi> = once(
  () =>
    new Promise<TurnstileApi>((resolve, reject) => {
      if (window.turnstile) {
        resolve(window.turnstile);
        return;
      }
      const script = document.createElement('script');
      script.src = TURNSTILE_SRC;
      script.async = true;
      script.onload = () => {
        if (window.turnstile) resolve(window.turnstile);
        else reject(new Error('Turnstile did not initialise'));
      };
      script.onerror = () => {
        script.remove();
        reject(new Error('Turnstile failed to load'));
      };
      document.head.appendChild(script);
    }),
);

/** The flexible widget needs at least 300px; narrower columns get the compact one. */
export function turnstileSize(width: number): 'flexible' | 'compact' {
  return width >= 300 ? 'flexible' : 'compact';
}

/** Render options for a widget that reports its token (or null on expiry/timeout/error) via `onToken`. */
export function turnstileOptions(
  sitekey: string,
  size: 'flexible' | 'compact',
  onToken: (token: string | null) => void,
): Record<string, unknown> {
  return {
    sitekey,
    size,
    theme: 'auto',
    callback: (token: string) => onToken(token),
    'expired-callback': () => onToken(null),
    'timeout-callback': () => onToken(null),
    // Turnstile retries on its own; the caller just waits for a fresh token.
    'error-callback': () => onToken(null),
  };
}

export interface TurnstileWidget {
  /** Clears the current token and requests a fresh challenge. Call after every submit (tokens are single use). */
  reset(): void;
}

/**
 * Renders one widget into `container`, sized from its current width, loading the script first if
 * needed. `onToken` fires with the current token any time it changes (a fresh pass, expiry, timeout
 * or error) — including once with `null` if the script never loads at all.
 */
export function mountTurnstile(
  container: HTMLElement,
  sitekey: string,
  onToken: (token: string | null) => void,
): TurnstileWidget {
  let widgetId: string | null = null;
  const size = turnstileSize(container.getBoundingClientRect().width || container.clientWidth);
  loadTurnstile()
    .then((turnstile) => {
      widgetId = turnstile.render(container, turnstileOptions(sitekey, size, onToken)) ?? null;
    })
    .catch(() => onToken(null));
  return {
    reset: () => {
      onToken(null);
      if (widgetId && window.turnstile) window.turnstile.reset(widgetId);
    },
  };
}
