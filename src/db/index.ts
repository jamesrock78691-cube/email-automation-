import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

const globalForDb = globalThis as typeof globalThis & {
  __arenaNextJsPostgresqlPool?: Pool;
  __schemaReadyPromise?: Promise<void>;
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

/**
 * Add workspace columns to all tenant tables.
 * Safe to run many times (IF NOT EXISTS).
 */
export async function ensureWorkspaceColumns() {
  const stmts = [
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS workspace text DEFAULT 'main'`,
    `ALTER TABLE gmail_accounts ADD COLUMN IF NOT EXISTS workspace text DEFAULT 'main'`,
    `ALTER TABLE templates ADD COLUMN IF NOT EXISTS workspace text DEFAULT 'main'`,
    `ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS workspace text DEFAULT 'main'`,
    `ALTER TABLE queue ADD COLUMN IF NOT EXISTS workspace text DEFAULT 'main'`,
    `ALTER TABLE tracking_logs ADD COLUMN IF NOT EXISTS workspace text DEFAULT 'main'`,
    // Fill any null/empty
    `UPDATE users SET workspace = 'main' WHERE workspace IS NULL OR workspace = ''`,
    `UPDATE gmail_accounts SET workspace = 'main' WHERE workspace IS NULL OR workspace = ''`,
    `UPDATE templates SET workspace = 'main' WHERE workspace IS NULL OR workspace = ''`,
    `UPDATE campaigns SET workspace = 'main' WHERE workspace IS NULL OR workspace = ''`,
    `UPDATE queue SET workspace = 'main' WHERE workspace IS NULL OR workspace = ''`,
    `UPDATE tracking_logs SET workspace = 'main' WHERE workspace IS NULL OR workspace = ''`,
    // Tenant admins
    `UPDATE users SET workspace = 'amazon', role = 'super_admin' WHERE lower(username) = 'amazon'`,
    `UPDATE users SET workspace = 'sandeer', role = 'super_admin' WHERE lower(username) = 'sandeer'`,
  ];
  for (const sql of stmts) {
    try {
      await pool.query(sql);
    } catch (err: any) {
      console.error("ensureWorkspaceColumns failed:", sql.slice(0, 80), err?.message || err);
    }
  }

  // Verify queue.workspace exists; if not, try once more without DEFAULT (older PG)
  try {
    const check = await pool.query(`
      SELECT 1
      FROM information_schema.columns
      WHERE table_name = 'queue' AND column_name = 'workspace'
      LIMIT 1
    `);
    if (!check.rowCount) {
      console.warn("queue.workspace still missing — retrying ALTER without DEFAULT");
      await pool.query(`ALTER TABLE queue ADD COLUMN workspace text`);
      await pool.query(`UPDATE queue SET workspace = 'main' WHERE workspace IS NULL`);
    }
  } catch (err: any) {
    console.error("queue.workspace verify/retry:", err?.message || err);
  }
}

async function backfillTrackingLogWorkspace() {
  try {
    const flagKey = "tracking_logs_workspace_backfill_v1";
    const flag = await pool.query(
      `SELECT 1 FROM settings WHERE key = $1 LIMIT 1`,
      [flagKey]
    );
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
      console.log(`backfillTrackingLogWorkspace: fixed ${res.rowCount} rows`);
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

async function ensureTenantAdmin(
  username: string,
  workspace: string,
  password = "cubetech26"
) {
  try {
    await ensureWorkspaceColumns();
    const existing = await pool.query(
      `SELECT id FROM users WHERE lower(username) = $1 LIMIT 1`,
      [username.toLowerCase()]
    );
    const bcrypt = (await import("bcryptjs")).default;
    if (!existing.rowCount) {
      const hash = await bcrypt.hash(password, 10);
      await pool.query(
        `INSERT INTO users (username, password_hash, role, workspace)
         VALUES ($1, $2, 'super_admin', $3)`,
        [username, hash, workspace]
      );
      console.log(`ensureTenantAdmin: created ${username} @ ${workspace}`);
    } else {
      await pool.query(
        `UPDATE users SET role = 'super_admin', workspace = $2
         WHERE lower(username) = $1`,
        [username.toLowerCase(), workspace]
      );
      console.log(`ensureTenantAdmin: updated ${username} → ${workspace}`);
    }
  } catch (err) {
    console.error(`ensureTenantAdmin(${username}):`, err);
  }
}

/** Await this before any workspace-filtered query (dashboard, queue, etc.). */
export async function ensureSchemaReady(): Promise<void> {
  if (!globalForDb.__schemaReadyPromise) {
    globalForDb.__schemaReadyPromise = (async () => {
      await ensureSmtpColumns();
      await ensureWorkspaceColumns();
      await ensureEmailWorkspaceUnique();
      await isolateAmazonSmtpV3();
      await ensureTenantAdmin("amazon", "amazon");
      await ensureTenantAdmin("sandeer", "sandeer");
      console.log("[DB] schemaReady complete");
    })().catch((err) => {
      // Allow retry on next call
      globalForDb.__schemaReadyPromise = undefined;
      console.error("[DB] schemaReady failed:", err);
      throw err;
    });
  }
  return globalForDb.__schemaReadyPromise;
}

// Kick off on cold start (non-blocking)
void ensureSchemaReady();
