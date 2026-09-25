import type { ContactVisibility, LinkKey, MyProfile, ProfileContactKey, ProfileInput } from '@chatsoon/shared';
import {
  CONTACT_KEYS,
  LINK_KEYS,
  LINK_PREFIXES,
  canonicalLinkValue,
  changedKeys,
  linkFieldValue,
  profileInputSchema,
} from '@chatsoon/shared';
import * as Crypto from 'expo-crypto';
import { useRef } from 'react';
import { StyleSheet, Switch, View, type TextInput, type TextInputProps } from 'react-native';

import { Text, TextField, type IconName } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { BookingLinksEditor, type BookingLinkFormValue } from './booking-links-editor';
import { ContactFields } from './contact-fields';

/** Whether a link field is showing a bare handle (with its fixed prefix) or a full URL. */
export type LinkFieldMode = 'handle' | 'url';

export type ProfileFormValues = {
  displayName: string;
  headline: string;
  company: string;
  role: string;
  /**
   * What's shown in each link field: the bare handle when `linkModes[key]` is 'handle' (the prefix in
   * LINK_PREFIXES is shown before it), or a full URL when it's 'url'. Never the raw stored value as-is -
   * `profileToForm` always splits it with `linkFieldValue` first.
   */
  links: Record<LinkKey, string>;
  linkModes: Record<LinkKey, LinkFieldMode>;
  contact: Record<ProfileContactKey, string>;
  contactVisibility: ContactVisibility;
  bookingLinks: BookingLinkFormValue[];
  /** "Show my profile in search engines" (off by default). */
  searchVisible: boolean;
};

export type ProfileField =
  | 'displayName'
  | 'headline'
  | 'company'
  | 'role'
  | LinkKey
  | ProfileContactKey
  | 'contactVisibility'
  | 'searchVisible'
  | 'bookingLinks'
  | `bookingLinks.${number}.url`
  | `bookingLinks.${number}.label`;
export type ProfileFormErrors = Partial<Record<ProfileField, string>>;

/** Splits every stored link into its form display value and mode with `linkFieldValue`. */
function linksToForm(links: Partial<Record<LinkKey, string>>): {
  links: Record<LinkKey, string>;
  linkModes: Record<LinkKey, LinkFieldMode>;
} {
  const values = {} as Record<LinkKey, string>;
  const modes = {} as Record<LinkKey, LinkFieldMode>;
  for (const key of LINK_KEYS) {
    const field = linkFieldValue(key, links[key] ?? '');
    values[key] = field.mode === 'handle' ? field.handle : field.url;
    modes[key] = field.mode;
  }
  return { links: values, linkModes: modes };
}

/** The canonical (storable) value of every link field, from its current form display value. */
function canonicalLinksOf(values: Pick<ProfileFormValues, 'links'>): Record<LinkKey, string> {
  const out = {} as Record<LinkKey, string>;
  for (const key of LINK_KEYS) out[key] = canonicalLinkValue(key, values.links[key]);
  return out;
}

export function profileToForm(profile: MyProfile | null | undefined): ProfileFormValues {
  const contact = profile?.contact ?? {};
  const { links, linkModes } = linksToForm(profile?.links ?? {});
  return {
    displayName: profile?.displayName ?? '',
    headline: profile?.headline ?? '',
    company: profile?.company ?? '',
    role: profile?.role ?? '',
    links,
    linkModes,
    // Old cached profiles (fetched before this field existed) have no contact: default to none, private.
    contact: {
      phone: contact.phone ?? '',
      whatsapp: contact.whatsapp ?? '',
      signal: contact.signal ?? '',
    },
    contactVisibility: profile?.contactVisibility ?? 'connections',
    // Old cached profiles (fetched before this field existed) have no bookingLinks: default to none.
    bookingLinks: (profile?.bookingLinks ?? []).map((link) => ({
      key: Crypto.randomUUID(),
      label: link.label,
      url: link.url,
    })),
    // Off by default, and for profiles fetched before this field existed.
    searchVisible: profile?.searchVisible ?? false,
  };
}

