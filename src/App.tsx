import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Menu, MessageSquarePlus, X } from 'lucide-react';
import {
  CategoryDoc,
  ChatSessionDoc,
  DigestItem,
  MailDoc,
  OtpVaultDoc,
  PublicUser,
  ScheduleDoc,
  ScheduleRuleInput,
  WorkspaceView,
} from './shared/types';
import { buildDraftPromptForMail, buildSchedulePrefillForDigestItem } from './shared/digest';
import { api, setAccessToken } from './api/client';
import { SidebarRail } from './components/SidebarRail';
import { NewTabAgent } from './components/NewTabAgent';
import { MailViewer } from './components/MailViewer';
import { DigestView } from './components/DigestView';
import { ScheduleManager } from './components/ScheduleManager';
import { CategoryManager } from './components/CategoryManager';
import { AuthModal } from './components/AuthModal';
import { FloatingOtpPill } from './components/FloatingOtpPill';
import { PrivacyFeaturesSection } from './components/PrivacyFeaturesSection';

function sortChats(chats: ChatSessionDoc[]): ChatSessionDoc[] {
  return [...chats].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });
}

export default function App() {
  const [initializing, setInitializing] = useState(true);
  const [user, setUser] = useState<PublicUser | null>(null);
  const [authModalOpen, setAuthModalOpen] = useState(false);

  const [activeView, setActiveView] = useState<WorkspaceView>('new-tab');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [darkMode, setDarkMode] = useState(false);

  const [mails, setMails] = useState<MailDoc[]>([]);
  const [otpEntries, setOtpEntries] = useState<OtpVaultDoc[]>([]);
  const [schedules, setSchedules] = useState<ScheduleDoc[]>([]);
  const [categories, setCategories] = useState<CategoryDoc[]>([]);
  const [chats, setChats] = useState<ChatSessionDoc[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);

  const [mailFilterOverride, setMailFilterOverride] = useState<string>('all');
  const [schedulePrefill, setSchedulePrefill] = useState<ScheduleRuleInput | null>(null);
  const [promptPrefill, setPromptPrefill] = useState<string | null>(null);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
  }, [darkMode]);

  const refreshOtpVault = useCallback(async () => {
    try {
      const res = await api.listActiveOtpVault();
      setOtpEntries(res.entries);
    } catch {
      // Handled safely without unhandled rejection
    }
  }, []);

  const refreshMailsAndOtp = useCallback(async () => {
    try {
      const [mRes, oRes] = await Promise.all([api.listMails(), api.listActiveOtpVault()]);
      setMails(mRes.mails);
      setOtpEntries(oRes.entries);
    } catch {
      // Handled safely without unhandled rejection
    }
  }, []);

  const loadWorkspaceData = useCallback(async () => {
    try {
      const [mRes, oRes, sRes, cRes, chRes] = await Promise.all([
        api.listMails(),
        api.listActiveOtpVault(),
        api.listSchedules(),
        api.listCategories(),
        api.listChats(),
      ]);
      setMails(mRes.mails);
      setOtpEntries(oRes.entries);
      setSchedules(sRes.schedules);
      setCategories(cRes.categories);
      setChats(sortChats(chRes.chats));
    } catch {
      // Handled safely without unhandled rejection
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function bootstrap() {
      try {
        // Restore existing cookie session if present, else initialize demo workspace
        let authedUser: PublicUser | null = null;
        const sessRes = await api.session();
        if (sessRes.authenticated && sessRes.user) {
          authedUser = sessRes.user;
        } else {
          const demoRes = await api.demoLogin();
          setAccessToken(demoRes.token);
          authedUser = demoRes.user;
        }
        if (cancelled) return;
        setUser(authedUser);
        await loadWorkspaceData();
      } catch {
        if (!cancelled) setUser(null);
      } finally {
        if (!cancelled) setInitializing(false);
      }
    }
    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, [loadWorkspaceData]);

  // Poll schedules periodically when viewing Schedule screen so background worker transitions reflect live
  useEffect(() => {
    if (!user || activeView !== 'schedule') return;
    const timer = setInterval(() => {
      void api.listSchedules().then((r) => setSchedules(r.schedules)).catch(() => {});
    }, 6000);
    return () => clearInterval(timer);
  }, [user, activeView]);

  const activeChat = useMemo(
    () => chats.find((c) => c.id === activeChatId) || null,
    [chats, activeChatId]
  );

  const unreadCount = useMemo(
    () => mails.filter((m) => m.folder === 'inbox' && !m.isRead).length,
    [mails]
  );

  const pendingScheduleCount = useMemo(
    () =>
      schedules.reduce(
        (acc, s) => acc + s.slots.filter((sl) => sl.status === 'pending').length,
        0
      ),
    [schedules]
  );

  const handleChatUpdated = (updated: ChatSessionDoc) => {
    setChats((prev) => {
      const filtered = prev.filter((c) => c.id !== updated.id);
      return sortChats([updated, ...filtered]);
    });
    setActiveChatId(updated.id);
  };

  const handleTogglePinChat = async (chatId: string, currentPinned: boolean) => {
    try {
      const res = await api.updateChat(chatId, { pinned: !currentPinned });
      handleChatUpdated(res.chat);
    } catch {
      // Handled safely without unhandled rejection
    }
  };

  const handleDeleteChat = async (chatId: string) => {
    try {
      await api.deleteChat(chatId);
      setChats((prev) => prev.filter((c) => c.id !== chatId));
      if (activeChatId === chatId) setActiveChatId(null);
    } catch {
      // Handled safely without unhandled rejection
    }
  };

  const handleNewChat = () => {
    setActiveChatId(null);
    setActiveView('new-tab');
    setMobileNavOpen(false);
  };

  const handleSelectChat = (chatId: string) => {
    setActiveChatId(chatId);
    setActiveView('new-tab');
    setMobileNavOpen(false);
  };

  const handleDraftInAgentFromDigest = useCallback((item: DigestItem) => {
    setActiveChatId(null);
    setPromptPrefill(buildDraftPromptForMail(item));
    setActiveView('new-tab');
  }, []);

  const handleScheduleFromDigest = useCallback((item: DigestItem) => {
    setSchedulePrefill(buildSchedulePrefillForDigestItem(item));
    setActiveView('schedule');
  }, []);

  const viewTitleMap: Record<WorkspaceView, string> = {
    'new-tab': activeChat ? activeChat.title : 'New Tab · AI Agent',
    mail: 'Mail Viewer',
    digest: 'Morning Digest · Action Extractor',
    schedule: 'Scheduling Engine',
    category: 'Categories & OTP Rules',
  };

  if (initializing) {
    return (
      <div className="flex h-screen items-center justify-center bg-[var(--bg-canvas)] text-[var(--text-secondary)]">
        <div className="flex items-center gap-2.5 text-sm font-medium">
          <Loader2 className="h-5 w-5 animate-spin text-[var(--accent-primary)]" />
          <span>Loading POSTLYai Workspace...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[var(--bg-canvas)] text-[var(--text-primary)]">
      {/* Desktop Left Navigation Rail */}
      <div className="hidden h-full md:flex">
        <SidebarRail
          collapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed((c) => !c)}
          activeView={activeView}
          onSelectView={(v) => {
            if (v === 'mail') setMailFilterOverride('all');
            setActiveView(v);
          }}
          chats={chats}
          activeChatId={activeChatId}
          onSelectChat={handleSelectChat}
          onNewChat={handleNewChat}
          onTogglePinChat={handleTogglePinChat}
          onDeleteChat={handleDeleteChat}
          unreadCount={unreadCount}
          pendingScheduleCount={pendingScheduleCount}
          user={user}
          darkMode={darkMode}
          onToggleDarkMode={() => setDarkMode((d) => !d)}
          onOpenAuthModal={() => setAuthModalOpen(true)}
        />
      </div>

      {/* Mobile Drawer */}
      {mobileNavOpen && (
        <div className="fixed inset-0 z-40 flex md:hidden">
          <div
            className="fixed inset-0 bg-[#0F172A]/45"
            onClick={() => setMobileNavOpen(false)}
          />
          <div className="relative z-10 flex h-full">
            <SidebarRail
              collapsed={false}
              onToggleCollapse={() => setMobileNavOpen(false)}
              activeView={activeView}
              onSelectView={(v) => {
                if (v === 'mail') setMailFilterOverride('all');
                setActiveView(v);
                setMobileNavOpen(false);
              }}
              chats={chats}
              activeChatId={activeChatId}
              onSelectChat={handleSelectChat}
              onNewChat={handleNewChat}
              onTogglePinChat={handleTogglePinChat}
              onDeleteChat={handleDeleteChat}
              unreadCount={unreadCount}
              pendingScheduleCount={pendingScheduleCount}
              user={user}
              darkMode={darkMode}
              onToggleDarkMode={() => setDarkMode((d) => !d)}
              onOpenAuthModal={() => {
                setMobileNavOpen(false);
                setAuthModalOpen(true);
              }}
            />
            <button
              type="button"
              aria-label="Close navigation menu"
              onClick={() => setMobileNavOpen(false)}
              className="m-2 h-9 w-9 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-2 text-[var(--text-primary)] shadow"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>
      )}

      {/* Right Dynamic Workspace Panel */}
      <div className="flex min-w-0 flex-1 flex-col bg-[var(--bg-canvas)]">
        {/* Clean Single-Row Top Bar */}
        <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              aria-label="Open navigation menu"
              className="rounded-lg p-1.5 text-[var(--text-secondary)] hover:bg-[var(--accent-muted)]/50 hover:text-[var(--text-primary)] md:hidden"
            >
              <Menu className="h-5 w-5" />
            </button>
            <h1 className="font-display truncate text-sm font-semibold text-[var(--text-primary)] sm:text-base">
              {viewTitleMap[activeView]}
            </h1>
          </div>

          <div className="flex shrink-0 items-center gap-2.5">
            {user && (
              <FloatingOtpPill
                entries={otpEntries}
                onOtpConsumed={() => void refreshOtpVault()}
                variant="header"
              />
            )}
            {activeView !== 'new-tab' ? (
              <button
                type="button"
                onClick={handleNewChat}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--accent-muted)]/60 whitespace-nowrap"
              >
                <MessageSquarePlus className="h-3.5 w-3.5 text-[var(--accent-text)]" />
                New Tab
              </button>
            ) : (
              <button
                type="button"
                onClick={handleNewChat}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--accent-muted)]/60 whitespace-nowrap"
              >
                <MessageSquarePlus className="h-3.5 w-3.5 text-[var(--accent-text)]" />
                Reset Tab
              </button>
            )}
          </div>
        </header>

        {user && (
          <FloatingOtpPill
            entries={otpEntries}
            onOtpConsumed={() => void refreshOtpVault()}
            variant="mobile-bar"
          />
        )}

        {/* Main View Content */}
        <main className="min-h-0 flex-1 overflow-hidden">
          {!user ? (
            <div className="flex h-full flex-col items-center overflow-y-auto px-6 py-14 text-center">
              <div className="my-auto flex w-full max-w-4xl flex-col items-center">
                <h2 className="font-display text-2xl font-semibold text-[var(--text-primary)]">
                  Sign in to access your mail workspace
                </h2>
                <p className="mt-2 max-w-md text-sm text-[var(--text-secondary)]">
                  Your emails, materialized schedules, categories, and pinned AI sessions are private to your account.
                </p>
                <button
                  type="button"
                  onClick={() => setAuthModalOpen(true)}
                  className="mt-5 rounded-lg bg-[var(--accent-primary)] px-4 py-2 text-sm font-medium text-[var(--text-on-accent)] transition-colors hover:bg-[var(--accent-primary-hover)]"
                >
                  Sign In or Continue Demo
                </button>
                <PrivacyFeaturesSection className="mt-12 border-t border-[var(--border-subtle)] pt-10" />
              </div>
            </div>
          ) : activeView === 'new-tab' ? (
            <NewTabAgent
              activeChat={activeChat}
              mails={mails}
              categories={categories}
              userName={user.name}
              promptPrefill={promptPrefill}
              onClearPromptPrefill={() => setPromptPrefill(null)}
              onChatUpdated={handleChatUpdated}
              onScheduleCreated={() => void api.listSchedules().then((r) => setSchedules(r.schedules)).catch(() => {})}
              onOpenScheduleBuilder={(rule) => {
                if (rule) setSchedulePrefill(rule);
                setActiveView('schedule');
              }}
              onOpenDigestView={() => setActiveView('digest')}
              onDraftInAgent={handleDraftInAgentFromDigest}
              onMailsChanged={() => void refreshMailsAndOtp()}
              onOtpConsumed={() => void refreshOtpVault()}
            />
          ) : activeView === 'mail' ? (
            <MailViewer
              key={mailFilterOverride}
              mails={mails}
              categories={categories}
              schedules={schedules}
              initialCategoryFilter={mailFilterOverride}
              onMailsChanged={() => void refreshMailsAndOtp()}
              onSchedulesChanged={() => void api.listSchedules().then((r) => setSchedules(r.schedules)).catch(() => {})}
              onOtpConsumed={() => void refreshOtpVault()}
              onSendToAgent={(prefill) => {
                setActiveChatId(null);
                setActiveView('new-tab');
                // Execute directly if valid trigger
                void api
                  .executeAgent(prefill, null)
                  .then((res) => {
                    handleChatUpdated(res.chat);
                  })
                  .catch(() => {});
              }}
            />
          ) : activeView === 'digest' ? (
            <DigestView
              mails={mails}
              categories={categories}
              onMailsChanged={() => void refreshMailsAndOtp()}
              onDraftInAgent={handleDraftInAgentFromDigest}
              onScheduleDeadline={handleScheduleFromDigest}
              onOtpConsumed={() => void refreshOtpVault()}
              onTriggerAgentCommand={(cmd) => {
                setActiveChatId(null);
                setActiveView('new-tab');
                void api
                  .executeAgent(cmd, null)
                  .then((res) => {
                    handleChatUpdated(res.chat);
                  })
                  .catch(() => {});
              }}
            />
          ) : activeView === 'schedule' ? (
            <ScheduleManager
              schedules={schedules}
              prefillRule={schedulePrefill}
              onClearPrefill={() => setSchedulePrefill(null)}
              onSchedulesChanged={() => void api.listSchedules().then((r) => setSchedules(r.schedules)).catch(() => {})}
              onReplySimulated={() => void refreshMailsAndOtp()}
            />
          ) : (
            <CategoryManager
              categories={categories}
              mails={mails}
              onCategoriesChanged={() => void api.listCategories().then((r) => setCategories(r.categories)).catch(() => {})}
              onMailsChanged={() => void refreshMailsAndOtp()}
              onFilterInMailViewer={(categoryName) => {
                setMailFilterOverride(categoryName);
                setActiveView('mail');
              }}
            />
          )}
        </main>
      </div>

      <AuthModal
        isOpen={authModalOpen}
        onClose={() => setAuthModalOpen(false)}
        currentUser={user}
        onAuthSuccess={(nextUser) => {
          setUser(nextUser);
          setActiveChatId(null);
          void loadWorkspaceData();
        }}
        onSignedOut={() => {
          setUser(null);
          setMails([]);
          setOtpEntries([]);
          setSchedules([]);
          setCategories([]);
          setChats([]);
          setActiveChatId(null);
        }}
      />
    </div>
  );
}
