import { Link } from 'react-router-dom';

export default function NonCircumvention() {
  return (
    <div style={wrap}>
      <Brand />
      <h1 style={h1}>Non-Circumvention Policy</h1>
      <div style={eff}>Effective June 24, 2026</div>

      <p>
        This Non-Circumvention Policy is part of the Divini Procure{' '}
        <Link to="/terms" style={a}>Terms of Service</Link>. Divini Procure invests in connecting
        developers, contractors, vendors, and suppliers. This policy protects that value while
        keeping the marketplace fair.
      </p>

      <h2 style={h2}>What circumvention means</h2>
      <p>
        Circumvention is intentionally moving a relationship or transaction that originated or was
        coordinated through the Platform off-platform in order to avoid the applicable platform fee,
        including arranging to pay outside the Platform for an opportunity, bid, or introduction
        first made through Divini Procure.
      </p>

      <h2 style={h2}>Your commitment</h2>
      <ul>
        <li>Pay for Platform-sourced engagements through the Platform so the applicable fee applies.</li>
        <li>Do not solicit or accept off-platform payment to avoid fees for opportunities sourced here.</li>
        <li>Use the Platform's tools for quotes, bids, invoices, and payments on Platform-sourced work.</li>
      </ul>

      <h2 style={h2}>Existing relationships</h2>
      <p>
        Where a developer and a vendor have a pre-existing relationship independent of Divini
        Procure, that relationship may qualify for the grandfathered-fee treatment described at
        award time. This policy applies to relationships and opportunities sourced or coordinated
        through the Platform; it is not a non-compete.
      </p>

      <h2 style={h2}>Detection and consequences</h2>
      <p>
        We may flag suspected circumvention and, at our discretion, request information, apply the
        fee that would have been owed, suspend, or terminate accounts.
      </p>

      <h2 style={h2}>Contact</h2>
      <p>
        Questions: <a href="mailto:support@diviniprocure.com" style={a}>support@diviniprocure.com</a>.
      </p>

      <Back />
    </div>
  );
}

const wrap: React.CSSProperties = { maxWidth: 820, margin: '0 auto', padding: '48px 24px 80px', lineHeight: 1.7, color: '#1c2b25' };
const h1: React.CSSProperties = { fontFamily: "'Cormorant Garamond', serif", fontSize: 36, color: '#1f3d31', marginBottom: 6 };
const eff: React.CSSProperties = { color: '#6b7a72', marginBottom: 28 };
const a: React.CSSProperties = { color: '#1f6f50' };
const h2: React.CSSProperties = { fontFamily: "'Cormorant Garamond', serif", fontSize: 24, color: '#1f3d31', marginTop: 30, marginBottom: 8 };
function Brand() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
      <img src="/brand/mark-emerald.png" alt="Divini Procure" style={{ width: 42, height: 42, objectFit: 'contain' }} />
      <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 28, fontWeight: 700, color: '#1f3d31' }}>Divini Procure</div>
    </div>
  );
}
function Back() {
  return (
    <div style={{ marginTop: 40 }}>
      <Link to="/" style={a}>← Back to Divini Procure</Link>
    </div>
  );
}
