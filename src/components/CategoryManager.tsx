import React, { useMemo, useState } from 'react';
import {
  Edit3,
  FolderOpen,
  Plus,
  RefreshCw,
  ShieldAlert,
  Tag,
  Trash2,
} from 'lucide-react';
import { CategoryDoc, MailDoc } from '../shared/types';
import { api } from '../api/client';

interface CategoryManagerProps {
  categories: CategoryDoc[];
  mails: MailDoc[];
  onCategoriesChanged: () => void;
  onMailsChanged: () => void;
  onFilterInMailViewer: (categoryName: string) => void;
}

export const CategoryManager: React.FC<CategoryManagerProps> = ({
  categories,
  mails,
  onCategoriesChanged,
  onMailsChanged,
  onFilterInMailViewer,
}) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [keywordsText, setKeywordsText] = useState('');
  const [sendersText, setSendersText] = useState('');
  const [aiEnabled, setAiEnabled] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [recategorizing, setRecategorizing] = useState(false);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);

  const [bulkDeleteCategory, setBulkDeleteCategory] = useState<{
    name: string;
    count: number;
  } | null>(null);

  const countByCategory = useMemo(() => {
    const counts = new Map<string, number>();
    for (const m of mails) {
      counts.set(m.category, (counts.get(m.category) || 0) + 1);
    }
    return counts;
  }, [mails]);

  const resetForm = () => {
    setEditingId(null);
    setName('');
    setDescription('');
    setKeywordsText('');
    setSendersText('');
    setAiEnabled(true);
    setError(null);
  };

  const startEdit = (cat: CategoryDoc) => {
    setEditingId(cat.id);
    setName(cat.name);
    setDescription(cat.description);
    setKeywordsText(cat.keywords.join(', '));
    setSendersText(cat.senderPatterns.join(', '));
    setAiEnabled(cat.aiEnabled);
    setError(null);
  };

  const handleSaveCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError('Category name is required.');
      return;
    }

    const keywords = keywordsText
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const senderPatterns = sendersText
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    setSaving(true);
    try {
      if (editingId) {
        await api.updateCategory(editingId, {
          name: name.trim(),
          description: description.trim(),
          keywords,
          senderPatterns,
          aiEnabled,
        });
      } else {
        await api.createCategory({
          name: name.trim(),
          description: description.trim(),
          keywords,
          senderPatterns,
          aiEnabled,
        });
      }
      resetForm();
      onCategoriesChanged();
      onMailsChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save category.');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteCategory = async (cat: CategoryDoc) => {
    try {
      await api.deleteCategory(cat.id);
      if (editingId === cat.id) resetForm();
      onCategoriesChanged();
      onMailsChanged();
    } catch (err) {
      setStatusNotice(err instanceof Error ? err.message : 'Failed to delete category.');
    }
  };

  const handleRecategorize = async () => {
    setRecategorizing(true);
    setStatusNotice(null);
    try {
      const res = await api.recategorize();
      onMailsChanged();
      setStatusNotice(
        `Scanned ${res.totalInbox} inbox emails; updated ${res.updatedCount} ${
          res.updatedCount === 1 ? 'classification' : 'classifications'
        }.`
      );
    } catch (err) {
      setStatusNotice(err instanceof Error ? err.message : 'Failed to re-run categorization.');
    } finally {
      setRecategorizing(false);
    }
  };

  const handleConfirmBulkClean = async () => {
    if (!bulkDeleteCategory) return;
    try {
      await api.bulkDeleteMails({ category: bulkDeleteCategory.name });
      setBulkDeleteCategory(null);
      onMailsChanged();
    } catch (err) {
      setBulkDeleteCategory(null);
      setStatusNotice(err instanceof Error ? err.message : 'Failed to clean category emails.');
    }
  };

  return (
    <div className="h-full overflow-y-auto bg-[var(--bg-canvas)] p-5 sm:p-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-subtle)] pb-4">
          <div>
            <h2 className="font-display text-lg font-semibold text-[var(--text-primary)]">
              Event-Based Categorization & OTP Rules
            </h2>
            <p className="text-xs text-[var(--text-secondary)]">
              Fast OTP detection runs first on every ingested email, followed by custom rules and optional AI classification.
            </p>
          </div>
          <button
            type="button"
            disabled={recategorizing}
            onClick={handleRecategorize}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent-primary)] px-3.5 py-2 text-xs font-medium text-[var(--text-on-accent)] transition-colors hover:bg-[var(--accent-primary-hover)] disabled:opacity-60"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${recategorizing ? 'animate-spin' : ''}`} />
            {recategorizing ? 'Scanning Inbox...' : 'Re-run Categorization'}
          </button>
        </div>

        {statusNotice && (
          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 py-2.5 text-xs font-medium text-[var(--text-primary)]">
            {statusNotice}
          </div>
        )}

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* Categories List */}
          <div className="space-y-3 lg:col-span-7">
            {categories.map((cat) => {
              const count = countByCategory.get(cat.name) || 0;
              return (
                <div
                  key={cat.id}
                  className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4"
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        {cat.isSystem ? (
                          <ShieldAlert className="h-4 w-4 shrink-0 text-[var(--text-primary)]" />
                        ) : (
                          <Tag className="h-4 w-4 shrink-0 text-[var(--text-primary)]" />
                        )}
                        <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                          {cat.name}
                        </h3>
                        <span className="tabular-nums text-xs text-[var(--text-secondary)]">
                          · {count} {count === 1 ? 'email' : 'emails'}
                        </span>
                        {cat.isSystem && (
                          <span className="text-xs font-medium text-[var(--text-secondary)]">
                            · Priority System Rule
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-xs text-[var(--text-secondary)]">
                        {cat.description || 'Custom category rule'}
                      </p>

                      <div className="mt-2 space-y-1 text-[11px] text-[var(--text-secondary)]">
                        {cat.keywords.length > 0 && (
                          <div>
                            <span className="font-medium text-[var(--text-primary)]">
                              Keywords:{' '}
                            </span>
                            {cat.keywords.join(' · ')}
                          </div>
                        )}
                        {cat.senderPatterns.length > 0 && (
                          <div>
                            <span className="font-medium text-[var(--text-primary)]">
                              Senders:{' '}
                            </span>
                            {cat.senderPatterns.join(' · ')}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => onFilterInMailViewer(cat.name)}
                        className="inline-flex items-center gap-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-2.5 py-1.5 text-xs font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--accent-muted)]"
                      >
                        <FolderOpen className="h-3.5 w-3.5" />
                        View
                      </button>

                      {count > 0 && (
                        <button
                          type="button"
                          onClick={() => setBulkDeleteCategory({ name: cat.name, count })}
                          className="rounded-lg border border-[#DC2626]/30 bg-[var(--bg-canvas)] px-2.5 py-1.5 text-xs font-medium text-[#DC2626] transition-colors hover:bg-[#DC2626]/10 dark:text-[#F87171]"
                        >
                          Clean ({count})
                        </button>
                      )}

                      {!cat.isSystem && (
                        <>
                          <button
                            type="button"
                            onClick={() => startEdit(cat)}
                            aria-label={`Edit ${cat.name}`}
                            className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-1.5 text-[var(--text-primary)] transition-colors hover:bg-[var(--accent-muted)]"
                          >
                            <Edit3 className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteCategory(cat)}
                            aria-label={`Delete ${cat.name}`}
                            className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-1.5 text-[var(--text-secondary)] transition-colors hover:bg-[#DC2626]/10 hover:text-[#DC2626] dark:hover:text-[#F87171]"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Create / Edit Category Form */}
          <form
            onSubmit={handleSaveCategory}
            className="h-fit rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5 lg:col-span-5"
          >
            <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-3">
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                {editingId ? 'Edit Category' : 'New Custom Category'}
              </h3>
              {editingId && (
                <button
                  type="button"
                  onClick={resetForm}
                  className="text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                >
                  Cancel edit
                </button>
              )}
            </div>

            <div className="mt-4 space-y-3">
              <div>
                <label htmlFor="cat-name" className="mb-1 block text-xs font-medium text-[var(--text-primary)]">
                  Category Name
                </label>
                <input
                  id="cat-name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g., Legal, Recruiting, Travel"
                  className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-secondary)]/75 focus:border-[var(--accent-primary)] focus:outline-none"
                />
              </div>

              <div>
                <label htmlFor="cat-desc" className="mb-1 block text-xs font-medium text-[var(--text-primary)]">
                  Description / AI Guidance
                </label>
                <textarea
                  id="cat-desc"
                  rows={2}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Contracts, NDAs, and compliance notices..."
                  className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-secondary)]/75 focus:border-[var(--accent-primary)] focus:outline-none"
                />
              </div>

              <div>
                <label htmlFor="cat-keywords" className="mb-1 block text-xs font-medium text-[var(--text-primary)]">
                  Match Keywords (comma-separated)
                </label>
                <input
                  id="cat-keywords"
                  type="text"
                  value={keywordsText}
                  onChange={(e) => setKeywordsText(e.target.value)}
                  placeholder="contract, agreement, nda, signature"
                  className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-secondary)]/75 focus:border-[var(--accent-primary)] focus:outline-none"
                />
              </div>

              <div>
                <label htmlFor="cat-senders" className="mb-1 block text-xs font-medium text-[var(--text-primary)]">
                  Sender Patterns (comma-separated)
                </label>
                <input
                  id="cat-senders"
                  type="text"
                  value={sendersText}
                  onChange={(e) => setSendersText(e.target.value)}
                  placeholder="docusign.net, legal@"
                  className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-secondary)]/75 focus:border-[var(--accent-primary)] focus:outline-none"
                />
              </div>

              <label className="flex items-center gap-2 pt-1 text-xs text-[var(--text-secondary)]">
                <input
                  type="checkbox"
                  checked={aiEnabled}
                  onChange={(e) => setAiEnabled(e.target.checked)}
                  className="h-4 w-4 rounded border-[var(--border-subtle)] accent-[#2563EB]"
                />
                Allow AI fallback classification when running /categorize
              </label>

              {error && (
                <p className="rounded-lg border border-[#DC2626]/30 bg-[var(--bg-canvas)] px-3 py-2 text-xs text-[#DC2626] dark:text-[#F87171]">
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={saving}
                className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-[var(--accent-primary)] px-4 py-2 text-xs font-medium text-[var(--text-on-accent)] transition-colors hover:bg-[var(--accent-primary-hover)] disabled:opacity-60"
              >
                <Plus className="h-4 w-4" />
                {saving ? 'Saving...' : editingId ? 'Update Category' : 'Create Category'}
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* Bulk Clean Confirmation Dialog */}
      {bulkDeleteCategory && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#0F172A]/45 p-4 backdrop-blur-xs"
          role="dialog"
          aria-modal="true"
          aria-labelledby="cat-clean-title"
        >
          <div className="w-full max-w-md rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-6 shadow-xl">
            <h3 id="cat-clean-title" className="text-base font-semibold text-[var(--text-primary)]">
              Confirm Bulk Clean: {bulkDeleteCategory.name}
            </h3>
            <p className="mt-2 text-xs text-[var(--text-secondary)]">
              This will permanently delete{' '}
              <strong className="tabular-nums text-[var(--text-primary)]">
                {bulkDeleteCategory.count}
              </strong>{' '}
              {bulkDeleteCategory.count === 1 ? 'email' : 'emails'} categorized under{' '}
              <strong>{bulkDeleteCategory.name}</strong>.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setBulkDeleteCategory(null)}
                className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-3.5 py-2 text-xs font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--accent-muted)]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmBulkClean}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#DC2626] px-4 py-2 text-xs font-medium text-white transition-opacity hover:opacity-90"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete {bulkDeleteCategory.count} Emails
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
