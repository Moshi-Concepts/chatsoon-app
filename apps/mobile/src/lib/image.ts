import { CAMERA_PERMISSION_TEXT } from '@chatsoon/shared';
import * as Crypto from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import * as Linking from 'expo-linking';
import { Platform } from 'react-native';

import { confirm, showAlert, showError } from './dialogs';

// Camera and photo helpers. Never request photo-library permission: use the system picker
// (PHPicker on iOS, Photo Picker on Android) which needs none. On web the camera option is a
// file input with capture, which opens the phone camera.

export type LocalImage = {
  uri: string;
  mimeType: string;
  width: number;
  height: number;
};

/** Folder in the document directory that holds photos waiting in the outbox. */
const PHOTO_DIR = 'chatsoon-photos';
const isWeb = Platform.OS === 'web';

function toLocalImage(asset: ImagePicker.ImagePickerAsset): LocalImage {
  return {
    uri: asset.uri,
    mimeType: asset.mimeType || 'image/jpeg',
    width: asset.width || 0,
    height: asset.height || 0,
  };
}

/** Explains why the camera is needed and, when the system won't ask again, offers Settings. */
export async function explainCameraDenied(canAskAgain: boolean): Promise<void> {
  const title = 'Camera access is off';
  if (canAskAgain) {
    showAlert(title, `${CAMERA_PERMISSION_TEXT}. Try again to allow access, or choose a photo instead.`);
    return;
  }
  const open = await confirm({
    title,
    message: `${CAMERA_PERMISSION_TEXT}. Turn on camera access for Chatsoon in Settings, or choose a photo instead.`,
    confirmText: 'Open Settings',
    cancelText: 'Not now',
  });
  if (open) await openAppSettings();
}

/** Opens this app's page in the system Settings (no-op on web). */
export async function openAppSettings(): Promise<void> {
  if (isWeb) return;
  try {
    await Linking.openSettings();
  } catch {
    showAlert('Open Settings', 'Open Settings on your device and allow camera access for Chatsoon.');
  }
}

/** Opens the camera. Returns null if the user cancels or denies permission (after explaining). */
export async function takePhoto(opts?: { square?: boolean }): Promise<LocalImage | null> {
  if (!isWeb) {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      await explainCameraDenied(permission.canAskAgain);
      return null;
    }
  }
  try {
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      cameraType: ImagePicker.CameraType.back,
      allowsEditing: !!opts?.square,
      aspect: opts?.square ? [1, 1] : undefined,
      quality: 0.9,
      exif: false,
    });
    const asset = result.canceled ? undefined : result.assets[0];
    return asset ? toLocalImage(asset) : null;
  } catch (err) {
    // Simulators and some web browsers have no camera.
    showError(err, 'Camera unavailable');
    return null;
  }
}

/** Opens the system photo picker (no permission needed). Returns null on cancel. */
export async function pickPhoto(opts?: { square?: boolean }): Promise<LocalImage | null> {
  try {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: !!opts?.square,
      aspect: opts?.square ? [1, 1] : undefined,
      quality: 0.9,
      exif: false,
    });
    const asset = result.canceled ? undefined : result.assets[0];
    return asset ? toLocalImage(asset) : null;
  } catch (err) {
    showError(err, "Couldn't open your photos");
    return null;
  }
}

/** Resizes so the longest side is at most `maxSize` and re-encodes as JPEG. */
export async function compressImage(image: LocalImage, maxSize = 1600, quality = 0.8): Promise<LocalImage> {
  const context = ImageManipulator.manipulate(image.uri);
  try {
    let { width, height } = image;
    if (!width || !height) {
      // The picker could not tell us the size: render once to find out.
      const probe = await context.renderAsync();
      width = probe.width;
      height = probe.height;
      probe.release();
    }
    if (Math.max(width, height) > maxSize) {
      context.resize(width >= height ? { width: maxSize } : { height: maxSize });
    }
    const rendered = await context.renderAsync();
    try {
      // On web ask for base64 so the result can be a data: URL that survives a reload.
      const saved = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: quality, base64: isWeb });
      let uri = saved.uri;
      if (isWeb && saved.base64) {
        if (uri.startsWith('blob:')) URL.revokeObjectURL(uri);
        uri = `data:image/jpeg;base64,${saved.base64}`;
      }
      return { uri, mimeType: 'image/jpeg', width: saved.width, height: saved.height };
    } finally {
      rendered.release();
    }
  } finally {
    context.release();
  }
}

function extensionFor(mimeType: string): string {
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/webp') return 'webp';
  if (mimeType === 'image/heic') return 'heic';
  return 'jpg';
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Couldn't read the photo"));
    reader.readAsDataURL(blob);
  });
}

/** Copies an image into app storage so it survives restarts (native). Returns the new uri. */
export async function persistImage(image: LocalImage): Promise<LocalImage> {
  if (isWeb) {
    // blob: URLs die with the tab, so keep the bytes inline (AsyncStorage is localStorage on web).
    if (image.uri.startsWith('data:')) return image;
    const blob = await (await fetch(image.uri)).blob();
    return { ...image, uri: await blobToDataUrl(blob) };
  }
  const dir = new Directory(Paths.document, PHOTO_DIR);
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  const dest = new File(dir, `${Crypto.randomUUID()}.${extensionFor(image.mimeType)}`);
  await new File(image.uri).copy(dest);
  return { ...image, uri: dest.uri };
}

/**
 * Current location of a persisted image. iOS can move the app container between launches
 * (app updates, restores), so photos in our folder are looked up by file name.
 */
export function resolveLocalImageUri(uri: string): string {
  if (isWeb || !uri.startsWith('file:')) return uri;
  const marker = `/${PHOTO_DIR}/`;
  const at = uri.lastIndexOf(marker);
  if (at === -1) return uri;
  return new File(Paths.document, PHOTO_DIR, uri.slice(at + marker.length)).uri;
}

/** True when a local image can still be read (always true for data: and remote URLs). */
export function localImageExists(uri: string): boolean {
  if (isWeb || !uri.startsWith('file:')) return true;
  try {
    return new File(resolveLocalImageUri(uri)).exists;
  } catch {
    return false;
  }
}

/** Deletes a persisted local image. Ignores missing files. */
export async function deleteLocalImage(uri: string): Promise<void> {
  if (isWeb) {
    if (uri.startsWith('blob:')) URL.revokeObjectURL(uri);
    return;
  }
  if (!uri.startsWith('file:')) return;
  try {
    const file = new File(resolveLocalImageUri(uri));
    if (file.exists) file.delete();
  } catch {
    // Already gone or not ours to delete.
  }
}

/** Deletes every persisted photo (sign out / account deletion). */
export async function deleteAllLocalImages(): Promise<void> {
  if (isWeb) return;
  try {
    const dir = new Directory(Paths.document, PHOTO_DIR);
    if (dir.exists) dir.delete();
  } catch {
    // Nothing to clean up.
  }
}
