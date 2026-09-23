import { Pressable, StyleSheet, View } from 'react-native';

import { Icon, Text, type IconName } from '@/components/ui';
import { Radius, Spacing, type ThemeColor } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Tone = 'primary' | 'accent' | 'success';

const tones: Record<Tone, { bg: ThemeColor; fg: ThemeColor }> = {
  primary: { bg: 'primarySoft', fg: 'primary' },
  accent: { bg: 'accentSoft', fg: 'accent' },
  success: { bg: 'successSoft', fg: 'success' },
};

/** Large tappable card on the Add tab: icon, title and a one-line description. */
export function CaptureOption({
  icon,
  title,
  description,
  onPress,
  tone = 'primary',
}: {
  icon: IconName;
  title: string;
  description: string;
  onPress: () => void;
  tone?: Tone;
}) {
  const theme = useTheme();
  const t = tones[tone];
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={description}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: pressed ? theme.surfaceAlt : theme.surface,
          borderColor: theme.border,
          transform: [{ scale: pressed ? 0.985 : 1 }],
        },
      ]}>
      <View style={[styles.badge, { backgroundColor: theme[t.bg] }]}>
        <Icon name={icon} size={28} color={t.fg} />
      </View>
      <View style={styles.body}>
        <Text variant="subheading">{title}</Text>
        <Text variant="callout" color="textSecondary">
          {description}
        </Text>
      </View>
      <Icon name="chevron-forward" size={20} color="textTertiary" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.four,
    padding: Spacing.four,
    paddingVertical: Spacing.five,
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  badge: { width: 56, height: 56, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, gap: Spacing.one },
});
