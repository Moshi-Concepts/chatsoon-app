import type { Contact, ContactDraft } from '@chatsoon/shared';
import { CAMERA_PERMISSION_TEXT, parseQr } from '@chatsoon/shared';
import { CameraView, PermissionStatus, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { router, Stack, useIsFocused } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AppState, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { resultFeedback, tapFeedback } from '@/components/capture/feedback';
import { CameraIconButton, ScanViewfinder } from '@/components/capture/scan-overlay';
import { CaptureSheet, StatusPanel } from '@/components/capture/status-panel';
import { Avatar, Button, Chip, Text, TextField } from '@/components/ui';
import { Colors, MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { isNetworkError } from '@/lib/api';
import { useCurrentEvent } from '@/lib/current-event';
import { roleLine } from '@/lib/format';
import { openAppSettings } from '@/lib/image';
import { enqueueConnect } from '@/lib/outbox';
import { useEvents, useMe, useScanConnect } from '@/lib/queries';

const HINT = 'Point at a Chatsoon, LinkedIn, Telegram, X or contact QR code';
const isWeb = Platform.OS === 'web';
/** After "Scan again", ignore the code still in front of the camera for this long. */
const RESCAN_GRACE_MS = 2500;

type SheetState =
  | { kind: 'connecting' }
  | { kind: 'connected'; contact: Contact; alreadyConnected: boolean }
  | { kind: 'queued' }
  | { kind: 'own' }
  | { kind: 'error'; message: string }
  | { kind: 'unknown'; raw: string };

function goToNewContact(draft: ContactDraft) {
  router.replace({ pathname: '/contact/new', params: { draft: JSON.stringify(draft), source: 'qr_scan' } });
}

function close() {
  if (router.canGoBack()) router.back();
  else router.replace('/add');
}

export default function ScanScreen() {
  const insets = useSafeAreaInsets();
  const isFocused = useIsFocused();
  const [permission, requestPermission, getPermission] = useCameraPermissions();
  const [cameraAvailable, setCameraAvailable] = useState<boolean | null>(isWeb ? null : true);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [torch, setTorch] = useState(false);
  const [sheet, setSheet] = useState<SheetState | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const busy = useRef(false);
  const lastRaw = useRef<string | null>(null);
  const ignore = useRef<{ raw: string; until: number } | null>(null);

  const { eventId } = useCurrentEvent();
  const events = useEvents();
  const eventName = eventId ? events.data?.find((e) => e.id === eventId)?.name : undefined;
  const me = useMe();
  const scanConnect = useScanConnect();

  useEffect(() => {
    // Browsers without a camera (or on plain http) get the paste-a-link fallback.
    if (!isWeb) return;
    CameraView.isAvailableAsync()
      .then(setCameraAvailable)
      .catch(() => setCameraAvailable(false));
  }, []);

  useEffect(() => {
    // Coming back from Settings: pick up a permission granted there.
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void getPermission();
    });
    return () => sub.remove();
  }, [getPermission]);

  // Ask straight away: the system prompt carries the camera permission text.
  const asked = useRef(false);
  useEffect(() => {
    if (asked.current || cameraAvailable !== true) return;
    if (!permission && !isWeb) return; // native: wait for the status check first
    if (permission && (permission.granted || permission.status === PermissionStatus.DENIED)) return;
    asked.current = true;
    void requestPermission();
  }, [permission, cameraAvailable, requestPermission]);

  const connect = async (slug: string) => {
    if (me.data?.profile?.slug === slug) {
      resultFeedback('warning');
      setSheet({ kind: 'own' });
      return;
    }
    setSheet({ kind: 'connecting' });
    try {
      const { contact, alreadyConnected } = await scanConnect.mutateAsync({ slug, eventId });
      resultFeedback('success');
      setSheet({ kind: 'connected', contact, alreadyConnected });
    } catch (err) {
      if (isNetworkError(err)) {
        await enqueueConnect(slug, eventId);
        resultFeedback('warning');
        setSheet({ kind: 'queued' });
        return;
      }
      resultFeedback('error');
      setSheet({ kind: 'error', message: err instanceof Error ? err.message : 'Please try again.' });
    }
  };

  const handle = (raw: string) => {
    const result = parseQr(raw);
    if (result.kind === 'chatsoon') {
      void connect(result.slug);
    } else if (result.kind === 'contact') {
      goToNewContact(result.draft);
    } else {
      resultFeedback('warning');
      setSheet({ kind: 'unknown', raw: result.raw });
    }
  };

  const onBarcodeScanned = ({ data }: BarcodeScanningResult) => {
    const raw = data?.trim();
    if (busy.current || !raw) return;
    const skip = ignore.current;
    if (skip && skip.raw === raw && Date.now() < skip.until) return;
    busy.current = true;
    lastRaw.current = raw;
    tapFeedback();
    handle(raw);
  };

  const submitLink = (text: string) => {
    const raw = text.trim();
    if (!raw || busy.current) return;
    busy.current = true;
    lastRaw.current = raw;
    setPasteOpen(false);
    handle(raw);
  };

  const scanAgain = () => {
    if (lastRaw.current) ignore.current = { raw: lastRaw.current, until: Date.now() + RESCAN_GRACE_MS };
    busy.current = false;
    setSheet(null);
  };

  const granted = !!permission?.granted;
  const cameraReady = granted && cameraAvailable === true && !cameraError;
  const scanning = cameraReady && isFocused && !sheet && !pasteOpen;

  return (
    // The camera area stays dark whatever the app theme, so there's no light flash before the preview starts.
    <View style={[styles.root, { backgroundColor: Colors.dark.background }]}>
      <Stack.Screen options={{ headerShown: false, title: 'Scan QR code' }} />
      {cameraReady ? <StatusBar style="light" /> : null}

      {cameraReady && isFocused ? (
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={scanning ? onBarcodeScanned : undefined}
          enableTorch={torch && !isWeb}
          onMountError={(e) => setCameraError(e.message || 'The camera could not start.')}
        />
      ) : null}

      {cameraReady ? (
        <ScanViewfinder
          hint={HINT}
          footer={
            <View style={styles.footer}>
              {eventName ? <Chip label={`Tagging ${eventName}`} icon="calendar-outline" /> : null}
              {isWeb && !sheet && !pasteOpen ? (
                <Button
                  title="Paste a link instead"
                  icon="link"
                  variant="secondary"
                  size="md"
                  fullWidth={false}
                  onPress={() => setPasteOpen(true)}
                />
              ) : null}
            </View>
          }
        />
      ) : (
        <NoCamera
          permission={permission}
          cameraAvailable={cameraAvailable}
          cameraError={cameraError}
          onRequest={() => void requestPermission()}
          onRetryCamera={() => setCameraError(null)}
          onSubmitLink={submitLink}
          topInset={insets.top}
          busy={!!sheet}
        />
      )}

      <View style={[styles.topBar, { top: insets.top + Spacing.two }]}>
        <CameraIconButton icon="close" label="Close scanner" onPress={close} />
        {cameraReady && !isWeb ? (
          <CameraIconButton
            icon={torch ? 'flashlight' : 'flashlight-outline'}
            label={torch ? 'Turn off flashlight' : 'Turn on flashlight'}
            active={torch}
            onPress={() => setTorch((v) => !v)}
          />
        ) : null}
      </View>

      {pasteOpen ? (
        <CaptureSheet>
          <PasteLinkForm onSubmit={submitLink} onCancel={() => setPasteOpen(false)} />
        </CaptureSheet>
      ) : null}

      {sheet ? (
        <CaptureSheet key={sheet.kind}>
          <ResultSheet sheet={sheet} onScanAgain={scanAgain} />
        </CaptureSheet>
      ) : null}
    </View>
  );
}

