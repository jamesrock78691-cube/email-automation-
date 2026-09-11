"use client";

import React, { useState, useEffect, useMemo } from "react";
import dynamic from "next/dynamic";
import {
  Mail,
  RotateCw,
  Sliders,
  FileCode,
  Layers,
  Database,
  PlusCircle,
  Play,
  Pause,
  RefreshCw,
  CheckCircle,
  AlertTriangle,
  Eye,
  Trash2,
  FileSpreadsheet,
  Cpu,
  Smartphone,
  Globe,
  Settings,
  HelpCircle,
  Users,
} from "lucide-react";

import { analyzeSpamRisk } from "@/lib/spamChecker";
import { quillToEmailHtml } from "@/lib/quillToEmailHtml";

const RichTextComposer = dynamic(
  () => import("../components/RichTextComposer"),
  { ssr: false }
);

const DEFAULT_SHEETS_CSV = `Reference No,Serial No,Mark Name,Filing Date,Email,CC,BCC,Subject,Template,Attachment\n`;

export default function EmailAutomationDashboard() {
  const [activeTab, setActiveTab] = useState("compose");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [authChecked, setAuthChecked] = useState(false);
  const [authUser, setAuthUser] = useState<{
    id: number;
    username: string;
    role: string;
    permissions?: string[];
    stats?: { totalSent: number; sentToday: number; dailyLimit: number };
  } | null>(null);
  const [authToken, setAuthToken] = useState("");
  const [loginForm, setLoginForm] = useState({ username: "", password: "" });
  const [loginLoading, setLoginLoading] = useState(false);
  const [stats, setStats] = useState<any>({
    totalEmails: 0,
    sent: 0,
    pending: 0,
    sending: 0,
    failed: 0,
    opened: 0,
    uniqueOpens: 0,
    openRate: "0%",
    activeGmailCount: 0,
    totalGmailCount: 0,
    templatesCount: 0,
    campaignsCount: 0,
    scope: "global",
  });
  const [queueItems, setQueueItems] = useState<any[]>([]);
  const [recentOpens, setRecentOpens] = useState<any[]>([]);
  const [adminUsers, setAdminUsers] = useState<any[]>([]);

  const can = (perm: string) => {
    if (!authUser) return false;
    if (authUser.role === "super_admin") return true;
    const perms = authUser.permissions || [];
    if (perms.length) return perms.includes(perm);
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
      ].includes(perm);
    }
    return perm === "compose" || perm === "templates";
  };

  const isSuperAdmin = () =>
    !!authUser &&
    (authUser.role === "super_admin" ||
      authUser.username === "admin" ||
      authUser.username === "superadmin");

  const authHeaders = () => {
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
    setTimeout(() => setErrorMsg(""), 5000);
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
        });
        const data = await res.json();
        if (data.success && data.user) setAuthUser(data.user);
        else localStorage.removeItem("ea_token");
      } catch {
        /* ignore */
      } finally {
        setAuthChecked(true);
      }
    })();
  }, []);

  useEffect(() => {
    if (!authUser) return;
    if (authUser.role === "operator") {
      const perms = authUser.permissions || [];
      if (perms.includes("dashboard")) setActiveTab("dashboard");
      else if (perms.includes("sheets")) setActiveTab("sheets_importer");
      else if (perms.includes("gmail")) setActiveTab("gmail_accounts");
      else if (perms.includes("templates")) setActiveTab("templates");
      else setActiveTab("compose");
    }
    loadDashboardData();
  }, [authUser]);

  const loadDashboardData = async () => {
    try {
      const res = await fetch("/api/dashboard", { headers: authHeaders() });
      const data = await res.json();
      if (data.success) {
        setStats(data.stats || {});
        setQueueItems(data.recentQueue || []);
        setRecentOpens(data.recentOpens || []);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const loadAdminUsers = async () => {
    try {
      const res = await fetch("/api/auth?action=list_users", {
        headers: authHeaders(),
      });
      const data = await res.json();
      if (data.success) setAdminUsers(data.list || data.users || []);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    if (activeTab === "admin" && authUser) loadAdminUsers();
  }, [activeTab, authUser]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginLoading(true);
    setErrorMsg("");
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "login",
          username: loginForm.username,
          password: loginForm.password,
        }),
      });
      const data = await res.json();
      if (data.success) {
        if (data.token) localStorage.setItem("ea_token", data.token);
        setAuthToken(data.token || "");
        setAuthUser(data.user);
        showSuccess(`Welcome, ${data.user.username}`);
      } else showError(data.error || "Login failed");
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
      body: JSON.stringify({ action: "logout" }),
    }).catch(() => {});
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
          />
          <button
            type="submit"
            disabled={loginLoading}
            className="w-full bg-blue-600 hover:bg-blue-500 rounded-lg py-2.5 font-medium text-sm"
          >
            {loginLoading ? "Signing in..." : "Login"}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 px-4 py-3 flex items-center justify-between">
        <div className="font-semibold flex items-center gap-2">
          <Mail className="h-5 w-5 text-blue-400" />
          Email Automation Dashboard
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-slate-400">
            {authUser.username}{" "}
            <span className="text-slate-500">({authUser.role})</span>
          </span>
          <button
            onClick={handleLogout}
            className="text-slate-400 hover:text-white"
          >
            Logout
          </button>
        </div>
      </header>

      {errorMsg && (
        <div className="mx-4 mt-3 p-2 bg-rose-500/10 border border-rose-500/30 text-rose-300 text-sm rounded">
          {errorMsg}
        </div>
      )}
      {successMsg && (
        <div className="mx-4 mt-3 p-2 bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-sm rounded">
          {successMsg}
        </div>
      )}

      {/* Top stats — super admin = global; operator with dashboard = own */}
      {(isSuperAdmin() ||
        authUser.role === "admin" ||
        can("dashboard")) && (
        <section className="grid grid-cols-2 md:grid-cols-5 gap-3 p-4">
          <div className="bg-slate-900/60 border border-slate-800 p-3 rounded-xl">
            <span className="text-xs text-slate-400">
              {stats.scope === "own" ? "My Emails" : "Total Queue"}
            </span>
            <div className="text-2xl font-bold mt-1">{stats.totalEmails ?? 0}</div>
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

      {/* Tabs */}
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
        {(isSuperAdmin() || can("gmail") || can("smtp_view") || can("smtp_add")) && (
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

      <main className="p-4 space-y-4">
        {activeTab === "compose" && can("compose") && (
          <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-4">
            <h2 className="font-semibold mb-2">Compose Email</h2>
            <p className="text-sm text-slate-400">
              Full composer UI is available. Use Templates tab for HTML bodies,
              then send from queue or manual flow.
            </p>
            <RichTextComposer
              value=""
              onChange={() => {}}
            />
          </div>
        )}

        {activeTab === "dashboard" && can("dashboard") && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">Live Queue & Opens</h2>
              <button
                onClick={loadDashboardData}
                className="text-sm px-3 py-1 rounded bg-slate-800 hover:bg-slate-700 flex items-center gap-1"
              >
                <RefreshCw className="h-3.5 w-3.5" /> Refresh
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
                      <td colSpan={4} className="p-4 text-slate-500 text-center">
                        No queue items
                      </td>
                    </tr>
                  ) : (
                    queueItems.map((item: any) => (
                      <tr key={item.id} className="border-t border-slate-800">
                        <td className="p-2">{item.email}</td>
                        <td className="p-2">{item.status}</td>
                        <td className="p-2">{item.openCount ?? 0}</td>
                        <td className="p-2 text-slate-400">{item.referenceNo}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <div>
              <h3 className="font-medium text-sm text-slate-300 mb-2">
                Recent Opens
              </h3>
              <div className="space-y-1">
                {recentOpens.length === 0 ? (
                  <p className="text-slate-500 text-sm">No opens yet</p>
                ) : (
                  recentOpens.map((op: any) => (
                    <div
                      key={op.id}
                      className="text-sm border border-slate-800 rounded-lg p-2 flex justify-between"
                    >
                      <span>
                        {op.email || "—"}{" "}
                        <span className="text-slate-500">
                          ({op.source || "auto"})
                        </span>
                      </span>
                      <span className="text-slate-500 text-xs">
                        {op.openedAt
                          ? new Date(op.openedAt).toLocaleString()
                          : ""}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === "admin" && can("admin_panel") && (
          <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-4">
            <h2 className="font-semibold mb-3 flex items-center gap-2">
              <Users className="h-4 w-4" /> Users / Operators
            </h2>
            <p className="text-xs text-slate-500 mb-3">
              Super Admin can grant any permissions to operators. Operators only
              see their own sent/opens stats.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-slate-400">
                  <tr>
                    <th className="text-left p-2">User</th>
                    <th className="text-left p-2">Role</th>
                    <th className="text-left p-2">Sent</th>
                    <th className="text-left p-2">Permissions</th>
                  </tr>
                </thead>
                <tbody>
                  {adminUsers.map((u: any) => (
                    <tr key={u.id} className="border-t border-slate-800">
                      <td className="p-2">{u.username}</td>
                      <td className="p-2">{u.role}</td>
                      <td className="p-2 text-emerald-400">{u.sentToday ?? 0}</td>
                      <td className="p-2 text-xs text-slate-400">
                        {(u.permissions || []).join(", ") || "defaults"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === "sheets_importer" && can("sheets") && (
          <div className="text-slate-400 text-sm">Google Sheets / import panel</div>
        )}
        {activeTab === "gmail_accounts" &&
          (isSuperAdmin() || can("gmail") || can("smtp_view")) && (
            <div className="text-slate-400 text-sm">SMTP / Gmail accounts panel</div>
          )}
        {activeTab === "templates" && can("templates") && (
          <div className="text-slate-400 text-sm">HTML Templates Studio</div>
        )}
        {activeTab === "campaigns_tab" && can("campaigns") && (
          <div className="text-slate-400 text-sm">Campaigns panel</div>
        )}
      </main>
    </div>
  );
}
