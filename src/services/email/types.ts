export type EmailType = string;

export interface SendEmailOptions {
  to: string | string[];
  subject: string;
  html: string;
  from?: string;
  fromName?: string;
  cc?: string | string[];
  bcc?: string | string[];
  replyTo?: string;
}

export interface EmailLogOptions {
  emailType?: EmailType;
  templateName?: string;
  userId?: string;
  metadata?: Record<string, unknown>;
}

export interface EmailResult {
  success: boolean;
  message?: string;
  error?: string;
  logId?: string;
}
