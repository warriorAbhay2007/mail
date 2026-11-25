import { GoogleGenAI, Type } from '@google/genai';
import { DigestBriefing, DigestFilterScope, MailDoc } from '../shared/types';
import { generateRuleBasedDigest } from '../shared/digest';

export async function generateDigestBriefing(params: {
  mails: MailDoc[];
  scope?: DigestFilterScope;
  category?: string;
}): Promise<DigestBriefing> {
  const baseDigest = generateRuleBasedDigest(params.mails, {
    scope: params.scope || 'unread',
    category: params.category,
  });

  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY' || baseDigest.totalAnalyzed === 0) {
    return baseDigest;
  }

  try {
    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });

    const items = [
      ...baseDigest.needsReply,
      ...baseDigest.deadlines,
      ...baseDigest.noise,
    ].slice(0, 20);

    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: JSON.stringify({
        scope: baseDigest.scope,
        category: baseDigest.category || 'All',
        emails: items.map((i) => ({
          mailId: i.mailId,
          from: `${i.fromName} <${i.fromEmail}>`,
          subject: i.subject,
          snippet: i.snippet,
          category: i.category,
          currentBucket: i.bucket,
          extractedDateLabel: i.extractedDateLabel || null,
        })),
      }),
      config: {
        systemInstruction:
          'You are an executive morning inbox briefing assistant. Summarize the emails concisely in 1-2 crisp sentences and refine the one-line action reason for each mailId without changing its mailId.',
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            summary: { type: Type.STRING },
            reasons: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  mailId: { type: Type.STRING },
                  reason: { type: Type.STRING },
                },
                required: ['mailId', 'reason'],
              },
            },
          },
          required: ['summary', 'reasons'],
        },
      },
    });

    const parsed = JSON.parse(response.text || '{}') as {
      summary?: string;
      reasons?: Array<{ mailId: string; reason: string }>;
    };

    const reasonMap = new Map((parsed.reasons || []).map((r) => [r.mailId, r.reason]));
    const applyReason = <T extends { mailId: string; reason: string }>(arr: T[]): T[] =>
      arr.map((item) => ({
        ...item,
        reason: reasonMap.get(item.mailId) || item.reason,
      }));

    return {
      ...baseDigest,
      summary: parsed.summary?.trim() || baseDigest.summary,
      needsReply: applyReason(baseDigest.needsReply),
      deadlines: applyReason(baseDigest.deadlines),
      noise: applyReason(baseDigest.noise),
    };
  } catch {
    return baseDigest;
  }
}
