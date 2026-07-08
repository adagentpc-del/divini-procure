/**
 * VendorBadges
 *
 * Trust + placement badges for a vendor card in the marketplace. Each badge
 * lights up only when the corresponding field is present on the vendor the card
 * already receives. When no flags are set, the component renders nothing, so it
 * is safe to drop into any vendor card or list row without changing layout.
 *
 *   verified     -> license + insurance + certifications confirmed
 *   verifiedPlus -> premium verification (bonding, financials, references,
 *                   background) for a higher-trust badge
 *   featured     -> advertising upgrade for top placement
 *
 * The props are intentionally loose so a card can spread whatever vendor object
 * it has. Accepts a few common field name spellings the backend may use.
 */

export type VendorBadgeFlags = {
  verified?: boolean | null;
  verifiedPlus?: boolean | null;
  verified_plus?: boolean | null;
  featured?: boolean | null;
  // tolerate a status string ("verified", "verified_plus") as well
  verification_status?: string | null;
};

function truthy(v: unknown): boolean {
  if (v === true) return true;
  if (typeof v === 'string') return /^(true|yes|1|verified|active|approved)$/i.test(v.trim());
  return false;
}

export default function VendorBadges(props: VendorBadgeFlags & { className?: string; style?: React.CSSProperties }) {
  const status = (props.verification_status || '').toLowerCase();
  const isVerifiedPlus =
    truthy(props.verifiedPlus) || truthy(props.verified_plus) || status === 'verified_plus' || status === 'verified+';
  const isVerified = truthy(props.verified) || status === 'verified' || status === 'approved' || isVerifiedPlus;
  const isFeatured = truthy(props.featured);

  if (!isVerified && !isVerifiedPlus && !isFeatured) return null;

  return (
    <span
      className={props.className}
      style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', ...props.style }}
    >
      {isVerified && !isVerifiedPlus && (
        <span className="badge b-green" title="License and insurance verified">
          ✓ Verified
        </span>
      )}
      {isVerifiedPlus && (
        <span
          className="badge"
          title="Premium verification: bonding, financials, references, background"
          style={{ background: 'var(--emerald)', color: '#fff' }}
        >
          ✓ Verified+
        </span>
      )}
      {isFeatured && (
        <span
          className="badge"
          title="Featured placement"
          style={{ background: 'var(--champagne)', color: 'var(--emerald-deep)' }}
        >
          ★ Featured
        </span>
      )}
    </span>
  );
}
