import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Archive,
  ArrowUp,
  AtSign,
  CalendarClock,
  CalendarPlus,
  Check,
  CheckCircle2,
  Copy,
  KeyRound,
  Loader2,
  Mail,
  PenLine,
  Reply,
  Send,
  ShieldAlert,
  Slash,
  Sparkles,
  Tag,
  Trash2,
} from 'lucide-react';
import { formatCountdownMmSs } from './FloatingOtpPill';
import { PrivacyFeaturesSection } from './PrivacyFeaturesSection';
import {
  CategoryDoc,
  ChatMessage,
  ChatSessionDoc,
  DigestItem,
  MailDoc,
  ScheduleRuleInput,
} from '../shared/types';
import {
  extractAutocompleteContext,
  SLASH_COMMANDS,
} from '../shared/agentTriggers';
import { buildSchedulePrefillForDigestItem } from '../shared/digest';
import { formatLocalTimestamp, formatUtcTimestamp, parseRecipientList } from '../shared/scheduler';
import { api } from '../api/client';

interface NewTabAgentProps {
  activeChat: ChatSessionDoc | null;
  mails: MailDoc[];
  categories: CategoryDoc[];
  userName: string;
  promptPrefill?: string | null;
  onClearPromptPrefill?: () => void;
  onChatUpdated: (chat: ChatSessionDoc) => void;
  onScheduleCreated: () => void;
  onOpenScheduleBuilder: (prefill?: ScheduleRuleInput) => void;
  onOpenDigestView?: () => void;
  onDraftInAgent?: (item: DigestItem) => void;
  onMailsChanged: () => void;
  onOtpConsumed: () => void;
}

interface AutocompleteItem {
  id: string;
  insertText: string;
  title: string;
  subtitle: string;
  kind: 'command' | 'recipient' | 'category' | 'mail';
}

