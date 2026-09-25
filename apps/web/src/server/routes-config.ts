// The Cloudflare Pages `_routes.json` include list (scripts/build.ts's `writeRoutesJson`): every path
// backed by a Pages Function, so Pages knows not to serve it as a static asset instead. Pulled out to
// its own tiny module so a test (routes-config.test.ts) can check it without importing scripts/build.ts
// itself, which runs a full build as a side effect of module load.

export const ROUTES_JSON_INCLUDE: readonly string[] = ['/id/*', '/sitemap-profiles.xml', '/r/*'];
