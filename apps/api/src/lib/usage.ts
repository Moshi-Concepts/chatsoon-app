import type { Env } from '../env';

// Daily caps on paid calls (Claude card extraction). Checked before the call is made, so a bug,
// a scripted account or a runaway client can never spend more than the caps allow in a day.

/** UTC date, YYYY-MM-DD - the `usage_counters.day` format. Exported for lib/referrals.ts's invite cap. */
export const today = () => new Date().toISOString().slice(0, 10);

/** Adds `amount` to a daily counter and returns the new count. Atomic in D1. Exported for
 * lib/referrals.ts's invite daily cap (`refinvite:user:<id>:<day>`, docs/referrals.md "API"), which
 * needs to reserve more than one at a time (a batch of invites in one request). */
export async function bumpBy(env: Env, key: string, day: string, amount: number): Promise<number> {
  const row = await env.DB.prepare(
    `insert into usage_counters (key, day, count) values (?1, ?2, ?3)
     on conflict (key) do update set count = count + ?3
     returning count`,
  )
    .bind(key, day, amount)
    .first<{ count: number }>();
  return row?.count ?? 0;
}

/** Adds one to a daily counter and returns the new count. */
async function bump(env: Env, key: string, day: string): Promise<number> {
  return bumpBy(env, key, day, 1);
}

const intVar = (value: string | undefined, fallback: number) => {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

export type ExtractBudget = { ok: true } | { ok: false; reason: 'disabled' | 'user_limit' | 'daily_limit' };

/**
 * Reserves one card extraction for today. EXTRACT_ENABLED="false" turns extraction off entirely;
 * EXTRACT_DAILY_PER_USER and EXTRACT_DAILY_TOTAL cap it per account and across everyone (UTC days).
 */
export async function reserveExtraction(env: Env, userId: string): Promise<ExtractBudget> {
  if (env.EXTRACT_ENABLED === 'false') return { ok: false, reason: 'disabled' };
  const day = today();
  if ((await bump(env, `extract:user:${userId}:${day}`, day)) > intVar(env.EXTRACT_DAILY_PER_USER, 30)) {
    return { ok: false, reason: 'user_limit' };
  }
  const total = await bump(env, `extract:all:${day}`, day);
  // First call of the day: sweep yesterday's and older counters.
  if (total === 1) await env.DB.prepare('delete from usage_counters where day < ?1').bind(day).run();
  if (total > intVar(env.EXTRACT_DAILY_TOTAL, 1000)) {
    console.warn(`Card extraction daily cap reached (${total})`);
    return { ok: false, reason: 'daily_limit' };
  }
  return { ok: true };
}

/** Daily cap on new connections per user (issue #3 D12): connecting auto-accepts, so an unchecked
 * throwaway account could otherwise collect numbers at SCAN_LIMITER's per-minute rate all day. */
export const NEW_CONNECTIONS_PER_DAY = 100;

/**
 * Reserves one new connection for `userId` today. True while today's count is still within the
 * cap, false from the 101st on. No sweep here: the extraction sweep above already deletes every
 * key's old rows once a day, this counter included.
 */
export async function reserveNewConnection(env: Env, userId: string): Promise<boolean> {
  const day = today();
  return (await bump(env, `connect:user:${userId}:${day}`, day)) <= NEW_CONNECTIONS_PER_DAY;
}