function sameBookingLinks(a: BookingLinkFormValue[], b: BookingLinkFormValue[]): boolean {
  return a.length === b.length && a.every((link, i) => link.label === b[i]?.label && link.url === b[i]?.url);
}

export function sameProfileForm(a: ProfileFormValues, b: ProfileFormValues): boolean {
  return (
    a.displayName === b.displayName &&
    a.headline === b.headline &&
    a.company === b.company &&
    a.role === b.role &&
    LINK_KEYS.every((k) => a.links[k] === b.links[k] && a.linkModes[k] === b.linkModes[k]) &&
    CONTACT_KEYS.every((k) => a.contact[k] === b.contact[k]) &&
    a.contactVisibility === b.contactVisibility &&
    a.searchVisible === b.searchVisible &&
    sameBookingLinks(a.bookingLinks, b.bookingLinks)
  );
}

/**
 * Validates the form with the shared profileInputSchema. Text is trimmed and empty fields become
 * null, so clearing a field removes it. Links and booking links are left out unless `withLinks` is
 * set, which leaves the profile's current links (and booking links) untouched.
 *
 * `initial`, when given, is the form's last-saved values: links, contact and contactVisibility are
 * then sent as only the keys that changed since (see `changedKeys`), never the whole object. This is
 * the fix for the stale-cache bug where `initial` was captured once from a cache that could be behind
 * a value saved from another device, and a full save would overwrite it with the stale one. Without
 * `initial` (onboarding, which also passes `withLinks: false`), there's nothing to diff against.
 */
export function parseProfileForm(
  values: ProfileFormValues,
  avatarKey: string | null,
  { withLinks = true, initial }: { withLinks?: boolean; initial?: ProfileFormValues } = {},
): { ok: true; input: ProfileInput } | { ok: false; errors: ProfileFormErrors } {
  // A booking link row left completely blank (e.g. added, then not filled in) is dropped, not an error.
  const bookingRows = values.bookingLinks
    .map((link, index) => ({ link, index }))
    .filter(({ link }) => link.url.trim() || link.label.trim());
  // Diffed and sent as their canonical (storable) form, never the raw handle/URL text shown in the
  // field, so a pasted URL that only reduces to the same handle the user already had sends no change.
  const links = withLinks
    ? initial
      ? changedKeys(canonicalLinksOf(initial), canonicalLinksOf(values))
      : canonicalLinksOf(values)
    : undefined;
  const contact = withLinks ? (initial ? changedKeys(initial.contact, values.contact) : values.contact) : undefined;
  const contactVisibility =
    withLinks && (!initial || initial.contactVisibility !== values.contactVisibility)
      ? values.contactVisibility
      : undefined;
  const searchVisible =
    withLinks && (!initial || initial.searchVisible !== values.searchVisible) ? values.searchVisible : undefined;
  const result = profileInputSchema.safeParse({
    displayName: values.displayName,
    headline: values.headline,
    company: values.company,
    role: values.role,
    links,
    bookingLinks: withLinks ? bookingRows.map(({ link }) => ({ label: link.label, url: link.url })) : undefined,
    contact,
    contactVisibility,
    searchVisible,
    avatarKey,
  });
  if (result.success) return { ok: true, input: result.data };

  const errors: ProfileFormErrors = {};
  for (const issue of result.error.issues) {
    const [head, sub, leaf] = issue.path;
    let field: ProfileField | undefined;
    if (head === 'links' || head === 'contact') {
      if (typeof sub === 'string') field = sub as ProfileField;
    } else if (head === 'bookingLinks') {
      // ['bookingLinks', i, 'url' | 'label'] is a row error; ['bookingLinks'] alone (e.g. too many) is not.
      // i counts sent rows only, so map it back to the form row.
      const row = typeof sub === 'number' ? bookingRows[sub]?.index : undefined;
      field =
        row !== undefined && typeof leaf === 'string'
          ? (`bookingLinks.${row}.${leaf}` as ProfileField)
          : 'bookingLinks';
    } else if (typeof head === 'string') {
      field = head as ProfileField;
    }
    if (field && !errors[field]) errors[field] = issue.message;
  }
  return { ok: false, errors };
}

