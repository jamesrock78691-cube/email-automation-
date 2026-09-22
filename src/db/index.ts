import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

const globalForDb = globalThis as typeof globalThis & {
  __arenaNextJsPostgresqlPool?: Pool;
};

export const pool =
  globalForDb.__arenaNextJsPostgresqlPool ??
  new Pool({
    connectionString: databaseUrl,
  });

if (process.env.NODE_ENV !== "production") {
  globalForDb.__arenaNextJsPostgresqlPool = pool;
}

export const db = drizzle(pool);

async function ensureSmtpColumns() {
  try {
    await pool.query(`ALTER TABLE gmail_accounts ADD COLUMN IF NOT EXISTS smtp_username text`);
    await pool.query(`ALTER TABLE gmail_accounts ADD COLUMN IF NOT EXISTS from_email text`);
  } catch (err) {
    console.error("ensureSmtpColumns:", err);
  }
}
void ensureSmtpColumns();

/** One-shot super-admin password reset (runs once after this deploy). */
async function resetAdminPasswordOnce() {
  try {
    const flag = await pool.query(
      `SELECT 1 FROM settings WHERE key = $1 LIMIT 1`,
      ["admin_pw_reset_20260923"]
    );
    if (flag.rowCount && flag.rowCount > 0) return;

    const bcrypt = (await import("bcryptjs")).default;
    const hash = await bcrypt.hash("admin123", 10);

    const updated = await pool.query(
      `UPDATE users
       SET password_hash = $1, role = 'super_admin'
       WHERE username IN ('admin', 'superadmin')`,
      [hash]
    );

    if (!updated.rowCount) {
      await pool.query(
        `INSERT INTO users (username, password_hash, role)
         VALUES ('admin', $1, 'super_admin')
         ON CONFLICT (username)
         DO UPDATE SET password_hash = EXCLUDED.password_hash, role = 'super_admin'`,
        [hash]
      );
    }

    await pool.query(
      `INSERT INTO settings (key, value)
       VALUES ('admin_pw_reset_20260923', 'done')
       ON CONFLICT (key) DO NOTHING`
    );
    console.log("Super admin password reset to default");
  } catch (err) {
    console.error("resetAdminPasswordOnce:", err);
  }
}
void resetAdminPasswordOnce();


async function ensureWorkspaceColumns() {
  const stmts = [
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS workspace text DEFAULT 'main'`,
    `ALTER TABLE gmail_accounts ADD COLUMN IF NOT EXISTS workspace text DEFAULT 'main'`,
    `ALTER TABLE templates ADD COLUMN IF NOT EXISTS workspace text DEFAULT 'main'`,
    `ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS workspace text DEFAULT 'main'`,
    `ALTER TABLE queue ADD COLUMN IF NOT EXISTS workspace text DEFAULT 'main'`,
    `ALTER TABLE tracking_logs ADD COLUMN IF NOT EXISTS workspace text DEFAULT 'main'`,
    `UPDATE users SET workspace = 'main' WHERE workspace IS NULL OR workspace = ''`,
    `UPDATE gmail_accounts SET workspace = 'main' WHERE workspace IS NULL OR workspace = ''`,
    `UPDATE templates SET workspace = 'main' WHERE workspace IS NULL OR workspace = ''`,
    `UPDATE campaigns SET workspace = 'main' WHERE workspace IS NULL OR workspace = ''`,
    `UPDATE queue SET workspace = 'main' WHERE workspace IS NULL OR workspace = ''`,
    `UPDATE tracking_logs SET workspace = 'main' WHERE workspace IS NULL OR workspace = ''`,
  ];
  for (const sql of stmts) {
    try {
      await pool.query(sql);
    } catch (err) {
      console.error("ensureWorkspaceColumns:", err);
    }
  }
}

/** Create isolated Amazon workspace super-admin (full functions, separate data). */
async function ensureAmazonAdmin() {
  try {
    await ensureWorkspaceColumns();
    const existing = await pool.query(
      `SELECT id FROM users WHERE username = 'amazon' LIMIT 1`
    );
    const bcrypt = (await import("bcryptjs")).default;
    if (!existing.rowCount) {
      const hash = await bcrypt.hash("amazon123", 10);
      await pool.query(
        `INSERT INTO users (username, password_hash, role, workspace)
         VALUES ('amazon', $1, 'super_admin', 'amazon')`,
        [hash]
      );
      console.log("Created amazon workspace admin");
    } else {
      await pool.query(
        `UPDATE users SET role = 'super_admin', workspace = 'amazon' WHERE username = 'amazon'`
      );
    }
  } catch (err) {
    console.error("ensureAmazonAdmin:", err);
  }
}
void ensureAmazonAdmin();
