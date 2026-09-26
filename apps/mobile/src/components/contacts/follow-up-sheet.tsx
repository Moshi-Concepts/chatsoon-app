import {
  composeFollowUpMessage,
  FOLLOW_UP_CHANNELS,
  followUpChannelAvailable,
  followUpFirstName,
  followUpMailtoUrl,
  followUpSignature,
  followUpSmsWebUrl,
  followUpTemplateBody,
  followUpWhatsAppUrl,
  toLinkUrl,
  type Contact,
  type FollowUpChannel,
} from '@chatsoon/shared';
import * as Clipboard from 'expo-clipboard';
import * as SMS from 'expo-sms';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Card, Icon, Text, TextField, type IconName } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { isNetworkError } from '@/lib/api';
import { openExternalUrl } from '@/lib/browser';
import { confirm, showError } from '@/lib/dialogs';
import { useFollowUp, useFollowUpDraft, useMe, useReferral } from '@/lib/queries';
import { getJson, setJson } from '@/lib/storage';

import { openLink } from './contact-channels';

// The draft sheet (issue #33): the body is filled with the fixed template the instant the sheet
// opens (buildDraftBody), so it's never empty, then PR B's AI draft (useFollowUpDraft) replaces it
// once it arrives - unless the person already started editing. The signature and its composition
// (composeFollowUpMessage) are the same for either body.

export type FollowUpPrevious = {
  followedUpAt: string | null;
  followUpChannel: FollowUpChannel | null;
  followUpDueAt: string | null;
};

export type FollowUpSheetProps = {
  visible: boolean;
  onClose: () => void;
  contact: Contact;
  /** The event this contact was met at, if any - filled into the template body. */
  eventName?: string | null;
  /** Called right after the contact is marked followed up, with the values an Undo should restore. */
  onFollowedUp: (previous: FollowUpPrevious) => void;
};

type ChannelSpec = { channel: FollowUpChannel; label: string; icon: IconName };

const CHANNEL_SPECS: ChannelSpec[] = [
  { channel: 'whatsapp', label: 'WhatsApp', icon: 'logo-whatsapp' },
  { channel: 'sms', label: 'Text message', icon: 'chatbubble-outline' },
  { channel: 'email', label: 'Email', icon: 'mail-outline' },
  { channel: 'telegram', label: 'Telegram', icon: 'paper-plane-outline' },
  { channel: 'linkedin', label: 'LinkedIn', icon: 'logo-linkedin' },
  { channel: 'x', label: 'X', icon: 'logo-x' },
  { channel: 'copy', label: 'Copy message', icon: 'copy-outline' },
];

const firstName = followUpFirstName;

/**
 * Card scanning's one-time AI consent (apps/mobile/src/app/(app)/card.tsx's CARD_AI_CONSENT_KEY),
 * mirrored here for the AI follow-up draft (issue #33 PR B): App Store 5.1.2(i) needs a clear
 * disclosure and an explicit yes before the first one. Stored per account on this device.
 */
const FOLLOWUP_AI_CONSENT_KEY = 'chatsoon.followUpAiConsent';

/** The instant fill so the sheet is never empty; useFollowUpDraft below replaces it with the AI
 * draft once it arrives, unless the person already started editing. */
function buildDraftBody(contact: Contact, eventName: string | null | undefined): string {
  return followUpTemplateBody(firstName(contact.name), eventName);
}

/** The chat/profile link to open after copying, for a channel with no prefill support. */
function profileUrl(channel: 'telegram' | 'linkedin' | 'x', contact: Contact): string | null {
  if (channel === 'telegram') return toLinkUrl('telegram', contact.telegram);
  if (channel === 'linkedin') return toLinkUrl('linkedin', contact.linkedinUrl);
  return toLinkUrl('x', contact.xHandle);
}

export function FollowUpSheet(props: FollowUpSheetProps) {
  return (
    <Modal visible={props.visible} transparent animationType="fade" onRequestClose={props.onClose} statusBarTranslucent>
      {/* Content unmounts when the modal hides, so each opening starts with a fresh draft. */}
      <FollowUpSheetBody {...props} />
    </Modal>
  );
}

