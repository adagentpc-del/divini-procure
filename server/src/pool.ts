/**
 * Postgres connection pool (the `pg` driver). Plain local Postgres - no SSL
 * required for the localhost:5433 AI Builder OS database. A managed URL with
 * sslmode=require also works (pg honours the connection string).
 */
import pg from "pg";
import { DATABASE_URL } from "./config.js";

const { Pool } = pg;

export const pool = new Pool({
  connectionString: DATABASE_URL || undefined,
  // Keep the pool modest; this is a single-process app.
  max: 10,
  idleTimeoutMillis: 30_000,
});

/** Thin query helper returning rows. */
export async function q<T = any>(text: string, params: any[] = []): Promise<T[]> {
  const res = await pool.query(text, params);
  return res.rows as T[];
}

/** Query helper returning the first row or null. */
export async function q1<T = any>(text: string, params: any[] = []): Promise<T | null> {
  const res = await pool.query(text, params);
  return (res.rows[0] as T) ?? null;
}
