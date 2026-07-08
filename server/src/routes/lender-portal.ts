/**
 * Divini Procure - Lender Portal and Draw Request workflow routes.
 *
 * Self-pathed router, mounted via router.use(lenderPortalRouter) in routes.ts.
 * Lenders access project data via tokenized public links (no auth required).
 * Developers manage draw requests and lender access via authenticated endpoints.
 * Money stored as integer cents throughout.
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import { getAuth, requireAdmin, requireUser } from "../auth.js";
import { q, q1 } from "../pool.js";

const h =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

const router = Router();

// ---------------------------------------------------------------------------
// Helper: resolve the caller's primary company from company_members
// ---------------------------------------------------------------------------
async function getCompanyId(userId: string | null): Promise<string | null> {
  if (!userId) return null;
  const row = await q1<{ company_id: string }>(
    `SELECT company_id FROM company_members WHERE user_id = $1 ORDER BY created_at LIMIT 1`,
    [userId],
  );
  return row?.company_id ?? null;
}

// ---------------------------------------------------------------------------
// GET /lender/access?buildingId=  -> list grants for a building
// ---------------------------------------------------------------------------
router.get(
  "/lender/access",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const companyId = await getCompanyId(auth.userId);
    const buildingId = (req.query as Record<string, string>).buildingId;
    if (!buildingId) return res.status(400).json({ error: "buildingId required" });

    const params: unknown[] = [buildingId];
    let companyFilter = "";
    if (!auth.isAdmin) {
      params.push(companyId);
      companyFilter = `AND developer_company_id = $2`;
    }

    const grants = await q<any>(
      `SELECT * FROM lender_project_access
        WHERE building_id = $1 ${companyFilter}
        ORDER BY granted_at DESC`,
      params,
    );
    return res.json({ grants });
  }),
);

// ---------------------------------------------------------------------------
// POST /lender/access  -> grant a lender access token
// ---------------------------------------------------------------------------
router.post(
  "/lender/access",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const companyId = await getCompanyId(auth.userId);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const { buildingId, lenderEmail, lenderCompanyName, lenderContactName, notes } = body;

    if (!buildingId || !lenderEmail) {
      return res.status(400).json({ error: "buildingId and lenderEmail required" });
    }

    const grant = await q1<any>(
      `INSERT INTO lender_project_access
         (building_id, developer_company_id, lender_email, lender_company_name, lender_contact_name, granted_by, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [buildingId, companyId, lenderEmail, lenderCompanyName ?? null, lenderContactName ?? null, auth.email, notes ?? null],
    );
    return res.json({ grant });
  }),
);

// ---------------------------------------------------------------------------
// DELETE /lender/access/:id  -> revoke a grant (soft delete)
// ---------------------------------------------------------------------------
router.delete(
  "/lender/access/:id",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const companyId = await getCompanyId(auth.userId);
    const params: unknown[] = [req.params.id];
    let companyFilter = "";
    if (!auth.isAdmin) {
      params.push(companyId);
      companyFilter = `AND developer_company_id = $2`;
    }

    const row = await q1<any>(
      `UPDATE lender_project_access
          SET status = 'revoked', revoked_at = now()
        WHERE id = $1 ${companyFilter}
       RETURNING id`,
      params,
    );
    if (!row) return res.status(404).json({ error: "grant not found" });
    return res.json({ ok: true });
  }),
);

// ---------------------------------------------------------------------------
// GET /draw-requests?buildingId=  -> list draw requests
// ---------------------------------------------------------------------------
router.get(
  "/draw-requests",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const companyId = await getCompanyId(auth.userId);
    const isAdmin = auth.isAdmin;
    const query = req.query as Record<string, string>;
    const params: unknown[] = [];
    const conditions: string[] = [];

    if (query.buildingId) {
      params.push(query.buildingId);
      conditions.push(`dr.building_id = $${params.length}`);
    }
    if (!isAdmin) {
      params.push(companyId);
      conditions.push(`dr.developer_company_id = $${params.length}`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const drawRequests = await q<any>(
      `SELECT dr.*,
              b.name AS building_name,
              c.name AS company_name
         FROM draw_requests dr
         LEFT JOIN buildings b ON b.id = dr.building_id
         LEFT JOIN companies c ON c.id = dr.developer_company_id
         ${where}
        ORDER BY dr.building_id, dr.draw_number DESC`,
      params,
    );
    return res.json({ drawRequests });
  }),
);

// ---------------------------------------------------------------------------
// POST /draw-requests  -> create a new draw request
// ---------------------------------------------------------------------------
router.post(
  "/draw-requests",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const companyId = await getCompanyId(auth.userId);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const {
      buildingId,
      periodStart,
      periodEnd,
      totalContractValueCents,
      previousDrawsCents,
      thisDrawCents,
      retainageHeldCents,
      percentComplete,
      notes,
      lineItems,
    } = body;

    if (!buildingId) return res.status(400).json({ error: "buildingId required" });

    // Auto-increment draw number if not provided
    let drawNumber = body.drawNumber as number | undefined;
    if (!drawNumber) {
      const row = await q1<{ next: string }>(
        `SELECT COALESCE(MAX(draw_number), 0) + 1 AS next FROM draw_requests WHERE building_id = $1`,
        [buildingId],
      );
      drawNumber = Number(row?.next ?? 1);
    }

    const thisDraw = Number(thisDrawCents ?? 0);
    const retainageHeld = Number(retainageHeldCents ?? 0);
    const netDraw = thisDraw - retainageHeld;

    const drawRequest = await q1<any>(
      `INSERT INTO draw_requests
         (building_id, developer_company_id, draw_number, period_start, period_end,
          total_contract_value_cents, previous_draws_cents, this_draw_cents,
          retainage_held_cents, net_draw_cents, percent_complete, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING *`,
      [
        buildingId,
        companyId,
        drawNumber,
        periodStart ?? null,
        periodEnd ?? null,
        Number(totalContractValueCents ?? 0),
        Number(previousDrawsCents ?? 0),
        thisDraw,
        retainageHeld,
        netDraw,
        percentComplete ?? null,
        notes ?? null,
      ],
    );

    const items: any[] = [];
    if (Array.isArray(lineItems) && lineItems.length > 0) {
      for (let i = 0; i < lineItems.length; i++) {
        const li = lineItems[i] as Record<string, unknown>;
        const item = await q1<any>(
          `INSERT INTO draw_line_items
             (draw_request_id, description, scheduled_value_cents, previous_billed_cents,
              this_period_cents, stored_materials_cents, completed_pct, retainage_pct, sort_order)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           RETURNING *`,
          [
            drawRequest!.id,
            li.description ?? "",
            Number(li.scheduledValueCents ?? 0),
            Number(li.previousBilledCents ?? 0),
            Number(li.thisPeriodCents ?? 0),
            Number(li.storedMaterialsCents ?? 0),
            li.completedPct ?? 0,
            li.retainagePct ?? 10,
            i,
          ],
        );
        items.push(item);
      }
    }

    return res.json({ drawRequest, lineItems: items });
  }),
);

// ---------------------------------------------------------------------------
// GET /draw-requests/:id  -> single draw request with line items + building
// ---------------------------------------------------------------------------
router.get(
  "/draw-requests/:id",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const companyId = await getCompanyId(auth.userId);
    const params: unknown[] = [req.params.id];
    let companyFilter = "";
    if (!auth.isAdmin) {
      params.push(companyId);
      companyFilter = `AND dr.developer_company_id = $2`;
    }

    const drawRequest = await q1<any>(
      `SELECT dr.*
         FROM draw_requests dr
        WHERE dr.id = $1 ${companyFilter}`,
      params,
    );
    if (!drawRequest) return res.status(404).json({ error: "draw request not found" });

    const lineItems = await q<any>(
      `SELECT * FROM draw_line_items WHERE draw_request_id = $1 ORDER BY sort_order`,
      [drawRequest.id],
    );

    const building = await q1<any>(
      `SELECT b.*, c.name AS developer_name
         FROM buildings b
         LEFT JOIN companies c ON c.id = b.company_id
        WHERE b.id = $1`,
      [drawRequest.building_id],
    );

    return res.json({ drawRequest, lineItems, building });
  }),
);

// ---------------------------------------------------------------------------
// PATCH /draw-requests/:id  -> update or transition status
// ---------------------------------------------------------------------------
router.patch(
  "/draw-requests/:id",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const companyId = await getCompanyId(auth.userId);
    const { email, isAdmin } = auth;
    const body = (req.body ?? {}) as Record<string, unknown>;

    const existing = await q1<any>(
      `SELECT * FROM draw_requests WHERE id = $1`,
      [req.params.id],
    );
    if (!existing) return res.status(404).json({ error: "draw request not found" });
    if (!isAdmin && existing.developer_company_id !== companyId) {
      return res.status(403).json({ error: "forbidden" });
    }

    const sets: string[] = [];
    const params: unknown[] = [];
    const add = (col: string, v: unknown) => {
      params.push(v);
      sets.push(`${col} = $${params.length}`);
    };

    const action = body.action as string | undefined;

    if (action === "submit") {
      add("status", "submitted");
      add("submitted_at", new Date().toISOString());
      add("submitted_by", email);
    } else if (action === "approve") {
      if (!isAdmin) return res.status(403).json({ error: "admin only" });
      add("status", "approved");
      add("lender_decision_at", new Date().toISOString());
      add("lender_decision_by", email);
      add("lender_notes", body.lenderNotes ?? null);
    } else if (action === "reject") {
      if (!isAdmin) return res.status(403).json({ error: "admin only" });
      add("status", "rejected");
      add("lender_decision_at", new Date().toISOString());
      add("lender_decision_by", email);
      add("lender_notes", body.lenderNotes ?? null);
    } else if (action === "fund") {
      if (!isAdmin) return res.status(403).json({ error: "admin only" });
      add("status", "funded");
    } else {
      // Field updates (draft only)
      if (existing.status !== "draft") {
        return res.status(400).json({ error: "can only edit fields on draft draw requests" });
      }
      if (body.notes !== undefined) add("notes", body.notes);
      if (body.percentComplete !== undefined) add("percent_complete", body.percentComplete);
      if (body.inspectorReportPath !== undefined) add("inspector_report_path", body.inspectorReportPath);
    }

    if (!sets.length) return res.status(400).json({ error: "no fields to update" });
    sets.push(`updated_at = now()`);
    params.push(req.params.id);

    const drawRequest = await q1<any>(
      `UPDATE draw_requests SET ${sets.join(", ")} WHERE id = $${params.length} RETURNING *`,
      params,
    );
    return res.json({ drawRequest });
  }),
);

// ---------------------------------------------------------------------------
// GET /lender/portal/:token  -> public tokenized lender view (no auth)
// ---------------------------------------------------------------------------
router.get(
  "/lender/portal/:token",
  h(async (req, res) => {
    const access = await q1<any>(
      `SELECT * FROM lender_project_access WHERE access_token = $1 AND status = 'active'`,
      [req.params.token],
    );
    if (!access) return res.status(404).json({ error: "invalid or expired link" });

    const building = await q1<any>(
      `SELECT b.*, c.name AS developer_name
         FROM buildings b
         LEFT JOIN companies c ON c.id = b.company_id
        WHERE b.id = $1`,
      [access.building_id],
    );

    const drawRequests = await q<any>(
      `SELECT * FROM draw_requests WHERE building_id = $1 ORDER BY draw_number`,
      [access.building_id],
    );

    // Compute summary from approved/funded draws
    const summaryRow = await q1<{ total_drawn: string; last_draw_date: string | null; latest_pct: string | null }>(
      `SELECT
         COALESCE(SUM(this_draw_cents) FILTER (WHERE status IN ('approved','funded')), 0) AS total_drawn,
         MAX(submitted_at) FILTER (WHERE status IN ('approved','funded')) AS last_draw_date,
         MAX(percent_complete) AS latest_pct
       FROM draw_requests
       WHERE building_id = $1`,
      [access.building_id],
    );

    return res.json({
      building,
      developer: { name: building?.developer_name ?? null },
      drawRequests,
      summary: {
        totalDrawnCents: Number(summaryRow?.total_drawn ?? 0),
        lastDrawDate: summaryRow?.last_draw_date ?? null,
        latestPercentComplete: summaryRow?.latest_pct != null ? Number(summaryRow.latest_pct) : null,
      },
    });
  }),
);

// ---------------------------------------------------------------------------
// GET /admin/draw-requests?status=  -> admin view of all draw requests
// ---------------------------------------------------------------------------
router.get(
  "/admin/draw-requests",
  requireAdmin,
  h(async (req, res) => {
    const status = (req.query as Record<string, string>).status;
    const params: unknown[] = [];
    let where = "";
    if (status) {
      params.push(status);
      where = `WHERE dr.status = $1`;
    }

    const drawRequests = await q<any>(
      `SELECT dr.*,
              b.name AS building_name,
              c.name AS developer_company_name
         FROM draw_requests dr
         LEFT JOIN buildings b ON b.id = dr.building_id
         LEFT JOIN companies c ON c.id = dr.developer_company_id
         ${where}
        ORDER BY dr.created_at DESC
        LIMIT 1000`,
      params,
    );
    return res.json({ drawRequests });
  }),
);

export default router;
