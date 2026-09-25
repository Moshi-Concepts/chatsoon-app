import '@/global.css';

import { Platform } from 'react-native';

// Chatsoon design tokens. Every screen reads colours through useTheme(), never hex literals.
// Colors, Spacing, Radius and Type live in @chatsoon/shared (packages/shared/src/design.ts) so the
// apps/web CSS generator can share them; this file re-exports them and keeps the RN-only tokens.

export { Colors, Spacing, Radius, Type } from '@chatsoon/shared';
export type { ThemeColors, ThemeColor, TypeVariant } from '@chatsoon/shared';

export const Fonts = Platform.select({
  ios: { sans: 'system-ui', mono: 'ui-monospace' },
  web: { sans: 'var(--font-display)', mono: 'var(--font-mono)' },
  default: { sans: 'normal', mono: 'monospace' },
});

/** Content column width on web and tablets. */
export const MaxContentWidth = 640;
