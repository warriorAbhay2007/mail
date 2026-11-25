export type WorkspaceView = 'new-tab' | 'mail' | 'digest' | 'schedule' | 'category';

export type ScheduleMode = 'basic' | 'advanced';
export type GapUnit = 'minutes' | 'hours' | 'days';
export type SlotStatus =
  | 'pending'
  | 'processing'
  | 'sent'
  | 'failed'
  | 'cancelled'
  | 'cancelled_replied';

export interface UserDoc {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  passwordSalt: string;
  authProvider: 'local' | 'supabase' | 'demo';
  createdAt: string;
}

export interface PublicUser {
  id: string;
  email: string;
  name: string;
  authProvider: 'local' | 'supabase' | 'demo';
}

export type SuggestedActionType = 'reply_draft' | 'schedule_followup' | 'copy_otp';
export type QuickReplyTone = 'Professional' | 'Concise' | 'Friendly';

export interface SuggestedAction {
  id: string;
  type: SuggestedActionType;
  label: string;
  confidence: number;
  suggestedSubject?: string;
  suggestedBody?: string;
  targetDatetime?: string;
  extractedDateLabel?: string;
  otpCode?: string;
  otpVaultId?: string;
  serviceName?: string;
}

export interface MailDoc {
  id: string;
  userId: string;
  threadId: string;
  inReplyTo?: string;
  folder: 'inbox' | 'sent' | 'drafts' | 'archive';
  fromName: string;
  fromEmail: string;
  to: string[];
  subject: string;
  snippet: string;
  textBody: string;
  htmlBody?: string;
  receivedAt: string;
  isRead: boolean;
  isStarred: boolean;
  category: string;
  otpCode?: string;
  categorizedBy: 'otp-rule' | 'custom-rule' | 'ai' | 'default';
  suggestedActions?: SuggestedAction[];
}

export interface ScheduleSlot {
  id: string;
  runIndex: number;
  runAtUtc: string;
  recipient: string;
  status: SlotStatus;
  sentAtUtc?: string;
  cancelledAt?: string;
  replyMailId?: string;
  error?: string;
}

export interface ScheduleRuleInput {
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
}

export interface ScheduleDoc {
  id: string;
  userId: string;
  mode: ScheduleMode;
  startUtc: string;
  freq: number;
  gapValue: number;
  gapUnit: GapUnit;
  recipients: string[];
  subject: string;
  body: string;
  stopOnReply: boolean;
  threadId?: string;
  status: 'active' | 'completed' | 'cancelled';
  cancelledReason?: string;
  slots: ScheduleSlot[];
  createdAt: string;
  updatedAt: string;
}

export interface CategoryDoc {
  id: string;
  userId: string;
  name: string;
  description: string;
  keywords: string[];
  senderPatterns: string[];
  isSystem: boolean;
  aiEnabled: boolean;
  createdAt: string;
}

export interface OtpVaultDoc {
  id: string;
  userId: string;
  mailId: string;
  serviceName: string;
  otpCode: string;
  expiresAt: string;
  isUsed: boolean;
  usedAt?: string;
  createdAt: string;
}

export type DigestFilterScope = 'unread' | 'today' | 'all';

export interface DigestItem {
  mailId: string;
  fromName: string;
  fromEmail: string;
  subject: string;
  snippet: string;
  category: string;
  receivedAt: string;
  isRead: boolean;
  bucket: 'needs_reply' | 'deadlines' | 'noise';
  reason: string;
  extractedDateLabel?: string;
  suggestedStartUtc?: string;
}

export interface DigestBriefing {
  scope: DigestFilterScope;
  category?: string;
  generatedAt: string;
  totalAnalyzed: number;
  summary: string;
  needsReply: DigestItem[];
  deadlines: DigestItem[];
  noise: DigestItem[];
}

export type AgentActionPreview =
  | {
      type: 'schedule_preview';
      rule: ScheduleRuleInput;
      timestampsUtc: string[];
      confirmed?: boolean;
      createdScheduleId?: string;
    }
  | {
      type: 'draft_preview';
      to: string[];
      subject: string;
      body: string;
      status?: 'pending' | 'sent' | 'saved_draft';
    }
  | {
      type: 'otp_surface_card';
      vaultId: string;
      serviceName: string;
      otpCode: string;
      expiresAt: string;
      isUsed: boolean;
    }
  | {
      type: 'otp_cleanup_preview';
      count: number;
      items: Array<{
        id: string;
        fromName: string;
        fromEmail: string;
        subject: string;
        otpCode?: string;
        receivedAt: string;
      }>;
      cleaned?: boolean;
    }
  | {
      type: 'categorize_summary';
      processedCount: number;
      otpDetectedCount: number;
      changes: Array<{
        mailId: string;
        subject: string;
        category: string;
        method: string;
      }>;
    }
  | {
      type: 'digest_briefing';
      digest: DigestBriefing;
    };

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  requiresTriggerHint?: boolean;
  actionPreview?: AgentActionPreview;
}

export interface ChatSessionDoc {
  id: string;
  userId: string;
  title: string;
  pinned: boolean;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
}
