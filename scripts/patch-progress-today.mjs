#!/usr/bin/env node
/** Fix manager Today counts + robust PST day from queue. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FILE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "src",
  "app",
  "api",
  "progress",
  "route.ts"
);
if (!fs.existsSync(FILE)) {
  console.log("patch-progress-today: skip");
  process.exit(0);
}
let t = fs.readFileSync(FILE, "utf8");

const oldSql = `WHERE timezone('America/Los_Angeles', COALESCE(sent_at, created_at))::date
               = timezone('America/Los_Angeles', now())::date`;
const newSql = `WHERE (COALESCE(sent_at, created_at) AT TIME ZONE 'America/Los_Angeles')::date
               = (CURRENT_TIMESTAMP AT TIME ZONE 'America/Los_Angeles')::date`;
if (t.includes(oldSql)) {
  t = t.replace(oldSql, newSql);
  console.log("patch-progress-today: today sql");
}

const oldMonth = `WHERE date_trunc('month', timezone('America/Los_Angeles', COALESCE(sent_at, created_at)))
               = date_trunc('month', timezone('America/Los_Angeles', now()))`;
const newMonth = `WHERE date_trunc('month', COALESCE(sent_at, created_at) AT TIME ZONE 'America/Los_Angeles')
               = date_trunc('month', CURRENT_TIMESTAMP AT TIME ZONE 'America/Los_Angeles')`;
if (t.includes(oldMonth)) {
  t = t.replace(oldMonth, newMonth);
  console.log("patch-progress-today: month sql");
}

const oldSt = `      const map = statsByWs[ws] || {};
      const st = map[String(u.id)] || map[String(u.username)] || {};
      let sentToday = Number(st.sentToday || 0) || 0;
      let sentMonth = Number(st.sentMonth || 0) || 0;
      let totalSent = Number(st.totalSent || 0) || 0;
      if (st.lastDate && st.lastDate !== dayKey) sentToday = 0;
      if (st.lastMonth && st.lastMonth !== monthKey) sentMonth = 0;`;

const newSt = `      const map = statsByWs[ws] || {};
      const stA = map[String(u.id)] || {};
      const stB = map[String(u.username)] || {};
      const st = {
        ...stB,
        ...stA,
        sentToday: Math.max(Number(stA.sentToday || 0), Number(stB.sentToday || 0)),
        sentMonth: Math.max(Number(stA.sentMonth || 0), Number(stB.sentMonth || 0)),
        totalSent: Math.max(Number(stA.totalSent || 0), Number(stB.totalSent || 0)),
        lastDate: stA.lastDate || stB.lastDate,
        lastMonth: stA.lastMonth || stB.lastMonth,
      };
      let sentToday = Number(st.sentToday || 0) || 0;
      let sentMonth = Number(st.sentMonth || 0) || 0;
      let totalSent = Number(st.totalSent || 0) || 0;
      const normDay = (x: any) => String(x || "").replace(/\\//g, "-").slice(0, 10);
      if (st.lastDate && normDay(st.lastDate) && normDay(st.lastDate) !== dayKey) sentToday = 0;
      if (st.lastMonth && String(st.lastMonth).slice(0, 7) !== monthKey) sentMonth = 0;`;

if (t.includes(oldSt)) {
  t = t.replace(oldSt, newSt);
  console.log("patch-progress-today: stats merge");
} else if (t.includes("normDay")) {
  console.log("patch-progress-today: already");
} else {
  console.warn("patch-progress-today: stats block not found");
}

fs.writeFileSync(FILE, t);
console.log("patch-progress-today: done");
