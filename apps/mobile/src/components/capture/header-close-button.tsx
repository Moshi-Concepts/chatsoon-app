import { router } from 'expo-router';
import { Pressable, StyleSheet } from 'react-native';

import { Icon } from '@/components/ui';

/** Header "X" for capture screens presented as modals (which get no back button on iOS). */
export function HeaderCloseButton({ fallback = '/add' }: { fallback?: string }) {
  return (
    <Pressable
      onPress={() => {
        if (router.canGoBack()) router.back();
        else router.replace(fallback);
      }}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel="Close"
      style={({ pressed }) => [styles.button, { opacity: pressed ? 0.6 : 1 }]}>
      <Icon name="close" size={26} color="primary" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
});
