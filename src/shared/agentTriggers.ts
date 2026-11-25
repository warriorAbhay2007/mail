export interface SlashCommandDef {
  command: string;
  label: string;
  description: string;
  template: string;
}

export const SLASH_COMMANDS: SlashCommandDef[] = [
  {
    command: '/schedule',
    label: 'Schedule Email',
    description: 'Parse natural language into UTC slots Schedule(start, freq, gap)',
    template: '/schedule Send update to @alex@acme.dev 3 times every 2 hours starting tomorrow 09:00',
  },
  {
    command: '/draft',
    label: 'Draft Email',
    description: 'Compose a tailored email draft with interactive Send/Schedule preview',
    template: '/draft Follow up with @sarah@northstar.io about Q4 launch timeline',
  },
  {
    command: '/categorize',
    label: 'Categorize Inbox',
    description: 'Run fast OTP detection and custom category classification',
    template: '/categorize Scan inbox and tag uncategorized messages',
  },
  {
    command: '/otp',
    label: 'Latest Active OTP',
    description: 'Surface the latest unconsumed OTP code with a 1-click copy card',
    template: '/otp Show my latest active verification code',
  },
  {
    command: '/digest',
    label: 'Morning Digest',
    description: 'Brief Needs Reply, Deadlines & Dates, and Noise / Low Priority mails',
    template: '/digest Summarize unread inbox priorities and deadlines',
  },
  {
    command: '/cleanup',
    label: 'Cleanup OTP Mails',
    description: 'Preview @category:OTP messages ready for safe bulk deletion',
    template: '/cleanup @category:OTP',
  },
];

export interface TriggerParseResult {
  hasSlash: boolean;
  hasMention: boolean;
  isValid: boolean;
  commands: string[];
  mentions: string[];
  recipientMentions: string[];
  categoryMentions: string[];
  mailMentions: string[];
}

const SLASH_RE = /(?:^|\s)(\/[a-z][a-z0-9-]*)/gi;
const MENTION_RE = /(?:^|\s)(@[a-zA-Z0-9._:@+-]+)/g;

export function parseAgentTriggers(prompt: string): TriggerParseResult {
  const commands: string[] = [];
  const mentions: string[] = [];
  const recipientMentions: string[] = [];
  const categoryMentions: string[] = [];
  const mailMentions: string[] = [];

  for (const match of prompt.matchAll(SLASH_RE)) {
    const cmd = match[1].toLowerCase();
    if (!commands.includes(cmd)) commands.push(cmd);
  }

  for (const match of prompt.matchAll(MENTION_RE)) {
    const raw = match[1];
    if (!mentions.includes(raw)) mentions.push(raw);

    const body = raw.slice(1);
    if (body.toLowerCase().startsWith('category:')) {
      categoryMentions.push(body.slice('category:'.length));
    } else if (body.toLowerCase().startsWith('mail:')) {
      mailMentions.push(body.slice('mail:'.length));
    } else if (body.toLowerCase().startsWith('recipient:')) {
      recipientMentions.push(body.slice('recipient:'.length));
    } else if (body.includes('@')) {
      recipientMentions.push(body);
    } else if (body.includes('.')) {
      // Handle @alex@acme.dev vs @alex
      recipientMentions.push(body);
    }
  }

  const hasSlash = commands.length > 0;
  const hasMention = mentions.length > 0;

  return {
    hasSlash,
    hasMention,
    isValid: hasSlash || hasMention,
    commands,
    mentions,
    recipientMentions,
    categoryMentions,
    mailMentions,
  };
}

export function hasValidTrigger(prompt: string): boolean {
  return parseAgentTriggers(prompt).isValid;
}

export interface AutocompleteContext {
  triggerType: '/' | '@' | null;
  query: string;
  startIndex: number;
  endIndex: number;
}

export function extractAutocompleteContext(text: string, cursorPos: number): AutocompleteContext {
  const safePos = Math.max(0, Math.min(cursorPos, text.length));
  const beforeCursor = text.slice(0, safePos);

  // Match active token at cursor starting with / or @ preceded by start or whitespace
  const tokenMatch = /(?:^|\s)([/@][^\s]*)$/.exec(beforeCursor);
  if (!tokenMatch) {
    return { triggerType: null, query: '', startIndex: -1, endIndex: -1 };
  }

  const token = tokenMatch[1];
  const triggerType = token[0] as '/' | '@';
  const startIndex = beforeCursor.length - token.length;

  return {
    triggerType,
    query: token.slice(1),
    startIndex,
    endIndex: safePos,
  };
}
