import { emailSchema, inviteMessage, type Contact } from '@chatsoon/shared';
import * as SMS from 'expo-sms';
import { router, Stack } from 'expo-router';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, View } from 'react-native';

import { Pill } from '@/components/contacts/pill';
import { firstName } from '@/components/web/profile-card';
import { Avatar, Button, Card, Checkbox, EmptyState, Icon, Screen, Text, TextField } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { ApiError } from '@/lib/api';
import { showAlert, showError } from '@/lib/dialogs';
import { useContacts, useReferral, useSendInvites } from '@/lib/queries';

// The invite picker (issue #11, docs/referrals.md "Invite contacts"). Groups the user's own Chatsoon
// contacts (not the phone's address book) into three buckets. "Invited"/"Texted" are session-only:
// the API reports counts, not which addresses were reached, so there's nothing to persist.

const isWeb = Platform.OS === 'web';

type Group = 'canInvite' | 'onChatsoon' | 'needsDetails';

function groupOf(contact: Contact): Group {
  if (contact.linkedUserId) return 'onChatsoon';
  if (contact.email || contact.phone) return 'canInvite';
  return 'needsDetails';
}

export default function InvitePickerScreen() {
  const theme = useTheme();
  const referral = useReferral();
  const contacts = useContacts();
  const sendInvites = useSendInvites();
  const [smsAvailable, setSmsAvailable] = useState(false);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [typedEmails, setTypedEmails] = useState<string[]>([]);
  const [emailField, setEmailField] = useState('');
  const [emailError, setEmailError] = useState<string | null>(null);
  const [invitedEmails, setInvitedEmails] = useState<Set<string>>(new Set());
  const [textedIds, setTextedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (isWeb) return;
    SMS.isAvailableAsync()
      .then(setSmsAvailable)
      .catch(() => setSmsAvailable(false));
  }, []);

  const groups = useMemo(() => {
    const all = contacts.data ?? [];
    const canInvite: Contact[] = [];
    const onChatsoon: Contact[] = [];
    const needsDetails: Contact[] = [];
    for (const c of all) {
      const g = groupOf(c);
      if (g === 'canInvite') canInvite.push(c);
      else if (g === 'onChatsoon') onChatsoon.push(c);
      else needsDetails.push(c);
    }
    return { canInvite, onChatsoon, needsDetails };
  }, [contacts.data]);

  // Only contacts with an email (and not already invited this session) can be selected for the batch.
  const selectable = useMemo(
    () => groups.canInvite.filter((c) => c.email && !invitedEmails.has(c.email.toLowerCase())),
    [groups.canInvite, invitedEmails],
  );
  const allSelected = selectable.length > 0 && selectable.every((c) => selected.has(c.id));

  const toggleSelectAll = () => {
    setSelected(allSelected ? new Set() : new Set(selectable.map((c) => c.id)));
  };

  const toggleContact = (contact: Contact) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(contact.id)) next.delete(contact.id);
      else next.add(contact.id);
      return next;
    });
  };

  const addTypedEmail = () => {
    const parsed = emailSchema.safeParse(emailField);
    if (!parsed.success) {
      setEmailError('Enter a valid email address');
      return;
    }
    if (invitedEmails.has(parsed.data) || typedEmails.includes(parsed.data)) {
      setEmailError('Already added');
      return;
    }
    setTypedEmails((prev) => [...prev, parsed.data]);
    setEmailField('');
    setEmailError(null);
  };

  const removeTypedEmail = (email: string) => setTypedEmails((prev) => prev.filter((e) => e !== email));

  const selectedEmails = useMemo(() => {
    const fromContacts = groups.canInvite.filter((c) => selected.has(c.id) && c.email).map((c) => c.email!.toLowerCase());
    return Array.from(new Set([...fromContacts, ...typedEmails]));
  }, [groups.canInvite, selected, typedEmails]);

  const sending = sendInvites.isPending;
  const send = () => {
    if (sending || selectedEmails.length === 0) return;
    sendInvites.mutate({ emails: selectedEmails }, {
      onSuccess: ({ sent, skipped }) => {
        setInvitedEmails((prev) => new Set([...prev, ...selectedEmails]));
        setSelected(new Set());
        setTypedEmails([]);
        showAlert(
          sent > 0 ? `Sent ${sent} ${sent === 1 ? 'invite' : 'invites'}` : "Couldn't send any invites",
          skipped > 0 ? `${skipped} ${skipped === 1 ? 'address was' : 'addresses were'} skipped (already invited or already on Chatsoon).` : undefined,
        );
      },
      onError: (err) => {
        if (err instanceof ApiError && err.code === 'referral_invite_limit') {
          showAlert("Today's invite limit reached", "You can send up to 20 invites per day. Try again tomorrow.");
          return;
        }
        showError(err, "Couldn't send invites");
      },
    });
  };

  const textContact = async (contact: Contact) => {
    if (!contact.phone || !referral.data) return;
    try {
      await SMS.sendSMSAsync([contact.phone], inviteMessage(firstName(contact.name), referral.data.link));
      setTextedIds((prev) => new Set(prev).add(contact.id));
    } catch (err) {
      showError(err, "Couldn't open the message app");
    }
  };

  if (contacts.isPending || referral.isPending) {
    return (
      <Screen edges={['bottom']} contentStyle={styles.loading}>
        <Stack.Screen options={{ title: 'Invite contacts' }} />
        <ActivityIndicator color={theme.primary} />
      </Screen>
    );
  }

  return (
    <Screen edges={['bottom']} contentStyle={styles.content}>
      <Stack.Screen options={{ title: 'Invite contacts' }} />

      <Card style={styles.emailCard}>
        <Text variant="captionStrong" color="textSecondary">
          Invite by email
        </Text>
        <View style={styles.emailRow}>
          <View style={styles.flex}>
            <TextField
              placeholder="name@company.com"
              value={emailField}
              onChangeText={(v) => {
                setEmailField(v);
                if (emailError) setEmailError(null);
              }}
              error={emailError}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              inputMode="email"
              returnKeyType="done"
              onSubmitEditing={addTypedEmail}
            />
          </View>
          <Button title="Add" variant="secondary" fullWidth={false} onPress={addTypedEmail} disabled={!emailField.trim()} />
        </View>
        {typedEmails.length > 0 ? (
          <View style={styles.chipRow}>
            {typedEmails.map((email) => (
              <RemovableChip key={email} label={email} onRemove={() => removeTypedEmail(email)} />
            ))}
          </View>
        ) : null}
      </Card>

      {selectable.length > 0 ? (
        <View style={styles.selectAllRow}>
          <Checkbox checked={allSelected} onChange={toggleSelectAll} label="Select all" />
        </View>
      ) : null}

      {groups.canInvite.length === 0 && groups.onChatsoon.length === 0 && groups.needsDetails.length === 0 ? (
        <EmptyState icon="people-outline" title="No contacts yet" message="Save contacts first, then come back to invite them." />
      ) : (
        <>
          {groups.canInvite.length > 0 ? (
            <ContactGroup title="Can invite">
              {groups.canInvite.map((c, i) => (
                <CanInviteRow
                  key={c.id}
                  contact={c}
                  checked={selected.has(c.id)}
                  invited={!!c.email && invitedEmails.has(c.email.toLowerCase())}
                  texted={textedIds.has(c.id)}
                  smsAvailable={smsAvailable}
                  divider={i < groups.canInvite.length - 1}
                  onToggle={() => toggleContact(c)}
                  onText={() => void textContact(c)}
                />
              ))}
            </ContactGroup>
          ) : null}

          {groups.onChatsoon.length > 0 ? (
            <ContactGroup title="Already on Chatsoon">
              {groups.onChatsoon.map((c, i) => (
                <View key={c.id} style={[styles.row, i < groups.onChatsoon.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.border }]}>
                  <Avatar name={c.name} size={40} />
                  <Text variant="body" style={styles.flex} numberOfLines={1}>
                    {c.name}
                  </Text>
                  <Icon name="checkmark-circle" size={18} color="success" />
                </View>
              ))}
            </ContactGroup>
          ) : null}

          {groups.needsDetails.length > 0 ? (
            <ContactGroup title="Add details to invite">
              {groups.needsDetails.map((c, i) => (
                <Pressable
                  key={c.id}
                  onPress={() => router.push(`/contact/${c.id}/edit`)}
                  accessibilityRole="button"
                  accessibilityLabel={`Add an email or phone number for ${c.name}`}
                  style={[styles.row, styles.dimmed, i < groups.needsDetails.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.border }]}>
                  <Avatar name={c.name} size={40} />
                  <Text variant="body" style={styles.flex} numberOfLines={1}>
                    {c.name}
                  </Text>
                  <Icon name="chevron-forward" size={18} color="textTertiary" />
                </Pressable>
              ))}
            </ContactGroup>
          ) : null}
        </>
      )}

      <View style={styles.footer}>
        <Button
          title={`Send ${selectedEmails.length} ${selectedEmails.length === 1 ? 'invite' : 'invites'}`}
          icon="mail-outline"
          onPress={send}
          loading={sending}
          disabled={selectedEmails.length === 0}
        />
        <Text variant="caption" color="textTertiary" align="center">
          20 invites per day.
        </Text>
      </View>
    </Screen>
  );
}

function ContactGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.group}>
      <Text variant="captionStrong" color="textSecondary">
        {title.toUpperCase()}
      </Text>
      <Card padded={false} style={styles.groupCard}>
        {children}
      </Card>
    </View>
  );
}

/** Just the checkbox icon (no built-in label - the row draws the contact's name itself), same icons as
 * components/ui/checkbox.tsx for visual consistency. */
function CheckToggle({ checked, onChange, accessibilityLabel }: { checked: boolean; onChange: () => void; accessibilityLabel: string }) {
  return (
    <Pressable
      onPress={onChange}
      hitSlop={8}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      aria-checked={checked}
      accessibilityLabel={accessibilityLabel}
      style={styles.rowAvatarWrap}>
      <Icon name={checked ? 'checkbox' : 'square-outline'} size={22} color={checked ? 'primary' : 'textSecondary'} />
    </Pressable>
  );
}

function RemovableChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onRemove}
      accessibilityRole="button"
      accessibilityLabel={`Remove ${label}`}
      style={({ pressed }) => [styles.chip, { backgroundColor: theme.primarySoft, opacity: pressed ? 0.7 : 1 }]}>
      <Text variant="captionStrong" color="primary" numberOfLines={1} style={styles.chipLabel}>
        {label}
      </Text>
      <Icon name="close" size={14} color="primary" />
    </Pressable>
  );
}

