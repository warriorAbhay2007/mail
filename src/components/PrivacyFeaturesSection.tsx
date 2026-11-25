import React, { useEffect, useRef, useState } from 'react';
import { Lock, Sparkles, Zap } from 'lucide-react';

interface PrivacyFeaturesSectionProps {
  className?: string;
}

const SORT_TAGS = [
  {
    id: 'otp',
    label: 'OTP',
    cls: 'sort-tag-item-1 border-[#2563EB]/30 bg-[#EFF6FF] text-[#1D4ED8] dark:border-[#60A5FA]/30 dark:bg-[#2563EB]/20 dark:text-[#93C5FD]',
    delay: '220ms',
  },
  {
    id: 'finance',
    label: 'Finance',
    cls: 'sort-tag-item-2 border-[#16A34A]/30 bg-[#ECFDF5] text-[#15803D] dark:border-[#4ADE80]/30 dark:bg-[#16A34A]/20 dark:text-[#86EFAC]',
    delay: '310ms',
  },
  {
    id: 'engineering',
    label: 'Engineering',
    cls: 'sort-tag-item-3 border-[#4F46E5]/30 bg-[#EEF2FF] text-[#4338CA] dark:border-[#818CF8]/30 dark:bg-[#4F46E5]/20 dark:text-[#A5B4FC]',
    delay: '400ms',
  },
  {
    id: 'product',
    label: 'Product',
    cls: 'sort-tag-item-4 border-[#D97706]/30 bg-[#FFFBEB] text-[#B45309] dark:border-[#FBBF24]/30 dark:bg-[#D97706]/20 dark:text-[#FCD34D]',
    delay: '490ms',
  },
] as const;

