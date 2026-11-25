import React, { useCallback, useEffect, useState } from 'react';
import {
  Archive,
  CalendarClock,
  CalendarPlus,
  Check,
  Copy,
  Inbox,
  Loader2,
  MessageSquareText,
  PenLine,
  RefreshCw,
  Sparkles,
  Trash2,
} from 'lucide-react';
import {
  CategoryDoc,
  DigestBriefing,
  DigestFilterScope,
  DigestItem,
  MailDoc,
  SuggestedAction,
} from '../shared/types';
import {
  buildDraftAgentCommandForAction,
  buildScheduleAgentCommandForAction,
} from '../shared/actionExtractor';
import { formatLocalTimestamp } from '../shared/scheduler';
import { api } from '../api/client';
import { InboxZeroState } from './InboxZeroState';

interface DigestViewProps {
  mails: MailDoc[];
  categories: CategoryDoc[];
  onMailsChanged: () => void;
  onDraftInAgent: (item: DigestItem) => void;
  onScheduleDeadline: (item: DigestItem) => void;
  onTriggerAgentCommand?: (command: string) => void;
  onOtpConsumed?: () => void;
}

export const DigestView: React.FC<DigestViewProps> = ({
  mails,
  categories,
  onMailsChanged,
  onDraftInAgent,
  onScheduleDeadline,
  onTriggerAgentCommand,
  onOtpConsumed,
}) => {
  const [scope, setScope] = useState<DigestFilterScope>('unread');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [digest, setDigest] = useState<DigestBriefing | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [busyMailId, setBusyMailId] = useState<string | null>(null);
  const [copiedActionId, setCopiedActionId] = useState<string | null>(null);

  const fetchDigest = useCallback(
    async (nextScope: DigestFilterScope, nextCategory: string) => {
      setLoading(true);
      setError(null);
      try {
        const res = await api.generateDigest({
          scope: nextScope,
          category: nextCategory === 'all' ? undefined : nextCategory,
        });
        setDigest(res.digest);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to generate morning digest.');
      } finally {
        setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    void fetchDigest(scope, selectedCategory);
  }, [fetchDigest, scope, selectedCategory, mails.length]);

  const handleArchiveNoise = async (item: DigestItem) => {
    setBusyMailId(item.mailId);
    try {
      await api.updateMail(item.mailId, { folder: 'archive', isRead: true });
      onMailsChanged();
      await fetchDigest(scope, selectedCategory);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to archive message.');
    } finally {
      setBusyMailId(null);
    }
  };

  const handleDeleteNoise = async (item: DigestItem) => {
    setBusyMailId(item.mailId);
    try {
      await api.deleteMail(item.mailId);
      onMailsChanged();
      await fetchDigest(scope, selectedCategory);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete message.');
    } finally {
      setBusyMailId(null);
    }
  };

  const handleSmartAction = async (mail: MailDoc, action: SuggestedAction) => {
    if (action.type === 'reply_draft' && onTriggerAgentCommand) {
      onTriggerAgentCommand(buildDraftAgentCommandForAction(mail));
      return;
    }
    if (action.type === 'schedule_followup' && onTriggerAgentCommand) {
      onTriggerAgentCommand(buildScheduleAgentCommandForAction(mail, action));
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

  return (
    <div className="h-full overflow-y-auto bg-[var(--bg-canvas)] px-4 py-6 sm:px-6">
      <div className="mx-auto max-w-6xl space-y-6">
        {/* Top Morning Briefing Control & Summary Panel */}
        <section className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-xs font-semibold text-[var(--accent-text)]">
                <Sparkles className="h-4 w-4 shrink-0" />
                <span>Morning Inbox Briefing & Action Extractor</span>
              </div>
              <h2 className="font-display mt-1 text-lg font-semibold text-[var(--text-primary)]">
                Daily Priority Triage
              </h2>
              <p className="mt-1.5 text-sm leading-relaxed text-[var(--text-secondary)]">
                {digest
                  ? digest.summary
                  : 'Scanning your inbox for replies needed, extracted deadlines, and low-priority noise...'}
              </p>
              {digest && (
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--text-secondary)] tabular-nums">
                  <span>{digest.totalAnalyzed} analyzed</span>
                  <span>·</span>
                  <span>{digest.needsReply.length} needs reply</span>
                  <span>·</span>
                  <span>{digest.deadlines.length} deadlines</span>
                  <span>·</span>
                  <span>{digest.noise.length} low priority</span>
                  <span>·</span>
                  <span>Updated {formatLocalTimestamp(digest.generatedAt)}</span>
                </div>
              )}
            </div>

            {/* Filter Controls & Refresh Digest */}
            <div className="flex flex-wrap items-center gap-2.5 shrink-0">
              <div
                role="group"
                aria-label="Digest time and status filter"
                className="inline-flex rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-0.5"
              >
                {(
                  [
                    { id: 'unread', label: 'Unread' },
                    { id: 'today', label: 'Today' },
                    { id: 'all', label: 'All Inbox' },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setScope(opt.id)}
                    className={`rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors ${
                      scope === opt.id
                        ? 'bg-[var(--accent-primary)] text-[var(--text-on-accent)] shadow-xs'
                        : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              <select
                aria-label="Filter digest by @category"
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
                className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] focus:border-[var(--accent-primary)] focus:outline-none"
              >
                <option value="all">@category: All</option>
                {categories.map((cat) => (
                  <option key={cat.id} value={cat.name}>
                    @category:{cat.name}
                  </option>
                ))}
              </select>

              <button
                type="button"
                onClick={() => void fetchDigest(scope, selectedCategory)}
                disabled={loading}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent-primary)] px-3.5 py-1.5 text-xs font-medium text-[var(--text-on-accent)] transition-colors hover:bg-[var(--accent-primary-hover)] whitespace-nowrap disabled:opacity-60"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
                Refresh Digest
              </button>
            </div>
          </div>

          {error && (
            <div className="mt-3 rounded-lg border border-[#DC2626]/30 bg-[var(--bg-canvas)] px-3 py-2 text-xs text-[#DC2626] dark:text-[#F87171]">
              {error}
            </div>
          )}
        </section>

        {/* Three Actionable Digest Columns */}
        {loading && !digest ? (
          <div className="flex items-center justify-center py-16 text-sm text-[var(--text-secondary)]">
            <Loader2 className="mr-2 h-4 w-4 animate-spin text-[var(--accent-primary)]" />
            Generating morning briefing...
          </div>
        ) : digest && digest.totalAnalyzed === 0 ? (
          <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
            <InboxZeroState
              title="Inbox Zero — Digest Clear"
              description="No messages in this digest view require replies, follow-ups, or cleanup."
              compact
              onResetFilters={
                scope !== 'all' || selectedCategory !== 'all'
                  ? () => {
                      setScope('all');
                      setSelectedCategory('all');
                    }
                  : undefined
              }
            />
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
            {/* Card 1: Needs Reply */}
            <section
              aria-labelledby="digest-needs-reply-heading"
              className="flex flex-col rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]"
            >
              <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-4 py-3.5">
                <div className="flex items-center gap-2">
                  <MessageSquareText className="h-4 w-4 text-[var(--text-primary)]" />
                  <h3
                    id="digest-needs-reply-heading"
                    className="text-sm font-semibold text-[var(--text-primary)]"
                  >
                    Needs Reply
                  </h3>
                </div>
                <span className="font-mono text-xs font-semibold tabular-nums text-[var(--text-secondary)]">
                  {digest?.needsReply.length ?? 0}
                </span>
              </div>

              <div className="flex-1 divide-y divide-[var(--border-subtle)]">
                {!digest || digest.needsReply.length === 0 ? (
                  <p className="p-4 text-xs text-[var(--text-secondary)]">
                    No messages currently require a direct reply for this filter.
                  </p>
                ) : (
                  digest.needsReply.map((item) => {
                    const sourceMail = mails.find((m) => m.id === item.mailId);
                    const smartActions = sourceMail?.suggestedActions || [];
                    return (
                      <article key={item.mailId} className="p-4 space-y-2.5">
                        <div className="min-w-0">
                          <div className="flex items-center justify-between gap-2 text-xs text-[var(--text-secondary)]">
                            <span className="truncate font-medium text-[var(--text-primary)]">
                              {item.fromName}
                            </span>
                            <span className="shrink-0">{item.category}</span>
                          </div>
                          <h4 className="mt-1 text-sm font-semibold text-[var(--text-primary)]">
                            {item.subject}
                          </h4>
                          <p className="mt-1 text-xs leading-relaxed text-[var(--text-secondary)]">
                            {item.reason}
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center justify-end gap-1.5">
                          {sourceMail && smartActions.length > 0 ? (
                            smartActions.map((act) =>
                              act.type === 'reply_draft' ? (
                                <button
                                  key={act.id}
                                  type="button"
                                  onClick={() => void handleSmartAction(sourceMail, act)}
                                  className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--accent-muted)] whitespace-nowrap"
                                >
                                  <PenLine className="h-3.5 w-3.5" />
                                  Draft Reply
                                </button>
                              ) : act.type === 'schedule_followup' ? (
                                <button
                                  key={act.id}
                                  type="button"
                                  onClick={() => void handleSmartAction(sourceMail, act)}
                                  className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--accent-muted)] whitespace-nowrap"
                                >
                                  <CalendarClock className="h-3.5 w-3.5" />
                                  Schedule Follow-Up
                                </button>
                              ) : null
                            )
                          ) : (
                            <button
                              type="button"
                              onClick={() => onDraftInAgent(item)}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--accent-muted)] whitespace-nowrap"
                            >
                              <PenLine className="h-3.5 w-3.5" />
                              Draft in Agent
                            </button>
                          )}
                        </div>
                      </article>
                    );
                  })
                )}
              </div>
            </section>

            {/* Card 2: Deadlines & Dates */}
            <section
              aria-labelledby="digest-deadlines-heading"
              className="flex flex-col rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]"
            >
              <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-4 py-3.5">
                <div className="flex items-center gap-2">
                  <CalendarClock className="h-4 w-4 text-[var(--text-primary)]" />
                  <h3
                    id="digest-deadlines-heading"
                    className="text-sm font-semibold text-[var(--text-primary)]"
                  >
                    Deadlines & Dates
                  </h3>
                </div>
                <span className="font-mono text-xs font-semibold tabular-nums text-[var(--text-secondary)]">
                  {digest?.deadlines.length ?? 0}
                </span>
              </div>

              <div className="flex-1 divide-y divide-[var(--border-subtle)]">
                {!digest || digest.deadlines.length === 0 ? (
                  <p className="p-4 text-xs text-[var(--text-secondary)]">
                    No upcoming dates or deadlines detected for this filter.
                  </p>
                ) : (
                  digest.deadlines.map((item) => {
                    const sourceMail = mails.find((m) => m.id === item.mailId);
                    const replyAct = sourceMail?.suggestedActions?.find((a) => a.type === 'reply_draft');
                    const schedAct = sourceMail?.suggestedActions?.find(
                      (a) => a.type === 'schedule_followup'
                    );
                    return (
                      <article key={item.mailId} className="p-4 space-y-2.5">
                        <div className="min-w-0">
                          <div className="flex items-center justify-between gap-2 text-xs text-[var(--text-secondary)]">
                            <span className="truncate font-medium text-[var(--text-primary)]">
                              {item.fromName}
                            </span>
                            <span className="shrink-0">{item.category}</span>
                          </div>
                          <h4 className="mt-1 text-sm font-semibold text-[var(--text-primary)]">
                            {item.subject}
                          </h4>
                          {item.extractedDateLabel && (
                            <div className="mt-1.5 text-xs font-semibold text-[var(--accent-text)]">
                              Extracted Date: {item.extractedDateLabel}
                            </div>
                          )}
                          <p className="mt-1 text-xs leading-relaxed text-[var(--text-secondary)]">
                            {item.reason}
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center justify-end gap-1.5">
                          {sourceMail && replyAct && onTriggerAgentCommand && (
                            <button
                              type="button"
                              onClick={() => void handleSmartAction(sourceMail, replyAct)}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--accent-muted)] whitespace-nowrap"
                            >
                              <PenLine className="h-3.5 w-3.5" />
                              Draft Reply
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => {
                              if (sourceMail && schedAct && onTriggerAgentCommand) {
                                void handleSmartAction(sourceMail, schedAct);
                              } else {
                                onScheduleDeadline(item);
                              }
                            }}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--accent-muted)] whitespace-nowrap"
                          >
                            <CalendarPlus className="h-3.5 w-3.5" />
                            Schedule Follow-Up
                          </button>
                        </div>
                      </article>
                    );
                  })
                )}
              </div>
            </section>

            {/* Card 3: Noise / Low Priority */}
            <section
              aria-labelledby="digest-noise-heading"
              className="flex flex-col rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]"
            >
              <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-4 py-3.5">
                <div className="flex items-center gap-2">
                  <Inbox className="h-4 w-4 text-[var(--text-secondary)]" />
                  <h3
                    id="digest-noise-heading"
                    className="text-sm font-semibold text-[var(--text-primary)]"
                  >
                    Noise / Low Priority
                  </h3>
                </div>
                <span className="font-mono text-xs font-semibold tabular-nums text-[var(--text-secondary)]">
                  {digest?.noise.length ?? 0}
                </span>
              </div>

              <div className="flex-1 divide-y divide-[var(--border-subtle)]">
                {!digest || digest.noise.length === 0 ? (
                  <p className="p-4 text-xs text-[var(--text-secondary)]">
                    Inbox noise is clear for this filter.
                  </p>
                ) : (
                  digest.noise.map((item) => {
                    const isBusy = busyMailId === item.mailId;
                    const sourceMail = mails.find((m) => m.id === item.mailId);
                    const otpAct = sourceMail?.suggestedActions?.find((a) => a.type === 'copy_otp');
                    const isOtpCopied = otpAct && copiedActionId === otpAct.id;
                    return (
                      <article key={item.mailId} className="p-4 space-y-2.5">
                        <div className="min-w-0">
                          <div className="flex items-center justify-between gap-2 text-xs text-[var(--text-secondary)]">
                            <span className="truncate font-medium text-[var(--text-primary)]">
                              {item.fromName}
                            </span>
                            <span className="shrink-0">{item.category}</span>
                          </div>
                          <h4 className="mt-1 text-sm font-semibold text-[var(--text-primary)]">
                            {item.subject}
                          </h4>
                          <p className="mt-1 text-xs leading-relaxed text-[var(--text-secondary)]">
                            {item.reason}
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center justify-end gap-2">
                          {sourceMail && otpAct && (
                            <button
                              type="button"
                              onClick={() => void handleSmartAction(sourceMail, otpAct)}
                              className="inline-flex items-center gap-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-2.5 py-1.5 text-xs font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--accent-muted)] whitespace-nowrap"
                            >
                              {isOtpCopied ? (
                                <Check className="h-3.5 w-3.5" />
                              ) : (
                                <Copy className="h-3.5 w-3.5" />
                              )}
                              {isOtpCopied ? `Copied ${otpAct.otpCode}` : 'Copy OTP'}
                            </button>
                          )}
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => void handleArchiveNoise(item)}
                            className="inline-flex items-center gap-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-2.5 py-1.5 text-xs font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--accent-muted)] whitespace-nowrap disabled:opacity-50"
                          >
                            <Archive className="h-3.5 w-3.5" />
                            Archive
                          </button>
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => void handleDeleteNoise(item)}
                            className="inline-flex items-center gap-1 rounded-lg border border-[#DC2626]/30 bg-[var(--bg-canvas)] px-2.5 py-1.5 text-xs font-medium text-[#DC2626] transition-colors hover:bg-[#DC2626]/10 whitespace-nowrap disabled:opacity-50 dark:text-[#F87171]"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            Delete
                          </button>
                        </div>
                      </article>
                    );
                  })
                )}
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
};
