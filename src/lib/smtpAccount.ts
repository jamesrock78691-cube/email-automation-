import nodemailer from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";

export function smtpLoginUser(account: {
  smtpUsername?: string | null;
  email?: string | null;
}): string {
  return String(account?.smtpUsername || account?.email || "").trim();
}

export function smtpFromAddress(account: {
  fromEmail?: string | null;
  email?: string | null;
}): string {
  const from = String(account?.fromEmail || "").trim();
  const email = String(account?.email || "").trim();
  const isBrevoLogin = (v: string) => /@smtp-brevo\.com$/i.test(v);
  if (from && !isBrevoLogin(from)) return from;
  if (email && !isBrevoLogin(email)) return email;
  return from || email;
}

export function smtpPortSecure(account: {
  smtpPort?: number | null;
  secure?: boolean | null;
}) {
  const port = Number(account?.smtpPort) || 587;
  const secure = port === 465;
  return {
    port,
    secure,
    requireTLS: !secure && (port === 587 || port === 2525),
  };
}

export function createSmtpTransport(account: {
  smtpHost?: string | null;
  smtpPort?: number | null;
  secure?: boolean | null;
  smtpUsername?: string | null;
  email?: string | null;
  appPassword?: string | null;
}) {
  const { port, secure, requireTLS } = smtpPortSecure(account);

  const options: SMTPTransport.Options = {
    host: account.smtpHost || "smtp-relay.brevo.com",
    port,
    secure,
    requireTLS,
    auth: {
      user: smtpLoginUser(account),
      pass: String(account.appPassword || ""),
    },
    connectionTimeout: 25000,
    greetingTimeout: 25000,
    socketTimeout: 25000,
    tls: { rejectUnauthorized: false },
  };

  return nodemailer.createTransport(options);
}
