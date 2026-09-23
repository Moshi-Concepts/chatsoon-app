import { APP_NAME } from '@chatsoon/shared';
import { useId } from 'react';
import { Platform } from 'react-native';
import Svg, { Circle, Defs, G, LinearGradient, Path, Rect, Stop } from 'react-native-svg';

import { useTheme } from '@/hooks/use-theme';

// Same artwork as the app icon (assets/brand/icon.svg): a speech bubble with three dots on a
// rounded square, drawn in a 1024 unit box so the geometry matches the icon exactly.
const BUBBLE =
  'M362 250H662A150 150 0 0 1 812 400V560A150 150 0 0 1 662 710H470L318 826' +
  'C304 836 286 824 291 807L318 710A150 150 0 0 1 212 560V400A150 150 0 0 1 362 250Z';

export type LogoProps = {
  /** Width and height in points. */
  size?: number;
  /** Read by screen readers. Pass null when the logo sits next to the app name. */
  accessibilityLabel?: string | null;
};

/** react-native-svg passes props straight to the DOM on web, where `accessible` isn't an attribute. */
function a11yProps(label: string | null) {
  if (Platform.OS === 'web') return label ? { role: 'img' as const, 'aria-label': label } : { 'aria-hidden': true };
  return label ? { accessible: true, accessibilityRole: 'image' as const, accessibilityLabel: label } : { accessible: false };
}

/** The Chatsoon mark. */
export function Logo({ size = 48, accessibilityLabel = APP_NAME }: LogoProps) {
  const theme = useTheme();
  // A unique gradient id per logo: on web every SVG shares one document, and a hidden screen
  // (an inactive tab) that owns a duplicate id would blank out the others.
  const gradientId = `chatsoonLogo${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const decorative = accessibilityLabel === null;
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 1024 1024"
      {...a11yProps(decorative ? null : accessibilityLabel)}>
      <Defs>
        <LinearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={theme.primary} />
          <Stop offset="1" stopColor={theme.primaryPressed} />
        </LinearGradient>
      </Defs>
      <Rect width={1024} height={1024} rx={232} fill={`url(#${gradientId})`} />
      <G transform="translate(0 -28)">
        <Path d={BUBBLE} fill={theme.onPrimary} />
        <Circle cx={387} cy={480} r={50} fill={theme.primary} />
        <Circle cx={512} cy={480} r={50} fill={theme.primary} />
        <Circle cx={637} cy={480} r={50} fill={theme.accent} />
      </G>
    </Svg>
  );
}
