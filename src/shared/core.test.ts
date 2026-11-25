import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyStopOnReplyToSchedules,
  cancelPendingSlots,
  materializeScheduleTimestamps,
  validateScheduleInput,
} from './scheduler';
import { categorizeMailRuleBased, detectOtpFast } from './categorizer';
import { extractAutocompleteContext, hasValidTrigger, parseAgentTriggers } from './agentTriggers';
import { sanitizeEmailHtmlBasic } from './mailSanitizer';
import {
  buildDraftPromptForMail,
  buildSchedulePrefillForDigestItem,
  generateRuleBasedDigest,
} from './digest';
import {
  buildDraftAgentCommandForAction,
  buildScheduleAgentCommandForAction,
  extractSuggestedActions,
} from './actionExtractor';
import {
  buildQuickReplyInstructions,
  buildQuickReplyPromptContents,
  isValidQuickReplyTone,
  stripCodeFencesFromDraft,
} from './quickReply';
import { CategoryDoc, ChatSessionDoc, MailDoc, ScheduleDoc } from './types';

test('materializeScheduleTimestamps generates 1 slot in basic mode', () => {
  const preview = materializeScheduleTimestamps({
    mode: 'basic',
    startUtc: '2026-11-24T10:00:00.000Z',
    freq: 5,
    gapValue: 2,
    gapUnit: 'hours',
    recipients: ['alice@example.com'],
  });

  assert.equal(preview.timestampsUtc.length, 1);
  assert.equal(preview.timestampsUtc[0], '2026-11-24T10:00:00.000Z');
  assert.equal(preview.slots.length, 1);
  assert.equal(preview.slots[0].status, 'pending');
  assert.equal(preview.slots[0].recipient, 'alice@example.com');
});

test('materializeScheduleTimestamps expands freq x recipients in advanced mode', () => {
  const preview = materializeScheduleTimestamps({
    mode: 'advanced',
    startUtc: '2026-11-24T10:00:00.000Z',
    freq: 3,
    gapValue: 2,
    gapUnit: 'hours',
    recipients: ['alice@example.com', 'bob@example.com'],
  });

  assert.deepEqual(preview.timestampsUtc, [
    '2026-11-24T10:00:00.000Z',
    '2026-11-24T12:00:00.000Z',
    '2026-11-24T14:00:00.000Z',
  ]);
  assert.equal(preview.slots.length, 6);
  assert.equal(preview.slots[0].runIndex, 1);
  assert.equal(preview.slots[5].runIndex, 3);
  assert.equal(preview.slots[5].recipient, 'bob@example.com');
});

test('validateScheduleInput rejects empty recipients and invalid gap when freq > 1', () => {
  const err1 = validateScheduleInput({
    mode: 'basic',
    startUtc: '2026-11-24T10:00:00.000Z',
    freq: 1,
    gapValue: 0,
    gapUnit: 'hours',
    recipients: [],
    subject: 'Test',
    body: 'Body',
  });
  assert.ok(err1);

  const err2 = validateScheduleInput({
    mode: 'advanced',
    startUtc: '2026-11-24T10:00:00.000Z',
    freq: 3,
    gapValue: 0,
    gapUnit: 'hours',
    recipients: ['alice@example.com'],
    subject: 'Test',
    body: 'Body',
  });
  assert.ok(err2);
});

test('cancelPendingSlots cancels only pending slots and preserves sent history', () => {
  const schedule: ScheduleDoc = {
    id: 'sched_1',
    userId: 'u1',
    mode: 'advanced',
    startUtc: '2026-11-24T10:00:00.000Z',
    freq: 3,
    gapValue: 1,
    gapUnit: 'hours',
    recipients: ['a@test.com'],
    subject: 'Hi',
    body: 'Hello',
    stopOnReply: true,
    status: 'active',
    createdAt: '2026-11-24T09:00:00.000Z',
    updatedAt: '2026-11-24T09:00:00.000Z',
    slots: [
      { id: 's1', runIndex: 1, runAtUtc: '2026-11-24T10:00:00.000Z', recipient: 'a@test.com', status: 'sent', sentAtUtc: '2026-11-24T10:00:05.000Z' },
      { id: 's2', runIndex: 2, runAtUtc: '2026-11-24T11:00:00.000Z', recipient: 'a@test.com', status: 'pending' },
      { id: 's3', runIndex: 3, runAtUtc: '2026-11-24T12:00:00.000Z', recipient: 'a@test.com', status: 'failed', error: 'SMTP timeout' },
    ],
  };

  const { updated, cancelledCount } = cancelPendingSlots(schedule);
  assert.equal(cancelledCount, 1);
  assert.equal(updated.slots[0].status, 'sent');
  assert.equal(updated.slots[1].status, 'cancelled');
  assert.equal(updated.slots[2].status, 'failed');
});

