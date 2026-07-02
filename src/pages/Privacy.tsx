import { Link } from 'react-router-dom';

export default function Privacy() {
  return (
    <div style={{ maxWidth: 820, margin: '0 auto', padding: '48px 24px 80px', lineHeight: 1.7, color: '#1c2b25' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
        <img src="/brand/mark-emerald.png" alt="Divini Procure" style={{ width: 42, height: 42, objectFit: 'contain' }} />
        <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 28, fontWeight: 700, color: '#1f3d31' }}>Divini Procure</div>
      </div>

      <h1 style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 36, color: '#1f3d31', marginBottom: 6 }}>Privacy Policy</h1>
      <div style={{ color: '#6b7a72', marginBottom: 28 }}>Effective June 8, 2026</div>

      <p>
        Divini Procure (“we,” “us”) operates a procurement marketplace that connects real estate
        developers with construction vendors. This policy explains what we collect, how we use it,
        and the choices you have. By using the app or website you agree to this policy.
      </p>

      <h2 style={h2}>Information we collect</h2>
      <p>We collect only what we need to run the marketplace:</p>
      <ul>
        <li><strong>Account &amp; contact details</strong> - your email, name, phone, company name, role, and city.</li>
        <li><strong>Company &amp; marketplace data</strong> - projects, bid packages, bids, line items, messages, reviews, and subscription/plan status.</li>
        <li><strong>Uploaded content</strong> - documents and images you upload (e.g. drawings, credentials).</li>
        <li><strong>Technical data</strong> - basic, standard log and device information needed to operate and secure the service.</li>
      </ul>

      <h2 style={h2}>How we use it</h2>
      <ul>
        <li>To create and manage your account and company profile.</li>
        <li>To run core features: posting packages, submitting and comparing bids, messaging, and reviews.</li>
        <li>To process vendor subscriptions and related billing.</li>
        <li>To secure the service, prevent abuse, and meet legal obligations.</li>
      </ul>

      <h2 style={h2}>How it’s stored and who processes it</h2>
      <p>
        Your data is stored with our infrastructure providers, who process it on our behalf:
        <strong> Supabase</strong> (database, authentication, and file storage), <strong>Vercel</strong> (web hosting),
        and <strong>an independent third-party payment processor</strong> (subscription and platform payments - we do not store full card details). We do not sell your
        personal information, and we do not share it with third parties for their own marketing.
      </p>

      <h2 style={h2}>Visibility within the marketplace</h2>
      <p>
        Some information is shared with other users to make the marketplace work - for example, a vendor’s
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

      <h2 style={h2}>Security</h2>
      <p>
        We use industry-standard measures including encrypted connections and database row-level security to
        protect your data. No method of transmission or storage is 100% secure, but we work to protect your
        information and limit access to it.
      </p>

      <h2 style={h2}>Children</h2>
      <p>Divini Procure is a business tool and is not directed to anyone under 18.</p>

      <h2 style={h2}>Changes</h2>
      <p>We may update this policy from time to time. Material changes will be reflected by the effective date above.</p>

      <h2 style={h2}>Contact</h2>
      <p>
        Questions or deletion requests: <a href="mailto:support@diviniprocure.com" style={{ color: '#1f6f50' }}>support@diviniprocure.com</a>.
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
  marginTop: 30,
  marginBottom: 8,
};
