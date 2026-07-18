import { Link } from 'react-router-dom';

export default function Privacy() {
  return (
    <div style={{ maxWidth: 820, margin: '0 auto', padding: '48px 24px 80px', lineHeight: 1.7, color: '#1c2b25' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
        <img src="/brand/mark-emerald.png" alt="Divini Procure" style={{ width: 42, height: 42, objectFit: 'contain' }} />
        <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 28, fontWeight: 700, color: '#1f3d31' }}>Divini Procure</div>
      </div>

      <h1 style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 36, color: '#1f3d31', marginBottom: 6 }}>Privacy Policy</h1>
      <div style={{ color: '#6b7a72', marginBottom: 28 }}>Effective June 8, 2026 — Updated July 2026</div>

      <p>
        Divini Procure ("we," "us," "our") operates a procurement marketplace that connects real estate
        developers with construction vendors. This policy explains what we collect, how we use it,
        and the rights you have. By using the app or website you agree to this policy.
      </p>

      <h2 style={h2}>Information we collect</h2>
      <p>We collect only what we need to run the marketplace:</p>
      <ul>
        <li><strong>Account &amp; contact details</strong> – your email, name, phone, company name, role, and city.</li>
        <li><strong>Company &amp; marketplace data</strong> – projects, bid packages, bids, line items, messages, reviews, and subscription/plan status.</li>
        <li><strong>Uploaded content</strong> – documents and images you upload (e.g. drawings, credentials).</li>
        <li><strong>Consent records</strong> – when you agreed to our Terms of Service, the version you agreed to, and the IP address used at registration (Florida E-SIGN Act compliance).</li>
        <li><strong>Technical data</strong> – standard log and device information needed to operate and secure the service.</li>
      </ul>

      <h2 style={h2}>How we use it</h2>
      <ul>
        <li>To create and manage your account and company profile.</li>
        <li>To run core features: posting packages, submitting and comparing bids, messaging, and reviews.</li>
        <li>To process vendor subscriptions and related billing.</li>
        <li>To secure the service, prevent abuse, and meet legal obligations.</li>
        <li>To send transactional emails (verification, password reset, purchase confirmation). Marketing emails include an unsubscribe link.</li>
      </ul>

      <h2 style={h2}>Vendor data imported by developers</h2>
      <p>
        Developers (buyers) may import a list of existing vendor contacts via CSV upload. When a developer
        imports vendor contact data (such as company name, email address, and contact name), they attest
        at the time of import that they have an existing professional business relationship with each
        vendor and a legitimate basis for adding that vendor to the platform. Divini Procure uses this
        data solely to create a starter vendor profile and to facilitate the procurement relationship
        the developer has attested to. Newly created vendor profiles are private within that developer's
        account until the vendor claims and activates their profile. Vendors may contact us at{' '}
        <a href="mailto:privacy@diviniprocure.com" style={{ color: '#1f6f50' }}>privacy@diviniprocure.com</a>{' '}
        to request removal of an imported profile.
      </p>

      <h2 style={h2}>How it's stored and who processes it</h2>
      <p>
        Your data is stored with our infrastructure providers, who process it on our behalf:
        <strong> Supabase</strong> (database and file storage), <strong>Vercel</strong> (web hosting),
        and <strong>Stripe</strong> (subscription and platform payments — we do not store full card or bank details).
        We do not sell your personal information. We do not share it with third parties for their own marketing.
      </p>

      <h2 style={h2}>Visibility within the marketplace</h2>
      <p>
        Some information is shared with other users to make the marketplace work — for example, a vendor's
        company name and submitted bids are visible to the developer who posted the package, and posted
        packages are visible to matching vendors. Uploaded documents are shared only with the counterparties
        of the relevant package or bid.
      </p>

      <h2 style={h2}>Data retention &amp; deletion</h2>
      <p>
        You can permanently delete your account at any time from <strong>Profile → Delete account</strong> in the app.
        Deleting your account removes your login and, if your company has no other members, its associated
        data (projects, packages, bids, files). You may also email us to request deletion.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2 style={h2}>Your privacy rights (CCPA / U.S. state law)</h2>
      <p>
        Depending on your state of residence, you may have the following rights regarding your personal information:
      </p>
      <ul>
        <li>
          <strong>Right to know</strong> – You may request a copy of the categories and specific pieces of personal
          information we have collected about you, the sources, the business purposes, and the categories of third
          parties with whom it is shared.
        </li>
        <li>
          <strong>Right to delete</strong> – You may request that we delete personal information we have collected
          from you (subject to certain exceptions, such as records we are required to retain by law).
        </li>
        <li>
          <strong>Right to correct</strong> – You may request that we correct inaccurate personal information.
        </li>
        <li>
          <strong>Right to opt out of sale or sharing</strong> – We do not sell personal information and do not
          share it for cross-context behavioral advertising. You do not need to opt out.
        </li>
        <li>
          <strong>Right to non-discrimination</strong> – We will not discriminate against you for exercising any
          of these rights.
        </li>
      </ul>
      <p>
        To exercise any of these rights, please contact us at{' '}
        <a href="mailto:privacy@diviniprocure.com" style={{ color: '#1f6f50' }}>privacy@diviniprocure.com</a>{' '}
        or <a href="mailto:support@diviniprocure.com" style={{ color: '#1f6f50' }}>support@diviniprocure.com</a>.
        We will respond within 45 days. We may need to verify your identity before fulfilling certain requests.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2 style={h2}>Florida Data Breach Notification (s.&nbsp;501.171, Fla. Stat.)</h2>
      <p>
        Divini Procure complies with Florida's data breach notification law (Florida Statute § 501.171).
        In the event of a security breach affecting Florida residents' personal information, we will:
      </p>
      <ul>
        <li>Investigate and remediate the breach as quickly as reasonably practicable.</li>
        <li>
          Notify affected Florida residents within <strong>30 days</strong> of determining that a breach has occurred
          (or within 30 days of the breach being reported to us by a third-party agent), unless a law enforcement
          agency advises that notification would impede an investigation.
        </li>
        <li>Notify the Florida Department of Legal Affairs if the breach affects 500 or more Florida residents.</li>
        <li>Provide notice via the method required by the statute (direct notice by email, written notice, or substitute notice).</li>
      </ul>
      <p>
        To report a suspected security issue, please email{' '}
        <a href="mailto:security@diviniprocure.com" style={{ color: '#1f6f50' }}>security@diviniprocure.com</a>.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2 style={h2}>Security</h2>
      <p>
        We use industry-standard measures including encrypted connections (HTTPS/TLS), hashed passwords
        (scrypt), httpOnly session cookies, and access controls to protect your data. No method of
        transmission or storage is 100% secure, but we work continuously to protect your information
        and limit access to it.
      </p>

      <h2 style={h2}>Children</h2>
      <p>Divini Procure is a business tool and is not directed to anyone under 18.</p>

      <h2 style={h2}>Changes</h2>
      <p>We may update this policy from time to time. Material changes will be reflected by the effective date above.</p>

      <h2 style={h2}>Contact</h2>
      <p>
        Privacy requests: <a href="mailto:privacy@diviniprocure.com" style={{ color: '#1f6f50' }}>privacy@diviniprocure.com</a><br />
        General support: <a href="mailto:support@diviniprocure.com" style={{ color: '#1f6f50' }}>support@diviniprocure.com</a>
      </p>

      <div style={{ marginTop: 40 }}>
        <Link to="/" style={{ color: '#1f6f50' }}>← Back to Divini Procure</Link>
      </div>
    </div>
  );
}

const h2: React.CSSProperties = {
  fontFamily: "'Cormorant Garamond', serif",
  fontSize: 24,
  color: '#1f3d31',
  marginTop: 36,
  marginBottom: 8,
};
