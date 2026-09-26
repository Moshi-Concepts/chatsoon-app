import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Platform,
  ScrollView,
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';

import { Button, Chip, Icon, Screen, Text } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { INTRO_CARDS, type IntroCard } from '@/content/intro';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { useTheme } from '@/hooks/use-theme';

// First-run "How Chatsoon works" intro (issue #32). Shown once, right after a new account finishes
// onboarding (apps/mobile/src/app/onboarding.tsx's finish() replaces here instead of straight to
// /contacts), and replayable any time from Me > How Chatsoon works (?replay=1). No server state:
// onboarding only ever runs once per account, so landing here once is enough.

const COUNT = INTRO_CARDS.length;
/** How long to wait after the last scroll event before treating the scroll as settled (web fallback -
 * see the paging comment below). Comfortably above a single scroll tick, well under human-perceptible. */
const SCROLL_SETTLE_MS = 120;

export default function IntroScreen() {
  const theme = useTheme();
  const reducedMotion = useReducedMotion();
  const replaying = useLocalSearchParams<{ replay?: string }>().replay === '1';

  const [pageWidth, setPageWidth] = useState(0);
  // A horizontal ScrollView doesn't stretch its pages vertically, so each page gets the pager's
  // measured height too; that's what lets the card sit centred instead of hugging the top.
  const [pageHeight, setPageHeight] = useState(0);
  const [index, setIndex] = useState(0);
  const scrollRef = useRef<ScrollView>(null);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (settleTimer.current) clearTimeout(settleTimer.current);
  }, []);

  const finish = useCallback(() => {
    if (replaying) {
      if (router.canGoBack()) router.back();
      else router.replace('/me');
    } else {
      router.replace('/contacts');
    }
  }, [replaying]);

  const goTo = useCallback(
    (next: number) => {
      const clamped = Math.max(0, Math.min(COUNT - 1, next));
      setIndex(clamped);
      if (pageWidth > 0) scrollRef.current?.scrollTo({ x: clamped * pageWidth, animated: !reducedMotion });
    },
    [pageWidth, reducedMotion],
  );

  const commitFromOffset = useCallback(
    (offsetX: number) => {
      if (pageWidth <= 0) return;
      const next = Math.max(0, Math.min(COUNT - 1, Math.round(offsetX / pageWidth)));
      setIndex((prev) => (prev === next ? prev : next));
    },
    [pageWidth],
  );

  // Debounced onScroll: the index (dots, button label) is committed ~120ms after the last scroll
  // tick, on every platform. react-native-web's pagingEnabled is CSS scroll-snap (verified in
  // node_modules/react-native-web/dist/exports/ScrollView), which settles fast on its own; a plain
  // wheel/trackpad scroll there never fires onMomentumScrollEnd/onScrollEndDrag, only `onScroll` ticks.
  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const offsetX = e.nativeEvent.contentOffset.x;
      if (settleTimer.current) clearTimeout(settleTimer.current);
      settleTimer.current = setTimeout(() => commitFromOffset(offsetX), SCROLL_SETTLE_MS);
    },
    [commitFromOffset],
  );

  // Native-only fast path: a real swipe fires onMomentumScrollEnd/onScrollEndDrag reliably there the
  // moment it settles, resolving the index immediately instead of waiting out the debounce above.
  // react-native-web's synthetic responder system fires these two spuriously on web (e.g. releasing a
  // click on the Next/Skip button next to an active scroll responder can trigger onScrollEndDrag with
  // whatever partial offset the scroller happened to be at) - confirmed by manual testing, where it
  // clobbered a just-committed correct index with a stale one. So this fast path is native-only; web
  // relies solely on the debounced onScroll above, which was verified to settle quickly and correctly.
  const onScrollSettledNative = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (settleTimer.current) {
        clearTimeout(settleTimer.current);
        settleTimer.current = null;
      }
      commitFromOffset(e.nativeEvent.contentOffset.x);
    },
    [commitFromOffset],
  );
  const onScrollSettled = Platform.OS === 'web' ? undefined : onScrollSettledNative;

  // `onPagerLayout` is only ever created once (empty deps below), so it can't close over `index`
  // directly - that would freeze it at whatever `index` was on the first render. A ref sidesteps that.
  const indexRef = useRef(0);
  useEffect(() => {
    indexRef.current = index;
  }, [index]);

  // Re-measure on layout (including web window resizes) and keep the current page aligned without
  // animating the correction. Only acts when the width actually changed, so a same-size layout pass
  // mid-swipe (or mid programmatic scroll) can't snap the scroller back and fight the in-flight scroll.
  const onPagerLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setPageHeight(height);
    setPageWidth((prev) => {
      if (prev !== width && width > 0) scrollRef.current?.scrollTo({ x: indexRef.current * width, animated: false });
      return width;
    });
  }, []);

  // Announce the new card: native has an imperative announcer; react-native-web's is a no-op, so web
  // gets its own polite live region (rendered below, off-screen) instead.
  const [liveMessage, setLiveMessage] = useState('');
  useEffect(() => {
    const message = `Card ${index + 1} of ${COUNT}: ${INTRO_CARDS[index].title}`;
    if (Platform.OS === 'web') setLiveMessage(message);
    else AccessibilityInfo.announceForAccessibility(message);
  }, [index]);

  // Left/right arrow keys move between cards on web. The scroller and buttons are already focusable;
  // this just gives keyboard users the same paging gesture touch users get.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        goTo(index + 1);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        goTo(index - 1);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [goTo, index]);

  const isLast = index === COUNT - 1;
  const nextLabel = !isLast ? 'Next' : replaying ? 'Done' : 'Get started';

  return (
    <Screen
      edges={['top', 'bottom']}
      scroll={false}
      contentStyle={styles.content}
      footer={
        <Button title={nextLabel} icon={isLast ? undefined : 'arrow-forward'} onPress={() => (isLast ? finish() : goTo(index + 1))} />
      }>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.topRow}>
        {!isLast ? (
          <Button title="Skip" variant="ghost" size="sm" fullWidth={false} onPress={finish} />
        ) : (
          <View style={styles.topRowSpacer} />
        )}
      </View>

      <View style={styles.dotsRow} accessible accessibilityLabel={`Card ${index + 1} of ${COUNT}`}>
        {INTRO_CARDS.map((card, i) => (
          <View
            key={card.title}
            aria-hidden
            style={[styles.dot, { backgroundColor: i === index ? theme.primary : theme.border }, i === index && styles.dotActive]}
          />
        ))}
      </View>

      <View style={styles.pagerWrap} onLayout={onPagerLayout}>
        <ScrollView
          ref={scrollRef}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          bounces={false}
          onScroll={onScroll}
          onMomentumScrollEnd={onScrollSettled}
          onScrollEndDrag={onScrollSettled}
          scrollEventThrottle={16}
          style={styles.pager}>
          {INTRO_CARDS.map((card) => (
            <View key={card.title} style={[styles.page, { width: pageWidth || undefined, height: pageHeight || undefined }]}>
              <IntroCardView card={card} />
            </View>
          ))}
        </ScrollView>
      </View>

      {Platform.OS === 'web' ? (
        // Visually hidden polite live region: announces the card change to screen readers on web,
        // where AccessibilityInfo.announceForAccessibility (used above on native) is a no-op.
        <View aria-live="polite" style={styles.srOnly}>
          <Text>{liveMessage}</Text>
        </View>
      ) : null}
    </Screen>
  );
}

