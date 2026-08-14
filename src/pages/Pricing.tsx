import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import VendorBadges from '../components/VendorBadges';
import { apiGet } from '../lib/api';
import { type Tier, type CompanyKind, audienceForKind, basePlansFor, limitText, money } from '../lib/tiers';

/**
 * Public pricing page for Divini Procure.
 *
 * Pulls the real tier catalogue from GET /public/subscription-tiers (no
 * auth required - pricing is not sensitive data) instead of a hand-
 * maintained copy, so this page can never drift out of sync with what an
 * admin actually configures in AdminSubscriptions. Audience tabs let a
 * developer, vendor, or capital partner see their own relevant plan ladder
 * rather than a generic mixed list.
 *
 * Picking a specific plan stashes the role + tier choice to localStorage
 * (the same procure_onboard_role convention Onboarding.tsx already reads)
 * before sending the visitor to /register - registration requires email
 * verification, which can happen minutes or days later, so a query param
 * alone would not survive that gap.
 */

const AUDIENCE_TABS: { kind: CompanyKind; label: string }[] = [
  { kind: 'buyer', label: 'Developers' },
  { kind: 'vendor', label: 'Vendors' },
  { kind: 'investor', label: 'Capital Partners' },
];

const FEATURE_ROWS: Record<CompanyKind, (t: Tier) => string[]> = {
  buyer: (t) => [
    `${limitText(t.active_project_limit)} active projects`,
    `${limitText(t.bid_package_limit)} bid packages`,
    `${limitText(t.vendor_invite_limit)} vendor invitations`,
    `${limitText(t.investment_program_limit)} capital programs`,
    `${limitText(t.seat_limit)} team seats`,
  ],
  vendor: (t) => [
    `${limitText(t.bid_package_limit)} active bid packages`,
    `${limitText(t.vendor_invite_limit)} matched invitations`,
    `${limitText(t.seat_limit)} team seats`,
  ],
  investor: (t) => [
    `${limitText(t.investor_match_limit)} capital partner matches`,
    `${limitText(t.investment_program_limit)} programs`,
    `${limitText(t.seat_limit)} team seats`,
  ],
};

const FAQ: { q: string; a: string }[] = [
  {
    q: 'Can I change plans later?',
    a: 'Yes, anytime from Subscription in your dashboard. Upgrades apply immediately; downgrades take effect at the end of your current billing period, and you keep full access until then.',
  },
  {
    q: 'What happens if I go over my plan’s limit?',
    a: 'You will see it clearly in your dashboard before it happens. We never silently cut off in-progress work - you’ll be prompted to upgrade to continue, and nothing you’ve already created is ever deleted or hidden.',
  },
  {
    q: 'Is there a contract or lock-in?',
    a: 'No. Paid plans are month-to-month and can be cancelled at any time. There are no cancellation fees.',
  },
  {
    q: 'How does the plan price relate to the success fee?',
    a: 'They’re separate. Your subscription is what you pay for platform access and higher limits. The success fee (5% for vendors, capped at $25,000, or 2% capped at $10,000 for an existing relationship, plus a 0.1% infrastructure fee capped at $1,500) only applies to the winning vendor when work is actually awarded through the platform - regardless of subscription tier.',
  },
  {
    q: 'Do I need a paid plan to get started?',
    a: 'No. Every role can join, build a profile, and use the core marketplace for free. Paid plans raise your limits and unlock features like AI-assisted tools, reporting, and white-glove support once you’re ready to scale.',
  },
];

function stashPlanChoice(kind: CompanyKind, tierKey: string) {
  try {
    localStorage.setItem('procure_onboard_role', kind);
    localStorage.setItem('procure_onboard_tier', tierKey);
  } catch { /* localStorage unavailable (private browsing) - the query param on /onboarding still works as a fallback for same-session signups */ }
}

