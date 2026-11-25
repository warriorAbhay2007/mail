import React, { useMemo, useState } from 'react';
import DOMPurify from 'dompurify';
import {
  CalendarClock,
  Check,
  Copy,
  Loader2,
  MailOpen,
  Mail as MailIcon,
  PenLine,
  PenSquare,
  RefreshCw,
  Reply,
  Search,
  Send,
  ShieldAlert,
  Sparkles,
  Star,
  Trash2,
  X,
} from 'lucide-react';
import { CategoryDoc, MailDoc, QuickReplyTone, ScheduleDoc, SuggestedAction } from '../shared/types';
import { QUICK_REPLY_TONES } from '../shared/quickReply';
import {
  buildDraftAgentCommandForAction,
  buildScheduleAgentCommandForAction,
} from '../shared/actionExtractor';
import { sanitizeEmailHtmlBasic } from '../shared/mailSanitizer';
import { formatLocalTimestamp, parseRecipientList } from '../shared/scheduler';
import { api } from '../api/client';
import { InboxZeroState } from './InboxZeroState';

interface MailViewerProps {
  mails: MailDoc[];
  categories: CategoryDoc[];
  schedules?: ScheduleDoc[];
  initialCategoryFilter?: string;
  onMailsChanged: () => void;
  onSchedulesChanged?: () => void;
  onOtpConsumed?: () => void;
  onSendToAgent: (promptPrefill: string) => void;
}

