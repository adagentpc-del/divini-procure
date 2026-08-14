/**
 * Postgres connection pool (the `pg` driver). Plain local Postgres for dev;
 * in production, DATABASE_URL must include sslmode=require (or the ssl block
 * below enforces it) so all data-in-transit is encrypted.
 */
import pg from "pg";
import { DATABASE_URL, IS_PROD } from "./config.js";
import { getRequestContext } from "./lib/requestContext.js";

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

/**
 * Set the Row-Level Security session context (db/schema-rls.sql) on an
 * already-checked-out client, inside its current transaction. Uses
 * set_config(..., true) - the "is_local" flag - so the setting is scoped
 * to this transaction only and is discarded automatically at COMMIT or
 * ROLLBACK, before the connection can ever return to the pool and be
 * reused for a different request's identity.
 *
 * A missing request context (background jobs - see requestContext.ts's
 * header comment) is treated as admin-equivalent, matching what those
 * jobs already do today: operate across every tenant, unrestricted.
 */
export async function setRlsContext(client: pg.PoolClient): Promise<void> {
  const ctx = getRequestContext();
  const userId = ctx?.userId ?? "";
  const isAdmin = ctx ? ctx.isAdmin : true;
  const email = ctx?.email ?? "";
  await client.query(
    `select set_config('app.user_id', $1, true), set_config('app.is_admin', $2, true), set_config('app.user_email', $3, true)`,
    [userId, isAdmin ? "t" : "f", email],
  );
}

/**
 * Run a single query inside its own transaction, with the RLS context set.
 * This is what q()/q1() use under the hood - every query gets its own
 * checked-out client rather than pool.query()'s implicit per-call
 * checkout, because setting a transaction-local GUC and then running the
 * real query must happen on the SAME physical connection.
 */
async function queryWithContext(text: string, params: any[]): Promise<pg.QueryResult> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await setRlsContext(client);
    const res = await client.query(text, params);
    await client.query("commit");
    return res;
  } catch (e) {
    await client.query("rollback").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/** Thin query helper returning rows. */
export async function q<T = any>(text: string, params: any[] = []): Promise<T[]> {
  const res = await queryWithContext(text, params);
  return res.rows as T[];
}

/** Query helper returning the first row or null. */
export async function q1<T = any>(text: string, params: any[] = []): Promise<T | null> {
  const res = await queryWithContext(text, params);
  return (res.rows[0] as T) ?? null;
}

/**
 * A tiny query surface bound to one already-open transaction, handed to the
 * callback of withTransaction(). Same shape as q()/q1() so callers can write
 * identical SQL, but every call runs on the SAME connection/transaction
 * instead of opening a new one - required whenever a multi-step financial
 * write (award + PO + commitment check, change-order approval + recompute,
 * invoice approval + payment) must succeed or fail as one unit.
 */
export interface TxQuery {
  q<T = any>(text: string, params?: any[]): Promise<T[]>;
  q1<T = any>(text: string, params?: any[]): Promise<T | null>;
}

/**
 * Escalate the CURRENT withTransaction() to admin-equivalent RLS for its
 * remaining statements only (is_local, discarded at commit/rollback like
 * every other GUC this file sets). Use this ONLY after the caller has
 * already been independently verified as authorized for the specific write
 * about to happen - mirrors lib/requestContext.ts's runAsAdmin() escalation
 * pattern for q()/q1(), but scoped to an open transaction's tx handle
 * instead of starting a fresh one, for writes that must happen atomically
 * alongside other statements already inside that transaction. Concrete
 * example: a developer accepting a vendor's bid_revisions price proposal
 * must write bids.price, but bids_update's RLS policy (schema-rls.sql) only
 * permits the VENDOR company (or admin) to update a bid - the developer's
 * acceptance is the authorized trigger for that specific write, exactly the
 * same "already-authorized cross-company write" situation award-workflow.ts
 * documents for marking a bid awarded.
 */
export async function escalateToAdmin(tx: TxQuery): Promise<void> {
  await tx.q(`select set_config('app.is_admin', 't', true)`);
}

/**
 * Run `fn` inside a single Postgres transaction (RLS context set once, up
 * front, on the same connection used for every statement `fn` issues via the
 * TxQuery it receives). Commits on success, rolls back on any thrown error
 * (including an explicit application-level abort) and rethrows. Use this for
 * any financial event that touches more than one table and must never be
 * left partially applied - see server/src/lib/*.ts financial write paths.
 */
export async function withTransaction<T>(fn: (tx: TxQuery) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await setRlsContext(client);
    const tx: TxQuery = {
      q: async (text, params = []) => (await client.query(text, params)).rows,
      q1: async (text, params = []) => (await client.query(text, params)).rows[0] ?? null,
    };
    const result = await fn(tx);
    await client.query("commit");
    return result;
  } catch (e) {
    await client.query("rollback").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}
