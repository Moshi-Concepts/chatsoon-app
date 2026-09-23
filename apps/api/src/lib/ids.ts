export const newId = () => crypto.randomUUID();

/**
 * 8 hex chars for slug suffixes. Long enough that a profile can't be found by trying every suffix
 * after a known name. Older 4 char slugs keep working: lookups are by exact slug.
 */
export function shortSuffix(): string {
  const b = crypto.getRandomValues(new Uint8Array(4));
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}