export default function Pricing() {
  const nav = useNavigate();
  const [tiers, setTiers] = useState<Tier[]>([]);
  const [activeKind, setActiveKind] = useState<CompanyKind>('buyer');

  useEffect(() => {
    apiGet<{ tiers: Tier[] }>('/public/subscription-tiers').then((d) => setTiers(d.tiers ?? [])).catch(() => {});
  }, []);

  const plans = basePlansFor(tiers, audienceForKind(activeKind));

  function choosePlan(tierKey: string) {
    stashPlanChoice(activeKind, tierKey);
    nav(`/register?role=${activeKind}&tier=${tierKey}`);
  }

  return (
    <div className="pp">
      <style>{`
        .pp{background:var(--bg);color:var(--ink);min-height:100vh}
        .pp .wrap{max-width:1080px;margin:0 auto;padding:0 22px}
        .pp header{position:sticky;top:0;z-index:30;background:rgba(243,239,230,.9);backdrop-filter:blur(8px);border-bottom:1px solid var(--line)}
        .pp .bar{display:flex;align-items:center;justify-content:space-between;height:64px}
        .pp .logo{display:flex;align-items:center;gap:10px;cursor:pointer}
        .pp .logo .mkimg{height:42px;width:auto;display:block}
        .pp .logo .nm{font-family:'Cormorant Garamond',serif;font-size:20px;font-weight:700;color:var(--emerald-deep);line-height:1}
        .pp .logo .tg{font-size:10px;letter-spacing:.6px;text-transform:uppercase;color:var(--muted)}
        .pp .navlinks{display:flex;align-items:center;gap:24px}
        .pp .navlinks a{font-size:14px;font-weight:500;color:var(--ink);cursor:pointer}
        .pp .navlinks a:hover{color:var(--emerald)}

        .pp .hero{text-align:center;padding:64px 0 30px}
        .pp .hero .eyebrow{display:inline-block;font-size:11px;letter-spacing:1.1px;text-transform:uppercase;font-weight:700;color:var(--emerald);background:#e7f3ec;padding:6px 13px;border-radius:30px;margin-bottom:18px}
        .pp .hero h1{font-size:48px;line-height:1.05;letter-spacing:-.4px;max-width:760px;margin:0 auto;color:var(--emerald-deep)}
        .pp .hero p{font-size:18px;line-height:1.6;color:var(--muted);max-width:600px;margin:18px auto 0}

        .pp .tabs{display:flex;justify-content:center;gap:8px;margin:28px 0 6px}
        .pp .tabs button{padding:9px 18px;border-radius:30px;border:1px solid var(--line);background:#fff;font-size:13.5px;font-weight:600;color:var(--muted);cursor:pointer}
        .pp .tabs button.on{background:var(--emerald-deep);border-color:var(--emerald-deep);color:#fff}

        .pp .plans{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:18px;padding:14px 0 10px}
        .pp .plan{background:#fff;border:1px solid var(--line);border-radius:18px;padding:26px 22px;display:flex;flex-direction:column;position:relative}
        .pp .plan.hl{border-color:var(--emerald);box-shadow:0 24px 50px -28px rgba(18,60,46,.5)}
        .pp .plan .tag{position:absolute;top:-11px;left:50%;transform:translateX(-50%);font-size:10.5px;letter-spacing:.5px;text-transform:uppercase;font-weight:700;color:var(--emerald-deep);background:var(--champagne);padding:4px 11px;border-radius:20px}
        .pp .plan h3{font-size:22px;color:var(--emerald-deep)}
        .pp .plan .who{font-size:12.5px;color:var(--muted);margin:4px 0 14px;min-height:20px}
        .pp .plan .price{font-family:'Cormorant Garamond',serif;font-size:40px;font-weight:700;color:var(--emerald);line-height:1}
        .pp .plan .price .cad{font-family:Inter;font-size:14px;font-weight:600;color:var(--muted)}
        .pp .plan ul{list-style:none;padding:0;margin:18px 0 22px;flex:1}
        .pp .plan li{font-size:13.5px;line-height:1.5;color:var(--ink);padding:7px 0 7px 24px;position:relative;border-top:1px solid var(--line)}
        .pp .plan li:first-child{border-top:none}
        .pp .plan li:before{content:"✓";position:absolute;left:0;top:7px;color:var(--emerald);font-weight:700}
        .pp .plan .btn{width:100%}

        .pp section{padding:54px 0}
        .pp .kicker{font-size:12px;letter-spacing:.8px;text-transform:uppercase;color:var(--emerald);font-weight:700;text-align:center;margin-bottom:10px}
        .pp h2{font-size:34px;text-align:center;margin-bottom:10px;letter-spacing:-.3px}
        .pp .sectsub{text-align:center;color:var(--muted);font-size:16px;max-width:620px;margin:0 auto 34px;line-height:1.6}

        .pp .fee{background:var(--emerald-deep);border-radius:22px;padding:46px 30px;color:#fff;text-align:center;position:relative;overflow:hidden}
        .pp .fee:before{content:"";position:absolute;inset:0;background:radial-gradient(80% 120% at 50% 0%,rgba(217,204,176,.16),transparent)}
        .pp .fee h2{color:#fff;position:relative}
        .pp .fee .big{font-family:'Cormorant Garamond',serif;font-size:34px;color:var(--champagne);margin:6px 0 4px;position:relative}
        .pp .fee .sub{color:rgba(255,255,255,.82);max-width:600px;margin:0 auto 28px;font-size:16px;line-height:1.6;position:relative}
        .pp .feerow{display:grid;grid-template-columns:1fr 1fr;gap:18px;max-width:720px;margin:0 auto;position:relative}
        .pp .feecard{background:rgba(255,255,255,.06);border:1px solid rgba(217,204,176,.3);border-radius:16px;padding:24px 22px;text-align:left}
        .pp .feecard .lbl{font-size:11px;letter-spacing:.5px;text-transform:uppercase;font-weight:700;color:var(--champagne);margin-bottom:8px}
        .pp .feecard .amt{font-family:'Cormorant Garamond',serif;font-size:28px;color:#fff;line-height:1.15;margin-bottom:6px}
        .pp .feecard p{font-size:13.5px;color:rgba(255,255,255,.8);line-height:1.5;margin:0}
        .pp .feenote{text-align:center;font-size:13.5px;color:rgba(255,255,255,.78);margin-top:24px;position:relative}

        .pp .trust{display:grid;grid-template-columns:1.1fr .9fr;gap:30px;align-items:center}
        .pp .trustcol h2{text-align:left}
        .pp .trustcol .sectsub{text-align:left;margin:0 0 18px}
        .pp .tlist{list-style:none;padding:0;margin:0}
        .pp .tlist li{font-size:14.5px;line-height:1.5;color:var(--ink);padding:11px 0 11px 28px;position:relative;border-top:1px solid var(--line)}
        .pp .tlist li:before{content:"✓";position:absolute;left:0;top:11px;color:var(--emerald);font-weight:700;font-size:15px}
        .pp .vcard{background:#fff;border:1px solid var(--line);border-radius:18px;padding:22px;box-shadow:0 24px 50px -30px rgba(18,60,46,.4)}
        .pp .vcard .vtop{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:6px}
        .pp .vcard .vname{font-weight:700;font-size:16px;color:var(--emerald-deep)}
        .pp .vcard .vmeta{font-size:12.5px;color:var(--muted)}
        .pp .vcard .vbadges{margin:12px 0 6px}
        .pp .vcard .vline{height:9px;border-radius:5px;background:#ece6d9;margin:9px 0}
        .pp .vcard .vline.s{width:55%}.pp .vcard .vline.m{width:80%}

        .pp .faq{max-width:760px;margin:0 auto}
        .pp .faqitem{border-top:1px solid var(--line);padding:18px 0}
        .pp .faqitem:last-child{border-bottom:1px solid var(--line)}
        .pp .faqitem .q{font-weight:700;font-size:15.5px;color:var(--emerald-deep);margin-bottom:6px}
        .pp .faqitem .a{font-size:14px;line-height:1.6;color:var(--muted)}

        .pp .closer{background:var(--emerald-deep);border-radius:22px;padding:52px 28px;text-align:center;color:#fff}
        .pp .closer h2{color:#fff;font-size:34px;margin-bottom:12px}
        .pp .closer p{color:rgba(255,255,255,.82);font-size:16px;max-width:520px;margin:0 auto 24px}
        .pp .btn.gold{background:var(--champagne);border-color:var(--champagne);color:var(--emerald-deep)}
        .pp .btn.gold:hover{filter:brightness(1.05);background:var(--champagne)}
        .pp .btn.ghost{background:transparent;border-color:rgba(255,255,255,.5);color:#fff}
        .pp .btn.ghost:hover{background:rgba(255,255,255,.1);border-color:#fff}
        .pp .cta{display:flex;gap:12px;justify-content:center;flex-wrap:wrap}
        .pp footer{border-top:1px solid var(--line);margin-top:10px;padding:30px 0;text-align:center;color:var(--muted);font-size:13px}
        .pp footer a{color:var(--emerald);cursor:pointer}

        @media(max-width:900px){.pp .trust{grid-template-columns:1fr}}
        @media(max-width:560px){.pp .feerow{grid-template-columns:1fr}.pp .hero h1{font-size:34px}.pp .navlinks .hide{display:none}}
      `}</style>

      <header>
        <div className="wrap bar">
          <Link to="/" className="logo">
            <img className="mkimg" src="/brand/mark-emerald.png" alt="Divini Procure" />
            <div>
              <div className="nm">Divini Procure</div>
              <div className="tg">Procurement Marketplace</div>
            </div>
          </Link>
          <div className="navlinks">
            <Link className="hide" to="/">Home</Link>
            <Link to="/login">Log in</Link>
            <button className="btn primary" onClick={() => nav('/register')}>Get started</button>
          </div>
        </div>
      </header>

      {/* ---------------- HERO ---------------- */}
      <section className="hero">
        <div className="wrap">
          <span className="eyebrow">Simple, honest pricing</span>
          <h1>Free to join. Upgrade only when you need more.</h1>
          <p>
            Every role starts free with real limits, not a locked demo. Compare plans below for
            developers, vendors, and capital partners, and see exactly what each tier unlocks
            before you pick one.
          </p>
        </div>
      </section>

      {/* ---------------- AUDIENCE TABS + PLAN CARDS ---------------- */}
      <section style={{ paddingTop: 0 }}>
        <div className="wrap">
          <div className="tabs">
            {AUDIENCE_TABS.map((t) => (
              <button key={t.kind} className={activeKind === t.kind ? 'on' : ''} onClick={() => setActiveKind(t.kind)}>
                {t.label}
              </button>
            ))}
          </div>

          <div className="plans">
            {plans.length === 0 ? (
              <div className="note" style={{ textAlign: 'center', padding: '30px 0' }}>Loading plans...</div>
            ) : (
              plans.map((t, i) => {
                const isMostCapable = i === plans.length - 1 && t.price_cents !== 0;
                const rows = FEATURE_ROWS[activeKind](t);
                return (
                  <div className={`plan${isMostCapable ? ' hl' : ''}`} key={t.key}>
                    {isMostCapable && <span className="tag">Most capable</span>}
                    <h3>{t.name}</h3>
                    <div className="who">
                      {t.price_cents === 0 ? 'Everything you need to start' : t.ai_features ? 'AI-assisted tools included' : 'For teams scaling up'}
                    </div>
                    <div className="price">
                      {money(t.price_cents).replace('/mo', '')}
                      {!!t.price_cents && <span className="cad">/mo</span>}
                    </div>
                    <ul>
                      {rows.map((f) => <li key={f}>{f}</li>)}
                      {t.ai_features && <li>AI-assisted drafting and analysis</li>}
                      {t.reporting_access && <li>Advanced reporting</li>}
                      {t.white_glove && <li>White-glove support</li>}
                    </ul>
                    <button className={`btn ${isMostCapable ? 'primary' : ''}`} onClick={() => choosePlan(t.key)}>
                      {t.price_cents === 0 ? 'Start free' : t.price_cents === null ? 'Contact us' : `Choose ${t.name}`}
                    </button>
                  </div>
                );
              })
            )}
          </div>
          <div style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 13.5, marginTop: 18 }}>
            {activeKind === 'vendor' && (
              <>Want the highest level of trust? <strong>Divini Verified+</strong> and <strong>Featured Vendor</strong> add
                bonding, financials, references, background checks, and top placement - available as add-ons after you join.</>
            )}
          </div>
        </div>
      </section>

      {/* ---------------- HOW THE FEE WORKS ---------------- */}
      <section>
        <div className="wrap">
          <div className="fee">
            <div className="kicker" style={{ color: 'var(--champagne)' }}>How the vendor success fee works</div>
            <h2>Separate from your subscription - you only pay it when you win</h2>
            <div className="big">5% platform fee</div>
            <p className="sub">
              When a vendor wins a project, Divini bills a 5% platform fee on the awarded contract,
              capped at $25,000, plus a separate 0.1% platform infrastructure fee capped at $1,500. Both
              are paid by the winning vendor and shown as their own line items, regardless of subscription
              tier. There are no fees to browse, bid, or post.
            </p>
            <div className="feerow">
              <div className="feecard">
                <div className="lbl">Standard</div>
                <div className="amt">5% · capped at $25,000</div>
                <p>Billed to the winning vendor on the awarded contract value.</p>
              </div>
              <div className="feecard">
                <div className="lbl">Existing relationships</div>
                <div className="amt">2% · capped at $10,000</div>
                <p>A reduced rate when you already have a working relationship with the developer.</p>
              </div>
              <div className="feecard">
                <div className="lbl">Platform infrastructure fee</div>
                <div className="amt">0.1% · capped at $1,500</div>
                <p>A separate infrastructure fee shown on its own line, on every awarded contract.</p>
              </div>
            </div>
            <div className="feenote">Payment processing costs (e.g. Stripe) are passed through separately and shown as their own line item. Prices on this page are in USD.</div>
          </div>
        </div>
      </section>

      {/* ---------------- TRUST & VERIFICATION ---------------- */}
      <section>
        <div className="wrap">
          <div className="trust">
            <div className="trustcol">
              <div className="kicker" style={{ textAlign: 'left' }}>Trust and verification</div>
              <h2>Every vendor is verified before they reach a developer</h2>
              <p className="sectsub">
                Our team reviews license and insurance documents before any vendor can submit a bid,
                so developers only see qualified makers and trades. Verification is a document review
                by our team, not an independent government-registry check or a guarantee - always
                confirm current licensing and insurance directly with a vendor before you award work.
              </p>
              <ul className="tlist">
                <li>License documents reviewed by our team</li>
                <li>Insurance confirmed and tracked for expiry</li>
                <li>Certifications reviewed for the work being bid</li>
                <li><strong>Verified+</strong> adds bonding, financials, references, and background checks</li>
                <li>Featured vendors earn top placement once verified</li>
              </ul>
            </div>
            <div className="vcard" aria-hidden="true">
              <div className="vtop">
                <div>
                  <div className="vname">Atelier Stoneworks</div>
                  <div className="vmeta">Marble and natural stone · Miami, FL</div>
                </div>
              </div>
              <div className="vbadges">
                <VendorBadges verified featured />
              </div>
              <div className="vline m" />
              <div className="vline" />
              <div className="vline s" />
            </div>
          </div>
        </div>
      </section>

      {/* ---------------- FAQ ---------------- */}
      <section>
        <div className="wrap">
          <div className="kicker">Questions</div>
          <h2>Before you choose a plan</h2>
          <div className="faq" style={{ marginTop: 30 }}>
            {FAQ.map((f) => (
              <div className="faqitem" key={f.q}>
                <div className="q">{f.q}</div>
                <div className="a">{f.a}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------------- CLOSER ---------------- */}
      <section>
        <div className="wrap">
          <div className="closer">
            <h2>Verified vendors. Competitive bids. Protected developers.</h2>
            <p>Post a project or build your vendor profile in minutes. It is free to start.</p>
            <div className="cta">
              <button className="btn gold lg" onClick={() => { stashPlanChoice('buyer', 'developer_free'); nav('/register?role=buyer'); }}>Start as a developer</button>
              <button className="btn ghost lg" onClick={() => { stashPlanChoice('vendor', 'vendor_free'); nav('/register?role=vendor'); }}>Join as a vendor</button>
            </div>
          </div>
        </div>
      </section>

      <footer>
        <div className="wrap">
          <div>Divini Procure. The verified construction procurement marketplace.</div>
          <div style={{ marginTop: 8 }}>
            <Link to="/">Home</Link> · <Link to="/terms">Terms</Link> · <Link to="/privacy">Privacy</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
