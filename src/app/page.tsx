"use client";

import React, { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import {
  Mail,
  RefreshCw,
  Cpu,
  Users,
  CheckCircle,
  AlertTriangle,
  Send,
  FileText,
  LogOut,
  Eye,
  Layers,
  Database,
  Settings,
  Play,
  FileSpreadsheet,
} from "lucide-react";

const RichTextComposer = dynamic(
  () => import("../components/RichTextComposer"),
  { ssr: false }
);

type AuthUser = {
  id: number;
  username: string;
  role: string;
  permissions?: string[];
  stats?: { totalSent: number; sentToday: number; dailyLimit: number };
};

const OPERATOR_DEFAULTS = ["compose", "templates"];
const ALL_PERMS = [
  "compose", "dashboard", "sheets", "gmail", "templates", "campaigns",
  "admin_panel", "smtp_view", "smtp_add", "smtp_delete", "manage_users",
];

export default function EmailAutomationDashboard() {
  const [activeTab, setActiveTab] = useState("compose");
  const [errorMsg, setErrorMsg] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [authChecked, setAuthChecked] = useState(false);
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authToken, setAuthToken] = useState("");
  const [loginForm, setLoginForm] = useState({ username: "", password: "" });
  const [loginLoading, setLoginLoading] = useState(false);
  const [stats, setStats] = useState<any>({
    totalEmails: 0, sent: 0, pending: 0, failed: 0, opened: 0,
    uniqueOpens: 0, openRate: 0, scope: "global",
    activeGmailCount: 0, totalGmailCount: 0, templatesCount: 0, campaignsCount: 0,
  });
  const [queueItems, setQueueItems] = useState<any[]>([]);
  const [recentOpens, setRecentOpens] = useState<any[]>([]);
  const [adminUsers, setAdminUsers] = useState<any[]>([]);
  const [templates, setTemplates] = useState<any[]>([]);
  const [gmailAccounts, setGmailAccounts] = useState<any[]>([]);
  const [composeHtml, setComposeHtml] = useState("");
  const [composeSubject, setComposeSubject] = useState("");
  const [composeTo, setComposeTo] = useState("");
  const [composeFromName, setComposeFromName] = useState("");
  const [sending, setSending] = useState(false);
  const [loadingData, setLoadingData] = useState(false);
  const [htmlOn, setHtmlOn] = useState(true);

  const effectivePerms = (): string[] => {
    if (!authUser) return [];
    if (authUser.role === "super_admin" || authUser.username === "admin" || authUser.username === "superadmin")
      return [...ALL_PERMS];
    const p = authUser.permissions;
    if (Array.isArray(p) && p.length > 0) return p;
    if (authUser.role === "admin")
      return ["compose", "dashboard", "sheets", "gmail", "templates", "campaigns", "admin_panel", "smtp_add", "manage_users"];
    return OPERATOR_DEFAULTS;
  };

  const can = (perm: string) => {
    if (!authUser) return false;
    if (authUser.role === "super_admin" || authUser.username === "admin" || authUser.username === "superadmin") return true;
    return effectivePerms().includes(perm);
  };

  const isSuperAdmin = () =>
    !!authUser && (authUser.role === "super_admin" || authUser.username === "admin" || authUser.username === "superadmin");

  const authHeaders = (): Record<string, string> => {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    const token = authToken || (typeof window !== "undefined" ? localStorage.getItem("ea_token") || "" : "");
    if (token) h["Authorization"] = `Bearer ${token}`;
    return h;
  };

  const showError = (m: string) => { setErrorMsg(m); setTimeout(() => setErrorMsg(""), 6000); };
  const showSuccess = (m: string) => { setSuccessMsg(m); setTimeout(() => setSuccessMsg(""), 4000); };

  useEffect(() => {
    (async () => {
      try {
        const saved = typeof window !== "undefined" ? localStorage.getItem("ea_token") : null;
        if (!saved) { setAuthChecked(true); return; }
        setAuthToken(saved);
        const res = await fetch("/api/auth?action=me", {
          headers: { Authorization: `Bearer ${saved}` },
          credentials: "include",
        });
        const data = await res.json();
        if (data.success && data.user) setAuthUser(data.user);
        else localStorage.removeItem("ea_token");
      } catch { /* ignore */ }
      finally { setAuthChecked(true); }
    })();
  }, []);

  useEffect(() => {
    if (!authUser) return;
    const perms = effectivePerms();
    const order = [
      { perm: "compose", tab: "compose" },
      { perm: "dashboard", tab: "dashboard" },
      { perm: "templates", tab: "templates" },
      { perm: "sheets", tab: "sheets_importer" },
      { perm: "gmail", tab: "gmail_accounts" },
      { perm: "campaigns", tab: "campaigns_tab" },
      { perm: "admin_panel", tab: "admin" },
    ];
    const first = order.find((o) => perms.includes(o.perm));
    setActiveTab(first ? first.tab : "compose");
    loadDashboardData();
    loadTemplates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authUser]);

  const loadDashboardData = async () => {
    setLoadingData(true);
    try {
      const res = await fetch("/api/dashboard", { headers: authHeaders(), credentials: "include" });
      const data = await res.json();
      if (data.success) {
        setStats(data.stats || {});
        setQueueItems(data.recentQueue || data.queue || []);
        setRecentOpens(data.recentOpens || []);
        if (data.gmailAccounts) setGmailAccounts(data.gmailAccounts);
      }
    } catch (e) { console.error(e); }
    finally { setLoadingData(false); }
  };

  const loadTemplates = async () => {
    try {
      const res = await fetch("/api/template", { headers: authHeaders(), credentials: "include" });
      const data = await res.json();
      if (data.success) setTemplates(data.list || data.templates || []);
    } catch (e) { console.error(e); }
  };

  const loadAdminUsers = async () => {
    try {
      const res = await fetch("/api/auth?action=list_users", { headers: authHeaders(), credentials: "include" });
      const data = await res.json();
      if (data.success) setAdminUsers(data.list || data.users || []);
    } catch (e) { console.error(e); }
  };

  useEffect(() => {
    if (activeTab === "admin" && authUser) loadAdminUsers();
    if (activeTab === "gmail_accounts" && authUser) loadDashboardData();
    if (activeTab === "templates" && authUser) loadTemplates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, authUser]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginLoading(true);
    setErrorMsg("");
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ action: "login", username: loginForm.username.trim(), password: loginForm.password }),
      });
      const data = await res.json();
      if (data.success && data.user) {
        if (data.token) { localStorage.setItem("ea_token", data.token); setAuthToken(data.token); }
        setAuthUser(data.user);
        showSuccess(`Welcome, ${data.user.username}`);
      } else showError(data.error || "Login failed");
    } catch (err: any) { showError(err.message || "Login error"); }
    finally { setLoginLoading(false); }
  };

  const handleLogout = () => {
    localStorage.removeItem("ea_token");
    setAuthToken("");
    setAuthUser(null);
    setActiveTab("compose");
    fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ action: "logout" }),
    }).catch(() => {});
  };

  const handleManualSend = async () => {
    if (!composeTo.trim() || !composeSubject.trim()) { showError("To and Subject required"); return; }
    setSending(true);
    try {
      const res = await fetch("/api/manual-send", {
        method: "POST",
        headers: authHeaders(),
        credentials: "include",
        body: JSON.stringify({
          to: composeTo.trim(),
          subject: composeSubject.trim(),
          html: composeHtml || "<p></p>",
          fromName: composeFromName || undefined,
        }),
      });
      const data = await res.json();
      if (data.success) {
        showSuccess("Email sent / queued");
        setComposeTo("");
        setComposeSubject("");
        loadDashboardData();
      } else showError(data.error || "Send failed");
    } catch (err: any) { showError(err.message || "Send error"); }
    finally { setSending(false); }
  };

  if (!authChecked) {
    return (
      <div className="min-h-screen bg-[#0b1220] text-white flex items-center justify-center">
        Loading...
      </div>
    );
  }

  if (!authUser) {
    return (
      <div className="min-h-screen bg-[#0b1220] text-white flex items-center justify-center p-4">
        <form onSubmit={handleLogin} className="w-full max-w-md bg-[#111827] border border-slate-800 rounded-2xl p-8 space-y-4 shadow-xl">
          <div className="flex items-center gap-3 mb-2">
            <div className="h-11 w-11 rounded-xl bg-blue-600 flex items-center justify-center">
              <Mail className="h-6 w-6 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight">EMAIL AUTOMATION</h1>
              <p className="text-xs text-slate-400">DASHBOARD</p>
            </div>
          </div>
          {errorMsg && <p className="text-rose-400 text-sm">{errorMsg}</p>}
          {successMsg && <p className="text-emerald-400 text-sm">{successMsg}</p>}
          <input className="w-full bg-[#0b1220] border border-slate-700 rounded-lg px-3 py-2.5 text-sm" placeholder="Username" value={loginForm.username} onChange={(e) => setLoginForm({ ...loginForm, username: e.target.value })} required autoComplete="username" />
          <input type="password" className="w-full bg-[#0b1220] border border-slate-700 rounded-lg px-3 py-2.5 text-sm" placeholder="Password" value={loginForm.password} onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })} required autoComplete="current-password" />
          <button type="submit" disabled={loginLoading} className="w-full bg-blue-600 hover:bg-blue-500 rounded-lg py-2.5 font-medium text-sm disabled:opacity-50">
            {loginLoading ? "Signing in..." : "Login"}
          </button>
        </form>
      </div>
    );
  }

  const dailyLimit = authUser.stats?.dailyLimit || 100;
  const sentToday = authUser.stats?.sentToday || 0;
  const remaining = Math.max(0, dailyLimit - sentToday);
  const progressPct = dailyLimit > 0 ? Math.min(100, (sentToday / dailyLimit) * 100) : 0;

  const tabBtn = (id: string, label: string, icon: React.ReactNode, show: boolean) => {
    if (!show) return null;
    const active = activeTab === id;
    return (
      <button
        key={id}
        onClick={() => setActiveTab(id)}
        className={`px-3 py-2 rounded-lg text-sm font-medium flex items-center gap-1.5 transition ${
          active ? "bg-blue-600 text-white shadow-lg shadow-blue-600/20" : "text-slate-400 hover:text-white hover:bg-slate-800/80"
        }`}
      >
        {icon}
        {label}
      </button>
    );
  };

  return (
    <div className="min-h-screen bg-[#0b1220] text-slate-100">
      <header className="border-b border-slate-800/80 px-4 py-3">
        <div className="max-w-[1400px] mx-auto flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-blue-600 flex items-center justify-center shadow-lg shadow-blue-600/30">
              <Mail className="h-5 w-5 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-base font-bold tracking-tight leading-tight">
                  EMAIL AUTOMATION
                  <br />
                  <span className="text-lg">DASHBOARD</span>
                </h1>
                <span className="text-[10px] bg-blue-500/10 text-blue-400 font-semibold px-2 py-0.5 rounded border border-blue-500/20">
                  V1 Hum Production
                </span>
              </div>
              <p className="text-[10px] text-slate-500 mt-0.5 hidden sm:block">
                Node.js • Express • PostgreSQL • Google Sheets API • Nodemailer • Gmail Rotation • Open Tracking
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={loadDashboardData}
              disabled={loadingData}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800/80 border border-slate-700 text-sm hover:bg-slate-700"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loadingData ? "animate-spin" : ""}`} />
              Sync Dashboard
            </button>
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-sm">
              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-emerald-400 font-medium">SMTP Engine</span>
              <span className="text-emerald-300/80">Active</span>
            </div>
            {authUser.stats && (
              <div className="flex items-center gap-3 px-3 py-1.5 rounded-lg bg-slate-800/50 border border-slate-700 text-xs">
                <span className="text-slate-400">Limit <strong className="text-white">{dailyLimit}</strong></span>
                <span className="text-slate-600">|</span>
                <span className="text-slate-400">Sent <strong className="text-white">{sentToday}</strong></span>
                <span className="text-slate-600">|</span>
                <span className="text-slate-400">Left <strong className="text-emerald-400">{remaining}</strong></span>
              </div>
            )}
            <div className="text-right text-xs">
              <div className="font-medium text-white">{authUser.username}</div>
              <div className="text-blue-400 uppercase tracking-wide text-[10px]">
                {isSuperAdmin() ? "SUPER ADMIN" : authUser.role === "admin" ? "ADMIN" : "OPERATOR"}
              </div>
            </div>
            <button onClick={handleLogout} className="px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-sm hover:bg-slate-700">
              Logout
            </button>
          </div>
        </div>
      </header>

      {errorMsg && (
        <div className="mx-4 mt-3 p-2 bg-rose-500/10 border border-rose-500/30 text-rose-300 text-sm rounded-lg flex items-center gap-2 max-w-[1400px] mx-auto">
          <AlertTriangle className="h-4 w-4 shrink-0" /> {errorMsg}
        </div>
      )}
      {successMsg && (
        <div className="mx-4 mt-3 p-2 bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-sm rounded-lg flex items-center gap-2 max-w-[1400px] mx-auto">
          <CheckCircle className="h-4 w-4 shrink-0" /> {successMsg}
        </div>
      )}

      {(isSuperAdmin() || authUser.role === "admin" || can("dashboard")) && (
        <section className="max-w-[1400px] mx-auto px-4 py-4 grid grid-cols-2 md:grid-cols-5 gap-3">
          <div className="bg-[#111827] border border-slate-800 rounded-2xl p-4">
            <span className="text-xs text-slate-400 font-medium">
              {stats.scope === "own" ? "My Emails / Queue" : "Total Ingested Queue"}
            </span>
            <div className="flex items-baseline gap-2 mt-2">
              <span className="text-3xl font-bold text-white">{stats.totalEmails ?? 0}</span>
              <span className="text-xs text-slate-500">emails</span>
            </div>
          </div>
          <div className="bg-[#111827] border border-slate-800 rounded-2xl p-4">
            <span className="text-xs text-emerald-400 font-medium flex items-center gap-1">
              <CheckCircle className="h-3 w-3" /> Sent Success
            </span>
            <div className="flex items-baseline gap-2 mt-2">
              <span className="text-3xl font-bold text-emerald-400">{stats.sent ?? 0}</span>
              <span className="text-xs text-slate-500">delivered</span>
            </div>
          </div>
          <div className="bg-[#111827] border border-slate-800 rounded-2xl p-4">
            <span className="text-xs text-amber-400 font-medium">Pending In Queue</span>
            <div className="flex items-baseline gap-2 mt-2">
              <span className="text-3xl font-bold text-amber-400">{stats.pending ?? 0}</span>
              <span className="text-xs text-slate-500">waiting</span>
            </div>
          </div>
          <div className="bg-[#111827] border border-slate-800 rounded-2xl p-4">
            <span className="text-xs text-blue-400 font-medium flex items-center gap-1">
              <Eye className="h-3 w-3" /> Unique Opens
            </span>
            <div className="flex items-baseline gap-2 mt-2">
              <span className="text-3xl font-bold text-blue-400">
                {isSuperAdmin() ? (stats.uniqueOpens ?? stats.opened ?? 0) : (stats.opened ?? 0)}
              </span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300">
                {stats.openRate != null ? `${stats.openRate}%` : "0%"} Rate
              </span>
            </div>
          </div>
          <div className="bg-[#111827] border border-slate-800 rounded-2xl p-4">
            <span className="text-xs text-rose-400 font-medium flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" /> Transmit Failed
            </span>
            <div className="flex items-baseline gap-2 mt-2">
              <span className="text-3xl font-bold text-rose-400">{stats.failed ?? 0}</span>
              <span className="text-xs text-slate-500">unsuccessful</span>
            </div>
          </div>
        </section>
      )}

      <div className="max-w-[1400px] mx-auto px-4 pb-2 flex flex-wrap gap-1.5 border-b border-slate-800/60">
        {tabBtn("compose", "Compose Email", <Send className="h-3.5 w-3.5" />, can("compose"))}
        {tabBtn("dashboard", "Live Queue & Run Panel", <Cpu className="h-3.5 w-3.5" />, can("dashboard"))}
        {tabBtn("sheets_importer", "Google Sheets Simulator", <FileSpreadsheet className="h-3.5 w-3.5" />, can("sheets"))}
        {tabBtn(
          "gmail_accounts",
          `Gmail & SMTP Rotators (${stats.totalGmailCount || gmailAccounts.length || 0})`,
          <RefreshCw className="h-3.5 w-3.5" />,
          isSuperAdmin() || can("gmail") || can("smtp_view") || can("smtp_add")
        )}
        {tabBtn("templates", `HTML Templates Studio (${stats.templatesCount || templates.length || 0})`, <FileText className="h-3.5 w-3.5" />, can("templates"))}
        {tabBtn("campaigns_tab", `Active Outreach Campaigns (${stats.campaignsCount || 0})`, <Layers className="h-3.5 w-3.5" />, can("campaigns"))}
        {tabBtn("admin", "Admin Panel", <Settings className="h-3.5 w-3.5" />, can("admin_panel"))}
      </div>

      <main className="max-w-[1400px] mx-auto p-4 space-y-4">
        <div className="bg-indigo-50 text-indigo-950 rounded-2xl px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-indigo-900">My Send Progress</p>
            <p className="text-xs text-indigo-700 mt-0.5">
              Limit: <strong>{dailyLimit}</strong>
              &nbsp;·&nbsp; Sent today: <strong>{sentToday}</strong>
              &nbsp;·&nbsp; Remaining: <strong>{remaining}</strong>
              &nbsp;·&nbsp; All time: <strong>{authUser.stats?.totalSent ?? 0}</strong>
            </p>
            <div className="mt-2 h-1.5 w-48 sm:w-64 bg-indigo-200 rounded-full overflow-hidden">
              <div className="h-full bg-indigo-500 rounded-full transition-all" style={{ width: `${progressPct}%` }} />
            </div>
          </div>
          <span className="text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-lg bg-indigo-100 text-indigo-700 border border-indigo-200">
            {isSuperAdmin() ? "SUPER ADMIN" : authUser.role === "admin" ? "ADMIN" : "OPERATOR"}
          </span>
        </div>

        {activeTab === "compose" && can("compose") && (
          <div className="bg-white text-slate-900 rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold">Compose Email</h2>
                <p className="text-sm text-slate-500">Create and send a new email</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setHtmlOn(!htmlOn)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-semibold ${htmlOn ? "bg-violet-600 text-white" : "bg-slate-100 text-slate-600"}`}
                >
                  HTML: {htmlOn ? "ON" : "OFF"}
                </button>
                <button type="button" className="px-3 py-1.5 rounded-lg text-sm border border-slate-200 hover:bg-slate-50">
                  Preview
                </button>
                <button
                  onClick={handleManualSend}
                  disabled={sending}
                  className="px-4 py-1.5 rounded-lg text-sm font-semibold bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-50 flex items-center gap-1.5"
                >
                  <Send className="h-3.5 w-3.5" />
                  {sending ? "Sending..." : "Send Email"}
                </button>
              </div>
            </div>
            <div className="p-5 space-y-3">
              <div className="grid md:grid-cols-2 gap-3">
                <input className="border border-slate-200 rounded-lg px-3 py-2 text-sm" placeholder="To email" value={composeTo} onChange={(e) => setComposeTo(e.target.value)} />
                <input className="border border-slate-200 rounded-lg px-3 py-2 text-sm" placeholder="From name (optional)" value={composeFromName} onChange={(e) => setComposeFromName(e.target.value)} />
              </div>
              <input className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" placeholder="Subject" value={composeSubject} onChange={(e) => setComposeSubject(e.target.value)} />
              <div className="min-h-[220px] border border-slate-200 rounded-lg overflow-hidden bg-white">
                <RichTextComposer value={composeHtml} onChange={(html: string) => setComposeHtml(html)} />
              </div>
            </div>
          </div>
        )}

        {activeTab === "dashboard" && can("dashboard") && (
          <div className="bg-[#111827] border border-slate-800 rounded-2xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-lg">
                Live Queue & Run Panel{" "}
                <span className="text-sm font-normal text-slate-400">
                  {stats.scope === "own" ? "(your sends only)" : "(all system)"}
                </span>
              </h2>
              <button onClick={loadDashboardData} className="text-sm px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 flex items-center gap-1">
                <RefreshCw className="h-3.5 w-3.5" /> Refresh
              </button>
            </div>
            <div className="overflow-x-auto border border-slate-800 rounded-xl">
              <table className="w-full text-sm">
                <thead className="bg-slate-900/80 text-slate-400">
                  <tr>
                    <th className="text-left p-3">Email</th>
                    <th className="text-left p-3">Status</th>
                    <th className="text-left p-3">Opens</th>
                    <th className="text-left p-3">Ref</th>
                  </tr>
                </thead>
                <tbody>
                  {queueItems.length === 0 ? (
                    <tr><td colSpan={4} className="p-6 text-slate-500 text-center">No queue items yet</td></tr>
                  ) : (
                    queueItems.map((item: any) => (
                      <tr key={item.id} className="border-t border-slate-800/80">
                        <td className="p-3">{item.email || item.toEmail || "—"}</td>
                        <td className="p-3">{item.status}</td>
                        <td className="p-3">{item.openCount ?? 0}</td>
                        <td className="p-3 text-slate-400">{item.referenceNo || item.reference_no || "—"}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <div>
              <h3 className="font-medium text-sm text-slate-300 mb-2 flex items-center gap-1">
                <Eye className="h-3.5 w-3.5" /> Recent Opens
              </h3>
              {recentOpens.length === 0 ? (
                <p className="text-slate-500 text-sm">No opens yet</p>
              ) : (
                <div className="space-y-1">
                  {recentOpens.slice(0, 20).map((op: any) => (
                    <div key={op.id || op.trackingId} className="text-sm border border-slate-800 rounded-lg p-2 flex justify-between gap-2">
                      <span className="truncate">{op.email || op.recipient || op.trackingId}</span>
                      <span className="text-slate-500 text-xs shrink-0">{op.openedAt || op.createdAt || ""}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === "templates" && can("templates") && (
          <div className="bg-[#111827] border border-slate-800 rounded-2xl p-5 space-y-3">
            <h2 className="font-semibold text-lg flex items-center gap-2">
              <FileText className="h-5 w-5 text-blue-400" /> HTML Templates Studio
            </h2>
            {templates.length === 0 ? (
              <p className="text-sm text-slate-400">No templates yet.</p>
            ) : (
              <ul className="space-y-2">
                {templates.map((t: any) => (
                  <li key={t.id} className="border border-slate-800 rounded-xl p-3 flex justify-between items-center">
                    <span className="font-medium">{t.name || t.title || `Template #${t.id}`}</span>
                    <span className="text-xs text-slate-500">id: {t.id}</span>
                  </li>
                ))}
              </ul>
            )}
            <button onClick={loadTemplates} className="text-sm px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700">Refresh templates</button>
          </div>
        )}

        {activeTab === "sheets_importer" && can("sheets") && (
          <div className="bg-[#111827] border border-slate-800 rounded-2xl p-5">
            <h2 className="font-semibold text-lg flex items-center gap-2 mb-2">
              <FileSpreadsheet className="h-5 w-5 text-emerald-400" /> Google Sheets Simulator
            </h2>
            <p className="text-sm text-slate-400">
              Sheets import pipeline is available with your access. Scope:{" "}
              {stats.scope === "own" ? "your assigned data" : "global"}.
            </p>
          </div>
        )}

        {activeTab === "gmail_accounts" && (isSuperAdmin() || can("gmail") || can("smtp_view")) && (
          <div className="bg-[#111827] border border-slate-800 rounded-2xl p-5 space-y-3">
            <h2 className="font-semibold text-lg">Gmail & SMTP Rotators</h2>
            {gmailAccounts.length === 0 ? (
              <p className="text-sm text-slate-400">No accounts visible for your scope (or none assigned).</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-slate-400">
                    <tr>
                      <th className="text-left p-2">Email / User</th>
                      <th className="text-left p-2">Status</th>
                      <th className="text-left p-2">Sent today</th>
                    </tr>
                  </thead>
                  <tbody>
                    {gmailAccounts.map((g: any) => (
                      <tr key={g.id} className="border-t border-slate-800">
                        <td className="p-2">{g.email || g.user || g.username}</td>
                        <td className="p-2">{g.status || "—"}</td>
                        <td className="p-2">{g.sentToday ?? g.dailySent ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <button onClick={loadDashboardData} className="text-sm px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700">Refresh</button>
          </div>
        )}

        {activeTab === "campaigns_tab" && can("campaigns") && (
          <div className="bg-[#111827] border border-slate-800 rounded-2xl p-5">
            <h2 className="font-semibold text-lg">Active Outreach Campaigns</h2>
            <p className="text-sm text-slate-400 mt-1">Campaign module available with your permissions.</p>
          </div>
        )}

        {activeTab === "admin" && can("admin_panel") && (
          <div className="bg-[#111827] border border-slate-800 rounded-2xl p-5">
            <h2 className="font-semibold text-lg mb-3 flex items-center gap-2">
              <Users className="h-5 w-5" /> Admin Panel — Users / Operators
            </h2>
            <table className="w-full text-sm">
              <thead className="text-slate-400">
                <tr>
                  <th className="text-left p-2">User</th>
                  <th className="text-left p-2">Role</th>
                  <th className="text-left p-2">Sent today</th>
                  <th className="text-left p-2">Permissions</th>
                </tr>
              </thead>
              <tbody>
                {adminUsers.length === 0 ? (
                  <tr><td colSpan={4} className="p-4 text-slate-500 text-center">No users loaded</td></tr>
                ) : (
                  adminUsers.map((u: any) => (
                    <tr key={u.id} className="border-t border-slate-800">
                      <td className="p-2">{u.username}</td>
                      <td className="p-2">{u.role}</td>
                      <td className="p-2 text-emerald-400">{u.sentToday ?? 0}</td>
                      <td className="p-2 text-xs text-slate-400">{(u.permissions || []).join(", ") || "defaults"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