test('applyStopOnReplyToSchedules cancels pending slots per-recipient and sets cancelled_replied with replyMailId', () => {
  const multiSched: ScheduleDoc = {
    id: 'sched_multi',
    userId: 'u1',
    mode: 'advanced',
    startUtc: '2026-11-24T10:00:00.000Z',
    freq: 2,
    gapValue: 3,
    gapUnit: 'days',
    recipients: ['sarah@northstar.io', 'alex@acme.dev'],
    subject: 'Follow-up',
    body: 'Checking in',
    stopOnReply: true,
    threadId: 'th_multi_1',
    status: 'active',
    createdAt: '2026-11-24T09:00:00.000Z',
    updatedAt: '2026-11-24T09:00:00.000Z',
    slots: [
      { id: 'ms1', runIndex: 1, runAtUtc: '2026-11-24T10:00:00.000Z', recipient: 'sarah@northstar.io', status: 'sent', sentAtUtc: '2026-11-24T10:00:05.000Z' },
      { id: 'ms2', runIndex: 1, runAtUtc: '2026-11-24T10:00:00.000Z', recipient: 'alex@acme.dev', status: 'sent', sentAtUtc: '2026-11-24T10:00:06.000Z' },
      { id: 'ms3', runIndex: 2, runAtUtc: '2026-11-27T10:00:00.000Z', recipient: 'sarah@northstar.io', status: 'pending' },
      { id: 'ms4', runIndex: 2, runAtUtc: '2026-11-27T10:00:00.000Z', recipient: 'alex@acme.dev', status: 'pending' },
    ],
  };

  const singleNoStopSched: ScheduleDoc = {
    ...multiSched,
    id: 'sched_nostop',
    recipients: ['sarah@northstar.io'],
    stopOnReply: false,
    threadId: 'th_other',
    slots: [
      { id: 'ns1', runIndex: 2, runAtUtc: '2026-11-27T10:00:00.000Z', recipient: 'sarah@northstar.io', status: 'pending' },
    ],
  };

  const res = applyStopOnReplyToSchedules(
    [multiSched, singleNoStopSched],
    {
      id: 'mail_reply_1',
      threadId: 'th_multi_1',
      fromEmail: 'sarah@northstar.io',
      folder: 'inbox',
    },
    '2026-11-24T14:00:00.000Z'
  );

  assert.equal(res.matchedSchedulesCount, 1);
  assert.equal(res.cancelledSlotsCount, 1);
  assert.equal(multiSched.slots[0].status, 'sent');
  assert.equal(multiSched.slots[2].status, 'cancelled_replied');
  assert.equal(multiSched.slots[2].replyMailId, 'mail_reply_1');
  assert.equal(multiSched.slots[2].cancelledAt, '2026-11-24T14:00:00.000Z');
  assert.equal(multiSched.slots[3].status, 'pending');
  assert.equal(multiSched.status, 'active');
  assert.equal(singleNoStopSched.slots[0].status, 'pending');

  // Second reply from alex@acme.dev cancels remaining slots and completes schedule halt
  const res2 = applyStopOnReplyToSchedules(
    [multiSched],
    {
      id: 'mail_reply_2',
      threadId: 'th_new_thread',
      inReplyTo: 'th_multi_1',
      fromEmail: 'alex@acme.dev',
      folder: 'inbox',
    },
    '2026-11-24T15:00:00.000Z'
  );
  assert.equal(res2.cancelledSlotsCount, 1);
  assert.equal(multiSched.slots[3].status, 'cancelled_replied');
  assert.equal(multiSched.status, 'cancelled');
  assert.ok(multiSched.cancelledReason?.includes('alex@acme.dev'));
});

