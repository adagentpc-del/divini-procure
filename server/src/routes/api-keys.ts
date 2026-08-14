/**
 * Divini Procure - developer API platform: key issuance/list/revoke.
 * Self-pathed under /api. See lib/api-keys.ts and schema-api-keys.sql for
 * the design (a key authenticates as its creating user, scopes only
 * narrow further).
 *
 *   POST   /api-keys           -> { apiKey } including the raw key, ONCE
 *   GET    /api-keys           -> { apiKeys: [...] } (no hash, no raw key)
 *   DELETE /api-keys/:id       -> { ok: true }
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import { getAuth, requireUser } from "../auth.js";
import { q1 } from "../pool.js";
import { createApiKey, listApiKeys, revokeApiKey, type ApiKeyScope } from "../lib/api-keys.js";

const h =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

const router = Router();

const VALID_SCOPES: ApiKeyScope[] = ["read", "write"];

async function getCompanyId(userId: string): Promise<string | null> {
  const row = await q1<{ company_id: string }>(
    `select company_id from company_members where user_id = $1 order by created_at asc limit 1`,
    [userId],
  );
  return row?.company_id ?? null;
}

router.post(
  "/api-keys",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const companyId = await getCompanyId(auth.userId!);
    if (!companyId) return res.status(400).json({ error: "no company for this account" });

    const body = (req.body ?? {}) as Record<string, unknown>;
    const name = typeof body.name === "string" ? body.name.trim().slice(0, 200) : "";
    if (!name) return res.status(400).json({ error: "name required" });

    let scopes: ApiKeyScope[];
    if (body.scopes === undefined) {
      scopes = ["read"];
    } else {
      if (!Array.isArray(body.scopes) || !body.scopes.every((s) => VALID_SCOPES.includes(s as ApiKeyScope))) {
        return res.status(400).json({ error: "scopes must be an array containing only 'read' and/or 'write'" });
      }
      scopes = Array.from(new Set(body.scopes as ApiKeyScope[]));
      if (scopes.length === 0) scopes = ["read"];
    }

    const created = await createApiKey(companyId, auth.userId!, name, scopes);
    // The raw key is returned exactly once, in this response, and never
    // again - only its hash is stored (schema-api-keys.sql).
    res.status(201).json({ apiKey: created });
  }),
);

router.get(
  "/api-keys",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const companyId = await getCompanyId(auth.userId!);
    if (!companyId) return res.json({ apiKeys: [] });
    const rows = await listApiKeys(companyId);
    res.json({ apiKeys: rows });
  }),
);

router.delete(
  "/api-keys/:id",
  requireUser,
  h(async (req, res) => {
    // api_keys' own RLS (company_id = caller's own company, or admin)
    // already scoped what row this UPDATE can even touch - a keyId for
    // another company's key simply matches zero rows here.
    const revoked = await revokeApiKey(req.params.id);
    if (!revoked) return res.status(404).json({ error: "API key not found or already revoked" });
    res.json({ ok: true });
  }),
);

export default router;
