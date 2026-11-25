import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  CategoryDoc,
  ChatSessionDoc,
  MailDoc,
  OtpVaultDoc,
  ScheduleDoc,
  UserDoc,
} from '../shared/types';
import { materializeScheduleTimestamps } from '../shared/scheduler';
import { sanitizeEmailHtmlBasic } from '../shared/mailSanitizer';
import { extractSuggestedActions } from '../shared/actionExtractor';

export interface DatabaseCollections {
  users: UserDoc[];
  mails: MailDoc[];
  otp_vault: OtpVaultDoc[];
  schedules: ScheduleDoc[];
  categories: CategoryDoc[];
  chat_sessions: ChatSessionDoc[];
}

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DB_PATH = path.join(DATA_DIR, 'db.json');

let dbCache: DatabaseCollections | null = null;
let writeQueue: Promise<void> = Promise.resolve();

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

export function loadDb(): DatabaseCollections {
  if (dbCache) return dbCache;
  ensureDataDir();
  if (fs.existsSync(DB_PATH)) {
    try {
      const raw = fs.readFileSync(DB_PATH, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<DatabaseCollections>;
      const rawSchedules = Array.isArray(parsed.schedules) ? parsed.schedules : [];
      const rawMails = Array.isArray(parsed.mails) ? parsed.mails : [];
      const rawOtpVault = Array.isArray(parsed.otp_vault) ? parsed.otp_vault : [];
      const rawUsers = Array.isArray(parsed.users) ? parsed.users : [];
      dbCache = {
        users: rawUsers,
        mails: rawMails.map((m) => {
          if (Array.isArray(m.suggestedActions)) return m;
          const matchingVault = rawOtpVault.find((v) => v.mailId === m.id && v.userId === m.userId);
          const mailUser = rawUsers.find((u) => u.id === m.userId);
          return {
            ...m,
            suggestedActions: extractSuggestedActions(m, {
              otpVaultId: matchingVault?.id,
              userName: mailUser?.name,
            }),
          };
        }),
        otp_vault: rawOtpVault,
        schedules: rawSchedules.map((s) => ({
          ...s,
          stopOnReply: typeof s.stopOnReply === 'boolean' ? s.stopOnReply : s.freq > 1,
          status:
            s.status ||
            (s.slots?.some((sl) => sl.status === 'pending' || sl.status === 'processing')
              ? 'active'
              : 'completed'),
        })),
        categories: Array.isArray(parsed.categories) ? parsed.categories : [],
        chat_sessions: Array.isArray(parsed.chat_sessions) ? parsed.chat_sessions : [],
      };
      return dbCache;
    } catch {
      // Fall through to fresh database initialization if file is corrupted
    }
  }
  dbCache = {
    users: [],
    mails: [],
    otp_vault: [],
    schedules: [],
    categories: [],
    chat_sessions: [],
  };
  persistDbSync();
  return dbCache;
}

function persistDbSync(): void {
  if (!dbCache) return;
  ensureDataDir();
  const tmpPath = `${DB_PATH}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(dbCache, null, 2), 'utf-8');
  fs.renameSync(tmpPath, DB_PATH);
}

export async function saveDb(): Promise<void> {
  writeQueue = writeQueue.then(() => {
    persistDbSync();
  });
  return writeQueue;
}

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(6).toString('hex')}`;
}

export function seedUserWorkspace(userId: string, userEmail: string, userName: string): void {
  const db = loadDb();
  const now = Date.now();
  const hoursAgo = (h: number) => new Date(now - h * 3600_000).toISOString();
  const hoursFromNow = (h: number) => new Date(now + h * 3600_000).toISOString();

  // Seed categories if user has none
  if (!db.categories.some((c) => c.userId === userId)) {
    const categories: CategoryDoc[] = [
      {
        id: newId('cat'),
        userId,
        name: 'OTP',
        description: 'Fast deterministic detection for 4-8 digit verification codes, 2FA tokens, and login passcodes.',
        keywords: ['otp', 'verification code', 'passcode', '2fa', 'security code'],
        senderPatterns: ['noreply', 'verify', 'security', 'auth'],
        isSystem: true,
        aiEnabled: false,
        createdAt: hoursAgo(72),
      },
      {
        id: newId('cat'),
        userId,
        name: 'Finance',
        description: 'Invoices, billing statements, payouts, and tax receipts.',
        keywords: ['invoice', 'billing', 'receipt', 'payout', 'statement', 'payment'],
        senderPatterns: ['billing@', 'receipts@', 'stripe.com', 'mercury.com'],
        isSystem: false,
        aiEnabled: true,
        createdAt: hoursAgo(72),
      },
      {
        id: newId('cat'),
        userId,
        name: 'Engineering',
        description: 'Deployments, pull requests, CI/CD alerts, and incident notices.',
        keywords: ['deploy', 'pull request', 'pipeline', 'incident', 'release', 'build'],
        senderPatterns: ['github.com', 'vercel.com', 'linear.app'],
        isSystem: false,
        aiEnabled: true,
        createdAt: hoursAgo(72),
      },
      {
        id: newId('cat'),
        userId,
        name: 'Product',
        description: 'Roadmap reviews, design critiques, sprint updates, and customer feedback.',
        keywords: ['roadmap', 'sprint', 'launch', 'figma', 'milestone', 'q4'],
        senderPatterns: ['northstar.io', 'acme.dev'],
        isSystem: false,
        aiEnabled: true,
        createdAt: hoursAgo(72),
      },
    ];
    db.categories.push(...categories);
  }

  // Seed mails if user has none
  if (!db.mails.some((m) => m.userId === userId)) {
    const seededMails: MailDoc[] = [
      {
        id: newId('mail'),
        userId,
        threadId: 'th_github_otp',
        folder: 'inbox',
        fromName: 'GitHub Security',
        fromEmail: 'noreply@github.com',
        to: [userEmail],
        subject: '[GitHub] Please verify your device',
        snippet: 'Verification code: 482913 — Enter this code to authorize your new browser session.',
        textBody:
          'Hey there,\n\nA sign-in attempt requires further verification.\n\nVerification code: 482913\n\nThis code expires in 10 minutes. If you did not initiate this request, rotate your credentials immediately.',
        htmlBody: sanitizeEmailHtmlBasic(
          `<div style="font-family: sans-serif; color: #0f172a;"><p>Hey there,</p><p>A sign-in attempt requires further verification.</p><div style="padding: 12px 16px; background: #f1f5f9; border: 1px solid #cbd5e1; border-radius: 8px; font-family: monospace; font-size: 20px; font-weight: 700; letter-spacing: 3px; display: inline-block;">482913</div><p style="margin-top: 12px; color: #475569;">This code expires in 10 minutes.</p></div>`
        ),
        receivedAt: hoursAgo(0.4),
        isRead: false,
        isStarred: false,
        category: 'OTP',
        otpCode: '482913',
        categorizedBy: 'otp-rule',
      },
      {
        id: newId('mail'),
        userId,
        threadId: 'th_stripe_otp',
        folder: 'inbox',
        fromName: 'Stripe Auth',
        fromEmail: 'verify@stripe.com',
        to: [userEmail],
        subject: 'Your Stripe 2FA one-time passcode',
        snippet: 'Use one-time passcode 774120 to access your Stripe Dashboard.',
        textBody:
          'Your Stripe one-time passcode is 774120.\n\nEnter this 6-digit security code within 5 minutes to confirm your dashboard sign-in.',
        htmlBody: sanitizeEmailHtmlBasic(
          `<div><p>Your Stripe one-time passcode is <strong>774120</strong>.</p><p>Enter this 6-digit security code within 5 minutes to confirm your dashboard sign-in.</p></div>`
        ),
        receivedAt: hoursAgo(1.2),
        isRead: false,
        isStarred: false,
        category: 'OTP',
        otpCode: '774120',
        categorizedBy: 'otp-rule',
      },
      {
        id: newId('mail'),
        userId,
        threadId: 'th_aws_otp',
        folder: 'inbox',
        fromName: 'AWS IAM Identity',
        fromEmail: 'no-reply@signin.aws',
        to: [userEmail],
        subject: 'AWS verification code: 901482',
        snippet: 'Your AWS login verification code is 901482.',
        textBody:
          'Hello,\n\nYour AWS login verification code is 901482.\nDo not share this MFA code with anyone.',
        receivedAt: hoursAgo(3.5),
        isRead: true,
        isStarred: false,
        category: 'OTP',
        otpCode: '901482',
        categorizedBy: 'otp-rule',
      },
      {
        id: newId('mail'),
        userId,
        threadId: 'th_sarah_q4',
        folder: 'inbox',
        fromName: 'Sarah Chen',
        fromEmail: 'sarah@northstar.io',
        to: [userEmail],
        subject: 'Q4 Launch Timeline & Customer Beta Cohort',
        snippet: 'Can we lock the beta rollout schedule for Thursday morning UTC and confirm the 12 partner contacts?',
        textBody:
          `Hi ${userName},\n\nCan we lock the Q4 beta rollout schedule for Thursday morning UTC and confirm the 12 partner contacts?\n\nWe also need to review the onboarding email sequence before sending out the final milestone invite.\n\nBest,\nSarah`,
        htmlBody: sanitizeEmailHtmlBasic(
          `<div><p>Hi ${userName},</p><p>Can we lock the <strong>Q4 beta rollout schedule</strong> for Thursday morning UTC and confirm the 12 partner contacts?</p><p>We also need to review the onboarding email sequence before sending out the final milestone invite.</p><p>Best,<br/>Sarah Chen · Product Lead</p></div>`
        ),
        receivedAt: hoursAgo(2.1),
        isRead: false,
        isStarred: true,
        category: 'Product',
        categorizedBy: 'custom-rule',
      },
      {
        id: newId('mail'),
        userId,
        threadId: 'th_stripe_inv',
        folder: 'inbox',
        fromName: 'Stripe Billing',
        fromEmail: 'receipts@stripe.com',
        to: [userEmail],
        subject: 'Invoice #INV-2026-1142 — Cloud Infrastructure',
        snippet: 'Your November billing statement for $480.00 has been paid.',
        textBody:
          'Receipt from Meridian Cloud Infrastructure.\n\nInvoice: #INV-2026-1142\nAmount Paid: $480.00 USD\nBilling Period: Nov 1 - Nov 30, 2026\nStatus: Paid',
        htmlBody: sanitizeEmailHtmlBasic(
          `<div><h3>Invoice #INV-2026-1142</h3><table style="border: 1px solid #e2e8f0; width: 100%;"><tr><td style="padding: 8px; border-bottom: 1px solid #e2e8f0;">Compute Cluster</td><td style="padding: 8px; border-bottom: 1px solid #e2e8f0; text-align: right;">$340.00</td></tr><tr><td style="padding: 8px; border-bottom: 1px solid #e2e8f0;">MongoDB Atlas Dedicated</td><td style="padding: 8px; border-bottom: 1px solid #e2e8f0; text-align: right;">$140.00</td></tr><tr><td style="padding: 8px; font-weight: 700;">Total Paid</td><td style="padding: 8px; font-weight: 700; text-align: right;">$480.00</td></tr></table></div>`
        ),
        receivedAt: hoursAgo(5.0),
        isRead: true,
        isStarred: false,
        category: 'Finance',
        categorizedBy: 'custom-rule',
      },
      {
        id: newId('mail'),
        userId,
        threadId: 'th_alex_eng',
        folder: 'inbox',
        fromName: 'Alex Rivera',
        fromEmail: 'alex@acme.dev',
        to: [userEmail],
        subject: 'Release v2.14 pipeline green — ready for canary deploy',
        snippet: 'All integration checks passed on the scheduler worker. Ready whenever you give the green light.',
        textBody:
          'Team,\n\nAll integration checks passed on the scheduler worker build #894. Atomic slot claiming handled 500 concurrent ticks with zero duplicates.\n\nReady whenever you give the green light for canary deploy.\n\n— Alex',
        receivedAt: hoursAgo(6.8),
        isRead: false,
        isStarred: true,
        category: 'Engineering',
        categorizedBy: 'custom-rule',
      },
      {
        id: newId('mail'),
        userId,
        threadId: 'th_mercury',
        folder: 'inbox',
        fromName: 'Mercury Treasury',
        fromEmail: 'notifications@mercury.com',
        to: [userEmail],
        subject: 'Monthly payout & treasury statement available',
        snippet: 'Your November treasury statement and payout summary are ready to review.',
        textBody:
          'Your November treasury statement and payout summary are ready for download in your Mercury account.',
        receivedAt: hoursAgo(18.5),
        isRead: true,
        isStarred: false,
        category: 'Finance',
        categorizedBy: 'custom-rule',
      },
      {
        id: newId('mail'),
        userId,
        threadId: 'th_linear_pr',
        folder: 'inbox',
        fromName: 'Linear Updates',
        fromEmail: 'updates@linear.app',
        to: [userEmail],
        subject: 'ENG-412: Implement HTML email sanitization boundary',
        snippet: 'Alex Rivera moved ENG-412 to Ready for Review after PR #318 passed.',
        textBody:
          'ENG-412 moved to Ready for Review. Pull request #318 adds isolated email rendering and DOMPurify allowlists.',
        receivedAt: hoursAgo(26),
        isRead: true,
        isStarred: false,
        category: 'Engineering',
        categorizedBy: 'custom-rule',
      },
      {
        id: newId('mail'),
        userId,
        threadId: 'th_sent_1',
        folder: 'sent',
        fromName: userName,
        fromEmail: userEmail,
        to: ['alex@acme.dev'],
        subject: 'Re: Release v2.14 canary checklist',
        snippet: 'Looks solid — proceed with the 10% rollout after 14:00 UTC.',
        textBody: 'Looks solid — proceed with the 10% rollout after 14:00 UTC and share latency metrics.',
        receivedAt: hoursAgo(4.2),
        isRead: true,
        isStarred: false,
        category: 'Engineering',
        categorizedBy: 'custom-rule',
      },
    ];
    db.mails.push(...seededMails);
  }

  // Seed an active unconsumed OTP vault entry matching the most recent OTP email if vault is empty
  if (!db.otp_vault.some((v) => v.userId === userId)) {
    const latestOtpMail = db.mails.find((m) => m.userId === userId && m.category === 'OTP');
    if (latestOtpMail) {
      db.otp_vault.push({
        id: newId('otp'),
        userId,
        mailId: latestOtpMail.id,
        serviceName: 'GitHub',
        otpCode: latestOtpMail.otpCode || '482913',
        expiresAt: new Date(now + 12 * 60_000).toISOString(),
        isUsed: false,
        createdAt: latestOtpMail.receivedAt,
      });
    }
  }

  // Ensure every seeded inbox mail carries event-extracted suggestedActions
  for (const mail of db.mails) {
    if (mail.userId === userId && !mail.suggestedActions) {
      const vault = db.otp_vault.find((v) => v.mailId === mail.id && v.userId === userId);
      mail.suggestedActions = extractSuggestedActions(mail, {
        otpVaultId: vault?.id,
        userName,
      });
    }
  }

  // Seed schedules if user has none
  if (!db.schedules.some((s) => s.userId === userId)) {
    const sched1Id = newId('sched');
    const preview1 = materializeScheduleTimestamps(
      {
        mode: 'advanced',
        startUtc: hoursAgo(2),
        freq: 3,
        gapValue: 4,
        gapUnit: 'hours',
        recipients: ['sarah@northstar.io', 'alex@acme.dev'],
      },
      `${sched1Id}_slot`
    );
    // Mark runIndex 1 slots as already sent so user can see mixed sent + pending slots
    preview1.slots = preview1.slots.map((slot) =>
      slot.runIndex === 1
        ? { ...slot, status: 'sent', sentAtUtc: hoursAgo(1.98) }
        : slot
    );

    const sched2Id = newId('sched');
    const preview2 = materializeScheduleTimestamps(
      {
        mode: 'basic',
        startUtc: hoursAgo(5),
        freq: 1,
        gapValue: 0,
        gapUnit: 'minutes',
        recipients: ['ops@acme.dev'],
      },
      `${sched2Id}_slot`
    );
    preview2.slots = preview2.slots.map((slot) => ({
      ...slot,
      status: 'failed',
      error: 'SMTP 421 Temporary connection timeout — ready for manual retry',
    }));

    const sched3Id = newId('sched');
    const preview3 = materializeScheduleTimestamps(
      {
        mode: 'advanced',
        startUtc: hoursFromNow(12),
        freq: 3,
        gapValue: 3,
        gapUnit: 'days',
        recipients: ['recruiter@northstar.io', 'sarah@northstar.io'],
      },
      `${sched3Id}_slot`
    );

    db.schedules.push(
      {
        id: sched3Id,
        userId,
        mode: 'advanced',
        startUtc: hoursFromNow(12),
        freq: 3,
        gapValue: 3,
        gapUnit: 'days',
        recipients: ['recruiter@northstar.io', 'sarah@northstar.io'],
        subject: 'Follow-up: Q4 Partnership & Role Alignment',
        body: 'Hi there, checking back in on our partnership proposal. Happy to hop on a quick call whenever convenient.',
        stopOnReply: true,
        threadId: 'th_followup_recruiter',
        status: 'active',
        slots: preview3.slots,
        createdAt: hoursAgo(1),
        updatedAt: hoursAgo(1),
      },
      {
        id: sched1Id,
        userId,
        mode: 'advanced',
        startUtc: hoursAgo(2),
        freq: 3,
        gapValue: 4,
        gapUnit: 'hours',
        recipients: ['sarah@northstar.io', 'alex@acme.dev'],
        subject: 'Q4 Beta Rollout Checkpoint',
        body: 'Quick automated checkpoint: please share any blocking issues ahead of the Thursday cohort release.',
        stopOnReply: true,
        threadId: 'th_sched_beta',
        status: 'active',
        slots: preview1.slots,
        createdAt: hoursAgo(3),
        updatedAt: hoursAgo(1.98),
      },
      {
        id: sched2Id,
        userId,
        mode: 'basic',
        startUtc: hoursAgo(5),
        freq: 1,
        gapValue: 0,
        gapUnit: 'minutes',
        recipients: ['ops@acme.dev'],
        subject: 'Weekly Uptime & Cost Digest',
        body: 'Attached summary of weekly API latency and MongoDB cluster utilization.',
        stopOnReply: false,
        threadId: 'th_sched_uptime',
        status: 'completed',
        slots: preview2.slots,
        createdAt: hoursAgo(6),
        updatedAt: hoursAgo(5),
      }
    );
  }

  // Seed chat sessions if user has none
  if (!db.chat_sessions.some((c) => c.userId === userId)) {
    db.chat_sessions.push(
      {
        id: newId('chat'),
        userId,
        title: 'Q4 Launch Cadence & Reminders',
        pinned: true,
        createdAt: hoursAgo(12),
        updatedAt: hoursAgo(1.5),
        messages: [
          {
            id: newId('msg'),
            role: 'user',
            content: '/schedule Send Q4 rollout reminder to @sarah@northstar.io 2 times every 4 hours',
            createdAt: hoursAgo(1.6),
          },
          {
            id: newId('msg'),
            role: 'assistant',
            content: 'Prepared a 2-run schedule in UTC targeting sarah@northstar.io.',
            createdAt: hoursAgo(1.5),
            actionPreview: {
              type: 'schedule_preview',
              rule: {
                mode: 'advanced',
                startUtc: hoursFromNow(2),
                freq: 2,
                gapValue: 4,
                gapUnit: 'hours',
                recipients: ['sarah@northstar.io'],
                subject: 'Q4 Rollout Reminder',
                body: 'Hi Sarah, checking in on the Q4 beta rollout cohort list before launch.',
              },
              timestampsUtc: [hoursFromNow(2), hoursFromNow(6)],
              confirmed: true,
            },
          },
        ],
      },
      {
        id: newId('chat'),
        userId,
        title: 'Weekly OTP Hygiene Audit',
        pinned: false,
        createdAt: hoursAgo(24),
        updatedAt: hoursAgo(8),
        messages: [
          {
            id: newId('msg'),
            role: 'user',
            content: '/cleanup-otp Preview @category:OTP emails',
            createdAt: hoursAgo(8.1),
          },
          {
            id: newId('msg'),
            role: 'assistant',
            content: 'Found 3 verification emails tagged under OTP. Review below before deleting.',
            createdAt: hoursAgo(8),
          },
        ],
      }
    );
  }

  persistDbSync();
}
