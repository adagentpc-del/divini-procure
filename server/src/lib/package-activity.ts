/**
 * Divini Procure - plan room activity tracking (competitive gap #6,
 * docs/competitive-analysis-2026-08.md): "granular activity tracking (who
 * viewed/downloaded/bid)... bid-engagement transparency for the
 * developer." See schema-package-activity.sql for the table + RLS.
 *
 * logPackageView/logDocumentDownload are best-effort and never throw -
 * called from an authenticated read path (viewing a package, requesting a
 * document's signed URL), and a logging failure must never break that
 * read. Only ever logs the CALLER's own company as the viewer (matches
 * the RLS insert policy exactly - see that file's header), so this can
 * run under the caller's normal request context, no admin escalation
 * needed.
 */
import { q } from "../pool.js";

export async function logPackageView(args: {
  packageId: string;
  buildingId: string;
  developerCompanyId: string;
  viewerCompanyId: string;
}): Promise<void> {
  try {
    await q(
      `insert into package_activity_events (package_id, building_id, developer_company_id, viewer_company_id, event_type)
       values ($1, $2, $3, $4, 'viewed')`,
      [args.packageId, args.buildingId, args.developerCompanyId, args.viewerCompanyId],
    );
  } catch {
    // best-effort - viewing a package must never fail because logging did
  }
}

export async function logDocumentDownload(args: {
  packageId: string;
  buildingId: string;
  developerCompanyId: string;
  viewerCompanyId: string;
  documentId: string;
}): Promise<void> {
  try {
    await q(
      `insert into package_activity_events (package_id, building_id, developer_company_id, viewer_company_id, event_type, document_id)
       values ($1, $2, $3, $4, 'document_downloaded', $5)`,
      [args.packageId, args.buildingId, args.developerCompanyId, args.viewerCompanyId, args.documentId],
    );
  } catch {
    // best-effort - a signed download URL must never fail because logging did
  }
}

export interface PackageActivitySummary {
  packageId: string;
  totalViews: number;
  distinctViewerCompanies: number;
  totalDownloads: number;
  perVendor: Array<{
    viewerCompanyId: string;
    viewerCompanyName: string | null;
    viewCount: number;
    downloadCount: number;
    lastActivityAt: string;
  }>;
}

/** Developer-facing summary for one package. Caller must already be authorized (RLS also enforces it independently). */
export async function getPackageActivitySummary(packageId: string): Promise<PackageActivitySummary> {
  const rows = await q<{
    viewer_company_id: string;
    viewer_company_name: string | null;
    view_count: string;
    download_count: string;
    last_activity_at: string;
  }>(
    `select e.viewer_company_id,
            c.name as viewer_company_name,
            count(*) filter (where e.event_type = 'viewed') as view_count,
            count(*) filter (where e.event_type = 'document_downloaded') as download_count,
            max(e.created_at) as last_activity_at
       from package_activity_events e
       left join companies c on c.id = e.viewer_company_id
      where e.package_id = $1
      group by e.viewer_company_id, c.name
      order by max(e.created_at) desc`,
    [packageId],
  );

  const perVendor = rows.map((r) => ({
    viewerCompanyId: r.viewer_company_id,
    viewerCompanyName: r.viewer_company_name,
    viewCount: Number(r.view_count),
    downloadCount: Number(r.download_count),
    lastActivityAt: r.last_activity_at,
  }));

  return {
    packageId,
    totalViews: perVendor.reduce((s, v) => s + v.viewCount, 0),
    distinctViewerCompanies: perVendor.length,
    totalDownloads: perVendor.reduce((s, v) => s + v.downloadCount, 0),
    perVendor,
  };
}
