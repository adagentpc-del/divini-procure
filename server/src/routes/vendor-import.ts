/**
 * Divini Procure - EXISTING-VENDOR CSV IMPORT.
 *
 * A developer (buyer) pastes or uploads a vendor list. We match each row to an
 * existing vendor company (by name or email) or create a starter vendor profile,
 * and let the developer confirm whether the relationship existed before Divini
 * Procure. A confirmed pre-existing relationship is recorded through the shared
 * grandfathered flow (lib/relationships.confirmExistingRelationship), which is
 * pair-scoped, developer-attested, and admin-review gated. Nothing here applies
 * the 2% fee directly.
 *
 * Mounted under /api in routes.ts (self-pathed, full /vendor-import prefix):
 *   POST /vendor-import/preview  (requireUser)  { csvText } -> parse + match, no writes
 *   POST /vendor-import/commit   (requireUser, member of developerCompanyId)
 *       { developerCompanyId, projectId?, rows:[...] } -> create/link + grandfather
 *
 * Additive. Zero em dashes by convention.
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import { getAuth, requireUser } from "../auth.js";
import { q, q1 } from "../pool.js";
import { ForbiddenError } from "../db.js";
import { confirmExistingRelationship } from "../lib/relationships.js";
import { EXISTING_RELATIONSHIP_TYPES, type ExistingRelationshipType } from "../lib/fee-rules.js";

const h =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

const router = Router();

// ---------------------------------------------------------------------------
// Tolerant CSV parsing
// ---------------------------------------------------------------------------
type ParsedRow = {
  index: number;
  name: string;
  email: string;
  category: string;
  website: string;
  contact: string;
};

const HEADER_KEYS = ["name", "email", "category", "website", "contact"] as const;
type HeaderKey = (typeof HEADER_KEYS)[number];

/** Split a single CSV line on commas, honouring simple double-quoted fields. */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

/** Detect a header row by looking for known column names. Returns a column map. */
function detectHeader(cells: string[]): Partial<Record<HeaderKey, number>> | null {
  const lowered = cells.map((c) => c.toLowerCase());
  const known = lowered.filter((c) => (HEADER_KEYS as readonly string[]).includes(c));
  if (known.length < 1) return null;
  // Require that at least one header cell is "name" or "email" to treat as header.
  if (!lowered.includes("name") && !lowered.includes("email")) return null;
  const map: Partial<Record<HeaderKey, number>> = {};
  lowered.forEach((c, i) => {
    if ((HEADER_KEYS as readonly string[]).includes(c)) map[c as HeaderKey] = i;
  });
  return map;
}

/**
 * Parse tolerant CSV text into rows. First non-empty line may be a header with
 * any subset of name,email,category,website,contact. Without a header we assume
 * positional order: name, email, category, website, contact.
 */
