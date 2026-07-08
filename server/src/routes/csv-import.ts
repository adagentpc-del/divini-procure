/**
 * Divini Procure - GENERIC ADMIN CSV IMPORT (with duplicate detection).
 *
 * Admin-only, additive bulk-import for four entity types:
 *   developers -> companies(kind='buyer', name, email)
 *   investors  -> investor_profiles(full_name, email[, user_id])
 *   contacts   -> contacts(owner_company_id, name, email, phone, company_name,
 *                          role, source)
 *   products   -> products(vendor_company_id, name, sku, category)
 *
 * Vendors are intentionally NOT handled here; they have a dedicated developer
 * facing flow in routes/vendor-import.ts (with the grandfathered-relationship
 * confirmation). This generic tool is a separate, admin-facing utility.
 *
 * Self-pathed (mounted with no prefix in routes.ts). Two endpoints, both
 * requireAdmin:
 *   POST /csv-import/preview { entityType, csvText }
 *       -> parse, map columns by header name, flag per-row duplicates against
 *          the existing data. Writes nothing.
 *   POST /csv-import/commit  { entityType, rows:[{fields, skip?}], ownerCompanyId? }
 *       -> create each non-skipped, non-duplicate row (each wrapped in
 *          try/catch), then write one import_batches summary row.
 *
 * Money is irrelevant here; products are imported without a price. Zero em
 * dashes by convention.
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import { getAuth, requireAdmin } from "../auth.js";
import { q, q1 } from "../pool.js";
import { parseCsv } from "../lib/csv-parse.js";

const h =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

const router = Router();

// ---------------------------------------------------------------------------
// Entity configuration: which header names map to which logical field, and
// which fields are required to create the row.
// ---------------------------------------------------------------------------
const ENTITY_TYPES = ["developers", "investors", "contacts", "products"] as const;
type EntityType = (typeof ENTITY_TYPES)[number];

function isEntityType(v: unknown): v is EntityType {
  return typeof v === "string" && (ENTITY_TYPES as readonly string[]).includes(v);
}

// Logical field -> the header aliases that may supply it (all lower case).
const FIELD_ALIASES: Record<EntityType, Record<string, string[]>> = {
  developers: {
    name: ["name", "company", "company_name", "developer", "organization"],
    email: ["email", "contact_email", "e-mail"],
  },
  investors: {
    full_name: ["full_name", "name", "investor", "investor_name", "contact"],
    email: ["email", "contact_email", "e-mail"],
    user_id: ["user_id", "userid"],
  },
  contacts: {
    name: ["name", "contact", "full_name"],
    email: ["email", "contact_email", "e-mail"],
    phone: ["phone", "telephone", "tel", "mobile"],
    company_name: ["company_name", "company", "organization", "org"],
    role: ["role", "title", "position"],
    source: ["source", "origin", "channel"],
  },
  products: {
    name: ["name", "product", "product_name", "title"],
    sku: ["sku", "code", "item", "item_no", "part_number"],
    category: ["category", "type"],
    vendor_company_id: ["vendor_company_id", "vendor_id", "vendor"],
  },
};

/**
 * Build a header-name -> column-index map for a given entity, returning the
 * detected mapping ({ field: headerName }) plus an index lookup we can use to
 * pull values out of each parsed row.
 */
function buildColumnMap(
  entityType: EntityType,
  headers: string[],
): { map: Record<string, string>; index: Record<string, number> } {
  const aliases = FIELD_ALIASES[entityType];
  const map: Record<string, string> = {};
  const index: Record<string, number> = {};
  for (const [field, names] of Object.entries(aliases)) {
    for (const name of names) {
      const i = headers.indexOf(name);
      if (i >= 0) {
        map[field] = headers[i];
        index[field] = i;
        break;
      }
    }
  }
  return { map, index };
}

/** Pull the configured fields out of a parsed string[] row. */
function rowToFields(
  index: Record<string, number>,
  cells: string[],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [field, i] of Object.entries(index)) {
    out[field] = (cells[i] ?? "").trim();
  }
  return out;
}

