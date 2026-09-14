"use client";

import React, { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import {
  Mail,
  RotateCw,
  Sliders,
  FileCode,
  Layers,
  Database,
  PlusCircle,
  Eye,
  Send,
  CheckCircle2,
  Clock,
  XCircle,
  Inbox,
  Activity,
  Users,
  Settings,
  LogOut,
  Play,
  Pause,
  Trash2,
  Upload,
  Download,
  RefreshCw,
  Shield,
} from "lucide-react";

const ReactQuill = dynamic(() => import("react-quill-new"), { ssr: false });
import "react-quill-new/dist/quill.snow.css";

export default function EmailAutomationDashboard() {
  const [authUser, setAuthUser] = useState<any>(null);
  const [token, setToken] = useState("");
  const [activeTab, setActiveTab] = useState("queue");
  const [stats, setStats] = useState({
    totalEmails: 0,
    sent: 0,
    pending: 0,
    sending: 0,
    failed: 0,
    opened: 0,
    uniqueOpens: 0,
    totalOpenEvents: 0,
    openRate: 0,
    activeGmailCount: 0,
    totalGmailCount: 0,
  });
  const [loading, setLoading] = useState(true);
  const [perms, setPerms] = useState<Record<string, boolean>>({});
  const [recentOpens, setRecentOpens] = useState<any[]>([]);
  const [queue, setQueue] = useState<any[]>([]);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [templates, setTemplates] = useState<any[]>([]);
  const [composeHtml, setComposeHtml] = useState("");
  const [composeTo, setComposeTo] = useState("");
  const [composeSubject, setComposeSubject] = useState("");
  const [sending, setSending] = useState(false);
  const [msg, setMsg] = useState("");

  const can = (p: string) => {
    if (!authUser) return false;
    if (authUser.role === "super_admin" || authUser.role === "admin") return true;
    return !!perms[p];
  };

  const authHeaders = (): HeadersInit => {
    const h: HeadersInit = { "Content-Type": "application/json" };
    if (token) h["Authorization"] = `Bearer ${token}`;
    return h;
  };

  useEffect(() => {
    const t = localStorage.getItem("ea_token") || "";
    setToken(t);
    loadAuth(t);
  }, []);

  async function loadAuth(t: string) {
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(t ? { Authorization: `Bearer ${t}` } : {}),
        },
        body: JSON.stringify({ action: "me" }),
      });
      const data = await res.json();
      if (data.success && data.user) {
        setAuthUser(data.user);
        setPerms(data.permissions || {});
        if (data.token) {
          localStorage.setItem("ea_token", data.token);
          setToken(data.token);
        }
        await refreshDashboard(data.token || t);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  async function refreshDashboard(t?: string) {
    try {
      const headers: HeadersInit = { "Content-Type": "application/json" };
      const tok = t || token;
      if (tok) headers["Authorization"] = `Bearer ${tok}`;
      const res = await fetch("/api/dashboard", { headers });
      const data = await res.json();
      if (data.success && data.stats) {
        setStats({
          totalEmails: data.stats.totalEmails || 0,
          sent: data.stats.sent || 0,
          pending: data.stats.pending || 0,
          sending: data.stats.sending || 0,
          failed: data.stats.failed || 0,
          opened: data.stats.uniqueOpens ?? data.stats.opened ?? 0,
          uniqueOpens: data.stats.uniqueOpens ?? data.stats.opened ?? 0,
          totalOpenEvents: data.stats.totalOpenEvents || 0,
          openRate: data.stats.openRate || 0,
          activeGmailCount: data.stats.activeGmailCount || 0,
          totalGmailCount: data.stats.totalGmailCount || 0,
        });
        setRecentOpens(data.recentOpens || []);
        setAccounts(data.accounts || []);
        setQueue(data.recentQueue || []);
      }
    } catch (e) {
      console.error(e);
    }
  }

  async function handleLogin(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const username = String(fd.get("username") || "");
    const password = String(fd.get("password") || "");
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "login", username, password }),
      });
      const data = await res.json();
      if (data.success) {
        localStorage.setItem("ea_token", data.token);
        setToken(data.token);
        setAuthUser(data.user);
        setPerms(data.permissions || {});
        await refreshDashboard(data.token);
      } else {
        setMsg(data.error || "Login failed");
      }
    } catch {
      setMsg("Login error");
    }
  }

  async function handleLogout() {
    localStorage.removeItem("ea_token");
    setToken("");
    setAuthUser(null);
    setPerms({});
  }

  async function sendManual() {
    if (!composeTo || !composeSubject || !composeHtml) {
      setMsg("To, Subject and Message required");
      return;
    }
    setSending(true);
    setMsg("");
    try {
      const res = await fetch("/api/manual-send", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          to: composeTo,
          subject: composeSubject,
          html: composeHtml,
          sentByUsername: authUser?.username,
          sentByUserId: authUser?.id,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setMsg("Email sent! Tracking ID: " + (data.trackingId || ""));
        setComposeHtml("");
        setComposeTo("");
        setComposeSubject("");
        await refreshDashboard();
      } else {
        setMsg(data.error || "Send failed");
      }
    } catch (e: any) {
      setMsg(e.message || "Send error");
    } finally {
      setSending(false);
    }
  }

  async function processQueue() {
    try {
      const res = await fetch("/api/queue", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ action: "process_batch" }),
      });
      const data = await res.json();
      setMsg(data.summary || data.message || JSON.stringify(data));
      await refreshDashboard();
    } catch (e: any) {
      setMsg(e.message);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center text-slate-400">
        Loading dashboard...
      </div>
    );
  }

  if (!authUser) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
        <form
          onSubmit={handleLogin}
          className="bg-slate-900 border border-slate-700 rounded-2xl p-8 w-full max-w-md space-y-4"
        >
          <h1 className="text-2xl font-bold text-white text-center">
            EMAIL AUTOMATION
          </h1>
          <input
            name="username"
            placeholder="Username"
            className="w-full bg-slate-800 border border-slate-600 rounded-lg px-4 py-2 text-white"
            required
          />
          <input
            name="password"
            type="password"
            placeholder="Password"
            className="w-full bg-slate-800 border border-slate-600 rounded-lg px-4 py-2 text-white"
            required
          />
          {msg && <p className="text-red-400 text-sm">{msg}</p>}
          <button
            type="submit"
            className="w-full bg-blue-600 hover:bg-blue-500 text-white font-semibold py-2 rounded-lg"
          >
            Login
          </button>
        </form>
      </div>
    );
  }

  const tabs = [
    { id: "queue", label: "Live Queue & Run Panel", perm: "dashboard" },
    { id: "sheets", label: "Google Sheets", perm: "sheets" },
    { id: "gmail", label: "Gmail & SMTP", perm: "gmail" },
    { id: "templates", label: "HTML Templates", perm: "templates" },
    { id: "compose", label: "Compose Email", perm: "compose" },
  ].filter((t) => can(t.perm));

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 bg-slate-900/80 px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-wide text-white">
            EMAIL AUTOMATION DASHBOARD
          </h1>
          <p className="text-xs text-slate-400">
            {authUser.username} · {authUser.role}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => refreshDashboard()}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-sm"
          >
            <RefreshCw className="h-4 w-4" /> Sync Dashboard
          </button>
          <button
            onClick={handleLogout}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-red-900/40 hover:bg-red-800/50 text-sm text-red-300"
          >
            <LogOut className="h-4 w-4" /> Logout
          </button>
        </div>
      </header>

      {can("dashboard") && (
        <section className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <span className="text-xs text-slate-400 flex items-center gap-1">
              <Inbox className="h-3 w-3" /> Total Queue
            </span>
            <span className="text-2xl font-bold text-white">{stats.totalEmails}</span>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <span className="text-xs text-emerald-400 flex items-center gap-1">
              <CheckCircle2 className="h-3 w-3" /> Sent
            </span>
            <span className="text-2xl font-bold text-emerald-400">{stats.sent}</span>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <span className="text-xs text-amber-400 flex items-center gap-1">
              <Clock className="h-3 w-3" /> Pending
            </span>
            <span className="text-2xl font-bold text-amber-400">{stats.pending}</span>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <span className="text-xs text-blue-400 flex items-center gap-1">
              <Eye className="h-3 w-3" /> Unique Opens
            </span>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="text-2xl font-bold text-blue-400">
                {stats.uniqueOpens || stats.opened}
              </span>
              <span className="text-xs text-blue-500">{stats.openRate}% Rate</span>
            </div>
            {stats.totalOpenEvents > 0 && (
              <p className="text-[10px] text-slate-500 mt-1">
                {stats.totalOpenEvents} total open events
              </p>
            )}
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <span className="text-xs text-red-400 flex items-center gap-1">
              <XCircle className="h-3 w-3" /> Failed
            </span>
            <span className="text-2xl font-bold text-red-400">{stats.failed}</span>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <span className="text-xs text-violet-400 flex items-center gap-1">
              <Mail className="h-3 w-3" /> SMTP Active
            </span>
            <span className="text-2xl font-bold text-violet-400">
              {stats.activeGmailCount}/{stats.totalGmailCount}
            </span>
          </div>
        </section>
      )}

      <nav className="flex flex-wrap gap-2 px-4 pb-2">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
              activeTab === t.id
                ? "bg-blue-600 text-white"
                : "bg-slate-800 text-slate-300 hover:bg-slate-700"
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <main className="p-4 space-y-4">
        {msg && (
          <div className="bg-slate-800 border border-slate-700 rounded-lg px-4 py-2 text-sm text-slate-200">
            {msg}
          </div>
        )}

        {activeTab === "queue" && can("dashboard") && (
          <div className="space-y-4">
            <div className="flex gap-2">
              <button
                onClick={processQueue}
                className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 rounded-lg text-sm font-medium"
              >
                <Play className="h-4 w-4" /> Process Batch
              </button>
              <button
                onClick={() => refreshDashboard()}
                className="flex items-center gap-2 px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm"
              >
                <RefreshCw className="h-4 w-4" /> Refresh
              </button>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <h3 className="text-sm font-semibold text-slate-300 mb-3">
                Live Tracking Pixel Opens
              </h3>
              {recentOpens.length === 0 ? (
                <p className="text-slate-500 text-sm">No opens logged yet.</p>
              ) : (
                <div className="space-y-2 max-h-80 overflow-y-auto">
                  {recentOpens.map((op: any) => (
                    <div
                      key={op.id}
                      className="bg-slate-950/60 border border-slate-800 rounded-lg px-3 py-2 text-xs"
                    >
                      <div className="flex justify-between">
                        <span className="text-blue-300">{op.email || "—"}</span>
                        <span className="text-slate-500">
                          {op.openedAt
                            ? new Date(op.openedAt).toLocaleString()
                            : ""}
                        </span>
                      </div>
                      <div className="text-slate-400 mt-1">
                        {op.markName} · {op.referenceNo} · {op.source} ·{" "}
                        {op.browser}/{op.device}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-slate-800 text-slate-400">
                  <tr>
                    <th className="text-left p-2">Email</th>
                    <th className="text-left p-2">Status</th>
                    <th className="text-left p-2">Mark</th>
                    <th className="text-left p-2">Opens</th>
                  </tr>
                </thead>
                <tbody>
                  {queue.slice(0, 50).map((q: any) => (
                    <tr key={q.id} className="border-t border-slate-800">
                      <td className="p-2">{q.email}</td>
                      <td className="p-2">{q.status}</td>
                      <td className="p-2">{q.markName}</td>
                      <td className="p-2">{q.openCount || 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === "compose" && can("compose") && (
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3 max-w-3xl">
            <h3 className="font-semibold text-white">Compose Email</h3>
            <input
              value={composeTo}
              onChange={(e) => setComposeTo(e.target.value)}
              placeholder="To email"
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm"
            />
            <input
              value={composeSubject}
              onChange={(e) => setComposeSubject(e.target.value)}
              placeholder="Subject"
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm"
            />
            <div className="bg-white rounded-lg text-black min-h-[200px]">
              <ReactQuill
                theme="snow"
                value={composeHtml}
                onChange={setComposeHtml}
              />
            </div>
            <button
              onClick={sendManual}
              disabled={sending}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-lg text-sm font-medium"
            >
              <Send className="h-4 w-4" /> {sending ? "Sending..." : "Send Email"}
            </button>
          </div>
        )}

        {activeTab === "gmail" && can("gmail") && (
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <h3 className="font-semibold mb-3">SMTP Accounts ({accounts.length})</h3>
            <div className="space-y-2">
              {accounts.map((a: any) => (
                <div
                  key={a.id}
                  className="flex justify-between bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm"
                >
                  <span>{a.email}</span>
                  <span
                    className={
                      a.status === "enabled" ? "text-emerald-400" : "text-amber-400"
                    }
                  >
                    {a.status}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === "templates" && can("templates") && (
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 text-slate-400 text-sm">
            Templates module — use your existing templates API from the full UI.
            Compose tab works for manual HTML sends with tracking pixel.
          </div>
        )}

        {activeTab === "sheets" && can("sheets") && (
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 text-slate-400 text-sm">
            Google Sheets import runs via Queue → Process Batch after import from
            your sheets integration.
          </div>
        )}
      </main>
    </div>
  );
}
