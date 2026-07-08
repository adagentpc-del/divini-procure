/**
 * Developer + vendor view of grandfathered existing-relationship fee status.
 *
 * Role-aware: a developer (buyer) sees their vendor relationships and the fee
 * rule that applies to each pair; a vendor sees their developer relationships.
 * New relationships are attested in context (when awarding / inviting a vendor
 * on a package); this page is the management + visibility hub.
 */
import { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth';
import { apiGet } from '../lib/api';
import FeeBadge, { type FeeInfo } from '../components/FeeBadge';

type Row = {
  id: string;
  relationship_status: string;
  admin_review_status: string;
  existing_relationship_type: string | null;
  grandfathered_fee_percentage: number | string;
  vendor_name?: string;
  developer_name?: string;
  updated_at: string;
  fee: FeeInfo;
};

const STATUS_LABEL: Record<string, string> = {
  no_prior_relationship: 'No prior relationship',
  existing_relationship_claimed: 'Existing relationship claimed',
  existing_relationship_under_review: 'Under review',
  grandfathered_2_percent: 'Grandfathered 2%',
  standard_fee: 'Standard fee',
  disputed: 'Disputed',
  inactive: 'Inactive',
};

const REVIEW_LABEL: Record<string, string> = {
  not_required: 'Not required',
  pending_review: 'Pending admin confirmation',
  approved: 'Approved',
  rejected: 'Rejected',
  needs_more_info: 'Needs more info',
};

export default function Relationships() {
  const { company } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [err, setErr] = useState('');
  const isVendor = company?.kind === 'vendor';

  useEffect(() => {
    if (!company) return;
    const path = isVendor
      ? `/relationships/vendor?companyId=${company.id}`
      : `/relationships/mine?companyId=${company.id}`;
    apiGet<{ relationships: Row[] }>(path)
      .then((d) => setRows(d.relationships ?? []))
      .catch((e) => setErr(e.message ?? 'Could not load relationships.'));
  }, [company, isVendor]);

  if (!company) return <div className="note">Loading…</div>;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Vendor relationships</h1>
          <div className="sub">
            {isVendor
              ? 'Developers you work with through Divini Procure and the fee rule for each relationship.'
              : 'Vendors you work with and the fee rule for each relationship. Mark an existing relationship when you award or invite a vendor to protect a pre-existing relationship at the grandfathered 2% fee.'}
          </div>
        </div>
      </div>

      {err && <div className="err">{err}</div>}

      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr>
              <th>{isVendor ? 'Developer' : 'Vendor'}</th>
              <th>Relationship</th>
              <th>Review</th>
              <th>Fee rule</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={4} className="note" style={{ padding: 14 }}>No relationships yet.</td></tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id}>
                  <td><strong>{isVendor ? r.developer_name : r.vendor_name}</strong></td>
                  <td><span className="badge b-neutral">{STATUS_LABEL[r.relationship_status] ?? r.relationship_status}</span></td>
                  <td className="note">{REVIEW_LABEL[r.admin_review_status] ?? r.admin_review_status}</td>
                  <td><FeeBadge fee={r.fee} relationship={r} audience={isVendor ? 'vendor' : 'developer'} /></td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="note" style={{ marginTop: 12 }}>
        The grandfathered 2% payment authorization fee applies only to a specific developer-vendor relationship that
        existed before Divini Procure, and only after admin confirmation. It does not apply to new platform-sourced
        relationships.
      </div>
    </>
  );
}
