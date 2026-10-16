#!/usr/bin/env node
/**
 * Manager read-only progress panel.
 * Hooks MUST be injected BEFORE any early returns (authChecked / authUser)
 * or React will crash the login page.
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

// Strip previous broken injection if present
if (text.includes("isManagerOnly") || text.includes("Team Progress")) {
  const start = text.indexOf("const isManagerOnly");
  if (start >= 0) {
    let end = text.indexOf("// Login screen", start);
    if (end < 0) end = text.indexOf("if (!authUser) {", start);
    if (end > start) {
      text = text.slice(0, start) + text.slice(end);
      console.log("patch-manager-page: stripped previous manager injection");
    }
  }
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

const HOOKS = `
  const isManagerOnly = !!authUser && (String(authUser.role || "").toLowerCase() === "manager" || String(authUser.username || "").toLowerCase() === "manager");
  const [managerPeople, setManagerPeople] = useState<any[]>([]);
  const [managerTotals, setManagerTotals] = useState({ totalToday: 0, totalMonth: 0, dayKey: "", monthKey: "" });
  const [managerLoading, setManagerLoading] = useState(false);
`;

if (!text.includes("isManagerOnly")) {
  const anchor = 'const [loginPanel, setLoginPanel] = useState<"admin" | "operator" | "manager">("admin");';
  const anchor2 = 'const [loginPanel, setLoginPanel] = useState<"admin" | "operator">("admin");';
  if (text.includes(anchor)) {
    text = text.replace(anchor, anchor + "\n" + HOOKS);
    console.log("hooks after loginPanel (mgr type)");
  } else if (text.includes(anchor2)) {
    text = text.replace(anchor2, anchor2 + "\n" + HOOKS);
    console.log("hooks after loginPanel");
  } else {
    const a3 = "const [authChecked, setAuthChecked] = useState(false);";
    if (text.includes(a3)) {
      text = text.replace(a3, a3 + "\n" + HOOKS);
      console.log("hooks after authChecked");
    } else {
      console.warn("no hooks anchor");
    }
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
  useEffect(() => {
    if (!isManagerOnly) return;
    loadManagerProgress();
    const id = setInterval(loadManagerProgress, 30000);
    return () => clearInterval(id);
  }, [isManagerOnly]);
`;

if (!text.includes("loadManagerProgress")) {
  if (text.includes("// Loading auth")) {
    text = text.replace("// Loading auth", EFFECT + "\n  // Loading auth");
    console.log("effect before Loading auth");
  } else if (text.includes("if (!authChecked)")) {
    text = text.replace("if (!authChecked)", EFFECT + "\n  if (!authChecked)");
    console.log("effect before authChecked return");
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

if (!text.includes("Team Progress")) {
  if (text.includes("// Login screen")) {
    text = text.replace("// Login screen", VIEW + "  // Login screen");
    console.log("manager view before Login screen");
  } else if (text.includes("if (!authUser) {")) {
    text = text.replace(
      "// Login screen — separate Admin/Super Admin vs Operator panels\n  if (!authUser) {",
      VIEW + "  // Login screen — separate Admin/Super Admin vs Operator panels\n  if (!authUser) {"
    );
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
  console.error("FATAL: isManagerOnly still after authChecked return — hooks order broken");
  process.exit(1);
}

fs.writeFileSync(FILE, text);
console.log("patch-manager-page: done", text.length);
