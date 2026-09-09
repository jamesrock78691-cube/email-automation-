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
