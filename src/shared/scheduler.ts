import { GapUnit, MailDoc, ScheduleDoc, ScheduleMode, ScheduleRuleInput, ScheduleSlot } from './types';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function parseRecipientList(raw: string | string[]): string[] {
  const list = Array.isArray(raw) ? raw : raw.split(/[\n,;]+/);
  const seen = new Set<string>();
  const cleaned: string[] = [];
  for (const item of list) {
    const email = item.trim().toLowerCase();
    if (email && !seen.has(email)) {
      seen.add(email);
      cleaned.push(email);
    }
  }
  return cleaned;
}

export function validateEmailAddress(email: string): boolean {
  return EMAIL_RE.test(email.trim());
}

export function gapToMilliseconds(gapValue: number, gapUnit: GapUnit): number {
  if (!Number.isFinite(gapValue) || gapValue < 0) return 0;
  switch (gapUnit) {
    case 'minutes':
      return gapValue * 60 * 1000;
    case 'hours':
      return gapValue * 60 * 60 * 1000;
    case 'days':
      return gapValue * 24 * 60 * 60 * 1000;
  }
}

export interface MaterializedPreview {
  timestampsUtc: string[];
  slots: ScheduleSlot[];
}

export function validateScheduleInput(input: ScheduleRuleInput): string | null {
  if (!input.subject.trim()) return 'Subject is required.';
  if (!input.body.trim()) return 'Email body is required.';
  if (!input.recipients.length) return 'At least one recipient email is required.';
  for (const recipient of input.recipients) {
    if (!validateEmailAddress(recipient)) {
      return `Invalid recipient email address: "${recipient}".`;
    }
  }
  const startDate = new Date(input.startUtc);
  if (Number.isNaN(startDate.getTime())) {
    return 'Start date/time must be a valid timestamp.';
  }
  if (input.mode === 'advanced') {
    if (!Number.isInteger(input.freq) || input.freq < 1 || input.freq > 50) {
      return 'Frequency must be a whole number between 1 and 50.';
    }
    if (!Number.isFinite(input.gapValue) || input.gapValue < 0) {
      return 'Gap value must be 0 or greater.';
    }
    if (input.freq > 1 && input.gapValue <= 0) {
      return 'Gap must be greater than 0 when frequency is more than 1.';
    }
  }
  return null;
}

/**
 * Materializes Schedule(start, freq, gap) into UTC timestamps:
 * - Basic mode: freq = 1, gap = 0 -> [t1]
 * - Advanced mode: [t1, t1 + gap, ..., t1 + (freq - 1) * gap]
 * Expands across n recipients so each (runIndex, recipient) has an independent trackable slot.
 */
export function materializeScheduleTimestamps(
  input: Pick<ScheduleRuleInput, 'mode' | 'startUtc' | 'freq' | 'gapValue' | 'gapUnit' | 'recipients'>,
  idPrefix = 'slot'
): MaterializedPreview {
  const startMs = new Date(input.startUtc).getTime();
  if (Number.isNaN(startMs)) {
    throw new Error('Invalid startUtc timestamp.');
  }

  const effectiveMode: ScheduleMode = input.mode;
  const freq = effectiveMode === 'basic' ? 1 : Math.max(1, Math.min(50, Math.floor(input.freq)));
  const gapMs = effectiveMode === 'basic' ? 0 : gapToMilliseconds(input.gapValue, input.gapUnit);
  const recipients = parseRecipientList(input.recipients);

  const timestampsUtc: string[] = [];
  const slots: ScheduleSlot[] = [];

  for (let i = 0; i < freq; i++) {
    const runIso = new Date(startMs + i * gapMs).toISOString();
    timestampsUtc.push(runIso);
    for (let r = 0; r < recipients.length; r++) {
      slots.push({
        id: `${idPrefix}_${i + 1}_${r + 1}`,
        runIndex: i + 1,
        runAtUtc: runIso,
        recipient: recipients[r],
        status: 'pending',
      });
    }
  }

  return { timestampsUtc, slots };
}