function IntroCardView({ card }: { card: IntroCard }) {
  const theme = useTheme();
  return (
    <View style={styles.card} role="group">
      <View aria-hidden style={[styles.iconCircle, { backgroundColor: theme.primarySoft }]}>
        <Icon name={card.icon} size={44} color="primary" />
      </View>
      <Chip label={card.where} icon={card.whereIcon} />
      <Text variant="title" align="center" accessibilityRole="header">
        {card.title}
      </Text>
      <Text variant="body" color="textSecondary" align="center" style={styles.cardBody}>
        {card.body}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { flex: 1, gap: Spacing.three, paddingTop: Spacing.two },
  topRow: { flexDirection: 'row', justifyContent: 'flex-end', minHeight: 36 },
  topRowSpacer: { height: 36 },
  dotsRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: Spacing.two },
  dot: { width: 8, height: 8, borderRadius: Radius.pill },
  dotActive: { width: 20 },
  pagerWrap: { flex: 1 },
  pager: { flex: 1 },
  page: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.four },
  card: { width: '100%', maxWidth: 440, alignItems: 'center', gap: Spacing.four },
  iconCircle: { width: 112, height: 112, borderRadius: Radius.xl, alignItems: 'center', justifyContent: 'center' },
  cardBody: { maxWidth: 360, lineHeight: 24 },
  // Off-screen but present in the DOM/accessibility tree (unlike display:none, which hides it from
  // screen readers too, or opacity:0 alone, which can still be visible to sighted keyboard users).
  srOnly: {
    position: 'absolute',
    width: 1,
    height: 1,
    overflow: 'hidden',
    opacity: 0,
  },
});
