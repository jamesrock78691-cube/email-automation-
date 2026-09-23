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
    await pool.query(
      `ALTER TABLE gmail_accounts ADD COLUMN IF NOT EXISTS smtp_username text`
    );
    await pool.query(
      `ALTER TABLE gmail_accounts ADD COLUMN IF NOT EXISTS from_email text`
    );
  } catch (err) {
    console.error("ensureSmtpColumns:", err);
  }
}
void ensureSmtpColumns();

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
    `UPDATE users SET workspace = 'amazon', role = 'super_admin' WHERE lower(username) = 'amazon'`,
  ];
  for (const sql of stmts) {
    try {
      await pool.query(sql);
    } catch (err) {
      console.error("ensureWorkspaceColumns:", err);
    }
  }
}

/** Copy workspace from queue → tracking_logs so Amazon opens appear on dashboard */
async function backfillTrackingLogWorkspace() {
  try {
    const flagKey = "tracking_logs_workspace_backfill_v1";
    const flag = await pool.query(
      `SELECT 1 FROM settings WHERE key = $1 LIMIT 1`,
      [flagKey]
    );
    // Always run sync for mismatched rows (cheap); flag only logs once
    const res = await pool.query(`
      UPDATE tracking_logs tl
      SET workspace = q.workspace
      FROM queue q
      WHERE tl.tracking_id = q.tracking_id
        AND q.workspace IS NOT NULL
        AND q.workspace <> ''
        AND tl.workspace IS DISTINCT FROM q.workspace
    `);
    if (res.rowCount && res.rowCount > 0) {
      console.log(
        `backfillTrackingLogWorkspace: fixed ${res.rowCount} rows`
      );
    }
    if (!flag.rowCount) {
      await pool.query(
        `INSERT INTO settings (key, value) VALUES ($1, 'done')
         ON CONFLICT (key) DO NOTHING`,
        [flagKey]
      );
    }
  } catch (err) {
    console.error("backfillTrackingLogWorkspace:", err);
  }
}

async function ensureEmailWorkspaceUnique() {
  try {
    await ensureWorkspaceColumns();
    await backfillTrackingLogWorkspace();
    await pool.query(
      `ALTER TABLE gmail_accounts DROP CONSTRAINT IF EXISTS gmail_accounts_email_key`
    );
    await pool.query(
      `ALTER TABLE gmail_accounts DROP CONSTRAINT IF EXISTS gmail_accounts_email_unique`
    );
    await pool.query(`DROP INDEX IF EXISTS gmail_accounts_email_key`);
    await pool.query(`DROP INDEX IF EXISTS gmail_accounts_email_unique`);
    await pool.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS gmail_accounts_email_workspace_uidx
       ON gmail_accounts (lower(email), workspace)`
    );
  } catch (err) {
    console.error("ensureEmailWorkspaceUnique:", err);
  }
}
void ensureEmailWorkspaceUnique();

/**
 * Hard isolation: known Amazon SMTP emails always live in amazon workspace.
 */
async function isolateAmazonSmtpV3() {
  try {
    const flagKey = "amazon_hard_isolate_v3_20260924";
    const flag = await pool.query(
      `SELECT 1 FROM settings WHERE key = $1 LIMIT 1`,
      [flagKey]
    );
    if (flag.rowCount && flag.rowCount > 0) return;

    await ensureWorkspaceColumns();
    await ensureEmailWorkspaceUnique();

    const amazonEmails = ["lxx12402@gmail.com"];

    for (const em of amazonEmails) {
      const moved = await pool.query(
        `UPDATE gmail_accounts
         SET workspace = 'amazon'
         WHERE lower(email) = $1
            OR lower(coalesce(from_email, '')) = $1`,
        [em]
      );
      console.log(`isolate v3: ${em} → amazon rows=${moved.rowCount ?? 0}`);
    }

    await pool.query(
      `UPDATE users SET workspace = 'amazon', role = 'super_admin'
       WHERE lower(username) = 'amazon'`
    );

    await pool.query(
      `INSERT INTO settings (key, value)
       VALUES ($1, 'done')
       ON CONFLICT (key) DO NOTHING`,
      [flagKey]
    );
  } catch (err) {
    console.error("isolateAmazonSmtpV3:", err);
  }
}
void isolateAmazonSmtpV3();

async function ensureAmazonAdmin() {
  try {
    await ensureWorkspaceColumns();
    const existing = await pool.query(
      `SELECT id FROM users WHERE username = 'amazon' LIMIT 1`
    );
    const bcrypt = (await import("bcryptjs")).default;
    if (!existing.rowCount) {
      const hash = await bcrypt.hash("cubetech26", 10);
      await pool.query(
        `INSERT INTO users (username, password_hash, role, workspace)
         VALUES ('amazon', $1, 'super_admin', 'amazon')`,
        [hash]
      );
    } else {
      await pool.query(
        `UPDATE users SET role = 'super_admin', workspace = 'amazon'
         WHERE username = 'amazon'`
      );
    }
  } catch (err) {
    console.error("ensureAmazonAdmin:", err);
  }
}
void ensureAmazonAdmin();
