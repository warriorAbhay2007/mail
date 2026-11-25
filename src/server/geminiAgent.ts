import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import {
  AgentActionPreview,
  CategoryDoc,
  MailDoc,
  OtpVaultDoc,
  QuickReplyTone,
  ScheduleRuleInput,
} from '../shared/types';
import { parseAgentTriggers } from '../shared/agentTriggers';
import { materializeScheduleTimestamps, parseRecipientList } from '../shared/scheduler';
import { categorizeMailRuleBased } from '../shared/categorizer';
import {
  buildQuickReplyInstructions,
  buildQuickReplyPromptContents,
  stripCodeFencesFromDraft,
} from '../shared/quickReply';
import { generateDigestBriefing } from './digestGenerator';
import { DigestFilterScope } from '../shared/types';

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    throw new Error('GEMINI_API_KEY is not configured. Add your key in Settings > Secrets.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function withTimeout<T>(promise: Promise<T>, ms = 7000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Gemini request timed out')), ms);
    promise.then(
      (val) => {
        clearTimeout(timer);
        resolve(val);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

export interface AgentExecutionResult {
  replyText: string;
  requiresTriggerHint?: boolean;
  actionPreview?: AgentActionPreview;
  updatedMailIds?: string[];
}

function parseSchedulePromptFallback(params: {
  prompt: string;
  nowMs: number;
  knownContacts: string[];
  userName: string;
}): Partial<ScheduleRuleInput> {
  const { prompt, nowMs, knownContacts, userName } = params;
  const freqMatch = /\b(\d+)\s*(?:times|runs|follow-?ups?)\b/i.exec(prompt);
  const gapMatch = /\bevery\s+(\d+)\s*(minute|minutes|min|hour|hours|hr|day|days)\b/i.exec(prompt);
  const parsedFreq = freqMatch ? Math.max(1, Math.min(50, Number(freqMatch[1]))) : gapMatch ? 3 : 1;
  const parsedGapVal = gapMatch ? Math.max(1, Number(gapMatch[1])) : parsedFreq > 1 ? 2 : 0;
  const rawUnit = (gapMatch?.[2] || 'hours').toLowerCase();
  const parsedGapUnit = rawUnit.startsWith('min')
    ? 'minutes'
    : rawUnit.startsWith('day')
    ? 'days'
    : 'hours';

  const atTokens = Array.from(prompt.matchAll(/@([a-zA-Z0-9._+-]+(?:@[a-zA-Z0-9.-]+)?)/g)).map(
    (m) => m[1]
  );
  const resolvedEmails: string[] = [];
  for (const tok of atTokens) {
    if (tok.toLowerCase().startsWith('category:') || tok.toLowerCase().startsWith('mail:')) continue;
    if (tok.includes('@')) {
      resolvedEmails.push(tok.toLowerCase());
    } else {
      const matchKnown = knownContacts.find((c) => c.toLowerCase().includes(tok.toLowerCase()));
      resolvedEmails.push(matchKnown || `${tok.toLowerCase()}@northstar.io`);
    }
  }

  const explicitDisable = /\b(?:do\s*not|don't|never|without)\s+stop\s+on\s+reply\b/i.test(prompt);
  const explicitEnable = /\bstop\s*(?:automatically\s*)?(?:on|if(?:\s+recipient)?)\s*repl(?:y|ies)\b/i.test(prompt);
  const isoMatch = /\b(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?Z)\b/.exec(prompt);

  return {
    mode: parsedFreq > 1 ? 'advanced' : 'basic',
    startUtc: isoMatch ? isoMatch[1] : new Date(nowMs + 3600_000).toISOString(),
    freq: parsedFreq,
    gapValue: parsedGapVal,
    gapUnit: parsedGapUnit,
    recipients: resolvedEmails.length ? resolvedEmails : ['recruiter@northstar.io'],
    subject: /follow-?up/i.test(prompt) ? 'Quick Follow-Up' : 'Scheduled Update',
    body: `Hi there,\n\nFollowing up regarding ${prompt.replace(/^\/schedule\s*/i, '').trim()}.\n\nBest regards,\n${userName}`,
    stopOnReply: explicitDisable ? false : explicitEnable || parsedFreq > 1,
  };
}

export async function executeAgentPrompt(params: {
  prompt: string;
  userId: string;
  userEmail: string;
  userName: string;
  mails: MailDoc[];
  categories: CategoryDoc[];
  otpVault: OtpVaultDoc[];
}): Promise<AgentExecutionResult> {
  const { prompt, userEmail, userName, mails, categories, otpVault } = params;
  const triggers = parseAgentTriggers(prompt);

  // Strict Trigger Rule: reject prompts without / or @
  if (!triggers.isValid) {
    return {
      requiresTriggerHint: true,
      replyText:
        'Commands require an explicit / action (such as /schedule, /draft, /categorize, /otp, /digest, /cleanup) or @ context mention (such as @alex@acme.dev or @category:OTP). Type / or @ in the prompt bar to select a command.',
    };
  }

  const primaryCommand = triggers.commands[0] || '';

  // 0a. /digest — morning inbox briefing & action extractor in chat stream
  if (primaryCommand === '/digest') {
    let scope: DigestFilterScope = 'unread';
    if (/\btoday\b/i.test(prompt)) scope = 'today';
    else if (/\ball\b/i.test(prompt) && !/@category:/i.test(prompt)) scope = 'all';

    const category = triggers.categoryMentions[0] || undefined;
    const digest = await generateDigestBriefing({ mails, scope, category });

    return {
      replyText: digest.summary,
      actionPreview: {
        type: 'digest_briefing',
        digest,
      },
    };
  }

  // 0b. /otp — surface latest active OTP code inside the chat stream
  if (primaryCommand === '/otp') {
    const nowMs = Date.now();
    const activeEntries = otpVault
      .filter((v) => !v.isUsed && new Date(v.expiresAt).getTime() > nowMs)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    if (activeEntries.length > 0) {
      const latest = activeEntries[0];
      return {
        replyText: `Active verification code for ${latest.serviceName} is ready below.`,
        actionPreview: {
          type: 'otp_surface_card',
          vaultId: latest.id,
          serviceName: latest.serviceName,
          otpCode: latest.otpCode,
          expiresAt: latest.expiresAt,
          isUsed: latest.isUsed,
        },
      };
    }

    return {
      replyText:
        'No active, unconsumed OTP codes are currently in your vault. Click "Simulate Incoming OTP" in Mail Viewer or wait for a new verification email.',
    };
  }

  // 1. /cleanup, /cleanup-otp, or @category:OTP cleanup request
  if (
    primaryCommand === '/cleanup' ||
    primaryCommand === '/cleanup-otp' ||
    (triggers.categoryMentions.some((c) => c.toLowerCase() === 'otp') &&
      /clean|delete|remove|purge|review/i.test(prompt))
  ) {
    const otpMails = mails.filter((m) => m.category.toUpperCase() === 'OTP');
    if (otpMails.length === 0) {
      return {
        replyText: 'Your inbox has 0 emails currently tagged under OTP. No cleanup needed.',
      };
    }
    return {
      replyText: `Found ${otpMails.length} verification ${otpMails.length === 1 ? 'email' : 'emails'} under @category:OTP. Review the detected codes below and confirm if you want to permanently delete them.`,
      actionPreview: {
        type: 'otp_cleanup_preview',
        count: otpMails.length,
        items: otpMails.map((m) => ({
          id: m.id,
          fromName: m.fromName,
          fromEmail: m.fromEmail,
          subject: m.subject,
          otpCode: m.otpCode,
          receivedAt: m.receivedAt,
        })),
        cleaned: false,
      },
    };
  }

  // 2. /categorize
  if (primaryCommand === '/categorize') {
    const changes: Array<{ mailId: string; subject: string; category: string; method: string }> = [];
    let otpCount = 0;

    for (const mail of mails) {
      if (mail.folder !== 'inbox') continue;
      const ruleResult = categorizeMailRuleBased(mail, categories);
      if (ruleResult.category !== mail.category || ruleResult.otpCode !== mail.otpCode) {
        mail.category = ruleResult.category;
        mail.otpCode = ruleResult.otpCode;
        mail.categorizedBy = ruleResult.categorizedBy;
        changes.push({
          mailId: mail.id,
          subject: mail.subject,
          category: ruleResult.category,
          method: ruleResult.categorizedBy,
        });
      }
      if (mail.category === 'OTP') otpCount += 1;
    }

    // Optional AI pass for remaining General inbox mails if AI-enabled custom categories exist
    const aiCategories = categories.filter((c) => !c.isSystem && c.aiEnabled);
    const generalMails = mails.filter((m) => m.folder === 'inbox' && m.category === 'General');
    if (aiCategories.length > 0 && generalMails.length > 0 && process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY') {
      try {
        const ai = getGeminiClient();
        const response = await withTimeout(
          ai.models.generateContent({
          model: 'gemini-4-hydrogen',
          contents: JSON.stringify({
            categories: aiCategories.map((c) => ({ name: c.name, description: c.description })),
            emails: generalMails.slice(0, 15).map((m) => ({
              id: m.id,
              from: m.fromEmail,
              subject: m.subject,
              snippet: m.snippet,
            })),
          }),
          config: {
            systemInstruction:
              'Classify each email into the best matching category name from the provided categories list, or "General" if none fit.',
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.STRING },
                  category: { type: Type.STRING },
                },
                required: ['id', 'category'],
              },
            },
          },
        }),
          6000
        );
        const assignments = JSON.parse(response.text || '[]') as Array<{ id: string; category: string }>;
        const validNames = new Set(aiCategories.map((c) => c.name));
        for (const item of assignments) {
          const target = generalMails.find((m) => m.id === item.id);
          if (target && validNames.has(item.category)) {
            target.category = item.category;
            target.categorizedBy = 'ai';
            changes.push({
              mailId: target.id,
              subject: target.subject,
              category: item.category,
              method: 'ai',
            });
          }
        }
      } catch {
        // Keep rule-based categorization results if Gemini API is temporarily unavailable
      }
    }

    return {
      replyText:
        changes.length > 0
          ? `Categorization complete. Updated ${changes.length} ${changes.length === 1 ? 'message' : 'messages'} (${otpCount} total OTP emails tracked).`
          : `All ${mails.filter((m) => m.folder === 'inbox').length} inbox messages are already up to date (${otpCount} tagged as OTP).`,
      actionPreview: {
        type: 'categorize_summary',
        processedCount: mails.filter((m) => m.folder === 'inbox').length,
        otpDetectedCount: otpCount,
        changes,
      },
      updatedMailIds: changes.map((c) => c.mailId),
    };
  }

  // 3. /schedule (uses Gemini to parse natural language into Schedule(start, freq, gap) + stopOnReply, with deterministic fallback)
  if (primaryCommand === '/schedule') {
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const knownContacts = Array.from(
      new Set([
        ...triggers.recipientMentions,
        ...mails.slice(0, 10).map((m) => m.fromEmail),
      ])
    ).slice(0, 15);

    const hasGeminiKey = Boolean(
      process.env.GEMINI_API_KEY?.trim() && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY'
    );

    // Fast path when triggered directly from a Smart Action Pill with @mail:<id> + ISO datetime
    const directMailMatch = triggers.mailMentions
      .map((q) => mails.find((m) => m.id === q))
      .find((m): m is MailDoc => Boolean(m));
    const directIsoMatch = /\b(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?Z)\b/.exec(prompt);
    const directSchedAction = directMailMatch?.suggestedActions?.find(
      (a) => a.type === 'schedule_followup'
    );

    let parsed: Partial<ScheduleRuleInput> = {};

    if (directMailMatch && (directIsoMatch || directSchedAction)) {
      const targetIso =
        directIsoMatch?.[1] ||
        directSchedAction?.targetDatetime ||
        new Date(nowMs + 24 * 3600_000).toISOString();
      parsed = {
        mode: 'basic',
        startUtc: targetIso,
        freq: 1,
        gapValue: 0,
        gapUnit: 'hours',
        recipients: [directMailMatch.fromEmail],
        subject:
          directSchedAction?.suggestedSubject ||
          (directMailMatch.subject.startsWith('Re:')
            ? directMailMatch.subject
            : `Follow-Up: ${directMailMatch.subject}`),
        body: `Hi ${directMailMatch.fromName.split(' ')[0] || 'there'},\n\nFollowing up regarding "${directMailMatch.subject}" (${
          directSchedAction?.extractedDateLabel || 'scheduled milestone'
        }).\n\nBest regards,\n${userName}`,
        stopOnReply: false,
        threadId: directMailMatch.threadId,
      };
    } else if (hasGeminiKey) {
      try {
        const ai = getGeminiClient();
        const response = await withTimeout(
          ai.models.generateContent({
          model: 'gemini-4-hydrogen',
          contents: `Current UTC timestamp: ${nowIso}\nUser (${userName} <${userEmail}>) prompt: ${prompt}\nDetected @recipient mentions: ${JSON.stringify(triggers.recipientMentions)}\nKnown contacts for resolution if partial name given: ${JSON.stringify(knownContacts)}`,
          config: {
            systemInstruction:
              'Parse the email scheduling request into a structured Schedule(start, freq, gap) JSON object. Always output startUtc in valid ISO 8601 UTC format in the future relative to Current UTC timestamp. Use mode="basic" when freq=1 and gapValue=0, or mode="advanced" when freq>1 or recurring gap is specified. Set stopOnReply=true for recurring follow-up sequences (freq>1) or when the user asks to stop on reply, and false only if explicitly disabled. Resolve @mentions to valid email addresses.',
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                mode: { type: Type.STRING, enum: ['basic', 'advanced'] },
                startUtc: { type: Type.STRING },
                freq: { type: Type.INTEGER },
                gapValue: { type: Type.NUMBER },
                gapUnit: { type: Type.STRING, enum: ['minutes', 'hours', 'days'] },
                recipients: { type: Type.ARRAY, items: { type: Type.STRING } },
                subject: { type: Type.STRING },
                body: { type: Type.STRING },
                stopOnReply: { type: Type.BOOLEAN },
              },
              required: [
                'mode',
                'startUtc',
                'freq',
                'gapValue',
                'gapUnit',
                'recipients',
                'subject',
                'body',
                'stopOnReply',
              ],
            },
          },
        }),
          6000
        );
        parsed = JSON.parse(response.text || '{}') as Partial<ScheduleRuleInput>;
      } catch {
        parsed = parseSchedulePromptFallback({ prompt, nowMs, knownContacts, userName });
      }
    } else {
      parsed = parseSchedulePromptFallback({ prompt, nowMs, knownContacts, userName });
    }

    const normalizedRecipients = parseRecipientList(
      parsed.recipients?.length ? parsed.recipients : triggers.recipientMentions
    );
    const startDate = new Date(parsed.startUtc || '');
    const safeStartUtc = Number.isNaN(startDate.getTime())
      ? new Date(nowMs + 3600_000).toISOString()
      : startDate.toISOString();
    const freq = parsed.mode === 'basic' ? 1 : Math.max(1, Math.min(50, parsed.freq || 1));
    const gapValue = parsed.mode === 'basic' ? 0 : Math.max(0, parsed.gapValue || 1);
    const gapUnit = parsed.gapUnit || 'hours';
    const explicitDisable = /\b(?:do\s*not|don't|never|without)\s+stop\s+on\s+reply\b/i.test(prompt);
    const explicitEnable = /\bstop\s*(?:automatically\s*)?(?:on|if(?:\s+recipient)?)\s*repl(?:y|ies)\b/i.test(prompt);
    const stopOnReply =
      typeof parsed.stopOnReply === 'boolean'
        ? parsed.stopOnReply
        : explicitDisable
        ? false
        : explicitEnable || freq > 1;

    const rule: ScheduleRuleInput = {
      mode: freq > 1 ? 'advanced' : 'basic',
      startUtc: safeStartUtc,
      freq,
      gapValue: freq > 1 && gapValue === 0 ? 1 : gapValue,
      gapUnit,
      recipients: normalizedRecipients.length ? normalizedRecipients : ['alex@acme.dev'],
      subject: parsed.subject || 'Scheduled Follow-Up',
      body: parsed.body || 'Hello,\n\nSharing a scheduled update.\n\nBest regards,\n' + userName,
      stopOnReply,
      threadId: parsed.threadId,
    };

    const preview = materializeScheduleTimestamps(rule, 'preview');

    return {
      replyText: `Parsed your request into ${
        rule.mode === 'advanced'
          ? `an Advanced schedule (${rule.freq} runs, every ${rule.gapValue} ${rule.gapUnit}${
              rule.stopOnReply ? ', Stop-on-Reply enabled' : ''
            })`
          : 'a Basic one-time schedule'
      } for ${rule.recipients.join(', ')}. Review the materialized UTC timestamps below and confirm to activate.`,
      actionPreview: {
        type: 'schedule_preview',
        rule,
        timestampsUtc: preview.timestampsUtc,
        confirmed: false,
      },
    };
  }

  // 4. /draft or general @mention command -> generate structured draft email preview
  const contextMails = mails
    .filter((m) => {
      if (triggers.mailMentions.length > 0) {
        return triggers.mailMentions.some(
          (q) =>
            m.id === q ||
            `${m.subject} ${m.fromName} ${m.fromEmail}`.toLowerCase().includes(q.toLowerCase())
        );
      }
      if (triggers.recipientMentions.length > 0) {
        return triggers.recipientMentions.some((r) =>
          `${m.fromEmail} ${m.to.join(',')}`.toLowerCase().includes(r.toLowerCase())
        );
      }
      return false;
    })
    .slice(0, 3);

  // Instant pre-populated draft when triggered via /draft @mail:<id> and reply_draft action exists
  const exactMailMatch = triggers.mailMentions
    .map((q) => mails.find((m) => m.id === q))
    .find((m): m is MailDoc => Boolean(m));
  const prebuiltReply = exactMailMatch?.suggestedActions?.find((a) => a.type === 'reply_draft');

  if (exactMailMatch && prebuiltReply?.suggestedSubject && prebuiltReply?.suggestedBody) {
    return {
      replyText: `Pre-populated reply draft to ${exactMailMatch.fromName} (${exactMailMatch.fromEmail}) from Inbox-to-Action extraction. Edit or send below.`,
      actionPreview: {
        type: 'draft_preview',
        to: [exactMailMatch.fromEmail],
        subject: prebuiltReply.suggestedSubject,
        body: prebuiltReply.suggestedBody,
        status: 'pending',
      },
    };
  }

  let draft: { to?: string[]; subject?: string; body?: string; summary?: string } = {};
  const hasGeminiKey = Boolean(
    process.env.GEMINI_API_KEY?.trim() && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY'
  );

  if (hasGeminiKey) {
    try {
      const ai = getGeminiClient();
      const response = await withTimeout(
        ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: `User: ${userName} <${userEmail}>\nPrompt: ${prompt}\nRecipient mentions: ${JSON.stringify(triggers.recipientMentions)}\nReferenced email context: ${JSON.stringify(
          contextMails.map((m) => ({
            from: `${m.fromName} <${m.fromEmail}>`,
            subject: m.subject,
            body: m.textBody.slice(0, 500),
          }))
        )}`,
        config: {
          systemInstruction:
            'You are an executive email agent. Draft a crisp, professional email responding to the user prompt and any referenced context. Output valid JSON with to (array of email strings), subject, body, and summary.',
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              to: { type: Type.ARRAY, items: { type: Type.STRING } },
              subject: { type: Type.STRING },
              body: { type: Type.STRING },
              summary: { type: Type.STRING },
            },
            required: ['to', 'subject', 'body', 'summary'],
          },
        },
      }),
        6000
      );
      draft = JSON.parse(response.text || '{}') as typeof draft;
    } catch {
      draft = {};
    }
  }

  const resolvedTo = parseRecipientList(
    draft.to?.length ? draft.to : triggers.recipientMentions
  );
  const fallbackSubject = contextMails[0]
    ? `Re: ${contextMails[0].subject}`
    : 'Quick follow-up';
  const fallbackBody = contextMails[0]
    ? `Hi ${contextMails[0].fromName},\n\nThanks for your note regarding "${contextMails[0].subject}". Following up on ${prompt.replace(/^\/draft\s*/i, '').trim()}.\n\nBest regards,\n${userName}`
    : `Hi there,\n\n${prompt.replace(/^\/draft\s*/i, '').trim()}\n\nBest regards,\n${userName}`;

  return {
    replyText: draft.summary || 'Prepared a draft email ready for your review.',
    actionPreview: {
      type: 'draft_preview',
      to: resolvedTo.length ? resolvedTo : ['sarah@northstar.io'],
      subject: draft.subject || fallbackSubject,
      body: draft.body || fallbackBody,
      status: 'pending',
    },
  };
}

