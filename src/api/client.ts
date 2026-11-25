import {
  CategoryDoc,
  ChatMessage,
  ChatSessionDoc,
  DigestBriefing,
  DigestFilterScope,
  GapUnit,
  MailDoc,
  OtpVaultDoc,
  PublicUser,
  QuickReplyTone,
  ScheduleDoc,
  ScheduleMode,
} from '../shared/types';
import { StopOnReplyResult } from '../shared/scheduler';

let inMemoryToken: string | null = null;

export function setAccessToken(token: string | null): void {
  inMemoryToken = token;
}

export function getAccessToken(): string | null {
  return inMemoryToken;
}

async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (!headers.has('Content-Type') && init.body) {
    headers.set('Content-Type', 'application/json');
  }
  if (inMemoryToken) {
    headers.set('Authorization', `Bearer ${inMemoryToken}`);
  }

  const res = await fetch(path, {
    ...init,
    headers,
    credentials: 'include',
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string }).error || `Request failed (${res.status})`);
  }
  return data as T;
}

export const api = {
  // Auth
  demoLogin: () => apiRequest<{ user: PublicUser; token: string }>('/api/auth/demo', { method: 'POST' }),
  login: (email: string, password: string) =>
    apiRequest<{ user: PublicUser; token: string }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  register: (email: string, password: string, name: string) =>
    apiRequest<{ user: PublicUser; token: string }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password, name }),
    }),
  logout: () => apiRequest<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),
  session: () => apiRequest<{ authenticated: boolean; user: PublicUser | null }>('/api/auth/session'),
  me: () => apiRequest<{ user: PublicUser }>('/api/auth/me'),

  // Mails & OTP Vault
  listMails: () => apiRequest<{ mails: MailDoc[] }>('/api/mails'),
  sendMail: (payload: { to: string[]; subject: string; textBody: string; saveAsDraft?: boolean }) =>
    apiRequest<{ mail: MailDoc; transport: string }>('/api/mails', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  ingestMail: (payload?: {
    fromName?: string;
    fromEmail?: string;
    subject?: string;
    textBody?: string;
    threadId?: string;
    inReplyTo?: string;
    template?: 'meeting' | 'deadline' | 'otp';
  }) =>
    apiRequest<{ ingested: MailDoc[]; otpVaultEntries: OtpVaultDoc[]; stopOnReply?: StopOnReplyResult }>(
      '/api/mails/ingest',
      {
        method: 'POST',
        body: JSON.stringify(payload || {}),
      }
    ),
  listActiveOtpVault: () => apiRequest<{ entries: OtpVaultDoc[] }>('/api/otp-vault/active'),
  markOtpUsed: (id: string) =>
    apiRequest<{ entry: OtpVaultDoc }>(`/api/otp-vault/${id}/use`, { method: 'POST' }),
  updateMail: (id: string, patch: Partial<Pick<MailDoc, 'isRead' | 'isStarred' | 'category' | 'folder'>>) =>
    apiRequest<{ mail: MailDoc }>(`/api/mails/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  generateQuickReply: (id: string, tone: QuickReplyTone) =>
    apiRequest<{ draft: string; tone: QuickReplyTone; model: string }>(`/api/mails/${id}/quick-reply`, {
      method: 'POST',
      body: JSON.stringify({ tone }),
    }),
  generateDigest: (payload?: { scope?: DigestFilterScope; category?: string }) =>
    apiRequest<{ digest: DigestBriefing }>('/api/digest/generate', {
      method: 'POST',
      body: JSON.stringify(payload || {}),
    }),
  deleteMail: (id: string) => apiRequest<{ ok: boolean }>(`/api/mails/${id}`, { method: 'DELETE' }),
  bulkDeleteMails: (payload: { ids?: string[]; category?: string }) =>
    apiRequest<{ deletedCount: number }>('/api/mails/bulk-delete', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  // Schedules
  listSchedules: () => apiRequest<{ schedules: ScheduleDoc[] }>('/api/schedules'),
  createSchedule: (payload: {
    mode: ScheduleMode;
    startUtc: string;
    freq: number;
    gapValue: number;
    gapUnit: GapUnit;
    recipients: string[];
    subject: string;
    body: string;
    stopOnReply?: boolean;
    threadId?: string;
  }) =>
    apiRequest<{ schedule: ScheduleDoc }>('/api/schedules', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  cancelPendingSchedule: (id: string) =>
    apiRequest<{ schedule: ScheduleDoc; cancelledCount: number }>(`/api/schedules/${id}/cancel-pending`, {
      method: 'POST',
    }),
  retryScheduleSlot: (scheduleId: string, slotId: string) =>
    apiRequest<{ schedule: ScheduleDoc }>(`/api/schedules/${scheduleId}/slots/${slotId}/retry`, {
      method: 'POST',
    }),
  deleteSchedule: (id: string) =>
    apiRequest<{ ok: boolean }>(`/api/schedules/${id}`, { method: 'DELETE' }),

  // Categories
  listCategories: () => apiRequest<{ categories: CategoryDoc[] }>('/api/categories'),
  createCategory: (payload: {
    name: string;
    description: string;
    keywords: string[];
    senderPatterns: string[];
    aiEnabled: boolean;
  }) =>
    apiRequest<{ category: CategoryDoc }>('/api/categories', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateCategory: (
    id: string,
    patch: Partial<Pick<CategoryDoc, 'name' | 'description' | 'keywords' | 'senderPatterns' | 'aiEnabled'>>
  ) =>
    apiRequest<{ category: CategoryDoc }>(`/api/categories/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  deleteCategory: (id: string) =>
    apiRequest<{ ok: boolean }>(`/api/categories/${id}`, { method: 'DELETE' }),
  recategorize: () =>
    apiRequest<{ updatedCount: number; totalInbox: number }>('/api/categories/recategorize', {
      method: 'POST',
    }),

  // Chats & Agent
  listChats: () => apiRequest<{ chats: ChatSessionDoc[] }>('/api/chats'),
  createChat: (title?: string) =>
    apiRequest<{ chat: ChatSessionDoc }>('/api/chats', {
      method: 'POST',
      body: JSON.stringify({ title }),
    }),
  updateChat: (
    id: string,
    patch: { pinned?: boolean; title?: string; messageId?: string; actionPatch?: Record<string, unknown> }
  ) =>
    apiRequest<{ chat: ChatSessionDoc }>(`/api/chats/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  deleteChat: (id: string) => apiRequest<{ ok: boolean }>(`/api/chats/${id}`, { method: 'DELETE' }),
  executeAgent: (prompt: string, chatId: string | null) =>
    apiRequest<{ chat: ChatSessionDoc; assistantMessage: ChatMessage }>('/api/agent/execute', {
      method: 'POST',
      body: JSON.stringify({ prompt, chatId }),
    }),
};
