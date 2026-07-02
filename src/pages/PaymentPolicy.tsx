import { Link } from 'react-router-dom';

export default function PaymentPolicy() {
  return (
    <div style={wrap}>
      <Brand />
      <h1 style={h1}>Payment Policy</h1>
      <div style={eff}>Effective June 24, 2026</div>

      <p>
        This Payment Policy is part of the Divini Procure{' '}
        <Link to="/terms" style={a}>Terms of Service</Link> and explains how payments work on the
        Platform. Divini Procure is a lead-generation and networking technology platform. It is not a
        bank, escrow agent, money transmitter, or party to any transaction between users.
      </p>

      <h2 style={h2}>Third-party processing</h2>
      <p>
        Payments are processed by independent third-party payment processors (for example, Stripe
        and PayPal). Your payments are subject to those processors' terms and privacy policies.
        Divini Procure does not take custody of transaction funds as principal and does not control
        settlement, holds, or payout timing imposed by a processor or financial institution.
      </p>

      <h2 style={h2}>Platform fee</h2>
      <p>
        A flat platform fee is added at checkout, on top of the vendor's price. The vendor receives
        their full quoted amount; the buyer sees the fee clearly before paying. The platform fee is a
        technology and facilitation fee for use of the Platform and is non-refundable except where
        required by law.
      </p>

      <h2 style={h2}>Refunds, retainage, cancellations, and chargebacks</h2>
      <p>
        Refunds, retainage, cancellations, change orders, and related payment terms are governed by
        the agreement between the transacting users and by the applicable processor's policies.
        Divini Procure does not issue refunds for services it does not provide and is not responsible
        for chargebacks, reversals, disputed charges, liens, or non-payment between users.
      </p>

      <h2 style={h2}>Taxes</h2>
      <p>
        Each user is solely responsible for determining, collecting, reporting, and remitting any
        taxes applicable to their own transactions.
      </p>

      <h2 style={h2}>On-platform payment requirement</h2>
      <p>
        Transactions sourced or coordinated through the Platform are expected to be paid through the
        Platform so the applicable fee applies. See the{' '}
        <Link to="/non-circumvention" style={a}>Non-Circumvention Policy</Link>.
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