export const PrivacyFeaturesSection: React.FC<PrivacyFeaturesSectionProps> = ({
  className = '',
}) => {
  const sectionRef = useRef<HTMLElement | null>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;

    if (typeof IntersectionObserver === 'undefined') {
      setIsVisible(true);
      return;
    }

    let scrollRoot: Element | null = null;
    let parent = el.parentElement;
    while (parent) {
      const overflowY = getComputedStyle(parent).overflowY;
      if (overflowY === 'auto' || overflowY === 'scroll') {
        scrollRoot = parent;
        break;
      }
      parent = parent.parentElement;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setIsVisible(true);
            observer.disconnect();
            break;
          }
        }
      },
      { root: scrollRoot, threshold: 0.3 }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <section
      ref={sectionRef}
      aria-labelledby="privacy-features-heading"
      data-testid="privacy-features-section"
      className={`w-full ${className}`}
    >
      <div className="mb-5 text-left">
        <p className="text-xs font-semibold tracking-wide text-[var(--accent-text)]">
          Privacy-First Mail Architecture
        </p>
        <h2
          id="privacy-features-heading"
          className="font-display mt-1 text-lg font-semibold tracking-tight text-[var(--text-primary)] sm:text-xl"
        >
          Built for speed, encryption, and effortless clarity
        </h2>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {/* Card 1: Lightning Fast */}
        <article
          data-testid="feature-card-fast"
          style={{ transitionDelay: '0ms' }}
          className={`feature-card-reveal group flex flex-col justify-between rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5 text-left hover:border-[var(--accent-primary)]/45 hover:shadow-sm ${
            isVisible ? 'is-visible' : ''
          }`}
        >
          <div>
            <div className="mb-4 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-3.5 overflow-hidden">
              <div className="flex items-center justify-between text-[11px] font-medium text-[var(--text-secondary)]">
                <span className="inline-flex items-center gap-1.5 text-[var(--text-primary)]">
                  <Zap className="h-3.5 w-3.5 text-[var(--accent-text)]" />
                  Sync Latency
                </span>
                <span className="font-mono tabular-nums text-[var(--accent-text)]">18ms</span>
              </div>

              {/* Speed progress bar */}
              <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-[var(--accent-muted)]">
                <div className="speed-progress-fill h-full rounded-full bg-[var(--accent-primary)]" />
              </div>

              {/* Hover speed lines */}
              <div className="mt-2.5 space-y-1.5" aria-hidden="true">
                <div className="h-0.5 w-full overflow-hidden rounded-full bg-[var(--border-subtle)]/60">
                  <div
                    className="speed-line h-full w-1/2 rounded-full bg-[var(--accent-primary)]"
                    style={{ animationDelay: '0ms' }}
                  />
                </div>
                <div className="h-0.5 w-4/5 overflow-hidden rounded-full bg-[var(--border-subtle)]/50">
                  <div
                    className="speed-line h-full w-2/5 rounded-full bg-[var(--accent-text)]"
                    style={{ animationDelay: '180ms' }}
                  />
                </div>
                <div className="h-0.5 w-3/5 overflow-hidden rounded-full bg-[var(--border-subtle)]/40">
                  <div
                    className="speed-line h-full w-1/2 rounded-full bg-[var(--accent-primary)]/80"
                    style={{ animationDelay: '340ms' }}
                  />
                </div>
              </div>
            </div>

            <h3 className="font-display text-sm font-semibold text-[var(--text-primary)]">
              Lightning Fast
            </h3>
            <p className="mt-1.5 text-xs leading-relaxed text-[var(--text-secondary)]">
              Instant thread indexing and sub-50ms search across your entire mailbox with zero client bloat.
            </p>
          </div>
        </article>

        {/* Card 2: End-to-End Encrypted */}
        <article
          data-testid="feature-card-encrypted"
          style={{ transitionDelay: '130ms' }}
          className={`feature-card-reveal group flex flex-col justify-between rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5 text-left hover:border-[var(--accent-primary)]/45 hover:shadow-sm ${
            isVisible ? 'is-visible' : ''
          }`}
        >
          <div>
            <div className="mb-4 flex items-center justify-center rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] py-2.5 px-3">
              <svg
                viewBox="0 0 120 72"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                aria-hidden="true"
                className="h-[68px] w-auto overflow-visible"
              >
                {/* Minimalist Envelope Outline */}
                <rect
                  x="14"
                  y="14"
                  width="68"
                  height="44"
                  rx="7"
                  fill="var(--bg-surface)"
                  stroke="var(--border-subtle)"
                  strokeWidth="1.8"
                />
                <path
                  d="M16 18L45.2 38.2C47 39.4 49 39.4 50.8 38.2L80 18"
                  stroke="var(--border-subtle)"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />

                {/* Padlock Seal Backdrop */}
                <circle
                  cx="84"
                  cy="44"
                  r="19"
                  fill="var(--bg-surface)"
                  stroke="var(--border-subtle)"
                  strokeWidth="1.6"
                />

                {/* Ghost Padlock Outline at rest */}
                <path
                  d="M78 40V36.5C78 33.19 80.69 30.5 84 30.5C87.31 30.5 90 33.19 90 36.5V40"
                  stroke="var(--text-secondary)"
                  strokeOpacity="0.35"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
                <rect
                  x="74.5"
                  y="40"
                  width="19"
                  height="14"
                  rx="3.5"
                  stroke="var(--text-secondary)"
                  strokeOpacity="0.35"
                  strokeWidth="2"
                />

                {/* Animated Self-Drawing Royal Blue Padlock Paths on Hover */}
                <path
                  d="M78 40V36.5C78 33.19 80.69 30.5 84 30.5C87.31 30.5 90 33.19 90 36.5V40"
                  stroke="var(--accent-primary)"
                  strokeWidth="2.3"
                  strokeLinecap="round"
                  className="e2e-shackle-path"
                />
                <path
                  d="M78 40H90C91.93 40 93.5 41.57 93.5 43.5V50.5C93.5 52.43 91.93 54 90 54H78C76.07 54 74.5 52.43 74.5 50.5V43.5C74.5 41.57 76.07 40 78 40Z"
                  stroke="var(--accent-primary)"
                  strokeWidth="2.3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="e2e-lock-path"
                />
                <circle cx="84" cy="47" r="1.6" fill="var(--accent-primary)" />
              </svg>
            </div>

            <div className="flex items-center gap-1.5">
              <Lock className="h-3.5 w-3.5 text-[var(--accent-text)]" />
              <h3 className="font-display text-sm font-semibold text-[var(--text-primary)]">
                End-to-End Encrypted
              </h3>
            </div>
            <p className="mt-1.5 text-xs leading-relaxed text-[var(--text-secondary)]">
              Zero-tracking HTML sanitization and isolated per-account mail boundaries keep every thread private.
            </p>
          </div>
        </article>

        {/* Card 3: Smart Sorting */}
        <article
          data-testid="feature-card-sorting"
          style={{ transitionDelay: '260ms' }}
          className={`feature-card-reveal group flex flex-col justify-between rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5 text-left hover:border-[var(--accent-primary)]/45 hover:shadow-sm ${
            isVisible ? 'is-visible' : ''
          }`}
        >
          <div>
            <div className="mb-4 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-3.5">
              <div className="mb-2 flex items-center justify-between text-[11px] font-medium text-[var(--text-secondary)]">
                <span className="inline-flex items-center gap-1 text-[var(--text-primary)]">
                  <Sparkles className="h-3.5 w-3.5 text-[var(--accent-text)]" />
                  Auto-Categorized
                </span>
                <span>4 rules</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {SORT_TAGS.map((tag) => (
                  <span
                    key={tag.id}
                    style={{ animationDelay: tag.delay }}
                    className={`sort-tag-item inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-semibold ${tag.cls}`}
                  >
                    {tag.label}
                  </span>
                ))}
              </div>
            </div>

            <h3 className="font-display text-sm font-semibold text-[var(--text-primary)]">
              Smart Sorting
            </h3>
            <p className="mt-1.5 text-xs leading-relaxed text-[var(--text-secondary)]">
              Deterministic OTP extraction and custom rules route invoices, releases, and milestones automatically.
            </p>
          </div>
        </article>
      </div>
    </section>
  );
};