test('detectOtpFast detects 4-8 digit OTP codes, extracts serviceName/expiry, and avoids false positives on invoices', () => {
  const fixedNow = Date.parse('2026-11-24T10:00:00.000Z');
  const otpResult = detectOtpFast(
    {
      fromName: 'GitHub Security',
      fromEmail: 'noreply@github.com',
      subject: '[GitHub] Your verification code',
      textBody: 'Please use verification code 482913 to complete sign in. Valid for 10 minutes.',
    },
    fixedNow
  );
  assert.equal(otpResult.isOtp, true);
  assert.equal(otpResult.otpCode, '482913');
  assert.equal(otpResult.serviceName, 'GitHub');
  assert.equal(otpResult.expiresAt, '2026-11-24T10:10:00.000Z');

  const defaultExpiryOtp = detectOtpFast(
    {
      fromName: 'Cloudflare Auth',
      fromEmail: 'no-reply@cloudflare.com',
      subject: 'Login verification code',
      textBody: 'Your security code is 654321.',
    },
    fixedNow
  );
  assert.equal(defaultExpiryOtp.isOtp, true);
  assert.equal(defaultExpiryOtp.serviceName, 'Cloudflare');
  assert.equal(defaultExpiryOtp.expiresAt, '2026-11-24T10:15:00.000Z');

  const invoiceResult = detectOtpFast({
    fromName: 'Acme Billing',
    fromEmail: 'billing@acme.io',
    subject: 'Invoice #992811 for November',
    textBody: 'Thank you for your payment of $120.00. Order reference 202611.',
  });
  assert.equal(invoiceResult.isOtp, false);
});

test('categorizeMailRuleBased prioritizes OTP before custom category rules', () => {
  const categories: CategoryDoc[] = [
    {
      id: 'c1',
      userId: 'u1',
      name: 'Finance',
      description: 'Invoices and bank alerts',
      keywords: ['invoice', 'billing', 'statement'],
      senderPatterns: ['stripe.com'],
      isSystem: false,
      aiEnabled: false,
      createdAt: '2026-11-24T00:00:00.000Z',
    },
  ];

  const stripeOtp = categorizeMailRuleBased(
    {
      fromName: 'Stripe Security',
      fromEmail: 'security@stripe.com',
      subject: 'Your Stripe 2FA verification code',
      textBody: 'Your one-time passcode is 774120. Do not share it.',
      folder: 'inbox',
    },
    categories
  );
  assert.equal(stripeOtp.category, 'OTP');
  assert.equal(stripeOtp.categorizedBy, 'otp-rule');

  const stripeInvoice = categorizeMailRuleBased(
    {
      fromName: 'Stripe Billing',
      fromEmail: 'receipts@stripe.com',
      subject: 'Your November invoice is ready',
      textBody: 'Attached is your monthly billing statement.',
      folder: 'inbox',
    },
    categories
  );
  assert.equal(stripeInvoice.category, 'Finance');
  assert.equal(stripeInvoice.categorizedBy, 'custom-rule');
});

test('strict / and @ trigger parser rejects plain text and extracts structured commands', () => {
  assert.equal(hasValidTrigger('please schedule a meeting tomorrow'), false);
  assert.equal(hasValidTrigger('/schedule send reminder to @alex@acme.dev'), true);
  assert.equal(hasValidTrigger('clean up @category:OTP emails'), true);

  const parsed = parseAgentTriggers('/draft follow up with @sarah@northstar.io about @mail:Q4');
  assert.deepEqual(parsed.commands, ['/draft']);
  assert.deepEqual(parsed.recipientMentions, ['sarah@northstar.io']);
  assert.deepEqual(parsed.mailMentions, ['Q4']);

  const ctx = extractAutocompleteContext('run /sch', 8);
  assert.equal(ctx.triggerType, '/');
  assert.equal(ctx.query, 'sch');
});

test('sanitizeEmailHtmlBasic strips scripts, event handlers, and fixed positioning', () => {
  const dirty = `<div style="position: fixed; z-index: 9999;" onclick="alert(1)"><script>steal()</script><a href="javascript:alert(2)">Click</a><p>Safe code 123456</p></div>`;
  const clean = sanitizeEmailHtmlBasic(dirty);
  assert.equal(clean.includes('<script'), false);
  assert.equal(clean.includes('onclick'), false);
  assert.equal(clean.includes('javascript:'), false);
  assert.equal(clean.includes('position: fixed'), false);
  assert.equal(clean.includes('Safe code 123456'), true);
});

