import type { ReactNode } from 'react';
import { StyleSheet, View, useWindowDimensions, type StyleProp, type ViewStyle } from 'react-native';

import { Spacing } from '@/constants/theme';

/** Widest content column on the marketing site. */
export const SiteWidth = 1120;

/** Responsive breakpoints for the web pages. */
export function useBreakpoint() {
  const { width } = useWindowDimensions();
  const isMedium = width >= 640;
  return {
    width,
    isMedium,
    isWide: width >= 960,
    /** Side padding of a Container. */
    gutter: isMedium ? Spacing.six : Spacing.four,
  };
}

/** Centred column with responsive side padding. */
export function Container({
  children,
  width = SiteWidth,
  style,
}: {
  children: ReactNode;
  width?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const { gutter } = useBreakpoint();
  return (
    <View style={[styles.container, { maxWidth: width + gutter * 2, paddingHorizontal: gutter }, style]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { width: '100%', alignSelf: 'center' },
});
