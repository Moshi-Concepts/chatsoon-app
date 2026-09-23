import type { Contact, ContactDraft } from '@chatsoon/shared';
import { CARD_PLACEHOLDER_NAME, isEmail, normalizeHandle } from '@chatsoon/shared';
import * as Haptics from 'expo-haptics';
import { useRef, useState, type ReactNode, type RefObject } from 'react';
import { Keyboard, Platform, StyleSheet, View, type TextInput } from 'react-native';

import { Button, Icon, Screen, Section, Text, TextField } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useEvents, useTags } from '@/lib/queries';

import { EventPicker } from './event-picker';
import { PriorityPicker } from './priority';
import { TagPicker } from './tag-picker';

// Used by: contact/new, contact/[id]/edit (contacts agent) and card-review/[id] (capture agent).
// ContactForm renders the whole screen body (a scrolling <Screen> with the buttons in a sticky
// footer), so use it as the screen's root next to <Stack.Screen>, not inside another ScrollView.

export type ContactFormValues = {
  name: string;
  company: string;
  role: string;
  email: string;
  phone: string;
  telegram: string;
  xHandle: string;
  linkedinUrl: string;
  website: string;
  notes: string;
  priority: number | null;
  eventId: string | null;
  tagIds: string[];
};

export const emptyContactForm: ContactFormValues = {
  name: '',
  company: '',
  role: '',
  email: '',
  phone: '',
  telegram: '',
  xHandle: '',
  linkedinUrl: '',
  website: '',
  notes: '',
  priority: null,
  eventId: null,
  tagIds: [],
};

export type ContactFormProps = {
  initial: ContactFormValues;
  /**
   * Called with validated values. Throw to keep the form open (the error is shown). Resolving means
   * the screen is closing, so the form stays disabled afterwards.
   */
  onSubmit: (values: ContactFormValues) => Promise<void>;
  submitLabel: string;
  /** Rendered above the fields, e.g. the card photo on the review screen. */
  header?: ReactNode;
  /** Extra secondary action under the submit button, e.g. "Discard". */
  secondaryAction?: { label: string; onPress: () => void; destructive?: boolean };
  /** Put the cursor in Name on open. Default: only on a blank form without a header. */
  autoFocusName?: boolean;
};

/** Form values as API contact fields: trimmed, empty strings as null, handles without the '@'. */
export type ContactFormInput = {
  name: string;
  company: string | null;
  role: string | null;
  email: string | null;
  phone: string | null;
  telegram: string | null;
  xHandle: string | null;
  linkedinUrl: string | null;
  website: string | null;
  notes: string | null;
  priority: number | null;
  eventId: string | null;
  tagIds: string[];
};

export function valuesFromContact(contact: Contact): ContactFormValues {
  return {
    // A card photo that hasn't been read yet carries a placeholder name. Don't prefill it.
    name: contact.source === 'card_photo' && contact.name === CARD_PLACEHOLDER_NAME ? '' : contact.name,
    company: contact.company ?? '',
    role: contact.role ?? '',
    email: contact.email ?? '',
    phone: contact.phone ?? '',
    telegram: contact.telegram ?? '',
    xHandle: contact.xHandle ?? '',
    linkedinUrl: contact.linkedinUrl ?? '',
    website: contact.website ?? '',
    notes: contact.notes ?? '',
    priority: contact.priority,
    eventId: contact.eventId,
    tagIds: [...contact.tagIds],
  };
}

const str = (value: unknown) => (typeof value === 'string' ? value : '');

/** Prefill from a scanned QR (vCard, Telegram, LinkedIn...). Ignores anything that isn't a string. */
export function valuesFromDraft(draft: ContactDraft): ContactFormValues {
  return {
    ...emptyContactForm,
    name: str(draft.name),
    company: str(draft.company),
    role: str(draft.role),
    email: str(draft.email),
    phone: str(draft.phone),
    telegram: str(draft.telegram),
    xHandle: str(draft.xHandle),
    linkedinUrl: str(draft.linkedinUrl),
    website: str(draft.website),
    notes: str(draft.notes),
  };
}

const orNull = (value: string) => value.trim() || null;
const handleOrNull = (value: string) => (value.trim() ? normalizeHandle(value) || null : null);

export function valuesToInput(values: ContactFormValues): ContactFormInput {
  return {
    name: values.name.trim(),
    company: orNull(values.company),
    role: orNull(values.role),
    email: orNull(values.email),
    phone: orNull(values.phone),
    telegram: handleOrNull(values.telegram),
    xHandle: handleOrNull(values.xHandle),
    linkedinUrl: orNull(values.linkedinUrl),
    website: orNull(values.website),
    notes: orNull(values.notes),
    priority: values.priority,
    eventId: values.eventId,
    tagIds: values.tagIds,
  };
}

