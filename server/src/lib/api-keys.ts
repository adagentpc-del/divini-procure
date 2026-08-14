/**
 * Divini Procure - developer API platform: personal-access-token-style API
 * keys (competitive gap closure, docs/competitive-analysis-2026-08.md gap
 * #11). See schema-api-keys.sql's header for the full design rationale.
 *
 * A key authenticates as its creating user - same RLS, same admin flag,
 * same everything a normal session gets. `scopes` only narrows further
 * (a 'read'-only key cannot make a non-GET request), never expands.
 *
 * Key format: "dvp_live_" + 40 random base62 characters. The raw key is
 * shown to the caller exactly once, at creation; only its SHA-256 hash is
 * ever stored, matching db.ts's hashToken() for password-reset/
 * verification tokens.
 */
import { createHash, randomBytes } from "node:crypto";
import { pool, q, q1 } from "../pool.js";

export const API_KEY_PREFIX = "dvp_live_";
const BASE62 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

function randomBase62(length: number): string {
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) out += BASE62[bytes[i] % BASE62.length];
  return out;
}

function hashKey(rawKey: string): string {
  return createHash("sha256").update(rawKey).digest("hex");
}

/** True as soon as a bearer token even looks like one of ours - cheap pre-filter before touching the database. */
export function looksLikeApiKey(token: string): boolean {
  return token.startsWith(API_KEY_PREFIX);
}

export type ApiKeyScope = "read" | "write";

export interface ApiKeyAuthResult {
  userId: string;
  email: string;
  companyId: string;
  apiKeyId: string;
  scopes: ApiKeyScope[];
}

/**
 * Verify a raw bearer token against the api_keys table and, if valid and
 * not revoked, return the identity it authenticates as. Runs admin-
 * equivalent (no session/company context exists yet - the key itself is
 * the credential establishing one), mirroring db.ts's q1AsPreAuth()
 * exactly, including the same one-transaction-per-lookup shape.
 */
export async function verifyApiKey(rawKey: string): Promise<ApiKeyAuthResult | null> {
  const keyHash = hashKey(rawKey);
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(`select set_config('app.is_admin', 't', true)`);
    const res = await client.query<{
      id: string;
      company_id: string;
      created_by_user_id: string;
      scopes: ApiKeyScope[];
      email: string;
    }>(
      `select ak.id, ak.company_id, ak.created_by_user_id, ak.scopes, u.email
         from api_keys ak
         join users u on u.id = ak.created_by_user_id
        where ak.key_hash = $1 and ak.revoked_at is null`,
      [keyHash],
    );
    await client.query("commit");
    const row = res.rows[0];
    if (!row) return null;
    return {
      userId: row.created_by_user_id,
      email: row.email,
      companyId: row.company_id,
      apiKeyId: row.id,
      scopes: row.scopes,
    };
  } catch (e) {
    await client.query("rollback").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Best-effort last-used timestamp. Never awaited by the auth middleware -
 * a slow or failing write here must not add latency or risk to every
 * authenticated request.
 */
export function touchApiKeyLastUsed(apiKeyId: string): void {
  const client = pool;
  client
    .query(`update api_keys set last_used_at = now() where id = $1`, [apiKeyId])
    .catch(() => {
      // best-effort only
    });
}

export interface CreatedApiKey {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: ApiKeyScope[];
  createdAt: string;
  rawKey: string;
}

/** Caller is already authenticated (normal RLS context) - this just inserts under that session. */
export async function createApiKey(
  companyId: string,
  userId: string,
  name: string,
  scopes: ApiKeyScope[],
): Promise<CreatedApiKey> {
  const rawKey = API_KEY_PREFIX + randomBase62(40);
  const keyHash = hashKey(rawKey);
  const keyPrefix = rawKey.slice(0, 12);
  const row = await q1<{ id: string; name: string; key_prefix: string; scopes: ApiKeyScope[]; created_at: string }>(
    `insert into api_keys (company_id, created_by_user_id, name, key_hash, key_prefix, scopes)
     values ($1,$2,$3,$4,$5,$6)
     returning id, name, key_prefix, scopes, created_at`,
    [companyId, userId, name, keyHash, keyPrefix, scopes],
  );
  if (!row) throw new Error("failed to create API key");
  return { id: row.id, name: row.name, keyPrefix: row.key_prefix, scopes: row.scopes, createdAt: row.created_at, rawKey };
}

export async function listApiKeys(companyId: string) {
  return q<{
    id: string;
    name: string;
    key_prefix: string;
    scopes: ApiKeyScope[];
    last_used_at: string | null;
    created_at: string;
    revoked_at: string | null;
  }>(
    `select id, name, key_prefix, scopes, last_used_at, created_at, revoked_at
       from api_keys
      where company_id = $1
      order by created_at desc`,
    [companyId],
  );
}

/** Revoke via a normal RLS-scoped update - ownership is enforced by api_keys' own RLS policy, not re-checked here. */
export async function revokeApiKey(keyId: string): Promise<boolean> {
  const row = await q1<{ id: string }>(
    `update api_keys set revoked_at = now() where id = $1 and revoked_at is null returning id`,
    [keyId],
  );
  return !!row;
}
