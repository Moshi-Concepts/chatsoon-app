import { SUPPORT_EMAIL } from '@chatsoon/shared';
import { Link, Stack } from 'expo-router';
import type { ReactNode } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import { Screen, Text } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { LEGAL_LINKS, legal, type LegalDoc, type LegalDocKey } from '@/content/legal';
import { useTheme } from '@/hooks/use-theme';

import { externalLinkProps } from './link-props';
import { PageHead } from './page-head';
import { WebPage } from './web-page';

/** Makes the support address tappable wherever it appears in the text. */
function withEmailLinks(text: string): ReactNode {
  const parts = text.split(SUPPORT_EMAIL);
  if (parts.length === 1) return text;
  return parts.flatMap((part, i) =>
    i === 0
      ? [part]
      : [
          <Text key={i} color="primary" style={styles.email} {...externalLinkProps(`mailto:${SUPPORT_EMAIL}`)}>
            {SUPPORT_EMAIL}
          </Text>,
          part,
        ],
  );
}

/**
 * Privacy policy, terms and support, rendered from src/content/legal.json.
 * Web: site header and footer, no navigation header. App: a normal pushed screen.
 */
export function LegalPage({ docKey, headerTitle }: { docKey: LegalDocKey; headerTitle: string }) {
  const isWeb = Platform.OS === 'web';
  const doc = legal[docKey];
  const body = <LegalBody docKey={docKey} doc={doc} showTitle={isWeb} />;
  return (
    <>
      <Stack.Screen options={{ title: headerTitle, headerShown: !isWeb }} />
      <PageHead title={doc.title} description={doc.intro} />
      {isWeb ? <WebPage contentWidth={720}>{body}</WebPage> : <Screen>{body}</Screen>}
    </>
  );
}

function LegalBody({ docKey, doc, showTitle }: { docKey: LegalDocKey; doc: LegalDoc; showTitle: boolean }) {
  const theme = useTheme();
  const others = LEGAL_LINKS.filter((l) => l.key !== docKey);
  return (
    <View style={styles.body}>
      <View style={styles.top}>
        {showTitle ? (
          <Text variant="largeTitle" role="heading">
            {doc.title}
          </Text>
        ) : null}
        <Text variant="caption" color="textTertiary">
          Last updated {doc.updated}
        </Text>
        <Text variant="body" color="textSecondary" style={styles.intro}>
          {withEmailLinks(doc.intro)}
        </Text>
      </View>

      {doc.sections.map((section) => (
        <View key={section.heading} style={styles.section}>
          <Text variant="heading">{section.heading}</Text>
          {section.paragraphs?.map((p) => (
            <Text key={p} variant="body" color="textSecondary" style={styles.paragraph}>
              {withEmailLinks(p)}
            </Text>
          ))}
          {section.bullets ? (
            <View role="list" style={styles.bullets}>
              {section.bullets.map((b) => (
                <View key={b} role="listitem" style={styles.bullet}>
                  <View style={[styles.dot, { backgroundColor: theme.primary }]} />
                  <Text variant="body" color="textSecondary" style={[styles.paragraph, styles.flex]}>
                    {withEmailLinks(b)}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}
        </View>
      ))}

      {/* The website footer already links these; in the app they're the way across. */}
      {Platform.OS !== 'web' ? (
        <View style={[styles.related, { borderTopColor: theme.border }]}>
          {others.map((l) => (
            <Link key={l.key} href={l.href}>
              <Text variant="bodyStrong" color="primary">
                {legal[l.key].title}
              </Text>
            </Link>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  body: { gap: Spacing.six, paddingBottom: Spacing.five },
  top: { gap: Spacing.two },
  intro: { fontSize: 17, lineHeight: 26, marginTop: Spacing.two },
  section: { gap: Spacing.three },
  paragraph: { lineHeight: 25 },
  bullets: { gap: Spacing.three },
  bullet: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.three },
  dot: { width: 6, height: 6, borderRadius: 3, marginTop: 10 },
  email: { fontWeight: '600' },
  related: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: Spacing.five,
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: Spacing.five,
    rowGap: Spacing.three,
  },
});