function CanInviteRow({
  contact,
  checked,
  invited,
  texted,
  smsAvailable,
  divider,
  onToggle,
  onText,
}: {
  contact: Contact;
  checked: boolean;
  invited: boolean;
  texted: boolean;
  smsAvailable: boolean;
  divider: boolean;
  onToggle: () => void;
  onText: () => void;
}) {
  const theme = useTheme();
  const subtitle = contact.email ?? contact.phone ?? undefined;
  const canText = !isWeb && smsAvailable && !!contact.phone;

  return (
    <View style={[styles.row, divider && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.border }]}>
      {contact.email && !invited ? (
        <CheckToggle checked={checked} onChange={onToggle} accessibilityLabel={`Select ${contact.name} to email`} />
      ) : (
        <View style={styles.rowAvatarWrap}>
          <Avatar name={contact.name} size={40} />
        </View>
      )}
      <View style={styles.flex}>
        <Text variant="body" numberOfLines={1}>
          {contact.name}
        </Text>
        {subtitle ? (
          <Text variant="caption" color="textSecondary" numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {invited ? <Pill label="Invited" tone="success" icon="checkmark" /> : null}
      {texted ? (
        <Pill label="Texted" tone="success" icon="checkmark" />
      ) : canText ? (
        <Button title="Text" variant="secondary" size="sm" fullWidth={false} onPress={onText} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  loading: { flexGrow: 1, alignItems: 'center', justifyContent: 'center' },
  content: { gap: Spacing.four, paddingBottom: Spacing.six },
  flex: { flex: 1 },
  emailCard: { gap: Spacing.two },
  emailRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 28,
    maxWidth: 220,
    paddingHorizontal: Spacing.three,
    borderRadius: 999,
  },
  chipLabel: { flexShrink: 1 },
  selectAllRow: { paddingHorizontal: Spacing.one },
  group: { gap: Spacing.two },
  groupCard: { gap: 0 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
    minHeight: 60,
  },
  rowAvatarWrap: { width: 44, alignItems: 'center' },
  dimmed: { opacity: 0.6 },
  footer: { gap: Spacing.two, paddingTop: Spacing.two },
});
