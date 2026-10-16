#!/usr/bin/env node
/** Patch page.tsx for Manager read-only progress panel + login tab. */
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
if (text.includes("isManagerOnly") && text.includes("Team Progress")) {
  console.log("patch-manager-page: already applied");
  process.exit(0);
}

function patch(oldStr, newStr, label) {
  if (!text.includes(oldStr)) {
    console.log("Skip:", label);
    return;
  }
  text = text.split(oldStr).join(newStr);
  console.log("Patched:", label);
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

if (!text.includes("isManagerOnly")) {
  const mgrHooks = `
  const isManagerOnly = !!authUser && (String(authUser.role || "").toLowerCase() === "manager" || String(authUser.username || "").toLowerCase() === "manager");
  const [managerPeople, setManagerPeople] = useState<any[]>([]);
  const [managerTotals, setManagerTotals] = useState({ totalToday: 0, totalMonth: 0, dayKey: "", monthKey: "" });
  const [managerLoading, setManagerLoading] = useState(false);
  const loadManagerProgress = async () => {
    try {
      setManagerLoading(true);
      const res = await fetch("/api/progress", { headers: authHeaders() });
      const data = await res.json();
      if (data.success) {
        setManagerPeople(data.people || []);
        setManagerTotals({ totalToday: data.totalToday || 0, totalMonth: data.totalMonth || 0, dayKey: data.dayKey || "", monthKey: data.monthKey || "" });
      }
    } catch {}
    finally { setManagerLoading(false); }
  };
  useEffect(() => {
    if (!isManagerOnly) return;
    loadManagerProgress();
    const id = setInterval(loadManagerProgress, 30000);
    return () => clearInterval(id);
  }, [isManagerOnly]);

  if (isManagerOnly) {
    return (
      <div className="min-h-screen bg-slate-950 text-white p-6">
        <div className="max-w-3xl mx-auto">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-2xl font-bold">Team Progress</h1>
              <p className="text-slate-400 text-sm">PST day {managerTotals.dayKey || "—"} · Month {managerTotals.monthKey || "—"}</p>
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={loadManagerProgress} className="px-3 py-1.5 rounded bg-slate-800 text-sm border border-slate-700">Refresh</button>
              <button type="button" onClick={() => { setAuthUser(null); try { localStorage.clear(); } catch {} }} className="px-3 py-1.5 rounded bg-red-900/40 text-sm border border-red-800">Logout</button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4 mb-6">
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
              <p className="text-xs text-slate-400 uppercase">Total Today (PST)</p>
              <p className="text-3xl font-bold text-emerald-400">{managerTotals.totalToday}</p>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
              <p className="text-xs text-slate-400 uppercase">Total This Month</p>
              <p className="text-3xl font-bold text-blue-400">{managerTotals.totalMonth}</p>
            </div>
          </div>
          <div className="rounded-xl border border-slate-800 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-900 text-slate-400 text-left">
                <tr>
                  <th className="p-3">Name</th>
                  <th className="p-3">Role</th>
                  <th className="p-3">Workspace</th>
                  <th className="p-3 text-right">Today</th>
                  <th className="p-3 text-right">Month</th>
                </tr>
              </thead>
              <tbody>
                {managerLoading && managerPeople.length === 0 ? (
                  <tr><td colSpan={5} className="p-6 text-center text-slate-500">Loading…</td></tr>
                ) : managerPeople.length === 0 ? (
                  <tr><td colSpan={5} className="p-6 text-center text-slate-500">No data yet</td></tr>
                ) : (
                  managerPeople.map((p: any) => (
                    <tr key={String(p.id) + p.username} className="border-t border-slate-800/80">
                      <td className="p-3 font-medium">{p.username}</td>
                      <td className="p-3 text-slate-400">{p.role}</td>
                      <td className="p-3 text-slate-400">{p.workspace}</td>
                      <td className="p-3 text-right text-emerald-400 font-semibold">{p.sentToday}</td>
                      <td className="p-3 text-right text-blue-400 font-semibold">{p.sentMonth}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-slate-500 mt-4">Auto + manual sends. Day resets 00:00 PST. Month starts on the 1st (PST).</p>
        </div>
      </div>
    );
  }
`;
  if (text.includes("if (!authUser) {")) {
    text = text.replace("if (!authUser) {", mgrHooks + "\n  if (!authUser) {");
    console.log("manager panel injected");
  } else {
    console.warn("authUser gate not found");
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

fs.writeFileSync(FILE, text);
console.log("patch-manager-page: done", text.length);
