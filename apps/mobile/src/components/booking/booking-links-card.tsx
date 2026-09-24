import { bookingEmbedUrl, bookingOpenUrl, bookingProviderName, type BookingLink } from '@chatsoon/shared';
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { Card, Icon, Text, type IconName } from '@/components/ui';
import { externalLinkProps } from '@/components/web/link-props';
import { firstName } from '@/components/web/profile-card';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { BookingSheet } from './booking-sheet';

/** Domain sent to providers that need one (Calendly's embed_domain). The page's own host on web. */
export function embedDomain(): string {
  return Platform.OS === 'web' && typeof window !== 'undefined' ? window.location.host : 'chatsoon.app';
}

function providerIcon(link: BookingLink): IconName {
  if (link.provider === 'google') return 'logo-google';
  if (link.provider === 'microsoft') return 'logo-microsoft';
  return 'calendar-outline';
}

/**
 * "Book a meeting" card: one row per booking link. Renders nothing when there are none, including
 * for a profile cached before bookingLinks existed (undefined).
 */
export function BookingLinksCard({ links, ownerName }: { links: BookingLink[] | undefined; ownerName: string }) {
  const [open, setOpen] = useState<BookingLink | null>(null);
  if (!links?.length) return null;

  return (
    <Card padded={false}>
      <View style={styles.header}>
        <Text variant="subheading">Book a meeting</Text>
        <Text variant="caption" color="textSecondary">
          Pick a time with {firstName(ownerName)}
        </Text>
      </View>
      {links.map((link, i) => (
        <BookingRow
          key={`${link.provider}-${link.url}`}
          link={link}
          divider={i < links.length - 1}
          onOpen={() => setOpen(link)}
        />
      ))}
      <BookingSheet link={open} ownerName={ownerName} onClose={() => setOpen(null)} />
    </Card>
  );
}

function BookingRow({ link, divider, onOpen }: { link: BookingLink; divider: boolean; onOpen: () => void }) {
  const theme = useTheme();
  const providerName = bookingProviderName(link.provider);
  // Web, non-embeddable: a plain external link (new tab). Everything else opens the sheet.
  const embeddable = Platform.OS !== 'web' || bookingEmbedUrl(link, embedDomain()) !== null;
  const rowProps = embeddable
    ? { onPress: onOpen, accessibilityRole: 'button' as const }
    : externalLinkProps(bookingOpenUrl(link), { newTab: true });
  const label = embeddable ? `${link.label}, ${providerName}` : `${link.label}, ${providerName} (opens in a new tab)`;

  return (
    <Pressable
      {...rowProps}
      accessibilityLabel={label}
      style={({ pressed, hovered }) => [
        styles.row,
        divider && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.border },
        { backgroundColor: pressed || hovered ? theme.surfaceAlt : 'transparent' },
      ]}>
      <Icon name={providerIcon(link)} size={20} color="textSecondary" />
      <View style={styles.rowBody}>
        <Text variant="body" numberOfLines={1}>
          {link.label}
        </Text>
        <Text variant="caption" color="textSecondary" numberOfLines={1}>
          {providerName}
        </Text>
      </View>
      <Icon name="chevron-forward" size={18} color="textTertiary" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: { gap: 2, paddingHorizontal: Spacing.four, paddingTop: Spacing.four, paddingBottom: Spacing.three },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.four,
    paddingVertical: 14,
    minHeight: 52,
  },
  rowBody: { flex: 1, gap: 2 },
});