type LinkFieldConfig = {
  label: string;
  icon: IconName;
  placeholder: string;
  maxLength: number;
  keyboardType: TextInputProps['keyboardType'];
  autoComplete?: TextInputProps['autoComplete'];
};

const LINK_FIELDS: Record<LinkKey, LinkFieldConfig> = {
  x: { label: 'X', icon: 'logo-x', placeholder: 'yourhandle', maxLength: 200, keyboardType: 'default' },
  telegram: {
    label: 'Telegram',
    icon: 'paper-plane-outline',
    placeholder: 'username',
    maxLength: 200,
    keyboardType: 'default',
  },
  linkedin: {
    label: 'LinkedIn',
    icon: 'logo-linkedin',
    placeholder: 'your-name',
    maxLength: 300,
    keyboardType: 'url',
  },
  website: {
    label: 'Website',
    icon: 'globe-outline',
    placeholder: 'yourcompany.com',
    maxLength: 300,
    keyboardType: 'url',
    autoComplete: 'url',
  },
  youtube: {
    label: 'YouTube',
    icon: 'logo-youtube',
    placeholder: 'yourchannel',
    maxLength: 300,
    keyboardType: 'url',
  },
};

export type ProfileFieldsProps = {
  values: ProfileFormValues;
  errors: ProfileFormErrors;
  onChange: (values: ProfileFormValues) => void;
  /** Show the links group (profile edit). Onboarding only asks for the basics. */
  withLinks?: boolean;
  autoFocusName?: boolean;
  /** Called when the keyboard's return key is pressed on the last field. */
  onSubmit?: () => void;
  editable?: boolean;
};

