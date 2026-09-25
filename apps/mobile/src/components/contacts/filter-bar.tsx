import type { ChatsoonEvent, Tag } from '@chatsoon/shared';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';

import { Chip, Icon } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import type { ContactFilter } from './search';

const isWeb = Platform.OS === 'web';

// How far past an edge (px) before we call it "scrolled", to absorb rounding noise from onScroll.
const EDGE_EPSILON = 1;

type MaskState = 'none' | 'left' | 'right' | 'both';

export type FilterBarProps = {
  active: ContactFilter;
  /** Total contact count, shown on the "All" chip. */
  totalCount: number;
  tags: Tag[];
  /** Contact count per tag id, from the same list the screen filters. */
  tagCounts: Map<string, number>;
  events: ChatsoonEvent[];
  /** Contact count per event id. */
  eventCounts: Map<string, number>;
  onSelectAll: () => void;
  onToggleFilter: (filter: ContactFilter) => void;
};

/**
 * The horizontal row of filter chips above the contact list: All, tags, events with a calendar
 * icon, then a fixed "Manage tags" button outside the scroll. On web it also drops the browser's
 * scrollbar for a couple of overlaid arrow buttons and edge fades, and lets a mouse wheel scroll it
 * sideways; on native it is a plain horizontal scroll.
 */
