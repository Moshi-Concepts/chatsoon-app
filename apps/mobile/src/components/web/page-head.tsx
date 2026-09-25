import { APP_NAME, TAGLINE } from '@chatsoon/shared';
import Head from 'expo-router/head';
import { Platform } from 'react-native';

/** Document title and meta tags on web. Renders nothing on iOS and Android. */
export function PageHead({
  title,
  description,
  noIndex,
}: {
  /** Page name; the site name is appended. Omit for the home page. */
  title?: string;
  description?: string;
  /** Ask search engines not to index this page. */
  noIndex?: boolean;
}) {
  if (Platform.OS !== 'web') return null;
  const fullTitle = title ? `${title} · ${APP_NAME}` : `${APP_NAME}: ${TAGLINE}`;
  // og:title, og:description and og:site_name used to be set here too, but a crawler never runs this
  // app's JS, so they only ever produced duplicates of the tags apps/web/src/render/{layout,shell}.ts
  // already emit server-side (docs/og-plan.md O17). `description` is kept as a prop so its call sites
  // don't need to change.
  return (
    <Head>
      <title>{fullTitle}</title>
      {noIndex ? <meta name="robots" content="noindex" /> : null}
    </Head>
  );
}
