import React from 'react';
import { PenSquare, RefreshCw, RotateCcw } from 'lucide-react';

interface InboxZeroStateProps {
  title?: string;
  description?: string;
  isSearchEmpty?: boolean;
  compact?: boolean;
  simulating?: boolean;
  onResetFilters?: () => void;
  onSimulateIncoming?: () => void;
  onCompose?: () => void;
}

export const InboxZeroState: React.FC<InboxZeroStateProps> = ({
  title = 'Inbox Zero',
  description = "You've cleared every message here. Enjoy a calm, distraction-free workspace.",
  isSearchEmpty = false,
  compact = false,
  simulating = false,
  onResetFilters,
  onSimulateIncoming,
  onCompose,
}) => {
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="inbox-zero-state"
      className={`flex w-full flex-col items-center justify-center px-6 text-center ${
        compact ? 'py-10' : 'py-16'
      }`}
    >
      {/* Animated Pure-CSS + Inline-SVG Illustration */}
      <div
        className={`relative flex items-center justify-center ${
          compact ? 'h-32 w-32' : 'h-40 w-40'
        }`}
      >
        {!isSearchEmpty && (
          <>
            <span
              aria-hidden="true"
              className="inbox-zero-ring pointer-events-none absolute inset-4 rounded-full border border-[var(--accent-primary)]/35"
            />
            <span
              aria-hidden="true"
              className="inbox-zero-ring-delayed pointer-events-none absolute inset-4 rounded-full border border-[var(--accent-primary)]/20"
            />
          </>
        )}

        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-6 rounded-full bg-[var(--accent-soft)]/80"
        />

        <svg
          viewBox="0 0 140 140"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
          className={`relative overflow-visible ${compact ? 'h-28 w-28' : 'h-36 w-36'}`}
        >
          {/* Subtle floating floor shadow */}
          <ellipse
            cx="70"
            cy="114"
            rx="32"
            ry="5"
            fill="var(--text-secondary)"
            className="inbox-zero-shadow"
          />

          {/* Floating Envelope + Checkmark Seal */}
          <g className="inbox-zero-float">
            {/* Celebratory Sparkles */}
            {!isSearchEmpty && (
              <>
                <path
                  d="M25 41L27.2 46.8L33 49L27.2 51.2L25 57L22.8 51.2L17 49L22.8 46.8L25 41Z"
                  fill="var(--accent-primary)"
                  className="inbox-zero-sparkle"
                  style={{ animationDelay: '0s' }}
                />
                <path
                  d="M114 78L115.7 82.3L120 84L115.7 85.7L114 90L112.3 85.7L108 84L112.3 82.3L114 78Z"
                  fill="var(--accent-text)"
                  className="inbox-zero-sparkle"
                  style={{ animationDelay: '0.75s' }}
                />
                <path
                  d="M108 22L109.4 25.6L113 27L109.4 28.4L108 32L106.6 28.4L103 27L106.6 25.6L108 22Z"
                  fill="#F59E0B"
                  className="inbox-zero-sparkle"
                  style={{ animationDelay: '1.35s' }}
                />
                <circle
                  cx="33"
                  cy="86"
                  r="2.6"
                  fill="var(--accent-primary)"
                  className="inbox-zero-sparkle"
                  style={{ animationDelay: '1.8s' }}
                />
                <circle
                  cx="44"
                  cy="28"
                  r="2"
                  fill="#F59E0B"
                  className="inbox-zero-sparkle"
                  style={{ animationDelay: '0.45s' }}
                />
              </>
            )}

            {/* Inner crisp letter card peeking above envelope */}
            <rect
              x="38"
              y="39"
              width="64"
              height="38"
              rx="6"
              fill="var(--bg-canvas)"
              stroke="var(--border-subtle)"
              strokeWidth="1.75"
            />
            <line
              x1="48"
              y1="49"
              x2="76"
              y2="49"
              stroke="var(--border-subtle)"
              strokeWidth="2.4"
              strokeLinecap="round"
            />
            <line
              x1="48"
              y1="57"
              x2="68"
              y2="57"
              stroke="var(--border-subtle)"
              strokeWidth="2.4"
              strokeLinecap="round"
            />

            {/* Minimalist Envelope Body */}
            <rect
              x="30"
              y="52"
              width="80"
              height="50"
              rx="10"
              fill="var(--bg-surface)"
              stroke="var(--accent-primary)"
              strokeWidth="2.2"
            />

            {/* Envelope Fold & Flap Lines */}
            <path
              d="M32 56L65.4 79.6C68.1 81.5 71.9 81.5 74.6 79.6L108 56"
              stroke="var(--accent-primary)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity="0.85"
            />
            <path
              d="M34 99L54 81M106 99L86 81"
              stroke="var(--border-subtle)"
              strokeWidth="1.8"
              strokeLinecap="round"
            />

            {/* Royal Blue Checkmark Badge */}
            <circle
              cx="102"
              cy="48"
              r="15"
              fill="var(--accent-primary)"
              stroke="var(--bg-surface)"
              strokeWidth="3"
            />
            <path
              d="M95.5 48.2L99.8 52.5L108.8 43.2"
              stroke="#FFFFFF"
              strokeWidth="2.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="inbox-zero-check"
            />
          </g>
        </svg>
      </div>

      {/* Smooth Fade-In Message */}
      <h3 className="inbox-zero-fade-up font-display mt-2 text-lg font-semibold tracking-tight text-[var(--text-primary)]">
        {title}
      </h3>
      <p className="inbox-zero-fade-up-delayed mt-1.5 max-w-sm text-xs leading-relaxed text-[var(--text-secondary)] sm:text-sm">
        {description}
      </p>

      {/* Contextual Action Buttons */}
      {(onResetFilters || onSimulateIncoming || onCompose) && (
        <div className="inbox-zero-fade-up-delayed-2 mt-5 flex flex-wrap items-center justify-center gap-2">
          {onResetFilters && (
            <button
              type="button"
              onClick={onResetFilters}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3.5 py-2 text-xs font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--accent-muted)]"
            >
              <RotateCcw className="h-3.5 w-3.5 text-[var(--text-secondary)]" />
              {isSearchEmpty ? 'Clear Search & Filters' : 'View All Mail'}
            </button>
          )}
          {onSimulateIncoming && (
            <button
              type="button"
              onClick={onSimulateIncoming}
              disabled={simulating}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3.5 py-2 text-xs font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--accent-muted)] disabled:opacity-60"
            >
              <RefreshCw className={`h-3.5 w-3.5 text-[var(--text-secondary)] ${simulating ? 'animate-spin' : ''}`} />
              Simulate Incoming Mail
            </button>
          )}
          {onCompose && (
            <button
              type="button"
              onClick={onCompose}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent-primary)] px-3.5 py-2 text-xs font-medium text-[var(--text-on-accent)] shadow-xs transition-colors hover:bg-[var(--accent-primary-hover)]"
            >
              <PenSquare className="h-3.5 w-3.5" />
              Compose
            </button>
          )}
        </div>
      )}
    </div>
  );
};
