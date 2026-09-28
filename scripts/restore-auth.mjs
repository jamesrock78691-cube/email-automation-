#!/usr/bin/env node
/** Restore auth/route.ts if corrupted/truncated, then apply schemaReady + login fixes. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const OUT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "src",
  "app",
  "api",
  "auth",
  "route.ts"
);

const SOURCES = [
  "https://cdn.jsdelivr.net/gh/jamesrock78691-cube/email-automation-@00e6f934938117c48a9f1dd1baf077f16968f60f/src/app/api/auth/route.ts",
  "https://raw.githubusercontent.com/jamesrock78691-cube/email-automation-/00e6f934938117c48a9f1dd1baf077f16968f60f/src/app/api/auth/route.ts",
];

function isComplete(text) {
  return (
    text &&
    text.length > 15000 &&
    text.includes("export async function POST") &&
    text.includes("forgot_password") &&
    text.includes("manage_users") &&
    !text.includes("SEE_AUTH")
  );
}

function patch(text) {
  if (!text.includes("import { db, ensureSchemaReady }")) {
    text = text.replace(
      'import { db } from "@/db";',
      'import { db, ensureSchemaReady } from "@/db";'
    );
  }
  if (!text.includes('sql } from "drizzle-orm"') && !text.includes("sql,")) {
    text = text.replace(
      'import { eq, desc } from "drizzle-orm";',
      'import { eq, desc, sql } from "drizzle-orm";'
    );
  }
  if (!text.includes("await ensureSchemaReady()")) {
    text = text.replace(
      `export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const action = body.action;`,
      `export async function POST(req: NextRequest) {
  try {
    await ensureSchemaReady();
    const body = await req.json();
    const action = body.action;`
    );
  }
  if (text.includes("eq(users.username, String(username).trim())")) {
    text = text.replace(
      `const found = await db
        .select()
        .from(users)
        .where(eq(users.username, String(username).trim()))
        .limit(1);`,
      `const uname = String(username).trim();
      const found = await db
        .select()
        .from(users)
        .where(sql\`lower(\${users.username}) = \${uname.toLowerCase()}\`)
        .limit(1);`
    );
  }
  if (
    text.includes('if (user.username === "amazon") role = "super_admin";') &&
    !text.includes('sandeer") role = "super_admin"')
  ) {
    text = text.replace(
      'if (user.username === "amazon") role = "super_admin";',
      `if (user.username === "amazon") role = "super_admin";
      if (String(user.username).toLowerCase() === "sandeer") role = "super_admin";`
    );
  }
  return text;
}

async function fetchSource() {
  for (const url of SOURCES) {
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const text = await res.text();
      if (isComplete(text)) return text;
    } catch (e) {
      console.error("fetch", url, e);
    }
  }
  return null;
}

async function main() {
  const existing = fs.existsSync(OUT) ? fs.readFileSync(OUT, "utf8") : "";
  if (isComplete(existing)) {
    const text = patch(existing);
    fs.writeFileSync(OUT, text);
    console.log("restore-auth: patched existing", text.length);
    return;
  }
  const remote = await fetchSource();
  if (!remote) throw new Error("restore-auth failed: no complete source");
  const text = patch(remote);
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, text);
  console.log("restore-auth: restored full auth from CDN", text.length);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
