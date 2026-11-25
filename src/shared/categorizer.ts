import { CategoryDoc, MailDoc } from './types';

export interface OtpDetectionResult {
  isOtp: boolean;
  otpCode?: string;
  serviceName?: string;
  expiresAt?: string;
  confidence: 'high' | 'none';
  reason?: string;
}

const OTP_KEYWORDS_RE =
  /\b(otp|one[- ]time\s*(?:password|passcode|code)|verification\s*code|security\s*code|login\s*code|auth(?:entication)?\s*code|2fa|two[- ]factor|mfa|verify\s*your\s*(?:email|account|login|identity)|confirm\s*your\s*(?:email|sign[- ]in)|passcode|pin\s*code)\b/i;

const OTP_SENDER_RE = /\b(noreply|no-reply|verify|verification|auth|security|otp|accounts|notifications)\b/i;

const OTP_CODE_CONTEXT_RE =
  /(?:code|otp|passcode|pin|token|verification)\s*(?:is|:|\s)*\b([0-9]{4,8}|[0-9]{3}-[0-9]{3})\b|\b([0-9]{4,8})\b\s*(?:is\s+your\s+(?:verification|security|login|one[- ]time|otp|2fa)\s*code)/i;

const STANDALONE_DIGIT_CODE_RE = /(?:^|\s)([0-9]{6}|[0-9]{4}|[0-9]{8})(?:\s|$|\.)/m;

const EXPIRY_MINUTES_RE =
  /(?:valid\s+for|expires?\s+in|within)\s+(\d{1,3})\s*(?:minutes?|mins?)\b/i;

export function extractServiceName(
  mail: Pick<MailDoc, 'fromName' | 'fromEmail' | 'subject'>
): string {
  const bracketMatch = /^\[([^\]]+)\]/.exec(mail.subject.trim());
  if (bracketMatch?.[1]) {
    return bracketMatch[1].trim();
  }
  const cleanFrom = mail.fromName
    .replace(/\b(security|auth|identity|noreply|no-reply|verification|support|team)\b/gi, '')
    .trim();
  if (cleanFrom.length >= 2) {
    return cleanFrom;
  }
  const domainPart = mail.fromEmail.split('@')[1] || '';
  const root = domainPart.split('.').slice(-2, -1)[0] || domainPart;
  if (root) {
    return root.charAt(0).toUpperCase() + root.slice(1);
  }
  return 'Account';
}

export function extractOtpExpiryIso(text: string, nowMs = Date.now()): string {
  const m = EXPIRY_MINUTES_RE.exec(text);
  const minutes = m?.[1] ? Math.min(120, Math.max(1, Number(m[1]))) : 15;
  return new Date(nowMs + minutes * 60_000).toISOString();
}

/**
 * Fast deterministic OTP detection executed before any custom/AI categorization.
 * Requires both OTP semantic context (keywords or auth sender + keyword) and a 4-8 digit code.
 */
export function detectOtpFast(
  mail: Pick<MailDoc, 'subject' | 'textBody' | 'fromEmail' | 'fromName'>,
  nowMs = Date.now()
): OtpDetectionResult {
  const combinedText = `${mail.subject}\n${mail.textBody}`;
  const hasOtpKeyword = OTP_KEYWORDS_RE.test(combinedText);
  const hasAuthSender = OTP_SENDER_RE.test(mail.fromEmail) || OTP_SENDER_RE.test(mail.fromName);

  if (!hasOtpKeyword && !hasAuthSender) {
    return { isOtp: false, confidence: 'none' };
  }

  const contextMatch = OTP_CODE_CONTEXT_RE.exec(combinedText);
  if (contextMatch) {
    const code = (contextMatch[1] || contextMatch[2] || '').replace(/-/g, '');
    if (code.length >= 4 && code.length <= 8) {
      return {
        isOtp: true,
        otpCode: code,
        serviceName: extractServiceName(mail),
        expiresAt: extractOtpExpiryIso(combinedText, nowMs),
        confidence: 'high',
        reason: 'Matched OTP keyword and explicit numeric verification code.',
      };
    }
  }

  if (hasOtpKeyword) {
    const standalone = STANDALONE_DIGIT_CODE_RE.exec(combinedText);
    if (standalone?.[1]) {
      return {
        isOtp: true,
        otpCode: standalone[1],
        serviceName: extractServiceName(mail),
        expiresAt: extractOtpExpiryIso(combinedText, nowMs),
        confidence: 'high',
        reason: 'Matched OTP intent with standalone 4-8 digit code.',
      };
    }
  }

  return { isOtp: false, confidence: 'none' };
}

export interface RuleCategorizationResult {
  category: string;
  otpCode?: string;
  categorizedBy: 'otp-rule' | 'custom-rule' | 'default';
}

export function categorizeMailRuleBased(
  mail: Pick<MailDoc, 'subject' | 'textBody' | 'fromEmail' | 'fromName' | 'folder'>,
  categories: CategoryDoc[]
): RuleCategorizationResult {
  // 1. Fast OTP Detection First
  const otp = detectOtpFast(mail);
  if (otp.isOtp) {
    return {
      category: 'OTP',
      otpCode: otp.otpCode,
      categorizedBy: 'otp-rule',
    };
  }

  // 2. Match user-defined custom categories
  const subjectAndBody = `${mail.subject} ${mail.textBody}`.toLowerCase();
  const sender = `${mail.fromName} ${mail.fromEmail}`.toLowerCase();

  for (const cat of categories) {
    if (cat.name.toUpperCase() === 'OTP') continue;

    const senderHit = cat.senderPatterns.some((pattern) => {
      const p = pattern.trim().toLowerCase();
      return p.length > 0 && sender.includes(p);
    });
    if (senderHit) {
      return { category: cat.name, categorizedBy: 'custom-rule' };
    }

    const keywordHit = cat.keywords.some((kw) => {
      const k = kw.trim().toLowerCase();
      return k.length > 0 && subjectAndBody.includes(k);
    });
    if (keywordHit) {
      return { category: cat.name, categorizedBy: 'custom-rule' };
    }
  }

  return { category: 'General', categorizedBy: 'default' };
}
