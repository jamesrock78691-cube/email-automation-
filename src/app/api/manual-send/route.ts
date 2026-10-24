import { NextRequest, NextResponse } from "next/server";
import { toSendableEmailHtml } from "@/lib/quillToEmailHtml";
import { db } from "@/db";
import { gmailAccounts, settings } from "@/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { appendManualSentLog } from "@/app/services/googleSheets";
import { randomUUID } from "crypto";
import { shouldResetDailyQuota } from "@/lib/dailyQuota";
import {
  buildTrackingPixelHtml,
  getAppBaseUrl,
  injectTrackingPixel,
} from "@/lib/trackingPixel";
import { smtpFromAddress, createSmtpTransport } from "@/lib/smtpAccount";
import {
  workspaceFromRequest,
  workspaceSql,
  settingKey,
  MAIN_WORKSPACE,
} from "@/lib/workspace";

/** America/Los_Angeles (PST/PDT) calendar day + month keys */
function pstKeys(d = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value || "00";
  const y = get("year");
  const m = get("month");
  const day = get("day");
  return { dayKey: `${y}-${m}-${day}`, monthKey: `${y}-${m}` };
}

async function bumpAgentStats(
  ws: string,
  userId: number | string | null | undefined,
  username: string
) {
  try {
    if (!userId && !username) return;
    const key = String(userId || username);
    const mapKey = settingKey("agent_stats", ws || MAIN_WORKSPACE);
    const rows = await db
      .select()
      .from(settings)
      .where(eq(settings.key, mapKey))
      .limit(1);
    const map = rows.length ? JSON.parse(rows[0].value || "{}") : {};
    const { dayKey, monthKey } = pstKeys();
    const cur = map[key] || {
      totalSent: 0,
      sentToday: 0,
      sentMonth: 0,
      dailyLimit: 100,
      lastDate: dayKey,
      lastMonth: monthKey,
      username: username || "",
    };
    if (cur.lastDate !== dayKey) {
      cur.sentToday = 0;
      cur.lastDate = dayKey;
    }
    if (cur.lastMonth !== monthKey) {
      cur.sentMonth = 0;
      cur.lastMonth = monthKey;
    }
    cur.totalSent = (cur.totalSent || 0) + 1;
    cur.sentToday = (cur.sentToday || 0) + 1;
    cur.sentMonth = (cur.sentMonth || 0) + 1;
    if (username) cur.username = username;
    map[key] = cur;
    const str = JSON.stringify(map);
    if (rows.length) {
      await db.update(settings).set({ value: str }).where(eq(settings.key, mapKey));
    } else {
      await db.insert(settings).values({ key: mapKey, value: str });
    }
  } catch (e) {
    console.error("bumpAgentStats failed:", e);
  }
}

