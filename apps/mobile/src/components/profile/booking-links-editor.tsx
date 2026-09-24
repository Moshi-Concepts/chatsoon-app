import {
  BOOKING_LABEL_MAX,
  BOOKING_URL_MAX,
  MAX_BOOKING_LINKS,
  bookingProviderName,
  parseBookingUrl,
  suggestBookingLabel,
} from '@chatsoon/shared';
import * as Crypto from 'expo-crypto';
import { useEffect, useRef } from 'react';
import { StyleSheet, View, type TextInput } from 'react-native';

import { Button, Card, Text, TextField } from '@/components/ui';
import { Spacing } from '@/constants/theme';

/** Label to fill in for a url, or '' while it isn't a booking link yet (half typed). */
function suggestedLabel(url: string): string {
  const parsed = parseBookingUrl(url);
  return parsed ? suggestBookingLabel(parsed.url) : '';
}

/** One booking link row in the form. `key` is only for React lists; it isn't saved. */
export type BookingLinkFormValue = { key: string; label: string; url: string };

export type BookingLinksEditorProps = {
  links: BookingLinkFormValue[];
  onChange: (links: BookingLinkFormValue[]) => void;
  /** Per-row url/label errors, in the same order as `links`. */
  errors: { url?: string; label?: string }[];
  /** Error on the list itself (e.g. too many), not on any one row. */
  listError?: string;
  editable?: boolean;
};

/**
 * "Booking links" group in Edit profile: up to MAX_BOOKING_LINKS Calendly/Google Calendar/... links,
 * each with a label, reorderable and removable. Rendered by ProfileFields, after the Links group.
 */
export function BookingLinksEditor({ links, onChange, errors, listError, editable = true }: BookingLinksEditorProps) {
  const urlRefs = useRef<Partial<Record<string, TextInput | null>>>({});
  const labelRefs = useRef<Partial<Record<string, TextInput | null>>>({});
  // Set by add(), so the new row's url field gets focus once it has mounted.
  const focusKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!focusKeyRef.current) return;
    urlRefs.current[focusKeyRef.current]?.focus();
    focusKeyRef.current = null;
  }, [links]);

  const update = (i: number, patch: Partial<BookingLinkFormValue>) =>
    onChange(links.map((link, idx) => (idx === i ? { ...link, ...patch } : link)));

  const setUrl = (i: number, url: string) => {
    const link = links[i];
    if (!link) return;
    // Keep the label in sync with the url while it's empty or still what the previous url suggested;
    // once the user types their own label, further url edits leave it alone.
    const autoLabel = !link.label.trim() || link.label === suggestedLabel(link.url);
    update(i, { url, label: autoLabel ? suggestedLabel(url) : link.label });
  };

  const remove = (i: number) => onChange(links.filter((_, idx) => idx !== i));

  const moveUp = (i: number) => {
    if (i === 0) return;
    const next = [...links];
    const [item] = next.splice(i, 1);
    if (item) next.splice(i - 1, 0, item);
    onChange(next);
  };

  const add = () => {
    const key = Crypto.randomUUID();
    focusKeyRef.current = key;
    onChange([...links, { key, label: '', url: '' }]);
  };

  return (
    <View style={styles.group}>
      <GroupHeader
        title="Booking links"
        hint="Add your Calendly, Google Calendar or other booking links. People can book time with you from your profile."
      />
      {listError ? (
        <Text variant="caption" color="danger">
          {listError}
        </Text>
      ) : null}

      {links.map((link, i) => {
        const parsed = parseBookingUrl(link.url);
        const rowError = errors[i];
        const last = i === links.length - 1;
        return (
          <Card key={link.key} style={styles.card}>
            <TextField
              ref={(el) => {
                urlRefs.current[link.key] = el;
              }}
              label="Booking link"
              placeholder="calendly.com/you/30min"
              value={link.url}
              onChangeText={(v) => setUrl(i, v)}
              error={rowError?.url}
              keyboardType="url"
              autoCapitalize="none"
              autoCorrect={false}
              spellCheck={false}
              returnKeyType="next"
              submitBehavior="submit"
              onSubmitEditing={() => labelRefs.current[link.key]?.focus()}
              maxLength={BOOKING_URL_MAX}
              editable={editable}
            />
            <TextField
              ref={(el) => {
                labelRefs.current[link.key] = el;
              }}
              label="Label"
              placeholder="e.g. Quick intro chat"
              value={link.label}
              onChangeText={(v) => update(i, { label: v })}
              error={rowError?.label}
              autoCapitalize="sentences"
              returnKeyType={last ? 'done' : 'next'}
              submitBehavior={last ? 'blurAndSubmit' : 'submit'}
              onSubmitEditing={() => (last ? undefined : urlRefs.current[links[i + 1]?.key ?? '']?.focus())}
              maxLength={BOOKING_LABEL_MAX}
              editable={editable}
            />
            {parsed ? (
              <Text variant="caption" color="textTertiary">
                {bookingProviderName(parsed.provider)}
              </Text>
            ) : null}
            <View style={styles.actions}>
              {i > 0 ? (
                <Button
                  title="Move up"
                  icon="arrow-up"
                  variant="ghost"
                  size="sm"
                  fullWidth={false}
                  onPress={() => moveUp(i)}
                  disabled={!editable}
                />
              ) : null}
              <Button
                title="Remove"
                icon="trash-outline"
                variant="ghost"
                size="sm"
                fullWidth={false}
                onPress={() => remove(i)}
                disabled={!editable}
              />
            </View>
          </Card>
        );
      })}

      {links.length < MAX_BOOKING_LINKS ? (
        <Button
          title="Add booking link"
          icon="add"
          variant="secondary"
          size="sm"
          fullWidth={false}
          onPress={add}
          disabled={!editable}
        />
      ) : (
        <Text variant="caption" color="textTertiary">
          You can add up to 5 booking links.
        </Text>
      )}
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
  group: { gap: Spacing.four },
  groupHeader: { gap: Spacing.half, paddingHorizontal: Spacing.one, marginBottom: -Spacing.one },
  groupTitle: { letterSpacing: 0.4 },
  card: { gap: Spacing.three },
  actions: { flexDirection: 'row', gap: Spacing.three },
});
