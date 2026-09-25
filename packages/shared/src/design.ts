// Design tokens shared by the mobile RN theme (apps/mobile/src/constants/theme.ts, which re-exports
// everything here) and the apps/web CSS generator (Stage B). No React Native imports: this file also
// runs in a Cloudflare Pages Function.

export const Colors = {
  light: {
    background: '#F6F6FA',
    surface: '#FFFFFF',
    surfaceAlt: '#EFEFF6',
    border: '#E2E2EC',
    text: '#12131A',
    textSecondary: '#5C5F72',
    textTertiary: '#686B7F',
    primary: '#5146E5',
    primaryPressed: '#4238C9',
    onPrimary: '#FFFFFF',
    primarySoft: '#ECEBFF',
    accent: '#FF6B4A',
    accentSoft: '#FFEDE8',
    success: '#12A150',
    successSoft: '#E4F6EC',
    warning: '#B86E00',
    warningSoft: '#FFF3DC',
    danger: '#D63A3A',
    dangerSoft: '#FDECEC',
    overlay: 'rgba(10, 10, 20, 0.55)',
    primaryText: '#5146E5',
    successText: '#0E7A3E',
    dangerText: '#B42D2D',
  },
  dark: {
    background: '#0B0B10',
    surface: '#16161F',
    surfaceAlt: '#1F1F2B',
    border: '#2B2B3A',
    text: '#F3F3F8',
    textSecondary: '#A5A7B8',
    textTertiary: '#8A8DA1',
    primary: '#5A50F0',
    primaryPressed: '#4C42D9',
    onPrimary: '#FFFFFF',
    primarySoft: '#24224C',
    accent: '#FF7D5E',
    accentSoft: '#3A2019',
    success: '#34C372',
    successSoft: '#143222',
    warning: '#F0A93B',
    warningSoft: '#3A2A10',
    danger: '#FF6464',
    dangerSoft: '#3A1D22',
    overlay: 'rgba(0, 0, 0, 0.65)',
    primaryText: '#8F88FF',
    successText: '#34C372',
    dangerText: '#FF6464',
  },
} as const;

export type ThemeColors = { [K in keyof typeof Colors.light]: string };
export type ThemeColor = keyof ThemeColors;

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 12,
  four: 16,
  five: 24,
  six: 32,
  seven: 48,
} as const;

export const Radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  pill: 999,
} as const;

export const Type = {
  largeTitle: { fontSize: 32, lineHeight: 38, fontWeight: '700' },
  title: { fontSize: 26, lineHeight: 32, fontWeight: '700' },
  heading: { fontSize: 20, lineHeight: 26, fontWeight: '600' },
  subheading: { fontSize: 17, lineHeight: 22, fontWeight: '600' },
  body: { fontSize: 16, lineHeight: 22, fontWeight: '400' },
  bodyStrong: { fontSize: 16, lineHeight: 22, fontWeight: '600' },
  callout: { fontSize: 15, lineHeight: 20, fontWeight: '400' },
  caption: { fontSize: 13, lineHeight: 18, fontWeight: '400' },
  captionStrong: { fontSize: 13, lineHeight: 18, fontWeight: '600' },
  small: { fontSize: 12, lineHeight: 16, fontWeight: '500' },
} as const;
export type TypeVariant = keyof typeof Type;
