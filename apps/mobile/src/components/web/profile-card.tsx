import { BADGE_LABELS, discordDisplay, toLinkUrl, type Badge, type LinkKey, type PublicProfile } from '@chatsoon/shared';
import * as Clipboard from 'expo-clipboard';
import { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { Avatar, Button, Card, Icon, Text, type IconName } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { api } from '@/lib/api';
import { roleLine } from '@/lib/format';

import { ContactPills } from './contact-pills';
import { externalLinkProps } from './link-props';

const LINKS: { key: LinkKey; label: string; icon: IconName }[] = [
  { key: 'linkedin', label: 'LinkedIn', icon: 'logo-linkedin' },
  { key: 'x', label: 'X', icon: 'logo-x' },
  { key: 'telegram', label: 'Telegram', icon: 'paper-plane-outline' },
  { key: 'discord', label: 'Discord', icon: 'logo-discord' },
  { key: 'youtube', label: 'YouTube', icon: 'logo-youtube' },
  { key: 'website', label: 'Website', icon: 'globe-outline' },
];

/** One link pill: a normal external link, or (Discord only, issue #21) a value with nothing to link to
 * that copies to the clipboard instead - a username or legacy discriminator has no profile URL at all. */
type LinkPillData =
  | { kind: 'link'; key: LinkKey; icon: IconName; label: string; url: string }
  | { kind: 'copy'; key: LinkKey; icon: IconName; value: string };

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

/** Visible vs. accessible label for a badge (issue #11, docs/referrals.md "Referral hub"): "Founding
 * member #37" is shown, "Founding member number 37" is what VoiceOver/TalkBack read instead, so "#"
 * never gets sounded out as "hash" or "pound". Matches apps/web/src/render/profile.ts's badgePillBlock. */
function badgeLabels(badge: { badge: Badge; seq?: number }): { visible: string; accessible: string } {
  const base = BADGE_LABELS[badge.badge];
  const founder = badge.badge === 'founder';
  return {
    visible: founder && badge.seq ? `${base} #${badge.seq}` : base,
    accessible: founder && badge.seq ? `${base} number ${badge.seq}` : base,
  };
}

/** The founder/early-adopter pill next to the display name (docs/profile-page-dom.md's web contract
 * gets the matching markup in the same PR). Founder uses the brand primary colour (the design system
 * has no magenta, per apps/web's css.ts); early adopter is the quieter neutral pairing. `accessible`
 * replaces the whole node's accessible name (icon included) so "#37" isn't read literally. */
function BadgePill({ badge }: { badge: { badge: Badge; seq?: number } }) {
  const theme = useTheme();
  const { visible, accessible } = badgeLabels(badge);
  const founder = badge.badge === 'founder';
  return (
    <View
      accessible
      accessibilityRole="text"
      accessibilityLabel={accessible}
      style={[styles.badgePill, { backgroundColor: founder ? theme.primarySoft : theme.surfaceAlt }]}>
      <Icon name="ribbon-outline" size={14} color={founder ? 'primaryText' : 'textSecondary'} />
      <Text variant="captionStrong" color={founder ? 'primaryText' : 'textSecondary'} numberOfLines={1}>
        {visible}
      </Text>
    </View>
  );
}

/** Every link pill to show, in LINKS order. Discord renders a copy pill when it's a username or
 * legacy discriminator (no URL exists for those), and a normal link pill for a numeric id. */
function profileLinkPills(profile: PublicProfile): LinkPillData[] {
  return LINKS.flatMap((l): LinkPillData[] => {
    if (l.key === 'discord') {
      const url = toLinkUrl('discord', profile.links.discord);
      if (url) return [{ kind: 'link', key: l.key, icon: l.icon, label: l.label, url }];
      const username = discordDisplay(profile.links.discord);
      return username && username !== 'Discord profile' ? [{ kind: 'copy', key: l.key, icon: l.icon, value: username }] : [];
    }
    const url = toLinkUrl(l.key, profile.links[l.key]);
    if (!url) return [];
    const label = l.key === 'website' ? (hostLabel(url) ?? l.label) : l.label;
    return [{ kind: 'link', key: l.key, icon: l.icon, label, url }];
  });
}

/** Public profile card: photo, name, headline, role, links and a vCard download. */
export function ProfileCard({ profile }: { profile: PublicProfile }) {
  const role = roleLine(profile.role, profile.company);
  const links = profileLinkPills(profile);

  return (
    <Card style={styles.card}>
      <Avatar name={profile.displayName} uri={profile.avatarUrl} size={208} />
      <View style={styles.names}>
        <View style={styles.nameRow}>
          <Text variant="title" align="center" role="heading">
            {profile.displayName}
          </Text>
          {profile.badges.length ? <BadgePill badge={profile.badges[0]!} /> : null}
        </View>
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

      {(profile.contactChannels ?? []).length && !profile.blockedByMe ? (
        <ContactPills
          contact={profile.contact}
          channels={profile.contactChannels ?? []}
          firstName={firstName(profile.displayName)}
        />
      ) : null}

      {links.length ? (
        <View style={styles.links}>
          {links.map((l) =>
            l.kind === 'link' ? (
              <LinkPill key={l.key} icon={l.icon} label={l.label} url={l.url} />
            ) : (
              <CopyPill key={l.key} icon={l.icon} value={l.value} />
            ),
          )}
        </View>
      ) : null}

      <Button
        title="Save contact"
        icon="download-outline"
        variant="secondary"
        accessibilityHint="Downloads a contact card you can add to your phone's contacts"
        {...externalLinkProps(profile.vcardUrl ?? api.profiles.vcardUrl(profile.slug))}
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

/** Discord username pill (issue #21): copies `value` to the clipboard on tap, with brief "Copied"
 * feedback, since a username has nothing to link to. */
function CopyPill({ icon, value }: { icon: IconName; value: string }) {
  const theme = useTheme();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  const copy = async () => {
    try {
      await Clipboard.setStringAsync(value);
      setCopied(true);
    } catch {
      // Nothing actionable a visitor can do about a failed copy - swallowed like the web island's.
    }
  };

  return (
    <Pressable
      onPress={() => void copy()}
      accessibilityRole="button"
      accessibilityLabel={copied ? `Discord username ${value} copied` : `Copy Discord username ${value}`}
      style={({ pressed, hovered }) => [
        styles.pill,
        {
          backgroundColor: hovered || pressed ? theme.primarySoft : theme.surfaceAlt,
          opacity: pressed ? 0.85 : 1,
        },
      ]}>
      <Icon name={copied ? 'checkmark' : icon} size={16} color="primary" />
      <Text variant="captionStrong" numberOfLines={1}>
        {copied ? 'Copied' : value}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { alignItems: 'center', gap: Spacing.four, paddingVertical: Spacing.six, paddingHorizontal: Spacing.five },
  names: { alignItems: 'center', gap: Spacing.one, alignSelf: 'stretch' },
  nameRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.two, flexWrap: 'wrap' },
  badgePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    height: 24,
    paddingHorizontal: Spacing.two,
    borderRadius: Radius.pill,
  },
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
