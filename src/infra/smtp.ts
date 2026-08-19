import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { env, isSmtpConfigured } from '../config/env';

let transporter: Transporter | null = null;
let initPromise: Promise<Transporter | null> | null = null;
let usingEthereal = false;

export function isUsingEthereal(): boolean {
  return usingEthereal;
}

async function createGmailTransporter(): Promise<Transporter> {
  const pass = env.SMTP_PASS?.replace(/\s/g, '') ?? '';
  const t = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE === 'true',
    auth: {
      user: env.SMTP_USER,
      pass,
    },
  });
  await t.verify();
  return t;
}

async function createEtherealTransporter(): Promise<Transporter> {
  const testAccount = await nodemailer.createTestAccount();
  const t = nodemailer.createTransport({
    host: testAccount.smtp.host,
    port: testAccount.smtp.port,
    secure: testAccount.smtp.secure,
    auth: {
      user: testAccount.user,
      pass: testAccount.pass,
    },
  });
  usingEthereal = true;
  console.log(`[SMTP] Gmail unavailable — using Ethereal test inbox ${testAccount.user}`);
  return t;
}

async function initTransporter(): Promise<Transporter | null> {
  if (isSmtpConfigured()) {
    try {
      const t = await createGmailTransporter();
      usingEthereal = false;
      console.log(`[SMTP] Connected ${env.SMTP_HOST} as ${env.SMTP_USER}`);
      return t;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[SMTP] ${env.SMTP_HOST} login failed: ${message.split('\n')[0]}`);
      if (env.NODE_ENV !== 'development') return null;
    }
  } else if (env.NODE_ENV !== 'development') {
    return null;
  }

  try {
    return await createEtherealTransporter();
  } catch (err) {
    console.error('[SMTP] Ethereal fallback failed:', err);
    return null;
  }
}

export async function getMailTransporter(): Promise<Transporter | null> {
  if (transporter) return transporter;
  if (!initPromise) {
    initPromise = initTransporter().then((t) => {
      transporter = t;
      return t;
    });
  }
  return initPromise;
}
