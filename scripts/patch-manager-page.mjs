#!/usr/bin/env node
/**
 * Manager progress panel + Super Admin "Team Progress" TAB (not on main home).
 * Manager: only totals (today/month), no auto/manual split.
 * Hooks before any early returns.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FILE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "src",
  "app",
  "page.tsx"
);
if (!fs.existsSync(FILE)) {
  console.log("patch-manager-page: no page.tsx");
  process.exit(0);
}
let text = fs.readFileSync(FILE, "utf8");

if (text.includes("Manager Progress Visibility")) {
  const start = text.indexOf("{/* Manager Progress Visibility");
  if (start >= 0) {
    const endMarker = "{/* Global Stats Grid";
    const end = text.indexOf(endMarker, start);
    if (end > start) {
      text = text.slice(0, start) + text.slice(end);
      console.log("removed main-page visibility panel");
    }
  }
}

if (text.includes("const isManagerOnly")) {
  const start = text.indexOf("const isManagerOnly");
  const chk = text.indexOf("if (!authChecked)");
  if (start > chk && chk > 0) {
    let end = text.indexOf("// Login screen", start);
    if (end < 0) end = text.indexOf("if (!authUser) {", start);
    if (end > start) {
      text = text.slice(0, start) + text.slice(end);
      console.log("stripped broken hooks after authChecked");
    }
  }
}

function patch(oldStr, newStr, label) {
  if (!text.includes(oldStr)) {
    console.log("Skip:", label);
    return false;
  }
  text = text.split(oldStr).join(newStr);
  console.log("Patched:", label);
  return true;
}

patch(
  'useState<"admin" | "operator">("admin")',
  'useState<"admin" | "operator" | "manager">("admin")',
  "login panel type"
);
patch(
  'placeholder={loginPanel === "operator" ? "operator" : "admin / superadmin"}',
  'placeholder={loginPanel === "operator" ? "operator" : loginPanel === "manager" ? "manager" : "admin / superadmin"}',
  "placeholder"
);

const HOOKS = `
  const isManagerOnly = !!authUser && (String(authUser.role || "").toLowerCase() === "manager" || String(authUser.username || "").toLowerCase() === "manager");
  const isSuperAdminUser = !!authUser && (String(authUser.role || "").toLowerCase() === "super_admin" || String(authUser.role || "").toLowerCase() === "superadmin" || ["admin","superadmin"].includes(String(authUser.username || "").toLowerCase()));
  const [managerPeople, setManagerPeople] = useState<any[]>([]);
  const [managerAllPeople, setManagerAllPeople] = useState<any[]>([]);
  const [managerVisibleIds, setManagerVisibleIds] = useState<number[]>([]);
  const [managerTotals, setManagerTotals] = useState({ totalToday: 0, totalMonth: 0, dayKey: "", monthKey: "" });
  const [managerLoading, setManagerLoading] = useState(false);
  const [managerSaveMsg, setManagerSaveMsg] = useState("");
`;

if (!text.includes("isManagerOnly")) {
  const anchor = 'const [loginPanel, setLoginPanel] = useState<"admin" | "operator" | "manager">("admin");';
  const anchor2 = 'const [loginPanel, setLoginPanel] = useState<"admin" | "operator">("admin");';
  if (text.includes(anchor)) {
    text = text.replace(anchor, anchor + "\n" + HOOKS);
    console.log("hooks after loginPanel (mgr)");
  } else if (text.includes(anchor2)) {
    text = text.replace(anchor2, anchor2 + "\n" + HOOKS);
    console.log("hooks after loginPanel");
  } else {
    const a3 = "const [authChecked, setAuthChecked] = useState(false);";
    if (text.includes(a3)) text = text.replace(a3, a3 + "\n" + HOOKS);
  }
}

const EFFECT = `
  const loadManagerProgress = async () => {
    try {
      setManagerLoading(true);
      const res = await fetch("/api/progress", { headers: authHeaders() });
      const data = await res.json();
      if (data.success) {
        setManagerPeople(data.people || []);
        setManagerAllPeople(data.allPeople || data.people || []);
        setManagerVisibleIds(
          Array.isArray(data.visibleUserIds)
            ? data.visibleUserIds.map((x: any) => Number(x))
            : (data.allPeople || data.people || []).map((p: any) => Number(p.id))
        );
        setManagerTotals({
          totalToday: data.totalToday || 0,
          totalMonth: data.totalMonth || 0,
          dayKey: data.dayKey || "",
          monthKey: data.monthKey || "",
        });
      }
    } catch {}
    finally { setManagerLoading(false); }
  };
  const saveManagerVisibility = async () => {
    try {
      setManagerSaveMsg("");
      const res = await fetch("/api/progress", {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ action: "set_visible", userIds: managerVisibleIds }),
      });
      const data = await res.json();
      if (data.success) {
        setManagerSaveMsg("Saved — manager will only see selected people.");
        await loadManagerProgress();
      } else setManagerSaveMsg(data.error || "Save failed");
    } catch (e: any) {
      setManagerSaveMsg(e?.message || "Save failed");
    }
  };
  useEffect(() => {
    if (!isManagerOnly && !isSuperAdminUser) return;
    loadManagerProgress();
    const id = setInterval(loadManagerProgress, 30000);
    return () => clearInterval(id);
  }, [isManagerOnly, isSuperAdminUser]);
  useEffect(() => {
    if (activeTab === "team_progress" && isSuperAdminUser) loadManagerProgress();
  }, [activeTab, isSuperAdminUser]);
`;

if (!text.includes("loadManagerProgress")) {
  if (text.includes("// Loading auth")) {
    text = text.replace("// Loading auth", EFFECT + "\n  // Loading auth");
    console.log("effect before Loading auth");
  } else if (text.includes("if (!authChecked)")) {
    text = text.replace("if (!authChecked)", EFFECT + "\n  if (!authChecked)");
  }
} else if (!text.includes('activeTab === "team_progress"')) {
  if (text.includes("[isManagerOnly, isSuperAdminUser]")) {
    text = text.replace(
      "[isManagerOnly, isSuperAdminUser]);",
      `[isManagerOnly, isSuperAdminUser]);
  useEffect(() => {
    if (activeTab === "team_progress" && isSuperAdminUser) loadManagerProgress();
  }, [activeTab, isSuperAdminUser]);`
    );
    console.log("added team_progress tab effect");
  }
}

const VIEW = `
  if (isManagerOnly) {
    return (
      <div className="min-h-screen bg-slate-950 text-white p-6">
        <div className="max-w-3xl mx-auto">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-2xl font-bold">Team Progress</h1>
              <p className="text-slate-400 text-sm">Total sent only · PST day {managerTotals.dayKey || "—"} · Month {managerTotals.monthKey || "—"}</p>
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={loadManagerProgress} className="px-3 py-1.5 rounded bg-slate-800 text-sm border border-slate-700">Refresh</button>
              <button type="button" onClick={() => { setAuthUser(null); try { localStorage.clear(); } catch {} }} className="px-3 py-1.5 rounded bg-red-900/40 text-sm border border-red-800">Logout</button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4 mb-6">
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
              <p className="text-xs text-slate-400 uppercase">Total Sent Today</p>
              <p className="text-3xl font-bold text-emerald-400">{managerTotals.totalToday}</p>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
              <p className="text-xs text-slate-400 uppercase">Total Sent This Month</p>
              <p className="text-3xl font-bold text-blue-400">{managerTotals.totalMonth}</p>
            </div>
          </div>
          <div className="rounded-xl border border-slate-800 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-900 text-slate-400 text-left">
                <tr>
                  <th className="p-3">Name</th>
                  <th className="p-3">Workspace</th>
                  <th className="p-3 text-right">Sent Today</th>
                  <th className="p-3 text-right">Sent Month</th>
                </tr>
              </thead>
              <tbody>
                {managerLoading && managerPeople.length === 0 ? (
                  <tr><td colSpan={4} className="p-6 text-center text-slate-500">Loading…</td></tr>
                ) : managerPeople.length === 0 ? (
                  <tr><td colSpan={4} className="p-6 text-center text-slate-500">No data yet</td></tr>
                ) : (
                  managerPeople.map((p: any) => (
                    <tr key={String(p.id) + p.username} className="border-t border-slate-800/80">
                      <td className="p-3 font-medium">{p.username}</td>
                      <td className="p-3 text-slate-400">{p.workspace}</td>
                      <td className="p-3 text-right text-emerald-400 font-semibold">{p.sentToday}</td>
                      <td className="p-3 text-right text-blue-400 font-semibold">{p.sentMonth}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-slate-500 mt-4">Includes auto + manual sends as one total. Day resets 00:00 PST. Month from the 1st (PST).</p>
        </div>
      </div>
    );
  }

`;

if (!text.includes("Total Sent This Month") && !text.includes("Team Progress")) {
  if (text.includes("// Login screen")) {
    text = text.replace("// Login screen", VIEW + "  // Login screen");
    console.log("manager view injected");
  }
}

const TAB_BTN = `
          {isSuperAdminUser && (
            <button
              onClick={() => setActiveTab("team_progress")}
              className={
                activeTab === "team_progress"
                  ? "flex items-center gap-2 px-5 py-3 text-sm font-semibold border-b-2 transition border-indigo-500 text-indigo-400"
                  : "flex items-center gap-2 px-5 py-3 text-sm font-semibold border-b-2 transition border-transparent text-slate-400 hover:text-white"
              }
            >
              Team Progress
            </button>
          )}
`;

if (!text.includes('setActiveTab("team_progress")')) {
  if (text.includes("Admin Panel")) {
    const navClose = text.indexOf("        </div>\n\n\n        {/* Tab 1: Dashboard Panel */}");
    if (navClose > 0) {
      text = text.slice(0, navClose) + TAB_BTN + "\n" + text.slice(navClose);
      console.log("team_progress tab button injected");
    } else {
      const m = text.indexOf("{/* Tab 1: Dashboard Panel */}");
      if (m > 0) {
        const prev = text.lastIndexOf("</div>", m);
        text = text.slice(0, prev) + TAB_BTN + "\n        " + text.slice(prev);
        console.log("team_progress tab button injected (alt)");
      } else {
        console.warn("nav close not found");
      }
    }
  }
}

