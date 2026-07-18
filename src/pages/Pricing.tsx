import { Link, useNavigate } from 'react-router-dom';
import VendorBadges from '../components/VendorBadges';

/**
 * Public pricing page for Divini Procure.
 *
 * The model is simple: developers and vendors join free, vendors can upgrade to
 * Vendor Pro for unlimited bidding and priority, and Divini only earns a small
 * success fee when a vendor actually wins. No old percentage-of-everything fee,
 * no generic subscription tiers.
 */

type Plan = {
  name: string;
  price: string;
  cadence?: string;
  who: string;
  features: string[];
  highlight?: boolean;
  badge?: string;
};

const PLANS: Plan[] = [
  {
    name: 'Developers',
    price: 'Free',
    who: 'Real estate developers and owners',
    features: [
      'Post projects and bid packages',
      'Receive bids from verified vendors',
      'Compare line-item bids side by side',
      'No fees to post or award',
    ],
  },
  {
    name: 'Vendors',
    price: 'Free',
    who: 'Suppliers, trades, and makers',
    features: [
      'Build a vendor profile',
      'Browse active projects',
      'Submit up to 5 bids per quarter',
      'Get verified (license, insurance, certifications) to start bidding',
    ],
  },
  {
    name: 'Vendor Pro',
    price: '$149',
    cadence: '/mo',
    who: 'Vendors who bid often',
    highlight: true,
    badge: 'Most popular',
    features: [
      'Unlimited bids',
      'Real-time project alerts',
      'Priority and expedited verification',
      'Verified badge on your profile',
      'Priority matching to new projects',
    ],
  },
  {
    name: 'Featured Vendor',
    price: '$49',
    cadence: '/mo',
    who: 'Vendors who want top placement',
    features: [
      'Top placement in search and matches',
      'Featured badge across the marketplace',
      'More visibility to active developers',
      'Add-on to Vendor Free or Vendor Pro',
    ],
  },
];

export default function Pricing() {
  const nav = useNavigate();
  const go = () => nav('/login');

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

        .pp .plans{display:grid;grid-template-columns:repeat(4,1fr);gap:18px;padding:14px 0 10px}
        .pp .plan{background:#fff;border:1px solid var(--line);border-radius:18px;padding:26px 22px;display:flex;flex-direction:column;position:relative}
        .pp .plan.hl{border-color:var(--emerald);box-shadow:0 24px 50px -28px rgba(18,60,46,.5)}
        .pp .plan .tag{position:absolute;top:-11px;left:50%;transform:translateX(-50%);font-size:10.5px;letter-spacing:.5px;text-transform:uppercase;font-weight:700;color:var(--emerald-deep);background:var(--champagne);padding:4px 11px;border-radius:20px}
        .pp .plan h3{font-size:22px;color:var(--emerald-deep)}
        .pp .plan .who{font-size:12.5px;color:var(--muted);margin:4px 0 14px;min-height:34px}
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

        @media(max-width:900px){.pp .plans{grid-template-columns:1fr 1fr}.pp .trust{grid-template-columns:1fr}}
        @media(max-width:560px){.pp .plans,.pp .feerow{grid-template-columns:1fr}.pp .hero h1{font-size:34px}.pp .navlinks .hide{display:none}}
      `}</style>

      <header>
        <div className="wrap bar">
          <div className="logo" onClick={() => nav('/')}>
            <img className="mkimg" src="/brand/mark-emerald.png" alt="Divini Procure" />
            <div>
              <div className="nm">Divini Procure</div>
              <div className="tg">Procurement Marketplace</div>
            </div>
          </div>
          <div className="navlinks">
            <a className="hide" onClick={() => nav('/')}>Home</a>
            <a onClick={go}>Log in</a>
            <button className="btn primary" onClick={go}>Get started</button>
          </div>
        </div>
      </header>

      {/* ---------------- HERO ---------------- */}
      <section className="hero">
        <div className="wrap">
          <span className="eyebrow">Simple, honest pricing</span>
          <h1>Free to join. You only pay when you win.</h1>
          <p>
            Developers post projects and receive bids at no cost. Vendors build a profile and start
            bidding for free. Divini only earns a small success fee when a vendor wins the work.
          </p>
        </div>
      </section>

      {/* ---------------- PLAN CARDS ---------------- */}
      <section style={{ paddingTop: 16 }}>
        <div className="wrap">
          <div className="plans">
            {PLANS.map((p) => (
              <div className={`plan${p.highlight ? ' hl' : ''}`} key={p.name}>
                {p.badge && <span className="tag">{p.badge}</span>}
                <h3>{p.name}</h3>
                <div className="who">{p.who}</div>
                <div className="price">
                  {p.price}
                  {p.cadence && <span className="cad">{p.cadence}</span>}
                </div>
                <ul>
                  {p.features.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
                <button className={`btn ${p.highlight ? 'primary' : ''}`} onClick={go}>
                  {p.name === 'Developers'
                    ? 'Post a project'
                    : p.name === 'Vendor Pro'
                      ? 'Upgrade to Pro'
                      : p.name === 'Featured Vendor'
                        ? 'Get featured'
                        : 'Create a profile'}
                </button>
              </div>
            ))}
          </div>
          <div style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 13.5, marginTop: 18 }}>
            Want the highest level of trust? <strong>Divini Verified+</strong> adds bonding, financials,
            references, and background checks for a premium verification badge.
          </div>
        </div>
      </section>

      {/* ---------------- HOW THE FEE WORKS ---------------- */}
      <section>
        <div className="wrap">
          <div className="fee">
            <div className="kicker" style={{ color: 'var(--champagne)' }}>How the fee works</div>
            <h2>You only pay when you win</h2>
            <div className="big">2% success fee</div>
            <p className="sub">
              When a vendor wins a project, Divini bills a 2% success fee on the awarded contract,
              capped at $2,500. It is paid by the winning vendor. There are no fees to browse, bid, or post.
            </p>
            <div className="feerow">
              <div className="feecard">
                <div className="lbl">Standard</div>
                <div className="amt">2% · capped at $2,500</div>
                <p>Billed to the winning vendor on the awarded contract value.</p>
              </div>
              <div className="feecard">
                <div className="lbl">Existing relationships</div>
                <div className="amt">1% · capped at $1,000</div>
                <p>A reduced rate when you already have a working relationship with the developer.</p>
              </div>
            </div>
            <div className="feenote">No fees to browse, bid, or post. The success fee only applies when work is awarded.</div>
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
                We confirm license and insurance before any vendor can submit a bid, so developers
                only see qualified makers and trades.
              </p>
              <ul className="tlist">
                <li>License verified against public records</li>
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

      {/* ---------------- CLOSER ---------------- */}
      <section>
        <div className="wrap">
          <div className="closer">
            <h2>Verified vendors. Competitive bids. Protected developers.</h2>
            <p>Post a project or build your vendor profile in minutes. It is free to start.</p>
            <div className="cta">
              <button className="btn gold lg" onClick={go}>Start as a developer</button>
              <button className="btn ghost lg" onClick={go}>Join as a vendor</button>
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
