import { StyleSheet, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { Text } from '@/components/ui';
import { useTheme } from '@/hooks/use-theme';

// The referral hub's header card (issue #11, docs/referrals.md "Referral hub"): "a progress ring
// toward the next milestone". react-native-svg is already a dependency (react-native-qrcode-svg on the
// QR tab uses it), so a real ring beats a plain bar.

const SIZE = 108;
const STROKE = 10;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function ProgressRing({
  progress,
  centerLabel,
}: {
  /** 0 to 1. Values outside that range are clamped, so an already-claimed 20/20 still draws a full ring. */
  progress: number;
  /** Short text in the middle of the ring, e.g. "3/10". */
  centerLabel: string;
}) {
  const theme = useTheme();
  const clamped = Math.max(0, Math.min(1, progress));
  const offset = CIRCUMFERENCE * (1 - clamped);

  return (
    <View style={styles.wrap} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Svg width={SIZE} height={SIZE}>
        <Circle cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} stroke={theme.surfaceAlt} strokeWidth={STROKE} fill="none" />
        <Circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          stroke={theme.primary}
          strokeWidth={STROKE}
          fill="none"
          strokeDasharray={`${CIRCUMFERENCE} ${CIRCUMFERENCE}`}
          strokeDashoffset={offset}
          strokeLinecap="round"
          // Starts the fill at 12 o'clock instead of Svg's default 3 o'clock.
          transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
        />
      </Svg>
      <View style={styles.center}>
        <Text variant="heading" numberOfLines={1} adjustsFontSizeToFit>
          {centerLabel}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: SIZE, height: SIZE },
  center: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
});
