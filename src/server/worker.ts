import { loadDb, saveDb } from './store';
import { dispatchEmail } from './mailer';

let isTickRunning = false;
let workerTimer: NodeJS.Timeout | null = null;

/**
 * Simulates MongoDB TTL index (`expireAfterSeconds: 0` on `otp_vault.expiresAt`)
 * by purging expired OTP vault documents automatically.
 */
export async function purgeExpiredOtpVaultEntries(): Promise<number> {
  const db = loadDb();
  const nowMs = Date.now();
  const before = db.otp_vault.length;
  db.otp_vault = db.otp_vault.filter((entry) => new Date(entry.expiresAt).getTime() > nowMs);
  const removed = before - db.otp_vault.length;
  if (removed > 0) {
    await saveDb();
  }
  return removed;
}

/**
 * Polls schedules for due pending slots (runAtUtc <= now), claims them atomically
 * (pending -> processing) before dispatching, then updates slot status to sent or failed.
 */
export async function processDueScheduleSlots(): Promise<{ processed: number; sent: number; failed: number }> {
  if (isTickRunning) {
    return { processed: 0, sent: 0, failed: 0 };
  }
  isTickRunning = true;
  let processed = 0;
  let sent = 0;
  let failed = 0;

  try {
    await purgeExpiredOtpVaultEntries();
    const db = loadDb();
    const nowMs = Date.now();
    const claimed: Array<{ scheduleId: string; slotId: string; userId: string }> = [];

    // Phase 1: Atomic claim (pending -> processing)
    for (const schedule of db.schedules) {
      for (const slot of schedule.slots) {
        if (slot.status === 'pending' && new Date(slot.runAtUtc).getTime() <= nowMs) {
          slot.status = 'processing';
          schedule.updatedAt = new Date().toISOString();
          claimed.push({
            scheduleId: schedule.id,
            slotId: slot.id,
            userId: schedule.userId,
          });
        }
      }
    }

    if (claimed.length === 0) {
      return { processed: 0, sent: 0, failed: 0 };
    }

    await saveDb();

    // Phase 2: Dispatch each claimed slot
    for (const item of claimed) {
      const schedule = db.schedules.find((s) => s.id === item.scheduleId);
      const slot = schedule?.slots.find((sl) => sl.id === item.slotId);
      const user = db.users.find((u) => u.id === item.userId);
      if (!schedule || !slot || !user) continue;

      processed += 1;
      try {
        await dispatchEmail({
          userId: user.id,
          fromName: user.name,
          fromEmail: user.email,
          to: [slot.recipient],
          subject: schedule.subject,
          textBody: schedule.body,
          threadId: schedule.threadId,
        });
        slot.status = 'sent';
        slot.sentAtUtc = new Date().toISOString();
        delete slot.error;
        schedule.updatedAt = new Date().toISOString();
        if (
          schedule.status === 'active' &&
          !schedule.slots.some((sl) => sl.status === 'pending' || sl.status === 'processing')
        ) {
          schedule.status = 'completed';
        }
        sent += 1;
      } catch (err) {
        slot.status = 'failed';
        slot.error = err instanceof Error ? err.message : 'Delivery error';
        schedule.updatedAt = new Date().toISOString();
        if (
          schedule.status === 'active' &&
          !schedule.slots.some((sl) => sl.status === 'pending' || sl.status === 'processing')
        ) {
          schedule.status = 'completed';
        }
        failed += 1;
      }
    }

    await saveDb();
    return { processed, sent, failed };
  } finally {
    isTickRunning = false;
  }
}

export function startScheduleWorker(intervalMs = 5000): void {
  if (workerTimer) return;
  workerTimer = setInterval(() => {
    void processDueScheduleSlots();
  }, intervalMs);
  workerTimer.unref();
}
