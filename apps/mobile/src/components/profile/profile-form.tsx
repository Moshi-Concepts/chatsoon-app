import type { LinkKey, MyProfile, ProfileInput } from '@chatsoon/shared';
import { LINK_KEYS, profileInputSchema } from '@chatsoon/shared';
import { useRef } from 'react';
import { StyleSheet, View, type TextInput, type TextInputProps } from 'react-native';

import { Text, TextField, type IconName } from '@/components/ui';
import { Spacing } from '@/constants/theme';

export type ProfileFormValues = {
  displayName: string;
  headline: string;
  company: string;
  role: string;
  links: Record<LinkKey, string>;
};

export type ProfileField = 'displayName' | 'headline' | 'company' | 'role' | LinkKey;
export type ProfileFormErrors = Partial<Record<ProfileField, string>>;

export function profileToForm(profile: MyProfile | null | undefined): ProfileFormValues {
  const links = profile?.links ?? {};
  return {
    displayName: profile?.displayName ?? '',
    headline: profile?.headline ?? '',
    company: profile?.company ?? '',
    role: profile?.role ?? '',
    links: {
      x: links.x ?? '',
      telegram: links.telegram ?? '',
      linkedin: links.linkedin ?? '',
      website: links.website ?? '',
      youtube: links.youtube ?? '',
    },
  };
}

export function sameProfileForm(a: ProfileFormValues, b: ProfileFormValues): boolean {
  return (
    a.displayName === b.displayName &&
    a.headline === b.headline &&
    a.company === b.company &&
    a.role === b.role &&
    LINK_KEYS.every((k) => a.links[k] === b.links[k])
  );
}

/**
 * Validates the form with the shared profileInputSchema. Text is trimmed and empty fields become
 * null, so clearing a field removes it. Links are left out unless `withLinks` is set.
 */
export function parseProfileForm(
  values: ProfileFormValues,
  avatarKey: string | null,
  { withLinks = true }: { withLinks?: boolean } = {},
): { ok: true; input: ProfileInput } | { ok: false; errors: ProfileFormErrors } {
  const result = profileInputSchema.safeParse({
    displayName: values.displayName,
    headline: values.headline,
    company: values.company,
    role: values.role,
    links: withLinks ? values.links : undefined,
    avatarKey,
  });
  if (result.success) return { ok: true, input: result.data };

  const errors: ProfileFormErrors = {};
  for (const issue of result.error.issues) {
    const [head, sub] = issue.path;
    const field = (head === 'links' ? sub : head) as ProfileField;
    if (typeof field === 'string' && !errors[field]) errors[field] = issue.message;
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
  x: { label: 'X', icon: 'logo-x', placeholder: '@yourhandle', maxLength: 200, keyboardType: 'default' },
  telegram: {
    label: 'Telegram',
    icon: 'paper-plane-outline',
    placeholder: '@username',
    maxLength: 200,
    keyboardType: 'default',
  },
  linkedin: {
    label: 'LinkedIn',
    icon: 'logo-linkedin',
    placeholder: 'linkedin.com/in/your-name',
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
    placeholder: 'youtube.com/@yourchannel',
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
  const headlineRef = useRef<TextInput>(null);
  const companyRef = useRef<TextInput>(null);
  const roleRef = useRef<TextInput>(null);
  const linkRefs = useRef<Partial<Record<LinkKey, TextInput | null>>>({});

  const set = <K extends 'displayName' | 'headline' | 'company' | 'role'>(key: K, value: string) =>
    onChange({ ...values, [key]: value });
  const setLink = (key: LinkKey, value: string) => onChange({ ...values, links: { ...values.links, [key]: value } });

  const afterRole = () => {
    if (withLinks) linkRefs.current[LINK_KEYS[0]]?.focus();
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
        <View style={styles.group}>
          <GroupHeader
            title="Links"
            hint="Handles or full links both work. They show on your public profile so people can find you."
          />
          {LINK_KEYS.map((key, i) => {
            const field = LINK_FIELDS[key];
            const last = i === LINK_KEYS.length - 1;
            const next = LINK_KEYS[i + 1];
            return (
              <TextField
                key={key}
                ref={(el) => {
                  linkRefs.current[key] = el;
                }}
                label={field.label}
                icon={field.icon}
                placeholder={field.placeholder}
                value={values.links[key]}
                onChangeText={(v) => setLink(key, v)}
                error={errors[key]}
                keyboardType={field.keyboardType}
                autoComplete={field.autoComplete ?? 'off'}
                autoCapitalize="none"
                autoCorrect={false}
                spellCheck={false}
                returnKeyType={last ? 'done' : 'next'}
                submitBehavior={last ? 'blurAndSubmit' : 'submit'}
                onSubmitEditing={() => (next ? linkRefs.current[next]?.focus() : onSubmit?.())}
                maxLength={field.maxLength}
                editable={editable}
              />
            );
          })}
        </View>
      ) : null}
    </View>
  );
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
});
