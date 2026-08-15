import { Link, useNavigate } from 'react-router-dom';

/**
 * Public developer platform page for Divini Procure (competitive gap #11,
 * docs/competitive-analysis-2026-08.md): "open app marketplace / public API
 * ecosystem... extensibility functions as a moat and reduces switching-cost
 * objections." API-01 (server/src/routes/api-keys.ts, docs/api-platform.md)
 * already built the actual platform - personal-access-token auth over the
 * app's existing REST API, real rate limits, a real key-management UI at
 * /api-keys. What was missing was a public, pre-signup page that a
 * prospect evaluating Divini could actually find: the key-management UI
 * lives behind login (Gate in App.tsx), and nothing on the marketing site
 * ever mentioned an API exists.
 *
 * Deliberately does NOT claim a third-party app marketplace, OAuth-on-
 * behalf-of-another-company, a listing/review process, or webhooks - none
 * of those exist yet (see docs/api-platform.md's own "What this is not"
 * section) and this page would be dishonest marketing copy if it implied
 * otherwise. It documents the real, working platform: how auth works,
 * what a key can and cannot do, and the same representative endpoint table
 * docs/api-platform.md already maintains, so a technical prospect can
 * assess the real extensibility story before creating an account.
 */

const ENDPOINTS: { method: string; path: string; desc: string }[] = [
  { method: 'GET', path: '/api/me', desc: 'Your account and company' },
  { method: 'GET', path: '/api/buildings?companyId=', desc: 'Your projects' },
  { method: 'GET', path: '/api/packages/:id', desc: 'A procurement package' },
  { method: 'GET', path: '/api/packages/:id/bids', desc: 'Bids on a package you own (or your own bid)' },
  { method: 'GET', path: '/api/reviews?vendorCompanyId=', desc: "A vendor's public review history" },
  { method: 'GET', path: '/api/payment-reputation/:developerCompanyId', desc: "A developer's public payment-timing record" },
  { method: 'GET', path: '/api/prequalification?vendorCompanyId=&buildingId=', desc: "A vendor's compliance snapshot" },
  { method: 'GET', path: '/api/invoices?...', desc: "Invoices you're a party to" },
  { method: 'GET', path: '/api/documents?packageId=', desc: "A package's documents, if you can view that package" },
];

const STEPS: { t: string; d: string }[] = [
  { t: 'Create an account', d: 'Free to join as a developer, vendor, or capital partner - no card required.' },
  { t: 'Generate a key', d: 'From Account -> API Keys, name it and choose read-only or read/write scope. The raw key is shown once.' },
  { t: 'Call the API', d: 'Send it as a standard bearer token on any request. It authenticates as you - same data, same permissions, nothing more.' },
];

