#!/usr/bin/env node
/**
 * Restores page.tsx + auth headers.
 * Template vars: Amazon sees only mark_name+name; main keeps full set.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SOURCE =
  "https://cdn.jsdelivr.net/gh/jamesrock78691-cube/email-automation-@a92fad723695c11bb1909753ad026eb75e1c76fd/src/app/page.tsx";
const OUT = path.join(__dirname, "..", "src", "app", "page.tsx");

async function fetchText(url) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return await res.text();
}

function patch(text, oldStr, newStr, label) {
  if (!text.includes(oldStr)) {
    console.log("Skip (not found):", label);
    return text;
  }
  const count = text.split(oldStr).length - 1;
  text = text.split(oldStr).join(newStr);
  console.log(`Patched (${count}x):`, label);
  return text;
}

try {
  let text = await fetchText(SOURCE);
  if (!text.includes("EmailAutomationDashboard")) {
    throw new Error("Downloaded page looks invalid");
  }

  // 1) contentBase64 attachments
  text = patch(
    text,
    `    existing.push({
      filename: data.filename,
      originalName: data.originalName,
      path: data.path,
    });`,
    `    existing.push({
      filename: data.filename,
      originalName: data.originalName,
      path: data.path,
      contentType: data.contentType || undefined,
      size: data.size || undefined,
      contentBase64: data.contentBase64 || undefined,
    });`,
    "contentBase64 attachment"
  );

  // 2) Gmail / queue authHeaders
  text = patch(
    text,
    `      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(gmailForm),
      });`,
    `      const res = await fetch(url, {
        method,
        headers: authHeaders(),
        body: JSON.stringify(gmailForm),
      });`,
    "gmail save authHeaders"
  );
  text = patch(
    text,
    `headers: { "Content-Type": "application/json" },\n            body: JSON.stringify({ action: "process_next" }),`,
    `headers: authHeaders(),\n            body: JSON.stringify({ action: "process_next" }),`,
    "process_next auth (12-space)"
  );
  // Fix escaped newlines - use real newlines
  text = patch(
    text,
    `headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "process_next" }),`,
    `headers: authHeaders(),
            body: JSON.stringify({ action: "process_next" }),`,
    "process_next auth (12-space real)"
  );
  text = patch(
    text,
    `headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "process_next" }),`,
    `headers: authHeaders(),
        body: JSON.stringify({ action: "process_next" }),`,
    "process_next auth (8-space)"
  );
  text = patch(
    text,
    `headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "process_batch" }),`,
    `headers: authHeaders(),
        body: JSON.stringify({ action: "process_batch" }),`,
    "process_batch auth"
  );
  text = patch(
    text,
    `headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reset_all" }),`,
    `headers: authHeaders(),
        body: JSON.stringify({ action: "reset_all" }),`,
    "reset_all auth"
  );
  text = patch(
    text,
    `headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "clear_all" }),`,
    `headers: authHeaders(),
        body: JSON.stringify({ action: "clear_all" }),`,
    "clear_all auth"
  );
  text = text.replace(
    /headers:\s*\{\s*["']Content-Type["']\s*:\s*["']application\/json["']\s*\}\s*,\s*\n\s*headers:\s*authHeaders\(\)/g,
    "headers: authHeaders()"
  );
  text = patch(
    text,
    `const res = await fetch(\`/api/gmail?id=\${id}\`, { method: "DELETE" });`,
    `const res = await fetch(\`/api/gmail?id=\${id}\`, { method: "DELETE", headers: authHeaders() });`,
    "gmail delete auth"
  );
  text = patch(
    text,
    `const cRes = await fetch("/api/campaign");`,
    `const cRes = await fetch("/api/campaign", { headers: authHeaders() });`,
    "campaign list auth"
  );

  // 3) Keep FULL compose variables for main (do NOT strip)
  // Add name field alongside existing ones for Amazon
  text = patch(
    text,
    `const [composeVariables, setComposeVariables] = useState({
  reference_no: "",
  serial_no: "",
  mark_name: "",
  filing_date: "",
  email: "",
  today: new Date().toISOString().slice(0, 10),
});`,
    `const [composeVariables, setComposeVariables] = useState({
  reference_no: "",
  serial_no: "",
  mark_name: "",
  name: "",
  filing_date: "",
  email: "",
  today: new Date().toISOString().slice(0, 10),
});`,
    "composeVariables + name field"
  );

  // isAmazon helper after authUser state
  text = patch(
    text,
    `  const [authUser, setAuthUser] = useState<{
    id: number;
    username: string;
    role: string;
    permissions?: string[];
    stats?: { totalSent: number; sentToday: number; dailyLimit: number };
  } | null>(null);`,
    `  const [authUser, setAuthUser] = useState<{
    id: number;
    username: string;
    role: string;
    workspace?: string;
    permissions?: string[];
    stats?: { totalSent: number; sentToday: number; dailyLimit: number };
  } | null>(null);
  const isAmazonWs =
    String(authUser?.workspace || "").toLowerCase() === "amazon" ||
    String(authUser?.username || "").toLowerCase() === "amazon";`,
    "isAmazonWs helper"
  );

  // Help text depends on workspace
  text = patch(
    text,
    `Ye values template ke {"{{reference_no}}"}, {"{{serial_no}}"}, {"{{mark_name}}"} etc. mein auto fill hongi.`,
    `{isAmazonWs
              ? <>Amazon templates: sirf {"{{mark_name}}"} aur {"{{name}}"}</>
              : <>Ye values template ke {"{{reference_no}}"}, {"{{serial_no}}"}, {"{{mark_name}}"} etc. mein auto fill hongi.</>}`,
    "variables help text"
  );

  // Clear keeps full set + name
  text = patch(
    text,
    `            setComposeVariables({
              reference_no: "",
              serial_no: "",
              mark_name: "",
              filing_date: "",
              email: "",
              today: new Date().toISOString().slice(0, 10),
            });`,
    `            setComposeVariables({
              reference_no: "",
              serial_no: "",
              mark_name: "",
              name: "",
              filing_date: "",
              email: "",
              today: new Date().toISOString().slice(0, 10),
            });`,
    "clear variables"
  );

  text = patch(
    text,
    `setComposeVariables((prev) => ({
  ...prev,
  reference_no: "",
  serial_no: "",
  mark_name: "",
  filing_date: "",
  email: "",
}));`,
    `setComposeVariables((prev) => ({
  ...prev,
  reference_no: "",
  serial_no: "",
  mark_name: "",
  name: "",
  filing_date: "",
  email: "",
}));`,
    "clear after send"
  );

  // applyVariables — keep main aliases + name
  text = patch(
    text,
    `    // also support common aliases
    out = out.replace(/\\{\\{reference_no\\}\\}/gi, vars.reference_no || "");
    out = out.replace(/\\{\\{serial_no\\}\\}/gi, vars.serial_no || "");
    out = out.replace(/\\{\\{mark_name\\}\\}/gi, vars.mark_name || "");
    out = out.replace(/\\{\\{filing_date\\}\\}/gi, vars.filing_date || "");
    out = out.replace(/\\{\\{email\\}\\}/gi, vars.email || vars.email || "");
    out = out.replace(/\\{\\{today\\}\\}/gi, vars.today || new Date().toISOString().slice(0, 10));`,
    `    out = out.replace(/\\{\\{reference_no\\}\\}/gi, vars.reference_no || "");
    out = out.replace(/\\{\\{serial_no\\}\\}/gi, vars.serial_no || "");
    out = out.replace(/\\{\\{mark_name\\}\\}/gi, vars.mark_name || "");
    out = out.replace(/\\{\\{name\\}\\}/gi, vars.name || "");
    out = out.replace(/\\{\\{filing_date\\}\\}/gi, vars.filing_date || "");
    out = out.replace(/\\{\\{email\\}\\}/gi, vars.email || "");
    out = out.replace(/\\{\\{today\\}\\}/gi, vars.today || new Date().toISOString().slice(0, 10));`,
    "applyVariables + name"
  );

  // Inject name field after Mark Name field; hide non-amazon fields when isAmazonWs
  // Reference No block → only for main
  text = patch(
    text,
    `      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
       <div>
  <label className="text-xs font-medium text-gray-700 flex items-center gap-1.5">
    Reference No`,
    `      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
       {!isAmazonWs && (<div>
  <label className="text-xs font-medium text-gray-700 flex items-center gap-1.5">
    Reference No`,
    "hide Reference No on amazon"
  );

  // Close Reference No div and Serial No — find Serial No block and wrap
  text = patch(
    text,
    `  <p className="text-[10px] text-gray-500 mt-0.5">Template select karte hi auto milta hai (1111 se shuru)</p>
</div>
        <div>
          <label className="text-xs font-medium text-gray-700">Serial No</label>`,
    `  <p className="text-[10px] text-gray-500 mt-0.5">Template select karte hi auto milta hai (1111 se shuru)</p>
</div>)}
        {!isAmazonWs && (<div>
          <label className="text-xs font-medium text-gray-700">Serial No</label>`,
    "hide Serial No on amazon"
  );

  text = patch(
    text,
    `            placeholder="90812354"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-gray-700">Mark Name</label>`,
    `            placeholder="90812354"
          />
        </div>)}
        <div>
          <label className="text-xs font-medium text-gray-700">{isAmazonWs ? "mark_name" : "Mark Name"}</label>`,
    "close serial hide + mark label"
  );

  // After Mark Name input, insert name field (always visible for amazon, optional for main)
  text = patch(
    text,
    `            placeholder="GLOW-TECH INDUSTRIES"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-gray-700">Filing Date</label>`,
    `            placeholder="GLOW-TECH INDUSTRIES"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-gray-700">{isAmazonWs ? "name" : "Name"}</label>
          <input
            className="w-full border border-gray-300 rounded-lg px-3 py-2 mt-1 bg-white text-gray-900 text-sm"
            value={composeVariables.name}
            onChange={(e) => handleVariableChange("name", e.target.value)}
            placeholder="{{name}}"
          />
        </div>
        {!isAmazonWs && (<div>
          <label className="text-xs font-medium text-gray-700">Filing Date</label>`,
    "name field + hide filing on amazon"
  );

  text = patch(
    text,
    `            placeholder="e.g. 15 Jan 2026 or 2026-01-15"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-gray-700">Email (variable)</label>`,
    `            placeholder="e.g. 15 Jan 2026 or 2026-01-15"
          />
        </div>)}
        {!isAmazonWs && (<div>
          <label className="text-xs font-medium text-gray-700">Email (variable)</label>`,
    "hide email var on amazon"
  );

  text = patch(
    text,
    `            placeholder="client@example.com"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-gray-700">Today</label>`,
    `            placeholder="client@example.com"
          />
        </div>)}
        {!isAmazonWs && (<div>
          <label className="text-xs font-medium text-gray-700">Today</label>`,
    "hide today on amazon"
  );

  text = patch(
    text,
    `            onChange={(e) => handleVariableChange("today", e.target.value)}
          />
        </div>
      </div>`,
    `            onChange={(e) => handleVariableChange("today", e.target.value)}
          />
        </div>)}
      </div>`,
    "close today hide"
  );

  // Manual send: Amazon uses name → referenceNo
  text = patch(
    text,
    `        referenceNo: composeVariables?.reference_no || "",
serialNo: composeVariables?.serial_no || "",
markName: composeVariables?.mark_name || "",
filingDate: composeVariables?.filing_date || "",`,
    `        referenceNo: isAmazonWs
          ? composeVariables?.name || ""
          : composeVariables?.reference_no || "",
serialNo: isAmazonWs ? "" : composeVariables?.serial_no || "",
markName: composeVariables?.mark_name || "",
filingDate: isAmazonWs ? "" : composeVariables?.filing_date || "",`,
    "manual send var map amazon vs main"
  );

  if (/headers:\s*\{[^}]*\}\s*,\s*\n\s*headers:\s*/.test(text)) {
    console.error("FATAL: duplicate headers");
    process.exit(1);
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, text);
  console.log("Wrote", OUT, text.length, "bytes");
} catch (err) {
  console.error("rebuild-page failed:", err?.message || err);
  if (!fs.existsSync(OUT)) process.exit(1);
  throw err;
}
