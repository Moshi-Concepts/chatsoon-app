import { CONTACT_LABELS, contactUrl, displayContact, type ProfileContact, type ProfileContactKey } from '@chatsoon/shared';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { Icon, Text, type IconName } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { externalLinkProps } from './link-props';

const CHANNEL_ICON: Record<ProfileContactKey, IconName> = {
  phone: 'call-outline',
  whatsapp: 'logo-whatsapp',
  signal: 'chatbubble-ellipses-outline',
};

/** Screen-reader action word, e.g. "Call +61 491 570 156" rather than "Mobile +61 491 570 156". */
const CHANNEL_ACTION: Record<ProfileContactKey, string> = {
  phone: 'Call',
  whatsapp: 'WhatsApp',
  signal: 'Signal',
};

/**
 * Contact row above the link pills: phone, WhatsApp and Signal, in that order. Renders nothing when
 * `channels` is empty. Unlocked (`contact` present) shows tappable pills: Call opens `tel:` in the
 * same tab, WhatsApp and Signal open a new tab. Locked (channels listed but no `contact`) shows
 * dimmed, non-link chips with a caption inviting the visitor to connect first.
 */
export function ContactPills({
  contact,
  channels,
  firstName,
}: {
  contact: ProfileContact | undefined;
  channels: ProfileContactKey[];
  firstName: string;
}) {
  if (!channels.length) return null;

  if (!contact) {
    return (
      <View style={styles.wrap}>
        <View style={styles.row}>
          {channels.map((key) => (
            <LockedPill key={key} contactKey={key} />
          ))}
        </View>
        <Text variant="caption" color="textSecondary" align="center">
          Connect with {firstName} to get their number.
        </Text>
      </View>
    );
  }

  // Re-derive from contactUrl rather than trusting `channels` as-is: the owner's own view carries
  // raw values (including legacy invalid ones, D1), and those must not render as a pill.
  const pills = channels.flatMap((key) => {
    const url = contactUrl(key, contact[key]);
    const label = displayContact(key, contact[key]);
    return url && label ? [{ key, url, label }] : [];
  });
  if (!pills.length) return null;

  return (
    <View style={styles.row}>
      {pills.map((p) => (
        <UnlockedPill key={p.key} contactKey={p.key} url={p.url} label={p.label} />
      ))}
    </View>
  );
}

function UnlockedPill({ contactKey, url, label }: { contactKey: ProfileContactKey; url: string; label: string }) {
  const theme = useTheme();
  const newTab = !url.startsWith('tel:');
  const action = CHANNEL_ACTION[contactKey];
  const accessibilityLabel =
    contactKey === 'phone'
      ? `Call ${label}`
      : Platform.OS === 'web'
        ? `${action}: ${label} (opens in a new tab)`
        : `${action}: ${label}`;

  return (
    <Pressable
      {...externalLinkProps(url, { newTab })}
      accessibilityLabel={accessibilityLabel}
      style={({ pressed, hovered }) => [
        styles.pill,
        {
          backgroundColor: hovered || pressed ? theme.primarySoft : theme.surfaceAlt,
          opacity: pressed ? 0.85 : 1,
        },
      ]}>
      <Icon name={CHANNEL_ICON[contactKey]} size={16} color="primary" />
      <Text variant="captionStrong" numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

function LockedPill({ contactKey }: { contactKey: ProfileContactKey }) {
  const theme = useTheme();
  return (
    <View
      // The lock icon and tertiary text mark it as locked. No opacity: faded text fails contrast checks.
      style={[styles.pill, { backgroundColor: theme.surfaceAlt }]}
      accessibilityLabel={`${CONTACT_LABELS[contactKey]}, hidden until you connect`}>
      <Icon name="lock-closed-outline" size={16} color="textTertiary" />
      <Text variant="captionStrong" color="textTertiary" numberOfLines={1}>
        {CONTACT_LABELS[contactKey]}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.two, alignSelf: 'stretch' },
  row: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: Spacing.two },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 36,
    paddingHorizontal: Spacing.three,
    borderRadius: Radius.pill,
    maxWidth: 220,
  },
});
