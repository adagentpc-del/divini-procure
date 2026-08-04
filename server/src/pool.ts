/**
 * Postgres connection pool (the `pg` driver). Plain local Postgres for dev;
 * in production, DATABASE_URL must include sslmode=require (or the ssl block
 * below enforces it) so all data-in-transit is encrypted.
 */
import pg from "pg";
import { DATABASE_URL, IS_PROD } from "./config.js";

const { Pool, types } = pg;

// Every bigint column in this schema is a *_cents money amount or a file
// size in bytes - never a value near the 64-bit range - but node-postgres
// returns bigint (OID 20) as a string by default to avoid silent precision
// loss for values beyond Number.MAX_SAFE_INTEGER. That default makes every
// `price_cents === 0` / `=== null` check downstream compare a string against
// a number and silently fail. Parse to a JS number app-wide instead.
types.setTypeParser(20, (val: string) => (val === null ? null : parseInt(val, 10)));

export const pool = new Pool({
  connectionString: DATABASE_URL || undefined,
  // Keep the pool modest; this is a single-process app.
  max: 10,
  idleTimeoutMillis: 30_000,
  // Require SSL in production unless the connection string already includes
  // sslmode. Managed databases (Railway, Render, Supabase, RDS) all support it.
  ssl: IS_PROD && !DATABASE_URL.includes("sslmode=disable")
    ? { rejectUnauthorized: true }
    : false,
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
