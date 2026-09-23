import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { Icon, Text } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type StepState = 'done' | 'active' | 'todo';

/** A short vertical checklist: done steps get a tick, the active one a spinner. */
export function ProgressSteps({ steps }: { steps: { label: string; state: StepState }[] }) {
  const theme = useTheme();
  return (
    <View style={styles.list}>
      {steps.map((step) => (
        <View
          key={step.label}
          style={styles.row}
          accessibilityLabel={`${step.label}: ${step.state === 'done' ? 'done' : step.state === 'active' ? 'in progress' : 'waiting'}`}>
          <View style={styles.marker}>
            {step.state === 'done' ? (
              <Icon name="checkmark-circle" size={22} color="success" />
            ) : step.state === 'active' ? (
              <ActivityIndicator size="small" color={theme.primary} />
            ) : (
              <Icon name="ellipse-outline" size={22} color="textTertiary" />
            )}
          </View>
          <Text
            variant={step.state === 'active' ? 'bodyStrong' : 'body'}
            color={step.state === 'todo' ? 'textTertiary' : 'text'}>
            {step.label}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: Spacing.three, alignSelf: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  marker: { width: 24, alignItems: 'center' },
});
