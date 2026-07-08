/**
 * Delivery & Installation Tracking for Divini Procure. Mounted under
 * /api/deliveries in routes.ts (the lead wires `router.use("/deliveries", deliveryRouter)`).
 *
 * Tracks the post-award lifecycle of a package:
 *   Production -> Shipped -> Delivered -> Installing -> Installed -> Complete
 * with the relevant dates, a punch list, and an append-only events log.
 *
 * Authorization reuses Procure's existing primitives (mirrors the
 * userOwnsPackage() / assertCanViewComparison() patterns in db.ts and
 * quote-comparison.ts):
 *   - the package's building owner (company_members of the building's company)
 *   - OR a vendor assigned to the package (a member of a company with a bid on
 *     the package, or the delivery's vendor_company_id)
 *   - OR a super-admin (ADMIN_ALLOWED_EMAILS, via getAuth().isAdmin)
 *
 * Tables: deliveries + delivery_punch_items + delivery_events
 * (db/schema-delivery.sql). Zero em dashes by convention.
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import { getAuth, requireUser } from "../auth.js";
import { q, q1 } from "../pool.js";
import { ForbiddenError, NotFoundError } from "../db.js";

// Async handler wrapper that funnels errors to the error middleware.
const h =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

const router = Router();

// ---- valid lifecycle status values -----------------------------------------
const STATUSES = new Set([
  "in_production",
  "shipped",
  "delivered",
  "installing",
  "installed",
  "complete",
  "delayed",
]);

/**
 * Authorize a user against a package: the package owner (building company
 * member), an assigned vendor (a member of a company with a bid on the
 * package), or a super-admin. Throws NotFoundError when the package does not
 * exist, ForbiddenError otherwise.
 */
async function assertCanAccessPackage(req: Request, packageId: string): Promise<void> {
  const auth = getAuth(req);
  const pkg = await q1<{ id: string }>(`select id from packages where id = $1`, [packageId]);
  if (!pkg) throw new NotFoundError("package not found");
  if (auth.isAdmin) return;
  // package owner (member of the company that owns the package's building)
  const owned = await q1(
    `select 1 from packages p
       join buildings b on b.id = p.building_id
       join company_members cm on cm.company_id = b.company_id
      where p.id = $1 and cm.user_id = $2`,
    [packageId, auth.userId],
  );
  if (owned) return;
  // assigned vendor (member of a company that has bid on this package)
  const vendor = await q1(
    `select 1 from bids bd
       join company_members cm on cm.company_id = bd.vendor_company_id
      where bd.package_id = $1 and cm.user_id = $2`,
    [packageId, auth.userId],
  );
  if (vendor) return;
  throw new ForbiddenError("not the owner or an assigned vendor of this package");
}

/** Resolve a delivery -> its package id, then run the package access check. */
async function assertCanAccessDelivery(req: Request, deliveryId: string): Promise<{ package_id: string }> {
  const row = await q1<{ package_id: string }>(
    `select package_id from deliveries where id = $1`,
    [deliveryId],
  );
  if (!row) throw new NotFoundError("delivery not found");
  await assertCanAccessPackage(req, row.package_id);
  return row;
}

/** Append an events-log row describing what happened. Best effort label. */
async function logEvent(deliveryId: string, label: string, actor: string | null): Promise<void> {
  await q(
    `insert into delivery_events (delivery_id, label, actor) values ($1, $2, $3)`,
    [deliveryId, label, actor],
  );
}

// ---- POST /deliveries -- create a delivery record for a package -------------
router.post(
  "/",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const packageId: string = req.body?.packageId ?? "";
    if (!packageId) return res.status(400).json({ error: "packageId required" });
    await assertCanAccessPackage(req, packageId);

    const vendorCompanyId: string | null = req.body?.vendorCompanyId ?? null;
    const submittalId: string | null = req.body?.submittalId ?? null;

    // If no vendor given, fall back to the awarded bid's vendor (best effort).
    let vendor = vendorCompanyId;
    if (!vendor) {
      const awarded = await q1<{ vendor_company_id: string }>(
        `select vendor_company_id from bids
          where package_id = $1 and coalesce(awarded, false) = true
          order by created_at limit 1`,
        [packageId],
      );
      vendor = awarded?.vendor_company_id ?? null;
    }

    const row = await q1<any>(
      `insert into deliveries (package_id, vendor_company_id, submittal_id, created_by)
         values ($1, $2, $3, $4)
       returning *`,
      [packageId, vendor, submittalId, auth.userId],
    );
    await logEvent(row.id, "Delivery record created", auth.email ?? auth.userId);
    res.status(201).json(row);
  }),
);

