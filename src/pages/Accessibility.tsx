import { Link } from 'react-router-dom';
const h2: React.CSSProperties = { fontFamily: "'Cormorant Garamond', serif", fontSize: 24, color: '#1f3d31', marginTop: 28, marginBottom: 8 };
export default function Accessibility() {
  return (
    <main id="main" style={{ maxWidth: 820, margin: '0 auto', padding: '48px 24px 80px', lineHeight: 1.7, color: '#1c2b25' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
        <img src="/brand/mark-emerald.png" alt="Divini Procure" style={{ width: 42, height: 42, objectFit: 'contain' }} />
        <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 28, fontWeight: 700, color: '#1f3d31' }}>Divini Procure</div>
      </div>
      <h1 style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 36, color: '#1f3d31', marginBottom: 6 }}>Accessibility Statement</h1>
      <div style={{ color: '#6b7a72', marginBottom: 28 }}>Effective July 1, 2026</div>

      <p>Divini Procure is committed to making our platform usable by everyone, including people with disabilities. We aim to conform to the Web Content Accessibility Guidelines (WCAG) 2.1 Level AA.</p>

      <h2 style={h2}>Measures we take</h2>
      <p>Semantic HTML landmarks, a skip-to-content link, visible keyboard focus indicators, reduced-motion support, labeled form fields, alternative text on meaningful images, and ongoing automated and manual testing.</p>

      <h2 style={h2}>Ongoing effort</h2>
      <p>Accessibility is an ongoing process. We continue to test with keyboard navigation and screen readers and to remediate issues as we find them.</p>

      <h2 style={h2}>Feedback and accommodations</h2>
      <p>If you encounter a barrier or need an accommodation, contact us at <a href="mailto:support@diviniprocure.com" style={{ color: '#1f6f50' }}>support@diviniprocure.com</a> and we will work to help and to fix the issue.</p>

      <p style={{ marginTop: 28 }}><Link to="/" style={{ color: '#1f6f50' }}>&larr; Back to Divini Procure</Link></p>
    </main>
  );
}