type Key = keyof ContactFormValues;
type Updater<K extends Key> = (prev: ContactFormValues[K]) => ContactFormValues[K];
type FieldErrors = { name?: string; email?: string };

const KEYS = Object.keys(emptyContactForm) as Key[];

function sameValue(a: ContactFormValues[Key], b: ContactFormValues[Key]) {
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => x === b[i]);
  return a === b;
}

function sameValues(a: ContactFormValues, b: ContactFormValues) {
  return KEYS.every((key) => sameValue(a[key], b[key]));
}

function validate(values: ContactFormValues): FieldErrors {
  const errors: FieldErrors = {};
  if (!values.name.trim()) errors.name = 'Name is required';
  const email = values.email.trim();
  // The same check the detail screen uses to make a mailto: link, so a saved email is always tappable.
  if (email && !isEmail(email)) {
    errors.email = 'Enter a valid email address, like name@company.com';
  }
  return errors;
}

export function ContactForm({
  initial,
  onSubmit,
  submitLabel,
  header,
  secondaryAction,
  autoFocusName: autoFocusNameProp,
}: ContactFormProps) {
  const theme = useTheme();
  const tags = useTags();
  const events = useEvents();

  const [values, setValues] = useState(initial);
  const [baseline, setBaseline] = useState(initial);
  const [touched, setTouched] = useState<ReadonlySet<Key>>(() => new Set());
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // State updates land a render later; the ref stops a double tap from saving twice.
  const submittingRef = useRef(false);
  // Jump straight into the name on a blank manual form. Not on review screens (they have a header).
  const [autoFocusName] = useState(() => autoFocusNameProp ?? (!header && !initial.name.trim()));

  // Initial values can change after mount (the current event loads from storage, a card finishes
  // extracting, a refetch lands). Apply them to the fields the user hasn't edited yet.
  if (!sameValues(initial, baseline)) {
    setBaseline(initial);
    const merged = { ...values };
    for (const key of KEYS) if (!touched.has(key)) (merged as Record<Key, unknown>)[key] = initial[key];
    setValues(merged);
  }

  const refs = {
    name: useRef<TextInput>(null),
    company: useRef<TextInput>(null),
    role: useRef<TextInput>(null),
    email: useRef<TextInput>(null),
    phone: useRef<TextInput>(null),
    telegram: useRef<TextInput>(null),
    xHandle: useRef<TextInput>(null),
    linkedinUrl: useRef<TextInput>(null),
    website: useRef<TextInput>(null),
  };

  function set<K extends Key>(key: K, update: ContactFormValues[K] | Updater<K>) {
    setValues((prev) => ({
      ...prev,
      [key]: typeof update === 'function' ? (update as Updater<K>)(prev[key]) : update,
    }));
    setTouched((prev) => (prev.has(key) ? prev : new Set(prev).add(key)));
    if (key === 'name' || key === 'email') setErrors((prev) => ({ ...prev, [key]: undefined }));
    setSubmitError(null);
  }

  /** Props shared by the text fields: value binding plus "next" chaining to the following field. */
  function bind(key: Exclude<Key, 'priority' | 'eventId' | 'tagIds'>, next?: RefObject<TextInput | null>) {
    return {
      value: values[key],
      onChangeText: (text: string) => set(key, text),
      editable: !submitting,
      // These fields describe someone else, so don't offer the user's own autofill details.
      autoComplete: 'off' as const,
      ...(next
        ? {
            enterKeyHint: 'next' as const,
            submitBehavior: 'submit' as const,
            onSubmitEditing: () => next.current?.focus(),
          }
        : {}),
    };
  }

  async function submit() {
    if (submittingRef.current) return;
    const found = validate(values);
    setErrors(found);
    if (found.name || found.email) {
      // Also said next to the button, in case the field is scrolled out of view.
      setSubmitError(found.name ? 'Add a name to save this contact.' : 'Check the email address.');
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      (found.name ? refs.name : refs.email).current?.focus();
      return;
    }
    Keyboard.dismiss();
    submittingRef.current = true;
    setSubmitting(true);
    setSubmitError(null);
    try {
      // Drop tags or an event deleted since the form opened, so the save doesn't fail on them.
      const knownTags = tags.data;
      const knownEvents = events.data;
      await onSubmit({
        ...values,
        tagIds: knownTags ? values.tagIds.filter((id) => knownTags.some((t) => t.id === id)) : values.tagIds,
        eventId:
          values.eventId && knownEvents && !knownEvents.some((e) => e.id === values.eventId) ? null : values.eventId,
      });
      // Resolving means the caller is leaving the screen. Stay disabled, so a tap during the
      // transition can't save (and navigate back) a second time.
    } catch (err) {
      submittingRef.current = false;
      setSubmitting(false);
      setSubmitError(err instanceof Error ? err.message : "Couldn't save the contact. Try again.");
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  }

  const footer = (
    <View style={styles.footer}>
      {submitError ? (
        <View
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          style={[styles.submitError, { backgroundColor: theme.dangerSoft }]}>
          <Icon name="alert-circle" size={18} color="danger" />
          <Text variant="caption" color="danger" style={styles.flex}>
            {submitError}
          </Text>
        </View>
      ) : null}
      <View style={styles.actions}>
        {secondaryAction ? (
          <Button
            title={secondaryAction.label}
            variant={secondaryAction.destructive ? 'dangerSoft' : 'secondary'}
            onPress={secondaryAction.onPress}
            disabled={submitting}
            style={styles.flex}
          />
        ) : null}
        <Button
          title={submitLabel}
          onPress={() => void submit()}
          loading={submitting}
          style={secondaryAction ? styles.primaryWithSecondary : styles.flex}
        />
      </View>
    </View>
  );

  return (
    <Screen footer={footer}>
      {header}

      <Section title="Person" inset={false}>
        <View style={styles.fields}>
          <TextField
            ref={refs.name}
            label="Name"
            placeholder="Full name"
            icon="person-outline"
            error={errors.name}
            maxLength={120}
            autoCapitalize="words"
            autoCorrect={false}
            autoFocus={autoFocusName}
            {...bind('name', refs.company)}
          />
          <TextField
            ref={refs.company}
            label="Company"
            placeholder="Company or project"
            icon="business-outline"
            maxLength={120}
            autoCapitalize="words"
            {...bind('company', refs.role)}
          />
          <TextField
            ref={refs.role}
            label="Role"
            placeholder="e.g. Founder, BD lead"
            icon="briefcase-outline"
            maxLength={120}
            autoCapitalize="words"
            {...bind('role', refs.email)}
          />
        </View>
      </Section>

      <Section title="Contact details" inset={false}>
        <View style={styles.fields}>
          <TextField
            ref={refs.email}
            label="Email"
            placeholder="name@company.com"
            icon="mail-outline"
            error={errors.email}
            maxLength={254}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            {...bind('email', refs.phone)}
          />
          <TextField
            ref={refs.phone}
            label="Phone"
            placeholder="+65 9123 4567"
            icon="call-outline"
            maxLength={40}
            keyboardType="phone-pad"
            {...bind('phone', refs.telegram)}
          />
          <TextField
            ref={refs.telegram}
            label="Telegram"
            placeholder="@handle"
            icon="paper-plane-outline"
            maxLength={100}
            autoCapitalize="none"
            autoCorrect={false}
            {...bind('telegram', refs.xHandle)}
          />
          <TextField
            ref={refs.xHandle}
            label="X"
            placeholder="@handle"
            icon="logo-x"
            maxLength={100}
            autoCapitalize="none"
            autoCorrect={false}
            {...bind('xHandle', refs.linkedinUrl)}
          />
          <TextField
            ref={refs.linkedinUrl}
            label="LinkedIn"
            placeholder="linkedin.com/in/name"
            icon="logo-linkedin"
            maxLength={300}
            keyboardType="url"
            autoCapitalize="none"
            autoCorrect={false}
            {...bind('linkedinUrl', refs.website)}
          />
          <TextField
            ref={refs.website}
            label="Website"
            placeholder="example.com"
            icon="globe-outline"
            maxLength={300}
            keyboardType="url"
            autoCapitalize="none"
            autoCorrect={false}
            enterKeyHint="done"
            {...bind('website')}
          />
        </View>
      </Section>

      <Section title="Event" inset={false}>
        <EventPicker value={values.eventId} onChange={(id) => set('eventId', id)} />
      </Section>

      <Section title="Tags" inset={false}>
        <TagPicker
          selected={values.tagIds}
          onToggle={(id, on) =>
            set('tagIds', (ids) => (on ? (ids.includes(id) ? ids : [...ids, id]) : ids.filter((x) => x !== id)))
          }
        />
      </Section>

      <Section title="Priority" inset={false}>
        <PriorityPicker value={values.priority} onChange={(p) => set('priority', p)} />
      </Section>

      <Section title="Notes" inset={false}>
        <TextField
          placeholder="Where you met, what you talked about, how to follow up"
          accessibilityLabel="Notes"
          multiline
          maxLength={5000}
          autoCapitalize="sentences"
          {...bind('notes')}
          style={styles.notes}
        />
      </Section>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  fields: { gap: Spacing.three },
  notes: { minHeight: 120 },
  footer: { gap: Spacing.three },
  submitError: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Radius.md,
  },
  actions: { flexDirection: 'row', gap: Spacing.three },
  primaryWithSecondary: { flex: 2 },
});