function ResultSheet({ sheet, onScanAgain }: { sheet: SheetState; onScanAgain: () => void }) {
  switch (sheet.kind) {
    case 'connecting':
      return <StatusPanel busy title="Connecting..." message="Swapping cards with them now." />;
    case 'connected': {
      const { contact, alreadyConnected } = sheet;
      const subtitle = roleLine(contact.role, contact.company);
      return (
        <StatusPanel
          visual={<Avatar name={contact.name} size={72} />}
          title={`You're connected with ${contact.name}`}
          message={
            alreadyConnected
              ? 'You were already connected. Their card is up to date.'
              : [subtitle, "You both have each other's card now."].filter(Boolean).join('\n')
          }>
          <Button
            title="View contact"
            icon="person-outline"
            onPress={() => router.replace(`/contact/${contact.id}`)}
          />
          <Button title="Scan another" variant="secondary" icon="scan-outline" onPress={onScanAgain} />
        </StatusPanel>
      );
    }
    case 'queued':
      return (
        <StatusPanel
          icon="cloud-offline-outline"
          tone="warning"
          title="You're offline"
          message="We'll connect you when you're back online.">
          <Button title="Done" onPress={close} />
          <Button title="Scan another" variant="secondary" onPress={onScanAgain} />
        </StatusPanel>
      );
    case 'own':
      return (
        <StatusPanel
          icon="happy-outline"
          tone="primary"
          title="That's your own QR code"
          message="Show it to someone else so they can connect with you.">
          <Button title="Scan again" onPress={onScanAgain} />
        </StatusPanel>
      );
    case 'error':
      return (
        <StatusPanel icon="alert-circle-outline" tone="danger" title="Couldn't connect" message={sheet.message}>
          <Button title="Scan again" onPress={onScanAgain} />
          <Button title="Close" variant="ghost" onPress={close} />
        </StatusPanel>
      );
    case 'unknown':
      return <UnknownCode raw={sheet.raw} onScanAgain={onScanAgain} />;
  }
}

