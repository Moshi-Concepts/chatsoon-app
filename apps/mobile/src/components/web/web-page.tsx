import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { Container } from './layout';
import { SiteFooter } from './site-footer';
import { SiteHeader } from './site-header';

/**
 * Page shell for the public website: brand header, content and footer.
 * With contentWidth, children are placed in a centred column of that width.
 * Without it, children lay out their own full-bleed sections (the landing page).
 */
export function WebPage({ children, contentWidth }: { children: ReactNode; contentWidth?: number }) {
  const theme = useTheme();
  return (
    <ScrollView
      style={[styles.flex, { backgroundColor: theme.background }]}
      contentContainerStyle={styles.scroll}
      keyboardShouldPersistTaps="handled">
      <SiteHeader />
      <View role="main" style={styles.flex}>
        {contentWidth ? (
          <Container width={contentWidth} style={styles.content}>
            {children}
          </Container>
        ) : (
          children
        )}
      </View>
      <SiteFooter />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scroll: { flexGrow: 1 },
  content: { paddingVertical: Spacing.six, gap: Spacing.five },
});
