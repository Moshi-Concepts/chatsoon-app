import type { Contact } from '@chatsoon/shared';
import { useEffect, useState } from 'react';
import { Animated, Platform, Pressable, StyleSheet, View, type ViewStyle } from 'react-native';

import { Avatar, Icon, Text } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { roleLine } from '@/lib/format';

import { Pill } from './pill';
import { priorityLabel } from './priority';
import { isReadingCard, needsReview, rowSourceIcon } from './source';

const AVATAR = 46;
const MAX_TAGS = 2;

/** Rows sit in one rounded, bordered group; first and last round the corners. */
function groupStyle(first: boolean, last: boolean, border: string): ViewStyle[] {
  return [
    { borderColor: border, borderLeftWidth: StyleSheet.hairlineWidth, borderRightWidth: StyleSheet.hairlineWidth },
    first ? styles.first : {},
    last ? styles.last : {},
  ];
}

export function ContactRow({
  contact,
  tagNames,
  first,
  last,
  onPress,
}: {
  contact: Contact;
  tagNames: Map<string, string>;
  first: boolean;
  last: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const subtitle = roleLine(contact.role, contact.company);
  const tags = contact.tagIds.flatMap((id) => {
    const name = tagNames.get(id);
    return name ? [{ id, name }] : [];
  });
  const extraTags = tags.length - MAX_TAGS;
  const review = needsReview(contact.extractionStatus);
  const reading = isReadingCard(contact.extractionStatus);
  const important = contact.priority != null && contact.priority >= 4;
  const source = rowSourceIcon(contact.source);
  const hasMeta = review || reading || tags.length > 0;

  const a11y = [
    contact.name,
    subtitle,
    important ? `${priorityLabel(contact.priority!)} priority` : null,
    review ? 'Needs review' : reading ? 'Reading card' : null,
    tags.length ? `Tags: ${tags.map((t) => t.name).join(', ')}` : null,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      accessibilityHint={review || reading ? 'Opens the card review' : undefined}
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: pressed ? theme.surfaceAlt : theme.surface },
        ...groupStyle(first, last, theme.border),
      ]}>
      <Avatar name={contact.name} size={AVATAR} />
      <View
        style={[
          styles.body,
          !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.border },
        ]}>
        <View style={styles.titleLine}>
          <Text variant="bodyStrong" numberOfLines={1} style={styles.name}>
            {contact.name}
          </Text>
          {important ? <Pill label={priorityLabel(contact.priority!)} icon="flame" tone="accent" /> : null}
          {source ? <Icon name={source} size={16} color="textTertiary" /> : null}
        </View>
        {subtitle ? (
          <Text variant="caption" color="textSecondary" numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
        {hasMeta ? (
          <View style={styles.meta}>
            {review ? <Pill label="Review" icon="alert-circle" tone="warning" /> : null}
            {reading ? <Pill label="Reading card…" icon="sparkles" tone="primary" /> : null}
            {tags.slice(0, MAX_TAGS).map((tag) => (
              <Pill key={tag.id} label={tag.name} />
            ))}
            {extraTags > 0 ? <Pill label={`+${extraTags}`} /> : null}
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

/** Placeholder rows while the first page of contacts loads. */
export function ContactListSkeleton({ rows = 6 }: { rows?: number }) {
  const theme = useTheme();
  const [opacity] = useState(() => new Animated.Value(0.5));

  useEffect(() => {
    const useNativeDriver = Platform.OS !== 'web';
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver }),
        Animated.timing(opacity, { toValue: 0.5, duration: 700, useNativeDriver }),
      ]),
    );
    pulse.start();
    return () => pulse.stop();
  }, [opacity]);

  const block = { backgroundColor: theme.surfaceAlt, borderRadius: Radius.sm };
  return (
    <Animated.View style={{ opacity }} accessibilityRole="progressbar" accessibilityLabel="Loading contacts">
      {Array.from({ length: rows }, (_, i) => {
        const last = i === rows - 1;
        return (
          <View
            key={i}
            style={[styles.row, { backgroundColor: theme.surface }, ...groupStyle(i === 0, last, theme.border)]}>
            <View style={[styles.skeletonAvatar, { backgroundColor: theme.surfaceAlt }]} />
            <View
              style={[
                styles.body,
                !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.border },
              ]}>
              <View style={[block, { height: 14, width: `${55 - (i % 3) * 10}%` }]} />
              <View style={[block, { height: 12, width: `${40 + (i % 2) * 15}%` }]} />
            </View>
          </View>
        );
      })}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingLeft: Spacing.four },
  first: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopLeftRadius: Radius.lg,
    borderTopRightRadius: Radius.lg,
  },
  last: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomLeftRadius: Radius.lg,
    borderBottomRightRadius: Radius.lg,
  },
  body: {
    flex: 1,
    minHeight: 72,
    justifyContent: 'center',
    gap: 3,
    paddingVertical: Spacing.three,
    paddingRight: Spacing.four,
  },
  titleLine: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  name: { flex: 1 },
  meta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: 3 },
  skeletonAvatar: { width: AVATAR, height: AVATAR, borderRadius: AVATAR / 2 },
});
