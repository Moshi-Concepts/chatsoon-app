import type { Contact, ProfileContact } from '@chatsoon/shared';
import { contactUrl, displayContact, displayLink, parseIntlPhone, toLinkUrl } from '@chatsoon/shared';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { useEffect, useState } from 'react';
import { Linking, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Icon, Text, type IconName } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { showAlert, showError } from '@/lib/dialogs';

export type Channel = {
  key: 'telegram' | 'email' | 'phone' | 'whatsapp' | 'signal' | 'linkedin' | 'x' | 'website';
  /** Quick action label, e.g. "Call". */
  action: string;
  /** Field label in the details list, e.g. "Phone". */
  label: string;
  icon: IconName;
  /** What the user sees, e.g. "@peter" or "linkedin.com/in/peter". */
  display: string;
  /** What gets copied. */
  copy: string;
  /** Null when the value can't be opened (e.g. a LinkedIn name instead of a profile link). */
  url: string | null;
};

type ChannelSpec = Pick<Channel, 'action' | 'label' | 'icon'> & {
  key: 'telegram' | 'email' | 'phone' | 'linkedin' | 'x' | 'website';
  field: 'telegram' | 'email' | 'phone' | 'linkedinUrl' | 'xHandle' | 'website';
};

/** Quick-action order for the fields that live on the contact record. */
const SPECS: ChannelSpec[] = [
  { key: 'telegram', field: 'telegram', action: 'Telegram', label: 'Telegram', icon: 'paper-plane' },
  { key: 'email', field: 'email', action: 'Email', label: 'Email', icon: 'mail' },
  { key: 'phone', field: 'phone', action: 'Call', label: 'Phone', icon: 'call' },
  { key: 'linkedin', field: 'linkedinUrl', action: 'LinkedIn', label: 'LinkedIn', icon: 'logo-linkedin' },
  { key: 'x', field: 'xHandle', action: 'X', label: 'X', icon: 'logo-x' },
  { key: 'website', field: 'website', action: 'Website', label: 'Website', icon: 'globe-outline' },
];

type LiveSpec = Pick<Channel, 'action' | 'label' | 'icon'> & { key: 'whatsapp' | 'signal' };

/** WhatsApp and Signal have no columns of their own on the contact record (D11: connecting only ever
 * copies the phone) — they're always read live from the linked profile, placed right after Call. */
const LIVE_SPECS: LiveSpec[] = [
  { key: 'whatsapp', action: 'WhatsApp', label: 'WhatsApp', icon: 'logo-whatsapp' },
  { key: 'signal', action: 'Signal', label: 'Signal', icon: 'chatbubble-ellipses' },
];

/**
 * Handles, email and phone always copy as typed; web links copy as the full URL. WhatsApp and Signal
 * copy as typed only when the saved value is a plain number: a link-only value (a wa.me/message link,
 * a Signal username link) isn't useful as text, so those copy the URL instead.
 */
function copyAsShown(key: Channel['key'], value: string): boolean {
  if (key === 'whatsapp' || key === 'signal') return parseIntlPhone(value) !== null;
  return key === 'telegram' || key === 'x' || key === 'email' || key === 'phone';
}

/**
 * Every contact detail the contact has, in quick-action order. Values that can't be turned into a
 * link are still listed (with `url: null`) so nothing the user saved disappears.
 *
 * `live` is the linked profile's own contact details (`linked ? linkedProfile.data?.contact :
 * undefined`). Phone falls back to it when the contact record has none set yet; WhatsApp and Signal
 * are never copied onto the contact record, so they come from `live` alone.
 */
export function contactChannels(contact: Contact, live?: ProfileContact): Channel[] {
  const channels: Channel[] = [];
  for (const { field, ...spec } of SPECS) {
    const raw = spec.key === 'phone' ? contact.phone || live?.phone : contact[field];
    const value = raw?.trim();
    if (value) {
      const url = toLinkUrl(spec.key, value);
      const display = displayLink(spec.key, value) ?? value;
      channels.push({ ...spec, display, copy: url && !copyAsShown(spec.key, value) ? url : display, url });
    }
    if (spec.key !== 'phone') continue;
    for (const liveSpec of LIVE_SPECS) {
      const lv = live?.[liveSpec.key]?.trim();
      if (!lv) continue;
      const lUrl = contactUrl(liveSpec.key, lv);
      if (!lUrl) continue;
      const lDisplay = displayContact(liveSpec.key, lv) ?? lv;
      channels.push({ ...liveSpec, display: lDisplay, copy: copyAsShown(liveSpec.key, lv) ? lDisplay : lUrl, url: lUrl });
    }
  }
  return channels;
}

