/**
 * Payment ETA Tracker
 * Self-pathed under /me.
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import { getAuth, requireUser } from "../auth.js";
import { q, q1 } from "../pool.js";

const h =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

const router = Router();

async function getCompanyId(userId: string | null | undefined): Promise<string | null> {
  if (!userId) return null;
  const row = await q1<{ company_id: string }>(
    `SELECT company_id FROM company_members WHERE user_id = $1 LIMIT 1`,
    [userId],
  );
  return row?.company_id ?? null;
}

function computePaymentFields(awardedAt: Date, amountCents: number) {
  const estimatedPaymentDate = new Date(awardedAt.getTime() + 30 * 24 * 60 * 60 * 1000);
  const now = new Date();
  const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  let paymentStatus: "overdue" | "due_soon" | "on_track";
  if (estimatedPaymentDate < now) {
    paymentStatus = "overdue";
  } else if (estimatedPaymentDate < sevenDaysFromNow) {
    paymentStatus = "due_soon";
  } else {
    paymentStatus = "on_track";
  }
  const daysUntilPayment = Math.ceil((estimatedPaymentDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  return { estimatedPaymentDate, paymentStatus, daysUntilPayment, amountCents };
}

// GET /me/payment-status
router.get(
  "/me/payment-status",
  requireUser,
  h(async (req, res) => {
    const { userId } = getAuth(req);
    const companyId = await getCompanyId(userId);
    if (!companyId) return res.json({ payments: [] });

    const rows = await q<any>(
      `SELECT b.id, b.amount_cents, b.created_at AS awarded_at,
              p.id AS package_id, p.name AS package_name, p.status AS package_status,
              bld.name AS building_name, bld.id AS building_id
         FROM bids b
         JOIN packages p ON p.id = b.package_id
         JOIN buildings bld ON bld.id = p.building_id
        WHERE b.company_id = $1 AND b.status = 'awarded'
        ORDER BY b.created_at DESC
        LIMIT 50`,
      [companyId],
    );

    const payments = rows.map((row: any) => {
      const fields = computePaymentFields(new Date(row.awarded_at), Number(row.amount_cents));
      return {
        id: row.id,
        packageId: row.package_id,
        packageName: row.package_name,
        buildingName: row.building_name,
        buildingId: row.building_id,
        amountCents: fields.amountCents,
        awardedAt: row.awarded_at,
        estimatedPaymentDate: fields.estimatedPaymentDate,
        paymentStatus: fields.paymentStatus,
        daysUntilPayment: fields.daysUntilPayment,
      };
    });

    res.json({ payments });
  }),
);

// GET /me/payment-summary
router.get(
  "/me/payment-summary",
  requireUser,
  h(async (req, res) => {
    const { userId } = getAuth(req);
    const companyId = await getCompanyId(userId);
    if (!companyId) {
      return res.json({ totalPendingCents: 0, totalOverdueCents: 0, nextPaymentDate: null, nextPaymentCents: 0 });
    }

    const rows = await q<any>(
      `SELECT b.id, b.amount_cents, b.created_at AS awarded_at
         FROM bids b
         JOIN packages p ON p.id = b.package_id
        WHERE b.company_id = $1 AND b.status = 'awarded'
        ORDER BY b.created_at DESC
        LIMIT 50`,
      [companyId],
    );

    let totalPendingCents = 0;
    let totalOverdueCents = 0;
    let nextPayment: { date: Date; amountCents: number } | null = null;

    for (const row of rows) {
      const { estimatedPaymentDate, paymentStatus, amountCents } = computePaymentFields(
        new Date(row.awarded_at),
        Number(row.amount_cents),
      );
      if (paymentStatus === "overdue") {
        totalOverdueCents += amountCents;
      } else {
        totalPendingCents += amountCents;
        if (!nextPayment || estimatedPaymentDate < nextPayment.date) {
          nextPayment = { date: estimatedPaymentDate, amountCents };
        }
      }
    }

    res.json({
      totalPendingCents,
      totalOverdueCents,
      nextPaymentDate: nextPayment ? nextPayment.date.toISOString() : null,
      nextPaymentCents: nextPayment ? nextPayment.amountCents : 0,
    });
  }),
);

export default router;
