import { COPYRIGHT, SUPPORT_EMAIL, TAGLINE } from '@chatsoon/shared';
import { Link } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { LEGAL_LINKS } from '@/content/legal';
import { useTheme } from '@/hooks/use-theme';

import { BrandMark } from './brand-mark';
import { externalLinkProps } from './link-props';
import { Container, useBreakpoint } from './layout';

export function SiteFooter() {
  const theme = useTheme();
  const { isMedium } = useBreakpoint();
  return (
    <View role="contentinfo" style={[styles.bar, { borderTopColor: theme.border }]}>
      <Container style={[styles.inner, isMedium && styles.innerWide]}>
        <View style={styles.brand}>
          <BrandMark size={24} />
          <Text variant="caption" color="textSecondary">
            {TAGLINE}
          </Text>
        </View>
        <View style={[styles.meta, isMedium && styles.metaWide]}>
          <View role="navigation" style={styles.links}>
            {LEGAL_LINKS.map((l) => (
              <Link key={l.key} href={l.href}>
                <Text variant="callout" color="textSecondary">
                  {l.label}
                </Text>
              </Link>
            ))}
            <Text variant="callout" color="textSecondary" {...externalLinkProps(`mailto:${SUPPORT_EMAIL}`)}>
              {SUPPORT_EMAIL}
            </Text>
          </View>
          <Text variant="caption" color="textTertiary">
            © 2026 {COPYRIGHT}
          </Text>
        </View>
      </Container>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { borderTopWidth: StyleSheet.hairlineWidth, paddingVertical: Spacing.six },
  inner: { gap: Spacing.five },
  innerWide: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  brand: { gap: Spacing.two },
  meta: { gap: Spacing.three },
  metaWide: { alignItems: 'flex-end' },
  links: { flexDirection: 'row', flexWrap: 'wrap', columnGap: Spacing.five, rowGap: Spacing.two },
});
