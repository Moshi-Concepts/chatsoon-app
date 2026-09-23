import { APP_NAME } from '@chatsoon/shared';
import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui';
import { Spacing } from '@/constants/theme';

const icon = require('@/assets/images/favicon.png');

/** App icon plus the Chatsoon wordmark. */
export function BrandMark({ size = 32 }: { size?: number }) {
  return (
    <View style={styles.row}>
      <Image
        source={icon}
        style={{ width: size, height: size, borderRadius: size * 0.26 }}
        contentFit="cover"
        alt=""
      />
      <Text style={[styles.word, { fontSize: size * 0.6, lineHeight: size * 0.75 }]}>{APP_NAME}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  word: { fontWeight: '800', letterSpacing: -0.4 },
});