test('pinned chat sessions stay anchored above unpinned sessions sorted by updatedAt desc', () => {
  const sessions: Pick<ChatSessionDoc, 'id' | 'pinned' | 'updatedAt'>[] = [
    { id: 'unpinned_new', pinned: false, updatedAt: '2026-11-24T12:00:00.000Z' },
    { id: 'pinned_old', pinned: true, updatedAt: '2026-11-24T08:00:00.000Z' },
    { id: 'unpinned_old', pinned: false, updatedAt: '2026-11-24T09:00:00.000Z' },
    { id: 'pinned_new', pinned: true, updatedAt: '2026-11-24T10:00:00.000Z' },
  ];

  const sorted = [...sessions].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });

  assert.deepEqual(
    sorted.map((s) => s.id),
    ['pinned_new', 'pinned_old', 'unpinned_new', 'unpinned_old']
  );
});

test('generateRuleBasedDigest classifies Needs Reply, Deadlines, and Noise and excludes archived mails', () => {
  const fixedNow = Date.parse('2026-11-24T12:00:00.000Z');
  const sampleMails: MailDoc[] = [
    {
      id: 'm1',
      userId: 'u1',
      threadId: 't1',
      folder: 'inbox',
      fromName: 'Alex Rivera',
      fromEmail: 'alex@acme.dev',
      to: ['abhay@test.com'],
      subject: 'Release v2.14 pipeline green',
      snippet: 'Ready whenever you give the green light.',
      textBody: 'All checks passed. Ready whenever you give the green light for canary deploy.',
      receivedAt: '2026-11-24T11:00:00.000Z',
      isRead: false,
      isStarred: false,
      category: 'Engineering',
      categorizedBy: 'custom-rule',
    },
    {
      id: 'm2',
      userId: 'u1',
      threadId: 't2',
      folder: 'inbox',
      fromName: 'Sarah Chen',
      fromEmail: 'sarah@northstar.io',
      to: ['abhay@test.com'],
      subject: 'Q4 Launch Timeline',
      snippet: 'Can we lock Thursday morning UTC?',
      textBody: 'Can we lock the beta rollout schedule for Thursday morning UTC?',
      receivedAt: '2026-11-24T10:00:00.000Z',
      isRead: false,
      isStarred: false,
      category: 'Product',
      categorizedBy: 'custom-rule',
    },
    {
      id: 'm3',
      userId: 'u1',
      threadId: 't3',
      folder: 'inbox',
      fromName: 'GitHub Security',
      fromEmail: 'noreply@github.com',
      to: ['abhay@test.com'],
      subject: 'Verify device',
      snippet: 'Code 482913',
      textBody: 'Verification code: 482913',
      receivedAt: '2026-11-24T11:30:00.000Z',
      isRead: false,
      isStarred: false,
      category: 'OTP',
      otpCode: '482913',
      categorizedBy: 'otp-rule',
    },
    {
      id: 'm4',
      userId: 'u1',
      threadId: 't4',
      folder: 'archive',
      fromName: 'Mercury',
      fromEmail: 'notifications@mercury.com',
      to: ['abhay@test.com'],
      subject: 'Archived update',
      snippet: 'Archived',
      textBody: 'Archived notice',
      receivedAt: '2026-11-24T09:00:00.000Z',
      isRead: false,
      isStarred: false,
      category: 'Finance',
      categorizedBy: 'custom-rule',
    },
  ];

  const unreadDigest = generateRuleBasedDigest(sampleMails, { scope: 'unread', nowMs: fixedNow });
  assert.equal(unreadDigest.totalAnalyzed, 3);
  assert.equal(unreadDigest.needsReply.length, 1);
  assert.equal(unreadDigest.needsReply[0].mailId, 'm1');
  assert.equal(unreadDigest.deadlines.length, 1);
  assert.equal(unreadDigest.deadlines[0].mailId, 'm2');
  assert.ok(unreadDigest.deadlines[0].extractedDateLabel?.toLowerCase().includes('thursday'));
  assert.equal(unreadDigest.noise.length, 1);
  assert.equal(unreadDigest.noise[0].mailId, 'm3');

  const engOnly = generateRuleBasedDigest(sampleMails, {
    scope: 'today',
    category: 'Engineering',
    nowMs: fixedNow,
  });
  assert.equal(engOnly.totalAnalyzed, 1);
  assert.equal(engOnly.needsReply[0].mailId, 'm1');

  const draftCmd = buildDraftPromptForMail(unreadDigest.needsReply[0]);
  assert.ok(draftCmd.startsWith('/draft '));
  assert.ok(draftCmd.includes('@alex@acme.dev'));

  const schedRule = buildSchedulePrefillForDigestItem(unreadDigest.deadlines[0]);
  assert.deepEqual(schedRule.recipients, ['sarah@northstar.io']);
  assert.equal(schedRule.mode, 'basic');
});

