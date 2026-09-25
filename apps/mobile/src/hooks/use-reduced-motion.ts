import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/**
 * The system's "reduce motion" setting (iOS/Android accessibility setting; `prefers-reduced-motion:
 * reduce` on web, via react-native-web). Starts `false` and flips once the initial check resolves, so
 * a decorative animation (e.g. ContactListSkeleton's pulse) can skip itself for anyone who's asked for
 * less motion.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (mounted) setReduced(value);
    });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', (value: boolean) => setReduced(value));
    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);

  return reduced;
}
