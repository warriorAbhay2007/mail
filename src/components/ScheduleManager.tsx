import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Ban,
  CalendarClock,
  CheckCircle2,
  Clock,
  Loader2,
  Plus,
  RefreshCw,
  Reply,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import {
  GapUnit,
  ScheduleDoc,
  ScheduleMode,
  ScheduleRuleInput,
  SlotStatus,
} from '../shared/types';
import {
  formatLocalTimestamp,
  formatUtcTimestamp,
  materializeScheduleTimestamps,
  parseRecipientList,
  validateScheduleInput,
} from '../shared/scheduler';
import { api } from '../api/client';

interface ScheduleManagerProps {
  schedules: ScheduleDoc[];
  prefillRule?: ScheduleRuleInput | null;
  onClearPrefill?: () => void;
  onSchedulesChanged: () => void;
  onReplySimulated?: () => void;
}

function toLocalDateTimeInputValue(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const offset = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - offset).toISOString().slice(0, 16);
}

export const ScheduleManager: React.FC<ScheduleManagerProps> = ({
  schedules,
  prefillRule,
  onClearPrefill,
  onSchedulesChanged,
  onReplySimulated,
}) => {
  const defaultStart = useMemo(
    () => toLocalDateTimeInputValue(new Date(Date.now() + 3600_000).toISOString()),
    []
  );

  const [mode, setMode] = useState<ScheduleMode>('advanced');
  const [recipientsText, setRecipientsText] = useState('sarah@northstar.io, alex@acme.dev');
  const [startLocal, setStartLocal] = useState(defaultStart);
  const [freq, setFreq] = useState(3);
  const [gapValue, setGapValue] = useState(2);
  const [gapUnit, setGapUnit] = useState<GapUnit>('hours');
  const [stopOnReply, setStopOnReply] = useState(true);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [replyNotice, setReplyNotice] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (!prefillRule) return;
    setMode(prefillRule.mode);
    setRecipientsText(prefillRule.recipients.join(', '));
    setStartLocal(toLocalDateTimeInputValue(prefillRule.startUtc));
    setFreq(prefillRule.freq);
    setGapValue(prefillRule.gapValue);
    setGapUnit(prefillRule.gapUnit);
    setStopOnReply(prefillRule.stopOnReply ?? prefillRule.freq > 1);
    setSubject(prefillRule.subject);
    setBody(prefillRule.body);
    onClearPrefill?.();
  }, [prefillRule, onClearPrefill]);

  const parsedRecipients = useMemo(
    () => parseRecipientList(recipientsText),
    [recipientsText]
  );

  const livePreview = useMemo(() => {
    const startDate = new Date(startLocal);
    if (Number.isNaN(startDate.getTime()) || parsedRecipients.length === 0) {
      return null;
    }
    try {
      return materializeScheduleTimestamps(
        {
          mode,
          startUtc: startDate.toISOString(),
          freq: mode === 'basic' ? 1 : freq,
          gapValue: mode === 'basic' ? 0 : gapValue,
          gapUnit,
          recipients: parsedRecipients,
        },
        'live'
      );
    } catch {
      return null;
    }
  }, [mode, startLocal, freq, gapValue, gapUnit, parsedRecipients]);

  const handleCreateSchedule = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const startDate = new Date(startLocal);
    if (Number.isNaN(startDate.getTime())) {
      setFormError('Please select a valid start date and time.');
      return;
    }

    const effectiveFreq = mode === 'basic' ? 1 : Number(freq);
    const rule: ScheduleRuleInput = {
      mode,
      startUtc: startDate.toISOString(),
      freq: effectiveFreq,
      gapValue: mode === 'basic' ? 0 : Number(gapValue),
      gapUnit,
      recipients: parsedRecipients,
      subject: subject.trim(),
      body: body.trim(),
      stopOnReply: mode === 'advanced' ? stopOnReply : false,
    };

    const validationError = validateScheduleInput(rule);
    if (validationError) {
      setFormError(validationError);
      return;
    }

    setCreating(true);
    try {
      await api.createSchedule(rule);
      setSubject('');
      setBody('');
      onSchedulesChanged();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to create schedule.');
    } finally {
      setCreating(false);
    }
  };

  const handleCancelPending = async (scheduleId: string) => {
    setBusyId(scheduleId);
    try {
      await api.cancelPendingSchedule(scheduleId);
      onSchedulesChanged();
    } catch (err) {
      setReplyNotice(err instanceof Error ? err.message : 'Failed to cancel pending slots.');
    } finally {
      setBusyId(null);
    }
  };

  const handleRetrySlot = async (scheduleId: string, slotId: string) => {
    setBusyId(slotId);
    try {
      await api.retryScheduleSlot(scheduleId, slotId);
      onSchedulesChanged();
    } catch (err) {
      setReplyNotice(err instanceof Error ? err.message : 'Failed to retry slot.');
    } finally {
      setBusyId(null);
    }
  };

  const handleDeleteSchedule = async (scheduleId: string) => {
    setBusyId(scheduleId);
    try {
      await api.deleteSchedule(scheduleId);
      onSchedulesChanged();
    } catch (err) {
      setReplyNotice(err instanceof Error ? err.message : 'Failed to delete schedule.');
    } finally {
      setBusyId(null);
    }
  };

  const handleSimulateReply = async (sched: ScheduleDoc) => {
    const firstPending = sched.slots.find((s) => s.status === 'pending');
    if (!firstPending) return;
    setBusyId(sched.id);
    setReplyNotice(null);
    try {
      const senderLocal = firstPending.recipient.split('@')[0] || 'Recipient';
      const senderName = senderLocal.charAt(0).toUpperCase() + senderLocal.slice(1);
      const res = await api.ingestMail({
        fromName: senderName,
        fromEmail: firstPending.recipient,
        subject: sched.subject.startsWith('Re:') ? sched.subject : `Re: ${sched.subject}`,
        textBody: `Hi, thanks for following up on "${sched.subject}". Confirming receipt — let's connect tomorrow.`,
        threadId: sched.threadId,
        inReplyTo: sched.threadId,
      });
      const cancelled = res.stopOnReply?.cancelledSlotsCount ?? 0;
      setReplyNotice(
        `Simulated reply from ${firstPending.recipient} — halted ${cancelled} pending follow-up ${
          cancelled === 1 ? 'slot' : 'slots'
        }.`
      );
      onSchedulesChanged();
      onReplySimulated?.();
    } catch (err) {
      setReplyNotice(err instanceof Error ? err.message : 'Failed to simulate reply.');
    } finally {
      setBusyId(null);
    }
  };

  const renderStatus = (status: SlotStatus) => {
    switch (status) {
      case 'sent':
        return (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-[#16A34A] dark:text-[#4ADE80]">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Sent
          </span>
        );
      case 'processing':
        return (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--accent-text)]">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Processing
          </span>
        );
      case 'failed':
        return (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-[#DC2626] dark:text-[#F87171]">
            <AlertTriangle className="h-3.5 w-3.5" />
            Failed
          </span>
        );
      case 'cancelled_replied':
        return (
          <span className="inline-flex items-center gap-1 rounded-md border border-[var(--border-subtle)] bg-[var(--accent-muted)]/45 px-2 py-0.5 text-[11px] font-medium text-[var(--text-primary)]">
            <Reply className="h-3 w-3" />
            Cancelled (Replied)
          </span>
        );
      case 'cancelled':
        return (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--text-secondary)]">
            <Ban className="h-3.5 w-3.5" />
            Cancelled
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--text-secondary)]">
            <Clock className="h-3.5 w-3.5" />
            Pending
          </span>
        );
    }
  };

  return (
    <div className="h-full overflow-y-auto bg-[var(--bg-canvas)] p-5 sm:p-8">
      <div className="mx-auto max-w-6xl space-y-8">
        {/* Builder Grid */}
        <section className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* Left Form */}
          <form
            onSubmit={handleCreateSchedule}
            className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5 lg:col-span-7"
          >
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-subtle)] pb-4">
              <div>
                <h2 className="font-display text-lg font-semibold text-[var(--text-primary)]">
                  Create Delivery Schedule
                </h2>
                <p className="text-xs text-[var(--text-secondary)]">
                  Materializes Schedule(start, freq, gap) into UTC worker slots.
                </p>
              </div>

              <div className="flex rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-1" role="group" aria-label="Schedule mode">
                <button
                  type="button"
                  onClick={() => setMode('basic')}
                  className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                    mode === 'basic'
                      ? 'bg-[var(--accent-primary)] text-[var(--text-on-accent)] shadow-xs'
                      : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  Basic
                </button>
                <button
                  type="button"
                  onClick={() => setMode('advanced')}
                  className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                    mode === 'advanced'
                      ? 'bg-[var(--accent-primary)] text-[var(--text-on-accent)] shadow-xs'
                      : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  Advanced
                </button>
              </div>
            </div>

            <div className="mt-4 space-y-3.5">
              <div>
                <label htmlFor="sched-recipients" className="mb-1 block text-xs font-medium text-[var(--text-primary)]">
                  Recipients ({parsedRecipients.length} parsed)
                </label>
                <input
                  id="sched-recipients"
                  type="text"
                  value={recipientsText}
                  onChange={(e) => setRecipientsText(e.target.value)}
                  placeholder="alice@acme.dev, bob@northstar.io"
                  className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-secondary)]/75 focus:border-[var(--accent-primary)] focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label htmlFor="sched-start" className="mb-1 block text-xs font-medium text-[var(--text-primary)]">
                    Start Date & Time (Local)
                  </label>
                  <input
                    id="sched-start"
                    type="datetime-local"
                    value={startLocal}
                    onChange={(e) => setStartLocal(e.target.value)}
                    className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-3 py-2 text-sm tabular-nums text-[var(--text-primary)] focus:border-[var(--accent-primary)] focus:outline-none"
                  />
                </div>

                {mode === 'advanced' && (
                  <>
                    <div>
                      <label htmlFor="sched-freq" className="mb-1 block text-xs font-medium text-[var(--text-primary)]">
                        Frequency (Runs)
                      </label>
                      <input
                        id="sched-freq"
                        type="number"
                        min={1}
                        max={50}
                        value={freq}
                        onChange={(e) => setFreq(Math.max(1, Number(e.target.value) || 1))}
                        className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-3 py-2 text-sm tabular-nums text-[var(--text-primary)] focus:border-[var(--accent-primary)] focus:outline-none"
                      />
                    </div>

                    <div>
                      <label htmlFor="sched-gap" className="mb-1 block text-xs font-medium text-[var(--text-primary)]">
                        Gap Interval
                      </label>
                      <div className="flex gap-1.5">
                        <input
                          id="sched-gap"
                          type="number"
                          min={0}
                          value={gapValue}
                          onChange={(e) => setGapValue(Math.max(0, Number(e.target.value) || 0))}
                          className="w-24 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-2.5 py-2 text-sm tabular-nums text-[var(--text-primary)] focus:border-[var(--accent-primary)] focus:outline-none"
                        />
                        <select
                          aria-label="Gap unit"
                          value={gapUnit}
                          onChange={(e) => setGapUnit(e.target.value as GapUnit)}
                          className="flex-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-2 py-2 text-xs text-[var(--text-primary)] focus:border-[var(--accent-primary)] focus:outline-none"
                        >
                          <option value="minutes">Minutes</option>
                          <option value="hours">Hours</option>
                          <option value="days">Days</option>
                        </select>
                      </div>
                    </div>

                    <div className="sm:col-span-2 flex items-center justify-between gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-3.5 py-2.5">
                      <div>
                        <label
                          htmlFor="stop-on-reply-toggle"
                          className="text-xs font-medium text-[var(--text-primary)]"
                        >
                          Stop automatically if recipient replies
                        </label>
                        <p className="text-[11px] text-[var(--text-secondary)]">
                          Halts remaining pending follow-ups per recipient when a reply arrives.
                        </p>
                      </div>
                      <button
                        id="stop-on-reply-toggle"
                        type="button"
                        role="switch"
                        aria-checked={stopOnReply}
                        onClick={() => setStopOnReply((prev) => !prev)}
                        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
                          stopOnReply ? 'bg-[var(--accent-primary)]' : 'bg-[var(--accent-muted)]'
                        }`}
                      >
                        <span
                          className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                            stopOnReply ? 'translate-x-4.5' : 'translate-x-1'
                          }`}
                        />
                      </button>
                    </div>
                  </>
                )}
              </div>

              <div>
                <label htmlFor="sched-subject" className="mb-1 block text-xs font-medium text-[var(--text-primary)]">
                  Subject
                </label>
                <input
                  id="sched-subject"
                  type="text"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="Weekly sprint status check-in"
                  className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-secondary)]/75 focus:border-[var(--accent-primary)] focus:outline-none"
                />
              </div>

              <div>
                <label htmlFor="sched-body" className="mb-1 block text-xs font-medium text-[var(--text-primary)]">
                  Email Body
                </label>
                <textarea
                  id="sched-body"
                  rows={3}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder="Message body dispatched at each scheduled slot..."
                  className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-secondary)]/75 focus:border-[var(--accent-primary)] focus:outline-none"
                />
              </div>

              {formError && (
                <p className="rounded-lg border border-[#DC2626]/30 bg-[var(--bg-canvas)] px-3 py-2 text-xs text-[#DC2626] dark:text-[#F87171]">
                  {formError}
                </p>
              )}

              <div className="flex justify-end pt-1">
                <button
                  type="submit"
                  disabled={creating}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent-primary)] px-4 py-2 text-xs font-medium text-[var(--text-on-accent)] transition-colors hover:bg-[var(--accent-primary-hover)] disabled:opacity-60"
                >
                  <Plus className="h-4 w-4" />
                  {creating ? 'Scheduling...' : 'Create Materialized Schedule'}
                </button>
              </div>
            </div>
          </form>

          {/* Live Materialized UTC Preview */}
          <div className="flex flex-col rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5 lg:col-span-5">
            <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-3">
              <div className="flex items-center gap-2">
                <CalendarClock className="h-4 w-4 text-[var(--text-primary)]" />
                <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                  Live Materialized Preview
                </h3>
              </div>
              {livePreview && (
                <span className="tabular-nums text-xs text-[var(--text-secondary)]">
                  {livePreview.timestampsUtc.length} runs · {livePreview.slots.length} total slots
                </span>
              )}
            </div>

            {!livePreview ? (
              <div className="flex flex-1 items-center justify-center py-12 text-center text-xs text-[var(--text-secondary)]">
                Enter valid recipients and a start timestamp to preview UTC execution slots.
              </div>
            ) : (
              <div className="mt-3 max-h-[320px] flex-1 overflow-y-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-[var(--border-subtle)] text-[var(--text-secondary)]">
                    <tr>
                      <th className="py-1.5 font-medium">Run</th>
                      <th className="py-1.5 font-medium">UTC Timestamp</th>
                      <th className="py-1.5 font-medium">Local</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border-subtle)]">
                    {livePreview.timestampsUtc.map((iso, idx) => (
                      <tr key={iso + idx}>
                        <td className="py-2 font-mono tabular-nums text-[var(--text-secondary)]">t{idx + 1}</td>
                        <td className="py-2 font-mono tabular-nums text-[var(--text-primary)]">
                          {formatUtcTimestamp(iso)}
                        </td>
                        <td className="py-2 tabular-nums text-[var(--text-secondary)]">
                          {formatLocalTimestamp(iso)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>

        {/* Active & Past Schedules List */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-lg font-semibold text-[var(--text-primary)]">
              Active & Past Schedules
            </h2>
            <button
              type="button"
              onClick={onSchedulesChanged}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--accent-muted)]"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Refresh Status
            </button>
          </div>

          {replyNotice && (
            <div className="flex items-center justify-between gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 py-2.5 text-xs font-medium text-[var(--text-primary)]">
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

          {schedules.length === 0 ? (
            <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-10 text-center text-sm text-[var(--text-secondary)]">
              No schedules created yet. Use the builder above or run <code className="font-mono">/schedule</code> in New Tab.
            </div>
          ) : (
            <div className="space-y-4">
              {schedules.map((sched) => {
                const pendingCount = sched.slots.filter((s) => s.status === 'pending').length;
                const sentCount = sched.slots.filter((s) => s.status === 'sent').length;
                const failedCount = sched.slots.filter((s) => s.status === 'failed').length;
                const repliedCancelledCount = sched.slots.filter(
                  (s) => s.status === 'cancelled_replied'
                ).length;

                return (
                  <div
                    key={sched.id}
                    className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--border-subtle)] pb-3.5">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-base font-semibold text-[var(--text-primary)]">
                            {sched.subject}
                          </h3>
                          <span className="text-xs text-[var(--text-secondary)]">
                            · {sched.mode === 'advanced' ? `Advanced (${sched.freq}× every ${sched.gapValue} ${sched.gapUnit})` : 'Basic (1×)'}
                          </span>
                          {sched.stopOnReply && (
                            <span className="inline-flex items-center gap-1 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-2 py-0.5 text-[11px] font-medium text-[var(--text-primary)]">
                              <Reply className="h-3 w-3" />
                              Stop-on-Reply: Enabled
                            </span>
                          )}
                        </div>
                        <p className="mt-1 text-xs text-[var(--text-secondary)]">
                          Recipients: {sched.recipients.join(', ')} ·{' '}
                          <span className="tabular-nums">
                            {sentCount} sent / {pendingCount} pending / {failedCount} failed
                            {repliedCancelledCount > 0 ? ` / ${repliedCancelledCount} replied-cancelled` : ''}
                          </span>
                        </p>
                        {sched.cancelledReason && (
                          <p className="mt-1 text-xs font-medium text-[var(--text-primary)]">
                            {sched.cancelledReason}
                          </p>
                        )}
                      </div>

                      <div className="flex shrink-0 flex-wrap items-center gap-2">
                        {sched.stopOnReply && pendingCount > 0 && (
                          <button
                            type="button"
                            disabled={busyId === sched.id}
                            onClick={() => handleSimulateReply(sched)}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--accent-muted)] whitespace-nowrap disabled:opacity-60"
                          >
                            <Reply className="h-3.5 w-3.5" />
                            Simulate Reply
                          </button>
                        )}
                        {pendingCount > 0 && (
                          <button
                            type="button"
                            disabled={busyId === sched.id}
                            onClick={() => handleCancelPending(sched.id)}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--accent-muted)] whitespace-nowrap"
                          >
                            <Ban className="h-3.5 w-3.5" />
                            Cancel Pending ({pendingCount})
                          </button>
                        )}
                        <button
                          type="button"
                          disabled={busyId === sched.id}
                          onClick={() => handleDeleteSchedule(sched.id)}
                          aria-label={`Delete schedule ${sched.subject}`}
                          className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-1.5 text-[var(--text-secondary)] transition-colors hover:bg-[#DC2626]/10 hover:text-[#DC2626] dark:hover:text-[#F87171]"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>

                    <div className="mt-3 overflow-x-auto">
                      <table className="w-full text-left text-xs">
                        <thead className="border-b border-[var(--border-subtle)] text-[var(--text-secondary)]">
                          <tr>
                            <th className="py-2 pr-3 font-medium">Run</th>
                            <th className="py-2 pr-3 font-medium">Scheduled (UTC)</th>
                            <th className="py-2 pr-3 font-medium">Local</th>
                            <th className="py-2 pr-3 font-medium">Recipient</th>
                            <th className="py-2 pr-3 font-medium">Status</th>
                            <th className="py-2 text-right font-medium">Action / Sent At</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--border-subtle)]">
                          {sched.slots.map((slot) => (
                            <tr key={slot.id}>
                              <td className="py-2 pr-3 font-mono tabular-nums text-[var(--text-secondary)]">
                                t{slot.runIndex}
                              </td>
                              <td className="py-2 pr-3 font-mono tabular-nums text-[var(--text-primary)]">
                                {formatUtcTimestamp(slot.runAtUtc)}
                              </td>
                              <td className="py-2 pr-3 tabular-nums text-[var(--text-secondary)]">
                                {formatLocalTimestamp(slot.runAtUtc)}
                              </td>
                              <td className="py-2 pr-3 text-[var(--text-primary)]">
                                {slot.recipient}
                              </td>
                              <td className="py-2 pr-3">
                                {renderStatus(slot.status)}
                                {slot.error && (
                                  <div className="mt-0.5 text-[11px] text-[#DC2626] dark:text-[#F87171]">
                                    {slot.error}
                                  </div>
                                )}
                              </td>
                              <td className="py-2 text-right tabular-nums text-[var(--text-secondary)]">
                                {slot.status === 'failed' ? (
                                  <button
                                    type="button"
                                    disabled={busyId === slot.id}
                                    onClick={() => handleRetrySlot(sched.id, slot.id)}
                                    className="inline-flex items-center gap-1 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-2.5 py-1 text-xs font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--accent-muted)]"
                                  >
                                    <RotateCcw className="h-3 w-3" />
                                    Retry
                                  </button>
                                ) : slot.status === 'cancelled_replied' ? (
                                  <span className="text-[var(--text-secondary)]">
                                    {slot.cancelledAt
                                      ? `Halted ${formatUtcTimestamp(slot.cancelledAt)}`
                                      : 'Halted on reply'}
                                  </span>
                                ) : slot.sentAtUtc ? (
                                  <span>{formatUtcTimestamp(slot.sentAtUtc)}</span>
                                ) : (
                                  <span>—</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
};
