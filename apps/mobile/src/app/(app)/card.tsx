import { CARD_PLACEHOLDER_NAME } from '@chatsoon/shared';
import * as Crypto from 'expo-crypto';
import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import { HeaderCloseButton } from '@/components/capture/header-close-button';
import { Button, Card, Icon, Screen, Text, type IconName } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useCurrentEvent } from '@/lib/current-event';
import { showError } from '@/lib/dialogs';
import { compressImage, deleteLocalImage, persistImage, pickPhoto, takePhoto } from '@/lib/image';
import { enqueueContact } from '@/lib/outbox';
import { useEvents } from '@/lib/queries';

const TIPS: { icon: IconName; title: string; text: string }[] = [
  { icon: 'scan-outline', title: 'Fill the frame', text: 'Get the whole card in, edge to edge.' },
  { icon: 'sunny-outline', title: 'Avoid glare', text: 'Tilt the card away from bright lights.' },
  { icon: 'cloud-offline-outline', title: 'Works offline', text: "We'll read it when you're back online." },
];

type Source = 'camera' | 'library';

const isWeb = Platform.OS === 'web';

export default function CardCaptureScreen() {
  const { eventId } = useCurrentEvent();
  const events = useEvents();
  const eventName = eventId ? events.data?.find((e) => e.id === eventId)?.name : undefined;
  const [busy, setBusy] = useState<Source | null>(null);

  const capture = async (source: Source) => {
    if (busy) return;
    // Older browsers never report a dismissed file dialog, so on web the buttons only lock once a photo arrives.
    if (!isWeb) setBusy(source);
    try {
      const picked = source === 'camera' ? await takePhoto() : await pickPhoto();
      if (!picked) return;
      setBusy(source);
      const compressed = await compressImage(picked, 1600);
      const saved = await persistImage(compressed);
      // Drop the picker's and the compressor's temporary copies.
      if (picked.uri !== saved.uri) void deleteLocalImage(picked.uri);
      if (compressed.uri !== saved.uri && compressed.uri !== picked.uri) void deleteLocalImage(compressed.uri);

      const id = Crypto.randomUUID();
      await enqueueContact(
        {
          id,
          name: CARD_PLACEHOLDER_NAME,
          source: 'card_photo',
          extractionStatus: 'pending',
          eventId: eventId ?? null,
        },
        { uri: saved.uri, mimeType: saved.mimeType },
      );
      router.replace(`/card-review/${id}`);
    } catch (err) {
      showError(err, "Couldn't save the photo");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Screen
      footer={
        <View style={styles.actions}>
          <Button
            title="Take photo"
            icon="camera"
            loading={busy === 'camera'}
            disabled={!!busy}
            onPress={() => void capture('camera')}
          />
          <Button
            title="Choose photo"
            icon="images-outline"
            variant="secondary"
            loading={busy === 'library'}
            disabled={!!busy}
            onPress={() => void capture('library')}
          />
        </View>
      }>
      <Stack.Screen
        options={{
          // Presented as a full-screen modal: show a header with an explicit close button.
          headerShown: true,
          title: 'Card or badge',
          headerLeft: () => <HeaderCloseButton />,
        }}
      />

      <CardIllustration />

      <View style={styles.intro}>
        <Text variant="title">Photograph a card or badge</Text>
        <Text variant="callout" color="textSecondary">
          We read the name, company and contact details for you. You check everything before it&apos;s saved.
        </Text>
      </View>

      <Card padded={false}>
        {TIPS.map((tip, i) => (
          <Tip key={tip.title} {...tip} divider={i < TIPS.length - 1} />
        ))}
      </Card>

      {eventName ? (
        <View style={styles.event}>
          <Icon name="calendar-outline" size={16} color="textSecondary" />
          <Text variant="caption" color="textSecondary">
            This contact will be tagged with {eventName}.
          </Text>
        </View>
      ) : null}
    </Screen>
  );
}

function Tip({ icon, title, text, divider }: { icon: IconName; title: string; text: string; divider: boolean }) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.tip,
        divider && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.border },
      ]}>
      <View style={[styles.tipIcon, { backgroundColor: theme.primarySoft }]}>
        <Icon name={icon} size={18} color="primary" />
      </View>
      <View style={styles.tipText}>
        <Text variant="bodyStrong">{title}</Text>
        <Text variant="caption" color="textSecondary">
          {text}
        </Text>
      </View>
    </View>
  );
}

/** A card-shaped frame with corner marks, hinting at how to line the card up. */
function CardIllustration() {
  const theme = useTheme();
  const corner = { borderColor: theme.primary };
  return (
    <View
      style={[styles.illustration, { backgroundColor: theme.primarySoft }]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants">
      <View style={[styles.mockCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <View style={[styles.mockAvatar, { backgroundColor: theme.primarySoft }]}>
          <Icon name="person" size={22} color="primary" />
        </View>
        <View style={styles.mockLines}>
          <View style={[styles.mockLine, styles.mockLineWide, { backgroundColor: theme.text }]} />
          <View style={[styles.mockLine, { backgroundColor: theme.textTertiary }]} />
          <View style={[styles.mockLine, styles.mockLineShort, { backgroundColor: theme.border }]} />
        </View>
      </View>
      <View style={[styles.corner, styles.topLeft, corner]} />
      <View style={[styles.corner, styles.topRight, corner]} />
      <View style={[styles.corner, styles.bottomLeft, corner]} />
      <View style={[styles.corner, styles.bottomRight, corner]} />
    </View>
  );
}

const CORNER = 22;

const styles = StyleSheet.create({
  actions: { gap: Spacing.three },
  intro: { gap: Spacing.two },
  event: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingHorizontal: Spacing.one },
  tip: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, padding: Spacing.four },
  tipIcon: { width: 36, height: 36, borderRadius: Radius.sm, alignItems: 'center', justifyContent: 'center' },
  tipText: { flex: 1, gap: 2 },
  illustration: {
    borderRadius: Radius.xl,
    paddingVertical: Spacing.six,
    paddingHorizontal: Spacing.seven,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mockCard: {
    width: '100%',
    maxWidth: 260,
    aspectRatio: 85 / 55,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.four,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    transform: [{ rotate: '-4deg' }],
  },
  mockAvatar: { width: 44, height: 44, borderRadius: Radius.pill, alignItems: 'center', justifyContent: 'center' },
  mockLines: { flex: 1, gap: Spacing.two },
  mockLine: { height: 8, borderRadius: Radius.pill, width: '70%', opacity: 0.8 },
  mockLineWide: { width: '90%', height: 10 },
  mockLineShort: { width: '45%' },
  corner: { position: 'absolute', width: CORNER, height: CORNER },
  topLeft: { top: Spacing.four, left: Spacing.four, borderTopWidth: 3, borderLeftWidth: 3, borderTopLeftRadius: 8 },
  topRight: { top: Spacing.four, right: Spacing.four, borderTopWidth: 3, borderRightWidth: 3, borderTopRightRadius: 8 },
  bottomLeft: {
    bottom: Spacing.four,
    left: Spacing.four,
    borderBottomWidth: 3,
    borderLeftWidth: 3,
    borderBottomLeftRadius: 8,
  },
  bottomRight: {
    bottom: Spacing.four,
    right: Spacing.four,
    borderBottomWidth: 3,
    borderRightWidth: 3,
    borderBottomRightRadius: 8,
  },
});
