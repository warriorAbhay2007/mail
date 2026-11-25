import { MailDoc, QuickReplyTone } from './types';

export const QUICK_REPLY_TONES: readonly QuickReplyTone[] = [
  'Professional',
  'Concise',
  'Friendly',
] as const;

export function isValidQuickReplyTone(value: unknown): value is QuickReplyTone {
  return (
    value === 'Professional' ||
    value === 'Concise' ||
    value === 'Friendly'
  );
}

export function buildQuickReplyInstructions(tone: QuickReplyTone, userName: string): string {
  const toneGuidance: Record<QuickReplyTone, string> = {
    Professional:
      'Use a polished, courteous, and structured business tone. Acknowledge key points clearly and close professionally.',
    Concise:
      'Keep the reply crisp and direct in 2 to 4 short sentences. Eliminate fluff while answering the sender clearly.',
    Friendly:
      'Use a warm, approachable, and collaborative conversational tone while staying clear and helpful.',
  };

  return [
    `You are drafting an email reply on behalf of ${userName}.`,
    toneGuidance[tone],
    'Return ONLY the plain-text email reply body ready to insert into a reply box.',
    'Do NOT include a Subject line, markdown code fences, or explanatory commentary.',
  ].join(' ');
}

export function buildQuickReplyPromptContents(params: {
  mail: Pick<MailDoc, 'fromName' | 'fromEmail' | 'subject' | 'textBody' | 'folder' | 'to'>;
  tone: QuickReplyTone;
  userName: string;
  userEmail: string;
}): string {
  const { mail, tone, userName, userEmail } = params;
  const sender = `${mail.fromName} <${mail.fromEmail}>`;
  const trimmedBody = mail.textBody.trim().slice(0, 2000);

  return [
    `Requested Tone: ${tone}`,
    `Replying As: ${userName} <${userEmail}>`,
    `Original Sender: ${sender}`,
    `Subject: ${mail.subject}`,
    'Original Email Body:',
    trimmedBody,
  ].join('\n');
}

export function stripCodeFencesFromDraft(raw: string): string {
  return raw
    .trim()
    .replace(/^```(?:text|markdown|email)?\s*\n?/i, '')
    .replace(/\n?```\s*$/i, '')
    .trim();
}
