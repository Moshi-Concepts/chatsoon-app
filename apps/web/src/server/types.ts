// Local shapes for the Cloudflare Pages Function environment (docs/og-plan.md O14, §3.4, WP-5).
//
// Spelled out here rather than imported from the ambient `@cloudflare/workers-types` globals, the same
// choice apps/api/src/pages.ts makes for its own `WaitUntilCtx` (Hono's `ExecutionContext` and the
// ambient one aren't structurally assignable to each other). `functions/id/[[path]].ts` is the one file
// that talks to the real `EventContext`; every handler below only ever needs the few members declared
// here, which keeps them plain Node-testable functions with no Cloudflare types in scope at all.

/** Either service binding from wrangler.jsonc (`API`), or Cloudflare's built-in static-asset fetcher
 * (`ASSETS`, present on every Pages Function call). Both expose only `fetch`. */
export interface PagesFetcher {
  fetch(input: string | URL | Request, init?: RequestInit): Promise<Response>;
}

export interface PagesEnv {
  /** Service binding to chatsoon-api's default entrypoint (O14): GET /_pages/profile/:slug and
   * /_pages/og/:slug, both gated by PAGES_SHARED_SECRET below. */
  API: PagesFetcher;
  ASSETS: PagesFetcher;
  /** Shared with the API. Unset (a misconfigured deploy) fails safe: profile-source.ts's calls come
   * back exactly like a lookup failure, so /id/* still serves the untouched shell or the default image. */
  PAGES_SHARED_SECRET?: string;
}

/** The slice of Cloudflare's real `EventContext` every handler in this folder actually uses. */
export interface PagesContext {
  request: Request;
  env: PagesEnv;
  next(input?: Request | string, init?: RequestInit): Promise<Response>;
}
