import {
  CategoryDoc,
  ChatMessage,
  ChatSessionDoc,
  DigestFilterScope,
  GapUnit,
  MailDoc,
  OtpVaultDoc,
  PublicUser,
  QuickReplyTone,
  ScheduleDoc,
  ScheduleMode,
} from '../shared/types';
import { categorizeMailRuleBased, detectOtpFast } from '../shared/categorizer';
import { extractSuggestedActions } from '../shared/actionExtractor';
import { generateRuleBasedDigest } from '../shared/digest';
import { parseAgentTriggers } from '../shared/agentTriggers';
import {
  applyStopOnReplyToSchedules,
  cancelPendingSlots,
  materializeScheduleTimestamps,
  parseRecipientList,
  validateScheduleInput,
} from '../shared/scheduler';

interface LocalWorkspaceState {
  user: PublicUser;
  authenticated: boolean;
  mails: MailDoc[];
  otpVault: OtpVaultDoc[];
  schedules: ScheduleDoc[];
  categories: CategoryDoc[];
  chats: ChatSessionDoc[];
}

const STORAGE_KEY = 'meridian_local_fallback_v1';
let memoryState: LocalWorkspaceState | null = null;
let idCounter = 1;

function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}_local_${Date.now().toString(36)}_${idCounter}`;
}

function createInitialState(): LocalWorkspaceState {
  const now = Date.now();
  const hoursAgo = (h: number) => new Date(now - h * 3600_000).toISOString();
  const hoursFromNow = (h: number) => new Date(now + h * 3600_000).toISOString();

  const user: PublicUser = {
    id: 'user_demo_primary',
    email: 'abhaytailor6@velomail.app',
    name: 'Abhay Tailor',
    authProvider: 'demo',
  };

  const categories: CategoryDoc[] = [
    {
      id: 'cat_local_otp',
      userId: user.id,
      name: 'OTP',
      description:
        'Fast deterministic detection for 4-8 digit verification codes, 2FA tokens, and login passcodes.',
      keywords: ['otp', 'verification code', 'passcode', '2fa', 'security code'],
      senderPatterns: ['noreply', 'verify', 'security', 'auth'],
      isSystem: true,
      aiEnabled: false,
      createdAt: hoursAgo(72),
    },
    {
      id: 'cat_local_finance',
      userId: user.id,
      name: 'Finance',
      description: 'Invoices, billing statements, payouts, and tax receipts.',
      keywords: ['invoice', 'billing', 'receipt', 'payout', 'statement', 'payment'],
      senderPatterns: ['billing@', 'receipts@', 'stripe.com', 'mercury.com'],
      isSystem: false,
      aiEnabled: true,
      createdAt: hoursAgo(72),
    },
    {
      id: 'cat_local_eng',
      userId: user.id,
      name: 'Engineering',
      description: 'Deployments, pull requests, CI/CD alerts, and incident notices.',
      keywords: ['deploy', 'pull request', 'pipeline', 'incident', 'release', 'build'],
      senderPatterns: ['github.com', 'vercel.com', 'linear.app'],
      isSystem: false,
      aiEnabled: true,
      createdAt: hoursAgo(72),
    },
    {
      id: 'cat_local_product',
      userId: user.id,
      name: 'Product',
      description: 'Roadmap reviews, design critiques, sprint updates, and customer feedback.',
      keywords: ['roadmap', 'sprint', 'launch', 'figma', 'milestone', 'q4'],
      senderPatterns: ['northstar.io', 'acme.dev'],
      isSystem: false,
      aiEnabled: true,
      createdAt: hoursAgo(72),
    },
  ];

  const mails: MailDoc[] = [
    {
      id: 'mail_local_1',
      userId: user.id,
      threadId: 'th_github_otp',
      folder: 'inbox',
      fromName: 'GitHub Security',
      fromEmail: 'noreply@github.com',
      to: [user.email],
      subject: '[GitHub] Please verify your device',
      snippet: 'Verification code: 482913 — Enter this code to authorize your new browser session.',
      textBody:
        'Hey there,\n\nA sign-in attempt requires further verification.\n\nVerification code: 482913\n\nThis code expires in 10 minutes.',
      receivedAt: hoursAgo(0.4),
      isRead: false,
      isStarred: false,
      category: 'OTP',
      otpCode: '482913',
      categorizedBy: 'otp-rule',
    },
    {
      id: 'mail_local_2',
      userId: user.id,
      threadId: 'th_elena_sync',
      folder: 'inbox',
      fromName: 'Elena Vance',
      fromEmail: 'elena@partner.io',
      to: [user.email],
      subject: 'Partner Sync: Q4 API Integration Walkthrough',
      snippet:
        'Hi Abhay, Could we meet this Thursday at 15:00 UTC to review the Q4 API integration checklist?',
      textBody:
        'Hi Abhay,\n\nCould we meet this Thursday at 15:00 UTC to review the Q4 API integration checklist and confirm the webhook payload format?\n\nLet me know if that slot works or suggest an alternative.\n\nBest,\nElena',
      receivedAt: hoursAgo(1.6),
      isRead: false,
      isStarred: true,
      category: 'Product',
      categorizedBy: 'custom-rule',
    },
    {
      id: 'mail_local_3',
      userId: user.id,
      threadId: 'th_marcus_soc2',
      folder: 'inbox',
      fromName: 'Marcus Lin',
      fromEmail: 'marcus@acme.dev',
      to: [user.email],
      subject: 'Security Review & SOC2 Sign-Off Due 2026-11-27',
      snippet:
        'Friendly reminder that the quarterly production access audit and SOC2 sign-off are due by 2026-11-27.',
      textBody:
        'Hi Abhay,\n\nFriendly reminder that the quarterly production access audit and SOC2 sign-off are due by 2026-11-27 at 17:00 UTC. Could you please confirm your review?',
      receivedAt: hoursAgo(2.8),
      isRead: false,
      isStarred: false,
      category: 'Product',
      categorizedBy: 'custom-rule',
    },
    {
      id: 'mail_local_4',
      userId: user.id,
      threadId: 'th_stripe_inv',
      folder: 'inbox',
      fromName: 'Stripe Billing',
      fromEmail: 'receipts@stripe.com',
      to: [user.email],
      subject: 'Invoice #INV-2026-1142 — Cloud Infrastructure',
      snippet: 'Your November billing statement for $480.00 has been paid.',
      textBody:
        'Receipt from Cloud Infrastructure.\n\nInvoice: #INV-2026-1142\nAmount Paid: $480.00 USD\nBilling Period: Nov 1 - Nov 30, 2026\nStatus: Paid',
      receivedAt: hoursAgo(5.0),
      isRead: true,
      isStarred: false,
      category: 'Finance',
      categorizedBy: 'custom-rule',
    },
    {
      id: 'mail_local_5',
      userId: user.id,
      threadId: 'th_alex_eng',
      folder: 'inbox',
      fromName: 'Alex Rivera',
      fromEmail: 'alex@acme.dev',
      to: [user.email],
      subject: 'Release v2.14 pipeline green — ready for canary deploy',
      snippet:
        'All integration checks passed on the scheduler worker. Ready whenever you give the green light.',
      textBody:
        'Team,\n\nAll integration checks passed on the scheduler worker build #894. Ready whenever you give the green light for canary deploy.\n\n— Alex',
      receivedAt: hoursAgo(6.8),
      isRead: false,
      isStarred: true,
      category: 'Engineering',
      categorizedBy: 'custom-rule',
    },
  ];

  const otpVault: OtpVaultDoc[] = [
    {
      id: 'otp_local_1',
      userId: user.id,
      mailId: 'mail_local_1',
      serviceName: 'GitHub',
      otpCode: '482913',
      expiresAt: new Date(now + 12 * 60_000).toISOString(),
      isUsed: false,
      createdAt: mails[0].receivedAt,
    },
  ];

  for (const mail of mails) {
    const linkedVault = otpVault.find((v) => v.mailId === mail.id);
    mail.suggestedActions = extractSuggestedActions(mail, {
      otpVaultId: linkedVault?.id,
      userName: user.name,
    });
  }

  const schedPreview = materializeScheduleTimestamps(
    {
      mode: 'advanced',
      startUtc: hoursFromNow(12),
      freq: 2,
      gapValue: 4,
      gapUnit: 'hours',
      recipients: ['sarah@northstar.io', 'alex@acme.dev'],
    },
    'sched_local_1_slot'
  );

  const schedules: ScheduleDoc[] = [
    {
      id: 'sched_local_1',
      userId: user.id,
      mode: 'advanced',
      startUtc: hoursFromNow(12),
      freq: 2,
      gapValue: 4,
      gapUnit: 'hours',
      recipients: ['sarah@northstar.io', 'alex@acme.dev'],
      subject: 'Q4 Beta Rollout Checkpoint',
      body: 'Quick automated checkpoint: please share any blocking issues ahead of the Thursday release.',
      stopOnReply: true,
      threadId: 'th_sched_beta',
      status: 'active',
      slots: schedPreview.slots,
      createdAt: hoursAgo(1),
      updatedAt: hoursAgo(1),
    },
  ];

  const chats: ChatSessionDoc[] = [
    {
      id: 'chat_local_1',
      userId: user.id,
      title: 'Q4 Launch Cadence & Reminders',
      pinned: true,
      createdAt: hoursAgo(12),
      updatedAt: hoursAgo(1.5),
      messages: [
        {
          id: 'msg_local_1',
          role: 'user',
          content: '/schedule Send Q4 rollout reminder to @sarah@northstar.io 2 times every 4 hours',
          createdAt: hoursAgo(1.6),
        },
        {
          id: 'msg_local_2',
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
  ];

  return {
    user,
    authenticated: true,
    mails,
    otpVault,
    schedules,
    categories,
    chats,
  };
}

function getState(): LocalWorkspaceState {
  if (memoryState) return memoryState;
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        memoryState = JSON.parse(raw) as LocalWorkspaceState;
        return memoryState;
      }
    }
  } catch {
    // Ignore storage read errors and fall back to fresh in-memory state
  }
  memoryState = createInitialState();
  saveState(memoryState);
  return memoryState;
}

function saveState(state: LocalWorkspaceState): void {
  memoryState = state;
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    }
  } catch {
    // Ignore storage write errors (e.g., private browsing quota)
  }
}

export function resetLocalFallbackState(): void {
  memoryState = null;
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // Ignore
  }
}

function buildLocalQuickReplyDraft(
  mail: MailDoc,
  tone: QuickReplyTone,
  userName: string
): string {
  const firstName = mail.fromName.split(' ')[0] || 'there';
  if (tone === 'Concise') {
    return `Hi ${firstName},\n\nThanks for reaching out about "${mail.subject}". I've reviewed your note and will follow up with next steps shortly.\n\nBest,\n${userName}`;
  }
  if (tone === 'Friendly') {
    return `Hi ${firstName},\n\nGreat hearing from you! Thanks so much for sending over "${mail.subject}". Everything looks good on my end—let me know if there's anything else you need before we move forward.\n\nWarmly,\n${userName}`;
  }
  return `Dear ${mail.fromName},\n\nThank you for your email regarding "${mail.subject}". I have reviewed the details and will confirm our next steps shortly.\n\nBest regards,\n${userName}`;
}

