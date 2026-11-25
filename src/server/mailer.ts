import nodemailer from 'nodemailer';
import { loadDb, newId, saveDb } from './store';
import { MailDoc } from '../shared/types';

export interface SendMailPayload {
  userId: string;
  fromName: string;
  fromEmail: string;
  to: string[];
  subject: string;
  textBody: string;
  htmlBody?: string;
  threadId?: string;
  inReplyTo?: string;
}

export interface SendMailResult {
  transport: 'smtp' | 'local-outbox';
  messageId: string;
  mail: MailDoc;
}

export async function dispatchEmail(payload: SendMailPayload): Promise<SendMailResult> {
  const smtpHost = process.env.SMTP_HOST?.trim();
  const smtpUser = process.env.SMTP_USER?.trim();
  const smtpPass = process.env.SMTP_PASS?.trim();
  const smtpPort = Number(process.env.SMTP_PORT || '587');
  const smtpFrom = process.env.SMTP_FROM?.trim() || payload.fromEmail;

  let transportType: 'smtp' | 'local-outbox' = 'local-outbox';
  let messageId = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@meridian.local`;

  if (smtpHost && smtpUser && smtpPass) {
    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: Number.isFinite(smtpPort) ? smtpPort : 587,
      secure: smtpPort === 465,
      auth: {
        user: smtpUser,
        pass: smtpPass,
      },
    });

    const info = await transporter.sendMail({
      from: `"${payload.fromName}" <${smtpFrom}>`,
      to: payload.to.join(', '),
      subject: payload.subject,
      text: payload.textBody,
      html: payload.htmlBody,
    });
    transportType = 'smtp';
    messageId = info.messageId || messageId;
  }

  const db = loadDb();
  const now = new Date().toISOString();
  const mail: MailDoc = {
    id: newId('mail'),
    userId: payload.userId,
    threadId: payload.threadId || newId('th'),
    inReplyTo: payload.inReplyTo,
    folder: 'sent',
    fromName: payload.fromName,
    fromEmail: payload.fromEmail,
    to: payload.to,
    subject: payload.subject,
    snippet: payload.textBody.replace(/\s+/g, ' ').trim().slice(0, 140),
    textBody: payload.textBody,
    htmlBody: payload.htmlBody,
    receivedAt: now,
    isRead: true,
    isStarred: false,
    category: 'General',
    categorizedBy: 'default',
  };

  db.mails.unshift(mail);
  await saveDb();

  return {
    transport: transportType,
    messageId,
    mail,
  };
}