function isHealthy(acc: any, now: Date, unlimited = false) {
  if (String(acc.status || "").toLowerCase() === "disabled") return false;
  if (unlimited) return true; // admin/main: no daily, minute, or cooldown limits on manual
  if (acc.cooldownUntil && new Date(acc.cooldownUntil) > now) return false;
  if ((acc.sentToday || 0) >= (acc.dailyLimit || 500)) return false;
  if ((acc.sentThisMinute || 0) >= (acc.minuteLimit || 50)) return false;
  return true;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      to,
      subject,
      html,
      cc,
      bcc,
      fromName,
      fromEmail,
      replyTo,
      referenceNo,
      serialNo,
      markName,
      filingDate,
      templateName,
      sentByUsername,
      sentByUserId,
      smtpAccountId,
    } = body;

    const emailHtml = toSendableEmailHtml(String(html || ""));
    const ws = workspaceFromRequest(request);
    // Admin / main workspace: unlimited manual sending (no SMTP daily/minute/cooldown blocks)
    const unlimitedManual =
      String(ws || "").toLowerCase() === "main" ||
      String(ws || "").toLowerCase() === "admin";

    if (!to || !subject || !html) {
      return NextResponse.json(
        { success: false, error: "To, Subject and Message are required" },
        { status: 400 }
      );
    }

    const allAccounts = await db
      .select()
      .from(gmailAccounts)
      .where(workspaceSql(gmailAccounts.workspace, ws))
      .orderBy(desc(gmailAccounts.priority));
    // Prefer enabled for auto-rotate; selected id is filtered separately
    const enabledAccounts = allAccounts.filter(
      (a) => String(a.status || "").toLowerCase() !== "disabled"
    );

    const now = new Date();
    for (const acc of allAccounts) {
      if (shouldResetDailyQuota(acc.lastUsedAt)) {
        await db
          .update(gmailAccounts)
          .set({ sentToday: 0, sentThisMinute: 0 })
          .where(eq(gmailAccounts.id, acc.id));
        acc.sentToday = 0;
        acc.sentThisMinute = 0;
      }
    }

    const preferredId = smtpAccountId ? Number(smtpAccountId) : 0;
    let tryList: any[] = [];

    // Compose: if user selected an SMTP, ONLY use that account (no silent fallback)
    if (preferredId && Number.isFinite(preferredId) && preferredId > 0) {
      const pref = allAccounts.find((a) => Number(a.id) === preferredId);
      if (!pref) {
        return NextResponse.json(
          {
            success: false,
            error:
              "Selected SMTP account not found in this workspace (id=" +
              preferredId +
              "). Pick another account.",
          },
          { status: 400 }
        );
      }
      if (String(pref.status || "").toLowerCase() === "disabled") {
        return NextResponse.json(
          {
            success: false,
            error:
              "Selected SMTP is disabled: " +
              (pref.email || preferredId) +
              ". Enable it or choose another.",
          },
          { status: 400 }
        );
      }
      tryList = [pref];
    } else {
      const ordered: any[] = [...enabledAccounts];
      const candidates = ordered.filter((a) =>
        isHealthy(a, now, unlimitedManual)
      );
      tryList = candidates.length ? candidates : ordered;
    }

    if (!tryList.length) {
      return NextResponse.json(
        {
          success: false,
          error:
            "No available SMTP account in this workspace (all disabled, cooldown, or daily limit reached).",
        },
        { status: 400 }
      );
    }

    const trackingId = randomUUID();
    const pixelBase = getAppBaseUrl(request);
    const pixel = buildTrackingPixelHtml(pixelBase, trackingId, to);
    const htmlWithPixel = injectTrackingPixel(emailHtml, pixel);

    let account: any = null;
    let lastError: any = null;
    const tried: string[] = [];

    for (const acc of tryList) {
      tried.push(acc.email || String(acc.id));
      try {
        const transporter = createSmtpTransport(acc);
        // When user picked a specific SMTP, always send as that account (not a stale From field)
        const displayFrom =
          preferredId > 0
            ? smtpFromAddress(acc) || acc.email
            : fromEmail || smtpFromAddress(acc) || acc.email;
        const displayName =
          preferredId > 0
            ? fromName || acc.senderName || acc.email
            : fromName || acc.senderName || acc.email;
        await transporter.sendMail({
          from: `"${displayName}" <${displayFrom}>`,
          replyTo: replyTo || acc.replyToEmail || displayFrom,
          to,
          cc: cc || undefined,
          bcc: bcc || undefined,
          subject,
          html: htmlWithPixel,
        });
        account = acc;
        lastError = null;
        break;
      } catch (err: any) {
        lastError = err;
        console.error(
          `[MANUAL SEND] SMTP fail ws=${ws} account=${acc.email}:`,
          err?.message || err
        );
        try {
          const cool = new Date();
          cool.setMinutes(cool.getMinutes() + 2);
          await db
            .update(gmailAccounts)
            .set({
              cooldownUntil: cool,
              errorCount: (acc.errorCount || 0) + 1,
              lastUsedAt: new Date(),
            })
            .where(eq(gmailAccounts.id, acc.id));
        } catch {}
      }
    }

    if (!account) {
      return NextResponse.json(
        {
          success: false,
          error:
            lastError?.message ||
            "All SMTP accounts failed. Tried: " + tried.join(", "),
          tried,
        },
        { status: 500 }
      );
    }

    const cooldownUntil = new Date();
    // main/admin: no cooldown after manual send
    if (!unlimitedManual) {
      cooldownUntil.setSeconds(cooldownUntil.getSeconds() + 15);
    }

    await db
      .update(gmailAccounts)
      .set({
        sentToday: (account.sentToday || 0) + 1,
        sentThisMinute: (account.sentThisMinute || 0) + 1,
        lastUsedAt: new Date(),
        cooldownUntil: unlimitedManual ? null : cooldownUntil,
        errorCount: 0,
      })
      .where(eq(gmailAccounts.id, account.id));

    await bumpAgentStats(ws, sentByUserId, sentByUsername || "");

    try {
      const mapKey = settingKey("manual_track_map", ws);
      const mapRows = await db
        .select()
        .from(settings)
        .where(eq(settings.key, mapKey))
        .limit(1);
      const map = mapRows.length ? JSON.parse(mapRows[0].value || "{}") : {};
      map[trackingId] = {
        email: to,
        subject: subject || "",
        markName: markName || "Manual Send",
        referenceNo: referenceNo || "MANUAL",
        sentAt: new Date().toISOString(),
        sentBy: sentByUsername || "",
        workspace: ws,
      };
      const keys = Object.keys(map);
      if (keys.length > 500) {
        for (const k of keys.slice(0, keys.length - 500)) delete map[k];
      }
      if (mapRows.length) {
        await db
          .update(settings)
          .set({ value: JSON.stringify(map) })
          .where(eq(settings.key, mapKey));
      } else {
        await db.insert(settings).values({
          key: mapKey,
          value: JSON.stringify(map),
        });
      }
    } catch (mapErr) {
      console.error("manual_track_map save failed:", mapErr);
    }

    try {
      await appendManualSentLog({
        referenceNo: referenceNo || "",
        serialNo: serialNo || "",
        markName: markName || "",
        filingDate: filingDate || "",
        email: to,
        cc: cc || "",
        bcc: bcc || "",
        subject,
        templateName: templateName || "",
        status: "Sent",
        sentAt: new Date().toISOString(),
        gmailUsed: account.email,
        sentBy: sentByUsername || "",
        sentById: sentByUserId || "",
        trackingId,
      });
    } catch (logErr) {
      console.error("Manual log sheet write failed (email still sent):", logErr);
    }

    return NextResponse.json({
      success: true,
      message: "Email sent successfully",
      usedAccount: account.email,
      selectedSmtpId: preferredId || null,
      trackingId,
      workspace: ws,
      tried,
      htmlLength: htmlWithPixel.length,
      unlimitedManual,
    });
  } catch (error: any) {
    console.error("Manual send error:", error);
    return NextResponse.json(
      { success: false, error: error.message || "Failed to send email" },
      { status: 500 }
    );
  }
}
