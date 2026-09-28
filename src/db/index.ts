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

/** Create core tables if they do not exist (fresh / wiped DB). */
async function ensureCoreTables() {
  const creates = [
    `CREATE TABLE IF NOT EXISTS users (
      id serial PRIMARY KEY,
      username text NOT NULL UNIQUE,
      password_hash text NOT NULL,
      role text DEFAULT 'admin' NOT NULL,
      workspace text DEFAULT 'main' NOT NULL,
      created_at timestamp DEFAULT now() NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS settings (
      id serial PRIMARY KEY,
      key text NOT NULL UNIQUE,
      value text NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS gmail_accounts (
      id serial PRIMARY KEY,
      email text NOT NULL,
      smtp_username text,
      from_email text,
      sender_name text DEFAULT 'Trademark Processing Department' NOT NULL,
      reply_to_email text,
      provider text DEFAULT 'gmail' NOT NULL,
      app_password text NOT NULL,
      smtp_host text DEFAULT 'smtp.gmail.com' NOT NULL,
      smtp_port integer DEFAULT 465 NOT NULL,
      secure boolean DEFAULT true NOT NULL,
      priority integer DEFAULT 1 NOT NULL,
      daily_limit integer DEFAULT 500 NOT NULL,
      minute_limit integer DEFAULT 50 NOT NULL,
      sent_today integer DEFAULT 0 NOT NULL,
      sent_this_minute integer DEFAULT 0 NOT NULL,
      status text DEFAULT 'enabled' NOT NULL,
      last_used_at timestamp,
      cooldown_until timestamp,
      error_count integer DEFAULT 0 NOT NULL,
      workspace text DEFAULT 'main' NOT NULL,
      created_at timestamp DEFAULT now() NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS templates (
      id serial PRIMARY KEY,
      name text NOT NULL,
      subject text NOT NULL,
      body_html text NOT NULL,
      attachment_path text,
      workspace text DEFAULT 'main' NOT NULL,
      created_at timestamp DEFAULT now() NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS campaigns (
      id serial PRIMARY KEY,
      name text NOT NULL,
      template_id integer,
      status text DEFAULT 'draft' NOT NULL,
      workspace text DEFAULT 'main' NOT NULL,
      created_at timestamp DEFAULT now() NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS queue (
      id serial PRIMARY KEY,
      campaign_id integer,
      reference_no text,
      serial_no text,
      mark_name text,
      filing_date text,
      email text NOT NULL,
      cc text,
      bcc text,
      subject text,
      template_id integer,
      status text DEFAULT 'pending' NOT NULL,
      tracking_id text NOT NULL UNIQUE,
      tries integer DEFAULT 0 NOT NULL,
      max_tries integer DEFAULT 3 NOT NULL,
      error_message text,
      gmail_used_id integer,
      gmail_used_email text,
      sent_at timestamp,
      open_count integer DEFAULT 0 NOT NULL,
      last_opened_at timestamp,
      workspace text DEFAULT 'main' NOT NULL,
      created_at timestamp DEFAULT now() NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS tracking_logs (
      id serial PRIMARY KEY,
      queue_id integer,
      tracking_id text NOT NULL,
      ip_address text,
      user_agent text,
      browser text,
      device text,
      opened_at timestamp DEFAULT now() NOT NULL,
      email text,
      mark_name text,
      reference_no text,
      workspace text DEFAULT 'main' NOT NULL
    )`,
  ];
  for (const sql of creates) {
    try {
      await pool.query(sql);
    } catch (err: any) {
      console.error("ensureCoreTables:", err?.message || err);
    }
  }
}

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