export default function Developers() {
  const nav = useNavigate();

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

        .pp section{padding:54px 0}
        .pp .kicker{font-size:12px;letter-spacing:.8px;text-transform:uppercase;color:var(--emerald);font-weight:700;text-align:center;margin-bottom:10px}
        .pp h2{font-size:34px;text-align:center;margin-bottom:10px;letter-spacing:-.3px}
        .pp .sectsub{text-align:center;color:var(--muted);font-size:16px;max-width:620px;margin:0 auto 34px;line-height:1.6}

        .pp .steps{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:18px;margin-top:10px}
        .pp .step{background:#fff;border:1px solid var(--line);border-radius:18px;padding:24px 22px}
        .pp .step .n{font-family:'Cormorant Garamond',serif;font-size:28px;font-weight:700;color:var(--emerald);line-height:1;margin-bottom:8px}
        .pp .step h3{font-size:16px;color:var(--emerald-deep);margin-bottom:6px}
        .pp .step p{font-size:13.5px;line-height:1.6;color:var(--muted)}

        .pp .code{background:var(--emerald-deep);border-radius:16px;padding:22px 24px;color:#eee6d9;font-family:'SF Mono',Menlo,Consolas,monospace;font-size:13px;line-height:1.7;overflow-x:auto;white-space:pre}

        .pp table.endpoints{width:100%;border-collapse:collapse;background:#fff;border:1px solid var(--line);border-radius:14px;overflow:hidden}
        .pp table.endpoints th{text-align:left;font-size:11px;letter-spacing:.5px;text-transform:uppercase;color:var(--muted);padding:12px 16px;border-bottom:1px solid var(--line)}
        .pp table.endpoints td{padding:12px 16px;font-size:13.5px;border-top:1px solid var(--line);vertical-align:top}
        .pp table.endpoints .method{display:inline-block;font-size:10.5px;font-weight:700;letter-spacing:.4px;color:var(--emerald-deep);background:#e7f3ec;padding:2px 8px;border-radius:20px}
        .pp table.endpoints .path{font-family:'SF Mono',Menlo,Consolas,monospace;font-size:12.5px}
        .pp .tablewrap{overflow-x:auto}

        .pp .tlist{list-style:none;padding:0;margin:0;max-width:640px;margin:0 auto}
        .pp .tlist li{font-size:14.5px;line-height:1.5;color:var(--ink);padding:11px 0 11px 28px;position:relative;border-top:1px solid var(--line)}
        .pp .tlist li:first-child{border-top:none}
        .pp .tlist li:before{content:"✓";position:absolute;left:0;top:11px;color:var(--emerald);font-weight:700;font-size:15px}
        .pp .tlist.not li:before{content:"–";color:var(--muted)}

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

        @media(max-width:560px){.pp .hero h1{font-size:34px}.pp .navlinks .hide{display:none}}
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
            <Link className="hide" to="/pricing">Pricing</Link>
            <Link to="/login">Log in</Link>
            <button className="btn primary" onClick={() => nav('/register')}>Get started</button>
          </div>
        </div>
      </header>

      {/* ---------------- HERO ---------------- */}
      <section className="hero">
        <div className="wrap">
          <span className="eyebrow">For developers</span>
          <h1>Build on Divini Procure</h1>
          <p>
            A personal-access-token API over the same data your team already sees in the app -
            projects, bids, reviews, payment reputation, and more. Free to use on any plan.
          </p>
        </div>
      </section>

      {/* ---------------- HOW IT WORKS ---------------- */}
      <section style={{ paddingTop: 0 }}>
        <div className="wrap">
          <div className="kicker">How it works</div>
          <h2>Three steps to your first call</h2>
          <div className="steps">
            {STEPS.map((s, i) => (
              <div className="step" key={s.t}>
                <div className="n">{i + 1}</div>
                <h3>{s.t}</h3>
                <p>{s.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------------- EXAMPLE ---------------- */}
      <section style={{ paddingTop: 0 }}>
        <div className="wrap">
          <div className="kicker">Example</div>
          <h2>One bearer token, the real API</h2>
          <div className="sectsub">
            There is no separate "public API" to learn - a key works against the same REST
            endpoints the web app itself calls.
          </div>
          <div className="code">{`curl https://your-divini-instance/api/me \\
  -H "Authorization: Bearer dvp_live_..."`}</div>
        </div>
      </section>

      {/* ---------------- ENDPOINTS ---------------- */}
      <section style={{ paddingTop: 0 }}>
        <div className="wrap">
          <div className="kicker">A few examples</div>
          <h2>Representative read endpoints</h2>
          <div className="sectsub">
            A read-only key can call these and more. Write endpoints (creating bids, uploading
            documents, submitting reviews) follow the same request shape as the app itself.
          </div>
          <div className="tablewrap">
            <table className="endpoints">
              <thead><tr><th>Method</th><th>Endpoint</th><th>Returns</th></tr></thead>
              <tbody>
                {ENDPOINTS.map((e) => (
                  <tr key={e.path}>
                    <td><span className="method">{e.method}</span></td>
                    <td className="path">{e.path}</td>
                    <td>{e.desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ---------------- SCOPES / LIMITS + WHAT THIS ISN'T ---------------- */}
      <section style={{ paddingTop: 0 }}>
        <div className="wrap">
          <div className="kicker">Scopes, limits, and honesty</div>
          <h2>What a key can do - and what it can't</h2>
          <ul className="tlist">
            <li>Every key is <strong>read</strong>-only or <strong>read/write</strong>. A read-only key attempting a write gets a 403.</li>
            <li>A key authenticates as its creator - it sees exactly what that person's session would see, nothing more.</li>
            <li>120 requests/minute per key, separate from the app's general per-IP limit. Over the limit gets a 429 with a Retry-After header.</li>
            <li>Revoke anytime from the API Keys page. Revocation is immediate.</li>
          </ul>
          <ul className="tlist not" style={{ marginTop: 24 }}>
            <li>Not a webhook or event-push system yet - integrations poll.</li>
            <li>Not a public third-party app directory with listings, OAuth-on-behalf-of-another-company, or a review process - that is its own future scoping pass, not something this page pretends already exists.</li>
            <li>Not a replacement for signing in - both work side by side.</li>
          </ul>
        </div>
      </section>

      {/* ---------------- CLOSER ---------------- */}
      <section>
        <div className="wrap">
          <div className="closer">
            <h2>Free to build on, on any plan</h2>
            <p>Create an account, then generate a key from Account -&gt; API Keys.</p>
            <div className="cta">
              <button className="btn gold lg" onClick={() => nav('/register')}>Get started free</button>
              <button className="btn ghost lg" onClick={() => nav('/login')}>Log in to create a key</button>
            </div>
          </div>
        </div>
      </section>

      <footer>
        <div className="wrap">
          <div>Divini Procure. The verified construction procurement marketplace.</div>
          <div style={{ marginTop: 8 }}>
            <Link to="/">Home</Link> · <Link to="/pricing">Pricing</Link> · <Link to="/terms">Terms</Link> · <Link to="/privacy">Privacy</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
