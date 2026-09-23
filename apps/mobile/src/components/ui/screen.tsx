import type { ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';

import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type ScreenProps = {
  children: ReactNode;
  /** Wrap content in a ScrollView (default true). Use false for FlatList screens. */
  scroll?: boolean;
  /** Horizontal padding (default true). */
  padded?: boolean;
  /** Safe area edges. Default: none on top (headers handle it), bottom only. */
  edges?: Edge[];
  /** Sticky footer, e.g. a primary button. */
  footer?: ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
  contentStyle?: ViewStyle;
  /** Use the plain surface colour instead of the tinted background. */
  surface?: boolean;
};

/** Standard screen container: safe area, keyboard avoidance, centred column on web. */
export function Screen({
  children,
  scroll = true,
  padded = true,
  edges = ['bottom'],
  footer,
  refreshing,
  onRefresh,
  contentStyle,
  surface,
}: ScreenProps) {
  const theme = useTheme();
  const bg = surface ? theme.surface : theme.background;
  const inner = [styles.column, padded && styles.padded, contentStyle];

  return (
    <SafeAreaView edges={edges} style={[styles.flex, { backgroundColor: bg }]}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {scroll ? (
          <ScrollView
            style={styles.flex}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            refreshControl={
              onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} /> : undefined
            }>
            <View style={inner}>{children}</View>
          </ScrollView>
        ) : (
          <View style={[styles.flex, ...inner]}>{children}</View>
        )}
        {footer ? (
          <View style={[styles.footer, { borderTopColor: theme.border, backgroundColor: bg }]}>
            <View style={[styles.column, styles.padded]}>{footer}</View>
          </View>
        ) : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scrollContent: { flexGrow: 1, paddingVertical: Spacing.four },
  column: { width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center', gap: Spacing.four },
  padded: { paddingHorizontal: Spacing.four },
  footer: { paddingVertical: Spacing.three, borderTopWidth: StyleSheet.hairlineWidth },
});
