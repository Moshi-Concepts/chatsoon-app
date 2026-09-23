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
  return (
    <Head>
      <title>{fullTitle}</title>
      {/* The exported index.html already has <meta name="description"> (app.json web.description). */}
      {description ? <meta property="og:description" content={description} /> : null}
      <meta property="og:title" content={fullTitle} />
      <meta property="og:site_name" content={APP_NAME} />
      {noIndex ? <meta name="robots" content="noindex" /> : null}
    </Head>
  );
}