const TAB_CONTENT = `
        {activeTab === "team_progress" && isSuperAdminUser && (
          <div className="space-y-6">
            <section className="rounded-2xl border border-indigo-800/50 bg-slate-950/60 p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-bold text-white">Team Progress</h2>
                  <p className="text-xs text-slate-400">Total sent (auto + manual combined). Choose who the manager can see. PST day 00:00 · month from 1st.</p>
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={loadManagerProgress} className="px-3 py-1.5 rounded-lg bg-slate-800 text-xs border border-slate-700">Refresh</button>
                  <button type="button" onClick={saveManagerVisibility} className="px-3 py-1.5 rounded-lg bg-indigo-600 text-xs font-semibold">Save visibility</button>
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="rounded-xl border border-slate-800 p-3">
                  <p className="text-[10px] uppercase text-slate-500">Total Sent Today</p>
                  <p className="text-2xl font-bold text-emerald-400">{managerTotals.totalToday}</p>
                </div>
                <div className="rounded-xl border border-slate-800 p-3">
                  <p className="text-[10px] uppercase text-slate-500">Total Sent This Month</p>
                  <p className="text-2xl font-bold text-blue-400">{managerTotals.totalMonth}</p>
                </div>
                <div className="rounded-xl border border-slate-800 p-3">
                  <p className="text-[10px] uppercase text-slate-500">PST Day</p>
                  <p className="text-sm font-semibold text-slate-200">{managerTotals.dayKey || "—"}</p>
                </div>
                <div className="rounded-xl border border-slate-800 p-3">
                  <p className="text-[10px] uppercase text-slate-500">PST Month</p>
                  <p className="text-sm font-semibold text-slate-200">{managerTotals.monthKey || "—"}</p>
                </div>
              </div>
              {managerSaveMsg && <p className="text-xs text-indigo-300">{managerSaveMsg}</p>}
              <div className="overflow-x-auto rounded-xl border border-slate-800">
                <table className="w-full text-sm">
                  <thead className="bg-slate-900 text-slate-400 text-left">
                    <tr>
                      <th className="p-2">Manager can see</th>
                      <th className="p-2">Name</th>
                      <th className="p-2">Role</th>
                      <th className="p-2">Workspace</th>
                      <th className="p-2 text-right">Sent Today</th>
                      <th className="p-2 text-right">Sent Month</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(managerAllPeople.length ? managerAllPeople : managerPeople).map((p: any) => {
                      const id = Number(p.id);
                      const checked = managerVisibleIds.includes(id);
                      return (
                        <tr key={String(id) + p.username} className="border-t border-slate-800/80">
                          <td className="p-2">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) => {
                                if (e.target.checked) setManagerVisibleIds((prev) => Array.from(new Set([...prev, id])));
                                else setManagerVisibleIds((prev) => prev.filter((x) => x !== id));
                              }}
                            />
                          </td>
                          <td className="p-2 font-medium">{p.username}</td>
                          <td className="p-2 text-slate-400">{p.role}</td>
                          <td className="p-2 text-slate-400">{p.workspace}</td>
                          <td className="p-2 text-right text-emerald-400 font-semibold">{p.sentToday}</td>
                          <td className="p-2 text-right text-blue-400 font-semibold">{p.sentMonth}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        )}

`;

if (!text.includes("Save visibility")) {
  if (text.includes("{/* Footer information bar */}")) {
    text = text.replace(
      "{/* Footer information bar */}",
      TAB_CONTENT + "\n      {/* Footer information bar */}"
    );
    console.log("team_progress tab content injected");
  } else if (text.includes("<footer")) {
    text = text.replace("<footer", TAB_CONTENT + "\n      <footer");
    console.log("team_progress tab content before footer");
  }
}

if (text.includes(">Operator</button>") && !text.includes('setLoginPanel("manager")')) {
  text = text.replace(
    ">Operator</button>",
    `>Operator</button>
              <button
                type="button"
                onClick={() => setLoginPanel("manager")}
                className={
                  loginPanel === "manager"
                    ? "px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-semibold"
                    : "px-4 py-2 rounded-lg bg-slate-800 text-slate-300 text-sm"
                }
              >Manager</button>`
  );
  console.log("manager login button");
}

if (text.includes("const isManagerOnly") && text.indexOf("const isManagerOnly") > text.indexOf("if (!authChecked)")) {
  console.error("FATAL: hooks after authChecked");
  process.exit(1);
}

fs.writeFileSync(FILE, text);
console.log("patch-manager-page: done", text.length);
