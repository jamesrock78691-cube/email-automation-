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
  Users
} from "lucide-react";

import { analyzeSpamRisk } from "@/lib/spamChecker";
import { quillToEmailHtml } from "@/lib/quillToEmailHtml";

const RichTextComposer = dynamic(() => import("../components/RichTextComposer"), { ssr: false });

const DEFAULT_SHEETS_CSV = `Reference No,Serial No,Mark Name,Filing Date,Email,CC,BCC,Subject,Template,Attachment
`;

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
  const [loginPanel, setLoginPanel] = useState<"admin" | "operator">("admin");

  const can = (perm: string) => {
    if (!authUser) return false;
    if (authUser.role === "super_admin") return true;
    const perms = authUser.permissions || [];
    if (perms.length) return perms.includes(perm);
    if (authUser.role === "admin") {
      return [
        "compose", "dashboard", "sheets", "gmail", "templates", "campaigns",
        "admin_panel", "smtp_add", "manage_users",
      ].includes(perm);
    }
    return perm === "compose" || perm === "templates";
  };

  const isSuperAdmin = () =>
    !!authUser &&
    (authUser.role === "super_admin" ||
      authUser.username === "admin" ||
      authUser.username === "superadmin");

  useEffect(() => {
    // bootstrap auth check
    (async () => {
      try {
        const saved = typeof window !== "undefined" ? localStorage.getItem("ea_token") : null;
        if (!saved) {
          setAuthChecked(true);
          return;
        }
        setAuthToken(saved);
        const res = await fetch("/api/auth?action=me", {
          headers: { Authorization: `Bearer ${saved}` },
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
    if (authUser) {
      if (authUser.role !== "super_admin" && authUser.role !== "admin") {
        const perms = authUser.permissions || [];
        const order = ["compose", "dashboard", "sheets", "gmail", "templates", "campaigns", "admin_panel"];
        const tabMap: Record<string, string> = {
          compose: "compose",
          dashboard: "dashboard",
          sheets: "sheets_importer",
          gmail: "gmail_accounts",
          templates: "templates",
          campaigns: "campaigns_tab",
          admin_panel: "admin",
        };
        const first = order.find((p) => perms.includes(p));
        if (first && tabMap[first]) setActiveTab(tabMap[first]);
      }
    }
  }, [authUser]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
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
        setSuccessMsg(`Welcome, ${data.user.username}`);
      } else {
        setErrorMsg(data.error || "Login failed");
      }
    } catch (err: any) {
      setErrorMsg(err.message || "Login error");
    } finally {
      setLoading(false);
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
        <form onSubmit={handleLogin} className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
          <h1 className="text-xl font-bold">Email Automation Login</h1>
          {errorMsg && <p className="text-rose-400 text-sm">{errorMsg}</p>}
          {successMsg && <p className="text-emerald-400 text-sm">{successMsg}</p>}
          <div className="flex gap-2">
            <button type="button" onClick={() => setLoginPanel("admin")} className={`flex-1 py-2 rounded ${loginPanel === "admin" ? "bg-blue-600" : "bg-slate-800"}`}>Admin</button>
            <button type="button" onClick={() => setLoginPanel("operator")} className={`flex-1 py-2 rounded ${loginPanel === "operator" ? "bg-blue-600" : "bg-slate-800"}`}>Operator</button>
          </div>
          <input className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2" placeholder="Username" value={loginForm.username} onChange={(e) => setLoginForm({ ...loginForm, username: e.target.value })} />
          <input type="password" className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2" placeholder="Password" value={loginForm.password} onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })} />
          <button type="submit" disabled={loading} className="w-full bg-blue-600 hover:bg-blue-500 rounded py-2 font-medium">{loading ? "..." : "Login"}</button>
        </form>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 px-4 py-3 flex items-center justify-between">
        <div className="font-semibold">Email Automation Dashboard</div>
        <div className="flex items-center gap-3 text-sm">
          <span>{authUser.username} ({authUser.role})</span>
          <button onClick={handleLogout} className="text-slate-400 hover:text-white">Logout</button>
        </div>
      </header>

      <div className="flex flex-wrap gap-2 border-b border-slate-800 px-4 py-2">
        {can("compose") && (
          <button onClick={() => setActiveTab("compose")} className={`px-3 py-1.5 rounded text-sm ${activeTab === "compose" ? "bg-blue-600" : "bg-slate-800"}`}>Compose</button>
        )}
        {can("dashboard") && (
          <button onClick={() => setActiveTab("dashboard")} className={`px-3 py-1.5 rounded text-sm ${activeTab === "dashboard" ? "bg-blue-600" : "bg-slate-800"}`}>Live Queue</button>
        )}
        {can("sheets") && (
          <button onClick={() => setActiveTab("sheets_importer")} className={`px-3 py-1.5 rounded text-sm ${activeTab === "sheets_importer" ? "bg-blue-600" : "bg-slate-800"}`}>Sheets</button>
        )}
        {(isSuperAdmin() || can("gmail") || can("smtp_view") || can("smtp_add")) && (
          <button onClick={() => setActiveTab("gmail_accounts")} className={`px-3 py-1.5 rounded text-sm ${activeTab === "gmail_accounts" ? "bg-blue-600" : "bg-slate-800"}`}>SMTP</button>
        )}
        {can("templates") && (
          <button onClick={() => setActiveTab("templates")} className={`px-3 py-1.5 rounded text-sm ${activeTab === "templates" ? "bg-blue-600" : "bg-slate-800"}`}>Templates</button>
        )}
        {can("campaigns") && (
          <button onClick={() => setActiveTab("campaigns_tab")} className={`px-3 py-1.5 rounded text-sm ${activeTab === "campaigns_tab" ? "bg-blue-600" : "bg-slate-800"}`}>Campaigns</button>
        )}
        {can("admin_panel") && (
          <button onClick={() => setActiveTab("admin")} className={`px-3 py-1.5 rounded text-sm ${activeTab === "admin" ? "bg-blue-600" : "bg-slate-800"}`}>Admin</button>
        )}
      </div>

      <main className="p-4">
        {activeTab === "compose" && (
          <div className="text-slate-300">Compose Email panel — full UI loading from modules. Permissions active.</div>
        )}
        {activeTab === "dashboard" && can("dashboard") && (
          <div className="text-slate-300">Live Queue & Run Panel</div>
        )}
        {activeTab === "sheets_importer" && can("sheets") && (
          <div className="text-slate-300">Google Sheets Simulator</div>
        )}
        {activeTab === "gmail_accounts" && (isSuperAdmin() || can("gmail") || can("smtp_view")) && (
          <div className="text-slate-300">Gmail & SMTP Rotators</div>
        )}
        {activeTab === "templates" && can("templates") && (
          <div className="text-slate-300">HTML Templates Studio</div>
        )}
        {activeTab === "campaigns_tab" && can("campaigns") && (
          <div className="text-slate-300">Outreach Campaigns</div>
        )}
        {activeTab === "admin" && can("admin_panel") && (
          <div className="text-slate-300">Admin Panel — manage users & grant operator permissions from here after full UI restore.</div>
        )}
        {errorMsg && <p className="text-rose-400 mt-4">{errorMsg}</p>}
        {successMsg && <p className="text-emerald-400 mt-4">{successMsg}</p>}
      </main>
    </div>
  );
}
