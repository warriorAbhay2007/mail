import { MailDoc, SuggestedAction } from './types';
import { detectOtpFast } from './categorizer';

const AUTOMATED_SENDER_RE =
  /^(no-?reply|noreply|notifications|updates|receipts|billing|verify|auth|mailer-daemon)@/i;

const REPLY_INTENT_RE =
  /\?|(\b(?:please|can we|could you|would you|ready whenever|let me know|confirm|approve|green light|review|feedback|reply|sync|meet|call|chat|check in|thoughts)\b)/i;

const MEETING_INTENT_RE = /\b(?:meet|meeting|sync|call|calendar|slot|time|tuesday|wednesday|thursday|friday|monday)\b/i;

const DATE_EXTRACTION_PATTERNS: Array<{ re: RegExp; extract: (m: RegExpMatchArray) => string }> = [
  {
    re: /\b(\d{4}-\d{2}-\d{2}(?:\s+(?:at\s+)?\d{1,2}:\d{2}(?:\s*utc)?)?)\b/i,
    extract: (m) => m[1],
  },
  {
    re: /\b((?:this\s+|next\s+)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)(?:\s+(?:morning|afternoon|evening))?(?:\s+at\s+\d{1,2}:\d{2})?(?:\s*utc)?)\b/i,
    extract: (m) => m[1],
  },
  {
    re: /\b((?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2}(?:,\s*\d{4})?(?:\s+at\s+\d{1,2}:\d{2}(?:\s*utc)?)?)\b/i,
    extract: (m) => m[1],
  },
  {
    re: /\b(tomorrow(?:\s+(?:morning|afternoon|evening))?(?:\s+at\s+\d{1,2}:\d{2}(?:\s*utc)?)?)\b/i,
    extract: (m) => m[1],
  },
  {
    re: /\b(?:deadline|due(?:\s+by)?|by\s+end\s+of\s+(?:day|week)|eod|eow|next\s+week)\b/i,
    extract: (m) => m[0],
  },
];

const MONTH_MAP: Record<string, number> = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};

function applyTimeHintUtc(target: Date, label: string): void {
  const lower = label.toLowerCase();
  const timeMatch = /(\d{1,2}):(\d{2})/.exec(lower);
  if (timeMatch) {
    const h = Math.min(23, Math.max(0, Number(timeMatch[1])));
    const m = Math.min(59, Math.max(0, Number(timeMatch[2])));
    target.setUTCHours(h, m, 0, 0);
    return;
  }
  if (lower.includes('afternoon')) {
    target.setUTCHours(14, 0, 0, 0);
  } else if (lower.includes('evening') || lower.includes('eod')) {
    target.setUTCHours(17, 0, 0, 0);
  } else {
    target.setUTCHours(9, 0, 0, 0);
  }
}

export function resolveTargetDatetimeUtc(label: string, nowMs = Date.now()): string {
  const trimmed = label.trim();
  const lower = trimmed.toLowerCase();
  const base = new Date(nowMs);

  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})/.exec(trimmed);
  if (isoMatch) {
    const dt = new Date(`${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}T09:00:00.000Z`);
    if (!Number.isNaN(dt.getTime())) {
      applyTimeHintUtc(dt, trimmed);
      return dt.toISOString();
    }
  }

  const monthMatch = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{1,2})(?:,\s*(\d{4}))?/i.exec(
    trimmed
  );
  if (monthMatch) {
    const monthIdx = MONTH_MAP[monthMatch[1].toLowerCase().slice(0, 3)];
    const day = Number(monthMatch[2]);
    const year = monthMatch[3] ? Number(monthMatch[3]) : base.getUTCFullYear();
    const dt = new Date(Date.UTC(year, monthIdx, day, 9, 0, 0, 0));
    if (!Number.isNaN(dt.getTime())) {
      applyTimeHintUtc(dt, trimmed);
      return dt.toISOString();
    }
  }

  const weekdays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  for (let i = 0; i < weekdays.length; i += 1) {
    if (lower.includes(weekdays[i])) {
      const currentDay = base.getUTCDay();
      let delta = (i - currentDay + 7) % 7;
      if (delta === 0) delta = 7;
      const target = new Date(nowMs + delta * 24 * 3600_000);
      applyTimeHintUtc(target, trimmed);
      return target.toISOString();
    }
  }

  if (lower.includes('tomorrow')) {
    const target = new Date(nowMs + 24 * 3600_000);
    applyTimeHintUtc(target, trimmed);
    return target.toISOString();
  }

  if (lower.includes('next week') || lower.includes('eow')) {
    const target = new Date(nowMs + 4 * 24 * 3600_000);
    applyTimeHintUtc(target, trimmed);
    return target.toISOString();
  }

  const fallback = new Date(nowMs + 24 * 3600_000);
  applyTimeHintUtc(fallback, trimmed);
  return fallback.toISOString();
}

