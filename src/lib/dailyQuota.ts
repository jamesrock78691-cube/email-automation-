/**
 * Daily quota window for operators + SMTP accounts.
 * Resets every day at 07:00 Asia/Karachi (Pakistan Standard Time, UTC+5).
 *
 * Quota-day key is a calendar date string (YYYY-MM-DD) in PKT, where the
 * "day" runs from 07:00 PKT → next day 06:59:59 PKT.
 * Example: 2026-09-04 06:30 PKT still belongs to quota day 2026-09-03.
 */

export const QUOTA_TIMEZONE = "Asia/Karachi";
export const QUOTA_RESET_HOUR_PKT = 7;

function pktParts(date: Date): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
} {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: QUOTA_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const get = (type: string) => {
    const v = parts.find((p) => p.type === type)?.value ?? "0";
    // Intl can return "24" for midnight in some environments
    return Number(v === "24" ? "0" : v);
  };

  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Returns the quota-day key (YYYY-MM-DD) for a given instant.
 * Before 07:00 PKT, the key is the previous PKT calendar day.
 */
export function getQuotaDayKey(now: Date = new Date()): string {
  const p = pktParts(now);
  let y = p.year;
  let m = p.month;
  let d = p.day;

  if (p.hour < QUOTA_RESET_HOUR_PKT) {
    // Step back one calendar day in PKT
    const utcMid = Date.UTC(y, m - 1, d);
    const prev = new Date(utcMid - 24 * 60 * 60 * 1000);
    y = prev.getUTCFullYear();
    m = prev.getUTCMonth() + 1;
    d = prev.getUTCDate();
  }

  return `${y}-${pad2(m)}-${pad2(d)}`;
}

/**
 * True when counters for `lastActivityAt` belong to a previous quota day
 * and must be zeroed for `now`.
 */
export function shouldResetDailyQuota(
  lastActivityAt: Date | string | null | undefined,
  now: Date = new Date()
): boolean {
  if (!lastActivityAt) return true;
  const last =
    lastActivityAt instanceof Date
      ? lastActivityAt
      : new Date(lastActivityAt);
  if (Number.isNaN(last.getTime())) return true;
  return getQuotaDayKey(last) !== getQuotaDayKey(now);
}

/**
 * Next 07:00 PKT after `now` (or today 07:00 PKT if still before it).
 */
export function getNextQuotaResetAt(now: Date = new Date()): Date {
  const p = pktParts(now);
  // Build "today 07:00 PKT" as a UTC instant.
  // PKT = UTC+5 → 07:00 PKT = 02:00 UTC same calendar day.
  let y = p.year;
  let m = p.month;
  let d = p.day;

  if (p.hour >= QUOTA_RESET_HOUR_PKT) {
    const utcMid = Date.UTC(y, m - 1, d);
    const next = new Date(utcMid + 24 * 60 * 60 * 1000);
    y = next.getUTCFullYear();
    m = next.getUTCMonth() + 1;
    d = next.getUTCDate();
  }

  // 07:00 PKT = 02:00 UTC
  return new Date(Date.UTC(y, m - 1, d, QUOTA_RESET_HOUR_PKT - 5, 0, 0, 0));
}

export function formatQuotaResetLabel(now: Date = new Date()): string {
  const next = getNextQuotaResetAt(now);
  return new Intl.DateTimeFormat("en-PK", {
    timeZone: QUOTA_TIMEZONE,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(next) + " PKT";
}
