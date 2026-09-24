import { CONTACT_MAX, parseIntlPhone, type ContactVisibility, type ProfileContactKey } from '@chatsoon/shared';
import { useRef, type RefObject } from 'react';
import { Pressable, StyleSheet, View, type TextInput } from 'react-native';

import { Chip, Text, TextField } from '@/components/ui';
import { Spacing } from '@/constants/theme';

export type ContactFieldsProps = {
  values: Record<ProfileContactKey, string>;
  visibility: ContactVisibility;
  onChange: (values: Record<ProfileContactKey, string>) => void;
  onVisibilityChange: (visibility: ContactVisibility) => void;
  errors: Partial<Record<ProfileContactKey, string>>;
  /** So the parent (ProfileFields) can focus Mobile after Role's return key. */
  mobileRef?: RefObject<TextInput | null>;
  /** Called when Signal's return key is pressed, to move on to the first link field. */
  onSubmit?: () => void;
  editable?: boolean;
};

/**
 * "Phone and messaging" group in Edit profile: Mobile, WhatsApp and Signal, each independently
 * optional, plus who can see them. Rendered by ProfileFields, between "About you" and "Links".
 */
export function ContactFields({
  values,
  visibility,
  onChange,
  onVisibilityChange,
  errors,
  mobileRef,
  onSubmit,
  editable = true,
}: ContactFieldsProps) {
  const whatsappRef = useRef<TextInput>(null);
  const signalRef = useRef<TextInput>(null);

  const setField = (key: ProfileContactKey, value: string) => onChange({ ...values, [key]: value });

  // Shown under WhatsApp and Signal once the mobile number is valid, so it doesn't have to be retyped.
  const mobile = parseIntlPhone(values.phone) ? values.phone.trim() : null;

  return (
    <View style={styles.group}>
      <GroupHeader title="Phone and messaging" />

      <View style={styles.field}>
        <TextField
          ref={mobileRef}
          label="Mobile number"
          icon="call-outline"
          placeholder="+61 491 570 156"
          hint="Include your country code."
          value={values.phone}
          onChangeText={(v) => setField('phone', v)}
          error={errors.phone}
          keyboardType="phone-pad"
          autoComplete="tel"
          textContentType="telephoneNumber"
          returnKeyType="next"
          submitBehavior="submit"
          onSubmitEditing={() => whatsappRef.current?.focus()}
          maxLength={CONTACT_MAX.phone}
          editable={editable}
        />
      </View>

      <View style={styles.field}>
        <TextField
          ref={whatsappRef}
          label="WhatsApp"
          icon="logo-whatsapp"
          placeholder="+61 491 570 156 or wa.me link"
          value={values.whatsapp}
          onChangeText={(v) => setField('whatsapp', v)}
          error={errors.whatsapp}
          keyboardType="default"
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          returnKeyType="next"
          submitBehavior="submit"
          onSubmitEditing={() => signalRef.current?.focus()}
          maxLength={CONTACT_MAX.whatsapp}
          editable={editable}
        />
        {mobile && !values.whatsapp.trim() ? (
          <UseMobileButton mobile={mobile} editable={editable} onPress={() => setField('whatsapp', mobile)} />
        ) : null}
      </View>

      <View style={styles.field}>
        <TextField
          ref={signalRef}
          label="Signal"
          icon="chatbubble-ellipses-outline"
          placeholder="+61 491 570 156 or username link"
          hint="Signal finds you by number only if your Signal settings allow it. A username link always works: in Signal, tap your profile, then Username, then QR code or link."
          value={values.signal}
          onChangeText={(v) => setField('signal', v)}
          error={errors.signal}
          keyboardType="default"
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          returnKeyType="next"
          submitBehavior="submit"
          onSubmitEditing={onSubmit}
          maxLength={CONTACT_MAX.signal}
          editable={editable}
        />
        {mobile && !values.signal.trim() ? (
          <UseMobileButton mobile={mobile} editable={editable} onPress={() => setField('signal', mobile)} />
        ) : null}
      </View>

      <View style={styles.visibility}>
        <Text variant="captionStrong" color="textSecondary">
          Who can see these
        </Text>
        <View style={styles.chips}>
          <Chip
            label="People I connect with"
            selected={visibility === 'connections'}
            onPress={editable ? () => onVisibilityChange('connections') : undefined}
          />
          <Chip
            label="Anyone with my link"
            selected={visibility === 'public'}
            onPress={editable ? () => onVisibilityChange('public') : undefined}
          />
        </View>
        <Text variant="caption" color="textTertiary">
          {visibility === 'public'
            ? 'Shown to anyone who opens your profile link or scans your QR code.'
            : "Shown to Chatsoon users you connect with and to people who send you their details with the Connect form on your page."}
        </Text>
      </View>
    </View>
  );
}

function UseMobileButton({ mobile, editable, onPress }: { mobile: string; editable: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={editable ? onPress : undefined}
      disabled={!editable}
      accessibilityRole="button"
      hitSlop={8}
      style={styles.useButton}>
      <Text variant="captionStrong" color="primary">
        {`Use ${mobile}`}
      </Text>
    </Pressable>
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
  group: { gap: Spacing.four },
  groupHeader: { gap: Spacing.half, paddingHorizontal: Spacing.one, marginBottom: -Spacing.one },
  groupTitle: { letterSpacing: 0.4 },
  field: { gap: Spacing.two },
  useButton: { alignSelf: 'flex-start', paddingHorizontal: Spacing.one },
  visibility: { gap: Spacing.two, paddingHorizontal: Spacing.one },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
});
