import { Image } from 'expo-image';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Icon, Text } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** Business card aspect ratio (85 x 55 mm). */
const CARD_RATIO = 85 / 55;

/** The photographed card. Tap to toggle between a cropped preview and the whole photo. */
export function CardPhoto({ uri }: { uri: string | null | undefined }) {
  const theme = useTheme();
  const [expanded, setExpanded] = useState(false);
  const [failedUri, setFailedUri] = useState<string | null>(null);
  const failed = !!uri && failedUri === uri;

  if (!uri || failed) {
    return (
      <View style={[styles.frame, styles.empty, { backgroundColor: theme.surfaceAlt, borderColor: theme.border }]}>
        <Icon name="id-card-outline" size={36} color="textTertiary" />
        <Text variant="caption" color="textTertiary">
          {failed ? "Couldn't load the photo" : 'No photo'}
        </Text>
      </View>
    );
  }

  return (
    <Pressable
      onPress={() => setExpanded((v) => !v)}
      accessibilityRole="imagebutton"
      accessibilityLabel={expanded ? 'Card photo. Tap to show less' : 'Card photo. Tap to see the whole photo'}
      style={[
        styles.frame,
        { backgroundColor: theme.surfaceAlt, borderColor: theme.border },
        expanded && styles.expanded,
      ]}>
      <Image
        source={{ uri }}
        style={StyleSheet.absoluteFill}
        contentFit={expanded ? 'contain' : 'cover'}
        transition={200}
        onError={() => setFailedUri(uri)}
      />
      <View style={[styles.zoom, { backgroundColor: theme.overlay }]}>
        <Icon name={expanded ? 'contract-outline' : 'expand-outline'} size={16} color="onPrimary" />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  frame: {
    width: '100%',
    aspectRatio: CARD_RATIO,
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  expanded: { aspectRatio: 3 / 4 },
  empty: { alignItems: 'center', justifyContent: 'center', gap: Spacing.two },
  zoom: {
    position: 'absolute',
    right: Spacing.three,
    bottom: Spacing.three,
    width: 32,
    height: 32,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