function parseCsv(csvText: string): ParsedRow[] {
  const lines = String(csvText || "")
    .split(/\r\n|\r|\n/)
    .map((l) => l)
    .filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];

  let header: Partial<Record<HeaderKey, number>> | null = null;
  let startAt = 0;
  const firstCells = splitCsvLine(lines[0]);
  const detected = detectHeader(firstCells);
  if (detected) {
    header = detected;
    startAt = 1;
  }

  const positional: Record<HeaderKey, number> = {
    name: 0,
    email: 1,
    category: 2,
    website: 3,
    contact: 4,
  };

  const rows: ParsedRow[] = [];
  for (let i = startAt; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    const pick = (key: HeaderKey): string => {
      const idx = header && header[key] !== undefined ? header[key]! : positional[key];
      return (cells[idx] ?? "").trim();
    };
    const name = pick("name");
    const email = pick("email");
    // Skip rows with neither a name nor an email; nothing to match or create.
    if (!name && !email) continue;
    rows.push({
      index: rows.length,
      name,
      email,
      category: pick("category"),
      website: pick("website"),
      contact: pick("contact"),
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------
type VendorMatch = { id: string; name: string } | null;

async function matchVendor(name: string, email: string): Promise<VendorMatch> {
  const n = name.trim().toLowerCase();
  const e = email.trim().toLowerCase();
  if (!n && !e) return null;
  // Exact lower(name) match first, then exact lower(email) match.
  const row = await q1<{ id: string; name: string }>(
    `select id, name from companies
      where kind = 'vendor'
        and (
          ($1 <> '' and lower(name) = $1)
          or ($2 <> '' and email is not null and lower(email) = $2)
        )
      order by case when $1 <> '' and lower(name) = $1 then 0 else 1 end
      limit 1`,
    [n, e],
  );
  return row ? { id: row.id, name: row.name } : null;
}

// ---------------------------------------------------------------------------
// POST /vendor-import/preview - parse + match, write nothing
// ---------------------------------------------------------------------------
router.post(
  "/vendor-import/preview",
  requireUser,
  h(async (req, res) => {
    const { csvText } = (req.body ?? {}) as Record<string, unknown>;
    if (typeof csvText !== "string" || !csvText.trim()) {
      return res.status(400).json({ error: "csvText required" });
    }
    const parsed = parseCsv(csvText);
    const rows = [];
    for (const r of parsed) {
      const match = await matchVendor(r.name, r.email);
      rows.push({
        index: r.index,
        name: r.name,
        email: r.email,
        category: r.category,
        website: r.website,
        contact: r.contact,
        matchedVendorCompanyId: match ? match.id : null,
        matchedVendorName: match ? match.name : null,
      });
    }
    res.json({ rows });
  }),
);

// ---------------------------------------------------------------------------
// POST /vendor-import/commit - create/link vendors + record grandfathered pairs
// ---------------------------------------------------------------------------
type CommitRow = {
  name?: unknown;
  email?: unknown;
  category?: unknown;
  website?: unknown;
  contact?: unknown;
  vendorCompanyId?: unknown;
  existedBefore?: unknown;
  relationshipType?: unknown;
  notes?: unknown;
};

router.post(
  "/vendor-import/commit",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const { developerCompanyId, projectId, rows, consentAcknowledged } = (req.body ?? {}) as Record<string, unknown>;

    // #14 PRIVACY CONSENT GATE -- the caller must explicitly pass
    // consentAcknowledged: true to attest that they have a legitimate business
    // basis (existing professional relationship) for importing each vendor's
    // name, email, and contact details, and that importing does not constitute
    // unsolicited contact or marketing. This mirrors the CCPA "legitimate
    // interest" and CAN-SPAM requirements for B2B data use.
    if (consentAcknowledged !== true) {
      return res.status(400).json({
        error:
          "consentAcknowledged required. By passing consentAcknowledged: true you attest that you have an existing professional relationship with each vendor in this list and a legitimate business basis for importing their contact details into Divini Procure.",
      });
    }

    if (!developerCompanyId) {
      return res.status(400).json({ error: "developerCompanyId required" });
    }
    if (!Array.isArray(rows)) {
      return res.status(400).json({ error: "rows array required" });
    }

    // Membership guard (mirrors the convention; throws ForbiddenError -> 403).
    const member = await q1("select 1 from company_members where user_id = $1 and company_id = $2", [
      auth.userId,
      String(developerCompanyId),
    ]);
    if (!member) throw new ForbiddenError("not a member of this company");

    const devCompanyId = String(developerCompanyId);
    const projId = projectId ? String(projectId) : null;

    const results: Array<{
      name: string;
      vendorCompanyId: string | null;
      created: boolean;
      grandfathered: boolean;
      error?: string;
    }> = [];
    const errors: Array<{ name: string; error: string }> = [];
    let created = 0;
    let linked = 0;
    let grandfathered = 0;

    for (const raw of rows as CommitRow[]) {
      const name = typeof raw?.name === "string" ? raw.name.trim() : "";
      const email = typeof raw?.email === "string" ? raw.email.trim() : "";
      const contact = typeof raw?.contact === "string" ? raw.contact.trim() : "";
      let vendorCompanyId =
        raw?.vendorCompanyId && String(raw.vendorCompanyId).trim()
          ? String(raw.vendorCompanyId).trim()
          : null;
      const existedBefore = raw?.existedBefore === true;
      const relationshipType = EXISTING_RELATIONSHIP_TYPES.includes(
        raw?.relationshipType as ExistingRelationshipType,
      )
        ? (raw?.relationshipType as ExistingRelationshipType)
        : null;
      const notes = typeof raw?.notes === "string" && raw.notes.trim() ? raw.notes.trim() : null;

      // Wrap each row so one bad row does not abort the batch.
      try {
        let wasCreated = false;
        if (!vendorCompanyId) {
          if (!name) throw new Error("row needs a vendor name to create a starter profile");
          const inserted = await q1<{ id: string }>(
            `insert into companies (kind, name, email, contact_name)
             values ('vendor', $1, $2, $3) returning id`,
            [name, email || null, contact || null],
          );
          vendorCompanyId = inserted!.id;
          wasCreated = true;
          created++;
        } else {
          linked++;
        }

        let didGrandfather = false;
        if (existedBefore && relationshipType) {
          // Shared grandfathered flow: pair-scoped attestation, queued for admin
          // review. Does NOT apply the 2% fee on its own.
          await confirmExistingRelationship({
            userId: auth.userId!,
            email: auth.email,
            developerCompanyId: devCompanyId,
            vendorCompanyId,
            projectId: projId,
            relationshipType,
            notes,
          });
          didGrandfather = true;
          grandfathered++;
        }

        results.push({
          name: name || email || vendorCompanyId,
          vendorCompanyId,
          created: wasCreated,
          grandfathered: didGrandfather,
        });
      } catch (e: any) {
        const msg = e?.message ? String(e.message) : "row failed";
        results.push({
          name: name || email || "(unnamed row)",
          vendorCompanyId: vendorCompanyId,
          created: false,
          grandfathered: false,
          error: msg,
        });
        errors.push({ name: name || email || "(unnamed row)", error: msg });
      }
    }

    // Optional batch log (best effort; never fails the request).
    try {
      await q(
        `insert into vendor_import_batches
           (developer_company_id, row_count, created_count, linked_count,
            grandfathered_count, error_count, created_by)
         values ($1,$2,$3,$4,$5,$6,$7)`,
        [devCompanyId, rows.length, created, linked, grandfathered, errors.length, auth.userId],
      );
    } catch {
      /* log table may not be applied yet; the import still succeeded */
    }

    res.status(201).json({
      summary: { created, linked, grandfathered, errors },
      results,
    });
  }),
);

export default router;
