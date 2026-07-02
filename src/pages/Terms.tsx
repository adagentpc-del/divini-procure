import { Link } from 'react-router-dom';

export default function Terms() {
  return (
    <div style={{ maxWidth: 820, margin: '0 auto', padding: '48px 24px 80px', lineHeight: 1.7, color: '#1c2b25' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
        <img src="/brand/mark-emerald.png" alt="Divini Procure" style={{ width: 42, height: 42, objectFit: 'contain' }} />
        <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 28, fontWeight: 700, color: '#1f3d31' }}>Divini Procure</div>
      </div>

      <h1 style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 36, color: '#1f3d31', marginBottom: 6 }}>Terms of Service</h1>
      <div style={{ color: '#6b7a72', marginBottom: 28 }}>Effective June 24, 2026</div>

      <p>
        These Terms of Service (the "Terms") are a binding agreement between you and Divini Group
        ("Divini Procure," "we," "us," or "our") governing your access to and use of the Divini
        Procure websites, applications, and services (collectively, the "Platform"). By creating an
        account, accessing, or using the Platform, you agree to these Terms and to our{' '}
        <Link to="/privacy" style={{ color: '#1f6f50' }}>Privacy Policy</Link>. If you do not agree,
        do not use the Platform. If you use the Platform on behalf of an organization, you represent
        that you are authorized to bind that organization to these Terms.
      </p>

      <h2 style={h2}>1. What Divini Procure is, and what it is not</h2>
      <p>
        Divini Procure is a lead-generation, discovery, and networking technology platform that
        helps real estate developers, contractors, vendors, and suppliers find each other and
        coordinate procurement, bidding, and project work. Divini Procure provides software tools
        and a marketplace venue. We are <strong>not</strong> a party to, and are <strong>not</strong>{' '}
        responsible for, any agreement, bid, award, purchase order, quote, invoice, engagement, or
        transaction entered into between users.
      </p>
      <p>You acknowledge and agree that Divini Procure is not, and does not act as:</p>
      <ul>
        <li>a broker, agent, representative, employer, contractor, partner, joint venturer, or fiduciary of any user;</li>
        <li>a provider of the construction, supply, procurement, or related services listed or arranged through the Platform;</li>
        <li>an escrow agent, bank, money transmitter, trustee, collection agency, or insurer; or</li>
        <li>a guarantor or endorser of any user, listing, bid, price, credential, license, insurance, or outcome.</li>
      </ul>
      <p>
        We do not control and are not responsible for the conduct, performance, quality, safety,
        timeliness, legality, or completion of any service or supply, or for any user's honesty,
        identity, qualifications, licensing, insurance, bonding, or ability to pay or perform. Any
        decision to bid, award, engage, hire, pay, or work with another user is made solely at your
        own discretion and risk. You are responsible for your own verification and due diligence.
      </p>

      <h2 style={h2}>2. Payments are processed by third parties</h2>
      <p>
        Payments made through the Platform are processed by independent third-party payment
        processors. Your use of those services is governed by the
        applicable processor's own terms and privacy policies. Divini Procure does not take custody
        of, hold, or control transaction funds as principal, and does not provide banking, escrow,
        or money-transmission services.
      </p>
      <p>
        The platform fee shown at checkout is a technology and facilitation fee for use of the
        Platform. We are not responsible for, and disclaim all liability arising from, payment
        processor errors, delays, holds, reversals, chargebacks, fraud, account freezes, fund
        availability, or any act or omission of a payment processor or financial institution. You
        are solely responsible for all taxes applicable to your transactions. Refunds, cancellations,
        retainage, lien matters, and payment disputes are governed by the agreement between the
        transacting users and the applicable processor's policies, not by Divini Procure.
      </p>

      <h2 style={h2}>3. Disputes between users</h2>
      <p>
        Any dispute, claim, loss, damage, or disagreement arising between users, including but not
        limited to disputes over services, supply, quality, scope, change orders, delays, defects,
        cancellations, deposits, retainage, refunds, payments, property damage, personal injury, or
        breach of an agreement between users, is solely between those users. Divini Procure is not a
        party to such disputes and has no obligation to investigate, mediate, arbitrate, resolve,
        refund, or otherwise become involved. We may, at our sole discretion and without assuming any
        duty, provide optional tools or information to help users communicate, but doing so does not
        make us a party to or responsible for any user dealing.
      </p>
      <p>
        To the fullest extent permitted by law, you release Divini Procure, its affiliates, and
        their officers, directors, employees, and agents from any and all claims, demands, damages,
        losses, and liabilities of every kind, known or unknown, arising out of or in any way
        connected with your dealings, transactions, or disputes with any other user.
      </p>

      <h2 style={h2}>4. Your responsibilities</h2>
      <ul>
        <li>Provide accurate, current information and keep your account secure.</li>
        <li>Comply with all applicable laws, licensing, permitting, bonding, tax, and insurance requirements for your business and services.</li>
        <li>Honor your own agreements with other users; you are responsible for the terms, performance, and payment of any engagement you enter.</li>
        <li>Not use the Platform for anything unlawful, fraudulent, harassing, infringing, or harmful, and not circumvent the Platform to avoid applicable fees.</li>
      </ul>

      <h2 style={h2}>5. Disclaimer of warranties</h2>
      <p>
        The Platform is provided on an "AS IS" and "AS AVAILABLE" basis without warranties of any
        kind, whether express, implied, or statutory, including any implied warranties of
        merchantability, fitness for a particular purpose, title, and non-infringement. We do not
        warrant that the Platform will be uninterrupted, secure, or error free, or that any leads,
        introductions, bids, awards, revenue, or results will be obtained. Any reliance on the
        Platform or on other users is at your own risk.
      </p>

      <h2 style={h2}>6. Limitation of liability</h2>
      <p>
        To the fullest extent permitted by law, Divini Procure and its affiliates, and their
        officers, directors, employees, and agents, will not be liable for any indirect, incidental,
        special, consequential, exemplary, or punitive damages, or for any loss of profits, revenue,
        data, goodwill, or business, arising out of or relating to the Platform or these Terms,
        whether based in contract, tort, strict liability, or otherwise, even if advised of the
        possibility of such damages. In particular, we will have no liability for any loss, damage,
        or claim arising out of any transaction, payment, or dispute between users.
      </p>
      <p>
        Our total aggregate liability for all claims relating to the Platform will not exceed the
        greater of (a) the total platform fees you actually paid to Divini Procure in the twelve
        (12) months before the event giving rise to the claim, or (b) one hundred U.S. dollars
        ($100). Some jurisdictions do not allow certain limitations, so some of the above may not
        apply to you.
      </p>

      <h2 style={h2}>7. Indemnification</h2>
      <p>
        You agree to defend, indemnify, and hold harmless Divini Procure and its affiliates and
        their personnel from and against any claims, liabilities, damages, losses, and expenses
        (including reasonable legal fees) arising out of or related to your use of the Platform,
        your content, your services, your transactions or disputes with other users, your taxes, or
        your breach of these Terms or of any law or third-party right.
      </p>

      <h2 style={h2}>8. Accounts, eligibility, and termination</h2>
      <p>
        You must be at least 18 years old and able to form a binding contract to use the Platform.
        We may suspend or terminate your access at any time, with or without notice, for any reason,
        including suspected violation of these Terms. You may stop using the Platform and request
        account deletion at any time. Sections that by their nature should survive termination
        (including Sections 1 through 7, 9, and 10) will survive.
      </p>

      <h2 style={h2}>9. Your content</h2>
      <p>
        You retain ownership of the content you upload. You grant Divini Procure a limited,
        worldwide, non-exclusive license to host, store, display, and process your content solely to
        operate and provide the Platform. You are responsible for having the rights to the content
        you submit and for ensuring it does not violate any law or third-party right.
      </p>

      <h2 style={h2}>10. Governing law and dispute resolution</h2>
      <p>
        These Terms are governed by the laws of the State of Florida, without regard to its conflict
        of laws rules. Before filing any claim against Divini Procure, you agree to first contact us
        and attempt in good faith to resolve the matter informally. Any dispute between you and
        Divini Procure that is not resolved informally will be brought exclusively in the state or
        federal courts located in Florida, and you consent to their jurisdiction, except where
        binding arbitration applies. To the extent permitted by law, you and Divini Procure each
        waive any right to participate in a class, collective, or representative action against the
        other. Nothing in these Terms limits either party from seeking injunctive relief to protect
        its intellectual property.
      </p>

      <h2 style={h2}>11. Changes</h2>
      <p>
        We may update these Terms from time to time. Material changes will be reflected by the
        effective date above, and your continued use of the Platform after an update constitutes
        acceptance of the revised Terms.
      </p>

      <h2 style={h2}>12. Severability and entire agreement</h2>
      <p>
        If any provision of these Terms is found unenforceable, the remaining provisions remain in
        full force. These Terms, together with the Privacy Policy and any policies referenced at
        signup, are the entire agreement between you and Divini Procure regarding the Platform.
      </p>

      <h2 style={h2}>Contact</h2>
      <p>
        Questions about these Terms: <a href="mailto:support@diviniprocure.com" style={{ color: '#1f6f50' }}>support@diviniprocure.com</a>.
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
