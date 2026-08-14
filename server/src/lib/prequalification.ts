/**
 * Divini Procure - vendor prequalification snapshot (competitive gap #3,
 * docs/competitive-analysis-2026-08.md).
 *
 * Facts only, never a score - same explicit design rule as
 * lib/vendor-signals.ts. Aggregates a company's own COI certificates and
 * trade/business licenses, and - when a buildingId is supplied - compares
 * them against that building's coi_requirements/license_requirements to
 * surface exactly which required types are missing or expired. This is
 * what a developer actually needs before considering a bid: a clear,
 * factual "is this vendor compliant for my project" answer, not an opaque
 * score folded into something else.
 *
 * Row visibility for a caller who is not the vendor itself is enforced by
 * RLS (schema-vendor-prequalification.sql's relationship-scoped SELECT
 * policies), not by this function - a developer with no real relationship
 * to the vendor simply sees empty coi/license rows here, which is safe
 * (it reveals nothing about the vendor's real records).
 */
import { q } from "../pool.js";

export type ComplianceStatus = "active" | "expiring_soon" | "expired";

export interface ComplianceRecord {
  type: string;
  status: ComplianceStatus;
  expiryDate: string;
}

export interface PrequalificationSnapshot {
  companyId: string;
  buildingId: string | null;
  coi: {
    onFile: ComplianceRecord[];
    requiredTypes: string[];
    missingTypes: string[];
    expiredRequiredTypes: string[];
  };
  licenses: {
    onFile: ComplianceRecord[];
    requiredTypes: string[];
    missingTypes: string[];
    expiredRequiredTypes: string[];
  };
  compliant: boolean;
}

function computeStatus(expiryDate: string): ComplianceStatus {
  const expiry = new Date(expiryDate).getTime();
  const now = Date.now();
  if (expiry < now) return "expired";
  if (expiry < now + 30 * 24 * 60 * 60 * 1000) return "expiring_soon";
  return "active";
}

async function loadOnFile(table: "coi_certificates" | "vendor_licenses", typeColumn: string, companyId: string): Promise<ComplianceRecord[]> {
  const rows = await q<{ type: string; expiry_date: string }>(
    `SELECT ${typeColumn} AS type, expiry_date FROM ${table}
      WHERE company_id = $1 AND status != 'suspended'
      ORDER BY expiry_date ASC`,
    [companyId],
  );
  return rows.map((r) => ({ type: r.type, status: computeStatus(r.expiry_date), expiryDate: r.expiry_date }));
}

async function loadRequiredTypes(table: "coi_requirements" | "license_requirements", typeColumn: string, buildingId: string): Promise<string[]> {
  const rows = await q<{ type: string }>(
    `SELECT DISTINCT ${typeColumn} AS type FROM ${table} WHERE building_id = $1 AND required = true`,
    [buildingId],
  );
  return rows.map((r) => r.type);
}

function missingAndExpired(onFile: ComplianceRecord[], requiredTypes: string[]): { missingTypes: string[]; expiredRequiredTypes: string[] } {
  const missingTypes: string[] = [];
  const expiredRequiredTypes: string[] = [];
  for (const type of requiredTypes) {
    const records = onFile.filter((r) => r.type === type);
    if (records.length === 0) {
      missingTypes.push(type);
      continue;
    }
    // A required type is only satisfied if at least one on-file record of
    // that type is not currently expired.
    const hasCurrent = records.some((r) => r.status !== "expired");
    if (!hasCurrent) expiredRequiredTypes.push(type);
  }
  return { missingTypes, expiredRequiredTypes };
}

export async function computePrequalificationSnapshot(
  companyId: string,
  buildingId: string | null,
): Promise<PrequalificationSnapshot> {
  const [coiOnFile, licenseOnFile] = await Promise.all([
    loadOnFile("coi_certificates", "certificate_type", companyId),
    loadOnFile("vendor_licenses", "license_type", companyId),
  ]);

  const [coiRequiredTypes, licenseRequiredTypes] = buildingId
    ? await Promise.all([
        loadRequiredTypes("coi_requirements", "certificate_type", buildingId),
        loadRequiredTypes("license_requirements", "license_type", buildingId),
      ])
    : [[], []];

  const coiGaps = missingAndExpired(coiOnFile, coiRequiredTypes);
  const licenseGaps = missingAndExpired(licenseOnFile, licenseRequiredTypes);

  // With no buildingId (a self-check, no specific requirement set to compare
  // against), "compliant" instead means nothing currently on file has
  // expired - the only fact available in that context.
  const compliant = buildingId
    ? coiGaps.missingTypes.length === 0 &&
      coiGaps.expiredRequiredTypes.length === 0 &&
      licenseGaps.missingTypes.length === 0 &&
      licenseGaps.expiredRequiredTypes.length === 0
    : !coiOnFile.some((r) => r.status === "expired") && !licenseOnFile.some((r) => r.status === "expired");

  return {
    companyId,
    buildingId,
    coi: { onFile: coiOnFile, requiredTypes: coiRequiredTypes, ...coiGaps },
    licenses: { onFile: licenseOnFile, requiredTypes: licenseRequiredTypes, ...licenseGaps },
    compliant,
  };
}
