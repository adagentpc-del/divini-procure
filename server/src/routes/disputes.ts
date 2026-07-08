/**
 * Divini Procure - DISPUTE RESOLUTION routes.
 *
 * Self-pathed router. Handles filing, responding, messaging, and resolving
 * contractor disputes: non-payment, scope disagreements, defective work, etc.
 * All monetary values are integer cents. Zero em dashes by convention.
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
// GET /disputes -- list disputes for the authenticated company (or all if admin)
// ---------------------------------------------------------------------------
router.get(
  "/disputes",
  requireUser,
  h(async (req, res) => {
    const { companyId, isAdmin } = getAuth(req);
    const status = (req.query.status as string) || "";
    const buildingId = (req.query.buildingId as string) || "";

    const params: unknown[] = [];
    const conditions: string[] = [];

    if (!isAdmin) {
      params.push(companyId);
      conditions.push(`(d.filed_by_company_id = $${params.length} OR d.against_company_id = $${params.length})`);
    }

    if (status) {
      params.push(status);
      conditions.push(`d.status = $${params.length}`);
    }

    if (buildingId) {
      params.push(buildingId);
      conditions.push(`d.building_id = $${params.length}`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const disputes = await q<any>(
      `SELECT d.*,
              fb.name AS filed_by_name,
              ag.name AS against_name
         FROM disputes d
         LEFT JOIN companies fb ON fb.id = d.filed_by_company_id
         LEFT JOIN companies ag ON ag.id = d.against_company_id
         ${where}
        ORDER BY d.created_at DESC
        LIMIT 500`,
      params,
    );

    res.json({ disputes });
  }),
);

// ---------------------------------------------------------------------------
// POST /disputes -- file a new dispute
// ---------------------------------------------------------------------------
router.post(
  "/disputes",
  requireUser,
  h(async (req, res) => {
    const { companyId, email } = getAuth(req);
    if (!companyId) {
      return res.status(400).json({ error: "company required" });
    }

    const {
      buildingId,
      packageId,
      againstCompanyId,
      disputeType,
      title,
      description,
      amountInDisputeCents,
    } = (req.body ?? {}) as Record<string, unknown>;

    if (!againstCompanyId || !disputeType || !title || !description) {
      return res.status(400).json({ error: "againstCompanyId, disputeType, title, and description are required" });
    }

    const dispute = await q1<any>(
      `INSERT INTO disputes
         (building_id, package_id, filed_by_company_id, against_company_id,
          dispute_type, title, description, amount_in_dispute_cents, response_due_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now() + interval '7 days')
       RETURNING *`,
      [
        buildingId ?? null,
        packageId ?? null,
        companyId,
        againstCompanyId,
        disputeType,
        title,
        description,
        amountInDisputeCents ?? 0,
      ],
    );

    res.status(201).json({ dispute });
  }),
);

// ---------------------------------------------------------------------------
// GET /disputes/:id -- fetch dispute detail + messages
// ---------------------------------------------------------------------------
router.get(
  "/disputes/:id",
  requireUser,
  h(async (req, res) => {
    const { companyId, isAdmin } = getAuth(req);

    const dispute = await q1<any>(
      `SELECT d.*,
              fb.name AS filed_by_name,
              ag.name AS against_name
         FROM disputes d
         LEFT JOIN companies fb ON fb.id = d.filed_by_company_id
         LEFT JOIN companies ag ON ag.id = d.against_company_id
        WHERE d.id = $1`,
      [req.params.id],
    );

    if (!dispute) {
      return res.status(404).json({ error: "dispute not found" });
    }

    if (!isAdmin && dispute.filed_by_company_id !== companyId && dispute.against_company_id !== companyId) {
      return res.status(403).json({ error: "forbidden" });
    }

    const msgParams: unknown[] = [req.params.id];
    const msgWhere = isAdmin ? "" : "AND m.is_visible_to_both = true";

    const messages = await q<any>(
      `SELECT m.*
         FROM dispute_messages m
        WHERE m.dispute_id = $1 ${msgWhere}
        ORDER BY m.created_at ASC`,
      msgParams,
    );

    res.json({ dispute, messages });
  }),
);

// ---------------------------------------------------------------------------
// PATCH /disputes/:id -- update dispute status / resolution fields
// ---------------------------------------------------------------------------
router.patch(
  "/disputes/:id",
  requireUser,
  h(async (req, res) => {
    const { companyId, email, isAdmin } = getAuth(req);

    const existing = await q1<any>(
      `SELECT * FROM disputes WHERE id = $1`,
      [req.params.id],
    );

    if (!existing) {
      return res.status(404).json({ error: "dispute not found" });
    }

    const isParty =
      existing.filed_by_company_id === companyId ||
      existing.against_company_id === companyId;

    if (!isAdmin && !isParty) {
      return res.status(403).json({ error: "forbidden" });
    }

    const {
      status,
      resolutionType,
      resolutionNotes,
      mediatorName,
      mediatorContact,
      platformSummary,
      platformSuggestion,
    } = (req.body ?? {}) as Record<string, unknown>;

    // Authorization checks for status transitions
    if (status !== undefined) {
      const s = String(status);
      if (s === "responded") {
        if (!isAdmin && existing.against_company_id !== companyId) {
          return res.status(403).json({ error: "only the responding party can mark as responded" });
        }
      } else if (s === "mediation") {
        if (!isAdmin && !isParty) {
          return res.status(403).json({ error: "only a party to the dispute can request mediation" });
        }
      } else if (s === "escalated" || s === "resolved" || s === "closed_no_action") {
        if (!isAdmin) {
          return res.status(403).json({ error: "admin only" });
        }
      }
    }

    const sets: string[] = [];
    const params: unknown[] = [];
    const add = (col: string, v: unknown) => {
      params.push(v);
      sets.push(`${col} = $${params.length}`);
    };

    if (status !== undefined) {
      add("status", String(status));
      if (String(status) === "resolved") {
        sets.push(`resolved_at = now()`);
        add("resolved_by", email);
      }
      if (String(status) === "escalated") {
        sets.push(`escalated_at = now()`);
      }
    }
    if (resolutionType !== undefined) add("resolution_type", resolutionType);
    if (resolutionNotes !== undefined) add("resolution_notes", resolutionNotes);
    if (mediatorName !== undefined) add("mediator_name", mediatorName);
    if (mediatorContact !== undefined) add("mediator_contact", mediatorContact);
    if (platformSummary !== undefined) add("platform_summary", platformSummary);
    if (platformSuggestion !== undefined) add("platform_suggestion", platformSuggestion);

    if (!sets.length) {
      return res.status(400).json({ error: "no fields to update" });
    }

    sets.push(`updated_at = now()`);
    params.push(req.params.id);

    const dispute = await q1<any>(
      `UPDATE disputes SET ${sets.join(", ")} WHERE id = $${params.length} RETURNING *`,
      params,
    );

    res.json({ dispute });
  }),
);

// ---------------------------------------------------------------------------
// POST /disputes/:id/messages -- add a message, evidence, or offer
// ---------------------------------------------------------------------------
router.post(
  "/disputes/:id/messages",
  requireUser,
  h(async (req, res) => {
    const { companyId, email, isAdmin } = getAuth(req);

    const dispute = await q1<any>(
      `SELECT * FROM disputes WHERE id = $1`,
      [req.params.id],
    );

    if (!dispute) {
      return res.status(404).json({ error: "dispute not found" });
    }

    const isParty =
      dispute.filed_by_company_id === companyId ||
      dispute.against_company_id === companyId;

    if (!isAdmin && !isParty) {
      return res.status(403).json({ error: "forbidden" });
    }

    const {
      message,
      messageType,
      amountOfferedCents,
      storagePath,
    } = (req.body ?? {}) as Record<string, unknown>;

    if (!message) {
      return res.status(400).json({ error: "message is required" });
    }

    const msgType = messageType ? String(messageType) : "message";

    if (msgType === "admin_note" && !isAdmin) {
      return res.status(403).json({ error: "admin only" });
    }

    const isVisibleToBoth = msgType !== "admin_note";

    const msg = await q1<any>(
      `INSERT INTO dispute_messages
         (dispute_id, author_company_id, author_email, message, message_type,
          amount_offered_cents, storage_path, is_visible_to_both)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        req.params.id,
        companyId,
        email,
        message,
        msgType,
        amountOfferedCents ?? null,
        storagePath ?? null,
        isVisibleToBoth,
      ],
    );

    res.status(201).json({ message: msg });
  }),
);

// ---------------------------------------------------------------------------
// GET /admin/disputes -- admin view of all disputes
// ---------------------------------------------------------------------------
router.get(
  "/admin/disputes",
  requireAdmin,
  h(async (req, res) => {
    const status = (req.query.status as string) || "";
    const params: unknown[] = [];
    let where = "";

    if (status) {
      params.push(status);
      where = `WHERE d.status = $1`;
    }

    const disputes = await q<any>(
      `SELECT d.*,
              fb.name AS filed_by_name,
              ag.name AS against_name
         FROM disputes d
         LEFT JOIN companies fb ON fb.id = d.filed_by_company_id
         LEFT JOIN companies ag ON ag.id = d.against_company_id
         ${where}
        ORDER BY d.created_at DESC
        LIMIT 1000`,
      params,
    );

    res.json({ disputes });
  }),
);

export default router;