/** Name, headline, company, role and (optionally) links, with keyboard "next" chaining. */
export function ProfileFields({
  values,
  errors,
  onChange,
  withLinks = false,
  autoFocusName = false,
  onSubmit,
  editable = true,
}: ProfileFieldsProps) {
  const theme = useTheme();
  const headlineRef = useRef<TextInput>(null);
  const companyRef = useRef<TextInput>(null);
  const roleRef = useRef<TextInput>(null);
  const mobileRef = useRef<TextInput>(null);
  const linkRefs = useRef<Partial<Record<LinkKey, TextInput | null>>>({});
  // Captured once, on mount, as the loaded value: lets the "turned off" note below fire only when the
  // switch moves from on to off during this edit, not just because it loaded off.
  const loadedSearchVisible = useRef(values.searchVisible).current;

  const set = <K extends 'displayName' | 'headline' | 'company' | 'role'>(key: K, value: string) =>
    onChange({ ...values, [key]: value });

  /**
   * Typing a bare handle just stores it. Pasting or typing something URL-shaped (has a '/' or starts
   * with 'http'/'www.') runs it through canonicalLinkValue + linkFieldValue: a URL that reduces to a
   * handle (e.g. a copied profile link) shows just the handle, with the prefix back; a URL that
   * doesn't reduce (a company page, a channel URL) switches the field to url mode, showing the full
   * cleaned URL with the prefix hidden. Clearing a url-mode field goes back to handle mode.
   */
  const setLink = (key: LinkKey, text: string) => {
    const looksLikeUrl = /^(?:https?:\/\/|www\.)/i.test(text) || text.includes('/');
    if (looksLikeUrl) {
      const field = linkFieldValue(key, canonicalLinkValue(key, text));
      const value = field.mode === 'handle' ? field.handle : field.url;
      onChange({
        ...values,
        links: { ...values.links, [key]: value },
        linkModes: { ...values.linkModes, [key]: field.mode },
      });
      return;
    }
    const mode = text.trim() === '' ? 'handle' : values.linkModes[key];
    onChange({ ...values, links: { ...values.links, [key]: text }, linkModes: { ...values.linkModes, [key]: mode } });
  };

  // Focus order: role -> mobile -> WhatsApp -> Signal (inside ContactFields) -> first link.
  const afterRole = () => {
    if (withLinks) mobileRef.current?.focus();
    else onSubmit?.();
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.group}>
        {withLinks ? <GroupHeader title="About you" /> : null}
        <TextField
          label="Name"
          placeholder="Your full name"
          value={values.displayName}
          onChangeText={(v) => set('displayName', v)}
          error={errors.displayName}
          autoFocus={autoFocusName}
          autoCapitalize="words"
          autoComplete="name"
          textContentType="name"
          returnKeyType="next"
          submitBehavior="submit"
          onSubmitEditing={() => headlineRef.current?.focus()}
          maxLength={80}
          editable={editable}
        />
        <TextField
          ref={headlineRef}
          label="Headline"
          placeholder="e.g. Building the future of payments"
          hint="One line about what you do. It shows under your name."
          value={values.headline}
          onChangeText={(v) => set('headline', v)}
          error={errors.headline}
          autoCapitalize="sentences"
          returnKeyType="next"
          submitBehavior="submit"
          onSubmitEditing={() => companyRef.current?.focus()}
          maxLength={120}
          editable={editable}
        />
        <TextField
          ref={companyRef}
          label="Company"
          placeholder="Where you work"
          value={values.company}
          onChangeText={(v) => set('company', v)}
          error={errors.company}
          autoCapitalize="words"
          autoComplete="organization"
          textContentType="organizationName"
          returnKeyType="next"
          submitBehavior="submit"
          onSubmitEditing={() => roleRef.current?.focus()}
          maxLength={80}
          editable={editable}
        />
        <TextField
          ref={roleRef}
          label="Role"
          placeholder="e.g. Founder, Head of Partnerships"
          value={values.role}
          onChangeText={(v) => set('role', v)}
          error={errors.role}
          autoCapitalize="words"
          autoComplete="organization-title"
          textContentType="jobTitle"
          returnKeyType={withLinks ? 'next' : 'done'}
          submitBehavior={withLinks ? 'submit' : 'blurAndSubmit'}
          onSubmitEditing={afterRole}
          maxLength={80}
          editable={editable}
        />
      </View>

      {withLinks ? (
        <>
          <ContactFields
            values={values.contact}
            visibility={values.contactVisibility}
            onChange={(contact) => onChange({ ...values, contact })}
            onVisibilityChange={(contactVisibility) => onChange({ ...values, contactVisibility })}
            errors={errors}
            mobileRef={mobileRef}
            onSubmit={() => linkRefs.current[LINK_KEYS[0]]?.focus()}
            editable={editable}
          />

          <View style={styles.group}>
            <GroupHeader
              title="Links"
              hint="Handles or full links both work. They show on your public profile so people can find you."
            />
            {LINK_KEYS.map((key, i) => {
              const field = LINK_FIELDS[key];
              const last = i === LINK_KEYS.length - 1;
              const next = LINK_KEYS[i + 1];
              // Only a handle-mode field shows its fixed prefix; a url-mode field (a company page, a
              // channel URL, or anything that didn't reduce to a handle) shows the full URL instead.
              const prefix = values.linkModes[key] === 'handle' ? LINK_PREFIXES[key] : undefined;
              return (
                <TextField
                  key={key}
                  ref={(el) => {
                    linkRefs.current[key] = el;
                  }}
                  label={field.label}
                  icon={field.icon}
                  prefix={prefix}
                  placeholder={field.placeholder}
                  value={values.links[key]}
                  onChangeText={(v) => setLink(key, v)}
                  error={errors[key]}
                  keyboardType={field.keyboardType}
                  autoComplete={field.autoComplete ?? 'off'}
                  autoCapitalize="none"
                  autoCorrect={false}
                  spellCheck={false}
                  accessibilityLabel={prefix ? `${field.label} handle, ${prefix}` : field.label}
                  returnKeyType={last ? 'done' : 'next'}
                  submitBehavior={last ? 'blurAndSubmit' : 'submit'}
                  onSubmitEditing={() => (next ? linkRefs.current[next]?.focus() : onSubmit?.())}
                  maxLength={field.maxLength}
                  editable={editable}
                />
              );
            })}
          </View>

          <BookingLinksEditor
            links={values.bookingLinks}
            onChange={(bookingLinks) => onChange({ ...values, bookingLinks })}
            errors={bookingLinkRowErrors(errors, values.bookingLinks.length)}
            listError={errors.bookingLinks}
            editable={editable}
          />

          <View style={styles.group}>
            <GroupHeader title="Search engines" hint="Your profile is private by default." />
            <View style={styles.searchRow}>
              <Text variant="body" style={styles.flex}>
                Show my profile in search engines
              </Text>
              <Switch
                value={values.searchVisible}
                onValueChange={(v) => onChange({ ...values, searchVisible: v })}
                disabled={!editable}
                trackColor={{ false: theme.border, true: theme.primary }}
                thumbColor={theme.surface}
                ios_backgroundColor={theme.border}
              />
            </View>
            <Text variant="caption" color="textTertiary" style={styles.searchCaption}>
              {values.searchVisible
                ? 'Google and other search engines can list your name, photo, headline, role, company and links, so people can find you by searching your name. Your phone and messaging details are never shown to search engines.'
                : 'Only people with your link or QR code can find your profile.'}
            </Text>
            {values.searchVisible && hasContactChannel(values.contact) ? (
              <Text variant="caption" color="textTertiary" style={styles.searchCaption}>
                {values.contactVisibility === 'public'
                  ? 'Anyone with your link can still get your number.'
                  : 'Anyone who connects with you can still get your number.'}
              </Text>
            ) : null}
            {!values.searchVisible && loadedSearchVisible ? (
              <Text variant="caption" color="textTertiary" style={styles.searchCaption}>
                Search engines will be asked to remove your profile. It usually disappears within a few
                days to a few weeks.
              </Text>
            ) : null}
          </View>
        </>
      ) : null}
    </View>
  );
}

