import type { Transporter } from 'nodemailer';

function getSmtpConfig() {
  return {
    host: process.env.SMTP_HOST,
    port: process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : 587,
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    from: process.env.SMTP_FROM || 'noreply@weeqlash.icu',
  } as const;
}

let transporter: Transporter | null = null;

async function getTransporter(): Promise<Transporter | null> {
  if (transporter) {
    return transporter;
  }
  const cfg = getSmtpConfig();
  console.log('[smtp] initializing transporter for host:', cfg.host);
  if (!cfg.host) {
    console.warn('[auth] SMTP not configured — emails will be logged to console');
    return null;
  }
  const host: string = cfg.host as string;
  const port: number = cfg.port as number;
  const user: string = cfg.user as string;
  const pass: string = cfg.pass as string;
  const nodemailer = await import('nodemailer');
  transporter = nodemailer.createTransport({
    host: host,
    port: port,
    secure: port === 465,
    auth: { user: user, pass: pass },
  });
  return transporter;
}

export async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  const t = await getTransporter();
  const cfg = getSmtpConfig();
  if (!t) {
    console.log(`[auth:email] To: ${to} | Subject: ${subject} | ${html}`);
    return;
  }
  await t.sendMail({ from: cfg.from, to, subject, html });
}
