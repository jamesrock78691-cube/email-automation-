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

/** One-shot: reset EVERY user password to cubetech26 (runs once after this deploy). */
async function resetAllPasswordsCubetech26() {
  try {
    const flagKey = "all_pw_reset_cubetech26_20260923";
    const flag = await pool.query(
      `SELECT 1 FROM settings WHERE key = $1 LIMIT 1`,
      [flagKey]
    );
    if (flag.rowCount && flag.rowCount > 0) return;

    const bcrypt = (await import("bcryptjs")).default;
    const hash = await bcrypt.hash("cubetech26", 10);

    const updated = await pool.query(
      `UPDATE users SET password_hash = $1`,
      [hash]
    );

    await pool.query(
      `INSERT INTO users (username, password_hash, role, workspace)
       VALUES
         ('admin', $1, 'super_admin', 'main'),
         ('superadmin', $1, 'super_admin', 'main'),
         ('amazon', $1, 'super_admin', 'amazon')
       ON CONFLICT (username) DO UPDATE
       SET password_hash = EXCLUDED.password_hash`,
      [hash]
    );

    await pool.query(
      `INSERT INTO settings (key, value)
       VALUES ($1, 'done')
       ON CONFLICT (key) DO NOTHING`,
      [flagKey]
    );

    console.log(
      "All user passwords reset to cubetech26. Rows updated:",
      updated.rowCount ?? 0
    );
  } catch (err) {
    console.error("resetAllPasswordsCubetech26:", err);
  }
}
void resetAllPasswordsCubetech26();

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
    // amazon user always on amazon workspace
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

/**
 * One-shot: lock SMTP lxx12402@gmail.com to amazon workspace only
 * so main admin never sees/uses it.
 */
async function isolateAmazonSmtpOnce() {
  try {
    const flagKey = "amazon_smtp_isolate_lxx12402_20260923";
    const flag = await pool.query(
      `SELECT 1 FROM settings WHERE key = $1 LIMIT 1`,
      [flagKey]
    );
    if (flag.rowCount && flag.rowCount > 0) return;

    await ensureWorkspaceColumns();

    const moved = await pool.query(
      `UPDATE gmail_accounts
       SET workspace = 'amazon'
       WHERE lower(email) = 'lxx12402@gmail.com'
          OR lower(from_email) = 'lxx12402@gmail.com'`
    );

    await pool.query(
      `INSERT INTO settings (key, value)
       VALUES ($1, $2)
       ON CONFLICT (key) DO NOTHING`,
      [flagKey, `moved:${moved.rowCount ?? 0}`]
    );
    console.log(
      "Isolated lxx12402@gmail.com to amazon workspace. rows:",
      moved.rowCount ?? 0
    );
  } catch (err) {
    console.error("isolateAmazonSmtpOnce:", err);
  }
}
void isolateAmazonSmtpOnce();

/** Create isolated Amazon workspace super-admin (full functions, separate data). */
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
