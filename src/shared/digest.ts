import { DigestBriefing, DigestFilterScope, DigestItem, MailDoc, ScheduleRuleInput } from './types';

export interface DigestOptions {
  scope?: DigestFilterScope;
  category?: string;
  nowMs?: number;
}

const AUTOMATED_SENDER_RE = /^(no-?reply|noreply|notifications|updates|receipts|billing|verify|auth|mailer-daemon)@/i;

const DEADLINE_PATTERNS: Array<{ re: RegExp; extract: (m: RegExpMatchArray) => string }> = [
  {
    re: /\b((?:next\s+)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)(?:\s+(?:morning|afternoon|evening))?(?:\s+utc)?)\b/i,
    extract: (m) => m[1],
  },
  {
    re: /\b((?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2}(?:,\s*\d{4})?)\b/i,
    extract: (m) => m[1],
  },
  {
    re: /\b(\d{4}-\d{2}-\d{2})\b/,
    extract: (m) => m[1],
  },
  {
    re: /\b(?:deadline|due(?:\s+by)?|by\s+end\s+of\s+(?:day|week)|eod|eow|tomorrow)\b/i,
    extract: (m) => m[0],
  },
];

const REPLY_INTENT_RE =
  /\?|(\b(please|can we|could you|ready whenever|let me know|confirm|approve|green light|review|feedback|reply|schedule)\b)/i;

function computeSuggestedDateUtc(label: string, nowMs: number): string {
  const lower = label.toLowerCase();
  const base = new Date(nowMs);

  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(label.trim());
  if (isoMatch) {
    const dt = new Date(`${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}T09:00:00.000Z`);
    if (!Number.isNaN(dt.getTime())) return dt.toISOString();
  }

  const weekdays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  for (let i = 0; i < weekdays.length; i += 1) {
    if (lower.includes(weekdays[i])) {
      const currentDay = base.getUTCDay();
      let delta = (i - currentDay + 7) % 7;
      if (delta === 0) delta = 7;
      const target = new Date(nowMs + delta * 24 * 3600_000);
      target.setUTCHours(lower.includes('afternoon') ? 14 : lower.includes('evening') ? 18 : 9, 0, 0, 0);
      return target.toISOString();
    }
  }

  if (lower.includes('tomorrow')) {
    const target = new Date(nowMs + 24 * 3600_000);
    target.setUTCHours(9, 0, 0, 0);
    return target.toISOString();
  }

  // Fallback: next morning UTC (+18h rounded)
  const fallback = new Date(nowMs + 24 * 3600_000);
  fallback.setUTCMinutes(0, 0, 0);
  return fallback.toISOString();
}

function toDigestItem(
  mail: MailDoc,
  bucket: DigestItem['bucket'],
  reason: string,
  extractedDateLabel?: string,
  suggestedStartUtc?: string
): DigestItem {
  return {
    mailId: mail.id,
    fromName: mail.fromName,
    fromEmail: mail.fromEmail,
    subject: mail.subject,
    snippet: mail.snippet,
    category: mail.category,
    receivedAt: mail.receivedAt,
    isRead: mail.isRead,
    bucket,
    reason,
    extractedDateLabel,
    suggestedStartUtc,
  };
}

