import 'dotenv/config';
import http from 'node:http';
import path from 'node:path';
import express from 'express';
import { createServer as createViteServer } from 'vite';
import {
  AuthenticatedRequest,
  clearSessionCookie,
  createLocalUser,
  ensureDemoUser,
  requireAuth,
  setSessionCookie,
  signSessionToken,
  toPublicUser,
  verifyAccessToken,
  verifyPassword,
} from './src/server/auth';
import { loadDb, newId, saveDb } from './src/server/store';
import { dispatchEmail } from './src/server/mailer';
import { processDueScheduleSlots, purgeExpiredOtpVaultEntries, startScheduleWorker } from './src/server/worker';
import {
  executeAgentPrompt,
  generateQuickReplyDraft,
  QuickReplyGenerationError,
} from './src/server/geminiAgent';
import { isValidQuickReplyTone } from './src/shared/quickReply';
import { generateDigestBriefing } from './src/server/digestGenerator';
import {
  applyStopOnReplyToSchedules,
  cancelPendingSlots,
  materializeScheduleTimestamps,
  parseRecipientList,
  StopOnReplyResult,
  validateEmailAddress,
  validateScheduleInput,
} from './src/shared/scheduler';
import { categorizeMailRuleBased, detectOtpFast } from './src/shared/categorizer';
import { extractSuggestedActions } from './src/shared/actionExtractor';
import { sanitizeEmailHtmlBasic } from './src/shared/mailSanitizer';
import {
  CategoryDoc,
  ChatSessionDoc,
  DigestFilterScope,
  GapUnit,
  MailDoc,
  OtpVaultDoc,
  ScheduleDoc,
  ScheduleMode,
  ScheduleRuleInput,
} from './src/shared/types';

function sortChatSessions(sessions: ChatSessionDoc[]): ChatSessionDoc[] {
  return [...sessions].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });
}

let simulateIngestCursor = 0;

function buildSimulatedIncomingMail(
  userName: string,
  requestedKind?: string
): { fromName: string; fromEmail: string; subject: string; textBody: string } {
  const kinds = ['meeting', 'deadline', 'otp'] as const;
  const kind =
    requestedKind && kinds.includes(requestedKind as (typeof kinds)[number])
      ? requestedKind
      : kinds[simulateIngestCursor++ % kinds.length];

  if (kind === 'meeting') {
    return {
      fromName: 'Elena Vance',
      fromEmail: 'elena@partner.io',
      subject: 'Partner Sync: Q4 API Integration Walkthrough',
      textBody: `Hi ${userName.split(' ')[0] || 'there'},\n\nCould we meet this Thursday at 15:00 UTC to review the Q4 API integration checklist and confirm the webhook payload format?\n\nLet me know if that slot works or suggest an alternative.\n\nBest,\nElena`,
    };
  }

  if (kind === 'deadline') {
    const dueDate = new Date(Date.now() + 3 * 24 * 3600_000).toISOString().slice(0, 10);
    return {
      fromName: 'Marcus Lin',
      fromEmail: 'marcus@acme.dev',
      subject: `Security Review & SOC2 Sign-Off Due ${dueDate}`,
      textBody: `Hi ${userName.split(' ')[0] || 'there'},\n\nFriendly reminder that the quarterly production access audit and SOC2 sign-off are due by ${dueDate} at 17:00 UTC.\n\nCould you please confirm once your team's checklist is uploaded?\n\nThanks,\nMarcus`,
    };
  }

  const code = String(Math.floor(100000 + Math.random() * 899999));
  return {
    fromName: 'Cloudflare Auth',
    fromEmail: 'no-reply@cloudflare.com',
    subject: '[Cloudflare] Login verification code',
    textBody: `Your Cloudflare security verification code is ${code}. Valid for 10 minutes.`,
  };
}

