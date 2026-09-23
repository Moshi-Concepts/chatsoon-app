import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps } from 'react';

import type { ThemeColor } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type IconName = ComponentProps<typeof Ionicons>['name'];

export function Icon({ name, size = 22, color = 'text' }: { name: IconName; size?: number; color?: ThemeColor }) {
  const theme = useTheme();
  return <Ionicons name={name} size={size} color={theme[color]} />;
}