export class QuickReplyGenerationError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 500) {
    super(message);
    this.name = 'QuickReplyGenerationError';
    this.statusCode = statusCode;
  }
}

export async function generateQuickReplyDraft(params: {
  mail: MailDoc;
  tone: QuickReplyTone;
  userName: string;
  userEmail: string;
}): Promise<{ draft: string; tone: QuickReplyTone; model: string }> {
  const { mail, tone, userName, userEmail } = params;
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    throw new QuickReplyGenerationError(
      'GEMINI_API_KEY is not configured. Check or add your API key in Settings > Secrets.',
      400
    );
  }

  const ai = getGeminiClient();
  const model = 'gemini-4-hydrogen';
  const systemInstruction = buildQuickReplyInstructions(tone, userName);
  const contents = buildQuickReplyPromptContents({ mail, tone, userName, userEmail });

  let lastError: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await withTimeout(
        ai.models.generateContent({
          model,
          contents,
          config: {
            systemInstruction,
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          },
        }),
        12000
      );

      const draft = stripCodeFencesFromDraft(response.text ?? '');
      if (!draft) {
        throw new QuickReplyGenerationError('Gemini returned an empty reply draft.', 502);
      }

      return { draft, tone, model };
    } catch (err) {
      lastError = err;
      const msg = err instanceof Error ? err.message : String(err);
      if (
        msg.includes('PERMISSION_DENIED') ||
        msg.includes('API_KEY_INVALID') ||
        msg.includes('403') ||
        msg.includes('400')
      ) {
        throw new QuickReplyGenerationError(
          'Gemini API rejected the request. Please check your API key in Settings > Secrets.',
          403
        );
      }
      if (msg.includes('RESOURCE_EXHAUSTED') || msg.includes('429')) {
        if (attempt === 0) {
          await new Promise((r) => setTimeout(r, 400));
          continue;
        }
        throw new QuickReplyGenerationError(
          'Gemini API rate limit or quota exceeded. Please try again or check billing in Settings > Secrets.',
          429
        );
      }
      if (attempt === 0 && !msg.includes('timed out')) {
        await new Promise((r) => setTimeout(r, 350));
        continue;
      }
    }
  }

  if (lastError instanceof QuickReplyGenerationError) {
    throw lastError;
  }
  throw new QuickReplyGenerationError(
    lastError instanceof Error ? lastError.message : 'Failed to generate Quick Reply draft.',
    502
  );
}

