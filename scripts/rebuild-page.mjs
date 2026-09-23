#!/usr/bin/env node
/**
 * Restores page.tsx + auth headers + only mark_name / name variables.
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
    `headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "process_next" }),`,
    `headers: authHeaders(),
            body: JSON.stringify({ action: "process_next" }),`,
    "process_next auth (12-space)"
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

  // 3) Compose variables — only mark_name + name
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
  mark_name: "",
  name: "",
});`,
    "composeVariables state"
  );

  text = patch(
    text,
    `Ye values template ke {"{{reference_no}}"}, {"{{serial_no}}"}, {"{{mark_name}}"} etc. mein auto fill hongi.`,
    `Template mein sirf {"{{mark_name}}"} aur {"{{name}}"} use karo.`,
    "variables help text"
  );

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
              mark_name: "",
              name: "",
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
    `setComposeVariables({ mark_name: "", name: "" });`,
    "clear after send"
  );

  // Apply variables — only mark_name + name aliases
  text = patch(
    text,
    `    // also support common aliases
    out = out.replace(/\\{\\{reference_no\\}\\}/gi, vars.reference_no || "");
    out = out.replace(/\\{\\{serial_no\\}\\}/gi, vars.serial_no || "");
    out = out.replace(/\\{\\{mark_name\\}\\}/gi, vars.mark_name || "");
    out = out.replace(/\\{\\{filing_date\\}\\}/gi, vars.filing_date || "");
    out = out.replace(/\\{\\{email\\}\\}/gi, vars.email || vars.email || "");
    out = out.replace(/\\{\\{today\\}\\}/gi, vars.today || new Date().toISOString().slice(0, 10));`,
    `    out = out.replace(/\\{\\{mark_name\\}\\}/gi, vars.mark_name || "");
    out = out.replace(/\\{\\{name\\}\\}/gi, vars.name || "");`,
    "applyVariables aliases"
  );

  // Replace the whole variables input grid with only mark_name + name
  const gridStart = `      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">`;
  const gridEnd = `      </div>

      {/* Template selector */}`;
  const gi = text.indexOf(gridStart);
  const ge = text.indexOf(gridEnd);
  if (gi >= 0 && ge > gi) {
    const simpleGrid = `      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-gray-700">mark_name</label>
          <input
            className="w-full border border-gray-300 rounded-lg px-3 py-2 mt-1 bg-white text-gray-900 text-sm"
            value={composeVariables.mark_name}
            onChange={(e) => handleVariableChange("mark_name", e.target.value)}
            placeholder="{{mark_name}}"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-gray-700">name</label>
          <input
            className="w-full border border-gray-300 rounded-lg px-3 py-2 mt-1 bg-white text-gray-900 text-sm"
            value={composeVariables.name}
            onChange={(e) => handleVariableChange("name", e.target.value)}
            placeholder="{{name}}"
          />
        </div>
      </div>

      {/* Template selector */}`;
    text = text.slice(0, gi) + simpleGrid + text.slice(ge + gridEnd.length - gridEnd.length);
    // Fix: ge points to start of gridEnd, so replace [gi, ge) + keep gridEnd
    text = text.slice(0, gi) + simpleGrid + text.slice(ge);
    // Wait - we already included gridEnd in simpleGrid. So use ge only once.
    // Redo properly:
  }
  // Clean redo of grid replace
  {
    const gi2 = text.indexOf(`      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">`);
    const ge2 = text.indexOf(`      {/* Template selector */}`);
    if (gi2 >= 0 && ge2 > gi2) {
      const simpleGrid = `      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-gray-700">mark_name</label>
          <input
            className="w-full border border-gray-300 rounded-lg px-3 py-2 mt-1 bg-white text-gray-900 text-sm"
            value={composeVariables.mark_name}
            onChange={(e) => handleVariableChange("mark_name", e.target.value)}
            placeholder="{{mark_name}}"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-gray-700">name</label>
          <input
            className="w-full border border-gray-300 rounded-lg px-3 py-2 mt-1 bg-white text-gray-900 text-sm"
            value={composeVariables.name}
            onChange={(e) => handleVariableChange("name", e.target.value)}
            placeholder="{{name}}"
          />
        </div>
      </div>

      `;
      text = text.slice(0, gi2) + simpleGrid + text.slice(ge2);
      console.log("Patched: variables grid → mark_name + name only");
    } else {
      console.log("Skip: variables grid not found");
    }
  }

  // Manual send body: map name → referenceNo, mark_name → markName
  text = patch(
    text,
    `        referenceNo: composeVariables?.reference_no || "",
serialNo: composeVariables?.serial_no || "",
markName: composeVariables?.mark_name || "",
filingDate: composeVariables?.filing_date || "",`,
    `        referenceNo: composeVariables?.name || "",
serialNo: "",
markName: composeVariables?.mark_name || "",
filingDate: "",`,
    "manual send var map"
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