function UnknownCode({ raw, onScanAgain }: { raw: string; onScanAgain: () => void }) {
  const theme = useTheme();
  return (
    <StatusPanel
      icon="help-circle-outline"
      tone="neutral"
      title="Not a contact QR code"
      message="Save what it says as a note on a new contact, or scan another code.">
      <ScrollView
        style={[styles.raw, { backgroundColor: theme.surfaceAlt, borderColor: theme.border }]}
        contentContainerStyle={styles.rawContent}>
        <Text variant="caption" color="textSecondary" selectable>
          {raw}
        </Text>
      </ScrollView>
      <Button title="Save as a note" icon="document-text-outline" onPress={() => goToNewContact({ notes: raw })} />
      <Button title="Scan again" variant="secondary" onPress={onScanAgain} />
    </StatusPanel>
  );
}

function PasteLinkForm({ onSubmit, onCancel }: { onSubmit: (text: string) => void; onCancel?: () => void }) {
  const [text, setText] = useState('');
  return (
    <View style={styles.paste}>
      <View style={styles.pasteText}>
        <Text variant="heading">Paste a link</Text>
        <Text variant="callout" color="textSecondary">
          A Chatsoon profile link, or a LinkedIn, Telegram or X profile.
        </Text>
      </View>
      <TextField
        value={text}
        onChangeText={setText}
        placeholder="https://chatsoon.app/id/..."
        accessibilityLabel="Profile link"
        icon="link"
        autoFocus={!!onCancel}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="off"
        keyboardType="url"
        inputMode="url"
        returnKeyType="go"
        onSubmitEditing={() => onSubmit(text)}
      />
      <Button title="Continue" disabled={!text.trim()} onPress={() => onSubmit(text)} />
      {onCancel ? <Button title="Use the camera" variant="ghost" onPress={onCancel} /> : null}
    </View>
  );
}

/** Shown instead of the camera: asking for permission, permission denied, or no camera at all. */
function NoCamera({
  permission,
  cameraAvailable,
  cameraError,
  onRequest,
  onRetryCamera,
  onSubmitLink,
  topInset,
  busy,
}: {
  permission: ReturnType<typeof useCameraPermissions>[0];
  cameraAvailable: boolean | null;
  cameraError: string | null;
  onRequest: () => void;
  onRetryCamera: () => void;
  onSubmitLink: (text: string) => void;
  topInset: number;
  busy: boolean;
}) {
  const theme = useTheme();

  // Still finding out (native permission check, or web camera detection).
  const checking = (!isWeb && !permission) || (isWeb && cameraAvailable === null);
  // Web can't re-prompt once the browser has blocked the camera; native can until canAskAgain is false.
  const blocked =
    !!permission && permission.status === PermissionStatus.DENIED && (isWeb || !permission.canAskAgain);

  let panel: ReactNode;
  if (checking) {
    panel = <StatusPanel busy title="Starting the camera..." />;
  } else if (cameraError || cameraAvailable === false) {
    panel = (
      <StatusPanel
        icon="videocam-off-outline"
        tone="neutral"
        title={cameraError ? "The camera couldn't start" : 'No camera found'}
        message={isWeb ? 'Paste a profile link instead.' : 'Close any other app using the camera, then try again.'}>
        {cameraError && !isWeb ? <Button title="Try again" icon="refresh" onPress={onRetryCamera} /> : null}
      </StatusPanel>
    );
  } else if (!blocked) {
    panel = (
      <StatusPanel icon="camera-outline" title="Camera access" message={`${CAMERA_PERMISSION_TEXT}.`}>
        <Button title="Continue" icon="camera" onPress={onRequest} />
      </StatusPanel>
    );
  } else {
    panel = (
      <StatusPanel
        icon="camera-outline"
        tone="warning"
        title="Camera access is off"
        message={
          isWeb
            ? `${CAMERA_PERMISSION_TEXT}. Allow camera access in your browser's site settings, or paste a link below.`
            : `${CAMERA_PERMISSION_TEXT}. Turn on camera access for Chatsoon in Settings.`
        }>
        {!isWeb ? <Button title="Open Settings" icon="settings-outline" onPress={() => void openAppSettings()} /> : null}
      </StatusPanel>
    );
  }

  return (
    <ScrollView
      style={[styles.flex, { backgroundColor: theme.background }]}
      contentContainerStyle={[styles.noCamera, { paddingTop: topInset + 72 }]}
      keyboardShouldPersistTaps="handled">
      <View style={styles.noCameraColumn}>
        {panel}
        {isWeb && !checking && !busy ? (
          <View style={[styles.pasteCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <PasteLinkForm onSubmit={onSubmitLink} />
          </View>
        ) : null}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  topBar: {
    position: 'absolute',
    left: Spacing.four,
    right: Spacing.four,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  footer: { alignItems: 'center', gap: Spacing.three },
  raw: { maxHeight: 96, borderRadius: Radius.md, borderWidth: StyleSheet.hairlineWidth },
  rawContent: { padding: Spacing.three },
  paste: { gap: Spacing.four },
  pasteText: { gap: Spacing.one },
  noCamera: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: Spacing.four, paddingBottom: Spacing.six },
  noCameraColumn: { width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center', gap: Spacing.five },
  pasteCard: { padding: Spacing.five, borderRadius: Radius.lg, borderWidth: StyleSheet.hairlineWidth },
});