/** Channels that open something, for the round quick-action buttons. */
function linkedChannels(channels: Channel[]): (Channel & { url: string })[] {
  return channels.filter((c): c is Channel & { url: string } => c.url !== null);
}

export async function openLink(url: string) {
  // On web, window.open on a mailto:/tel: link leaves an empty tab behind.
  if (Platform.OS === 'web' && /^(mailto|tel):/i.test(url)) {
    window.location.href = url;
    return;
  }
  try {
    await Linking.openURL(url);
  } catch {
    showAlert("Couldn't open the link", `Nothing on this device can open ${url}`);
  }
}

/** Row of round buttons, one per channel that opens something. Renders nothing when there are none. */
export function QuickActions({ channels }: { channels: Channel[] }) {
  const theme = useTheme();
  const actions = linkedChannels(channels);
  if (actions.length === 0) return null;
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.actionsScroll}
      contentContainerStyle={styles.actions}>
      {actions.map((c) => (
        <Pressable
          key={c.key}
          onPress={() => void openLink(c.url)}
          accessibilityRole="link"
          accessibilityLabel={`${c.action}: ${c.display}`}
          style={({ pressed }) => [styles.action, { opacity: pressed ? 0.7 : 1 }]}>
          <View style={[styles.actionCircle, { backgroundColor: theme.primarySoft }]}>
            <Icon name={c.icon} size={22} color="primary" />
          </View>
          <Text variant="small" color="textSecondary" numberOfLines={1}>
            {c.action}
          </Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

/** The contact's details as rows with a copy button each. Rows that make a link open it when tapped. */
export function ChannelList({ channels }: { channels: Channel[] }) {
  const theme = useTheme();
  const [copied, setCopied] = useState<Channel['key'] | null>(null);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(null), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  async function copy(c: Channel) {
    try {
      await Clipboard.setStringAsync(c.copy);
      if (Platform.OS !== 'web') void Haptics.selectionAsync();
      setCopied(c.key);
    } catch (err) {
      showError(err, "Couldn't copy");
    }
  }

  return (
    <View>
      {channels.map((c, i) => {
        const done = copied === c.key;
        const divider = i < channels.length - 1 && {
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: theme.border,
        };
        const body = (
          <>
            <View style={[styles.rowIcon, { backgroundColor: theme.surfaceAlt }]}>
              <Icon name={c.icon} size={18} color="textSecondary" />
            </View>
            <View style={styles.rowBody}>
              <Text variant="small" color="textTertiary">
                {c.label}
              </Text>
              <Text variant="body" color={c.url ? 'primary' : 'text'} numberOfLines={c.url ? 1 : 3} selectable={!c.url}>
                {c.display}
              </Text>
            </View>
            <Pressable
              onPress={() => void copy(c)}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel={done ? `${c.label} copied` : `Copy ${c.label.toLowerCase()}`}
              style={({ pressed }) => [styles.copy, { opacity: pressed ? 0.6 : 1 }]}>
              <Icon name={done ? 'checkmark' : 'copy-outline'} size={18} color={done ? 'success' : 'textTertiary'} />
            </Pressable>
          </>
        );
        const url = c.url;
        // A value that isn't a link (e.g. a LinkedIn name) is plain, selectable text.
        if (!url) {
          return (
            <View key={c.key} style={[styles.row, divider]}>
              {body}
            </View>
          );
        }
        return (
          <Pressable
            key={c.key}
            onPress={() => void openLink(url)}
            accessibilityRole="link"
            accessibilityLabel={`${c.label}: ${c.display}`}
            style={({ pressed }) => [
              styles.row,
              { backgroundColor: pressed ? theme.surfaceAlt : 'transparent' },
              divider,
            ]}>
            {body}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  actionsScroll: { flexGrow: 0 },
  actions: { flexGrow: 1, justifyContent: 'center', gap: Spacing.two },
  action: { width: 72, alignItems: 'center', gap: 6 },
  actionCircle: { width: 52, height: 52, borderRadius: Radius.pill, alignItems: 'center', justifyContent: 'center' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingLeft: Spacing.four,
    paddingRight: Spacing.two,
    paddingVertical: Spacing.three,
  },
  rowIcon: { width: 36, height: 36, borderRadius: Radius.sm, alignItems: 'center', justifyContent: 'center' },
  rowBody: { flex: 1, gap: 1 },
  copy: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
});
