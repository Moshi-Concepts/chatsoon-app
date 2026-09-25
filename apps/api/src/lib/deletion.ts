import { eq, lte } from 'drizzle-orm';

import { accountDeletions } from '../db/schema';
import type { Env } from '../env';
import { deleteUserData } from './account';
import { getDb, type DB } from './db';
import { accountDeletedEmail, scheduledDeletionEmail, sendEmail } from './email';

// Delayed account deletion (issue #8). POST /me/deletion schedules it (DELETION_GRACE_MS from now,
// unless the reviewer account, which is deleted immediately); DELETE /me/deletion or the emailed
// token link cancels it; the wrangler.jsonc cron trigger runs runDueDeletions, which finishes the
// job for whatever is due. DELETE /me stays a separate, immediate path (routes/account.ts) for the
// 1.0 native app.

export const DELETION_GRACE_MS = 24 * 60 * 60 * 1000;

/** Rows handled per scheduled run. Generous for how few accounts are expected to churn through this. */
const DUE_DELETIONS_LIMIT = 25;

/** The one piece of `ExecutionContext` this needs, spelled out locally like pages.ts's WaitUntilCtx. */
export interface WaitUntilCtx {
  waitUntil(promise: Promise<unknown>): void;
}

const enc = new TextEncoder();

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(value));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** A random 32 byte token (base64url, ~43 chars) plus the SHA-256 hex of it. Only the hash is stored. */
async function generateCancelToken(): Promise<{ token: string; hash: string }> {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const token = base64UrlEncode(bytes);
  return { token, hash: await sha256Hex(token) };
}

/** "peter@example.com" -> "p***@example.com". Never reveals the rest of the local part. */
export function maskEmail(email: string): string {
  const at = email.indexOf('@');
  if (at <= 0) return email;
  return `${email[0]}***${email.slice(at)}`;
}

export interface ScheduleResult {
  deleteAfter: Date;
}

/**
 * Schedules `userId` for deletion `DELETION_GRACE_MS` from now, unless one is already pending —
 * idempotent: a second call returns the existing schedule unchanged and sends no second email.
 * The "scheduled" email is sent through `ctx.waitUntil` only by whichever call actually creates the
 * row, logging (never throwing) on a send failure.
 */
export async function scheduleAccountDeletion(
  env: Env,
  db: DB,
  ctx: WaitUntilCtx,
  userId: string,
  email: string,
): Promise<ScheduleResult> {
  const deleteAfter = new Date(Date.now() + DELETION_GRACE_MS);
  const { token, hash } = await generateCancelToken();

  const [inserted] = await db
    .insert(accountDeletions)
    .values({ userId, email, deleteAfter, cancelTokenHash: hash })
    .onConflictDoNothing()
    .returning();

  if (inserted) {
    const cancelUrl = `${env.WEB_ORIGIN}/cancel-deletion?token=${token}`;
    const msg = scheduledDeletionEmail(inserted.deleteAfter, cancelUrl);
    ctx.waitUntil(
      sendEmail(env, { to: email, subject: msg.subject, text: msg.text, html: msg.html }).catch((err) =>
        console.error('Scheduled deletion email failed', err),
      ),
    );
    return { deleteAfter: inserted.deleteAfter };
  }

  // Someone else's request (or an earlier one from this user) already created it: don't extend it,
  // don't resend the email, just report what's already scheduled.
  const [existing] = await db.select().from(accountDeletions).where(eq(accountDeletions.userId, userId)).limit(1);
  if (!existing) {
    // Cancelled between the failed insert and this select. Practically impossible in one request,
    // but scheduling again is the only sane thing to do rather than pretending it's still pending.
    return scheduleAccountDeletion(env, db, ctx, userId, email);
  }
  return { deleteAfter: existing.deleteAfter };
}

/** The pending deletion's `delete_after`, or null when none is pending. For GET /me. */
export async function pendingDeletionFor(db: DB, userId: string): Promise<Date | null> {
  const [row] = await db
    .select({ deleteAfter: accountDeletions.deleteAfter })
    .from(accountDeletions)
    .where(eq(accountDeletions.userId, userId))
    .limit(1);
  return row?.deleteAfter ?? null;
}

/** Cancels a pending deletion (DELETE /me/deletion). Returns whether one was actually pending. */
export async function cancelAccountDeletion(db: DB, userId: string): Promise<boolean> {
  const [row] = await db.delete(accountDeletions).where(eq(accountDeletions.userId, userId)).returning();
  return !!row;
}

/**
 * Cancels by the token from the "scheduled" email's link (POST /account-deletion/cancel, no auth).
 * Returns the account's (unmasked) email, or null for a token that's unknown, already used, or was
 * never issued.
 */
export async function cancelAccountDeletionByToken(db: DB, token: string): Promise<string | null> {
  const hash = await sha256Hex(token);
  const [row] = await db.delete(accountDeletions).where(eq(accountDeletions.cancelTokenHash, hash)).returning();
  return row?.email ?? null;
}

/**
 * The scheduled job (wrangler.jsonc `triggers.crons`, wired up in index.ts's `scheduled` export):
 * finishes every deletion whose grace period has passed. Each row runs in its own try/catch so one
 * failure never stops the rest of the batch.
 */
export async function runDueDeletions(env: Env, now: number): Promise<{ processed: number; failed: number }> {
  const db = getDb(env);
  const due = await db
    .select()
    .from(accountDeletions)
    .where(lte(accountDeletions.deleteAfter, new Date(now)))
    .limit(DUE_DELETIONS_LIMIT);

  let processed = 0;
  let failed = 0;
  for (const row of due) {
    try {
      await deleteUserData(env, db, row.userId, row.email);

      // deleteUserData's own batch already removes this row (its user_id references users.id), but
      // that's relied on nowhere else in this codebase (see deleteUserData's own comment on FK
      // cascades), so verify rather than trust it, and clean up explicitly if it's somehow still there.
      const [leftover] = await db
        .select({ userId: accountDeletions.userId })
        .from(accountDeletions)
        .where(eq(accountDeletions.userId, row.userId))
        .limit(1);
      if (leftover) await db.delete(accountDeletions).where(eq(accountDeletions.userId, row.userId));

      const msg = accountDeletedEmail();
      await sendEmail(env, { to: row.email, subject: msg.subject, text: msg.text, html: msg.html }).catch((err) =>
        console.error(`Final deletion email to ${row.email} failed`, err),
      );
      processed++;
    } catch (err) {
      failed++;
      console.error(`runDueDeletions: failed to delete account ${row.userId}`, err);
    }
  }
  return { processed, failed };
}
