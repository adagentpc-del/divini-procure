import { useNavigate } from 'react-router-dom';

export default function Landing() {
  const nav = useNavigate();
  const go = () => nav('/login');

  return (
    <div className="lp">
      <style>{`
        .lp{background:var(--bg);color:var(--ink);min-height:100vh}
        .lp a{cursor:pointer}
        .lp .wrap{max-width:1080px;margin:0 auto;padding:0 22px}
        .lp header{position:sticky;top:0;z-index:20;background:rgba(243,239,230,.88);backdrop-filter:blur(8px);border-bottom:1px solid var(--line)}
        .lp .bar{display:flex;align-items:center;justify-content:space-between;height:64px}
        .lp .logo{display:flex;align-items:center;gap:10px}
        
        .lp .logo .mkimg{height:42px;width:auto;display:block}
        .lp .logo .mk{width:34px;height:34px;border-radius:8px;background:var(--emerald-deep);color:var(--champagne);display:grid;place-items:center;font-family:'Cormorant Garamond',serif;font-weight:700;font-size:17px}
        .lp .logo .nm{font-family:'Cormorant Garamond',serif;font-size:20px;font-weight:700;color:var(--emerald-deep);line-height:1}
        .lp .logo .tg{font-size:10px;letter-spacing:.6px;text-transform:uppercase;color:var(--muted)}
        .lp .navlinks{display:flex;align-items:center;gap:24px}
        .lp .navlinks a{font-size:14px;font-weight:500;color:var(--ink)}
        .lp .navlinks a:hover{color:var(--emerald)}
        @media(max-width:720px){.lp .navlinks .hidelink{display:none}}

        .lp .hero{padding:74px 0 60px;text-align:center}
        .lp .eyebrow{display:inline-block;font-size:11px;letter-spacing:1px;text-transform:uppercase;font-weight:600;color:var(--emerald);background:#e7f3ec;padding:6px 13px;border-radius:20px;margin-bottom:20px}
        .lp h1{font-size:54px;line-height:1.05;letter-spacing:-.5px;max-width:780px;margin:0 auto}
        .lp .lede{font-size:18px;line-height:1.6;color:var(--muted);max-width:620px;margin:20px auto 30px}
        .lp .cta{display:flex;gap:12px;justify-content:center;flex-wrap:wrap}
        @media(max-width:640px){.lp h1{font-size:38px}}

        .lp section{padding:56px 0}
        .lp .kicker{font-size:12px;letter-spacing:.7px;text-transform:uppercase;color:var(--muted);font-weight:600;text-align:center;margin-bottom:8px}
        .lp h2{font-size:34px;text-align:center;margin-bottom:8px}
        .lp .sectsub{text-align:center;color:var(--muted);font-size:15px;max-width:560px;margin:0 auto 36px}

        .lp .steps{display:grid;grid-template-columns:repeat(3,1fr);gap:18px}
        .lp .step{background:#fff;border:1px solid var(--line);border-radius:var(--radius);padding:24px}
        .lp .step .n{width:30px;height:30px;border-radius:8px;background:var(--emerald);color:#fff;display:grid;place-items:center;font-weight:700;font-size:14px;margin-bottom:12px}
        .lp .step h3{font-size:20px;margin-bottom:6px}
        .lp .step p{font-size:14px;color:var(--muted);line-height:1.55;margin:0}

        .lp .two{display:grid;grid-template-columns:1fr 1fr;gap:18px}
        .lp .panel{background:#fff;border:1px solid var(--line);border-radius:var(--radius);padding:28px}
        .lp .panel.dark{background:var(--emerald-deep);border-color:var(--emerald-deep);color:#fff}
        .lp .panel h3{font-size:24px;margin-bottom:14px}
        .lp .panel.dark h3{color:#fff}
        .lp .panel ul{list-style:none;padding:0;margin:0 0 20px}
        .lp .panel li{font-size:14px;line-height:1.5;padding:8px 0 8px 26px;position:relative;color:var(--ink)}
        .lp .panel.dark li{color:rgba(255,255,255,.85)}
        .lp .panel li:before{content:"✓";position:absolute;left:0;color:var(--emerald);font-weight:700}
        .lp .panel.dark li:before{color:var(--champagne)}

        .lp .feats{display:grid;grid-template-columns:repeat(2,1fr);gap:16px}
        .lp .feat{background:#fff;border:1px solid var(--line);border-radius:var(--radius);padding:22px}
        .lp .feat h3{font-size:19px;margin-bottom:6px}
        .lp .feat p{font-size:14px;color:var(--muted);line-height:1.55;margin:0}
        @media(max-width:720px){.lp .steps,.lp .two,.lp .feats{grid-template-columns:1fr}}

        .lp .faq{max-width:760px;margin:0 auto}
        .lp .qa{background:#fff;border:1px solid var(--line);border-radius:var(--radius);padding:20px 22px;margin-bottom:12px}
        .lp .qa h3{font-size:17px;margin-bottom:6px}
        .lp .qa p{font-size:14px;color:var(--muted);line-height:1.6;margin:0}

        .lp .closer{background:var(--emerald-deep);border-radius:18px;padding:52px 28px;text-align:center;color:#fff}
        .lp .closer h2{color:#fff;font-size:36px;margin-bottom:10px}
        .lp .closer p{color:rgba(255,255,255,.8);font-size:16px;max-width:520px;margin:0 auto 26px}
        .lp .btn.gold{background:var(--champagne);border-color:var(--champagne);color:var(--emerald-deep)}
        .lp .btn.gold:hover{filter:brightness(1.05);background:var(--champagne)}
        .lp .btn.ghost{background:transparent;border-color:rgba(255,255,255,.5);color:#fff}
        .lp .btn.ghost:hover{background:rgba(255,255,255,.1);border-color:#fff}

        .lp footer{border-top:1px solid var(--line);margin-top:56px;padding:28px 0;text-align:center;color:var(--muted);font-size:13px}
      `}</style>

      <header>
        <div className="wrap bar">
          <div className="logo">
            <img className="mkimg" src="/brand/mark-emerald.png" alt="Divini Procure" />
            <div>
              <div className="nm">Divini Procure</div>
              <div className="tg">Procurement Marketplace</div>
            </div>
          </div>
          <div className="navlinks">
            <a className="hidelink" onClick={() => document.getElementById('how')?.scrollIntoView({behavior:'smooth'})}>How it works</a>
            <a className="hidelink" onClick={() => document.getElementById('who')?.scrollIntoView({behavior:'smooth'})}>Who it's for</a>
            <a className="hidelink" onClick={() => document.getElementById('faq')?.scrollIntoView({behavior:'smooth'})}>FAQ</a>
            <a onClick={go}>Log in</a>
            <button className="btn primary" onClick={go}>Get started</button>
          </div>
        </div>
      </header>

      <section className="hero">
        <div className="wrap">
          <span className="eyebrow">For real estate developers &amp; construction vendors</span>
          <h1>Procurement bidding, built for real estate development.</h1>
          <p className="lede">
            Post bid packages with drawings and a bill of quantities. Get structured,
            line-item bids from vetted vendors — compared apples-to-apples, not lump-sum guesswork.
          </p>
          <div className="cta">
            <button className="btn primary lg" onClick={go}>Get started free</button>
            <button className="btn lg" onClick={go}>Log in</button>
          </div>
        </div>
      </section>

      <section id="how">
        <div className="wrap">
          <div className="kicker">How it works</div>
          <h2>From scope to signed bid in three steps</h2>
          <p className="sectsub">Replace scattered email RFQs and lump-sum guesswork with one structured workflow.</p>
          <div className="steps">
            <div className="step">
              <div className="n">1</div>
              <h3>Post a package</h3>
              <p>Developers create a project, add buildings and bid packages, upload drawings (DWG, DXF, RVT, IFC, PDF, XLSX), and define scope as a bill of quantities.</p>
            </div>
            <div className="step">
              <div className="n">2</div>
              <h3>Vendors bid the line items</h3>
              <p>Vetted vendors review the real drawings, ask clarifications in RFQ Q&amp;A, and price each line item — totals compute automatically.</p>
            </div>
            <div className="step">
              <div className="n">3</div>
              <h3>Compare and award</h3>
              <p>Developers compare every bid on the same scope, side by side, with verified vendor credentials — then award with confidence.</p>
            </div>
          </div>
        </div>
      </section>

      <section id="who">
        <div className="wrap">
          <div className="kicker">Who it's for</div>
          <h2>One marketplace, both sides of the table</h2>
          <p className="sectsub" />
          <div className="two">
            <div className="panel">
              <h3>For developers</h3>
              <ul>
                <li>Post procurement needs across projects and buildings</li>
                <li>Define scope as a bill of quantities for apples-to-apples bids</li>
                <li>Share CAD drawings and documents securely with bidders</li>
                <li>Compare bids side by side and review vendor credentials</li>
                <li>Run clarifications through a single RFQ Q&amp;A thread</li>
              </ul>
              <button className="btn primary" onClick={go}>Post a project</button>
            </div>
            <div className="panel dark">
              <h3>For vendors</h3>
              <ul>
                <li>Discover real bid opportunities from active developers</li>
                <li>Analyze the actual drawings before you price</li>
                <li>Submit clean line-item bids that total automatically</li>
                <li>Build a verified profile with certifications and insurance</li>
                <li>Get reminders before your documents expire</li>
              </ul>
              <button className="btn gold" onClick={go}>Find bids</button>
            </div>
          </div>
        </div>
      </section>

      <section>
        <div className="wrap">
          <div className="kicker">What's inside</div>
          <h2>Built for how construction actually procures</h2>
          <p className="sectsub" />
          <div className="feats">
            <div className="feat"><h3>CAD &amp; document intake</h3><p>Upload DWG, DXF, RVT, IFC, PDF, XLSX, and images to a project or a specific bid package so vendors price from the real drawings.</p></div>
            <div className="feat"><h3>Bill of Quantities bidding</h3><p>Define scope as line items; vendors price each one and totals compute — true apples-to-apples comparison instead of lump sums.</p></div>
            <div className="feat"><h3>Vendor verification</h3><p>Vendors upload certifications and insurance, reviewed before approval, with reminders before anything expires.</p></div>
            <div className="feat"><h3>RFQ Q&amp;A</h3><p>Keep every clarification on the record, attached to the bid package, visible to the right people.</p></div>
          </div>
        </div>
      </section>

      <section id="faq">
        <div className="wrap">
          <div className="kicker">FAQ</div>
          <h2>Questions, answered</h2>
          <p className="sectsub" />
          <div className="faq">
            <div className="qa"><h3>What is Divini Procure?</h3><p>A procurement bidding marketplace for real estate development and construction. Developers post bid packages with drawings and a bill of quantities, and vetted vendors and contractors submit structured line-item bids with verified credentials.</p></div>
            <div className="qa"><h3>Who is it for?</h3><p>Real estate developers running procurement, and the vendors, contractors, subcontractors, suppliers, and fabricators who bid on their projects.</p></div>
            <div className="qa"><h3>How is it different from email RFQs?</h3><p>Instead of lump-sum bids over scattered email, developers define scope as a bill of quantities and vendors price each line item. Bids are compared apples-to-apples, with CAD drawings, document intake, and an RFQ Q&amp;A thread attached to each package.</p></div>
            <div className="qa"><h3>Are vendors verified?</h3><p>Yes. Vendors upload certifications and insurance, which are reviewed before approval, and the platform sends document-expiration reminders.</p></div>
          </div>
        </div>
      </section>

      <section>
        <div className="wrap">
          <div className="closer">
            <h2>Run your next procurement the right way</h2>
            <p>Post a package or start bidding in minutes. Free to get started.</p>
            <div className="cta">
              <button className="btn gold lg" onClick={go}>Get started free</button>
              <button className="btn ghost lg" onClick={go}>Log in</button>
            </div>
          </div>
        </div>
      </section>

      <footer>
        <div className="wrap"><img src="/brand/logo-emerald.png" alt="Divini Group" style={{height:54,width:'auto',display:'block',margin:'0 auto 14px',opacity:.92}} />Divini Procure — procurement bidding for real estate development &amp; construction.</div>
      </footer>
    </div>
  );
}
