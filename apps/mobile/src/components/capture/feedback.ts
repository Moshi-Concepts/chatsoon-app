import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

// Haptic feedback for capture moments. No-ops on web and never throws.

export function tapFeedback() {
  if (Platform.OS === 'web') return;
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
}

export function selectionFeedback() {
  if (Platform.OS === 'web') return;
  Haptics.selectionAsync().catch(() => {});
}

export function resultFeedback(kind: 'success' | 'warning' | 'error') {
  if (Platform.OS === 'web') return;
  const type =
    kind === 'success'
      ? Haptics.NotificationFeedbackType.Success
      : kind === 'warning'
        ? Haptics.NotificationFeedbackType.Warning
        : Haptics.NotificationFeedbackType.Error;
  Haptics.notificationAsync(type).catch(() => {});
}