export const MailViewer: React.FC<MailViewerProps> = ({
  mails,
  categories,
  schedules = [],
  initialCategoryFilter = 'all',
  onMailsChanged,
  onSchedulesChanged,
  onOtpConsumed,
  onSendToAgent,
}) => {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<string>(initialCategoryFilter);
  const [selectedId, setSelectedId] = useState<string | null>(mails[0]?.id || null);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [syncing, setSyncing] = useState(false);
  const [simulatingReply, setSimulatingReply] = useState(false);
  const [replyNotice, setReplyNotice] = useState<string | null>(null);
  const [copiedOtp, setCopiedOtp] = useState<string | null>(null);
  const [copiedActionId, setCopiedActionId] = useState<string | null>(null);

  // Reply state
  const [replyBody, setReplyBody] = useState('');
  const [sendingReply, setSendingReply] = useState(false);
  const [quickReplyTone, setQuickReplyTone] = useState<QuickReplyTone>('Professional');
  const [generatingQuickReply, setGeneratingQuickReply] = useState(false);
  const [quickReplyError, setQuickReplyError] = useState<string | null>(null);

  // Compose modal state
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeTo, setComposeTo] = useState('');
  const [composeSubject, setComposeSubject] = useState('');
  const [composeBody, setComposeBody] = useState('');
  const [composeError, setComposeError] = useState<string | null>(null);
  const [sendingCompose, setSendingCompose] = useState(false);

  // Safe bulk delete confirmation modal
  const [bulkConfirm, setBulkConfirm] = useState<{
    title: string;
    description: string;
    category?: string;
    ids?: string[];
    count: number;
    sampleSubjects: string[];
  } | null>(null);
  const [bulkDeleting, setBulkDeleting] = useState(false);

  const otpMails = useMemo(
    () => mails.filter((m) => m.category.toUpperCase() === 'OTP'),
    [mails]
  );

  const filteredMails = useMemo(() => {
    const q = search.trim().toLowerCase();
    return mails.filter((m) => {
      if (filter === 'archive') {
        if (m.folder !== 'archive') return false;
      } else {
        if (m.folder === 'archive') return false;
        if (filter === 'inbox' && m.folder !== 'inbox') return false;
        if (filter === 'sent' && m.folder !== 'sent') return false;
        if (filter === 'drafts' && m.folder !== 'drafts') return false;
        if (filter === 'unread' && m.isRead) return false;
        if (filter === 'starred' && !m.isStarred) return false;
        if (
          !['all', 'inbox', 'sent', 'drafts', 'unread', 'starred'].includes(filter) &&
          m.category.toLowerCase() !== filter.toLowerCase()
        ) {
          return false;
        }
      }
      if (!q) return true;
      return (
        m.subject.toLowerCase().includes(q) ||
        m.fromName.toLowerCase().includes(q) ||
        m.fromEmail.toLowerCase().includes(q) ||
        m.snippet.toLowerCase().includes(q)
      );
    });
  }, [mails, filter, search]);

  const selectedMail = useMemo(
    () => filteredMails.find((m) => m.id === selectedId) || filteredMails[0] || null,
    [filteredMails, selectedId]
  );

  const sanitizedHtml = useMemo(() => {
    if (!selectedMail?.htmlBody) return '';
    const basic = sanitizeEmailHtmlBasic(selectedMail.htmlBody);
    return DOMPurify.sanitize(basic, {
      ALLOWED_TAGS: [
        'div', 'p', 'span', 'strong', 'b', 'em', 'i', 'u', 'br', 'hr',
        'h1', 'h2', 'h3', 'h4', 'ul', 'ol', 'li', 'a', 'table', 'thead',
        'tbody', 'tr', 'th', 'td', 'blockquote', 'pre', 'code',
      ],
      ALLOWED_ATTR: ['href', 'target', 'rel', 'style'],
      ALLOW_DATA_ATTR: false,
    });
  }, [selectedMail]);

  const handleSelectMail = async (mail: MailDoc) => {
    setSelectedId(mail.id);
    setReplyBody('');
    setQuickReplyError(null);
    if (!mail.isRead) {
      await api.updateMail(mail.id, { isRead: true });
      onMailsChanged();
    }
  };

  const handleToggleStar = async (mail: MailDoc, e?: React.MouseEvent) => {
    e?.stopPropagation();
    await api.updateMail(mail.id, { isStarred: !mail.isStarred });
    onMailsChanged();
  };

  const handleToggleRead = async (mail: MailDoc) => {
    await api.updateMail(mail.id, { isRead: !mail.isRead });
    onMailsChanged();
  };

  const handleDeleteSingle = async (mail: MailDoc) => {
    await api.deleteMail(mail.id);
    setCheckedIds((prev) => {
      const next = new Set(prev);
      next.delete(mail.id);
      return next;
    });
    onMailsChanged();
  };

  const activeStopOnReplyCandidate = useMemo(() => {
    for (const sched of schedules) {
      if (!sched.stopOnReply) continue;
      const pendingSlot = sched.slots.find((s) => s.status === 'pending');
      if (pendingSlot) {
        return { sched, pendingSlot };
      }
    }
    return null;
  }, [schedules]);

  const handleSyncIngest = async () => {
    setSyncing(true);
    setReplyNotice(null);
    try {
      const res = await api.ingestMail();
      const first = res.ingested[0];
      if (first) {
        setSelectedId(first.id);
        const pillCount = first.suggestedActions?.length || 0;
        setReplyNotice(
          `Simulated incoming mail from ${first.fromName}: "${first.subject}" — extracted ${pillCount} Smart Action ${
            pillCount === 1 ? 'Pill' : 'Pills'
          }.`
        );
      }
      onMailsChanged();
    } finally {
      setSyncing(false);
    }
  };

  const handleSmartAction = async (mail: MailDoc, action: SuggestedAction) => {
    if (action.type === 'reply_draft') {
      onSendToAgent(buildDraftAgentCommandForAction(mail));
      return;
    }
    if (action.type === 'schedule_followup') {
      onSendToAgent(buildScheduleAgentCommandForAction(mail, action));
      return;
    }
    if (action.type === 'copy_otp' && action.otpCode) {
      await navigator.clipboard?.writeText(action.otpCode).catch(() => {});
      if (action.otpVaultId) {
        await api.markOtpUsed(action.otpVaultId).catch(() => {});
        onOtpConsumed?.();
      }
      setCopiedActionId(action.id);
      setTimeout(() => setCopiedActionId(null), 1800);
    }
  };

  const renderSmartActionPill = (
    mail: MailDoc,
    action: SuggestedAction,
    compact = false
  ) => {
    const isCopied = copiedActionId === action.id;
    const baseCls = compact
      ? 'inline-flex items-center gap-1 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 py-0.5 text-[11px] font-medium text-[var(--text-primary)] whitespace-nowrap transition-colors hover:bg-[var(--accent-muted)]'
      : 'inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-2.5 py-1 text-xs font-medium text-[var(--text-primary)] whitespace-nowrap transition-colors hover:bg-[var(--accent-muted)]';

    if (action.type === 'reply_draft') {
      return (
        <button
          key={action.id}
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            void handleSmartAction(mail, action);
          }}
          className={baseCls}
        >
          <PenLine className="h-3 w-3 shrink-0 text-[var(--text-secondary)]" />
          Draft Reply
        </button>
      );
    }

    if (action.type === 'schedule_followup') {
      return (
        <button
          key={action.id}
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            void handleSmartAction(mail, action);
          }}
          title={action.targetDatetime ? `Target UTC: ${action.targetDatetime}` : undefined}
          className={baseCls}
        >
          <CalendarClock className="h-3 w-3 shrink-0 text-[var(--text-secondary)]" />
          Schedule Follow-Up
          {!compact && action.extractedDateLabel && (
            <span className="text-[var(--text-secondary)]">({action.extractedDateLabel})</span>
          )}
        </button>
      );
    }

    return (
      <button
        key={action.id}
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          void handleSmartAction(mail, action);
        }}
        className={baseCls}
      >
        {isCopied ? (
          <Check className="h-3 w-3 shrink-0 text-[var(--text-primary)]" />
        ) : (
          <Copy className="h-3 w-3 shrink-0 text-[var(--text-secondary)]" />
        )}
        {isCopied ? `Copied ${action.otpCode}` : `Copy OTP${action.otpCode ? ` (${action.otpCode})` : ''}`}
      </button>
    );
  };

  const handleSimulateReply = async () => {
    setSimulatingReply(true);
    setReplyNotice(null);
    try {
      const targetEmail =
        activeStopOnReplyCandidate?.pendingSlot.recipient ||
        (selectedMail?.folder === 'sent' ? selectedMail.to[0] : selectedMail?.fromEmail) ||
        'recruiter@northstar.io';
      const senderLocal = targetEmail.split('@')[0] || 'Recipient';
      const senderName = senderLocal.charAt(0).toUpperCase() + senderLocal.slice(1);
      const baseSubject =
        activeStopOnReplyCandidate?.sched.subject || selectedMail?.subject || 'Follow-up thread';
      const threadId = activeStopOnReplyCandidate?.sched.threadId || selectedMail?.threadId;

      const res = await api.ingestMail({
        fromName: senderName,
        fromEmail: targetEmail,
        subject: baseSubject.startsWith('Re:') ? baseSubject : `Re: ${baseSubject}`,
        textBody:
          'Thanks for following up! Replying here so we can finalize details — no further reminders needed.',
        threadId,
        inReplyTo: threadId,
      });

      const cancelled = res.stopOnReply?.cancelledSlotsCount ?? 0;
      setReplyNotice(
        cancelled > 0
          ? `Simulated reply from ${targetEmail} — halted ${cancelled} pending follow-up ${
              cancelled === 1 ? 'slot' : 'slots'
            }.`
          : `Simulated incoming reply from ${targetEmail}.`
      );
      if (res.ingested[0]?.id) {
        setSelectedId(res.ingested[0].id);
      }
      onMailsChanged();
      onSchedulesChanged?.();
    } finally {
      setSimulatingReply(false);
    }
  };

  const handleGenerateQuickReply = async (toneOverride?: QuickReplyTone) => {
    if (!selectedMail || generatingQuickReply) return;
    const tone = toneOverride || quickReplyTone;
    setQuickReplyError(null);
    setGeneratingQuickReply(true);
    try {
      const res = await api.generateQuickReply(selectedMail.id, tone);
      setReplyBody(res.draft);
    } catch (err) {
      setQuickReplyError(
        err instanceof Error ? err.message : 'Unable to generate Quick Reply draft.'
      );
    } finally {
      setGeneratingQuickReply(false);
    }
  };

  const handleSendReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedMail || !replyBody.trim()) return;
    setSendingReply(true);
    try {
      const target =
        selectedMail.folder === 'sent' ? selectedMail.to : [selectedMail.fromEmail];
      await api.sendMail({
        to: target,
        subject: selectedMail.subject.startsWith('Re:')
          ? selectedMail.subject
          : `Re: ${selectedMail.subject}`,
        textBody: replyBody.trim(),
      });
      setReplyBody('');
      setQuickReplyError(null);
      onMailsChanged();
    } finally {
      setSendingReply(false);
    }
  };

  const handleComposeSubmit = async (saveAsDraft: boolean) => {
    setComposeError(null);
    const recipients = parseRecipientList(composeTo);
    if (!saveAsDraft && recipients.length === 0) {
      setComposeError('Enter at least one recipient email address.');
      return;
    }
    if (!composeSubject.trim()) {
      setComposeError('Subject is required.');
      return;
    }
    setSendingCompose(true);
    try {
      await api.sendMail({
        to: recipients,
        subject: composeSubject.trim(),
        textBody: composeBody.trim(),
        saveAsDraft,
      });
      setComposeOpen(false);
      setComposeTo('');
      setComposeSubject('');
      setComposeBody('');
      onMailsChanged();
    } catch (err) {
      setComposeError(err instanceof Error ? err.message : 'Failed to send.');
    } finally {
      setSendingCompose(false);
    }
  };

  const handleBulkToggleRead = async (isRead: boolean) => {
    await Promise.all(Array.from(checkedIds).map((id) => api.updateMail(id, { isRead })));
    setCheckedIds(new Set());
    onMailsChanged();
  };

  const confirmBulkDelete = async () => {
    if (!bulkConfirm) return;
    setBulkDeleting(true);
    try {
      await api.bulkDeleteMails({
        ids: bulkConfirm.ids,
        category: bulkConfirm.category,
      });
      setCheckedIds(new Set());
      setBulkConfirm(null);
      onMailsChanged();
    } finally {
      setBulkDeleting(false);
    }
  };

  const copyCode = (code: string) => {
    void navigator.clipboard?.writeText(code);
    setCopiedOtp(code);
    setTimeout(() => setCopiedOtp(null), 1600);
  };

  const filterTabs: Array<{ id: string; label: string }> = [
    { id: 'all', label: 'All' },
    { id: 'inbox', label: 'Inbox' },
    { id: 'unread', label: 'Unread' },
    { id: 'starred', label: 'Starred' },
    { id: 'sent', label: 'Sent' },
    { id: 'drafts', label: 'Drafts' },
    { id: 'archive', label: 'Archived' },
    ...categories.map((c) => ({ id: c.name, label: c.name })),
  ];

  return (
    <div className="flex h-full flex-col bg-[var(--bg-canvas)]">
      {/* Top Action & Filter Bar */}
      <div className="border-b border-[var(--border-subtle)] px-4 py-3 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="relative min-w-[220px] flex-1 max-w-md">
            <Search className="pointer-events-none absolute top-2.5 left-3 h-4 w-4 text-[var(--text-secondary)]" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search sender, subject, or content..."
              aria-label="Search mail"
              className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] py-1.5 pr-3 pl-9 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-secondary)]/80 focus:border-[var(--accent-primary)] focus:outline-none"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {otpMails.length > 0 && (
              <button
                type="button"
                onClick={() =>
                  setBulkConfirm({
                    title: 'Safe Bulk Delete OTP Emails',
                    description:
                      'All detected OTP and verification code messages will be permanently deleted from your mailbox.',
                    category: 'OTP',
                    count: otpMails.length,
                    sampleSubjects: otpMails.slice(0, 5).map((m) => `${m.fromName}: ${m.subject}`),
                  })
                }
                className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--accent-muted)] whitespace-nowrap"
              >
                <ShieldAlert className="h-3.5 w-3.5 text-[var(--text-secondary)]" />
                Clean OTP ({otpMails.length})
              </button>
            )}

            <button
              type="button"
              onClick={handleSyncIngest}
              disabled={syncing}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--accent-muted)] whitespace-nowrap disabled:opacity-60"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${syncing ? 'animate-spin' : ''}`} />
              Simulate Incoming Mail
            </button>

            <button
              type="button"
              onClick={handleSimulateReply}
              disabled={simulatingReply}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--accent-muted)] whitespace-nowrap disabled:opacity-60"
            >
              <Reply className="h-3.5 w-3.5" />
              {simulatingReply ? 'Simulating...' : 'Simulate Reply'}
            </button>

            <button
              type="button"
              onClick={() => setComposeOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent-primary)] px-3.5 py-1.5 text-xs font-medium text-[var(--text-on-accent)] shadow-xs transition-colors hover:bg-[var(--accent-primary-hover)] whitespace-nowrap"
            >
              <PenSquare className="h-3.5 w-3.5" />
              Compose
            </button>
          </div>
        </div>

        {replyNotice && (
          <div className="mt-2.5 flex items-center justify-between gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 text-xs font-medium text-[var(--text-primary)]">
            <span>{replyNotice}</span>
            <button
              type="button"
              onClick={() => setReplyNotice(null)}
              className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:underline"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Category / Folder Segmented Tabs */}
        <div className="mt-3 flex items-center gap-1.5 overflow-x-auto pb-0.5">
          {filterTabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setFilter(tab.id)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
                filter.toLowerCase() === tab.id.toLowerCase()
                  ? 'bg-[var(--accent-primary)] text-[var(--text-on-accent)] shadow-xs'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--accent-muted)]/60 hover:text-[var(--text-primary)]'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Bulk Selection Actions */}
        {checkedIds.size > 0 && (
          <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-1.5 text-xs">
            <span className="font-medium text-[var(--text-primary)] tabular-nums">
              {checkedIds.size} selected
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => handleBulkToggleRead(true)}
                className="rounded px-2 py-1 font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--accent-muted)]"
              >
                Mark Read
              </button>
              <button
                type="button"
                onClick={() => handleBulkToggleRead(false)}
                className="rounded px-2 py-1 font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--accent-muted)]"
              >
                Mark Unread
              </button>
              <button
                type="button"
                onClick={() => {
                  const ids = Array.from(checkedIds);
                  const sampleSubjects = mails
                    .filter((m) => checkedIds.has(m.id))
                    .slice(0, 5)
                    .map((m) => m.subject);
                  setBulkConfirm({
                    title: 'Confirm Bulk Delete',
                    description: 'Selected emails will be permanently removed.',
                    ids,
                    count: ids.length,
                    sampleSubjects,
                  });
                }}
                className="rounded bg-[#DC2626] px-2.5 py-1 font-medium text-white transition-opacity hover:opacity-90"
              >
                Delete Selected
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Split List + Thread Reader (or full Inbox Zero state when empty) */}
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {filteredMails.length === 0 ? (
          <div className="flex flex-1 items-center justify-center overflow-y-auto bg-[var(--bg-surface)]">
            {(() => {
              const trimmedSearch = search.trim();
              const hasActiveFilter = filter !== 'all' || Boolean(trimmedSearch);
              const emptyTitle = trimmedSearch
                ? 'No matching emails'
                : filter === 'unread'
                ? 'Inbox Zero — All caught up'
                : filter === 'all' || filter === 'inbox'
                ? 'Inbox Zero'
                : `${filter === 'archive' ? 'Archive' : filter.charAt(0).toUpperCase() + filter.slice(1)} is clear`;
              const emptyDescription = trimmedSearch
                ? `No messages match "${trimmedSearch}". Clear your search or switch views to inspect other emails.`
                : filter === 'unread'
                ? 'Every unread message has been read or cleared. Your inbox is completely up to date.'
                : filter === 'all' || filter === 'inbox'
                ? 'All emails have been cleared. Take a breather — new incoming mail will appear right here.'
                : 'No messages remain in this view. Everything here has been handled.';

              return (
                <InboxZeroState
                  title={emptyTitle}
                  description={emptyDescription}
                  isSearchEmpty={Boolean(trimmedSearch)}
                  simulating={syncing}
                  onResetFilters={
                    hasActiveFilter
                      ? () => {
                          setSearch('');
                          setFilter('all');
                        }
                      : undefined
                  }
                  onSimulateIncoming={handleSyncIngest}
                  onCompose={() => setComposeOpen(true)}
                />
              );
            })()}
          </div>
        ) : (
          <>
            {/* Mail List */}
            <div className="w-full overflow-y-auto border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] lg:w-[400px] lg:shrink-0 lg:border-r lg:border-b-0">
              <ul className="divide-y divide-[var(--border-subtle)]">
              {filteredMails.map((mail) => {
                const isSelected = selectedMail?.id === mail.id;
                const isChecked = checkedIds.has(mail.id);
                return (
                  <li
                    key={mail.id}
                    className={`flex items-start gap-2.5 px-4 py-3 transition-colors ${
                      isSelected
                        ? 'bg-[var(--accent-soft)]'
                        : 'hover:bg-[var(--bg-canvas)]'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isChecked}
                      aria-label={`Select ${mail.subject}`}
                      onChange={(e) => {
                        setCheckedIds((prev) => {
                          const next = new Set(prev);
                          if (e.target.checked) next.add(mail.id);
                          else next.delete(mail.id);
                          return next;
                        });
                      }}
                      className="mt-1 h-4 w-4 rounded border-[var(--border-subtle)] accent-[#2563EB]"
                    />

                    <button
                      type="button"
                      onClick={(e) => handleToggleStar(mail, e)}
                      aria-label={mail.isStarred ? `Unstar ${mail.subject}` : `Star ${mail.subject}`}
                      className="mt-0.5 shrink-0 text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                    >
                      <Star
                        className={`h-4 w-4 ${
                          mail.isStarred ? 'fill-[#D97706] text-[#D97706]' : ''
                        }`}
                      />
                    </button>

                    <div className="min-w-0 flex-1">
                      <button
                        type="button"
                        onClick={() => handleSelectMail(mail)}
                        className="w-full text-left"
                      >
                        <div className="flex items-baseline justify-between gap-2">
                          <span
                            className={`truncate text-sm ${
                              !mail.isRead
                                ? 'font-semibold text-[var(--text-primary)]'
                                : 'font-medium text-[var(--text-secondary)]'
                            }`}
                          >
                            {mail.folder === 'sent' ? `To: ${mail.to.join(', ')}` : mail.fromName}
                          </span>
                          <span className="shrink-0 tabular-nums text-[11px] text-[var(--text-secondary)]">
                            {formatLocalTimestamp(mail.receivedAt)}
                          </span>
                        </div>

                        <div
                          className={`mt-0.5 truncate text-xs ${
                            !mail.isRead
                              ? 'font-semibold text-[var(--text-primary)]'
                              : 'text-[var(--text-secondary)]'
                          }`}
                        >
                          {mail.subject}
                        </div>

                        <div className="mt-1 flex items-center gap-1.5 text-[11px] text-[var(--text-secondary)]">
                          <span
                            className={
                              mail.category === 'OTP'
                                ? 'font-semibold text-[var(--text-primary)]'
                                : 'font-medium text-[var(--text-secondary)]'
                            }
                          >
                            {mail.category}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span className="truncate">{mail.snippet}</span>
                        </div>
                      </button>

                      {(mail.suggestedActions?.length ?? 0) > 0 && (
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          {mail.suggestedActions!.slice(0, 2).map((act) =>
                            renderSmartActionPill(mail, act, true)
                          )}
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>

          {/* Detail Reader Pane */}
          <div className="flex-1 overflow-y-auto p-5 sm:p-7">
            {!selectedMail ? (
              <div className="flex h-full items-center justify-center text-sm text-[var(--text-secondary)]">
                Select an email from the list to inspect its contents.
              </div>
            ) : (
            <div className="mx-auto max-w-3xl">
              <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[var(--border-subtle)] pb-4">
                <div className="min-w-0">
                  <h2 className="font-display text-xl font-semibold text-[var(--text-primary)]">
                    {selectedMail.subject}
                  </h2>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-[var(--text-secondary)]">
                    <span className="font-semibold text-[var(--text-primary)]">
                      {selectedMail.fromName}
                    </span>
                    <span>&lt;{selectedMail.fromEmail}&gt;</span>
                    <span aria-hidden="true">·</span>
                    <span className="tabular-nums">
                      {formatLocalTimestamp(selectedMail.receivedAt)}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="font-medium text-[var(--text-primary)]">
                      {selectedMail.category}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-[var(--text-secondary)]">
                    To: {selectedMail.to.join(', ')}
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => handleToggleRead(selectedMail)}
                    aria-label={selectedMail.isRead ? 'Mark as unread' : 'Mark as read'}
                    title={selectedMail.isRead ? 'Mark unread' : 'Mark read'}
                    className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-2 text-[var(--text-primary)] transition-colors hover:bg-[var(--accent-muted)]"
                  >
                    {selectedMail.isRead ? (
                      <MailIcon className="h-4 w-4" />
                    ) : (
                      <MailOpen className="h-4 w-4" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      onSendToAgent(
                        `/draft Reply to @${selectedMail.fromEmail} regarding @mail:${selectedMail.subject.slice(0, 32)}`
                      )
                    }
                    className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--accent-muted)]"
                  >
                    Draft Reply with Agent
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteSingle(selectedMail)}
                    aria-label={`Delete ${selectedMail.subject}`}
                    title="Delete email"
                    className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-2 text-[var(--text-secondary)] transition-colors hover:bg-[#DC2626]/10 hover:text-[#DC2626] dark:hover:text-[#F87171]"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {/* Zero-Click Inbox-to-Action Smart Pills */}
              {(selectedMail.suggestedActions?.length ?? 0) > 0 && (
                <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3.5 py-2.5">
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-[var(--text-secondary)]">
                    <Sparkles className="h-3.5 w-3.5 text-[var(--accent-text)]" />
                    Suggested Actions:
                  </span>
                  {selectedMail.suggestedActions!.slice(0, 2).map((act) =>
                    renderSmartActionPill(selectedMail, act, false)
                  )}
                </div>
              )}

              {/* Extracted OTP Quick Copy Banner */}
              {selectedMail.category === 'OTP' && selectedMail.otpCode && (
                <div className="mt-4 flex items-center justify-between rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 py-3">
                  <div>
                    <div className="text-xs font-medium text-[var(--text-secondary)]">
                      Detected Verification Code
                    </div>
                    <div className="font-mono text-lg font-bold tracking-wider text-[var(--text-primary)]">
                      {selectedMail.otpCode}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => copyCode(selectedMail.otpCode!)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--accent-muted)]"
                  >
                    {copiedOtp === selectedMail.otpCode ? (
                      <>
                        <Check className="h-3.5 w-3.5" /> Copied
                      </>
                    ) : (
                      <>
                        <Copy className="h-3.5 w-3.5" /> Copy Code
                      </>
                    )}
                  </button>
                </div>
              )}

              {/* Sanitized Email Body */}
              <div className="mt-5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5">
                {sanitizedHtml ? (
                  <div
                    className="mail-html-sandbox text-[var(--text-primary)]"
                    dangerouslySetInnerHTML={{ __html: sanitizedHtml }}
                  />
                ) : (
                  <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-[var(--text-primary)]">
                    {selectedMail.textBody}
                  </pre>
                )}
              </div>

              {/* Quick Inline Reply */}
              <form
                onSubmit={handleSendReply}
                data-testid="quick-reply-form"
                className="mt-6 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4"
              >
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2.5">
                  <label
                    htmlFor="quick-reply"
                    className="flex items-center gap-1.5 text-xs font-semibold text-[var(--text-primary)]"
                  >
                    <Reply className="h-3.5 w-3.5 text-[var(--accent-text)]" />
                    Quick Reply to{' '}
                    {selectedMail.folder === 'sent'
                      ? selectedMail.to.join(', ')
                      : selectedMail.fromEmail}
                  </label>

                  <div className="flex flex-wrap items-center gap-2">
                    <div
                      role="group"
                      aria-label="Quick Reply tone"
                      className="inline-flex rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-0.5"
                    >
                      {QUICK_REPLY_TONES.map((tone) => (
                        <button
                          key={tone}
                          type="button"
                          onClick={() => {
                            setQuickReplyTone(tone);
                            setQuickReplyError(null);
                          }}
                          aria-pressed={quickReplyTone === tone}
                          className={`rounded-md px-2.5 py-1 text-[11px] font-medium whitespace-nowrap transition-colors ${
                            quickReplyTone === tone
                              ? 'bg-[var(--accent-primary)] text-[var(--text-on-accent)] shadow-xs'
                              : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                          }`}
                        >
                          {tone}
                        </button>
                      ))}
                    </div>

                    <button
                      type="button"
                      onClick={() => void handleGenerateQuickReply()}
                      disabled={generatingQuickReply}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--accent-primary)]/30 bg-[var(--accent-soft)] px-3 py-1.5 text-xs font-medium text-[var(--accent-text)] whitespace-nowrap transition-colors hover:bg-[var(--accent-primary)] hover:text-[var(--text-on-accent)] disabled:opacity-60"
                    >
                      {generatingQuickReply ? (
                        <>
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          Drafting...
                        </>
                      ) : (
                        <>
                          <Sparkles className="h-3.5 w-3.5" />
                          Generate Draft
                        </>
                      )}
                    </button>
                  </div>
                </div>

                <textarea
                  id="quick-reply"
                  rows={4}
                  value={replyBody}
                  onChange={(e) => setReplyBody(e.target.value)}
                  placeholder={`Write a quick reply or click Generate Draft (${quickReplyTone} tone)...`}
                  className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-2.5 text-sm leading-relaxed text-[var(--text-primary)] placeholder:text-[var(--text-secondary)]/75 focus:border-[var(--accent-primary)] focus:outline-none"
                />

                {quickReplyError && (
                  <p
                    role="alert"
                    className="mt-2 rounded-lg border border-[#DC2626]/30 bg-[var(--bg-canvas)] px-3 py-2 text-xs text-[#DC2626] dark:text-[#F87171]"
                  >
                    {quickReplyError}
                  </p>
                )}

                <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[11px] text-[var(--text-secondary)]">
                    Select a tone to draft with AI, then edit or send.
                  </span>
                  <button
                    type="submit"
                    disabled={!replyBody.trim() || sendingReply || generatingQuickReply}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent-primary)] px-3.5 py-1.5 text-xs font-medium text-[var(--text-on-accent)] transition-colors hover:bg-[var(--accent-primary-hover)] disabled:opacity-50"
                  >
                    <Send className="h-3.5 w-3.5" />
                    {sendingReply ? 'Sending...' : 'Send Reply'}
                  </button>
                </div>
              </form>
              </div>
            )}
          </div>
          </>
        )}
      </div>

      {/* Compose Modal */}
      {composeOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#0F172A]/45 p-4 backdrop-blur-xs"
          role="dialog"
          aria-modal="true"
          aria-labelledby="compose-modal-title"
        >
          <div className="w-full max-w-lg rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-3">
              <h3 id="compose-modal-title" className="text-base font-semibold text-[var(--text-primary)]">
                Compose Message
              </h3>
              <button
                type="button"
                onClick={() => setComposeOpen(false)}
                aria-label="Close compose modal"
                className="rounded-lg p-1.5 text-[var(--text-secondary)] transition-colors hover:bg-[var(--accent-muted)] hover:text-[var(--text-primary)]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 space-y-3">
              <div>
                <label htmlFor="compose-to" className="mb-1 block text-xs font-medium text-[var(--text-primary)]">
                  To (comma-separated)
                </label>
                <input
                  id="compose-to"
                  type="text"
                  value={composeTo}
                  onChange={(e) => setComposeTo(e.target.value)}
                  placeholder="sarah@northstar.io, alex@acme.dev"
                  className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-secondary)]/75 focus:border-[var(--accent-primary)] focus:outline-none"
                />
              </div>
              <div>
                <label htmlFor="compose-subject" className="mb-1 block text-xs font-medium text-[var(--text-primary)]">
                  Subject
                </label>
                <input
                  id="compose-subject"
                  type="text"
                  value={composeSubject}
                  onChange={(e) => setComposeSubject(e.target.value)}
                  placeholder="Subject line"
                  className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-secondary)]/75 focus:border-[var(--accent-primary)] focus:outline-none"
                />
              </div>
              <div>
                <label htmlFor="compose-body" className="mb-1 block text-xs font-medium text-[var(--text-primary)]">
                  Message
                </label>
                <textarea
                  id="compose-body"
                  rows={6}
                  value={composeBody}
                  onChange={(e) => setComposeBody(e.target.value)}
                  placeholder="Write your email..."
                  className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-secondary)]/75 focus:border-[var(--accent-primary)] focus:outline-none"
                />
              </div>
              {composeError && (
                <p className="rounded-lg border border-[#DC2626]/30 bg-[var(--bg-canvas)] px-3 py-2 text-xs text-[#DC2626] dark:text-[#F87171]">
                  {composeError}
                </p>
              )}
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                disabled={sendingCompose}
                onClick={() => handleComposeSubmit(true)}
                className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-3.5 py-2 text-xs font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--accent-muted)]"
              >
                Save Draft
              </button>
              <button
                type="button"
                disabled={sendingCompose}
                onClick={() => handleComposeSubmit(false)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent-primary)] px-4 py-2 text-xs font-medium text-[var(--text-on-accent)] transition-colors hover:bg-[var(--accent-primary-hover)] disabled:opacity-60"
              >
                <Send className="h-3.5 w-3.5" />
                {sendingCompose ? 'Sending...' : 'Send Email'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Safe Bulk Delete Confirmation Modal */}
      {bulkConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#0F172A]/45 p-4 backdrop-blur-xs"
          role="dialog"
          aria-modal="true"
          aria-labelledby="bulk-delete-title"
        >
          <div className="w-full max-w-md rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-6 shadow-xl">
            <h3 id="bulk-delete-title" className="text-base font-semibold text-[var(--text-primary)]">
              {bulkConfirm.title}
            </h3>
            <p className="mt-1.5 text-xs text-[var(--text-secondary)]">
              {bulkConfirm.description}
            </p>
            <div className="mt-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-3">
              <div className="text-xs font-semibold text-[var(--text-primary)] tabular-nums">
                Count to delete: {bulkConfirm.count} {bulkConfirm.count === 1 ? 'email' : 'emails'}
              </div>
              <ul className="mt-1.5 space-y-1 text-xs text-[var(--text-secondary)]">
                {bulkConfirm.sampleSubjects.map((s, idx) => (
                  <li key={idx} className="truncate">
                    · {s}
                  </li>
                ))}
              </ul>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setBulkConfirm(null)}
                className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-3.5 py-2 text-xs font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--accent-muted)]"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={bulkDeleting}
                onClick={confirmBulkDelete}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#DC2626] px-4 py-2 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
              >
                <Trash2 className="h-3.5 w-3.5" />
                {bulkDeleting ? 'Deleting...' : `Confirm Delete (${bulkConfirm.count})`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