// ---------------------------------------------------------------------------
// Duplicate detection. Returns { matchId, matchLabel } or null per row.
// ---------------------------------------------------------------------------
type Match = { matchId: string; matchLabel: string } | null;

async function detectDuplicate(
  entityType: EntityType,
  fields: Record<string, string>,
): Promise<Match> {
  if (entityType === "developers") {
    const name = (fields.name || "").toLowerCase();
    const email = (fields.email || "").toLowerCase();
    if (!name && !email) return null;
    const row = await q1<{ id: string; name: string }>(
      `select id, name from companies
        where kind = 'buyer'
          and (
            ($1 <> '' and lower(name) = $1)
            or ($2 <> '' and email is not null and lower(email) = $2)
          )
        order by case when $1 <> '' and lower(name) = $1 then 0 else 1 end
        limit 1`,
      [name, email],
    );
    return row ? { matchId: row.id, matchLabel: row.name } : null;
  }

  if (entityType === "investors") {
    const name = (fields.full_name || "").toLowerCase();
    const email = (fields.email || "").toLowerCase();
    if (!name && !email) return null;
    const row = await q1<{ id: string; full_name: string; email: string | null }>(
      `select id, full_name, email from investor_profiles
        where (
            ($1 <> '' and lower(coalesce(full_name,'')) = $1)
            or ($2 <> '' and email is not null and lower(email) = $2)
          )
        order by case when $2 <> '' and lower(coalesce(email,'')) = $2 then 0 else 1 end
        limit 1`,
      [name, email],
    );
    return row ? { matchId: row.id, matchLabel: row.full_name || row.email || row.id } : null;
  }

  if (entityType === "contacts") {
    const name = (fields.name || "").toLowerCase();
    const email = (fields.email || "").toLowerCase();
    if (!name && !email) return null;
    const row = await q1<{ id: string; name: string | null; email: string | null }>(
      `select id, name, email from contacts
        where (
            ($1 <> '' and lower(coalesce(name,'')) = $1)
            or ($2 <> '' and email is not null and lower(email) = $2)
          )
        order by case when $2 <> '' and lower(coalesce(email,'')) = $2 then 0 else 1 end
        limit 1`,
      [name, email],
    );
    return row ? { matchId: row.id, matchLabel: row.name || row.email || row.id } : null;
  }

  // products: dedupe by lower(sku) WITHIN the same vendor company.
  const sku = (fields.sku || "").toLowerCase();
  const vendor = (fields.vendor_company_id || "").trim();
  if (!sku || !vendor) return null;
  const row = await q1<{ id: string; name: string | null; sku: string | null }>(
    `select id, name, sku from products
      where vendor_company_id = $1 and sku is not null and lower(sku) = $2
      limit 1`,
    [vendor, sku],
  );
  return row ? { matchId: row.id, matchLabel: row.name || row.sku || row.id } : null;
}

// ---------------------------------------------------------------------------
// POST /csv-import/preview - parse + map + flag duplicates, write nothing.
// ---------------------------------------------------------------------------
router.post(
  "/csv-import/preview",
  requireAdmin,
  h(async (req, res) => {
    const { entityType, csvText } = (req.body ?? {}) as Record<string, unknown>;
    if (!isEntityType(entityType)) {
      return res
        .status(400)
        .json({ error: "entityType must be one of developers|investors|contacts|products" });
    }
    if (typeof csvText !== "string" || !csvText.trim()) {
      return res.status(400).json({ error: "csvText required" });
    }

    const { headers, rows: rawRows } = parseCsv(csvText);
    const { map, index } = buildColumnMap(entityType, headers);

    const rows = [];
    for (let i = 0; i < rawRows.length; i++) {
      const fields = rowToFields(index, rawRows[i]);
      // Skip wholly empty rows (no mapped value at all).
      if (Object.values(fields).every((v) => v === "")) continue;
      const match = await detectDuplicate(entityType, fields);
      rows.push({
        index: rows.length,
        fields,
        duplicate: !!match,
        matchId: match ? match.matchId : null,
        matchLabel: match ? match.matchLabel : null,
      });
    }

    res.json({ entityType, columnMap: map, headers, rows });
  }),
);

