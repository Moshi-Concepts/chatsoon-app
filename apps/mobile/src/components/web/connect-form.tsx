import { connectFormSchema, profileContactChannels, type ConnectFormInput } from '@chatsoon/shared';
import { CONNECT_FORM_MAX, connectErrorMessage } from '@chatsoon/shared/src/profile-page';
import { useMutation } from '@tanstack/react-query';
import { Link } from 'expo-router';
import { useRef, useState } from 'react';
import { StyleSheet, View, useWindowDimensions, type TextInput } from 'react-native';

import { Button, Card, Icon, Text, TextField } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { ApiError, api } from '@/lib/api';

import { ContactPills } from './contact-pills';
import { externalLinkProps } from './link-props';
import { Turnstile, type TurnstileHandle } from './turnstile';

type FieldErrors = Partial<Record<'name' | 'contact' | 'note' | 'form', string>>;

function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    return connectErrorMessage(err.status, err.code) ?? err.message;
  }
  return 'Something went wrong. Please try again.';
}

/**
 * The public Connect form for visitors without the app. Their details land in the
 * profile owner's contacts with source "web connect". Web only (needs Turnstile).
 */
export function ConnectForm({
  slug,
  firstName,
  onSent,
}: {
  slug: string;
  firstName: string;
  onSent?: () => void;
}) {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [note, setNote] = useState('');
  const [token, setToken] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const turnstile = useRef<TurnstileHandle>(null);
  const contactRef = useRef<TextInput>(null);
  const noteRef = useRef<TextInput>(null);

  const connect = useMutation({
    mutationFn: (input: ConnectFormInput) => api.profiles.connect(slug, input),
    onSuccess: () => onSent?.(),
    // Turnstile tokens are single use, so get a fresh one whatever happened.
    onSettled: () => turnstile.current?.reset(),
    onError: (err) => setErrors({ form: errorMessage(err) }),
  });

  const submit = () => {
    const parsed = connectFormSchema.safeParse({ name, contact, note, turnstileToken: token ?? '' });
    if (!parsed.success) {
      const next: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0];
        if (field === 'turnstileToken') next.form ??= 'Please complete the spam check first.';
        else if ((field === 'name' || field === 'contact' || field === 'note') && !next[field]) next[field] = issue.message;
      }
      setErrors(next);
      return;
    }
    setErrors({});
    connect.mutate(parsed.data);
  };

  if (connect.isSuccess) {
    const { contact, vcardUrl } = connect.data;
    return (
      <Card style={styles.success}>
        <View style={[styles.badge, { backgroundColor: theme.successSoft }]}>
          <Icon name="checkmark-circle" size={36} color="success" />
        </View>
        <Text variant="heading" align="center" accessibilityRole="alert">
          Sent. {firstName} now has your details.
        </Text>
        {contact ? (
          <View style={styles.successContact}>
            <Text variant="bodyStrong" align="center">
              Here&apos;s how to reach {firstName}:
            </Text>
            <ContactPills contact={contact} channels={profileContactChannels(contact)} firstName={firstName} />
            <Button
              title="Save contact"
              icon="download-outline"
              variant="secondary"
              fullWidth={false}
              style={styles.centreButton}
              accessibilityHint="Downloads a contact card you can add to your phone's contacts"
              {...externalLinkProps(vcardUrl ?? api.profiles.vcardUrl(slug))}
            />
          </View>
        ) : null}
        <Text variant="callout" color="textSecondary" align="center" style={styles.successText}>
          Want your own profile and QR code for your next event? Chatsoon is free.
        </Text>
        <Link href="/" asChild>
          <Button title="Get Chatsoon" icon="sparkles-outline" fullWidth={false} style={styles.centreButton} />
        </Link>
      </Card>
    );
  }

  const busy = connect.isPending;

  return (
    <Card style={[styles.card, width < 400 && styles.cardNarrow]}>
      <View style={styles.heading}>
        <Text variant="heading">Connect with {firstName}</Text>
        <Text variant="callout" color="textSecondary">
          Share your details and they&apos;ll land straight in {firstName}&apos;s contacts. You don&apos;t need the
          app.
        </Text>
      </View>

      <TextField
        label="Your name"
        placeholder="Jordan Lee"
        value={name}
        onChangeText={(v) => {
          setName(v);
          if (errors.name) setErrors((e) => ({ ...e, name: undefined }));
        }}
        error={errors.name}
        maxLength={CONNECT_FORM_MAX.name}
        autoCapitalize="words"
        autoComplete="name"
        textContentType="name"
        returnKeyType="next"
        submitBehavior="submit"
        onSubmitEditing={() => contactRef.current?.focus()}
        editable={!busy}
      />
      <TextField
        ref={contactRef}
        label="Email"
        placeholder="you@company.com"
        hint={`Only ${firstName} will see it.`}
        value={contact}
        onChangeText={(v) => {
          setContact(v);
          if (errors.contact) setErrors((e) => ({ ...e, contact: undefined }));
        }}
        error={errors.contact}
        maxLength={CONNECT_FORM_MAX.contact}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
        keyboardType="email-address"
        textContentType="emailAddress"
        returnKeyType="next"
        submitBehavior="submit"
        onSubmitEditing={() => noteRef.current?.focus()}
        editable={!busy}
      />
      <TextField
        ref={noteRef}
        label="Note (optional)"
        placeholder="Where you met, or what you talked about"
        value={note}
        onChangeText={setNote}
        error={errors.note}
        maxLength={CONNECT_FORM_MAX.note}
        multiline
        autoCapitalize="sentences"
        editable={!busy}
      />

      <Turnstile ref={turnstile} onToken={setToken} />

      {errors.form ? (
        <View style={[styles.formError, { backgroundColor: theme.dangerSoft }]} accessibilityRole="alert">
          <Icon name="alert-circle-outline" size={18} color="danger" />
          <Text variant="caption" color="danger" style={styles.flex}>
            {errors.form}
          </Text>
        </View>
      ) : null}

      <Button
        title={`Send to ${firstName}`}
        icon="send-outline"
        onPress={submit}
        loading={busy}
        disabled={!token}
      />
      {!token && !busy ? (
        <Text variant="caption" color="textTertiary" align="center">
          The button unlocks once the spam check above is complete.
        </Text>
      ) : null}
      <Text variant="caption" color="textTertiary" align="center">
        By sending, you agree to share these details with {firstName}. See our{' '}
        {/* New tab, so the form keeps what the visitor typed. */}
        <Text variant="caption" color="primary" {...externalLinkProps('/privacy', { newTab: true })}>
          Privacy Policy
        </Text>
        .
      </Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  card: { gap: Spacing.four, padding: Spacing.five },
  // Leaves room for the 300px Turnstile widget on 375px phones.
  cardNarrow: { padding: Spacing.four },
  heading: { gap: Spacing.one },
  formError: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    padding: Spacing.three,
    borderRadius: Radius.md,
  },
  success: { alignItems: 'center', gap: Spacing.three, padding: Spacing.six },
  successContact: { alignItems: 'center', gap: Spacing.three, alignSelf: 'stretch' },
  successText: { maxWidth: 360 },
  centreButton: { alignSelf: 'center', marginTop: Spacing.two },
  badge: { width: 72, height: 72, borderRadius: Radius.xl, alignItems: 'center', justifyContent: 'center' },
});