test('extractSuggestedActions extracts up to 2 Inbox-to-Action chips per mail', () => {
  const fixedNow = Date.parse('2026-11-24T12:00:00.000Z');

  // 1. Meeting request with time -> reply_draft + schedule_followup
  const meetingActions = extractSuggestedActions(
    {
      id: 'm_meet',
      folder: 'inbox',
      fromName: 'Elena Vance',
      fromEmail: 'elena@partner.io',
      subject: 'Partner Sync: Q4 API Walkthrough',
      textBody: 'Could we meet this Thursday at 15:00 UTC to finalize the integration checklist?',
      category: 'Product',
    },
    { nowMs: fixedNow, userName: 'Abhay' }
  );
  assert.equal(meetingActions.length, 2);
  assert.equal(meetingActions[0].type, 'reply_draft');
  assert.ok(meetingActions[0].suggestedSubject?.startsWith('Re:'));
  assert.ok(meetingActions[0].suggestedBody?.includes('Elena'));
  assert.equal(meetingActions[1].type, 'schedule_followup');
  assert.ok(meetingActions[1].targetDatetime?.endsWith('T15:00:00.000Z'));

  const draftCmd = buildDraftAgentCommandForAction({
    id: 'm_meet',
    fromEmail: 'elena@partner.io',
    subject: 'Partner Sync: Q4 API Walkthrough',
  });
  assert.ok(draftCmd.startsWith('/draft @mail:m_meet'));

  const schedCmd = buildScheduleAgentCommandForAction(
    {
      id: 'm_meet',
      fromEmail: 'elena@partner.io',
      subject: 'Partner Sync: Q4 API Walkthrough',
    },
    meetingActions[1]
  );
  assert.ok(schedCmd.startsWith('/schedule '));
  assert.ok(schedCmd.includes('@mail:m_meet'));

  // 2. OTP mail -> exclusive copy_otp linked to vault
  const otpActions = extractSuggestedActions(
    {
      id: 'm_otp',
      folder: 'inbox',
      fromName: 'GitHub Security',
      fromEmail: 'noreply@github.com',
      subject: '[GitHub] Verification code',
      textBody: 'Your code is 482913.',
      category: 'OTP',
      otpCode: '482913',
    },
    { nowMs: fixedNow, otpVaultId: 'otp_123' }
  );
  assert.equal(otpActions.length, 1);
  assert.equal(otpActions[0].type, 'copy_otp');
  assert.equal(otpActions[0].otpCode, '482913');
  assert.equal(otpActions[0].otpVaultId, 'otp_123');

  // 3. Automated billing receipt -> 0 false-positive actions
  const invoiceActions = extractSuggestedActions(
    {
      id: 'm_inv',
      folder: 'inbox',
      fromName: 'Stripe Billing',
      fromEmail: 'receipts@stripe.com',
      subject: 'Invoice #INV-2026-1142',
      textBody: 'Billing Period: Nov 1 - Nov 30, 2026. Status: Paid.',
      category: 'Finance',
    },
    { nowMs: fixedNow }
  );
  assert.equal(invoiceActions.length, 0);
});

test('quickReply helpers validate tones, include tone guidance, and strip markdown fences', () => {
  assert.equal(isValidQuickReplyTone('Professional'), true);
  assert.equal(isValidQuickReplyTone('Concise'), true);
  assert.equal(isValidQuickReplyTone('Friendly'), true);
  assert.equal(isValidQuickReplyTone('Sarcastic'), false);

  const inst = buildQuickReplyInstructions('Concise', 'Abhay Tailor');
  assert.ok(inst.includes('Abhay Tailor'));
  assert.ok(inst.includes('2 to 4 short sentences'));

  const prompt = buildQuickReplyPromptContents({
    mail: {
      fromName: 'Elena Vance',
      fromEmail: 'elena@partner.io',
      subject: 'Partner Sync',
      textBody: 'Could we meet Thursday at 15:00 UTC?',
      folder: 'inbox',
      to: ['abhay@velomail.app'],
    },
    tone: 'Friendly',
    userName: 'Abhay Tailor',
    userEmail: 'abhay@velomail.app',
  });
  assert.ok(prompt.includes('Requested Tone: Friendly'));
  assert.ok(prompt.includes('Elena Vance <elena@partner.io>'));

  assert.equal(
    stripCodeFencesFromDraft('```text\nHi Elena,\nThursday works!\n```'),
    'Hi Elena,\nThursday works!'
  );
});

