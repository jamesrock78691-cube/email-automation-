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