export function cancelPendingSlots(schedule: ScheduleDoc): { updated: ScheduleDoc; cancelledCount: number } {
  let cancelledCount = 0;
  const nowIso = new Date().toISOString();
  const slots = schedule.slots.map((slot) => {
    if (slot.status === 'pending') {
      cancelledCount += 1;
      return { ...slot, status: 'cancelled' as const, cancelledAt: nowIso };
    }
    return slot;
  });

  const hasRemainingPending = slots.some((s) => s.status === 'pending' || s.status === 'processing');

  return {
    cancelledCount,
    updated: {
      ...schedule,
      status: hasRemainingPending ? 'active' : 'cancelled',
      cancelledReason: cancelledCount > 0 ? 'Manually cancelled pending slots' : schedule.cancelledReason,
      slots,
      updatedAt: nowIso,
    },
  };
}

export interface StopOnReplyResult {
  matchedSchedulesCount: number;
  cancelledSlotsCount: number;
  impactedScheduleIds: string[];
  impactedRecipients: string[];
}

/**
 * Matches an incoming mail against active stopOnReply schedules by threadId/inReplyTo
 * OR sender email matching schedule recipients, atomically cancelling remaining pending
 * slots for that recipient (or whole schedule when n == 1 or thread matches single sender).
 */
export function applyStopOnReplyToSchedules(
  schedules: ScheduleDoc[],
  incomingMail: Pick<MailDoc, 'id' | 'threadId' | 'inReplyTo' | 'fromEmail' | 'folder'>,
  nowIso = new Date().toISOString()
): StopOnReplyResult {
  if (incomingMail.folder !== 'inbox') {
    return {
      matchedSchedulesCount: 0,
      cancelledSlotsCount: 0,
      impactedScheduleIds: [],
      impactedRecipients: [],
    };
  }

  const senderEmail = incomingMail.fromEmail.trim().toLowerCase();
  const impactedScheduleIds: string[] = [];
  const impactedRecipients = new Set<string>();
  let cancelledSlotsCount = 0;

  for (const schedule of schedules) {
    const isStopOnReply = schedule.stopOnReply ?? schedule.freq > 1;
    const isActive = (schedule.status ?? 'active') === 'active';
    if (!isStopOnReply || !isActive) continue;

    const threadMatched =
      Boolean(schedule.threadId) &&
      (incomingMail.threadId === schedule.threadId || incomingMail.inReplyTo === schedule.threadId);

    const recipientMatched = schedule.recipients.some((r) => r.trim().toLowerCase() === senderEmail);
    if (!threadMatched && !recipientMatched) continue;

    const cancelAllRecipients = schedule.recipients.length <= 1 || (threadMatched && !recipientMatched);
    let scheduleCancelledSlots = 0;

    for (const slot of schedule.slots) {
      if (slot.status !== 'pending') continue;
      const slotRecipient = slot.recipient.trim().toLowerCase();
      if (cancelAllRecipients || slotRecipient === senderEmail) {
        slot.status = 'cancelled_replied';
        slot.cancelledAt = nowIso;
        slot.replyMailId = incomingMail.id;
        scheduleCancelledSlots += 1;
        cancelledSlotsCount += 1;
        impactedRecipients.add(slotRecipient);
      }
    }

    if (scheduleCancelledSlots > 0) {
      impactedScheduleIds.push(schedule.id);
      const anyPendingLeft = schedule.slots.some(
        (s) => s.status === 'pending' || s.status === 'processing'
      );
      schedule.status = anyPendingLeft ? 'active' : 'cancelled';
      schedule.cancelledReason = anyPendingLeft
        ? `Partial stop-on-reply: ${senderEmail} replied`
        : `Stopped automatically: ${senderEmail} replied`;
      schedule.updatedAt = nowIso;
    }
  }

  return {
    matchedSchedulesCount: impactedScheduleIds.length,
    cancelledSlotsCount,
    impactedScheduleIds,
    impactedRecipients: Array.from(impactedRecipients),
  };
}

export function formatUtcTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
}

export function formatLocalTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
