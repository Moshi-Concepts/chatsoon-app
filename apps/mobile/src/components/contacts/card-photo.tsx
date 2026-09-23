import { Image } from 'expo-image';
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon, Text } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** Business card thumbnail. Tap for a full-screen view. */
export function CardPhoto({ uri, name }: { uri: string; name: string }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  // Signed URLs expire. Remember which URL failed, so a refetched (newly signed) one loads again.
  const [failedUri, setFailedUri] = useState<string | null>(null);

  if (failedUri === uri) {
    return (
      <View style={[styles.thumb, styles.fallback, { backgroundColor: theme.surfaceAlt, borderColor: theme.border }]}>
        <Icon name="image-outline" size={24} color="textTertiary" />
        <Text variant="caption" color="textSecondary">
          Couldn&apos;t load the card photo
        </Text>
      </View>
    );
  }

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="imagebutton"
        accessibilityLabel={`Card photo for ${name}`}
        accessibilityHint="Opens the photo full screen"
        style={({ pressed }) => [
          styles.thumb,
          { backgroundColor: theme.surfaceAlt, borderColor: theme.border, opacity: pressed ? 0.85 : 1 },
        ]}>
        <Image
          source={{ uri }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          transition={150}
          onError={() => setFailedUri(uri)}
        />
        <View style={[styles.expand, { backgroundColor: theme.overlay }]}>
          <Icon name="expand-outline" size={16} color="onPrimary" />
        </View>
      </Pressable>

      <Modal
        visible={open}
        animationType="fade"
        onRequestClose={() => setOpen(false)}
        statusBarTranslucent
        navigationBarTranslucent>
        <Pressable
          onPress={() => setOpen(false)}
          accessibilityLabel="Close photo"
          style={[
            styles.viewer,
            {
              backgroundColor: theme.background,
              paddingTop: insets.top + 64,
              paddingBottom: insets.bottom + Spacing.five,
            },
          ]}>
          <Image
            source={{ uri }}
            style={styles.full}
            contentFit="contain"
            accessibilityLabel={`Card photo for ${name}`}
          />
        </Pressable>
        <Pressable
          onPress={() => setOpen(false)}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Close"
          style={[
            styles.close,
            { top: insets.top + Spacing.three, backgroundColor: theme.surface, borderColor: theme.border },
          ]}>
          <Icon name="close" size={22} />
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  thumb: {
    width: '100%',
    aspectRatio: 1.6,
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  fallback: { alignItems: 'center', justifyContent: 'center', gap: Spacing.two },
  expand: {
    position: 'absolute',
    right: Spacing.three,
    bottom: Spacing.three,
    width: 32,
    height: 32,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewer: { flex: 1, paddingHorizontal: Spacing.four },
  full: { flex: 1, width: '100%' },
  close: {
    position: 'absolute',
    right: Spacing.four,
    width: 44,
    height: 44,
    borderRadius: Radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
