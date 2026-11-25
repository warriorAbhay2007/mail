import React from 'react';
import {
  CalendarClock,
  Inbox,
  MessageSquarePlus,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Pin,
  PinOff,
  Sparkles,
  Sun,
  Tag,
  Trash2,
} from 'lucide-react';
import { ChatSessionDoc, PublicUser, WorkspaceView } from '../shared/types';

interface SidebarRailProps {
  collapsed: boolean;
  onToggleCollapse: () => void;
  activeView: WorkspaceView;
  onSelectView: (view: WorkspaceView) => void;
  chats: ChatSessionDoc[];
  activeChatId: string | null;
  onSelectChat: (chatId: string) => void;
  onNewChat: () => void;
  onTogglePinChat: (chatId: string, currentPinned: boolean) => void;
  onDeleteChat: (chatId: string) => void;
  unreadCount: number;
  pendingScheduleCount: number;
  user: PublicUser | null;
  darkMode: boolean;
  onToggleDarkMode: () => void;
  onOpenAuthModal: () => void;
}

export const SidebarRail: React.FC<SidebarRailProps> = ({
  collapsed,
  onToggleCollapse,
  activeView,
  onSelectView,
  chats,
  activeChatId,
  onSelectChat,
  onNewChat,
  onTogglePinChat,
  onDeleteChat,
  unreadCount,
  pendingScheduleCount,
  user,
  darkMode,
  onToggleDarkMode,
  onOpenAuthModal,
}) => {
  const pinnedChats = chats.filter((c) => c.pinned);
  const recentChats = chats.filter((c) => !c.pinned);

  const navItems: Array<{
    id: WorkspaceView;
    label: string;
    icon: React.ReactNode;
    count?: number;
  }> = [
    {
      id: 'new-tab',
      label: 'New Tab',
      icon: <MessageSquarePlus className="h-4 w-4 shrink-0" />,
    },
    {
      id: 'mail',
      label: 'Mail Viewer',
      icon: <Inbox className="h-4 w-4 shrink-0" />,
      count: unreadCount > 0 ? unreadCount : undefined,
    },
    {
      id: 'digest',
      label: 'Digest',
      icon: <Sparkles className="h-4 w-4 shrink-0" />,
    },
    {
      id: 'schedule',
      label: 'Schedule',
      icon: <CalendarClock className="h-4 w-4 shrink-0" />,
      count: pendingScheduleCount > 0 ? pendingScheduleCount : undefined,
    },
    {
      id: 'category',
      label: 'Category',
      icon: <Tag className="h-4 w-4 shrink-0" />,
    },
  ];

  const renderChatRow = (chat: ChatSessionDoc) => {
    const isActive = activeView === 'new-tab' && activeChatId === chat.id;
    return (
      <div
        key={chat.id}
        className={`group flex items-center justify-between rounded-lg px-2.5 py-1.5 text-sm transition-colors ${
          isActive
            ? 'bg-[var(--accent-soft)] text-[var(--accent-text)] ring-1 ring-[var(--accent-primary)]/25'
            : 'text-[var(--text-primary)] hover:bg-[var(--accent-muted)]/60'
        }`}
      >
        <button
          type="button"
          onClick={() => onSelectChat(chat.id)}
          className="min-w-0 flex-1 truncate text-left text-xs font-medium"
          title={chat.title}
        >
          {chat.title}
        </button>
        <div className="ml-1 flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            onClick={() => onTogglePinChat(chat.id, chat.pinned)}
            aria-label={chat.pinned ? `Unpin ${chat.title}` : `Pin ${chat.title}`}
            title={chat.pinned ? 'Unpin session' : 'Pin session'}
            className={`rounded p-1 transition-colors ${
              chat.pinned
                ? 'text-[var(--accent-text)] hover:bg-[var(--accent-muted)]'
                : 'text-[var(--text-secondary)] opacity-0 group-hover:opacity-100 focus:opacity-100 hover:bg-[var(--accent-muted)] hover:text-[var(--text-primary)]'
            }`}
          >
            {chat.pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
          </button>
          <button
            type="button"
            onClick={() => onDeleteChat(chat.id)}
            aria-label={`Delete ${chat.title}`}
            title="Delete session"
            className="rounded p-1 text-[var(--text-secondary)] opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100 hover:bg-[#DC2626]/10 hover:text-[#DC2626] dark:hover:text-[#F87171]"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    );
  };

  return (
    <aside
      aria-label="Workspace navigation"
      className={`flex h-full shrink-0 flex-col border-r border-[var(--border-subtle)] bg-[var(--bg-surface)] transition-[width] duration-150 ${
        collapsed ? 'w-[68px]' : 'w-[264px]'
      }`}
    >
      {/* Top Workspace Title & Collapse Toggle */}
      <div className="flex h-14 items-center justify-between border-b border-[var(--border-subtle)] px-3">
        {!collapsed && (
          <span className="font-display truncate text-base font-bold tracking-tight text-[var(--text-primary)]">
            Meridian Mail
          </span>
        )}
        <button
          type="button"
          onClick={onToggleCollapse}
          aria-label={collapsed ? 'Expand navigation sidebar' : 'Collapse navigation sidebar'}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="rounded-lg p-2 text-[var(--text-secondary)] transition-colors hover:bg-[var(--accent-muted)]/60 hover:text-[var(--text-primary)]"
        >
          {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
        </button>
      </div>

      {/* Primary Navigation */}
      <nav className="space-y-1 px-2.5 py-3">
        {navItems.map((item) => {
          const isActive = activeView === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                if (item.id === 'new-tab') {
                  onNewChat();
                } else {
                  onSelectView(item.id);
                }
              }}
              aria-current={isActive ? 'page' : undefined}
              title={collapsed ? item.label : undefined}
              className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors ${
                isActive
                  ? 'bg-[var(--accent-primary)] text-[var(--text-on-accent)] shadow-xs'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--accent-muted)]/60 hover:text-[var(--text-primary)]'
              }`}
            >
              <span className="flex items-center gap-2.5">
                {item.icon}
                {!collapsed && <span>{item.label}</span>}
              </span>
              {!collapsed && item.count !== undefined && (
                <span
                  className={`tabular-nums text-xs font-semibold ${
                    isActive ? 'text-[var(--text-on-accent)]/90' : 'text-[var(--text-secondary)]'
                  }`}
                >
                  {item.count}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Chat History List (Pinned at top, recent below) */}
      {!collapsed && (
        <div className="flex-1 overflow-y-auto border-t border-[var(--border-subtle)] px-2.5 py-3">
          <div className="mb-2 flex items-center justify-between px-2">
            <span className="text-xs font-semibold text-[var(--text-secondary)]">
              Chat History
            </span>
            <button
              type="button"
              onClick={onNewChat}
              className="text-xs font-semibold text-[var(--accent-text)] underline-offset-2 hover:underline"
            >
              New
            </button>
          </div>

          {chats.length === 0 ? (
            <p className="px-2 py-3 text-xs text-[var(--text-secondary)]">
              Run a / or @ command to start a session.
            </p>
          ) : (
            <div className="space-y-3">
              {pinnedChats.length > 0 && (
                <div className="space-y-0.5" data-testid="pinned-chats-group">
                  <div className="px-2 pb-0.5 text-[11px] font-medium text-[var(--text-secondary)]">
                    Pinned
                  </div>
                  {pinnedChats.map(renderChatRow)}
                </div>
              )}

              {recentChats.length > 0 && (
                <div className="space-y-0.5" data-testid="recent-chats-group">
                  {pinnedChats.length > 0 && (
                    <div className="px-2 pb-0.5 text-[11px] font-medium text-[var(--text-secondary)]">
                      Recent
                    </div>
                  )}
                  {recentChats.map(renderChatRow)}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {collapsed && <div className="flex-1" />}

      {/* Account & Theme Footer */}
      <div className="border-t border-[var(--border-subtle)] p-2.5">
        <div className={`flex items-center ${collapsed ? 'flex-col gap-2' : 'justify-between gap-2'}`}>
          <button
            type="button"
            onClick={onOpenAuthModal}
            aria-label="Open account settings"
            className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg p-1.5 text-left transition-colors hover:bg-[var(--accent-muted)]/55"
          >
            <img
              src="/src/assets/images/flat_vector_avatar_1795577754817.jpg"
              alt={user?.name || 'Workspace user'}
              referrerPolicy="no-referrer"
              className="h-8 w-8 shrink-0 rounded-full object-cover ring-1 ring-[var(--border-subtle)]"
            />
            {!collapsed && (
              <div className="min-w-0">
                <div className="truncate text-xs font-semibold text-[var(--text-primary)]">
                  {user?.name || 'Sign In'}
                </div>
                <div className="truncate text-[11px] text-[var(--text-secondary)]">
                  {user?.email || 'Guest'}
                </div>
              </div>
            )}
          </button>

          <button
            type="button"
            onClick={onToggleDarkMode}
            aria-label={darkMode ? 'Switch to light theme' : 'Switch to dark theme'}
            title={darkMode ? 'Light theme' : 'Dark theme'}
            className="shrink-0 rounded-lg p-2 text-[var(--text-secondary)] transition-colors hover:bg-[var(--accent-muted)]/60 hover:text-[var(--text-primary)]"
          >
            {darkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
        </div>
      </div>
    </aside>
  );
};
