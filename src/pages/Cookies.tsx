import { Link } from 'react-router-dom';

const h2: React.CSSProperties = { fontFamily: "'Cormorant Garamond', serif", fontSize: 24, color: '#1f3d31', marginTop: 28, marginBottom: 8 };

export default function Cookies() {
  return (
    <main id="main" style={{ maxWidth: 820, margin: '0 auto', padding: '48px 24px 80px', lineHeight: 1.7, color: '#1c2b25' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
        <img src="/brand/mark-emerald.png" alt="Divini Procure" style={{ width: 42, height: 42, objectFit: 'contain' }} />
        <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 28, fontWeight: 700, color: '#1f3d31' }}>Divini Procure</div>
      </div>

      <h1 style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 36, color: '#1f3d31', marginBottom: 6 }}>Cookie Policy</h1>
      <div style={{ color: '#6b7a72', marginBottom: 28 }}>Effective July 1, 2026</div>

      <p>
        This Cookie Policy explains how Divini Group ("Divini Procure," "we," "us") uses cookies and
        similar technologies on the Divini Procure websites and applications. It should be read
        together with our <Link to="/privacy" style={{ color: '#1f6f50' }}>Privacy Policy</Link>.
      </p>

      <h2 style={h2}>What these technologies are</h2>
      <p>
        Cookies and similar technologies (local storage, and a device signature derived from your
        browser, screen, and time zone) are small pieces of data stored by your browser that let the
        Platform function and remember your choices.
      </p>

      <h2 style={h2}>What we use</h2>
      <p>
        <strong>Strictly necessary</strong> — required to run the Platform: authentication and
        session, security, load balancing, and remembering your cookie choice. These are always on and
        cannot be switched off.
      </p>
      <p>
        <strong>Functional and analytics (consent-based)</strong> — limited device and usage signals
        (approximate location derived from your IP, and the pages you visit) used only to operate,
        secure, and improve the Platform at a coarse, largely aggregate level. These run only if you
        select "Accept all" in our cookie banner.
      </p>

      <h2 style={h2}>What we do not do</h2>
      <p>We do not use cookies to sell your personal information, serve third-party advertising, or profile you beyond improving the service.</p>

      <h2 style={h2}>Your choices</h2>
      <p>
        Use the cookie banner to accept or reject non-essential technologies. You can also block or
        delete cookies in your browser settings, though strictly necessary items may be needed for the
        Platform to work.
      </p>

      <h2 style={h2}>Contact</h2>
      <p>Questions about this policy: <a href="mailto:support@diviniprocure.com" style={{ color: '#1f6f50' }}>support@diviniprocure.com</a>.</p>

      <p style={{ marginTop: 28 }}><Link to="/" style={{ color: '#1f6f50' }}>&larr; Back to Divini Procure</Link></p>
    </main>
  );
}
