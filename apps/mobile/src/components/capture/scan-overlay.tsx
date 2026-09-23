import type { ReactNode } from 'react';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';

import { Icon, Text, type IconName } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

const CORNER = 28;
const CORNER_WIDTH = 4;

/** Size of the square viewfinder for the current window. */
export function useViewfinderSize(): number {
  const { width, height } = useWindowDimensions();
  return Math.round(Math.min(width * 0.72, height * 0.42, 300));
}

/**
 * Dims everything around a square viewfinder, with corner marks and a hint underneath.
 * Draws four dim panels instead of a mask so it renders the same on iOS, Android and web.
 */
export function ScanViewfinder({ hint, footer }: { hint: string; footer?: ReactNode }) {
  const theme = useTheme();
  const size = useViewfinderSize();
  const dim = { backgroundColor: theme.overlay };
  const corner = { borderColor: theme.onPrimary };
  return (
    <View style={[StyleSheet.absoluteFill, styles.passThrough]}>
      <View style={[styles.flex, styles.noTouch, dim]} />
      <View style={[styles.row, styles.noTouch, { height: size }]}>
        <View style={[styles.flex, dim]} />
        <View style={{ width: size, height: size }}>
          <View style={[styles.corner, styles.topLeft, corner]} />
          <View style={[styles.corner, styles.topRight, corner]} />
          <View style={[styles.corner, styles.bottomLeft, corner]} />
          <View style={[styles.corner, styles.bottomRight, corner]} />
        </View>
        <View style={[styles.flex, dim]} />
      </View>
      <View style={[styles.flex, styles.below, styles.passThrough, dim]}>
        <Text variant="bodyStrong" color="onPrimary" align="center" style={styles.hint}>
          {hint}
        </Text>
        {footer}
      </View>
    </View>
  );
}

/** Round translucent icon button for use over the camera. */
export function CameraIconButton({
  icon,
  label,
  onPress,
  active,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  active?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={active === undefined ? undefined : { selected: active }}
      hitSlop={8}
      style={({ pressed }) => [
        styles.iconButton,
        { backgroundColor: active ? theme.onPrimary : theme.overlay, opacity: pressed ? 0.75 : 1 },
      ]}>
      <Icon name={icon} size={22} color={active ? 'primary' : 'onPrimary'} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row' },
  passThrough: { pointerEvents: 'box-none' },
  noTouch: { pointerEvents: 'none' },
  below: { alignItems: 'center', paddingTop: Spacing.five, paddingHorizontal: Spacing.five, gap: Spacing.four },
  hint: { maxWidth: 320 },
  corner: { position: 'absolute', width: CORNER, height: CORNER },
  topLeft: {
    top: 0,
    left: 0,
    borderTopWidth: CORNER_WIDTH,
    borderLeftWidth: CORNER_WIDTH,
    borderTopLeftRadius: Radius.md,
  },
  topRight: {
    top: 0,
    right: 0,
    borderTopWidth: CORNER_WIDTH,
    borderRightWidth: CORNER_WIDTH,
    borderTopRightRadius: Radius.md,
  },
  bottomLeft: {
    bottom: 0,
    left: 0,
    borderBottomWidth: CORNER_WIDTH,
    borderLeftWidth: CORNER_WIDTH,
    borderBottomLeftRadius: Radius.md,
  },
  bottomRight: {
    bottom: 0,
    right: 0,
    borderBottomWidth: CORNER_WIDTH,
    borderRightWidth: CORNER_WIDTH,
    borderBottomRightRadius: Radius.md,
  },
  iconButton: { width: 44, height: 44, borderRadius: Radius.pill, alignItems: 'center', justifyContent: 'center' },
});
