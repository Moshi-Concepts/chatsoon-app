export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase();
}

/** "Founder at Acme", "Founder", "Acme", or null. */
export function roleLine(role?: string | null, company?: string | null): string | null {
  if (role && company) return `${role} at ${company}`;
  return role || company || null;
}

/** "27 Sep 2026, 2:30 pm" in the device's local time zone, for a scheduled account deletion. */
export function formatScheduledDeletion(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** "27 Sep 2026": the badge card's "since <date>", the claim card's "Claimed on <date>", and a pending
 * referral's "qualifies on <date>" (docs/referrals.md "Referral hub"). */
export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/** "3 Oct" (no year): the contact page's "Followed up on <date>" line. */
export function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/** "due today", "due tomorrow", or "due Mon 3 Oct" for a follow-up due date, in local time. */
export function dueLabel(iso: string): string {
  const due = new Date(iso);
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays = Math.round((startOfDay(due) - startOfDay(new Date())) / 86_400_000);
  if (diffDays <= 0) return 'due today';
  if (diffDays === 1) return 'due tomorrow';
  const weekday = due.toLocaleDateString(undefined, { weekday: 'short' });
  return `due ${weekday} ${shortDate(iso)}`;
}

export function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.round(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}
