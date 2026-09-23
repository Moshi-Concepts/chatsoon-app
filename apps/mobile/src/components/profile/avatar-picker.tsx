import { useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, View } from 'react-native';

import { Avatar, Button, Icon } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { api } from '@/lib/api';
import { showError } from '@/lib/dialogs';
import { compressImage, pickPhoto, type LocalImage } from '@/lib/image';

/** The profile photo: the R2 key to save and a URL to show. */
export type AvatarValue = { key: string | null; url: string | null };

/** Avatars are shown small, so 512px keeps uploads light without looking soft. */
const AVATAR_MAX_SIZE = 512;

export type AvatarPickerProps = {
  /** Used for the initials fallback. */
  name: string;
  value: AvatarValue;
  onChange: (value: AvatarValue) => void;
  /** Lets the form disable saving while a photo uploads. */
  onUploadingChange?: (uploading: boolean) => void;
  size?: number;
  disabled?: boolean;
};

/**
 * Profile photo with choose / remove actions. Only the system photo picker (no permission needed):
 * the camera's purpose string covers QR codes and business cards, not profile photos. A new photo
 * is resized and uploaded straight away (POST /files?purpose=avatar); the form saves the returned
 * key with the profile.
 */
export function AvatarPicker({
  name,
  value,
  onChange,
  onUploadingChange,
  size = 104,
  disabled,
}: AvatarPickerProps) {
  const theme = useTheme();
  // Local copy of the photo just picked, so it shows instantly instead of waiting for the signed URL.
  const [preview, setPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const busy = uploading || !!disabled;

  const setBusy = (next: boolean) => {
    setUploading(next);
    onUploadingChange?.(next);
  };

  const upload = async (picked: LocalImage | null) => {
    if (!picked) return;
    setBusy(true);
    try {
      const image = await compressImage(picked, AVATAR_MAX_SIZE);
      setPreview(image.uri);
      const res = await api.files.upload({ uri: image.uri, mimeType: image.mimeType }, 'avatar');
      onChange({ key: res.key, url: res.url });
    } catch (err) {
      setPreview(null);
      showError(err, "Couldn't upload your photo");
    }
    setBusy(false);
  };

  const choose = () => {
    if (busy) return;
    void pickPhoto({ square: true }).then(upload, (err) => showError(err, "Couldn't open your photos"));
  };
  const remove = () => {
    setPreview(null);
    onChange({ key: null, url: null });
  };

  const uri = preview ?? value.url;
  const hasPhoto = !!(value.key || uri);
  const isWeb = Platform.OS === 'web';

  return (
    <View style={styles.wrap}>
      <Pressable
        onPress={choose}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel={hasPhoto ? 'Change profile photo' : 'Add profile photo'}
        accessibilityState={{ disabled: busy, busy: uploading }}
        style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}>
        <Avatar name={name.trim() || '?'} uri={uri} size={size} />
        {uploading ? (
          <View style={[styles.overlay, { borderRadius: size / 2, backgroundColor: theme.overlay }]}>
            <ActivityIndicator color={theme.onPrimary} />
          </View>
        ) : null}
        <View style={[styles.badge, { backgroundColor: theme.primary, borderColor: theme.background }]}>
          <Icon name="pencil" size={14} color="onPrimary" />
        </View>
      </Pressable>

      <View style={styles.actions}>
        <Button
          title={isWeb ? (hasPhoto ? 'Upload new photo' : 'Upload photo') : hasPhoto ? 'Change photo' : 'Choose photo'}
          icon="image-outline"
          variant="secondary"
          size="sm"
          fullWidth={false}
          onPress={choose}
          disabled={busy}
        />
      </View>
      {hasPhoto ? (
        <Button
          title="Remove photo"
          variant="ghost"
          size="sm"
          fullWidth={false}
          onPress={remove}
          disabled={busy}
          style={styles.remove}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: Spacing.three },
  overlay: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  badge: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: Spacing.two },
  // Leaves 8pt to the button above, so their 4pt hit slops don't overlap.
  remove: { alignSelf: 'center', marginTop: -Spacing.one },
});
