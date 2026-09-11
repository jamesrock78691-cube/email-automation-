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
  "compose",
  "dashboard",
  "sheets",
  "gmail",
  "templates",
  "campaigns",
  "admin_panel",
  "smtp_view",
  "smtp_add",
  "smtp_delete",
  "manage_users",
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
    totalEmails: 0,
    sent: 0,
    pending: 0,
    failed: 0,
    opened: 0,
    uniqueOpens: 0,
    openRate: 0,
    scope: "global",
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

  const effectivePerms = (): string[] => {
    if (!authUser) return [];
    if (
      authUser.role === "super_admin" ||
      authUser.username === "admin" ||
      authUser.username === "superadmin"
    ) {
      return [...ALL_PERMS];
    }
    const p = authUser.permissions;
    if (Array.isArray(p) && p.length > 0) return p;
    if (authUser.role === "admin") {
      return [
        "compose",
        "dashboard",
        "sheets",
        "gmail",
        "templates",
        "campaigns",
        "admin_panel",
        "smtp_add",
        "manage_users",
      ];
    }
    return OPERATOR_DEFAULTS;
  };

  const can = (perm: string) => {
    if (!authUser) return false;
    if (
      authUser.role === "super_admin" ||
      authUser.username === "admin" ||
      authUser.username === "superadmin"
    )
      return true;
    return effectivePerms().includes(perm);
  };

  const isSuperAdmin = () =>
    !!authUser &&
    (authUser.role === "super_admin" ||
      authUser.username === "admin" ||
      authUser.username === "superadmin");

  const authHeaders = (): Record<string, string> => {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    const token =
      authToken ||
      (typeof window !== "undefined"
        ? localStorage.getItem("ea_token") || ""
        : "");
    if (token) h["Authorization"] = `Bearer ${token}`;
    return h;
  };

  const showError = (m: string) => {
    setErrorMsg(m);
    setTimeout(() => setErrorMsg(""), 6000);
  };
  const showSuccess = (m: string) => {
    setSuccessMsg(m);
    setTimeout(() => setSuccessMsg(""), 4000);
  };

  useEffect(() => {
    (async () => {
      try {
        const saved =
          typeof window !== "undefined"
            ? localStorage.getItem("ea_token")
            : null;
        if (!saved) {
          setAuthChecked(true);
          return;
        }
        setAuthToken(saved);
        const res = await fetch("/api/auth?action=me", {
          headers: { Authorization: `Bearer ${saved}` },
          credentials: "include",
        });
        const data = await res.json();
        if (data.success && data.user) {
          setAuthUser(data.user);
        } else {
          localStorage.removeItem("ea_token");
        }
      } catch {
        /* ignore */
      } finally {
        setAuthChecked(true);
      }
    })();
  }, []);

  useEffect(() => {
    if (!authUser) return;
    const perms = effectivePerms();
    const order: { perm: string; tab: string }[] = [
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
      const res = await fetch("/api/dashboard", {
        headers: authHeaders(),
        credentials: "include",
      });
      const data = await res.json();
      if (data.success) {
        setStats(data.stats || {});
        setQueueItems(data.recentQueue || data.queue || []);
        setRecentOpens(data.recentOpens || []);
        if (data.gmailAccounts) setGmailAccounts(data.gmailAccounts);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingData(false);
    }
  };

  const loadTemplates = async () => {
    try {
      const res = await fetch("/api/template", {
        headers: authHeaders(),
        credentials: "include",
      });
      const data = await res.json();
      if (data.success) setTemplates(data.list || data.templates || []);
    } catch (e) {
      console.error(e);
    }
  };

  const loadAdminUsers = async () => {
    try {
      const res = await fetch("/api/auth?action=list_users", {
        headers: authHeaders(),
        credentials: "include",
      });
      const data = await res.json();
      if (data.success) setAdminUsers(data.list || data.users || []);
    } catch (e) {
      console.error(e);
    }
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
        body: JSON.stringify({
          action: "login",
          username: loginForm.username.trim(),
          password: loginForm.password,
        }),
      });
      const data = await res.json();
      if (data.success && data.user) {
        if (data.token) {
          localStorage.setItem("ea_token", data.token);
          setAuthToken(data.token);
        }
        setAuthUser(data.user);
        showSuccess(`Welcome, ${data.user.username}`);
      } else {
        showError(data.error || "Login failed");
      }
    } catch (err: any) {
      showError(err.message || "Login error");
    } finally {
      setLoginLoading(false);
    }
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
    if (!composeTo.trim() || !composeSubject.trim()) {
      showError("To and Subject required");
      return;
    }
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
      } else {
        showError(data.error || "Send failed");
      }
    } catch (err: any) {
      showError(err.message || "Send error");
    } finally {
      setSending(false);
    }
  };

  if (!authChecked) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center">
        Loading...
      </div>
    );
  }

  if (!authUser) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-4">
        <form
          onSubmit={handleLogin}
          className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4"
        >
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Mail className="h-5 w-5 text-blue-400" /> Email Automation
          </h1>
          <p className="text-xs text-slate-500">Operator / Admin login</p>
          {errorMsg && <p className="text-rose-400 text-sm">{errorMsg}</p>}
          {successMsg && (
            <p className="text-emerald-400 text-sm">{successMsg}</p>
          )}
          <input
            className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm"
            placeholder="Username"
            value={loginForm.username}
            onChange={(e) =>
              setLoginForm({ ...loginForm, username: e.target.value })
            }
            required
            autoComplete="username"
          />
          <input
            type="password"
            className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm"
            placeholder="Password"
            value={loginForm.password}
            onChange={(e) =>
              setLoginForm({ ...loginForm, password: e.target.value })
            }
            required
            autoComplete="current-password"
          />
          <button
            type="submit"
            disabled={loginLoading}
            className="w-full bg-blue-600 hover:bg-blue-500 rounded-lg py-2.5 font-medium text-sm disabled:opacity-50"
          >
            {loginLoading ? "Signing in..." : "Login"}
          </button>
        </form>
      </div>
    );
  }

  const perms = effectivePerms();

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 px-4 py-3 flex items-center justify-between flex-wrap gap-2">
        <div className="font-semibold flex items-center gap-2">
          <Mail className="h-5 w-5 text-blue-400" />
          Email Automation
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-slate-400">
            {authUser.username}{" "}
            <span className="text-slate-500">({authUser.role})</span>
          </span>
          {authUser.stats && (
            <span className="text-xs text-slate-500 hidden sm:inline">
              Today: {authUser.stats.sentToday || 0}/
              {authUser.stats.dailyLimit || 100}
            </span>
          )}
          <span
            className="text-xs text-blue-400/80 max-w-[200px] truncate"
            title={perms.join(", ")}
          >
            Access: {perms.join(", ")}
          </span>
          <button
            onClick={handleLogout}
            className="text-slate-400 hover:text-white flex items-center gap-1"
          >
            <LogOut className="h-3.5 w-3.5" /> Logout
          </button>
        </div>
      </header>

      {errorMsg && (
        <div className="mx-4 mt-3 p-2 bg-rose-500/10 border border-rose-500/30 text-rose-300 text-sm rounded flex items-center gap-2">
          <AlertTriangle className="h-4 w-4" /> {errorMsg}
        </div>
      )}
      {successMsg && (
        <div className="mx-4 mt-3 p-2 bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-sm rounded flex items-center gap-2">
          <CheckCircle className="h-4 w-4" /> {successMsg}
        </div>
      )}

      {(isSuperAdmin() || authUser.role === "admin" || can("dashboard")) && (
        <section className="grid grid-cols-2 md:grid-cols-5 gap-3 p-4">
          <div className="bg-slate-900/60 border border-slate-800 p-3 rounded-xl">
            <span className="text-xs text-slate-400">
              {stats.scope === "own" ? "My total" : "Total queue"}
            </span>
            <div className="text-2xl font-bold mt-1">
              {stats.totalEmails ?? 0}
            </div>
          </div>
          <div className="bg-slate-900/60 border border-slate-800 p-3 rounded-xl">
            <span className="text-xs text-emerald-400">Sent</span>
            <div className="text-2xl font-bold text-emerald-400 mt-1">
              {stats.sent ?? 0}
            </div>
          </div>
          <div className="bg-slate-900/60 border border-slate-800 p-3 rounded-xl">
            <span className="text-xs text-yellow-400">Pending</span>
            <div className="text-2xl font-bold text-yellow-400 mt-1">
              {stats.pending ?? 0}
            </div>
          </div>
          <div className="bg-slate-900/60 border border-slate-800 p-3 rounded-xl">
            <span className="text-xs text-blue-400">Opened</span>
            <div className="text-2xl font-bold text-blue-400 mt-1">
              {stats.opened ?? 0}
              <span className="text-xs text-slate-500 ml-1">
                {stats.openRate != null ? `${stats.openRate}%` : ""}
                {isSuperAdmin() && stats.uniqueOpens != null
                  ? ` · ${stats.uniqueOpens} unique`
                  : ""}
              </span>
            </div>
          </div>
          <div className="bg-slate-900/60 border border-slate-800 p-3 rounded-xl">
            <span className="text-xs text-rose-400">Failed</span>
            <div className="text-2xl font-bold text-rose-400 mt-1">
              {stats.failed ?? 0}
            </div>
          </div>
        </section>
      )}

      <div className="flex flex-wrap gap-2 border-b border-slate-800 px-4 pb-2">
        {can("compose") && (
          <button
            onClick={() => setActiveTab("compose")}
            className={`px-3 py-1.5 rounded-lg text-sm ${
              activeTab === "compose"
                ? "bg-blue-600 text-white"
                : "bg-slate-800 text-slate-300"
            }`}
          >
            Compose
          </button>
        )}
        {can("dashboard") && (
          <button
            onClick={() => setActiveTab("dashboard")}
            className={`px-3 py-1.5 rounded-lg text-sm flex items-center gap-1 ${
              activeTab === "dashboard"
                ? "bg-blue-600 text-white"
                : "bg-slate-800 text-slate-300"
            }`}
          >
            <Cpu className="h-3.5 w-3.5" /> Live Queue
          </button>
        )}
        {can("sheets") && (
          <button
            onClick={() => setActiveTab("sheets_importer")}
            className={`px-3 py-1.5 rounded-lg text-sm ${
              activeTab === "sheets_importer"
                ? "bg-blue-600 text-white"
                : "bg-slate-800 text-slate-300"
            }`}
          >
            Sheets
          </button>
        )}
        {(isSuperAdmin() ||
          can("gmail") ||
          can("smtp_view") ||
          can("smtp_add")) && (
          <button
            onClick={() => setActiveTab("gmail_accounts")}
            className={`px-3 py-1.5 rounded-lg text-sm ${
              activeTab === "gmail_accounts"
                ? "bg-blue-600 text-white"
                : "bg-slate-800 text-slate-300"
            }`}
          >
            SMTP
          </button>
        )}
        {can("templates") && (
          <button
            onClick={() => setActiveTab("templates")}
            className={`px-3 py-1.5 rounded-lg text-sm ${
              activeTab === "templates"
                ? "bg-blue-600 text-white"
                : "bg-slate-800 text-slate-300"
            }`}
          >
            Templates
          </button>
        )}
        {can("campaigns") && (
          <button
            onClick={() => setActiveTab("campaigns_tab")}
            className={`px-3 py-1.5 rounded-lg text-sm ${
              activeTab === "campaigns_tab"
                ? "bg-blue-600 text-white"
                : "bg-slate-800 text-slate-300"
            }`}
          >
            Campaigns
          </button>
        )}
        {can("admin_panel") && (
          <button
            onClick={() => setActiveTab("admin")}
            className={`px-3 py-1.5 rounded-lg text-sm ${
              activeTab === "admin"
                ? "bg-blue-600 text-white"
                : "bg-slate-800 text-slate-300"
            }`}
          >
            Admin
          </button>
        )}
      </div>

      <main className="p-4 space-y-4 max-w-6xl mx-auto">
        {activeTab === "compose" && can("compose") && (
          <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-4 space-y-3">
            <h2 className="font-semibold flex items-center gap-2">
              <Send className="h-4 w-4" /> Compose Email
            </h2>
            <p className="text-sm text-slate-400">
              Logged in as{" "}
              <strong className="text-white">{authUser.username}</strong>
              {" · "}Your data only when scoped
            </p>
            <div className="grid md:grid-cols-2 gap-3">
              <input
                className="bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm"
                placeholder="To email"
                value={composeTo}
                onChange={(e) => setComposeTo(e.target.value)}
              />
              <input
                className="bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm"
                placeholder="From name (optional)"
                value={composeFromName}
                onChange={(e) => setComposeFromName(e.target.value)}
              />
            </div>
            <input
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm"
              placeholder="Subject"
              value={composeSubject}
              onChange={(e) => setComposeSubject(e.target.value)}
            />
            <div className="min-h-[200px] border border-slate-700 rounded-lg overflow-hidden">
              <RichTextComposer
                value={composeHtml}
                onChange={(html: string) => setComposeHtml(html)}
              />
            </div>
            <button
              onClick={handleManualSend}
              disabled={sending}
              className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2"
            >
              <Send className="h-4 w-4" />
              {sending ? "Sending..." : "Send Email"}
            </button>
          </div>
        )}

        {activeTab === "dashboard" && can("dashboard") && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">
                Live Queue{" "}
                {stats.scope === "own" ? "(your sends only)" : "(all system)"}
              </h2>
              <button
                onClick={loadDashboardData}
                disabled={loadingData}
                className="text-sm px-3 py-1 rounded bg-slate-800 hover:bg-slate-700 flex items-center gap-1"
              >
                <RefreshCw
                  className={`h-3.5 w-3.5 ${loadingData ? "animate-spin" : ""}`}
                />{" "}
                Refresh
              </button>
            </div>
            <div className="overflow-x-auto border border-slate-800 rounded-xl">
              <table className="w-full text-sm">
                <thead className="bg-slate-900 text-slate-400">
                  <tr>
                    <th className="text-left p-2">Email</th>
                    <th className="text-left p-2">Status</th>
                    <th className="text-left p-2">Opens</th>
                    <th className="text-left p-2">Ref</th>
                  </tr>
                </thead>
                <tbody>
                  {queueItems.length === 0 ? (
                    <tr>
                      <td
                        colSpan={4}
                        className="p-4 text-slate-500 text-center"
                      >
                        No queue items yet
                      </td>
                    </tr>
                  ) : (
                    queueItems.map((item: any) => (
                      <tr key={item.id} className="border-t border-slate-800">
                        <td className="p-2">
                          {item.email || item.toEmail || "—"}
                        </td>
                        <td className="p-2">{item.status}</td>
                        <td className="p-2">{item.openCount ?? 0}</td>
                        <td className="p-2 text-slate-400">
                          {item.referenceNo || item.reference_no || "—"}
                        </td>
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
                    <div
                      key={op.id || op.trackingId}
                      className="text-sm border border-slate-800 rounded-lg p-2 flex justify-between gap-2"
                    >
                      <span className="truncate">
                        {op.email || op.recipient || op.trackingId}
                      </span>
                      <span className="text-slate-500 text-xs shrink-0">
                        {op.openedAt || op.createdAt || ""}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === "templates" && can("templates") && (
          <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-4 space-y-3">
            <h2 className="font-semibold flex items-center gap-2">
              <FileText className="h-4 w-4" /> Templates
            </h2>
            {templates.length === 0 ? (
              <p className="text-sm text-slate-400">
                No templates yet — create HTML templates from admin or import.
              </p>
            ) : (
              <ul className="space-y-2">
                {templates.map((t: any) => (
                  <li
                    key={t.id}
                    className="border border-slate-800 rounded-lg p-3 flex justify-between items-center"
                  >
                    <span className="font-medium">
                      {t.name || t.title || `Template #${t.id}`}
                    </span>
                    <span className="text-xs text-slate-500">id: {t.id}</span>
                  </li>
                ))}
              </ul>
            )}
            <button
              onClick={loadTemplates}
              className="text-sm px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700"
            >
              Refresh templates
            </button>
          </div>
        )}

        {activeTab === "sheets_importer" && can("sheets") && (
          <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-4">
            <h2 className="font-semibold mb-2">Google Sheets / Import</h2>
            <p className="text-sm text-slate-400">
              Sheets import is available with your access. Use the blue import
              flow from the full pipeline when configured.
            </p>
            <p className="text-xs text-slate-500 mt-2">
              Scope: {stats.scope === "own" ? "your assigned data" : "global"}
            </p>
          </div>
        )}

        {activeTab === "gmail_accounts" &&
          (isSuperAdmin() || can("gmail") || can("smtp_view")) && (
            <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-4 space-y-3">
              <h2 className="font-semibold">SMTP / Gmail Accounts</h2>
              {gmailAccounts.length === 0 ? (
                <p className="text-sm text-slate-400">
                  No accounts visible for your scope (or none assigned).
                </p>
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
                          <td className="p-2">
                            {g.email || g.user || g.username}
                          </td>
                          <td className="p-2">{g.status || "—"}</td>
                          <td className="p-2">
                            {g.sentToday ?? g.dailySent ?? "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <button
                onClick={loadDashboardData}
                className="text-sm px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700"
              >
                Refresh
              </button>
            </div>
          )}

        {activeTab === "campaigns_tab" && can("campaigns") && (
          <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-4">
            <h2 className="font-semibold">Campaigns</h2>
            <p className="text-sm text-slate-400 mt-1">
              Campaign module available with your permissions.
            </p>
          </div>
        )}

        {activeTab === "admin" && can("admin_panel") && (
          <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-4">
            <h2 className="font-semibold mb-3 flex items-center gap-2">
              <Users className="h-4 w-4" /> Users / Operators
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
                  <tr>
                    <td
                      colSpan={4}
                      className="p-4 text-slate-500 text-center"
                    >
                      No users loaded
                    </td>
                  </tr>
                ) : (
                  adminUsers.map((u: any) => (
                    <tr key={u.id} className="border-t border-slate-800">
                      <td className="p-2">{u.username}</td>
                      <td className="p-2">{u.role}</td>
                      <td className="p-2 text-emerald-400">
                        {u.sentToday ?? 0}
                      </td>
                      <td className="p-2 text-xs text-slate-400">
                        {(u.permissions || []).join(", ") || "defaults"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {!can("compose") &&
          !can("dashboard") &&
          !can("templates") &&
          activeTab === "compose" && (
            <div className="p-8 text-center text-slate-400">
              No modules granted. Ask super admin to assign permissions
              (compose, dashboard, templates, …).
            </div>
          )}
      </main>
    </div>
  );
}