export async function ensureWorkspaceColumns() {
  const stmts = [
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS workspace text DEFAULT 'main'`,
    `ALTER TABLE gmail_accounts ADD COLUMN IF NOT EXISTS workspace text DEFAULT 'main'`,
    `ALTER TABLE templates ADD COLUMN IF NOT EXISTS workspace text DEFAULT 'main'`,
    `ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS workspace text DEFAULT 'main'`,
    `ALTER TABLE queue ADD COLUMN IF NOT EXISTS workspace text DEFAULT 'main'`,
    `ALTER TABLE tracking_logs ADD COLUMN IF NOT EXISTS workspace text DEFAULT 'main'`,
    `ALTER TABLE tracking_logs ADD COLUMN IF NOT EXISTS email text`,
    `ALTER TABLE tracking_logs ADD COLUMN IF NOT EXISTS mark_name text`,
    `ALTER TABLE tracking_logs ADD COLUMN IF NOT EXISTS reference_no text`,
    `ALTER TABLE queue ADD COLUMN IF NOT EXISTS open_count integer DEFAULT 0`,
    `ALTER TABLE queue ADD COLUMN IF NOT EXISTS last_opened_at timestamp`,
    `UPDATE users SET workspace = 'main' WHERE workspace IS NULL OR workspace = ''`,
    `UPDATE gmail_accounts SET workspace = 'main' WHERE workspace IS NULL OR workspace = ''`,
    `UPDATE templates SET workspace = 'main' WHERE workspace IS NULL OR workspace = ''`,
    `UPDATE campaigns SET workspace = 'main' WHERE workspace IS NULL OR workspace = ''`,
    `UPDATE queue SET workspace = 'main' WHERE workspace IS NULL OR workspace = ''`,
    `UPDATE tracking_logs SET workspace = 'main' WHERE workspace IS NULL OR workspace = ''`,
    `UPDATE users SET workspace = 'amazon', role = 'super_admin' WHERE lower(username) = 'amazon'`,
    `UPDATE users SET workspace = 'sandeer', role = 'super_admin' WHERE lower(username) = 'sandeer'`,
  ];
  for (const sql of stmts) {
    try {
      await pool.query(sql);
    } catch (err: any) {
      console.error(
        "ensureWorkspaceColumns failed:",
        sql.slice(0, 90),
        err?.message || err
      );
    }
  }

  // Verify critical columns
  for (const [table, col] of [
    ["users", "workspace"],
    ["queue", "workspace"],
  ] as const) {
    try {
      const check = await pool.query(
        `SELECT 1 FROM information_schema.columns
         WHERE table_name = $1 AND column_name = $2 LIMIT 1`,
        [table, col]
      );
      if (!check.rowCount) {
        console.warn(`${table}.${col} still missing — retrying ALTER`);
        await pool.query(`ALTER TABLE ${table} ADD COLUMN ${col} text`);
        await pool.query(
          `UPDATE ${table} SET ${col} = 'main' WHERE ${col} IS NULL`
        );
      }
    } catch (err: any) {
      console.error(`${table}.${col} verify:`, err?.message || err);
    }
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
    const hash = await bcrypt.hash(password, 10);
    if (!existing.rowCount) {
      await pool.query(
        `INSERT INTO users (username, password_hash, role, workspace)
         VALUES ($1, $2, 'super_admin', $3)`,
        [username, hash, workspace]
      );
      console.log(`ensureTenantAdmin: created ${username} @ ${workspace}`);
    } else {
      // Keep password if already set; only fix role/workspace
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

/** Ensure default admin exists (main workspace). */
async function ensureDefaultAdmin() {
  try {
    const existing = await pool.query(
      `SELECT id FROM users WHERE lower(username) = 'admin' LIMIT 1`
    );
    const bcrypt = (await import("bcryptjs")).default;
    if (!existing.rowCount) {
      const hash = await bcrypt.hash("cubetech26", 10);
      await pool.query(
        `INSERT INTO users (username, password_hash, role, workspace)
         VALUES ('admin', $1, 'super_admin', 'main')`,
        [hash]
      );
      console.log("ensureDefaultAdmin: created admin / cubetech26");
    } else {
      await pool.query(
        `UPDATE users SET role = 'super_admin', workspace = 'main'
         WHERE lower(username) = 'admin'`
      );
    }
  } catch (err) {
    console.error("ensureDefaultAdmin:", err);
  }
}

/** Await this before any DB query that needs schema (login, dashboard, queue). */
export async function ensureSchemaReady(): Promise<void> {
  if (!globalForDb.__schemaReadyPromise) {
    globalForDb.__schemaReadyPromise = (async () => {
      await ensureCoreTables();
      await ensureSmtpColumns();
      await ensureWorkspaceColumns();
      await ensureEmailWorkspaceUnique();
      await isolateAmazonSmtpV3();
      await ensureDefaultAdmin();
      await ensureTenantAdmin("amazon", "amazon");
      await ensureTenantAdmin("sandeer", "sandeer");
      console.log("[DB] schemaReady complete");
    })().catch((err) => {
      globalForDb.__schemaReadyPromise = undefined;
      console.error("[DB] schemaReady failed:", err);
      throw err;
    });
  }
  return globalForDb.__schemaReadyPromise;
}

void ensureSchemaReady();
