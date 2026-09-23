import * as Network from 'expo-network';
import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { CaptureOption } from '@/components/capture/capture-option';
import { CurrentEventPicker } from '@/components/capture/event-picker';
import { Button, Card, Icon, Screen, Text } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { showAlert } from '@/lib/dialogs';
import { useOutbox } from '@/lib/outbox';

export default function AddScreen() {
  return (
    <Screen>
      <View style={styles.intro}>
        <Text variant="title">Who did you meet?</Text>
        <Text variant="callout" color="textSecondary">
          Capture someone in seconds. It works offline too.
        </Text>
      </View>

      <CurrentEventPicker />

      <View style={styles.options}>
        <CaptureOption
          icon="qr-code"
          title="Scan a QR code"
          description="Chatsoon, LinkedIn, Telegram, X or a digital card."
          onPress={() => router.push('/scan')}
        />
        <CaptureOption
          icon="id-card"
          tone="accent"
          title="Photograph a card or badge"
          description="We read the details for you to check."
          onPress={() => router.push('/card')}
        />
        <CaptureOption
          icon="create"
          tone="success"
          title="Type it in"
          description="Only a name is needed. Add the rest later."
          onPress={() => router.push('/contact/new')}
        />
      </View>

      <PendingNotice />
    </Screen>
  );
}

/** Shows how many captures are still waiting to reach the server. */
function PendingNotice() {
  const theme = useTheme();
  const { items, flush } = useOutbox();
  const [syncing, setSyncing] = useState(false);
  if (items.length === 0) return null;

  const failed = items.filter((i) => i.status === 'failed').length;
  const sending = items.some((i) => i.status === 'sending');
  const retrying = items.some((i) => i.status === 'queued' && i.waiting === 'retry');
  const count = items.length;
  const captures = (n: number) => `${n} ${n === 1 ? 'capture' : 'captures'}`;
  const title = failed
    ? `${captures(failed)} ${failed === 1 ? 'needs' : 'need'} attention`
    : sending
      ? `Syncing ${captures(count)}`
      : `${captures(count)} waiting to sync`;
  const message = failed
    ? 'Open Contacts to retry or discard.'
    : sending
      ? 'This usually takes a few seconds.'
      : retrying
        ? "The server is busy. We'll try again shortly."
        : "They'll send automatically when you're back online.";

  const syncNow = async () => {
    setSyncing(true);
    try {
      const network = await Network.getNetworkStateAsync().catch(() => null);
      if (network?.isConnected === false) {
        showAlert("You're offline", "They'll send as soon as you're back online.");
        return;
      }
      await flush();
    } finally {
      setSyncing(false);
    }
  };

  return (
    <Card style={styles.notice}>
      <View style={[styles.noticeIcon, { backgroundColor: failed ? theme.dangerSoft : theme.warningSoft }]}>
        <Icon name={failed ? 'alert-circle' : 'cloud-upload-outline'} size={20} color={failed ? 'danger' : 'warning'} />
      </View>
      <View style={styles.noticeText}>
        <Text variant="bodyStrong">{title}</Text>
        <Text variant="caption" color="textSecondary">
          {message}
        </Text>
      </View>
      {failed ? (
        <Button
          title="View"
          size="sm"
          variant="secondary"
          fullWidth={false}
          onPress={() => router.navigate('/contacts')}
        />
      ) : (
        <Button
          title="Sync now"
          size="sm"
          variant="secondary"
          fullWidth={false}
          loading={syncing || sending}
          onPress={() => void syncNow()}
        />
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  intro: { gap: Spacing.one, paddingTop: Spacing.two },
  options: { gap: Spacing.three },
  notice: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  noticeIcon: { width: 40, height: 40, borderRadius: Radius.sm, alignItems: 'center', justifyContent: 'center' },
  noticeText: { flex: 1, gap: 2 },
});
