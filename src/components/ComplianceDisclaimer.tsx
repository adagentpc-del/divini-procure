/**
 * Required compliance disclaimers for the Developer Investment + Investor
 * Matching surfaces. Divini Procure is a matching/relationship platform, NOT a
 * broker-dealer, investment adviser, or issuer. These disclaimers must appear on
 * every investment-related page (developer profile/programs, investor onboarding/
 * dashboard). CTAs across these surfaces NEVER say "invest now" - they say
 * "Request access", "Request information", or "Request introduction".
 */

const POINTS: string[] = [
  'Divini Procure does not provide investment, legal, tax, or financial advice.',
  'All opportunities are offered by third-party sponsors / developers. Divini Procure is not the issuer, broker-dealer, or investment adviser for any opportunity.',
  'Eligibility, accreditation, and suitability must be independently verified. Nothing here confirms that you are qualified to participate in any opportunity.',
  'Not all opportunities are available to all investors.',
  'Non-accredited investors may be limited to educational content and publicly available information.',
  'All offering materials are prepared, reviewed, and approved by the sponsor and their legal counsel. Divini Procure does not endorse or guarantee any opportunity.',
];

export default function ComplianceDisclaimer({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className="card"
      style={{ background: 'var(--ivory)', borderStyle: 'dashed', marginTop: 16 }}
    >
      <div className="note" style={{ fontWeight: 700, marginBottom: 8, color: 'var(--emerald-deep)' }}>
        Important disclosures
      </div>
      {compact ? (
        <div className="note">{POINTS[0]}</div>
      ) : (
        <ul className="note" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
          {POINTS.map((p, i) => (
            <li key={i}>{p}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