function FollowUpSheetBody({ onClose, contact, eventName, onFollowedUp }: FollowUpSheetProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const asSheet = width < 600;
  const me = useMe();
  const referral = useReferral();
  const followUp = useFollowUp(contact.id);
  const aiDraft = useFollowUpDraft(contact.id);

  const initialText = useMemo(() => {
    const displayName = me.data?.profile?.displayName || '';
    const referralLink = referral.data?.link || 'https://chatsoon.app';
    return composeFollowUpMessage(buildDraftBody(contact, eventName), followUpSignature(displayName, referralLink));
    // Only the first render's values matter: the text is then the user's to edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [text, setText] = useState(initialText);
  const [busy, setBusy] = useState<FollowUpChannel | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Issue #33 PR B: the AI draft, gated by a one-time-per-account consent (mirrors card.tsx's
  // CARD_AI_CONSENT_KEY). `source` reflects what's actually in `text` right now, not just what the
  // last request returned - see requestAiDraft, which skips replacing `text` once the person has
  // started editing it themselves.
  const userId = me.data?.user.id;
  const consentKey = `${FOLLOWUP_AI_CONSENT_KEY}.${userId ?? 'unknown'}`;
  // null while the saved answer is still loading.
  const [consent, setConsent] = useState<boolean | null>(null);
  const [consentDismissed, setConsentDismissed] = useState(false);
  const [source, setSource] = useState<'template' | 'ai'>('template');
  const edited = useRef(false);
  const requestedOnOpen = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void getJson<boolean>(consentKey, false).then((saved) => {
      if (!cancelled) setConsent(saved === true);
    });
    return () => {
      cancelled = true;
    };
  }, [consentKey]);

  async function requestAiDraft() {
    try {
      const result = await aiDraft.mutateAsync();
      // The person started typing while this was in flight: their text wins, never overwritten.
      if (edited.current) return;
      const displayName = me.data?.profile?.displayName || '';
      const referralLink = referral.data?.link || 'https://chatsoon.app';
      setText(composeFollowUpMessage(result.body, followUpSignature(displayName, referralLink)));
      setSource(result.source);
    } catch {
      // Network or server hiccup: the template already filled in keeps working. Never shown as an
      // error - Regenerate tries again if the person wants to.
    }
  }

  // Requests the first AI draft as soon as consent is in place, once per time the sheet is open.
  useEffect(() => {
    if (consent !== true || requestedOnOpen.current) return;
    requestedOnOpen.current = true;
    void requestAiDraft();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [consent]);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2500);
    return () => clearTimeout(timer);
  }, [copied]);

  async function allowAiDrafts() {
    // If storage fails, still go ahead this time; we'll just ask again next time.
    await setJson(consentKey, true).catch(() => undefined);
    setConsent(true);
  }

  /** The Regenerate button: asks for consent first if it hasn't been given, and confirms before
   * discarding an edit the person already made. */
  async function regenerate() {
    if (busy || aiDraft.isPending) return;
    if (consent !== true) {
      setConsentDismissed(false);
      return;
    }
    if (edited.current) {
      const ok = await confirm({
        title: 'Replace your message?',
        message: 'This will overwrite your changes with a new AI draft.',
        confirmText: 'Replace',
      });
      if (!ok) return;
    }
    edited.current = false;
    await requestAiDraft();
  }

  /** The only path that marks the text as user-edited: programmatic updates (the AI draft arriving,
   * Regenerate) call setText directly instead, so they're never mistaken for an edit. */
  function onChangeText(value: string) {
    edited.current = true;
    setText(value);
  }

  const channels = CHANNEL_SPECS.filter((spec) => followUpChannelAvailable(spec.channel, contact));

  /** Performs the channel's own action (opening an app, the SMS composer, or the clipboard). Returns
   * false when there's nothing to do (shouldn't happen: unavailable channels aren't shown) or the
   * action itself failed, in which case the contact is not marked followed up. */
  async function act(channel: FollowUpChannel): Promise<boolean> {
    switch (channel) {
      case 'whatsapp': {
        const url = followUpWhatsAppUrl(contact.phone, text);
        if (!url) return false;
        await openLink(url);
        return true;
      }
      case 'sms': {
        if (Platform.OS !== 'web' && (await SMS.isAvailableAsync())) {
          await SMS.sendSMSAsync([contact.phone!], text);
          return true;
        }
        const url = followUpSmsWebUrl(contact.phone, text);
        if (!url) return false;
        await openLink(url);
        return true;
      }
      case 'email': {
        const url = followUpMailtoUrl(contact.email, text);
        if (!url) return false;
        await openLink(url);
        return true;
      }
      case 'telegram':
      case 'linkedin':
      case 'x': {
        await Clipboard.setStringAsync(text);
        setCopied(true);
        const url = profileUrl(channel, contact);
        if (url) await openExternalUrl(url, theme);
        return true;
      }
      case 'copy': {
        await Clipboard.setStringAsync(text);
        setCopied(true);
        return true;
      }
      default:
        return false;
    }
  }

  async function tap(channel: FollowUpChannel) {
    if (busy) return;
    setBusy(channel);
    setError(null);
    let ok: boolean;
    try {
      ok = await act(channel);
    } catch (err) {
      setBusy(null);
      showError(err, "Couldn't do that");
      return;
    }
    if (!ok) {
      setBusy(null);
      return;
    }

    // Tapping the channel is what marks it followed up (issue #33), whatever the person does next in
    // the app or browser we just opened - there's no reliable way to tell whether they actually sent it.
    const previous: {
      followedUpAt: string | null;
      followUpChannel: typeof contact.followUpChannel;
      followUpDueAt: string | null;
    } = {
      followedUpAt: contact.followedUpAt,
      followUpChannel: contact.followUpChannel,
      followUpDueAt: contact.followUpDueAt,
    };
    try {
      await followUp.mutateAsync({ channel });
      setBusy(null);
      onFollowedUp(previous);
      onClose();
    } catch (err) {
      setBusy(null);
      setError(
        isNetworkError(err)
          ? "You're offline. Connect to the internet, then try again to mark this as followed up."
          : err instanceof Error
            ? err.message
            : "Couldn't mark this as followed up.",
      );
    }
  }

  return (
    <KeyboardAvoidingView
      style={[styles.backdrop, asSheet ? styles.backdropSheet : styles.backdropCentred]}
      behavior={Platform.OS === 'web' ? undefined : 'padding'}>
      <Pressable
        style={[StyleSheet.absoluteFill, { backgroundColor: theme.overlay }]}
        onPress={busy ? undefined : onClose}
        accessibilityRole="button"
        accessibilityLabel="Close"
      />
      <View
        role="dialog"
        aria-modal
        accessibilityLabel={`Follow up with ${contact.name}`}
        style={[
          styles.panel,
          asSheet ? styles.panelSheet : styles.panelCentred,
          {
            backgroundColor: theme.surface,
            borderColor: theme.border,
            paddingBottom: (asSheet ? insets.bottom : 0) + Spacing.five,
          },
        ]}>
        <View style={styles.header}>
          <Text variant="heading" style={styles.flex} numberOfLines={2}>
            Follow up with {firstName(contact.name)}
          </Text>
          <Pressable
            onPress={busy ? undefined : onClose}
            disabled={!!busy}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Close"
            style={({ pressed }) => [styles.close, { backgroundColor: theme.surfaceAlt, opacity: pressed ? 0.7 : 1 }]}>
            <Icon name="close" size={18} color="textSecondary" />
          </Pressable>
        </View>

        <ScrollView style={styles.scroll} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled" bounces={false}>
          <TextField
            label="Message"
            value={text}
            onChangeText={onChangeText}
            multiline
            maxLength={2000}
            editable={!busy}
            accessibilityLabel="Follow-up message"
            style={styles.input}
          />

          {consent === false && !consentDismissed ? (
            <FollowUpAiConsent onAllow={() => void allowAiDrafts()} onNotNow={() => setConsentDismissed(true)} />
          ) : consent !== null ? (
            <View style={styles.draftRow}>
              <View style={styles.flex}>
                {aiDraft.isPending ? (
                  <View style={styles.draftStatus}>
                    <ActivityIndicator size="small" color={theme.textSecondary} />
                    <Text variant="caption" color="textSecondary">
                      Writing a draft…
                    </Text>
                  </View>
                ) : source === 'ai' ? (
                  <Text variant="caption" color="textSecondary">
                    Drafted with AI from your notes. Check it before sending.
                  </Text>
                ) : null}
              </View>
              <Pressable
                onPress={() => void regenerate()}
                disabled={!!busy || aiDraft.isPending}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Regenerate with AI">
                <View style={[styles.regenerate, { opacity: busy || aiDraft.isPending ? 0.5 : 1 }]}>
                  <Icon name="refresh-outline" size={16} color="primary" />
                  <Text variant="captionStrong" color="primary">
                    Regenerate
                  </Text>
                </View>
              </Pressable>
            </View>
          ) : null}

          {copied ? (
            <View style={[styles.notice, { backgroundColor: theme.primarySoft }]} accessibilityRole="alert">
              <Icon name="checkmark-circle" size={18} color="primary" />
              <Text variant="caption" color="primary" style={styles.flex}>
                Message copied, paste it in the chat
              </Text>
            </View>
          ) : null}

          {error ? (
            <View style={[styles.notice, { backgroundColor: theme.dangerSoft }]} accessibilityRole="alert">
              <Icon name="alert-circle-outline" size={18} color="danger" />
              <Text variant="caption" color="danger" style={styles.flex}>
                {error}
              </Text>
            </View>
          ) : null}

          <View style={[styles.channels, { borderColor: theme.border }]}>
            {channels.map((spec, i) => {
              const loading = busy === spec.channel;
              return (
                <Pressable
                  key={spec.channel}
                  onPress={() => void tap(spec.channel)}
                  disabled={!!busy}
                  accessibilityRole="button"
                  accessibilityLabel={`Follow up via ${spec.label}`}
                  accessibilityState={{ disabled: !!busy, busy: loading }}
                  style={({ pressed }) => [
                    styles.channelRow,
                    i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border },
                    { backgroundColor: pressed && !busy ? theme.surfaceAlt : 'transparent', opacity: busy && !loading ? 0.5 : 1 },
                  ]}>
                  <View style={[styles.channelIcon, { backgroundColor: theme.surfaceAlt }]}>
                    <Icon name={spec.icon} size={18} color="text" />
                  </View>
                  <Text variant="body" style={styles.flex}>
                    {spec.label}
                  </Text>
                  {loading ? <ActivityIndicator color={theme.primary} /> : <Icon name="chevron-forward" size={18} color="textTertiary" />}
                </Pressable>
              );
            })}
          </View>

          <Button title="Cancel" variant="ghost" onPress={onClose} disabled={!!busy} />
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
}

