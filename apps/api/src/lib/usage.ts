import type { Env } from '../env';

// Daily caps on paid calls (Claude card extraction). Checked before the call is made, so a bug,
// a scripted account or a runaway client can never spend more than the caps allow in a day.

const today = () => new Date().toISOString().slice(0, 10);

/** Adds one to a daily counter and returns the new count. Atomic in D1. */
async function bump(env: Env, key: string, day: string): Promise<number> {
  const row = await env.DB.prepare(
    `insert into usage_counters (key, day, count) values (?1, ?2, 1)
     on conflict (key) do update set count = count + 1
     returning count`,
  )
    .bind(key, day)
    .first<{ count: number }>();
  return row?.count ?? 0;
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
