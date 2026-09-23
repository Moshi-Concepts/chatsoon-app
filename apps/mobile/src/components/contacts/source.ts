import type { ContactSource, ExtractionStatus } from '@chatsoon/shared';

import type { IconName } from '@/components/ui';

const SOURCES: Record<ContactSource, { label: string; icon: IconName }> = {
  manual: { label: 'Added manually', icon: 'create-outline' },
  app_connect: { label: 'Connected in the app', icon: 'qr-code-outline' },
  qr_scan: { label: 'Scanned QR code', icon: 'qr-code-outline' },
  card_photo: { label: 'Business card', icon: 'card-outline' },
  web_connect: { label: 'Connected on the web', icon: 'globe-outline' },
};

export function sourceLabel(source: ContactSource): string {
  return SOURCES[source]?.label ?? SOURCES.manual.label;
}

export function sourceIcon(source: ContactSource): IconName {
  return SOURCES[source]?.icon ?? SOURCES.manual.icon;
}

/** The small icon in a list row. Manual contacts get none, so the list stays quiet. */
export function rowSourceIcon(source: ContactSource): IconName | null {
  return source === 'manual' ? null : sourceIcon(source);
}

/** The card extraction ran and the user still has to check (or fill in) the fields. */
export function needsReview(status: ExtractionStatus): boolean {
  return status === 'needs_review' || status === 'failed';
}

/** The card photo is uploaded or queued and the fields are not read yet. */
export function isReadingCard(status: ExtractionStatus): boolean {
  return status === 'pending' || status === 'processing';
}

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}