/**
 * One-time-per-account consent before the first AI draft (issue #33 PR B), mirroring card.tsx's
 * AiDisclosure: same claim about Anthropic and training. "Not now" only dismisses this panel for the
 * rest of this sheet opening - nothing is stored, so it asks again next time.
 */
function FollowUpAiConsent({ onAllow, onNotNow }: { onAllow: () => void; onNotNow: () => void }) {
  const theme = useTheme();
  return (
    <Card style={styles.consent}>
      <View style={styles.consentHead}>
        <View style={[styles.consentIcon, { backgroundColor: theme.primarySoft }]}>
          <Icon name="sparkles-outline" size={18} color="primary" />
        </View>
        <Text variant="bodyStrong" style={styles.flex} accessibilityRole="header">
          Write a first draft with AI?
        </Text>
      </View>
      <Text variant="callout" color="textSecondary">
        Chatsoon can write a first draft for you. To do that, this contact&apos;s details and your notes are sent
        to Anthropic&apos;s Claude AI. They don&apos;t use it to train their models.
      </Text>
      <View style={styles.consentActions}>
        <Button title="Allow AI drafts" icon="checkmark" onPress={onAllow} />
        <Button title="Not now" variant="secondary" onPress={onNotNow} />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  backdrop: { flex: 1 },
  backdropSheet: { justifyContent: 'flex-end' },
  backdropCentred: { justifyContent: 'center', alignItems: 'center', padding: Spacing.five },
  panel: {
    borderWidth: StyleSheet.hairlineWidth,
    paddingTop: Spacing.five,
    paddingHorizontal: Spacing.five,
    gap: Spacing.four,
    maxHeight: '92%',
  },
  panelSheet: { borderTopLeftRadius: Radius.xl, borderTopRightRadius: Radius.xl },
  panelCentred: { width: '100%', maxWidth: 460, borderRadius: Radius.xl },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  close: { width: 32, height: 32, borderRadius: Radius.pill, alignItems: 'center', justifyContent: 'center' },
  scroll: { flexGrow: 0 },
  body: { gap: Spacing.four },
  input: { minHeight: 140 },
  consent: { gap: Spacing.three },
  consentHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  consentIcon: { width: 36, height: 36, borderRadius: Radius.sm, alignItems: 'center', justifyContent: 'center' },
  consentActions: { gap: Spacing.three },
  draftRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, minHeight: 20 },
  draftStatus: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  regenerate: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  notice: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, padding: Spacing.three, borderRadius: Radius.md },
  channels: { borderWidth: StyleSheet.hairlineWidth, borderRadius: Radius.md, overflow: 'hidden' },
  channelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
    minHeight: 56,
  },
  channelIcon: { width: 36, height: 36, borderRadius: Radius.sm, alignItems: 'center', justifyContent: 'center' },
});