export function generateRuleBasedDigest(
  mails: MailDoc[],
  options: DigestOptions = {}
): DigestBriefing {
  const scope: DigestFilterScope = options.scope || 'unread';
  const categoryFilter = options.category?.trim() || undefined;
  const nowMs = options.nowMs ?? Date.now();
  const twentyFourHoursAgoMs = nowMs - 24 * 3600_000;

  const eligible = mails
    .filter((m) => m.folder === 'inbox')
    .filter((m) => {
      if (scope === 'unread' && m.isRead) return false;
      if (scope === 'today' && new Date(m.receivedAt).getTime() < twentyFourHoursAgoMs) return false;
      if (categoryFilter && categoryFilter.toLowerCase() !== 'all') {
        return m.category.toLowerCase() === categoryFilter.toLowerCase();
      }
      return true;
    })
    .sort((a, b) => new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime());

  const needsReply: DigestItem[] = [];
  const deadlines: DigestItem[] = [];
  const noise: DigestItem[] = [];

  for (const mail of eligible) {
    const combined = `${mail.subject}\n${mail.textBody}`;
    const isOtp = mail.category.toUpperCase() === 'OTP' || Boolean(mail.otpCode);
    const isAutomated = AUTOMATED_SENDER_RE.test(mail.fromEmail);

    if (isOtp) {
      noise.push(
        toDigestItem(
          mail,
          'noise',
          mail.otpCode
            ? `Automated verification passcode (${mail.otpCode}) — safe to archive or clean up.`
            : 'Automated security verification notice.'
        )
      );
      continue;
    }

    // Check explicit deadlines / dates first for actionable scheduling
    let matchedDateLabel: string | null = null;
    if (!/billing period:/i.test(combined) || /\bdue\b|\bdeadline\b/i.test(combined)) {
      for (const pat of DEADLINE_PATTERNS) {
        const m = pat.re.exec(combined);
        if (m) {
          matchedDateLabel = pat.extract(m);
          break;
        }
      }
    }

    if (matchedDateLabel && !isAutomated) {
      deadlines.push(
        toDigestItem(
          mail,
          'deadlines',
          `Mentions "${matchedDateLabel}" — schedule a follow-up or milestone reminder.`,
          matchedDateLabel,
          computeSuggestedDateUtc(matchedDateLabel, nowMs)
        )
      );
      continue;
    }

    if (!isAutomated && REPLY_INTENT_RE.test(combined)) {
      needsReply.push(
        toDigestItem(
          mail,
          'needs_reply',
          `Direct message from ${mail.fromName} awaiting your confirmation or response.`
        )
      );
      continue;
    }

    noise.push(
      toDigestItem(
        mail,
        'noise',
        isAutomated
          ? `Automated ${mail.category} update — no immediate reply required.`
          : `Low-priority ${mail.category} update.`
      )
    );
  }

  const scopeLabel =
    scope === 'unread' ? 'unread inbox' : scope === 'today' ? 'last 24 hours' : 'active inbox';
  const catLabel = categoryFilter && categoryFilter.toLowerCase() !== 'all' ? ` in @category:${categoryFilter}` : '';

  const summary =
    eligible.length === 0
      ? `No ${scopeLabel} messages matched${catLabel}.`
      : `Analyzed ${eligible.length} ${scopeLabel} ${eligible.length === 1 ? 'email' : 'emails'}${catLabel}: ${needsReply.length} need reply, ${deadlines.length} with deadlines or dates, and ${noise.length} low-priority / automated updates.`;

  return {
    scope,
    category: categoryFilter && categoryFilter.toLowerCase() !== 'all' ? categoryFilter : undefined,
    generatedAt: new Date(nowMs).toISOString(),
    totalAnalyzed: eligible.length,
    summary,
    needsReply,
    deadlines,
    noise,
  };
}

export function buildDraftPromptForMail(item: Pick<DigestItem, 'fromEmail' | 'subject'>): string {
  const cleanSubject = item.subject.replace(/\s+/g, ' ').trim();
  const slug = cleanSubject.replace(/\s+/g, '_').slice(0, 28);
  return `/draft Reply to @${item.fromEmail} regarding @mail:${slug} ("${cleanSubject}")`;
}

export function buildSchedulePrefillForDigestItem(
  item: Pick<DigestItem, 'fromEmail' | 'fromName' | 'subject' | 'extractedDateLabel' | 'suggestedStartUtc'>
): ScheduleRuleInput {
  const startUtc =
    item.suggestedStartUtc || new Date(Date.now() + 24 * 3600_000).toISOString();
  const cleanSubject = item.subject.startsWith('Re:') ? item.subject : `Re: ${item.subject}`;
  return {
    mode: 'basic',
    startUtc,
    freq: 1,
    gapValue: 0,
    gapUnit: 'hours',
    recipients: [item.fromEmail],
    subject: cleanSubject,
    body: `Hi ${item.fromName.split(' ')[0] || 'there'},\n\nFollowing up ahead of ${
      item.extractedDateLabel || 'our upcoming milestone'
    } regarding "${item.subject}".\n\nBest regards,`,
  };
}