// ---------------------------------------------------------------------------
// POST /csv-import/commit - create non-skipped, non-duplicate rows.
// ---------------------------------------------------------------------------
type CommitRow = { fields?: Record<string, unknown>; skip?: unknown; duplicate?: unknown };

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

router.post(
  "/csv-import/commit",
  requireAdmin,
  h(async (req, res) => {
    const auth = getAuth(req);
    const { entityType, rows, ownerCompanyId } = (req.body ?? {}) as Record<string, unknown>;

    if (!isEntityType(entityType)) {
      return res
        .status(400)
        .json({ error: "entityType must be one of developers|investors|contacts|products" });
    }
    if (!Array.isArray(rows)) {
      return res.status(400).json({ error: "rows array required" });
    }

    const owner = ownerCompanyId ? String(ownerCompanyId).trim() || null : null;
    const createdBy = auth.userId ?? null;

    let created = 0;
    let duplicates = 0;
    const errors: Array<{ index: number; error: string }> = [];

    for (let i = 0; i < (rows as CommitRow[]).length; i++) {
      const raw = (rows as CommitRow[])[i];
      const fields = (raw?.fields ?? {}) as Record<string, unknown>;

      // Honour an explicit skip, and re-check duplicates server side so the
      // client can never force a duplicate insert.
      if (raw?.skip === true) {
        continue;
      }

      const f = {
        name: str(fields.name),
        full_name: str(fields.full_name),
        email: str(fields.email),
        phone: str(fields.phone),
        company_name: str(fields.company_name),
        role: str(fields.role),
        source: str(fields.source),
        sku: str(fields.sku),
        category: str(fields.category),
        user_id: str(fields.user_id),
        vendor_company_id: str(fields.vendor_company_id),
      };

      try {
        const match = await detectDuplicate(entityType, f as Record<string, string>);
        if (match) {
          duplicates++;
          continue;
        }

        if (entityType === "developers") {
          if (!f.name) throw new Error("name required");
          await q(
            `insert into companies (kind, name, email) values ('buyer', $1, $2)`,
            [f.name, f.email || null],
          );
          created++;
        } else if (entityType === "investors") {
          if (!f.email) throw new Error("email required");
          // user_id is unique + may be NOT NULL depending on the deploy; supply
          // the CSV value when present, otherwise mint a stable placeholder so
          // the insert never violates a NOT NULL / unique constraint.
          const userId = f.user_id || `import:${crypto.randomUUID()}`;
          await q(
            `insert into investor_profiles (user_id, full_name, email)
             values ($1, $2, $3)`,
            [userId, f.full_name || null, f.email],
          );
          created++;
        } else if (entityType === "contacts") {
          if (!f.name && !f.email) throw new Error("name or email required");
          await q(
            `insert into contacts
               (owner_company_id, name, email, phone, company_name, role, source, created_by)
             values ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [
              owner,
              f.name || null,
              f.email || null,
              f.phone || null,
              f.company_name || null,
              f.role || null,
              f.source || null,
              createdBy,
            ],
          );
          created++;
        } else {
          // products
          if (!f.vendor_company_id) throw new Error("vendor_company_id required");
          if (!f.name) throw new Error("name required");
          await q(
            `insert into products (vendor_company_id, name, sku, category, created_by)
             values ($1,$2,$3,$4,$5)`,
            [f.vendor_company_id, f.name, f.sku || null, f.category || null, createdBy],
          );
          created++;
        }
      } catch (e: any) {
        errors.push({ index: i, error: e?.message ? String(e.message) : "row failed" });
      }
    }

    // Best-effort summary row; never fails the request if the table is absent.
    try {
      await q(
        `insert into import_batches
           (entity_type, row_count, created_count, duplicate_count, error_count, created_by)
         values ($1,$2,$3,$4,$5,$6)`,
        [entityType, (rows as CommitRow[]).length, created, duplicates, errors.length, createdBy],
      );
    } catch {
      /* import_batches may not be applied yet; the import still succeeded */
    }

    res.status(201).json({ created, duplicates, errors });
  }),
);

export default router;