function buildContextualReplyDraft(
  mail: Pick<MailDoc, 'fromName' | 'subject' | 'textBody'>,
  userName?: string
): { suggestedSubject: string; suggestedBody: string } {
  const senderFirst = mail.fromName.trim().split(/\s+/)[0] || 'there';
  const signOff = userName?.trim() || 'Abhay';
  const suggestedSubject = mail.subject.startsWith('Re:') ? mail.subject : `Re: ${mail.subject}`;

  const bodyLower = `${mail.subject}\n${mail.textBody}`.toLowerCase();
  let responseLine = `Thanks for sharing an update on "${mail.subject}". I've reviewed the details and will follow up shortly.`;

  if (MEETING_INTENT_RE.test(bodyLower) && /\b(meet|sync|call|slot|lock|schedule)\b/i.test(bodyLower)) {
    responseLine = `Thanks for reaching out, ${senderFirst}. The proposed timing works on my end—happy to lock this in and walk through "${mail.subject}".`;
  } else if (/\bgreen light|canary|deploy|ready whenever\b/i.test(bodyLower)) {
    responseLine = `Everything looks great on the checks. You have the green light to proceed—please share metrics once the rollout starts.`;
  } else if (/\bdue\b|\bdeadline\b|\bsubmit\b|\bsign-off\b/i.test(bodyLower)) {
    responseLine = `Got it—I've logged this deadline and will make sure our review for "${mail.subject}" is submitted ahead of schedule.`;
  } else if (mail.textBody.includes('?')) {
    responseLine = `Thanks for checking in. Confirming yes on our side for "${mail.subject}"—let me know if you need anything else before we proceed.`;
  }

  return {
    suggestedSubject,
    suggestedBody: `Hi ${senderFirst},\n\n${responseLine}\n\nBest,\n${signOff}`,
  };
}

export interface ExtractActionsOptions {
  nowMs?: number;
  otpVaultId?: string;
  userName?: string;
}

/**
 * Extracts up to 2 high-confidence Inbox-to-Action suggested actions at ingest/seed time.
 */
export function extractSuggestedActions(
  mail: Pick<
    MailDoc,
    'id' | 'folder' | 'fromName' | 'fromEmail' | 'subject' | 'textBody' | 'category' | 'otpCode'
  >,
  options: ExtractActionsOptions = {}
): SuggestedAction[] {
  if (mail.folder !== 'inbox') {
    return [];
  }

  const nowMs = options.nowMs ?? Date.now();
  const actions: SuggestedAction[] = [];

  // 1. Copy OTP (highest confidence, exclusive for OTP emails)
  const isOtpCategory = mail.category.toUpperCase() === 'OTP';
  const otpInfo = isOtpCategory || mail.otpCode ? detectOtpFast(mail, nowMs) : null;
  const resolvedOtpCode = mail.otpCode || otpInfo?.otpCode;
  if (isOtpCategory && resolvedOtpCode) {
    actions.push({
      id: `${mail.id}_act_otp`,
      type: 'copy_otp',
      label: 'Copy OTP',
      confidence: 0.99,
      otpCode: resolvedOtpCode,
      otpVaultId: options.otpVaultId,
      serviceName: otpInfo?.serviceName || mail.fromName,
    });
    return actions;
  }

  const combined = `${mail.subject}\n${mail.textBody}`;
  const isAutomated = AUTOMATED_SENDER_RE.test(mail.fromEmail);

  // 2. Reply Draft (when email asks a question, requests meeting, or expects human reply)
  if (!isAutomated && REPLY_INTENT_RE.test(combined)) {
    const { suggestedSubject, suggestedBody } = buildContextualReplyDraft(mail, options.userName);
    actions.push({
      id: `${mail.id}_act_reply`,
      type: 'reply_draft',
      label: 'Draft Reply',
      confidence: MEETING_INTENT_RE.test(combined) || combined.includes('?') ? 0.93 : 0.86,
      suggestedSubject,
      suggestedBody,
    });
  }

  // 3. Schedule Follow-Up (when email mentions a deadline, date, meeting time, or future check-in)
  let matchedDateLabel: string | null = null;
  const isBillingPeriodOnly =
    /billing period:/i.test(combined) && !/\b(?:due|deadline|submit|follow[- ]?up|check[- ]?in)\b/i.test(combined);

  if (!isBillingPeriodOnly) {
    for (const pat of DATE_EXTRACTION_PATTERNS) {
      const m = pat.re.exec(combined);
      if (m) {
        matchedDateLabel = pat.extract(m);
        break;
      }
    }
  }

  if (matchedDateLabel && (!isAutomated || /\b(?:due|deadline|expires?)\b/i.test(combined))) {
    const targetDatetime = resolveTargetDatetimeUtc(matchedDateLabel, nowMs);
    actions.push({
      id: `${mail.id}_act_schedule`,
      type: 'schedule_followup',
      label: 'Schedule Follow-Up',
      confidence: 0.9,
      targetDatetime,
      extractedDateLabel: matchedDateLabel,
      suggestedSubject: mail.subject.startsWith('Re:') ? mail.subject : `Follow-Up: ${mail.subject}`,
    });
  }

  return actions.slice(0, 2);
}

export function buildDraftAgentCommandForAction(mail: Pick<MailDoc, 'id' | 'fromEmail' | 'subject'>): string {
  return `/draft @mail:${mail.id} Reply to @${mail.fromEmail} regarding "${mail.subject.slice(0, 48)}"`;
}

export function buildScheduleAgentCommandForAction(
  mail: Pick<MailDoc, 'id' | 'fromEmail' | 'subject'>,
  action: SuggestedAction
): string {
  const dt = action.targetDatetime || new Date(Date.now() + 24 * 3600_000).toISOString();
  return `/schedule Follow up with @${mail.fromEmail} on ${dt} regarding @mail:${mail.id} ("${mail.subject.slice(0, 44)}")`;
}
