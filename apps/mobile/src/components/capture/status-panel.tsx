import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Animated, Platform, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon, Text, type IconName } from '@/components/ui';
import { MaxContentWidth, Radius, Spacing, type ThemeColor } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type StatusTone = 'primary' | 'success' | 'warning' | 'danger' | 'neutral';

const tones: Record<StatusTone, { bg: ThemeColor; fg: ThemeColor }> = {
  primary: { bg: 'primarySoft', fg: 'primary' },
  success: { bg: 'successSoft', fg: 'success' },
  warning: { bg: 'warningSoft', fg: 'warning' },
  danger: { bg: 'dangerSoft', fg: 'danger' },
  neutral: { bg: 'surfaceAlt', fg: 'textSecondary' },
};

/** Centred status block: an icon badge (or a spinner, or a custom visual), title, message, actions. */
export function StatusPanel({
  icon,
  tone = 'primary',
  busy,
  visual,
  title,
  message,
  children,
}: {
  icon?: IconName;
  tone?: StatusTone;
  /** Show a spinner instead of the icon. */
  busy?: boolean;
  /** Replaces the icon badge, e.g. an avatar. */
  visual?: ReactNode;
  title: string;
  message?: string | null;
  /** Actions (buttons) under the text. */
  children?: ReactNode;
}) {
  const theme = useTheme();
  const t = tones[tone];
  return (
    <View style={styles.panel} accessibilityLiveRegion="polite">
      {visual ??
        (busy ? (
          <View style={[styles.badge, { backgroundColor: theme.primarySoft }]}>
            <ActivityIndicator size="large" color={theme.primary} />
          </View>
        ) : icon ? (
          <View style={[styles.badge, { backgroundColor: theme[t.bg] }]}>
            <Icon name={icon} size={30} color={t.fg} />
          </View>
        ) : null)}
      <View style={styles.text}>
        <Text variant="heading" align="center" accessibilityRole="header">
          {title}
        </Text>
        {message ? (
          <Text variant="callout" color="textSecondary" align="center">
            {message}
          </Text>
        ) : null}
      </View>
      {children ? <View style={styles.actions}>{children}</View> : null}
    </View>
  );
}

/** Bottom sheet over the camera for scan results. Slides up when it appears. */
export function CaptureSheet({ children }: { children: ReactNode }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [progress] = useState(() => new Animated.Value(0));

  useEffect(() => {
    // The native driver isn't available on web (react-native-web warns and falls back).
    Animated.spring(progress, {
      toValue: 1,
      useNativeDriver: Platform.OS !== 'web',
      speed: 18,
      bounciness: 4,
    }).start();
  }, [progress]);

  return (
    <Animated.View
      style={[
        styles.sheet,
        {
          backgroundColor: theme.surface,
          borderColor: theme.border,
          paddingBottom: Math.max(insets.bottom, Spacing.four) + Spacing.two,
          opacity: progress,
          transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [48, 0] }) }],
        },
      ]}>
      <View style={[styles.handle, { backgroundColor: theme.border }]} />
      <View style={styles.sheetBody}>{children}</View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  panel: { alignItems: 'center', gap: Spacing.four, paddingVertical: Spacing.three },
  badge: { width: 72, height: 72, borderRadius: Radius.xl, alignItems: 'center', justifyContent: 'center' },
  text: { gap: Spacing.two, alignItems: 'center', maxWidth: 360 },
  actions: { alignSelf: 'stretch', gap: Spacing.three, marginTop: Spacing.two },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: 0,
    paddingTop: Spacing.two,
    paddingHorizontal: Spacing.five,
  },
  handle: { alignSelf: 'center', width: 40, height: 5, borderRadius: Radius.pill, marginBottom: Spacing.two },
  sheetBody: { width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
});