/** Whether the form has a phone, WhatsApp or Signal value entered. */
function hasContactChannel(contact: Record<ProfileContactKey, string>): boolean {
  return CONTACT_KEYS.some((key) => contact[key].trim().length > 0);
}

/** Per-row `{ url, label }` errors for BookingLinksEditor, read out of the flat ProfileFormErrors map. */
function bookingLinkRowErrors(errors: ProfileFormErrors, count: number): { url?: string; label?: string }[] {
  return Array.from({ length: count }, (_, i) => ({
    url: errors[`bookingLinks.${i}.url` as ProfileField],
    label: errors[`bookingLinks.${i}.label` as ProfileField],
  }));
}

function GroupHeader({ title, hint }: { title: string; hint?: string }) {
  return (
    <View style={styles.groupHeader}>
      <Text variant="captionStrong" color="textSecondary" style={styles.groupTitle} accessibilityRole="header">
        {title.toUpperCase()}
      </Text>
      {hint ? (
        <Text variant="caption" color="textTertiary">
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.six },
  group: { gap: Spacing.four },
  groupHeader: { gap: Spacing.half, paddingHorizontal: Spacing.one, marginBottom: -Spacing.one },
  groupTitle: { letterSpacing: 0.4 },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingHorizontal: Spacing.one },
  flex: { flex: 1 },
  searchCaption: { paddingHorizontal: Spacing.one },
});
