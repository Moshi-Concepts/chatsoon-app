/** 'Péter Bùi!' -> 'peter-bui'. ASCII only, max 40 chars, falls back to 'user'. */
export function slugBase(displayName: string): string {
  const base = displayName
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  return base || 'user';
}

/** makeSlug('Peter Bui', '7f3a') -> 'peter-bui-7f3a' */
export function makeSlug(displayName: string, suffix: string): string {
  return `${slugBase(displayName)}-${suffix}`;
}

export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isValidSlug(slug: string): boolean {
  return slug.length > 0 && slug.length <= 100 && SLUG_PATTERN.test(slug);
}