export function FilterBar({
  active,
  totalCount,
  tags,
  tagCounts,
  events,
  eventCounts,
  onSelectAll,
  onToggleFilter,
}: FilterBarProps) {
  const theme = useTheme();
  const scrollRef = useRef<ScrollView>(null);
  const [scrollX, setScrollX] = useState(0);
  const [contentWidth, setContentWidth] = useState(0);
  const [layoutWidth, setLayoutWidth] = useState(0);
  // Arrows only show for a mouse-and-trackpad setup; a touch-only device never sees them.
  const [pointerFine, setPointerFine] = useState(false);

  useEffect(() => {
    if (!isWeb || typeof window === 'undefined' || !window.matchMedia) return;
    const query = window.matchMedia('(hover: hover) and (pointer: fine)');
    const update = () => setPointerFine(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  // A vertical mouse wheel over the bar scrolls it horizontally, since a mouse wheel can't scroll
  // sideways on its own. Only intercepts when the bar can actually scroll, and only a vertical
  // gesture: a trackpad's native horizontal scroll passes straight through.
  useEffect(() => {
    if (!isWeb) return;
    const node = scrollRef.current?.getScrollableNode?.() as HTMLElement | null | undefined;
    if (!node) return;
    const handleWheel = (e: WheelEvent) => {
      if (node.scrollWidth <= node.clientWidth) return;
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      e.preventDefault();
      node.scrollLeft += e.deltaY;
    };
    node.addEventListener('wheel', handleWheel, { passive: false });
    return () => node.removeEventListener('wheel', handleWheel);
  }, []);

  const canScrollLeft = isWeb && scrollX > EDGE_EPSILON;
  const canScrollRight = isWeb && contentWidth > layoutWidth && scrollX < contentWidth - layoutWidth - EDGE_EPSILON;
  const maskState: MaskState = canScrollLeft && canScrollRight ? 'both' : canScrollLeft ? 'left' : canScrollRight ? 'right' : 'none';

  function scrollBy(direction: -1 | 1) {
    const delta = layoutWidth * 0.7 * direction;
    const next = Math.max(0, Math.min(scrollX + delta, Math.max(contentWidth - layoutWidth, 0)));
    scrollRef.current?.scrollTo({ x: next, animated: true });
  }

  function handleScroll(e: NativeSyntheticEvent<NativeScrollEvent>) {
    setScrollX(e.nativeEvent.contentOffset.x);
  }

  function handleContentSizeChange(width: number) {
    setContentWidth(width);
  }

  function handleLayout(e: LayoutChangeEvent) {
    setLayoutWidth(e.nativeEvent.layout.width);
  }

  const showDivider = tags.length > 0 && events.length > 0;

  return (
    <View style={styles.row}>
      <View style={styles.scrollWrap}>
        <ScrollView
          ref={scrollRef}
          horizontal
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          style={styles.chipScroll}
          contentContainerStyle={[styles.chips, !isWeb && styles.chipsNative]}
          onScroll={isWeb ? handleScroll : undefined}
          scrollEventThrottle={isWeb ? 16 : undefined}
          onContentSizeChange={isWeb ? handleContentSizeChange : undefined}
          onLayout={isWeb ? handleLayout : undefined}
          {...(isWeb ? { dataSet: { filterbar: 'true', filterbarMask: maskState } } : {})}>
          <Chip
            label="All"
            count={totalCount}
            selected={active.kind === 'all'}
            icon={active.kind === 'all' ? 'checkmark' : undefined}
            onPress={onSelectAll}
          />
          {tags.map((tag) => {
            const selected = active.kind === 'tag' && active.id === tag.id;
            return (
              <Chip
                key={tag.id}
                label={tag.name}
                count={tagCounts.get(tag.id) ?? 0}
                selected={selected}
                icon={selected ? 'checkmark' : undefined}
                onPress={() => onToggleFilter({ kind: 'tag', id: tag.id })}
              />
            );
          })}
          {showDivider ? <View style={[styles.divider, { backgroundColor: theme.border }]} /> : null}
          {events.map((event) => {
            const selected = active.kind === 'event' && active.id === event.id;
            return (
              <Chip
                key={event.id}
                label={event.name}
                count={eventCounts.get(event.id) ?? 0}
                selected={selected}
                icon={selected ? 'checkmark' : 'calendar-outline'}
                onPress={() => onToggleFilter({ kind: 'event', id: event.id })}
              />
            );
          })}
        </ScrollView>
        {isWeb && pointerFine && canScrollLeft ? <ArrowButton direction="left" onPress={() => scrollBy(-1)} /> : null}
        {isWeb && pointerFine && canScrollRight ? <ArrowButton direction="right" onPress={() => scrollBy(1)} /> : null}
      </View>
      <Pressable
        onPress={() => router.push('/tags')}
        accessibilityRole="button"
        accessibilityLabel="Manage tags"
        // 36 + 4 + 4 = a 44pt target, matching Chip's hitSlop.
        hitSlop={4}
        style={({ pressed }) => [
          styles.manageButton,
          { backgroundColor: theme.surface, borderColor: theme.border, opacity: pressed ? 0.8 : 1 },
        ]}>
        <Icon name="pricetags-outline" size={18} color="textSecondary" />
      </Pressable>
    </View>
  );
}

function ArrowButton({ direction, onPress }: { direction: 'left' | 'right'; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={direction === 'left' ? 'Scroll filters left' : 'Scroll filters right'}
      style={({ pressed }) => [
        styles.arrow,
        direction === 'left' ? styles.arrowLeft : styles.arrowRight,
        { backgroundColor: theme.surface, borderColor: theme.border, opacity: pressed ? 0.85 : 1 },
      ]}>
      <Icon name={direction === 'left' ? 'chevron-back' : 'chevron-forward'} size={16} color="text" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  scrollWrap: { flex: 1, position: 'relative' },
  chipScroll: { flexGrow: 0 },
  // The vertical padding keeps each chip's 4pt hitSlop inside the scroll view, which clips touches.
  chips: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingStart: Spacing.four,
    paddingEnd: Spacing.four,
    paddingVertical: Spacing.one,
  },
  // A bit more end padding so the last chip doesn't touch the Manage tags button.
  chipsNative: { paddingEnd: Spacing.six },
  divider: { width: 1, height: 20 },
  manageButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  arrow: {
    position: 'absolute',
    top: '50%',
    marginTop: -14,
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
  arrowLeft: { left: 4 },
  arrowRight: { right: 4 },
});