export const NewTabAgent: React.FC<NewTabAgentProps> = ({
  activeChat,
  mails,
  categories,
  userName,
  promptPrefill,
  onClearPromptPrefill,
  onChatUpdated,
  onScheduleCreated,
  onOpenScheduleBuilder,
  onOpenDigestView,
  onDraftInAgent,
  onMailsChanged,
  onOtpConsumed,
}) => {
  const [prompt, setPrompt] = useState('');
  const [cursorPos, setCursorPos] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [highlightIndex, setHighlightIndex] = useState(0);
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const [busyMessageId, setBusyMessageId] = useState<string | null>(null);

  // Editable draft overrides keyed by message ID
  const [draftEdits, setDraftEdits] = useState<
    Record<string, { to: string; subject: string; body: string }>
  >({});

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const threadEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeChat?.messages.length]);

  useEffect(() => {
    if (promptPrefill) {
      setPrompt(promptPrefill);
      setCursorPos(promptPrefill.length);
      setDismissedAt(null);
      onClearPromptPrefill?.();
      requestAnimationFrame(() => {
        if (textareaRef.current) {
          textareaRef.current.focus();
          textareaRef.current.setSelectionRange(promptPrefill.length, promptPrefill.length);
        }
      });
    }
  }, [promptPrefill, onClearPromptPrefill]);

  const autocompleteCtx = useMemo(
    () => extractAutocompleteContext(prompt, cursorPos),
    [prompt, cursorPos]
  );

  const suggestions: AutocompleteItem[] = useMemo(() => {
    if (!autocompleteCtx.triggerType) return [];
    const q = autocompleteCtx.query.toLowerCase();

    if (autocompleteCtx.triggerType === '/') {
      return SLASH_COMMANDS.filter(
        (c) => c.command.toLowerCase().includes(q) || c.label.toLowerCase().includes(q)
      ).map((c) => ({
        id: c.command,
        insertText: `${c.command} `,
        title: c.command,
        subtitle: c.description,
        kind: 'command',
      }));
    }

    // '@' suggestions: categories, recipients, and recent mails
    const items: AutocompleteItem[] = [];
    for (const cat of categories) {
      items.push({
        id: `cat_${cat.id}`,
        insertText: `@category:${cat.name} `,
        title: `@category:${cat.name}`,
        subtitle: cat.description || 'Category context',
        kind: 'category',
      });
    }

    const seenEmails = new Set<string>();
    for (const m of mails) {
      const candidates = [
        { email: m.fromEmail, name: m.fromName },
        ...m.to.map((addr) => ({ email: addr, name: addr })),
      ];
      for (const c of candidates) {
        const lower = c.email.toLowerCase();
        if (!seenEmails.has(lower)) {
          seenEmails.add(lower);
          items.push({
            id: `rec_${lower}`,
            insertText: `@${c.email} `,
            title: `@${c.email}`,
            subtitle: c.name !== c.email ? `Recipient · ${c.name}` : 'Recipient contact',
            kind: 'recipient',
          });
        }
      }
    }

    for (const m of mails.slice(0, 6)) {
      const slug = m.subject.replace(/\s+/g, '_').slice(0, 28);
      items.push({
        id: `mail_${m.id}`,
        insertText: `@mail:${slug} `,
        title: `@mail:${m.subject.slice(0, 36)}`,
        subtitle: `From ${m.fromName}`,
        kind: 'mail',
      });
    }

    return items
      .filter((item) => item.title.toLowerCase().includes(q) || item.subtitle.toLowerCase().includes(q))
      .slice(0, 8);
  }, [autocompleteCtx, categories, mails]);

  const showDropdown =
    autocompleteCtx.triggerType !== null &&
    suggestions.length > 0 &&
    dismissedAt !== autocompleteCtx.startIndex;

  useEffect(() => {
    setHighlightIndex(0);
  }, [autocompleteCtx.query, autocompleteCtx.triggerType]);

  const applyAutocomplete = (item: AutocompleteItem) => {
    if (autocompleteCtx.startIndex < 0) return;
    const before = prompt.slice(0, autocompleteCtx.startIndex);
    const after = prompt.slice(autocompleteCtx.endIndex);
    const next = `${before}${item.insertText}${after}`;
    const nextCursor = before.length + item.insertText.length;
    setPrompt(next);
    setCursorPos(nextCursor);
    setDismissedAt(null);
    requestAnimationFrame(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        textareaRef.current.setSelectionRange(nextCursor, nextCursor);
      }
    });
  };

  const handleSubmit = async (overridePrompt?: string) => {
    const text = (overridePrompt ?? prompt).trim();
    if (!text || submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      const res = await api.executeAgent(text, activeChat?.id || null);
      onChatUpdated(res.chat);
      if (!overridePrompt) {
        setPrompt('');
        setCursorPos(0);
      }
      if (res.assistantMessage.actionPreview?.type === 'categorize_summary') {
        onMailsChanged();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Agent request failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (showDropdown) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHighlightIndex((i) => (i + 1) % suggestions.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlightIndex((i) => (i - 1 + suggestions.length) % suggestions.length);
        return;
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
        e.preventDefault();
        applyAutocomplete(suggestions[highlightIndex]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setDismissedAt(autocompleteCtx.startIndex);
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSubmit();
    }
  };

  const handleConfirmSchedule = async (msg: ChatMessage) => {
    if (!activeChat || msg.actionPreview?.type !== 'schedule_preview') return;
    setBusyMessageId(msg.id);
    setError(null);
    try {
      const created = await api.createSchedule(msg.actionPreview.rule);
      const updated = await api.updateChat(activeChat.id, {
        messageId: msg.id,
        actionPatch: { confirmed: true, createdScheduleId: created.schedule.id },
      });
      onChatUpdated(updated.chat);
      onScheduleCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not confirm schedule.');
    } finally {
      setBusyMessageId(null);
    }
  };

  const handleDraftAction = async (msg: ChatMessage, action: 'send' | 'draft') => {
    if (!activeChat || msg.actionPreview?.type !== 'draft_preview') return;
    const edited = draftEdits[msg.id];
    const toList = parseRecipientList(edited ? edited.to : msg.actionPreview.to);
    const subject = edited ? edited.subject : msg.actionPreview.subject;
    const body = edited ? edited.body : msg.actionPreview.body;

    setBusyMessageId(msg.id);
    setError(null);
    try {
      await api.sendMail({
        to: toList,
        subject,
        textBody: body,
        saveAsDraft: action === 'draft',
      });
      const updated = await api.updateChat(activeChat.id, {
        messageId: msg.id,
        actionPatch: {
          to: toList,
          subject,
          body,
          status: action === 'draft' ? 'saved_draft' : 'sent',
        },
      });
      onChatUpdated(updated.chat);
      onMailsChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not process draft.');
    } finally {
      setBusyMessageId(null);
    }
  };

  const handleConfirmOtpCleanup = async (msg: ChatMessage) => {
    if (!activeChat || msg.actionPreview?.type !== 'otp_cleanup_preview') return;
    setBusyMessageId(msg.id);
    setError(null);
    try {
      const ids = msg.actionPreview.items.map((item) => item.id);
      await api.bulkDeleteMails({ ids });
      const updated = await api.updateChat(activeChat.id, {
        messageId: msg.id,
        actionPatch: { cleaned: true },
      });
      onChatUpdated(updated.chat);
      onMailsChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to clean OTP emails.');
    } finally {
      setBusyMessageId(null);
    }
  };

  const renderActionCard = (msg: ChatMessage) => {
    const preview = msg.actionPreview;
    if (!preview) return null;

    if (preview.type === 'schedule_preview') {
      const { rule, timestampsUtc, confirmed } = preview;
      return (
        <div className="mt-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-4">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-subtle)] pb-3">
            <div className="flex flex-wrap items-center gap-2">
              <CalendarClock className="h-4 w-4 text-[var(--text-primary)]" />
              <span className="text-sm font-semibold text-[var(--text-primary)]">
                Schedule Preview · {rule.mode === 'advanced' ? 'Advanced' : 'Basic'}
              </span>
              {rule.stopOnReply && (
                <span className="inline-flex items-center gap-1 rounded-md border border-[var(--border-subtle)] bg-[var(--accent-muted)]/45 px-2 py-0.5 text-[11px] font-medium text-[var(--text-primary)]">
                  <Reply className="h-3 w-3" />
                  Stop-on-Reply: Enabled
                </span>
              )}
            </div>
            <span className="tabular-nums text-xs text-[var(--text-secondary)]">
              freq={rule.freq} · gap={rule.gapValue} {rule.gapUnit} · {rule.recipients.length}{' '}
              {rule.recipients.length === 1 ? 'recipient' : 'recipients'}
            </span>
          </div>

          <div className="mt-3 space-y-2 text-xs text-[var(--text-primary)]">
            <div>
              <span className="font-medium text-[var(--text-secondary)]">To: </span>
              <span>{rule.recipients.join(', ')}</span>
            </div>
            <div>
              <span className="font-medium text-[var(--text-secondary)]">Subject: </span>
              <span className="font-medium text-[var(--text-primary)]">{rule.subject}</span>
            </div>
            <p className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-2.5 text-xs text-[var(--text-primary)]">
              {rule.body}
            </p>
          </div>

          <div className="mt-3 overflow-x-auto rounded-lg border border-[var(--border-subtle)]">
            <table className="w-full text-left text-xs">
              <thead className="bg-[var(--bg-surface)] text-[var(--text-secondary)]">
                <tr>
                  <th className="px-3 py-1.5 font-medium">Slot</th>
                  <th className="px-3 py-1.5 font-medium">UTC Timestamp</th>
                  <th className="px-3 py-1.5 font-medium">Local Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)]">
                {timestampsUtc.map((iso, i) => (
                  <tr key={iso + i}>
                    <td className="px-3 py-1.5 font-mono tabular-nums text-[var(--text-secondary)]">
                      t{i + 1}
                    </td>
                    <td className="px-3 py-1.5 font-mono tabular-nums text-[var(--text-primary)]">
                      {formatUtcTimestamp(iso)}
                    </td>
                    <td className="px-3 py-1.5 tabular-nums text-[var(--text-secondary)]">
                      {formatLocalTimestamp(iso)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => onOpenScheduleBuilder(rule)}
              className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--accent-muted)]"
            >
              Edit in Scheduler
            </button>
            {confirmed ? (
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--text-primary)]">
                <CheckCircle2 className="h-4 w-4" />
                Scheduled in Queue
              </span>
            ) : (
              <button
                type="button"
                disabled={busyMessageId === msg.id}
                onClick={() => handleConfirmSchedule(msg)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent-primary)] px-3.5 py-1.5 text-xs font-medium text-[var(--text-on-accent)] transition-colors hover:bg-[var(--accent-primary-hover)] disabled:opacity-60"
              >
                {busyMessageId === msg.id ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-3.5 w-3.5" />
                )}
                Confirm & Schedule
              </button>
            )}
          </div>
        </div>
      );
    }

    if (preview.type === 'draft_preview') {
      const current = draftEdits[msg.id] || {
        to: preview.to.join(', '),
        subject: preview.subject,
        body: preview.body,
      };
      const isDone = preview.status === 'sent' || preview.status === 'saved_draft';

      return (
        <div className="mt-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-4">
          <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-2.5">
            <div className="flex items-center gap-2">
              <Mail className="h-4 w-4 text-[var(--text-primary)]" />
              <span className="text-sm font-semibold text-[var(--text-primary)]">
                Draft Preview
              </span>
            </div>
            {preview.status === 'sent' && (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--text-primary)]">
                <CheckCircle2 className="h-3.5 w-3.5" /> Sent
              </span>
            )}
            {preview.status === 'saved_draft' && (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--text-secondary)]">
                <CheckCircle2 className="h-3.5 w-3.5" /> Saved to Drafts
              </span>
            )}
          </div>

          <div className="mt-3 space-y-2.5">
            <div>
              <label className="mb-1 block text-[11px] font-medium text-[var(--text-secondary)]">
                To
              </label>
              <input
                type="text"
                disabled={isDone}
                value={current.to}
                onChange={(e) =>
                  setDraftEdits((prev) => ({
                    ...prev,
                    [msg.id]: { ...current, to: e.target.value },
                  }))
                }
                className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-1.5 text-xs text-[var(--text-primary)] focus:border-[var(--accent-primary)] focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-medium text-[var(--text-secondary)]">
                Subject
              </label>
              <input
                type="text"
                disabled={isDone}
                value={current.subject}
                onChange={(e) =>
                  setDraftEdits((prev) => ({
                    ...prev,
                    [msg.id]: { ...current, subject: e.target.value },
                  }))
                }
                className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] focus:border-[var(--accent-primary)] focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-medium text-[var(--text-secondary)]">
                Body
              </label>
              <textarea
                rows={4}
                disabled={isDone}
                value={current.body}
                onChange={(e) =>
                  setDraftEdits((prev) => ({
                    ...prev,
                    [msg.id]: { ...current, body: e.target.value },
                  }))
                }
                className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 text-xs text-[var(--text-primary)] focus:border-[var(--accent-primary)] focus:outline-none"
              />
            </div>
          </div>

          {!isDone && (
            <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                disabled={busyMessageId === msg.id}
                onClick={() =>
                  onOpenScheduleBuilder({
                    mode: 'basic',
                    startUtc: new Date(Date.now() + 3600_000).toISOString(),
                    freq: 1,
                    gapValue: 0,
                    gapUnit: 'hours',
                    recipients: parseRecipientList(current.to),
                    subject: current.subject,
                    body: current.body,
                  })
                }
                className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--accent-muted)]"
              >
                Send to Scheduler
              </button>
              <button
                type="button"
                disabled={busyMessageId === msg.id}
                onClick={() => handleDraftAction(msg, 'draft')}
                className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--accent-muted)]"
              >
                Save Draft
              </button>
              <button
                type="button"
                disabled={busyMessageId === msg.id}
                onClick={() => handleDraftAction(msg, 'send')}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent-primary)] px-3.5 py-1.5 text-xs font-medium text-[var(--text-on-accent)] transition-colors hover:bg-[var(--accent-primary-hover)] disabled:opacity-60"
              >
                <Send className="h-3.5 w-3.5" />
                Send Now
              </button>
            </div>
          )}
        </div>
      );
    }

    if (preview.type === 'otp_surface_card') {
      const remainingMs = Math.max(0, new Date(preview.expiresAt).getTime() - Date.now());
      const expired = remainingMs <= 0;
      return (
        <div className="mt-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <KeyRound className="h-4 w-4 shrink-0 text-[var(--text-secondary)]" />
              <div>
                <div className="text-xs font-medium text-[var(--text-secondary)]">
                  {preview.serviceName} Verification Code
                </div>
                <div className="font-mono text-xl font-bold tracking-wider text-[var(--text-primary)]">
                  {preview.otpCode}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <span className="font-mono text-xs font-medium tabular-nums text-[var(--text-secondary)]">
                {preview.isUsed
                  ? 'Used'
                  : expired
                  ? 'Expired'
                  : `Expires in ${formatCountdownMmSs(remainingMs)}`}
              </span>
              <button
                type="button"
                disabled={busyMessageId === msg.id || preview.isUsed}
                onClick={async () => {
                  setBusyMessageId(msg.id);
                  try {
                    await navigator.clipboard?.writeText(preview.otpCode).catch(() => {});
                    await api.markOtpUsed(preview.vaultId).catch(() => {});
                    if (activeChat) {
                      const updated = await api.updateChat(activeChat.id, {
                        messageId: msg.id,
                        actionPatch: { isUsed: true },
                      });
                      onChatUpdated(updated.chat);
                    }
                    onOtpConsumed();
                  } catch (err) {
                    setError(err instanceof Error ? err.message : 'Unable to update OTP status.');
                  } finally {
                    setBusyMessageId(null);
                  }
                }}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent-primary)] px-3 py-1.5 text-xs font-medium text-[var(--text-on-accent)] transition-colors hover:bg-[var(--accent-primary-hover)] disabled:opacity-50"
              >
                {preview.isUsed ? (
                  <>
                    <Check className="h-3.5 w-3.5" />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" />
                    Copy Code
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      );
    }

    if (preview.type === 'otp_cleanup_preview') {
      return (
        <div className="mt-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-4">
          <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-2.5">
            <div className="flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-[var(--text-secondary)]" />
              <span className="text-sm font-semibold text-[var(--text-primary)]">
                OTP Cleanup Preview · {preview.count} {preview.count === 1 ? 'email' : 'emails'}
              </span>
            </div>
            {preview.cleaned && (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--text-primary)]">
                <CheckCircle2 className="h-3.5 w-3.5" /> Cleaned
              </span>
            )}
          </div>

          <ul className="mt-3 divide-y divide-[var(--border-subtle)]">
            {preview.items.map((item) => (
              <li key={item.id} className="flex items-center justify-between gap-3 py-2 text-xs">
                <div className="min-w-0">
                  <div className="truncate font-medium text-[var(--text-primary)]">
                    {item.subject}
                  </div>
                  <div className="truncate text-[var(--text-secondary)]">
                    {item.fromName} · {item.fromEmail}
                  </div>
                </div>
                {item.otpCode && (
                  <span className="shrink-0 font-mono text-xs font-semibold text-[var(--text-primary)]">
                    {item.otpCode}
                  </span>
                )}
              </li>
            ))}
          </ul>

          {!preview.cleaned && (
            <div className="mt-3 flex justify-end">
              <button
                type="button"
                disabled={busyMessageId === msg.id}
                onClick={() => handleConfirmOtpCleanup(msg)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#DC2626] px-3.5 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Confirm Bulk Delete ({preview.count})
              </button>
            </div>
          )}
        </div>
      );
    }

    if (preview.type === 'categorize_summary') {
      return (
        <div className="mt-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Tag className="h-4 w-4 text-[var(--text-primary)]" />
              <span className="text-sm font-semibold text-[var(--text-primary)]">
                Categorization Summary
              </span>
            </div>
            <span className="tabular-nums text-xs text-[var(--text-secondary)]">
              {preview.processedCount} scanned · {preview.otpDetectedCount} OTP
            </span>
          </div>
          {preview.changes.length > 0 && (
            <ul className="mt-2.5 divide-y divide-[var(--border-subtle)] text-xs">
              {preview.changes.map((c) => (
                <li key={c.mailId} className="flex items-center justify-between py-1.5">
                  <span className="truncate text-[var(--text-primary)]">{c.subject}</span>
                  <span className="ml-3 shrink-0 font-medium text-[var(--text-secondary)]">
                    {c.category} · {c.method}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      );
    }

    if (preview.type === 'digest_briefing') {
      const { digest } = preview;
      return (
        <div className="mt-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-4">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-subtle)] pb-2.5">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-[var(--text-primary)]" />
              <span className="text-sm font-semibold text-[var(--text-primary)]">
                Morning Briefing · {digest.totalAnalyzed} analyzed
              </span>
            </div>
            {onOpenDigestView && (
              <button
                type="button"
                onClick={onOpenDigestView}
                className="text-xs font-semibold text-[var(--accent-text)] underline-offset-2 hover:underline"
              >
                Open Digest View
              </button>
            )}
          </div>

          <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
            {/* Needs Reply */}
            <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3">
              <div className="flex items-center justify-between text-xs font-semibold text-[var(--text-primary)]">
                <span>Needs Reply</span>
                <span className="font-mono text-[var(--text-secondary)]">
                  {digest.needsReply.length}
                </span>
              </div>
              <div className="mt-2 space-y-2">
                {digest.needsReply.length === 0 ? (
                  <p className="text-[11px] text-[var(--text-secondary)]">None</p>
                ) : (
                  digest.needsReply.map((item) => (
                    <div
                      key={item.mailId}
                      className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-2 text-xs"
                    >
                      <div className="truncate font-semibold text-[var(--text-primary)]">
                        {item.subject}
                      </div>
                      <div className="truncate text-[11px] text-[var(--text-secondary)]">{item.fromName}</div>
                      {onDraftInAgent && (
                        <button
                          type="button"
                          onClick={() => onDraftInAgent(item)}
                          className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-semibold text-[var(--accent-text)] underline-offset-2 hover:underline"
                        >
                          <PenLine className="h-3 w-3" />
                          Draft in Agent
                        </button>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Deadlines & Dates */}
            <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3">
              <div className="flex items-center justify-between text-xs font-semibold text-[var(--text-primary)]">
                <span>Deadlines & Dates</span>
                <span className="font-mono text-[var(--text-secondary)]">
                  {digest.deadlines.length}
                </span>
              </div>
              <div className="mt-2 space-y-2">
                {digest.deadlines.length === 0 ? (
                  <p className="text-[11px] text-[var(--text-secondary)]">None</p>
                ) : (
                  digest.deadlines.map((item) => (
                    <div
                      key={item.mailId}
                      className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-2 text-xs"
                    >
                      <div className="truncate font-semibold text-[var(--text-primary)]">
                        {item.subject}
                      </div>
                      {item.extractedDateLabel && (
                        <div className="text-[11px] font-medium text-[var(--text-secondary)]">
                          {item.extractedDateLabel}
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={() => onOpenScheduleBuilder(buildSchedulePrefillForDigestItem(item))}
                        className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-semibold text-[var(--accent-text)] underline-offset-2 hover:underline"
                      >
                        <CalendarPlus className="h-3 w-3" />
                        Schedule
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Noise / Low Priority */}
            <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3">
              <div className="flex items-center justify-between text-xs font-semibold text-[var(--text-primary)]">
                <span>Noise / Low Priority</span>
                <span className="font-mono text-[var(--text-secondary)]">
                  {digest.noise.length}
                </span>
              </div>
              <div className="mt-2 space-y-2">
                {digest.noise.length === 0 ? (
                  <p className="text-[11px] text-[var(--text-secondary)]">None</p>
                ) : (
                  digest.noise.map((item) => (
                    <div
                      key={item.mailId}
                      className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-2 text-xs"
                    >
                      <div className="truncate font-semibold text-[var(--text-primary)]">
                        {item.subject}
                      </div>
                      <div className="truncate text-[11px] text-[var(--text-secondary)]">{item.fromName}</div>
                      <div className="mt-1.5 flex items-center gap-2">
                        <button
                          type="button"
                          onClick={async () => {
                            try {
                              await api.updateMail(item.mailId, { folder: 'archive', isRead: true });
                              onMailsChanged();
                            } catch (err) {
                              setError(err instanceof Error ? err.message : 'Failed to archive message.');
                            }
                          }}
                          className="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                        >
                          <Archive className="h-3 w-3" />
                          Archive
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            try {
                              await api.deleteMail(item.mailId);
                              onMailsChanged();
                            } catch (err) {
                              setError(err instanceof Error ? err.message : 'Failed to delete message.');
                            }
                          }}
                          className="inline-flex items-center gap-1 text-[11px] font-medium text-[#DC2626] hover:underline dark:text-[#F87171]"
                        >
                          <Trash2 className="h-3 w-3" />
                          Delete
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      );
    }

    return null;
  };

  const messages = activeChat?.messages || [];

  return (
    <div className="flex h-full flex-col bg-[var(--bg-canvas)]">
      {/* Scrollable Workspace Content */}
      <div className="flex-1 overflow-y-auto px-4 py-6 sm:px-8">
        <div className="mx-auto max-w-3xl">
          {messages.length === 0 ? (
            <div className="flex min-h-[52vh] flex-col items-center justify-center text-center">
              <h1 className="font-display text-3xl font-semibold tracking-tight text-[var(--text-primary)] text-balance">
                Hello {userName.split(' ')[0]}, direct your mail workspace
              </h1>
              <p className="mt-2.5 max-w-xl text-sm leading-relaxed text-[var(--text-secondary)]">
                Use <code className="rounded border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-1.5 py-0.5 text-xs text-[var(--text-primary)]">/</code> for agent commands or{' '}
                <code className="rounded border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-1.5 py-0.5 text-xs text-[var(--text-primary)]">@</code> to target recipients, categories, or messages.
              </p>

              <div className="mt-8 grid w-full grid-cols-1 gap-3 text-left sm:grid-cols-2">
                {SLASH_COMMANDS.map((cmd, idx) => {
                  const spanFull =
                    idx === SLASH_COMMANDS.length - 1 && SLASH_COMMANDS.length % 2 === 1;
                  return (
                    <button
                      key={cmd.command}
                      type="button"
                      onClick={() => {
                        setPrompt(cmd.template);
                        setCursorPos(cmd.template.length);
                        textareaRef.current?.focus();
                      }}
                      className={`rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 text-left transition-colors hover:border-[var(--accent-primary)]/40 hover:bg-[var(--accent-soft)]/50 ${
                        spanFull ? 'sm:col-span-2' : ''
                      }`}
                    >
                      <div className="font-mono text-xs font-semibold text-[var(--accent-text)]">
                        {cmd.command}
                      </div>
                      <div className="mt-1 text-sm font-semibold text-[var(--text-primary)]">
                        {cmd.label}
                      </div>
                      <p className="mt-1 text-xs text-[var(--text-secondary)]">
                        {cmd.description}
                      </p>
                    </button>
                  );
                })}
              </div>

              <PrivacyFeaturesSection className="mt-24 border-t border-[var(--border-subtle)] pt-10 pb-8" />
            </div>
          ) : (
            <div className="space-y-6 pb-6">
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[90%] rounded-2xl px-4 py-3 text-sm ${
                      msg.role === 'user'
                        ? 'bg-[var(--accent-primary)] text-[var(--text-on-accent)]'
                        : 'w-full border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-primary)]'
                    }`}
                  >
                    {msg.requiresTriggerHint && (
                      <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-[var(--text-primary)]">
                        <AlertCircle className="h-4 w-4 text-[var(--text-secondary)]" />
                        Trigger Required (/ or @)
                      </div>
                    )}
                    <p className="whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                    {msg.requiresTriggerHint && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {SLASH_COMMANDS.map((cmd) => (
                          <button
                            key={cmd.command}
                            type="button"
                            onClick={() => {
                              setPrompt(cmd.template);
                              setCursorPos(cmd.template.length);
                              textareaRef.current?.focus();
                            }}
                            className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-2.5 py-1 font-mono text-xs font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--accent-muted)]"
                          >
                            {cmd.command}
                          </button>
                        ))}
                      </div>
                    )}
                    {renderActionCard(msg)}
                  </div>
                </div>
              ))}
              {submitting && (
                <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
                  <Loader2 className="h-4 w-4 animate-spin text-[var(--text-primary)]" />
                  <span>Processing structured command...</span>
                </div>
              )}
              <div ref={threadEndRef} />
            </div>
          )}
        </div>
      </div>

      {/* Floating / Centered Command Prompt Box with Interactive / and @ Autocomplete */}
      <div className="border-t border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-4 py-4 sm:px-8">
        <div className="relative mx-auto max-w-3xl">
          {showDropdown && (
            <div
              role="listbox"
              aria-label="Command and context suggestions"
              className="absolute right-0 bottom-full left-0 z-30 mb-2 overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-lg"
            >
              <div className="border-b border-[var(--border-subtle)] px-3 py-1.5 text-[11px] font-medium text-[var(--text-secondary)]">
                {autocompleteCtx.triggerType === '/'
                  ? 'Agent Commands (Tab or Enter to insert)'
                  : 'Context Mentions (Recipients, Categories, Mails)'}
              </div>
              <div className="max-h-60 overflow-y-auto divide-y divide-[var(--border-subtle)]">
                {suggestions.map((item, idx) => (
                  <button
                    key={item.id}
                    type="button"
                    role="option"
                    aria-selected={idx === highlightIndex}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      applyAutocomplete(item);
                    }}
                    className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-xs transition-colors ${
                      idx === highlightIndex
                        ? 'bg-[var(--accent-soft)] text-[var(--accent-text)]'
                        : 'text-[var(--text-primary)] hover:bg-[var(--accent-muted)]/55'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="truncate font-mono font-semibold">{item.title}</div>
                      <div className="truncate text-[11px] text-[var(--text-secondary)]">
                        {item.subtitle}
                      </div>
                    </div>
                    <span className="shrink-0 text-[11px] font-medium text-[var(--text-secondary)]">
                      {item.kind}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {error && (
            <div className="mb-2 flex items-center gap-2 rounded-lg border border-[#DC2626]/30 bg-[var(--bg-surface)] px-3 py-2 text-xs text-[#DC2626] dark:text-[#F87171]">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-2.5 focus-within:border-[var(--accent-primary)] focus-within:ring-2 focus-within:ring-[var(--accent-primary)]/20">
            <label htmlFor="agent-prompt-input" className="sr-only">
              AI Agent Command Prompt
            </label>
            <textarea
              ref={textareaRef}
              id="agent-prompt-input"
              rows={2}
              value={prompt}
              onChange={(e) => {
                setPrompt(e.target.value);
                setCursorPos(e.target.selectionStart ?? e.target.value.length);
                setDismissedAt(null);
              }}
              onClick={(e) => setCursorPos(e.currentTarget.selectionStart ?? prompt.length)}
              onKeyUp={(e) => setCursorPos(e.currentTarget.selectionStart ?? prompt.length)}
              onKeyDown={handleKeyDown}
              placeholder="Type / for actions (/schedule, /draft, /categorize, /otp, /digest, /cleanup) or @ for context (@recipient, @category:OTP)..."
              className="w-full resize-none bg-transparent px-2 py-1 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-secondary)]/80 focus:outline-none"
            />
            <div className="mt-1.5 flex items-center justify-between gap-2 px-1">
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    const next = `${prompt}${prompt && !prompt.endsWith(' ') ? ' ' : ''}/`;
                    setPrompt(next);
                    setCursorPos(next.length);
                    setDismissedAt(null);
                    requestAnimationFrame(() => textareaRef.current?.focus());
                  }}
                  className="inline-flex items-center gap-1 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-2 py-1 text-xs font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--accent-muted)]"
                >
                  <Slash className="h-3 w-3" />
                  Commands
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const next = `${prompt}${prompt && !prompt.endsWith(' ') ? ' ' : ''}@`;
                    setPrompt(next);
                    setCursorPos(next.length);
                    setDismissedAt(null);
                    requestAnimationFrame(() => textareaRef.current?.focus());
                  }}
                  className="inline-flex items-center gap-1 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-2 py-1 text-xs font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--accent-muted)]"
                >
                  <AtSign className="h-3 w-3" />
                  Mention
                </button>
              </div>
              <button
                type="button"
                disabled={!prompt.trim() || submitting}
                onClick={() => handleSubmit()}
                aria-label="Send agent command"
                className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent-primary)] px-3.5 py-1.5 text-xs font-medium text-[var(--text-on-accent)] transition-colors hover:bg-[var(--accent-primary-hover)] disabled:opacity-45"
              >
                {submitting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <ArrowUp className="h-3.5 w-3.5" />
                )}
                Run
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
