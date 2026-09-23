import { PRIORITY_LABELS } from '@chatsoon/shared';
import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

const LEVELS = [1, 2, 3, 4, 5] as const;

export function priorityLabel(priority: number): string {
  return PRIORITY_LABELS[priority] ?? String(priority);
}

/** 1 to 5 segmented control. Tapping the selected level again clears it. */
export function PriorityPicker({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (priority: number | null) => void;
}) {
  const theme = useTheme();
  return (
    <View style={styles.wrap}>
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel="Priority"
        style={[styles.track, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        {LEVELS.map((level) => {
          const on = value === level;
          return (
            <Pressable
              key={level}
              onPress={() => onChange(on ? null : level)}
              accessibilityRole="radio"
              accessibilityState={{ checked: on }}
              accessibilityLabel={`Priority ${level}, ${priorityLabel(level)}`}
              accessibilityHint={on ? 'Tap again to clear' : undefined}
              style={({ pressed }) => [
                styles.segment,
                {
                  backgroundColor: on ? theme.primary : pressed ? theme.surfaceAlt : 'transparent',
                },
              ]}>
              <Text variant="bodyStrong" color={on ? 'onPrimary' : 'text'}>
                {level}
              </Text>
              <Text variant="small" color={on ? 'onPrimary' : 'textSecondary'} numberOfLines={1}>
                {priorityLabel(level)}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Text variant="caption" color="textTertiary">
        {value ? 'Tap the selected level again to clear it.' : 'How important it is to follow up.'}
      </Text>
    </View>
  );
}

/** Read-only priority: five bars plus the label, e.g. "4 · High". */
export function PriorityMeter({ value }: { value: number }) {
  const theme = useTheme();
  const high = value >= 4;
  return (
    <View
      style={styles.meter}
      accessible
      accessibilityLabel={`Priority ${value} of 5, ${priorityLabel(value)}`}>
      <View style={styles.bars}>
        {LEVELS.map((level) => (
          <View
            key={level}
            style={[
              styles.bar,
              { backgroundColor: level <= value ? (high ? theme.accent : theme.primary) : theme.border },
            ]}
          />
        ))}
      </View>
      <Text variant="bodyStrong">
        {value} · {priorityLabel(value)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.two },
  track: {
    flexDirection: 'row',
    padding: Spacing.one,
    gap: Spacing.one,
    borderRadius: Radius.md,
    borderWidth: 1,
  },
  segment: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.two,
    borderRadius: Radius.sm,
    minHeight: 52,
  },
  meter: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  bars: { flexDirection: 'row', gap: 3 },
  bar: { width: 16, height: 8, borderRadius: 4 },
});
