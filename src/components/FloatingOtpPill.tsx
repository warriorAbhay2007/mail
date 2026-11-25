import React, { useEffect, useState } from 'react';
import { Check, Copy, KeyRound } from 'lucide-react';
import { OtpVaultDoc } from '../shared/types';
import { api } from '../api/client';

interface FloatingOtpPillProps {
  entries: OtpVaultDoc[];
  onOtpConsumed: () => void;
  variant?: 'header' | 'mobile-bar';
}

export function formatCountdownMmSs(remainingMs: number): string {
  const totalSec = Math.max(0, Math.floor(remainingMs / 1000));
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export const FloatingOtpPill: React.FC<FloatingOtpPillProps> = ({
  entries,
  onOtpConsumed,
  variant = 'header',
}) => {
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (entries.length === 0) return;
    const interval = setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => clearInterval(interval);
  }, [entries.length]);

  const activeEntry = entries.find(
    (entry) => !entry.isUsed && new Date(entry.expiresAt).getTime() > nowMs
  );

  if (!activeEntry) return null;

  const remainingMs = Math.max(0, new Date(activeEntry.expiresAt).getTime() - nowMs);
  const countdown = formatCountdownMmSs(remainingMs);
  const isCopied = copiedId === activeEntry.id;

  const handleOneClickCopy = async () => {
    if (busyId === activeEntry.id) return;
    setBusyId(activeEntry.id);
    try {
      await navigator.clipboard?.writeText(activeEntry.otpCode).catch(() => {});
      setCopiedId(activeEntry.id);
      await api.markOtpUsed(activeEntry.id);
      setTimeout(() => {
        setCopiedId(null);
        onOtpConsumed();
      }, 900);
    } finally {
      setBusyId(null);
    }
  };

  const pillBody = (
    <div
      role="status"
      aria-live="polite"
      data-testid="floating-otp-pill"
      className="inline-flex items-center gap-2.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-3 py-1.5 shadow-xs"
    >
      <div className="flex items-center gap-1.5 text-xs">
        <KeyRound className="h-3.5 w-3.5 shrink-0 text-[var(--accent-text)]" />
        <span className="font-semibold text-[var(--text-primary)] whitespace-nowrap">
          {activeEntry.serviceName} OTP:
        </span>
        <span className="font-mono text-sm font-bold tracking-wider text-[var(--text-primary)] whitespace-nowrap">
          {activeEntry.otpCode}
        </span>
        <span className="text-[var(--border-subtle)]" aria-hidden="true">
          ·
        </span>
        <span
          className="font-mono text-xs font-medium tabular-nums text-[var(--text-secondary)] whitespace-nowrap"
          aria-label="OTP expiration countdown"
        >
          {countdown}
        </span>
      </div>

      <button
        type="button"
        onClick={handleOneClickCopy}
        disabled={busyId === activeEntry.id}
        className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-[var(--accent-primary)] px-2.5 py-1 text-xs font-medium text-[var(--text-on-accent)] transition-colors hover:bg-[var(--accent-primary-hover)] whitespace-nowrap disabled:opacity-50"
      >
        {isCopied ? (
          <>
            <Check className="h-3.5 w-3.5" />
            Copied
          </>
        ) : (
          <>
            <Copy className="h-3.5 w-3.5" />
            Copy
          </>
        )}
      </button>
    </div>
  );

  if (variant === 'mobile-bar') {
    return (
      <div className="flex justify-end border-b border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-4 py-1.5 sm:hidden">
        {pillBody}
      </div>
    );
  }

  return <div className="hidden sm:inline-flex">{pillBody}</div>;
};
