/**
 * Divini Procure - developer/vendor relationship data layer (grandfathered 2%).
 *
 * Pair-scoped (one row per developer-vendor pair). The developer ATTESTS a
 * pre-existing relationship (checkbox); that sets the pair to
 * existing_relationship_claimed + pending admin review and marks it eligible.
 * The 2% rate only takes effect when an admin APPROVES (relationship_status
 * becomes grandfathered_2_percent). Nothing auto-applies the fee, and ordinary
 * automations never write relationship_status, so the protected rate is safe.
 *
 * All write paths append to dvr_audit_log.
 * Zero em dashes by convention.
 */
import { q, q1 } from "../pool.js";
import { ForbiddenError, NotFoundError } from "../db.js";
import {
  resolveFee,
  type ResolvedFee,
  EXISTING_RELATIONSHIP_TYPES,
  type ExistingRelationshipType,
  GRANDFATHERED_FEE_PERCENTAGE,
} from "./fee-rules.js";

export interface RelationshipRow {
  id: string;
  developer_company_id: string;
  vendor_company_id: string;
  project_id: string | null;
  relationship_status: string;
  existing_relationship_confirmed: boolean;
  existing_relationship_type: string | null;
  existing_relationship_confirmed_by: string | null;
  existing_relationship_confirmed_at: string | null;
  existing_relationship_notes: string | null;
  supporting_document_url: string | null;
  active_contract_before_platform: boolean;
  active_negotiations_before_platform: boolean;
  already_working_together_before_platform: boolean;
  already_selected_or_shortlisted_before_platform: boolean;
  grandfathered_fee_eligible: boolean;
  grandfathered_fee_percentage: number | string;
  grandfathered_fee_applies_forever: boolean;
  grandfathered_fee_started_at: string | null;
  standard_fee_percentage: number | string | null;
  fee_rule_source: string | null;
  admin_review_status: string;
  admin_reviewed_by: string | null;
  admin_reviewed_at: string | null;
  admin_notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// membership guard (mirrors db.ts assertMemberOfCompany, which is not exported)
// ---------------------------------------------------------------------------
export async function assertMember(userId: string, companyId: string): Promise<void> {
  const row = await q1(`select 1 from company_members where user_id = $1 and company_id = $2`, [
    userId,
    companyId,
  ]);
  if (!row) throw new ForbiddenError("not a member of this company");
}

// ---------------------------------------------------------------------------
// audit
// ---------------------------------------------------------------------------
export async function addAudit(args: {
  relationshipId: string | null;
  developerCompanyId?: string | null;
  vendorCompanyId?: string | null;
  actorUserId?: string | null;
  actorEmail?: string | null;
  action: string;
  detail?: Record<string, unknown>;
}): Promise<void> {
  await q(
    `insert into dvr_audit_log
       (relationship_id, developer_company_id, vendor_company_id, actor_user_id, actor_email, action, detail)
     values ($1,$2,$3,$4,$5,$6,$7)`,
    [
      args.relationshipId,
      args.developerCompanyId ?? null,
      args.vendorCompanyId ?? null,
      args.actorUserId ?? null,
      args.actorEmail ?? null,
      args.action,
      args.detail ? JSON.stringify(args.detail) : null,
    ],
  );
}

export async function getAudit(relationshipId: string) {
  return q(`select * from dvr_audit_log where relationship_id = $1 order by created_at asc`, [
    relationshipId,
  ]);
}

// ---------------------------------------------------------------------------
// reads
// ---------------------------------------------------------------------------
export async function getById(id: string): Promise<RelationshipRow | null> {
  return q1<RelationshipRow>(`select * from developer_vendor_relationships where id = $1`, [id]);
}

export async function getByPair(
  developerCompanyId: string,
  vendorCompanyId: string,
): Promise<RelationshipRow | null> {
  return q1<RelationshipRow>(
    `select * from developer_vendor_relationships
      where developer_company_id = $1 and vendor_company_id = $2`,
    [developerCompanyId, vendorCompanyId],
  );
}

/** Relationships for a developer, with vendor name joined for display. */
export async function listForDeveloper(developerCompanyId: string) {
  return q(
    `select r.*, v.name as vendor_name, v.kind as vendor_kind
       from developer_vendor_relationships r
       join companies v on v.id = r.vendor_company_id
      where r.developer_company_id = $1
      order by r.updated_at desc`,
    [developerCompanyId],
  );
}

/** Relationships for a vendor, with developer name joined for display. */
export async function listForVendor(vendorCompanyId: string) {
  return q(
    `select r.*, d.name as developer_name, d.kind as developer_kind
       from developer_vendor_relationships r
       join companies d on d.id = r.developer_company_id
      where r.vendor_company_id = $1
      order by r.updated_at desc`,
    [vendorCompanyId],
  );
}

/** Admin review queue with both names joined. Optional status filter. */
export async function listForAdmin(statusFilter?: string) {
  const params: unknown[] = [];
  let where = "";
  if (statusFilter) {
    params.push(statusFilter);
    where = `where r.admin_review_status = $1`;
  }
  return q(
    `select r.*, d.name as developer_name, v.name as vendor_name
       from developer_vendor_relationships r
       join companies d on d.id = r.developer_company_id
       join companies v on v.id = r.vendor_company_id
       ${where}
      order by
        case r.admin_review_status when 'pending_review' then 0 when 'needs_more_info' then 1 else 2 end,
        r.updated_at desc
      limit 1000`,
    params,
  );
}

// ---------------------------------------------------------------------------
// developer attestation (the required checkbox)
// ---------------------------------------------------------------------------
export interface ConfirmInput {
  userId: string;
  email: string | null;
  developerCompanyId: string;
  vendorCompanyId: string;
  projectId?: string | null;
  relationshipType: ExistingRelationshipType;
  notes?: string | null;
  supportingDocumentUrl?: string | null;
}

/**
 * Developer confirms a pre-existing relationship. Upserts the pair, records the
 * attestation, flips status to existing_relationship_claimed and queues admin
 * review. Marks the pair eligible for the 2% fee but does NOT yet apply it (only
 * admin approval sets relationship_status = grandfathered_2_percent).
 */
export async function confirmExistingRelationship(input: ConfirmInput): Promise<RelationshipRow> {
  await assertMember(input.userId, input.developerCompanyId);

  const type = EXISTING_RELATIONSHIP_TYPES.includes(input.relationshipType)
    ? input.relationshipType
    : "prior_vendor_relationship";

  const activeContract = type === "active_contract";
  const activeNegotiation = type === "active_negotiation";
  const alreadyWorking = type === "already_working_together";
  const alreadyShortlisted = type === "already_selected_or_shortlisted";

  const existing = await getByPair(input.developerCompanyId, input.vendorCompanyId);

  let row: RelationshipRow;
  if (existing) {
    // Do not downgrade an already-approved grandfathered pair via re-attestation.
    row = (await q1<RelationshipRow>(
      `update developer_vendor_relationships set
         project_id = coalesce($1, project_id),
         relationship_status = case when relationship_status = 'grandfathered_2_percent'
                                    then relationship_status else 'existing_relationship_claimed' end,
         existing_relationship_confirmed = true,
         existing_relationship_type = $2,
         existing_relationship_confirmed_by = $3,
         existing_relationship_confirmed_at = now(),
         existing_relationship_notes = $4,
         supporting_document_url = coalesce($5, supporting_document_url),
         active_contract_before_platform = $6,
         active_negotiations_before_platform = $7,
         already_working_together_before_platform = $8,
         already_selected_or_shortlisted_before_platform = $9,
         grandfathered_fee_eligible = true,
         fee_rule_source = coalesce(fee_rule_source, 'developer_checkbox'),
         admin_review_status = case when admin_review_status = 'approved'
                                    then admin_review_status else 'pending_review' end,
         updated_at = now()
       where id = $10 returning *`,
      [
        input.projectId ?? null,
        type,
        input.userId,
        input.notes ?? null,
        input.supportingDocumentUrl ?? null,
        activeContract,
        activeNegotiation,
        alreadyWorking,
        alreadyShortlisted,
        existing.id,
      ],
    ))!;
  } else {
    row = (await q1<RelationshipRow>(
      `insert into developer_vendor_relationships
         (developer_company_id, vendor_company_id, project_id, relationship_status,
          existing_relationship_confirmed, existing_relationship_type,
          existing_relationship_confirmed_by, existing_relationship_confirmed_at,
          existing_relationship_notes, supporting_document_url,
          active_contract_before_platform, active_negotiations_before_platform,
          already_working_together_before_platform, already_selected_or_shortlisted_before_platform,
          grandfathered_fee_eligible, grandfathered_fee_percentage, grandfathered_fee_applies_forever,
          fee_rule_source, admin_review_status, created_by)
       values ($1,$2,$3,'existing_relationship_claimed',
               true,$4,$5,now(),$6,$7,$8,$9,$10,$11,
               true,$12,true,'developer_checkbox','pending_review',$5)
       returning *`,
      [
        input.developerCompanyId,
        input.vendorCompanyId,
        input.projectId ?? null,
        type,
        input.userId,
        input.notes ?? null,
        input.supportingDocumentUrl ?? null,
        activeContract,
        activeNegotiation,
        alreadyWorking,
        alreadyShortlisted,
        GRANDFATHERED_FEE_PERCENTAGE,
      ],
    ))!;
  }

  await addAudit({
    relationshipId: row.id,
    developerCompanyId: row.developer_company_id,
    vendorCompanyId: row.vendor_company_id,
    actorUserId: input.userId,
    actorEmail: input.email,
    action: "existing_relationship_confirmed",
    detail: {
      relationship_type: type,
      project_id: input.projectId ?? null,
      has_supporting_document: !!input.supportingDocumentUrl,
      notes: input.notes ?? null,
    },
  });

  return row;
}

// ---------------------------------------------------------------------------
// admin review
// ---------------------------------------------------------------------------
export async function adminReview(args: {
  id: string;
  decision: "approve" | "reject" | "needs_more_info";
  adminUserId: string;
  adminEmail: string | null;
  notes?: string | null;
}): Promise<RelationshipRow> {
  const rel = await getById(args.id);
  if (!rel) throw new NotFoundError("relationship not found");

  let relationshipStatus = rel.relationship_status;
  let reviewStatus = rel.admin_review_status;
  let eligible = rel.grandfathered_fee_eligible;
  let startedAt: "now" | "keep" | "clear" = "keep";

  if (args.decision === "approve") {
    relationshipStatus = "grandfathered_2_percent";
    reviewStatus = "approved";
    eligible = true;
    startedAt = rel.grandfathered_fee_started_at ? "keep" : "now";
  } else if (args.decision === "reject") {
    relationshipStatus = "standard_fee";
    reviewStatus = "rejected";
    eligible = false;
    startedAt = "clear";
  } else {
    reviewStatus = "needs_more_info";
  }

  const startedExpr =
    startedAt === "now"
      ? "now()"
      : startedAt === "clear"
        ? "null"
        : "grandfathered_fee_started_at";

  const row = (await q1<RelationshipRow>(
    `update developer_vendor_relationships set
       relationship_status = $1,
       admin_review_status = $2,
       grandfathered_fee_eligible = $3,
       grandfathered_fee_started_at = ${startedExpr},
       admin_reviewed_by = $4,
       admin_reviewed_at = now(),
       admin_notes = coalesce($5, admin_notes),
       updated_at = now()
     where id = $6 returning *`,
    [relationshipStatus, reviewStatus, eligible, args.adminUserId, args.notes ?? null, args.id],
  ))!;

  await addAudit({
    relationshipId: row.id,
    developerCompanyId: row.developer_company_id,
    vendorCompanyId: row.vendor_company_id,
    actorUserId: args.adminUserId,
    actorEmail: args.adminEmail,
    action: "admin_review",
    detail: { decision: args.decision, notes: args.notes ?? null, new_status: relationshipStatus },
  });

  return row;
}

/** Admin override: set an explicit fee % (and grandfather it) outside the normal flow. */
export async function adminOverride(args: {
  id: string;
  feePercentage: number;
  adminUserId: string;
  adminEmail: string | null;
  reason?: string | null;
}): Promise<RelationshipRow> {
  const rel = await getById(args.id);
  if (!rel) throw new NotFoundError("relationship not found");
  const pct = Number.isFinite(args.feePercentage) && args.feePercentage >= 0 ? args.feePercentage : 2.0;

  const row = (await q1<RelationshipRow>(
    `update developer_vendor_relationships set
       relationship_status = 'grandfathered_2_percent',
       grandfathered_fee_eligible = true,
       grandfathered_fee_percentage = $1,
       grandfathered_fee_started_at = coalesce(grandfathered_fee_started_at, now()),
       fee_rule_source = 'admin_override',
       admin_review_status = 'approved',
       admin_reviewed_by = $2,
       admin_reviewed_at = now(),
       admin_notes = coalesce($3, admin_notes),
       updated_at = now()
     where id = $4 returning *`,
    [pct, args.adminUserId, args.reason ?? null, args.id],
  ))!;

  await addAudit({
    relationshipId: row.id,
    developerCompanyId: row.developer_company_id,
    vendorCompanyId: row.vendor_company_id,
    actorUserId: args.adminUserId,
    actorEmail: args.adminEmail,
    action: "fee_override",
    detail: { fee_percentage: pct, reason: args.reason ?? null },
  });

  return row;
}

export async function setLifecycle(args: {
  id: string;
  state: "disputed" | "inactive";
  adminUserId: string;
  adminEmail: string | null;
  notes?: string | null;
}): Promise<RelationshipRow> {
  const rel = await getById(args.id);
  if (!rel) throw new NotFoundError("relationship not found");

  const eligible = args.state === "inactive" ? false : rel.grandfathered_fee_eligible;
  const row = (await q1<RelationshipRow>(
    `update developer_vendor_relationships set
       relationship_status = $1,
       grandfathered_fee_eligible = $2,
       admin_notes = coalesce($3, admin_notes),
       updated_at = now()
     where id = $4 returning *`,
    [args.state, eligible, args.notes ?? null, args.id],
  ))!;

  await addAudit({
    relationshipId: row.id,
    developerCompanyId: row.developer_company_id,
    vendorCompanyId: row.vendor_company_id,
    actorUserId: args.adminUserId,
    actorEmail: args.adminEmail,
    action: args.state === "disputed" ? "disputed" : "deactivated",
    detail: { notes: args.notes ?? null },
  });

  return row;
}

// ---------------------------------------------------------------------------
// fee resolution + risk flags
// ---------------------------------------------------------------------------
export function effectiveFee(rel: RelationshipRow | null): ResolvedFee {
  return resolveFee(rel);
}

/** Fee-rule risk flags for a relationship (spec Part 23 fee risks). */
export function riskFlags(rel: RelationshipRow): { level: "low" | "medium" | "high"; flags: string[] } {
  const flags: string[] = [];
  if (rel.existing_relationship_confirmed && !rel.existing_relationship_notes && !rel.supporting_document_url) {
    flags.push("Existing-relationship claimed without explanation or supporting document.");
  }
  if (
    rel.relationship_status === "grandfathered_2_percent" &&
    !rel.supporting_document_url &&
    rel.fee_rule_source === "developer_checkbox"
  ) {
    flags.push("Grandfathered 2% claim has no uploaded support.");
  }
  if (!rel.relationship_status || rel.relationship_status === "no_prior_relationship") {
    if (rel.grandfathered_fee_eligible) {
      flags.push("Marked eligible but relationship status not set.");
    }
  }
  if (rel.relationship_status === "disputed") {
    flags.push("Relationship is disputed.");
  }
  if (rel.admin_review_status === "pending_review") {
    flags.push("Awaiting admin review.");
  }
  const level = flags.some((f) => f.includes("disputed") || f.includes("no uploaded support"))
    ? "high"
    : flags.length
      ? "medium"
      : "low";
  return { level, flags };
}
