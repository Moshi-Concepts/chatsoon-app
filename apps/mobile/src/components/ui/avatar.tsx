import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';

import { useTheme } from '@/hooks/use-theme';
import { initials } from '@/lib/format';

import { Text } from './text';

export function Avatar({ name, uri, size = 44 }: { name: string; uri?: string | null; size?: number }) {
  const theme = useTheme();
  const box = { width: size, height: size, borderRadius: size / 2 };
  if (uri) {
    return (
      <Image
        source={{ uri }}
        style={[box, { backgroundColor: theme.surfaceAlt }]}
        contentFit="cover"
        accessibilityLabel={name}
      />
    );
  }
  return (
    <View style={[styles.fallback, box, { backgroundColor: theme.primarySoft }]} accessibilityLabel={name}>
      <Text style={{ fontSize: size * 0.38, lineHeight: size * 0.46, fontWeight: '700' }} color="primary">
        {initials(name)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({ fallback: { alignItems: 'center', justifyContent: 'center' } });
