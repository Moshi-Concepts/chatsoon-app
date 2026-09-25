// Turns raw image bytes into a `data:` URI satori can use as an `<img src>`, for the two images the
// card ever embeds: the caller's `OgAvatar` (already vetted by the API's avatar guard before the RPC
// call — content type, magic bytes, size and dimensions, docs/og-plan.md §2.2) and the static plate
// (render.ts, built once per isolate). Also the shared `OgAvatar` re-export, so card.ts and render.ts
// don't each pick their own import path for it.

export type { OgAvatar } from '@chatsoon/shared/src/og';
import type { OgAvatar } from '@chatsoon/shared/src/og';

const BASE64_CHUNK = 0x8000; // btoa builds one JS string; chunk so a ~1MB avatar can't overflow the call stack.

/** Base64-encodes raw bytes without ever materialising one giant `String.fromCharCode(...)` call. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += BASE64_CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + BASE64_CHUNK));
  }
  return btoa(binary);
}

/** `data:image/jpeg;base64,...` or `data:image/png;base64,...`, ready for satori's `<img src>`. */
export function avatarDataUri(avatar: OgAvatar): string {
  return `data:${avatar.type};base64,${bytesToBase64(avatar.bytes)}`;
}

/** Same conversion for a plain buffer of a known type (render.ts uses this for the plate JPEG). */
export function bufferToDataUri(bytes: ArrayBuffer, type: string): string {
  return `data:${type};base64,${bytesToBase64(new Uint8Array(bytes))}`;
}
