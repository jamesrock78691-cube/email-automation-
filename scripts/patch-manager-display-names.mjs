#!/usr/bin/env node
/**
 * 1) progress API: store/load display names for manager view
 * 2) page.tsx: super admin can edit names; manager sees displayName
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const progressPath = path.join(root, "src", "app", "api", "progress", "route.ts");
const pagePath = path.join(root, "src", "app", "page.tsx");

function patchProgress() {
  if (!fs.existsSync(progressPath)) {
    console.log("skip progress — missing");
    return;
  }
  let t = fs.readFileSync(progressPath, "utf8");
  if (t.includes("DISPLAY_KEY") && t.includes("loadDisplayNames")) {
    console.log("progress already has display names");
    return;
  }

  if (!t.includes("DISPLAY_KEY")) {
    t = t.replace(
      'const VISIBLE_KEY = "manager_visible_users";',
      'const VISIBLE_KEY = "manager_visible_users";\nconst DISPLAY_KEY = "manager_display_names";'
    );
  }

  if (!t.includes("async function loadDisplayNames")) {
    const helper = `
async function loadDisplayNames(): Promise<Record<string, string>> {
  try {
    const key = settingKey(DISPLAY_KEY, MAIN_WORKSPACE);
    const rows = await db.select().from(settings).where(eq(settings.key, key)).limit(1);
    if (!rows.length) return {};
    const parsed = JSON.parse(rows[0].value || "{}");
    if (!parsed || typeof parsed !== "object") return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) {
      const name = String(v || "").trim();
      if (name) out[String(k)] = name;
    }
    return out;
  } catch {
    return {};
  }
}

async function saveDisplayNames(map: Record<string, string>) {
  const key = settingKey(DISPLAY_KEY, MAIN_WORKSPACE);
  const clean: Record<string, string> = {};
  for (const [k, v] of Object.entries(map || {})) {
    const id = String(k).trim();
    const name = String(v || "").trim();
    if (id && name) clean[id] = name;
  }
  const str = JSON.stringify(clean);
  const rows = await db.select().from(settings).where(eq(settings.key, key)).limit(1);
  if (rows.length) {
    await db.update(settings).set({ value: str }).where(eq(settings.key, key));
  } else {
    await db.insert(settings).values({ key, value: str });
  }
  return clean;
}
`;
    t = t.replace(
      /async function saveVisibleIds\(ids: number\[\]\) \{[\s\S]*?\n\}\n\nfunction normalizeRole/,
      (m) => m.replace("\n\nfunction normalizeRole", helper + "\nfunction normalizeRole")
    );
    if (!t.includes("loadDisplayNames")) {
      // fallback insert after saveVisibleIds closing
      t = t.replace(
        "function normalizeRole(role: string): string {",
        helper + "\nfunction normalizeRole(role: string): string {"
      );
    }
  }

  if (!t.includes("const displayNames = await loadDisplayNames")) {
    t = t.replace(
      "const visibleIds = await loadVisibleIds();",
      "const visibleIds = await loadVisibleIds();\n    const displayNames = await loadDisplayNames();"
    );
  }

  if (!t.includes("displayName: string")) {
    t = t.replace(
      "username: string;\n      role: string;",
      "username: string;\n      displayName: string;\n      role: string;"
    );
  }

  if (!t.includes("displayNames[String(id)]")) {
    t = t.replace(
      `people.push({
        id,
        username: String(u.username),
        role: r,
        workspace: ws,
        sentToday,
        sentMonth,
        totalSent,
        visibleToManager,
      });`,
      `const uname = String(u.username);
      const custom = displayNames[String(id)] || displayNames[uname] || "";
      people.push({
        id,
        username: uname,
        displayName: custom || uname,
        role: r,
        workspace: ws,
        sentToday,
        sentMonth,
        totalSent,
        visibleToManager,
      });`
    );
  }

  if (!t.includes("displayNames: isSuperAdmin")) {
    t = t.replace(
      "visibilityConfigured: visibleIds !== null,",
      "visibilityConfigured: visibleIds !== null,\n      displayNames: isSuperAdmin(session) ? displayNames : undefined,"
    );
  }

  if (!t.includes('action === "set_display_names"')) {
    t = t.replace(
      `await saveVisibleIds(ids);
      return NextResponse.json({ success: true, visibleUserIds: ids });
    }

    return NextResponse.json(
      { success: false, error: "Unknown action" },`,
      `await saveVisibleIds(ids);
      let savedNames: Record<string, string> | undefined;
      if (body.displayNames && typeof body.displayNames === "object") {
        savedNames = await saveDisplayNames(body.displayNames);
      }
      return NextResponse.json({
        success: true,
        visibleUserIds: ids,
        displayNames: savedNames,
      });
    }

    if (action === "set_display_names") {
      const map = body.displayNames ?? body.names ?? {};
      if (!map || typeof map !== "object") {
        return NextResponse.json(
          { success: false, error: "displayNames must be an object" },
          { status: 400 }
        );
      }
      const saved = await saveDisplayNames(map);
      return NextResponse.json({ success: true, displayNames: saved });
    }

    return NextResponse.json(
      { success: false, error: "Unknown action" },`
    );
  }

  fs.writeFileSync(progressPath, t);
  console.log("progress: display names patched");
}

function patchPage() {
  if (!fs.existsSync(pagePath)) {
    console.log("skip page — missing");
    return;
  }
  let t = fs.readFileSync(pagePath, "utf8");

  if (!t.includes("managerDisplayNames")) {
    if (t.includes('const [managerSaveMsg, setManagerSaveMsg] = useState("");')) {
      t = t.replace(
        'const [managerSaveMsg, setManagerSaveMsg] = useState("");',
        'const [managerSaveMsg, setManagerSaveMsg] = useState("");\n  const [managerDisplayNames, setManagerDisplayNames] = useState<Record<string, string>>({});'
      );
      console.log("page: managerDisplayNames state");
    }
  }

  // load display names from API
  if (!t.includes("setManagerDisplayNames(dn)") && t.includes("setManagerTotals(")) {
    t = t.replace(
      /setManagerTotals\(\{\s*totalToday: data\.totalToday \|\| 0,\s*totalMonth: data\.totalMonth \|\| 0,\s*dayKey: data\.dayKey \|\| "",\s*monthKey: data\.monthKey \|\| "",\s*\}\);/,
      `setManagerTotals({
          totalToday: data.totalToday || 0,
          totalMonth: data.totalMonth || 0,
          dayKey: data.dayKey || "",
          monthKey: data.monthKey || "",
        });
        const dn: Record<string, string> = {};
        if (data.displayNames && typeof data.displayNames === "object") {
          for (const [k, v] of Object.entries(data.displayNames)) {
            if (v) dn[String(k)] = String(v);
          }
        }
        for (const p of (data.allPeople || data.people || []) as any[]) {
          const id = String(p.id);
          if (p.displayName && p.displayName !== p.username) dn[id] = String(p.displayName);
          else if (!dn[id] && p.username) dn[id] = String(p.username);
        }
        setManagerDisplayNames(dn);`
    );
    console.log("page: load display names");
  }

  // save with displayNames
  if (t.includes('action: "set_visible", userIds: managerVisibleIds })') && !t.includes("displayNames: managerDisplayNames")) {
    t = t.replace(
      'action: "set_visible", userIds: managerVisibleIds }',
      'action: "set_visible", userIds: managerVisibleIds, displayNames: managerDisplayNames }'
    );
    t = t.replace(
      "Saved — manager will only see selected people.",
      "Saved — visibility + display names for manager."
    );
    console.log("page: save displayNames");
  }

  // manager sees displayName
  if (!t.includes("p.displayName || p.username")) {
    t = t.replace(
      '<td className="p-3 font-medium">{p.username}</td>',
      '<td className="p-3 font-medium">{p.displayName || p.username}</td>'
    );
    console.log("page: manager displayName column");
  }

  // super admin editable name input (only if table still has plain username cell after checkbox)
  if (!t.includes("managerDisplayNames[String(id)]") && t.includes("<td className=\"p-2 font-medium\">{p.username}</td>")) {
    t = t.replace(
      '<td className="p-2 font-medium">{p.username}</td>',
      `<td className="p-2">
                            <input
                              type="text"
                              className="w-full min-w-[120px] rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm text-white"
                              value={managerDisplayNames[String(id)] ?? p.displayName ?? p.username ?? ""}
                              placeholder={p.username}
                              onChange={(e) => {
                                const val = e.target.value;
                                setManagerDisplayNames((prev) => ({ ...prev, [String(id)]: val }));
                              }}
                            />
                            <p className="text-[10px] text-slate-500 mt-0.5">login: {p.username}</p>
                          </td>`
    );
    t = t.replace(
      ">Name</th>",
      ">Display name (manager sees this)</th>"
    );
    t = t.replace(
      ">Save visibility</button>",
      ">Save visibility + names</button>"
    );
    console.log("page: super admin name inputs");
  }

  fs.writeFileSync(pagePath, t);
  console.log("page: display names done");
}

patchProgress();
patchPage();
console.log("patch-manager-display-names: done");
