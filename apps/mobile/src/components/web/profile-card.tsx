import { toLinkUrl, type LinkKey, type PublicProfile } from '@chatsoon/shared';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { Avatar, Button, Card, Icon, Text, type IconName } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { api } from '@/lib/api';
import { roleLine } from '@/lib/format';

import { externalLinkProps } from './link-props';

const LINKS: { key: LinkKey; label: string; icon: IconName }[] = [
  { key: 'linkedin', label: 'LinkedIn', icon: 'logo-linkedin' },
  { key: 'x', label: 'X', icon: 'logo-x' },
  { key: 'telegram', label: 'Telegram', icon: 'paper-plane-outline' },
  { key: 'youtube', label: 'YouTube', icon: 'logo-youtube' },
  { key: 'website', label: 'Website', icon: 'globe-outline' },
];

/** "https://www.peterbui.com/about" -> "peterbui.com" */
function hostLabel(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, '') || null;
  } catch {
    return null;
  }
}

/** First word of a display name, for "Connect with Alex". */
export function firstName(displayName: string): string {
  return displayName.trim().split(/\s+/)[0] || displayName;
}

/** Public profile card: photo, name, headline, role, links and a vCard download. */
export function ProfileCard({ profile }: { profile: PublicProfile }) {
  const role = roleLine(profile.role, profile.company);
  const links = LINKS.flatMap((l) => {
    const url = toLinkUrl(l.key, profile.links[l.key]);
    if (!url) return [];
    const label = l.key === 'website' ? (hostLabel(url) ?? l.label) : l.label;
    return [{ ...l, url, label }];
  });

  return (
    <Card style={styles.card}>
      <Avatar name={profile.displayName} uri={profile.avatarUrl} size={104} />
      <View style={styles.names}>
        <Text variant="title" align="center" role="heading">
          {profile.displayName}
        </Text>
        {profile.headline ? (
          <Text variant="body" color="textSecondary" align="center">
            {profile.headline}
          </Text>
        ) : null}
        {role ? (
          <View style={styles.roleRow}>
            <Icon name="briefcase-outline" size={15} color="textTertiary" />
            <Text variant="callout" color="textSecondary" align="center">
              {role}
            </Text>
          </View>
        ) : null}
      </View>

      {links.length ? (
        <View style={styles.links}>
          {links.map((l) => (
            <LinkPill key={l.key} icon={l.icon} label={l.label} url={l.url} />
          ))}
        </View>
      ) : null}

      <Button
        title="Save contact"
        icon="download-outline"
        variant="secondary"
        accessibilityHint="Downloads a contact card you can add to your phone's contacts"
        {...externalLinkProps(api.profiles.vcardUrl(profile.slug))}
      />
    </Card>
  );
}

function LinkPill({ icon, label, url }: { icon: IconName; label: string; url: string }) {
  const theme = useTheme();
  return (
    <Pressable
      {...externalLinkProps(url, { newTab: true })}
      accessibilityLabel={Platform.OS === 'web' ? `${label} (opens in a new tab)` : label}
      style={({ pressed, hovered }) => [
        styles.pill,
        {
          backgroundColor: hovered || pressed ? theme.primarySoft : theme.surfaceAlt,
          opacity: pressed ? 0.85 : 1,
        },
      ]}>
      <Icon name={icon} size={16} color="primary" />
      <Text variant="captionStrong" numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { alignItems: 'center', gap: Spacing.four, paddingVertical: Spacing.six, paddingHorizontal: Spacing.five },
  names: { alignItems: 'center', gap: Spacing.one, alignSelf: 'stretch' },
  roleRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: Spacing.one, flexWrap: 'wrap', justifyContent: 'center' },
  links: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: Spacing.two },
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