export async function handleLocalFallbackRequest<T>(
  rawPath: string,
  init: RequestInit = {}
): Promise<T> {
  const path = rawPath.split('?')[0];
  const method = (init.method || 'GET').toUpperCase();
  let body: Record<string, unknown> = {};
  if (typeof init.body === 'string' && init.body.trim()) {
    try {
      body = JSON.parse(init.body) as Record<string, unknown>;
    } catch {
      body = {};
    }
  }
  const state = getState();
  const nowIso = new Date().toISOString();

  // --- Auth endpoints ---
  if (path === '/api/auth/session' && method === 'GET') {
    return { authenticated: state.authenticated, user: state.authenticated ? state.user : null } as T;
  }
  if (path === '/api/auth/demo' && method === 'POST') {
    state.authenticated = true;
    saveState(state);
    return { user: state.user, token: 'local_demo_token' } as T;
  }
  if ((path === '/api/auth/login' || path === '/api/auth/register') && method === 'POST') {
    const email = typeof body.email === 'string' && body.email.trim() ? body.email.trim().toLowerCase() : state.user.email;
    const name =
      typeof body.name === 'string' && body.name.trim()
        ? body.name.trim()
        : email.split('@')[0];
    state.user = { ...state.user, email, name, authProvider: 'local' };
    state.authenticated = true;
    saveState(state);
    return { user: state.user, token: 'local_session_token' } as T;
  }
  if (path === '/api/auth/logout' && method === 'POST') {
    state.authenticated = false;
    saveState(state);
    return { ok: true } as T;
  }
  if (path === '/api/auth/me' && method === 'GET') {
    return { user: state.user } as T;
  }

  // --- Mails & OTP endpoints ---
  if (path === '/api/mails' && method === 'GET') {
    const sorted = [...state.mails].sort(
      (a, b) => new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime()
    );
    return { mails: sorted } as T;
  }

  if (path === '/api/mails' && method === 'POST') {
    const saveAsDraft = Boolean(body.saveAsDraft);
    const to = Array.isArray(body.to) ? body.to.map(String) : [];
    const subject = typeof body.subject === 'string' ? body.subject : '(No Subject)';
    const textBody = typeof body.textBody === 'string' ? body.textBody : '';
    const mail: MailDoc = {
      id: nextId('mail'),
      userId: state.user.id,
      threadId: nextId('th'),
      folder: saveAsDraft ? 'drafts' : 'sent',
      fromName: state.user.name,
      fromEmail: state.user.email,
      to,
      subject,
      snippet: textBody.replace(/\s+/g, ' ').slice(0, 140),
      textBody,
      receivedAt: nowIso,
      isRead: true,
      isStarred: false,
      category: 'General',
      categorizedBy: 'default',
    };
    state.mails.unshift(mail);
    saveState(state);
    return { mail, transport: 'local-fallback' } as T;
  }

  if (path === '/api/mails/ingest' && method === 'POST') {
    const customSubject = typeof body.subject === 'string' ? body.subject.trim() : '';
    const fromName = typeof body.fromName === 'string' && body.fromName.trim() ? body.fromName.trim() : 'Elena Vance';
    const fromEmail = typeof body.fromEmail === 'string' && body.fromEmail.trim() ? body.fromEmail.trim() : 'elena@partner.io';
    const subject = customSubject || 'Q4 Partner Sync: Agenda Confirmation';
    const textBody =
      typeof body.textBody === 'string' && body.textBody.trim()
        ? body.textBody
        : `Hi ${state.user.name},\n\nCould we meet tomorrow at 16:00 UTC to finalize the launch checklist?\n\nBest,\n${fromName}`;

    const mail: MailDoc = {
      id: nextId('mail'),
      userId: state.user.id,
      threadId: typeof body.threadId === 'string' && body.threadId.trim() ? body.threadId.trim() : nextId('th'),
      inReplyTo: typeof body.inReplyTo === 'string' ? body.inReplyTo : undefined,
      folder: 'inbox',
      fromName,
      fromEmail,
      to: [state.user.email],
      subject,
      snippet: textBody.replace(/\s+/g, ' ').slice(0, 140),
      textBody,
      receivedAt: nowIso,
      isRead: false,
      isStarred: false,
      category: 'General',
      categorizedBy: 'default',
    };

    const catResult = categorizeMailRuleBased(mail, state.categories);
    mail.category = catResult.category;
    mail.otpCode = catResult.otpCode;
    mail.categorizedBy = catResult.categorizedBy;

    const createdVaultEntries: OtpVaultDoc[] = [];
    let linkedVaultId: string | undefined;
    if (mail.category === 'OTP') {
      const otpInfo = detectOtpFast(mail);
      if (otpInfo.isOtp && otpInfo.otpCode) {
        const entry: OtpVaultDoc = {
          id: nextId('otp'),
          userId: state.user.id,
          mailId: mail.id,
          serviceName: otpInfo.serviceName || fromName,
          otpCode: otpInfo.otpCode,
          expiresAt: otpInfo.expiresAt || new Date(Date.now() + 15 * 60_000).toISOString(),
          isUsed: false,
          createdAt: nowIso,
        };
        state.otpVault.unshift(entry);
        createdVaultEntries.push(entry);
        linkedVaultId = entry.id;
      }
    }

    const stopOnReply = applyStopOnReplyToSchedules(state.schedules, mail, nowIso);
    mail.suggestedActions = extractSuggestedActions(mail, {
      otpVaultId: linkedVaultId,
      userName: state.user.name,
    });
    state.mails.unshift(mail);
    saveState(state);
    return { ingested: [mail], otpVaultEntries: createdVaultEntries, stopOnReply } as T;
  }

  const quickReplyMatch = /^\/api\/mails\/([^/]+)\/quick-reply$/.exec(path);
  if (quickReplyMatch && method === 'POST') {
    const mail = state.mails.find((m) => m.id === quickReplyMatch[1]);
    const tone = (body.tone as QuickReplyTone) || 'Professional';
    const draft = mail
      ? buildLocalQuickReplyDraft(mail, tone, state.user.name)
      : `Hi there,\n\nThank you for your note. I will follow up shortly.\n\nBest regards,\n${state.user.name}`;
    return { draft, tone, model: 'local-fallback' } as T;
  }

  const mailMatch = /^\/api\/mails\/([^/]+)$/.exec(path);
  if (mailMatch) {
    const mailId = mailMatch[1];
    if (method === 'PATCH') {
      const mail = state.mails.find((m) => m.id === mailId);
      if (mail) {
        if (typeof body.isRead === 'boolean') mail.isRead = body.isRead;
        if (typeof body.isStarred === 'boolean') mail.isStarred = body.isStarred;
        if (typeof body.folder === 'string') mail.folder = body.folder as MailDoc['folder'];
        if (typeof body.category === 'string') mail.category = body.category;
        saveState(state);
      }
      return { mail } as T;
    }
    if (method === 'DELETE') {
      state.mails = state.mails.filter((m) => m.id !== mailId);
      saveState(state);
      return { ok: true } as T;
    }
  }

  if (path === '/api/mails/bulk-delete' && method === 'POST') {
    const ids = Array.isArray(body.ids) ? new Set(body.ids.map(String)) : null;
    const category = typeof body.category === 'string' ? body.category.toLowerCase() : null;
    const before = state.mails.length;
    state.mails = state.mails.filter((m) => {
      if (ids && ids.has(m.id)) return false;
      if (category && m.category.toLowerCase() === category) return false;
      return true;
    });
    saveState(state);
    return { deletedCount: before - state.mails.length } as T;
  }

  if (path === '/api/otp-vault/active' && method === 'GET') {
    const nowMs = Date.now();
    const entries = state.otpVault.filter(
      (v) => !v.isUsed && new Date(v.expiresAt).getTime() > nowMs
    );
    return { entries } as T;
  }

  const otpUseMatch = /^\/api\/otp-vault\/([^/]+)\/use$/.exec(path);
  if (otpUseMatch && method === 'POST') {
    const entry = state.otpVault.find((v) => v.id === otpUseMatch[1]);
    if (entry) {
      entry.isUsed = true;
      entry.usedAt = nowIso;
      saveState(state);
    }
    return { entry } as T;
  }

  if (path === '/api/digest/generate' && method === 'POST') {
    const scope = (body.scope as DigestFilterScope) || 'unread';
    const category = typeof body.category === 'string' ? body.category : undefined;
    const digest = generateRuleBasedDigest(state.mails, { scope, category });
    return { digest } as T;
  }

  // --- Schedules ---
  if (path === '/api/schedules' && method === 'GET') {
    return { schedules: state.schedules } as T;
  }

  if (path === '/api/schedules' && method === 'POST') {
    const rule = {
      mode: (body.mode as ScheduleMode) || 'basic',
      startUtc: typeof body.startUtc === 'string' ? body.startUtc : nowIso,
      freq: Number(body.freq) || 1,
      gapValue: Number(body.gapValue) || 0,
      gapUnit: (body.gapUnit as GapUnit) || 'hours',
      recipients: Array.isArray(body.recipients) ? body.recipients.map(String) : [],
      subject: typeof body.subject === 'string' ? body.subject : 'Scheduled Follow-Up',
      body: typeof body.body === 'string' ? body.body : '',
      stopOnReply: typeof body.stopOnReply === 'boolean' ? body.stopOnReply : false,
      threadId: typeof body.threadId === 'string' ? body.threadId : nextId('th'),
    };
    const errMsg = validateScheduleInput(rule);
    if (errMsg) throw new Error(errMsg);
    const id = nextId('sched');
    const mat = materializeScheduleTimestamps(rule, `${id}_slot`);
    const schedule: ScheduleDoc = {
      id,
      userId: state.user.id,
      ...rule,
      status: 'active',
      slots: mat.slots,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    state.schedules.unshift(schedule);
    saveState(state);
    return { schedule } as T;
  }

  const schedCancelMatch = /^\/api\/schedules\/([^/]+)\/cancel-pending$/.exec(path);
  if (schedCancelMatch && method === 'POST') {
    const idx = state.schedules.findIndex((s) => s.id === schedCancelMatch[1]);
    let cancelledCount = 0;
    let updatedSched = idx >= 0 ? state.schedules[idx] : undefined;
    if (idx >= 0) {
      const res = cancelPendingSlots(state.schedules[idx]);
      cancelledCount = res.cancelledCount;
      updatedSched = res.updated;
      state.schedules[idx] = updatedSched;
      saveState(state);
    }
    return { schedule: updatedSched, cancelledCount } as T;
  }

  const schedRetryMatch = /^\/api\/schedules\/([^/]+)\/slots\/([^/]+)\/retry$/.exec(path);
  if (schedRetryMatch && method === 'POST') {
    const sched = state.schedules.find((s) => s.id === schedRetryMatch[1]);
    const slot = sched?.slots.find((sl) => sl.id === schedRetryMatch[2]);
    if (sched && slot) {
      slot.status = 'sent';
      slot.sentAtUtc = nowIso;
      slot.error = undefined;
      sched.updatedAt = nowIso;
      saveState(state);
    }
    return { schedule: sched } as T;
  }

  const schedDeleteMatch = /^\/api\/schedules\/([^/]+)$/.exec(path);
  if (schedDeleteMatch && method === 'DELETE') {
    state.schedules = state.schedules.filter((s) => s.id !== schedDeleteMatch[1]);
    saveState(state);
    return { ok: true } as T;
  }

  // --- Categories ---
  if (path === '/api/categories' && method === 'GET') {
    return { categories: state.categories } as T;
  }

  if (path === '/api/categories' && method === 'POST') {
    const category: CategoryDoc = {
      id: nextId('cat'),
      userId: state.user.id,
      name: String(body.name || 'Custom'),
      description: String(body.description || ''),
      keywords: Array.isArray(body.keywords) ? body.keywords.map(String) : [],
      senderPatterns: Array.isArray(body.senderPatterns) ? body.senderPatterns.map(String) : [],
      isSystem: false,
      aiEnabled: Boolean(body.aiEnabled),
      createdAt: nowIso,
    };
    state.categories.push(category);
    saveState(state);
    return { category } as T;
  }

  if (path === '/api/categories/recategorize' && method === 'POST') {
    let updatedCount = 0;
    for (const mail of state.mails) {
      const res = categorizeMailRuleBased(mail, state.categories);
      if (mail.category !== res.category) updatedCount += 1;
      mail.category = res.category;
      mail.otpCode = res.otpCode;
      mail.categorizedBy = res.categorizedBy;
    }
    saveState(state);
    return { updatedCount, totalInbox: state.mails.length } as T;
  }

  const catMatch = /^\/api\/categories\/([^/]+)$/.exec(path);
  if (catMatch) {
    if (method === 'PATCH') {
      const category = state.categories.find((c) => c.id === catMatch[1]);
      if (category) {
        if (typeof body.name === 'string') category.name = body.name;
        if (typeof body.description === 'string') category.description = body.description;
        if (Array.isArray(body.keywords)) category.keywords = body.keywords.map(String);
        if (Array.isArray(body.senderPatterns)) category.senderPatterns = body.senderPatterns.map(String);
        if (typeof body.aiEnabled === 'boolean') category.aiEnabled = body.aiEnabled;
        saveState(state);
      }
      return { category } as T;
    }
    if (method === 'DELETE') {
      state.categories = state.categories.filter((c) => c.id !== catMatch[1]);
      saveState(state);
      return { ok: true } as T;
    }
  }

  // --- Chats & Agent ---
  if (path === '/api/chats' && method === 'GET') {
    return { chats: state.chats } as T;
  }
  if (path === '/api/chats' && method === 'POST') {
    const chat: ChatSessionDoc = {
      id: nextId('chat'),
      userId: state.user.id,
      title: typeof body.title === 'string' ? body.title : 'New Session',
      pinned: false,
      messages: [],
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    state.chats.unshift(chat);
    saveState(state);
    return { chat } as T;
  }

  const chatMatch = /^\/api\/chats\/([^/]+)$/.exec(path);
  if (chatMatch) {
    if (method === 'PATCH') {
      const chat = state.chats.find((c) => c.id === chatMatch[1]);
      if (chat) {
        if (typeof body.pinned === 'boolean') chat.pinned = body.pinned;
        if (typeof body.title === 'string') chat.title = body.title;
        if (typeof body.messageId === 'string' && body.actionPatch && typeof body.actionPatch === 'object') {
          const msg = chat.messages.find((m) => m.id === body.messageId);
          if (msg?.actionPreview) {
            msg.actionPreview = {
              ...msg.actionPreview,
              ...(body.actionPatch as Record<string, unknown>),
            } as ChatMessage['actionPreview'];
          }
        }
        chat.updatedAt = nowIso;
        saveState(state);
      }
      return { chat } as T;
    }
    if (method === 'DELETE') {
      state.chats = state.chats.filter((c) => c.id !== chatMatch[1]);
      saveState(state);
      return { ok: true } as T;
    }
  }

  if (path === '/api/agent/execute' && method === 'POST') {
    const prompt = String(body.prompt || '').trim();
    const triggers = parseAgentTriggers(prompt);
    let chat =
      (typeof body.chatId === 'string' && state.chats.find((c) => c.id === body.chatId)) || null;
    if (!chat) {
      chat = {
        id: nextId('chat'),
        userId: state.user.id,
        title: prompt.slice(0, 44) || 'Agent Session',
        pinned: false,
        messages: [],
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      state.chats.unshift(chat);
    }

    const userMsg: ChatMessage = {
      id: nextId('msg'),
      role: 'user',
      content: prompt,
      createdAt: nowIso,
    };

    const primaryCmd = triggers.commands[0] || '';
    let assistantMsg: ChatMessage;
    if (!triggers.isValid) {
      assistantMsg = {
        id: nextId('msg'),
        role: 'assistant',
        content:
          'Commands require an explicit / action (such as /schedule, /draft, /categorize, /otp, /digest, /cleanup) or @ context mention.',
        requiresTriggerHint: true,
        createdAt: nowIso,
      };
    } else if (primaryCmd === '/digest') {
      const digest = generateRuleBasedDigest(state.mails, { scope: 'unread' });
      assistantMsg = {
        id: nextId('msg'),
        role: 'assistant',
        content: digest.summary,
        createdAt: nowIso,
        actionPreview: { type: 'digest_briefing', digest },
      };
    } else if (primaryCmd === '/otp') {
      const activeOtp = state.otpVault.find(
        (v) => !v.isUsed && new Date(v.expiresAt).getTime() > Date.now()
      );
      assistantMsg = activeOtp
        ? {
            id: nextId('msg'),
            role: 'assistant',
            content: `Active OTP code from ${activeOtp.serviceName}: ${activeOtp.otpCode}`,
            createdAt: nowIso,
            actionPreview: {
              type: 'otp_surface_card',
              vaultId: activeOtp.id,
              serviceName: activeOtp.serviceName,
              otpCode: activeOtp.otpCode,
              expiresAt: activeOtp.expiresAt,
              isUsed: activeOtp.isUsed,
            },
          }
        : {
            id: nextId('msg'),
            role: 'assistant',
            content: 'No active unconsumed OTP verification codes found.',
            createdAt: nowIso,
          };
    } else if (primaryCmd === '/cleanup' || primaryCmd === '/cleanup-otp') {
      const otpMails = state.mails.filter((m) => m.category === 'OTP');
      assistantMsg = {
        id: nextId('msg'),
        role: 'assistant',
        content: `Found ${otpMails.length} OTP emails ready for cleanup.`,
        createdAt: nowIso,
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
        },
      };
    } else if (primaryCmd === '/categorize') {
      const changes = state.mails.map((m) => {
        const res = categorizeMailRuleBased(m, state.categories);
        m.category = res.category;
        m.categorizedBy = res.categorizedBy;
        return { mailId: m.id, subject: m.subject, category: res.category, method: res.categorizedBy };
      });
      assistantMsg = {
        id: nextId('msg'),
        role: 'assistant',
        content: `Categorized ${changes.length} emails using local rules.`,
        createdAt: nowIso,
        actionPreview: {
          type: 'categorize_summary',
          processedCount: changes.length,
          otpDetectedCount: changes.filter((c) => c.category === 'OTP').length,
          changes: changes.slice(0, 8),
        },
      };
    } else if (primaryCmd === '/schedule') {
      const startUtc = new Date(Date.now() + 3600_000).toISOString();
      const recipients = parseRecipientList(triggers.recipientMentions);
      const rule = {
        mode: 'basic' as ScheduleMode,
        startUtc,
        freq: 1,
        gapValue: 0,
        gapUnit: 'hours' as GapUnit,
        recipients: recipients.length ? recipients : ['sarah@northstar.io'],
        subject: 'Follow-Up Reminder',
        body: `Hi there,\n\nFollowing up regarding ${prompt.replace(/^\/schedule\s*/i, '')}.\n\nBest,\n${state.user.name}`,
        stopOnReply: false,
      };
      const mat = materializeScheduleTimestamps(rule);
      assistantMsg = {
        id: nextId('msg'),
        role: 'assistant',
        content: `Prepared a schedule in UTC (${mat.timestampsUtc.length} slot).`,
        createdAt: nowIso,
        actionPreview: {
          type: 'schedule_preview',
          rule,
          timestampsUtc: mat.timestampsUtc,
        },
      };
    } else {
      const recipients = parseRecipientList(triggers.recipientMentions);
      assistantMsg = {
        id: nextId('msg'),
        role: 'assistant',
        content: 'Prepared a draft email ready for your review.',
        createdAt: nowIso,
        actionPreview: {
          type: 'draft_preview',
          to: recipients.length ? recipients : ['elena@partner.io'],
          subject: 'Re: Follow-Up',
          body: `Hi there,\n\nFollowing up regarding ${prompt.replace(/^\/draft\s*/i, '')}.\n\nBest regards,\n${state.user.name}`,
          status: 'pending',
        },
      };
    }

    chat.messages.push(userMsg, assistantMsg);
    chat.updatedAt = nowIso;
    saveState(state);
    return { chat, assistantMessage: assistantMsg } as T;
  }

  return {} as T;
}
