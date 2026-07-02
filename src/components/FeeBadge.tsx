/**
 * Role-aware fee display for a developer-vendor relationship.
 *
 * Shows the grandfathered 2% rule or the standard fee, with copy tuned per role.
 * Investors are intentionally NOT shown internal fee logic (see audience prop).
 */

export type FeeInfo = {
  feePercentage: number;
  grandfathered: boolean;
  source: 'grandfathered_2_percent' | 'standard';
  appliesForever: boolean;
  label: string;
};

export type RelationshipLite = {
  relationship_status?: string | null;
  admin_review_status?: string | null;
} | null;

const PENDING_NOTE: Record<string, string> = {
  existing_relationship_claimed: 'Pending admin confirmation of the existing relationship.',
  existing_relationship_under_review: 'Under admin review.',
  disputed: 'This relationship is marked disputed.',
};

export default function FeeBadge({
  fee,
  relationship,
  audience = 'developer',
}: {
  fee: FeeInfo | null | undefined;
  relationship?: RelationshipLite;
  audience?: 'developer' | 'vendor' | 'admin' | 'investor';
}) {
  if (audience === 'investor') return null; // investors never see internal fee logic
  if (!fee) return null;

  const grandfathered = fee.grandfathered;
  const cls = grandfathered ? 'badge b-emerald' : 'badge b-neutral';

  let text: string;
  if (grandfathered) {
    if (audience === 'vendor') {
      text = `Grandfathered relationship - ${fee.feePercentage}% payment authorization fee applies for this developer.`;
    } else {
      text = `Grandfathered Existing Vendor Relationship - ${fee.feePercentage}% payment authorization fee${
        fee.appliesForever ? ' (forever)' : ''
      }.`;
    }
  } else if (audience === 'vendor') {
    text = 'Standard Divini Procure fee terms apply for new platform-sourced opportunities.';
  } else {
    text = 'Standard Divini Procure platform/referral fee applies.';
  }

  const status = relationship?.relationship_status ?? '';
  const pending = !grandfathered && status in PENDING_NOTE ? PENDING_NOTE[status] : '';

  return (
    <div style={{ display: 'inline-flex', flexDirection: 'column', gap: 4 }}>
      <span className={cls} style={{ whiteSpace: 'normal', lineHeight: 1.35 }}>{text}</span>
      {pending && <span className="note" style={{ fontSize: 12 }}>{pending}</span>}
    </div>
  );
}