// ---- GET /deliveries/:packageId -- list deliveries with punch counts --------
router.get(
  "/:packageId",
  requireUser,
  h(async (req, res) => {
    const packageId = req.params.packageId;
    await assertCanAccessPackage(req, packageId);
    const rows = await q<any>(
      `select d.*,
              c.name as vendor_company,
              (select count(*) from delivery_punch_items pi where pi.delivery_id = d.id) as punch_total,
              (select count(*) from delivery_punch_items pi where pi.delivery_id = d.id and pi.resolved = false) as punch_open
         from deliveries d
         left join companies c on c.id = d.vendor_company_id
        where d.package_id = $1
        order by d.created_at`,
      [packageId],
    );
    res.json(
      rows.map((r) => ({
        ...r,
        punch_total: Number(r.punch_total ?? 0),
        punch_open: Number(r.punch_open ?? 0),
      })),
    );
  }),
);

// ---- GET /deliveries/item/:id -- one delivery + punch items + events --------
router.get(
  "/item/:id",
  requireUser,
  h(async (req, res) => {
    const deliveryId = req.params.id;
    await assertCanAccessDelivery(req, deliveryId);
    const delivery = await q1<any>(
      `select d.*, c.name as vendor_company
         from deliveries d
         left join companies c on c.id = d.vendor_company_id
        where d.id = $1`,
      [deliveryId],
    );
    const punch = await q<any>(
      `select * from delivery_punch_items where delivery_id = $1 order by created_at`,
      [deliveryId],
    );
    const events = await q<any>(
      `select * from delivery_events where delivery_id = $1 order by created_at desc`,
      [deliveryId],
    );
    res.json({ delivery, punch_items: punch, events });
  }),
);

// ---- PATCH /deliveries/:id -- update fields + append an events row ----------
router.patch(
  "/:id",
  requireUser,
  h(async (req, res) => {
    const deliveryId = req.params.id;
    await assertCanAccessDelivery(req, deliveryId);
    const auth = getAuth(req);

    // Whitelist of updatable columns. date fields accept ISO date or null.
    const FIELDS: Record<string, "text" | "date"> = {
      production_status: "text",
      shipping_status: "text",
      ship_date: "date",
      expected_delivery: "date",
      delivery_date: "date",
      install_date: "date",
      completion_date: "date",
      status: "text",
      notes: "text",
    };

    const sets: string[] = [];
    const vals: unknown[] = [];
    const changed: string[] = [];
    let i = 1;
    for (const [key, kind] of Object.entries(FIELDS)) {
      if (!(key in req.body)) continue;
      let v = req.body[key];
      if (key === "status" && v != null && !STATUSES.has(String(v))) {
        return res.status(400).json({ error: `invalid status: ${v}` });
      }
      if (kind === "date" && (v === "" || v === undefined)) v = null;
      sets.push(`${key} = $${i++}`);
      vals.push(v);
      changed.push(key.replace(/_/g, " "));
    }

    if (sets.length === 0) {
      return res.status(400).json({ error: "no updatable fields supplied" });
    }
    sets.push(`updated_at = now()`);
    vals.push(deliveryId);

    const row = await q1<any>(
      `update deliveries set ${sets.join(", ")} where id = $${i} returning *`,
      vals,
    );

    // Build a human-readable label for the events log.
    const statusPart = "status" in req.body ? ` to ${req.body.status}` : "";
    const label = `Updated ${changed.join(", ")}${statusPart}`;
    await logEvent(deliveryId, label, auth.email ?? auth.userId);

    res.json(row);
  }),
);

// ---- POST /deliveries/:id/punch -- add a punch list item --------------------
router.post(
  "/:id/punch",
  requireUser,
  h(async (req, res) => {
    const deliveryId = req.params.id;
    await assertCanAccessDelivery(req, deliveryId);
    const auth = getAuth(req);
    const description: string = req.body?.description ?? "";
    if (!description.trim()) return res.status(400).json({ error: "description required" });
    const row = await q1<any>(
      `insert into delivery_punch_items (delivery_id, description)
         values ($1, $2) returning *`,
      [deliveryId, description],
    );
    await logEvent(deliveryId, `Punch item added: ${description}`, auth.email ?? auth.userId);
    res.status(201).json(row);
  }),
);

// ---- PATCH /deliveries/punch/:itemId -- toggle resolved ---------------------
router.patch(
  "/punch/:itemId",
  requireUser,
  h(async (req, res) => {
    const itemId = req.params.itemId;
    const item = await q1<{ id: string; delivery_id: string; description: string }>(
      `select id, delivery_id, description from delivery_punch_items where id = $1`,
      [itemId],
    );
    if (!item) throw new NotFoundError("punch item not found");
    await assertCanAccessDelivery(req, item.delivery_id);
    const auth = getAuth(req);
    const resolved = req.body?.resolved === true;
    const row = await q1<any>(
      `update delivery_punch_items set resolved = $1 where id = $2 returning *`,
      [resolved, itemId],
    );
    await logEvent(
      item.delivery_id,
      `Punch item ${resolved ? "resolved" : "reopened"}: ${item.description}`,
      auth.email ?? auth.userId,
    );
    res.json(row);
  }),
);

export default router;
