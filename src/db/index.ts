import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, Client } from "pg";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

/** Neon -pooler host can block DDL in transaction mode. Use direct host for ALTER. */
function ddlConnectionString() {
  return String(databaseUrl).replace("-pooler.", ".");
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

async function withDdlClient<T>(fn: (c: Client) => Promise<T>): Promise<T> {
  const client = new Client({
    connectionString: ddlConnectionString(),
    ssl:
      ddlConnectionString().includes("localhost") ||
      ddlConnectionString().includes("127.0.0.1")
        ? false
        : { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    try {
      await client.end();
    } catch {
      /* ignore */
    }
  }
}

async function addColumnSafe(
  client: Client,
  table: string,
  column: string,
  typeSql: string
) {
  await client.query(`
    DO $ddl$
    BEGIN
      ALTER TABLE public.${table} ADD COLUMN ${column} ${typeSql};
    EXCEPTION
      WHEN duplicate_column THEN NULL;
      WHEN undefined_table THEN NULL;
    END
    $ddl$;
  `);
}

async function ensureCoreTables() {
  await withDdlClient(async (client) => {
    const creates = [
      `CREATE TABLE IF NOT EXISTS public.users (
        id serial PRIMARY KEY,
        username text NOT NULL UNIQUE,
        password_hash text NOT NULL,
        role text DEFAULT 'admin' NOT NULL,
        workspace text DEFAULT 'main' NOT NULL,
        created_at timestamp DEFAULT now() NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS public.settings (
        id serial PRIMARY KEY,
        key text NOT NULL UNIQUE,
        value text NOT NULL,
        created_at timestamp DEFAULT now() NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS public.gmail_accounts (
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
      `CREATE TABLE IF NOT EXISTS public.templates (
        id serial PRIMARY KEY,
        name text NOT NULL,
        subject text NOT NULL,
        body_html text NOT NULL,
        body_text text DEFAULT '' NOT NULL,
        attachments_json text DEFAULT '[]' NOT NULL,
        attachment_path text,
        workspace text DEFAULT 'main' NOT NULL,
        created_at timestamp DEFAULT now() NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS public.campaigns (
        id serial PRIMARY KEY,
        name text NOT NULL,
        template_id integer,
        status text DEFAULT 'draft' NOT NULL,
        workspace text DEFAULT 'main' NOT NULL,
        created_at timestamp DEFAULT now() NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS public.queue (
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
      `CREATE TABLE IF NOT EXISTS public.tracking_logs (
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
      await client.query(sql);
    }
  });
}

export async function ensureWorkspaceColumns() {
  await withDdlClient(async (client) => {
    await addColumnSafe(client, "users", "workspace", "text DEFAULT 'main'");
    await addColumnSafe(client, "gmail_accounts", "workspace", "text DEFAULT 'main'");
    await addColumnSafe(client, "templates", "workspace", "text DEFAULT 'main'");
    await addColumnSafe(client, "campaigns", "workspace", "text DEFAULT 'main'");
    await addColumnSafe(client, "queue", "workspace", "text DEFAULT 'main'");
    await addColumnSafe(client, "tracking_logs", "workspace", "text DEFAULT 'main'");
    await addColumnSafe(client, "tracking_logs", "email", "text");
    await addColumnSafe(client, "tracking_logs", "mark_name", "text");
    await addColumnSafe(client, "tracking_logs", "reference_no", "text");
    await addColumnSafe(client, "queue", "open_count", "integer DEFAULT 0");
    await addColumnSafe(client, "queue", "last_opened_at", "timestamp");
    await addColumnSafe(client, "gmail_accounts", "smtp_username", "text");
    await addColumnSafe(client, "gmail_accounts", "from_email", "text");
    // Templates — required by drizzle schema / POST create
    await addColumnSafe(client, "templates", "body_text", "text DEFAULT ''");
    await addColumnSafe(client, "templates", "attachments_json", "text DEFAULT '[]'");
    await addColumnSafe(client, "templates", "attachment_path", "text");
    // Settings — list_users / agent_stats
    await addColumnSafe(client, "settings", "created_at", "timestamp DEFAULT now()");

    const fills = [
      `UPDATE public.users SET workspace = 'main' WHERE workspace IS NULL OR workspace = ''`,
      `UPDATE public.gmail_accounts SET workspace = 'main' WHERE workspace IS NULL OR workspace = ''`,
      `UPDATE public.templates SET workspace = 'main' WHERE workspace IS NULL OR workspace = ''`,
      `UPDATE public.campaigns SET workspace = 'main' WHERE workspace IS NULL OR workspace = ''`,
      `UPDATE public.queue SET workspace = 'main' WHERE workspace IS NULL OR workspace = ''`,
      `UPDATE public.tracking_logs SET workspace = 'main' WHERE workspace IS NULL OR workspace = ''`,
      `UPDATE public.templates SET body_text = '' WHERE body_text IS NULL`,
      `UPDATE public.templates SET attachments_json = '[]' WHERE attachments_json IS NULL`,
      `UPDATE public.users SET workspace = 'amazon', role = 'super_admin' WHERE lower(username) = 'amazon'`,
      `UPDATE public.users SET workspace = 'sandeer', role = 'super_admin' WHERE lower(username) = 'sandeer'`,
    ];
    for (const sql of fills) {
      try {
        await client.query(sql);
      } catch (err: any) {
        console.error("fill workspace:", err?.message || err);
      }
    }

    for (const table of ["users", "queue", "gmail_accounts", "templates", "campaigns", "tracking_logs"]) {
      const check = await client.query(
        `SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = $1 AND column_name = 'workspace'
         LIMIT 1`,
        [table]
      );
      if (!check.rowCount) {
        throw new Error(
          `FATAL: public.${table}.workspace missing after ALTER. Check DB ALTER permission / DATABASE_URL.`
        );
      }
    }

    // Verify templates body_text exists
    const tCheck = await client.query(
      `SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'templates' AND column_name = 'body_text' LIMIT 1`
    );
    if (!tCheck.rowCount) {
      throw new Error("FATAL: templates.body_text missing after ALTER");
    }
    console.log("[DB] workspace + templates columns verified");
  });
}

/** Call from dashboard/queue/template before any query. */
export async function forceQueueWorkspaceColumn() {
  await ensureCoreTables();
  await ensureWorkspaceColumns();
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
    await withDdlClient(async (client) => {
      await client.query(
        `ALTER TABLE gmail_accounts DROP CONSTRAINT IF EXISTS gmail_accounts_email_key`
      );
      await client.query(
        `ALTER TABLE gmail_accounts DROP CONSTRAINT IF EXISTS gmail_accounts_email_unique`
      );
      await client.query(`DROP INDEX IF EXISTS gmail_accounts_email_key`);
      await client.query(`DROP INDEX IF EXISTS gmail_accounts_email_unique`);
      await client.query(
        `CREATE UNIQUE INDEX IF NOT EXISTS gmail_accounts_email_workspace_uidx
         ON gmail_accounts (lower(email), workspace)`
      );
    });
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

export async function ensureSchemaReady(): Promise<void> {
  if (!globalForDb.__schemaReadyPromise) {
    globalForDb.__schemaReadyPromise = (async () => {
      await ensureCoreTables();
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
