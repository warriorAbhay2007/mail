import React, { useState } from 'react';
import { X, LogOut, UserCheck, Mail, Lock, User } from 'lucide-react';
import { PublicUser } from '../shared/types';
import { api, setAccessToken } from '../api/client';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: PublicUser | null;
  onAuthSuccess: (user: PublicUser) => void;
  onSignedOut: () => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({
  isOpen,
  onClose,
  currentUser,
  onAuthSuccess,
  onSignedOut,
}) => {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res =
        mode === 'login'
          ? await api.login(email, password)
          : await api.register(email, password, name);
      setAccessToken(res.token);
      onAuthSuccess(res.user);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleDemoSwitch = async () => {
    setError(null);
    setLoading(true);
    try {
      const res = await api.demoLogin();
      setAccessToken(res.token);
      onAuthSuccess(res.user);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load workspace.');
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    setLoading(true);
    try {
      await api.logout();
      setAccessToken(null);
      onSignedOut();
      onClose();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#0F172A]/45 p-4 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-labelledby="auth-modal-title"
    >
      <div className="w-full max-w-md rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-6 shadow-xl">
        <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-4">
          <div>
            <h2 id="auth-modal-title" className="text-lg font-semibold text-[var(--text-primary)]">
              Workspace Account
            </h2>
            <p className="text-xs text-[var(--text-secondary)]">
              All mails, schedules, categories, and chat sessions are scoped to your user account.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close account dialog"
            className="rounded-lg p-2 text-[var(--text-secondary)] transition-colors hover:bg-[var(--accent-muted)] hover:text-[var(--text-primary)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {currentUser && (
          <div className="mt-4 flex items-center justify-between rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-4 py-3">
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-[var(--text-primary)]">
                {currentUser.name}
              </div>
              <div className="truncate text-xs text-[var(--text-secondary)]">
                {currentUser.email} · {currentUser.authProvider}
              </div>
            </div>
            <button
              type="button"
              onClick={handleLogout}
              disabled={loading}
              className="ml-3 inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--accent-muted)]"
            >
              <LogOut className="h-3.5 w-3.5" />
              Sign Out
            </button>
          </div>
        )}

        <div className="mt-5 flex rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-1">
          <button
            type="button"
            onClick={() => {
              setMode('login');
              setError(null);
            }}
            className={`flex-1 rounded-md py-1.5 text-xs font-medium transition-colors ${
              mode === 'login'
                ? 'bg-[var(--accent-primary)] text-[var(--text-on-accent)]'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            Sign In
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('register');
              setError(null);
            }}
            className={`flex-1 rounded-md py-1.5 text-xs font-medium transition-colors ${
              mode === 'register'
                ? 'bg-[var(--accent-primary)] text-[var(--text-on-accent)]'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            Create Account
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-3">
          {mode === 'register' && (
            <div>
              <label htmlFor="auth-name" className="mb-1 block text-xs font-medium text-[var(--text-primary)]">
                Full Name
              </label>
              <div className="relative">
                <User className="pointer-events-none absolute top-2.5 left-3 h-4 w-4 text-[var(--text-secondary)]" />
                <input
                  id="auth-name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Alex Rivera"
                  className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] py-2 pr-3 pl-9 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-secondary)]/75 focus:border-[var(--accent-primary)] focus:outline-none"
                />
              </div>
            </div>
          )}

          <div>
            <label htmlFor="auth-email" className="mb-1 block text-xs font-medium text-[var(--text-primary)]">
              Email Address
            </label>
            <div className="relative">
              <Mail className="pointer-events-none absolute top-2.5 left-3 h-4 w-4 text-[var(--text-secondary)]" />
              <input
                id="auth-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] py-2 pr-3 pl-9 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-secondary)]/75 focus:border-[var(--accent-primary)] focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label htmlFor="auth-password" className="mb-1 block text-xs font-medium text-[var(--text-primary)]">
              Password
            </label>
            <div className="relative">
              <Lock className="pointer-events-none absolute top-2.5 left-3 h-4 w-4 text-[var(--text-secondary)]" />
              <input
                id="auth-password"
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Minimum 6 characters"
                className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] py-2 pr-3 pl-9 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-secondary)]/75 focus:border-[var(--accent-primary)] focus:outline-none"
              />
            </div>
          </div>

          {error && (
            <p className="rounded-lg border border-[#DC2626]/30 bg-[var(--bg-canvas)] px-3 py-2 text-xs text-[#DC2626] dark:text-[#F87171]">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-[var(--accent-primary)] px-4 py-2 text-sm font-medium text-[var(--text-on-accent)] transition-colors hover:bg-[var(--accent-primary-hover)] disabled:opacity-60"
          >
            {loading ? 'Processing...' : mode === 'login' ? 'Sign In' : 'Create Workspace Account'}
          </button>
        </form>

        <div className="mt-4 border-t border-[var(--border-subtle)] pt-4">
          <button
            type="button"
            onClick={handleDemoSwitch}
            disabled={loading}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-4 py-2 text-xs font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--accent-muted)]"
          >
            <UserCheck className="h-4 w-4" />
            Continue with Seeded Workspace (abhaytailor6@velomail.app)
          </button>
        </div>
      </div>
    </div>
  );
};
