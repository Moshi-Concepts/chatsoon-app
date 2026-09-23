import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

import { api } from './api';

/** Cache folder for exported files, so they can be removed in one go on sign out. */
const EXPORT_DIR = 'chatsoon-exports';
const CSV_MIME = 'text/csv';
const CSV_UTI = 'public.comma-separated-values-text';
/** Byte order mark so Excel opens UTF-8 names (e.g. "Péter Bùi") correctly. */
const BOM = '﻿';

/** chatsoon-contacts-2026-09-24.csv, using the device's local date. */
export function exportFileName(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `chatsoon-contacts-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.csv`;
}

/**
 * Downloads all of my contacts as CSV (GET /me/export.csv) and hands the file to the user:
 * the share sheet on iOS and Android (Save to Files, Mail, Drive...), a download on web.
 * Throws with a readable message on failure.
 */
export async function exportContactsCsv(): Promise<void> {
  const csv = await api.me.exportCsv();
  const text = csv.startsWith(BOM) ? csv : BOM + csv;
  const name = exportFileName();

  if (Platform.OS === 'web') {
    downloadOnWeb(text, name);
    return;
  }

  if (!(await Sharing.isAvailableAsync())) {
    throw new Error('Sharing is not available on this device.');
  }
  const dir = new Directory(Paths.cache, EXPORT_DIR);
  dir.create({ intermediates: true, idempotent: true });
  const file = new File(dir, name);
  file.create({ overwrite: true });
  file.write(text);
  await Sharing.shareAsync(file.uri, { mimeType: CSV_MIME, UTI: CSV_UTI, dialogTitle: 'Export contacts' });
}

/**
 * Deletes exported CSVs from the app's cache, so nobody's contacts stay on the device after
 * sign out or account deletion. Never throws. No-op on web, where the file is a download.
 */
export function deleteExportedFiles(): void {
  if (Platform.OS === 'web') return;
  try {
    const dir = new Directory(Paths.cache, EXPORT_DIR);
    if (dir.exists) dir.delete();
  } catch {
    // Nothing to clean up.
  }
}

function downloadOnWeb(text: string, name: string) {
  const url = URL.createObjectURL(new Blob([text], { type: `${CSV_MIME};charset=utf-8` }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.rel = 'noopener';
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Give the browser a moment to start the download before releasing the blob.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
