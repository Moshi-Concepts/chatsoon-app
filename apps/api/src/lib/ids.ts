export const newId = () => crypto.randomUUID();

/** 4 hex chars for slug suffixes. */
export function shortSuffix(): string {
  const b = crypto.getRandomValues(new Uint8Array(2));
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}