async function createApp() {
  const app = express();
  const httpServer = http.createServer(app);
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '1mb' }));

  // Ensure demo user exists at startup
  await ensureDemoUser();
  startScheduleWorker(5000);

  // Health endpoint
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, timestamp: new Date().toISOString() });
  });

  // --- Auth Routes ---
  app.post('/api/auth/demo', async (req, res) => {
    try {
      const user = await ensureDemoUser();
      const token = signSessionToken(user);
      setSessionCookie(res, req, token);
      res.json({ user: toPublicUser(user), token });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Demo login failed' });
    }
  });

  app.post('/api/auth/register', async (req, res) => {
    try {
      const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
      const password = typeof req.body?.password === 'string' ? req.body.password : '';
      const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';

      if (!validateEmailAddress(email)) {
        res.status(400).json({ error: 'Please provide a valid email address.' });
        return;
      }
      if (password.length < 6) {
        res.status(400).json({ error: 'Password must be at least 6 characters.' });
        return;
      }

      const db = loadDb();
      if (db.users.some((u) => u.email.toLowerCase() === email)) {
        res.status(409).json({ error: 'An account with this email already exists.' });
        return;
      }

      const user = createLocalUser(email, password, name);
      await saveDb();
      const token = signSessionToken(user);
      setSessionCookie(res, req, token);
      res.status(201).json({ user: toPublicUser(user), token });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Registration failed' });
    }
  });

  app.post('/api/auth/login', async (req, res) => {
    try {
      const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
      const password = typeof req.body?.password === 'string' ? req.body.password : '';

      const db = loadDb();
      const user = db.users.find((u) => u.email.toLowerCase() === email);
      if (!user || !verifyPassword(password, user.passwordHash, user.passwordSalt)) {
        res.status(401).json({ error: 'Invalid email or password.' });
        return;
      }

      const token = signSessionToken(user);
      setSessionCookie(res, req, token);
      res.json({ user: toPublicUser(user), token });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Sign-in failed' });
    }
  });

  app.post('/api/auth/logout', (req, res) => {
    clearSessionCookie(res, req);
    res.json({ ok: true });
  });

  app.get('/api/auth/session', (req, res) => {
    const authHeader = req.headers.authorization;
    let token: string | null = null;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.slice(7).trim();
    } else {
      const cookieHeader = req.headers.cookie || '';
      for (const part of cookieHeader.split(';')) {
        const [k, ...rest] = part.trim().split('=');
        if (k === 'meridian_session') {
          token = decodeURIComponent(rest.join('='));
          break;
        }
      }
    }
    if (!token) {
      res.json({ authenticated: false, user: null });
      return;
    }
    const payload = verifyAccessToken(token);
    if (!payload) {
      res.json({ authenticated: false, user: null });
      return;
    }
    const db = loadDb();
    const user = db.users.find((u) => u.id === payload.sub);
    if (!user) {
      res.json({ authenticated: false, user: null });
      return;
    }
    res.json({ authenticated: true, user: toPublicUser(user) });
  });

  app.get('/api/auth/me', requireAuth, (req: AuthenticatedRequest, res) => {
    const db = loadDb();
    const user = db.users.find((u) => u.id === req.userId);
    if (!user) {
      res.status(404).json({ error: 'User not found.' });
      return;
    }
    res.json({ user: toPublicUser(user) });
  });

  // --- Mail Routes ---
  app.get('/api/mails', requireAuth, (req: AuthenticatedRequest, res) => {
    const db = loadDb();
    const mails = db.mails
      .filter((m) => m.userId === req.userId)
      .sort((a, b) => new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime());
    res.json({ mails });
  });

  app.post('/api/mails', requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const db = loadDb();
      const user = db.users.find((u) => u.id === req.userId);
      if (!user) {
        res.status(404).json({ error: 'User not found.' });
        return;
      }

      const rawTo = req.body?.to;
      const to = parseRecipientList(Array.isArray(rawTo) ? rawTo : String(rawTo || ''));
      const subject = typeof req.body?.subject === 'string' ? req.body.subject.trim() : '';
      const textBody = typeof req.body?.textBody === 'string' ? req.body.textBody.trim() : '';
      const saveAsDraft = Boolean(req.body?.saveAsDraft);

      if (!saveAsDraft && (!to.length || to.some((addr) => !validateEmailAddress(addr)))) {
        res.status(400).json({ error: 'Please specify valid recipient email address(es).' });
        return;
      }
      if (!subject) {
        res.status(400).json({ error: 'Subject is required.' });
        return;
      }

      if (saveAsDraft) {
        const draft: MailDoc = {
          id: newId('mail'),
          userId: user.id,
          threadId: newId('th'),
          folder: 'drafts',
          fromName: user.name,
          fromEmail: user.email,
          to,
          subject,
          snippet: textBody.replace(/\s+/g, ' ').slice(0, 140),
          textBody,
          receivedAt: new Date().toISOString(),
          isRead: true,
          isStarred: false,
          category: 'General',
          categorizedBy: 'default',
        };
        db.mails.unshift(draft);
        await saveDb();
        res.status(201).json({ mail: draft, transport: 'draft' });
        return;
      }

      const result = await dispatchEmail({
        userId: user.id,
        fromName: user.name,
        fromEmail: user.email,
        to,
        subject,
        textBody,
      });

      res.status(201).json({ mail: result.mail, transport: result.transport, messageId: result.messageId });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to send mail' });
    }
  });

  app.post('/api/mails/ingest', requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const db = loadDb();
      const user = db.users.find((u) => u.id === req.userId);
      if (!user) {
        res.status(404).json({ error: 'User not found.' });
        return;
      }

      const userCats = db.categories.filter((c) => c.userId === user.id);
      const customSubject = typeof req.body?.subject === 'string' ? req.body.subject.trim() : '';
      const requestedTemplate = typeof req.body?.template === 'string' ? req.body.template.trim().toLowerCase() : undefined;

      const incomingBatch: Array<{
        fromName: string;
        fromEmail: string;
        subject: string;
        textBody: string;
        htmlBody?: string;
        threadId?: string;
        inReplyTo?: string;
      }> = customSubject
        ? [
            {
              fromName: typeof req.body?.fromName === 'string' ? req.body.fromName.trim() : 'External Sender',
              fromEmail: typeof req.body?.fromEmail === 'string' ? req.body.fromEmail.trim() : 'notify@service.io',
              subject: customSubject,
              textBody: typeof req.body?.textBody === 'string' ? req.body.textBody : '',
              htmlBody: typeof req.body?.htmlBody === 'string' ? req.body.htmlBody : undefined,
              threadId: typeof req.body?.threadId === 'string' ? req.body.threadId.trim() : undefined,
              inReplyTo: typeof req.body?.inReplyTo === 'string' ? req.body.inReplyTo.trim() : undefined,
            },
          ]
        : [buildSimulatedIncomingMail(user.name, requestedTemplate)];

      const created: MailDoc[] = [];
      const createdVaultEntries: OtpVaultDoc[] = [];
      const userSchedules = db.schedules.filter((s) => s.userId === user.id);
      const stopOnReplySummary: StopOnReplyResult = {
        matchedSchedulesCount: 0,
        cancelledSlotsCount: 0,
        impactedScheduleIds: [],
        impactedRecipients: [],
      };

      for (const raw of incomingBatch) {
        const draftMail: MailDoc = {
          id: newId('mail'),
          userId: user.id,
          threadId: raw.threadId || newId('th'),
          inReplyTo: raw.inReplyTo,
          folder: 'inbox',
          fromName: raw.fromName,
          fromEmail: raw.fromEmail,
          to: [user.email],
          subject: raw.subject,
          snippet: raw.textBody.replace(/\s+/g, ' ').slice(0, 140),
          textBody: raw.textBody,
          htmlBody: raw.htmlBody ? sanitizeEmailHtmlBasic(raw.htmlBody) : undefined,
          receivedAt: new Date().toISOString(),
          isRead: false,
          isStarred: false,
          category: 'General',
          categorizedBy: 'default',
        };
        const catResult = categorizeMailRuleBased(draftMail, userCats);
        draftMail.category = catResult.category;
        draftMail.otpCode = catResult.otpCode;
        draftMail.categorizedBy = catResult.categorizedBy;

        let linkedVaultId: string | undefined;
        if (draftMail.category === 'OTP') {
          const otpInfo = detectOtpFast(draftMail);
          if (otpInfo.isOtp && otpInfo.otpCode) {
            const vaultEntry: OtpVaultDoc = {
              id: newId('otp'),
              userId: user.id,
              mailId: draftMail.id,
              serviceName: otpInfo.serviceName || raw.fromName,
              otpCode: otpInfo.otpCode,
              expiresAt: otpInfo.expiresAt || new Date(Date.now() + 15 * 60_000).toISOString(),
              isUsed: false,
              createdAt: draftMail.receivedAt,
            };
            db.otp_vault.unshift(vaultEntry);
            createdVaultEntries.push(vaultEntry);
            linkedVaultId = vaultEntry.id;
          }
        } else {
          const replyResult = applyStopOnReplyToSchedules(
            userSchedules,
            draftMail,
            draftMail.receivedAt
          );
          if (replyResult.cancelledSlotsCount > 0) {
            stopOnReplySummary.matchedSchedulesCount += replyResult.matchedSchedulesCount;
            stopOnReplySummary.cancelledSlotsCount += replyResult.cancelledSlotsCount;
            for (const sid of replyResult.impactedScheduleIds) {
              if (!stopOnReplySummary.impactedScheduleIds.includes(sid)) {
                stopOnReplySummary.impactedScheduleIds.push(sid);
              }
            }
            for (const rec of replyResult.impactedRecipients) {
              if (!stopOnReplySummary.impactedRecipients.includes(rec)) {
                stopOnReplySummary.impactedRecipients.push(rec);
              }
            }
          }
        }

        // Event-Time Action Extraction: populate up to 2 high-confidence Smart Action Pills
        draftMail.suggestedActions = extractSuggestedActions(draftMail, {
          otpVaultId: linkedVaultId,
          userName: user.name,
        });

        db.mails.unshift(draftMail);
        created.push(draftMail);
      }

      await saveDb();
      res.status(201).json({
        ingested: created,
        otpVaultEntries: createdVaultEntries,
        stopOnReply: stopOnReplySummary,
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Mail ingest failed' });
    }
  });

  // --- Auto-Expiring OTP Vault Routes ---
  app.get('/api/otp-vault/active', requireAuth, async (req: AuthenticatedRequest, res) => {
    await purgeExpiredOtpVaultEntries();
    const db = loadDb();
    const nowMs = Date.now();
    const active = db.otp_vault
      .filter((v) => v.userId === req.userId && !v.isUsed && new Date(v.expiresAt).getTime() > nowMs)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    res.json({ entries: active });
  });

  app.post('/api/otp-vault/:id/use', requireAuth, async (req: AuthenticatedRequest, res) => {
    const db = loadDb();
    const entry = db.otp_vault.find((v) => v.id === req.params.id && v.userId === req.userId);
    if (!entry) {
      res.status(404).json({ error: 'OTP vault entry not found.' });
      return;
    }
    entry.isUsed = true;
    entry.usedAt = new Date().toISOString();
    await saveDb();
    res.json({ entry });
  });

  app.patch('/api/mails/:id', requireAuth, async (req: AuthenticatedRequest, res) => {
    const db = loadDb();
    const mail = db.mails.find((m) => m.id === req.params.id && m.userId === req.userId);
    if (!mail) {
      res.status(404).json({ error: 'Mail not found.' });
      return;
    }

    if (typeof req.body?.isRead === 'boolean') mail.isRead = req.body.isRead;
    if (typeof req.body?.isStarred === 'boolean') mail.isStarred = req.body.isStarred;
    if (
      req.body?.folder === 'inbox' ||
      req.body?.folder === 'sent' ||
      req.body?.folder === 'drafts' ||
      req.body?.folder === 'archive'
    ) {
      mail.folder = req.body.folder;
    }
    if (typeof req.body?.category === 'string' && req.body.category.trim()) {
      mail.category = req.body.category.trim();
    }

    await saveDb();
    res.json({ mail });
  });

  // --- AI Quick Reply Draft Route ---
  app.post('/api/mails/:id/quick-reply', requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const tone = req.body?.tone;
      if (!isValidQuickReplyTone(tone)) {
        res.status(400).json({
          error: 'Invalid tone. Select Professional, Concise, or Friendly.',
        });
        return;
      }

      const db = loadDb();
      const user = db.users.find((u) => u.id === req.userId);
      const mail = db.mails.find((m) => m.id === req.params.id && m.userId === req.userId);
      if (!user || !mail) {
        res.status(404).json({ error: 'Mail not found.' });
        return;
      }

      const result = await generateQuickReplyDraft({
        mail,
        tone,
        userName: user.name,
        userEmail: user.email,
      });

      res.json(result);
    } catch (err) {
      const statusCode =
        err instanceof QuickReplyGenerationError ? err.statusCode : 500;
      res.status(statusCode).json({
        error: err instanceof Error ? err.message : 'Quick Reply generation failed.',
      });
    }
  });

  // --- Digest Briefing Route ---
  app.post('/api/digest/generate', requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const rawScope = req.body?.scope;
      const scope: DigestFilterScope =
        rawScope === 'today' || rawScope === 'all' ? rawScope : 'unread';
      const rawCategory =
        typeof req.body?.category === 'string' ? req.body.category.trim() : undefined;
      const category =
        rawCategory && rawCategory.toLowerCase() !== 'all'
          ? rawCategory.replace(/^@category:/i, '')
          : undefined;

      const db = loadDb();
      const userMails = db.mails.filter((m) => m.userId === req.userId);
      const digest = await generateDigestBriefing({
        mails: userMails,
        scope,
        category,
      });

      res.json({ digest });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Digest generation failed' });
    }
  });

  app.delete('/api/mails/:id', requireAuth, async (req: AuthenticatedRequest, res) => {
    const db = loadDb();
    const idx = db.mails.findIndex((m) => m.id === req.params.id && m.userId === req.userId);
    if (idx === -1) {
      res.status(404).json({ error: 'Mail not found.' });
      return;
    }
    db.mails.splice(idx, 1);
    await saveDb();
    res.json({ ok: true });
  });

  app.post('/api/mails/bulk-delete', requireAuth, async (req: AuthenticatedRequest, res) => {
    const db = loadDb();
    const ids = Array.isArray(req.body?.ids)
      ? req.body.ids.filter((x: unknown): x is string => typeof x === 'string')
      : null;
    const category = typeof req.body?.category === 'string' ? req.body.category.trim() : null;

    if (!ids && !category) {
      res.status(400).json({ error: 'Provide either ids or category for bulk deletion.' });
      return;
    }

    const beforeCount = db.mails.length;
    db.mails = db.mails.filter((m) => {
      if (m.userId !== req.userId) return true;
      if (ids) return !ids.includes(m.id);
      if (category) return m.category.toLowerCase() !== category.toLowerCase();
      return true;
    });
    const deletedCount = beforeCount - db.mails.length;
    await saveDb();
    res.json({ deletedCount });
  });

  // --- Schedule Routes ---
  app.get('/api/schedules', requireAuth, async (req: AuthenticatedRequest, res) => {
    await processDueScheduleSlots();
    const db = loadDb();
    const schedules = db.schedules
      .filter((s) => s.userId === req.userId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    res.json({ schedules });
  });

  app.post('/api/schedules/preview', requireAuth, (req: AuthenticatedRequest, res) => {
    const mode: ScheduleMode = req.body?.mode === 'advanced' ? 'advanced' : 'basic';
    const startUtc = typeof req.body?.startUtc === 'string' ? req.body.startUtc : '';
    const freq = Number(req.body?.freq ?? 1);
    const gapValue = Number(req.body?.gapValue ?? 0);
    const gapUnit: GapUnit =
      req.body?.gapUnit === 'minutes' || req.body?.gapUnit === 'days' ? req.body.gapUnit : 'hours';
    const recipients = parseRecipientList(req.body?.recipients ?? []);
    const subject = typeof req.body?.subject === 'string' ? req.body.subject : 'Preview';
    const body = typeof req.body?.body === 'string' ? req.body.body : 'Preview';

    const input: ScheduleRuleInput = {
      mode,
      startUtc,
      freq: mode === 'basic' ? 1 : freq,
      gapValue: mode === 'basic' ? 0 : gapValue,
      gapUnit,
      recipients,
      subject,
      body,
    };

    const error = validateScheduleInput(input);
    if (error) {
      res.status(400).json({ error });
      return;
    }

    const materialized = materializeScheduleTimestamps(input, 'preview');
    res.json({ timestampsUtc: materialized.timestampsUtc, slotCount: materialized.slots.length });
  });

  app.post('/api/schedules', requireAuth, async (req: AuthenticatedRequest, res) => {
    const mode: ScheduleMode = req.body?.mode === 'advanced' ? 'advanced' : 'basic';
    const startUtc = typeof req.body?.startUtc === 'string' ? req.body.startUtc : '';
    const freq = Number(req.body?.freq ?? 1);
    const gapValue = Number(req.body?.gapValue ?? 0);
    const gapUnit: GapUnit =
      req.body?.gapUnit === 'minutes' || req.body?.gapUnit === 'days' ? req.body.gapUnit : 'hours';
    const recipients = parseRecipientList(req.body?.recipients ?? []);
    const subject = typeof req.body?.subject === 'string' ? req.body.subject.trim() : '';
    const body = typeof req.body?.body === 'string' ? req.body.body.trim() : '';

    const stopOnReply =
      typeof req.body?.stopOnReply === 'boolean'
        ? req.body.stopOnReply
        : mode === 'advanced' && freq > 1;
    const threadId =
      typeof req.body?.threadId === 'string' && req.body.threadId.trim()
        ? req.body.threadId.trim()
        : newId('th');

    const rule: ScheduleRuleInput = {
      mode,
      startUtc,
      freq: mode === 'basic' ? 1 : freq,
      gapValue: mode === 'basic' ? 0 : gapValue,
      gapUnit,
      recipients,
      subject,
      body,
      stopOnReply,
      threadId,
    };

    const error = validateScheduleInput(rule);
    if (error) {
      res.status(400).json({ error });
      return;
    }

    const schedId = newId('sched');
    const { slots } = materializeScheduleTimestamps(rule, `${schedId}_slot`);
    const now = new Date().toISOString();

    const schedule: ScheduleDoc = {
      id: schedId,
      userId: req.userId!,
      ...rule,
      stopOnReply,
      threadId,
      status: 'active',
      startUtc: new Date(rule.startUtc).toISOString(),
      slots,
      createdAt: now,
      updatedAt: now,
    };

    const db = loadDb();
    db.schedules.unshift(schedule);
    await saveDb();
    // Run worker tick immediately in case startUtc is due right now
    await processDueScheduleSlots();
    const updated = db.schedules.find((s) => s.id === schedId) || schedule;
    res.status(201).json({ schedule: updated });
  });

  app.post('/api/schedules/:id/cancel-pending', requireAuth, async (req: AuthenticatedRequest, res) => {
    const db = loadDb();
    const idx = db.schedules.findIndex((s) => s.id === req.params.id && s.userId === req.userId);
    if (idx === -1) {
      res.status(404).json({ error: 'Schedule not found.' });
      return;
    }

    const { updated, cancelledCount } = cancelPendingSlots(db.schedules[idx]);
    db.schedules[idx] = updated;
    await saveDb();
    res.json({ schedule: updated, cancelledCount });
  });

  app.post('/api/schedules/:id/slots/:slotId/retry', requireAuth, async (req: AuthenticatedRequest, res) => {
    const db = loadDb();
    const schedule = db.schedules.find((s) => s.id === req.params.id && s.userId === req.userId);
    if (!schedule) {
      res.status(404).json({ error: 'Schedule not found.' });
      return;
    }

    const slot = schedule.slots.find((sl) => sl.id === req.params.slotId);
    if (!slot) {
      res.status(404).json({ error: 'Slot not found.' });
      return;
    }
    if (slot.status !== 'failed') {
      res.status(400).json({ error: 'Only failed slots can be retried.' });
      return;
    }

    slot.status = 'pending';
    slot.runAtUtc = new Date().toISOString();
    delete slot.error;
    schedule.status = 'active';
    schedule.updatedAt = new Date().toISOString();
    await saveDb();
    await processDueScheduleSlots();
    res.json({ schedule });
  });

  app.delete('/api/schedules/:id', requireAuth, async (req: AuthenticatedRequest, res) => {
    const db = loadDb();
    const idx = db.schedules.findIndex((s) => s.id === req.params.id && s.userId === req.userId);
    if (idx === -1) {
      res.status(404).json({ error: 'Schedule not found.' });
      return;
    }
    db.schedules.splice(idx, 1);
    await saveDb();
    res.json({ ok: true });
  });

  // --- Category Routes ---
  app.get('/api/categories', requireAuth, (req: AuthenticatedRequest, res) => {
    const db = loadDb();
    const categories = db.categories.filter((c) => c.userId === req.userId);
    res.json({ categories });
  });

  app.post('/api/categories', requireAuth, async (req: AuthenticatedRequest, res) => {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const description = typeof req.body?.description === 'string' ? req.body.description.trim() : '';
    const keywords = Array.isArray(req.body?.keywords)
      ? req.body.keywords.filter((x: unknown): x is string => typeof x === 'string' && x.trim().length > 0).map((s: string) => s.trim())
      : [];
    const senderPatterns = Array.isArray(req.body?.senderPatterns)
      ? req.body.senderPatterns.filter((x: unknown): x is string => typeof x === 'string' && x.trim().length > 0).map((s: string) => s.trim())
      : [];
    const aiEnabled = Boolean(req.body?.aiEnabled);

    if (!name) {
      res.status(400).json({ error: 'Category name is required.' });
      return;
    }

    const db = loadDb();
    if (db.categories.some((c) => c.userId === req.userId && c.name.toLowerCase() === name.toLowerCase())) {
      res.status(409).json({ error: 'A category with this name already exists.' });
      return;
    }

    const cat: CategoryDoc = {
      id: newId('cat'),
      userId: req.userId!,
      name,
      description,
      keywords,
      senderPatterns,
      isSystem: false,
      aiEnabled,
      createdAt: new Date().toISOString(),
    };
    db.categories.push(cat);
    await saveDb();
    res.status(201).json({ category: cat });
  });

  app.patch('/api/categories/:id', requireAuth, async (req: AuthenticatedRequest, res) => {
    const db = loadDb();
    const cat = db.categories.find((c) => c.id === req.params.id && c.userId === req.userId);
    if (!cat) {
      res.status(404).json({ error: 'Category not found.' });
      return;
    }
    if (cat.isSystem) {
      res.status(400).json({ error: 'System OTP detection category cannot be modified.' });
      return;
    }

    const prevName = cat.name;
    if (typeof req.body?.name === 'string' && req.body.name.trim()) {
      cat.name = req.body.name.trim();
    }
    if (typeof req.body?.description === 'string') cat.description = req.body.description.trim();
    if (Array.isArray(req.body?.keywords)) {
      cat.keywords = req.body.keywords.filter((x: unknown): x is string => typeof x === 'string').map((s: string) => s.trim()).filter(Boolean);
    }
    if (Array.isArray(req.body?.senderPatterns)) {
      cat.senderPatterns = req.body.senderPatterns.filter((x: unknown): x is string => typeof x === 'string').map((s: string) => s.trim()).filter(Boolean);
    }
    if (typeof req.body?.aiEnabled === 'boolean') cat.aiEnabled = req.body.aiEnabled;

    if (cat.name !== prevName) {
      for (const mail of db.mails) {
        if (mail.userId === req.userId && mail.category === prevName) {
          mail.category = cat.name;
        }
      }
    }

    await saveDb();
    res.json({ category: cat });
  });

  app.delete('/api/categories/:id', requireAuth, async (req: AuthenticatedRequest, res) => {
    const db = loadDb();
    const idx = db.categories.findIndex((c) => c.id === req.params.id && c.userId === req.userId);
    if (idx === -1) {
      res.status(404).json({ error: 'Category not found.' });
      return;
    }
    const cat = db.categories[idx];
    if (cat.isSystem) {
      res.status(400).json({ error: 'System OTP category cannot be deleted.' });
      return;
    }

    db.categories.splice(idx, 1);
    for (const mail of db.mails) {
      if (mail.userId === req.userId && mail.category === cat.name) {
        mail.category = 'General';
        mail.categorizedBy = 'default';
      }
    }
    await saveDb();
    res.json({ ok: true });
  });

  app.post('/api/categories/recategorize', requireAuth, async (req: AuthenticatedRequest, res) => {
    const db = loadDb();
    const userCats = db.categories.filter((c) => c.userId === req.userId);
    const userMails = db.mails.filter((m) => m.userId === req.userId && m.folder === 'inbox');
    let updatedCount = 0;

    for (const mail of userMails) {
      const next = categorizeMailRuleBased(mail, userCats);
      if (mail.category !== next.category || mail.otpCode !== next.otpCode) {
        mail.category = next.category;
        mail.otpCode = next.otpCode;
        mail.categorizedBy = next.categorizedBy;
        updatedCount += 1;
      }
    }

    await saveDb();
    res.json({ updatedCount, totalInbox: userMails.length });
  });

  // --- Chat History & AI Agent Routes ---
  app.get('/api/chats', requireAuth, (req: AuthenticatedRequest, res) => {
    const db = loadDb();
    const chats = sortChatSessions(db.chat_sessions.filter((c) => c.userId === req.userId));
    res.json({ chats });
  });

  app.post('/api/chats', requireAuth, async (req: AuthenticatedRequest, res) => {
    const title = typeof req.body?.title === 'string' && req.body.title.trim() ? req.body.title.trim() : 'New Workspace Session';
    const now = new Date().toISOString();
    const chat: ChatSessionDoc = {
      id: newId('chat'),
      userId: req.userId!,
      title,
      pinned: false,
      messages: [],
      createdAt: now,
      updatedAt: now,
    };
    const db = loadDb();
    db.chat_sessions.unshift(chat);
    await saveDb();
    res.status(201).json({ chat });
  });

  app.patch('/api/chats/:id', requireAuth, async (req: AuthenticatedRequest, res) => {
    const db = loadDb();
    const chat = db.chat_sessions.find((c) => c.id === req.params.id && c.userId === req.userId);
    if (!chat) {
      res.status(404).json({ error: 'Chat session not found.' });
      return;
    }

    if (typeof req.body?.pinned === 'boolean') chat.pinned = req.body.pinned;
    if (typeof req.body?.title === 'string' && req.body.title.trim()) chat.title = req.body.title.trim();

    if (typeof req.body?.messageId === 'string' && req.body?.actionPatch && typeof req.body.actionPatch === 'object') {
      const msg = chat.messages.find((m) => m.id === req.body.messageId);
      if (msg && msg.actionPreview) {
        msg.actionPreview = { ...msg.actionPreview, ...req.body.actionPatch };
      }
    }

    chat.updatedAt = new Date().toISOString();
    await saveDb();
    res.json({ chat });
  });

  app.delete('/api/chats/:id', requireAuth, async (req: AuthenticatedRequest, res) => {
    const db = loadDb();
    const idx = db.chat_sessions.findIndex((c) => c.id === req.params.id && c.userId === req.userId);
    if (idx === -1) {
      res.status(404).json({ error: 'Chat session not found.' });
      return;
    }
    db.chat_sessions.splice(idx, 1);
    await saveDb();
    res.json({ ok: true });
  });

  app.post('/api/agent/execute', requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt.trim() : '';
      const chatId = typeof req.body?.chatId === 'string' ? req.body.chatId : null;
      if (!prompt) {
        res.status(400).json({ error: 'Prompt cannot be empty.' });
        return;
      }

      const db = loadDb();
      const user = db.users.find((u) => u.id === req.userId);
      if (!user) {
        res.status(404).json({ error: 'User not found.' });
        return;
      }

      let chat = chatId
        ? db.chat_sessions.find((c) => c.id === chatId && c.userId === user.id)
        : null;

      const now = new Date().toISOString();
      if (!chat) {
        chat = {
          id: newId('chat'),
          userId: user.id,
          title: prompt.slice(0, 44) + (prompt.length > 44 ? '...' : ''),
          pinned: false,
          messages: [],
          createdAt: now,
          updatedAt: now,
        };
        db.chat_sessions.unshift(chat);
      }

      const userMessage = {
        id: newId('msg'),
        role: 'user' as const,
        content: prompt,
        createdAt: now,
      };
      chat.messages.push(userMessage);

      const userMails = db.mails.filter((m) => m.userId === user.id);
      const userCats = db.categories.filter((c) => c.userId === user.id);
      const userOtpVault = db.otp_vault.filter((v) => v.userId === user.id);

      const result = await executeAgentPrompt({
        prompt,
        userId: user.id,
        userEmail: user.email,
        userName: user.name,
        mails: userMails,
        categories: userCats,
        otpVault: userOtpVault,
      });

      const assistantMessage = {
        id: newId('msg'),
        role: 'assistant' as const,
        content: result.replyText,
        createdAt: new Date().toISOString(),
        requiresTriggerHint: result.requiresTriggerHint,
        actionPreview: result.actionPreview,
      };
      chat.messages.push(assistantMessage);

      if (chat.messages.length === 2 && chat.title === 'New Workspace Session') {
        chat.title = prompt.slice(0, 44) + (prompt.length > 44 ? '...' : '');
      }
      chat.updatedAt = new Date().toISOString();
      await saveDb();

      res.json({ chat, assistantMessage });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Agent execution failed';
      res.status(500).json({ error: msg });
    }
  });

  // --- Vite / Static Hosting ---
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: { server: httpServer },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const port = Number(process.env.PORT || 3000);
  httpServer.listen(port, '0.0.0.0', () => {
    console.log(`Meridian Mail Workspace listening on http://0.0.0.0:${port}`);
  });
}

void createApp();
