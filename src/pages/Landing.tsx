import { useNavigate } from 'react-router-dom';
import VendorBadges from '../components/VendorBadges';
import LanguageSwitcher from '../components/LanguageSwitcher';

export default function Landing() {
  const nav = useNavigate();
  const go = () => nav('/login');

  return (
    <div className="lp">
      <style>{`
        .lp{background:var(--bg);color:var(--ink);min-height:100vh;overflow-x:hidden}
        .lp a{cursor:pointer}
        .lp .wrap{max-width:1080px;margin:0 auto;padding:0 22px}
        .lp header{position:sticky;top:0;z-index:30;background:rgba(243,239,230,.9);backdrop-filter:blur(8px);border-bottom:1px solid var(--line)}
        .lp .bar{display:flex;align-items:center;justify-content:space-between;height:64px}
        .lp .logo{display:flex;align-items:center;gap:10px}
        .lp .logo .mkimg{height:42px;width:auto;display:block}
        .lp .logo .nm{font-family:'Cormorant Garamond',serif;font-size:20px;font-weight:700;color:var(--emerald-deep);line-height:1}
        .lp .logo .tg{font-size:10px;letter-spacing:.6px;text-transform:uppercase;color:var(--muted)}
        .lp .navlinks{display:flex;align-items:center;gap:24px}
        .lp .navlinks a{font-size:14px;font-weight:500;color:var(--ink)}
        .lp .navlinks a:hover{color:var(--emerald)}
        @media(max-width:780px){.lp .navlinks .hidelink{display:none}}

        /* ---------- HERO with material video ---------- */
        .lp .hero{position:relative;min-height:88vh;display:flex;align-items:center;justify-content:center;text-align:center;overflow:hidden;isolation:isolate}
        .lp .hero-bg{position:absolute;inset:0;z-index:-3;background:
            radial-gradient(120% 120% at 20% 10%, #1E5D4A 0%, #123c2e 45%, #0d2c22 100%);
            background-size:200% 200%;animation:drift 22s ease-in-out infinite}
        /* coded material panels that drift behind the copy until the AI clips drop in */
        .lp .hero-tiles{position:absolute;inset:-10%;z-index:-2;display:grid;grid-template-columns:repeat(4,1fr);gap:18px;opacity:.5;transform:rotate(-6deg)}
        .lp .hero-tiles span{border-radius:16px;filter:blur(.3px);animation:tilefloat 14s ease-in-out infinite}
        .lp .hero-tiles span:nth-child(1){background:linear-gradient(135deg,#3a2a22,#5c4434);animation-delay:0s}      /* leather */
        .lp .hero-tiles span:nth-child(2){background:linear-gradient(135deg,#e9e2d2,#cfc3a6);animation-delay:1.5s}   /* marble */
        .lp .hero-tiles span:nth-child(3){background:linear-gradient(135deg,#2b5145,#1e5d4a);animation-delay:3s}     /* emerald drapery */
        .lp .hero-tiles span:nth-child(4){background:linear-gradient(135deg,#d9ccb0,#b8a07a);animation-delay:.8s}    /* champagne */
        .lp .hero-tiles span:nth-child(5){background:linear-gradient(135deg,#bcae93,#e9e2d2);animation-delay:2.2s}
        .lp .hero-tiles span:nth-child(6){background:linear-gradient(135deg,#1e5d4a,#123c2e);animation-delay:4s}
        .lp .hero-tiles span:nth-child(7){background:linear-gradient(135deg,#4a3528,#2f2018);animation-delay:1s}
        .lp .hero-tiles span:nth-child(8){background:linear-gradient(135deg,#cfc3a6,#9c8a68);animation-delay:3.4s}
        .lp .hero-vid{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:-2}
        .lp .hero-scrim{position:absolute;inset:0;z-index:-1;background:linear-gradient(180deg,rgba(10,30,24,.55),rgba(10,30,24,.78))}
        .lp .hero .wrap{padding-top:40px;padding-bottom:40px}
        .lp .hero .eyebrow{display:inline-block;font-size:11px;letter-spacing:1.2px;text-transform:uppercase;font-weight:600;color:var(--champagne);background:rgba(217,204,176,.12);border:1px solid rgba(217,204,176,.35);padding:7px 15px;border-radius:30px;margin-bottom:22px}
        .lp .hero h1{font-size:60px;line-height:1.03;letter-spacing:-.5px;max-width:860px;margin:0 auto;color:#fff}
        .lp .hero .lede{font-size:19px;line-height:1.6;color:rgba(255,255,255,.86);max-width:640px;margin:22px auto 32px}
        .lp .cta{display:flex;gap:12px;justify-content:center;flex-wrap:wrap}
        .lp .hero .trust{margin-top:26px;font-size:12.5px;letter-spacing:.4px;color:rgba(255,255,255,.7)}
        @media(max-width:640px){.lp .hero h1{font-size:40px}}

        @keyframes drift{0%,100%{background-position:0% 0%}50%{background-position:100% 100%}}
        @keyframes tilefloat{0%,100%{transform:translateY(0) scale(1)}50%{transform:translateY(-22px) scale(1.04)}}

        .lp section{padding:66px 0;position:relative}
        .lp .kicker{font-size:12px;letter-spacing:.8px;text-transform:uppercase;color:var(--emerald);font-weight:700;text-align:center;margin-bottom:10px}
        .lp h2{font-size:38px;text-align:center;margin-bottom:10px;letter-spacing:-.3px}
        .lp .sectsub{text-align:center;color:var(--muted);font-size:16px;max-width:600px;margin:0 auto 40px;line-height:1.6}

        /* ---------- PAIN POINTS ---------- */
        .lp .pains{display:grid;grid-template-columns:1fr 1fr;gap:20px}
        .lp .pain{background:#fff;border:1px solid var(--line);border-radius:16px;padding:30px}
        .lp .pain.vendor{background:var(--emerald-deep);border-color:var(--emerald-deep);color:#fff}
        .lp .painvid{width:100%;border-radius:12px;margin:0 0 18px;display:block;aspect-ratio:1/1;object-fit:cover;border:1px solid var(--line);box-shadow:0 20px 40px -24px rgba(18,60,46,.45)}
        .lp .showvid{width:100%;border-radius:18px;display:block;aspect-ratio:16/9;object-fit:cover;border:1px solid var(--line);box-shadow:0 34px 70px -34px rgba(18,60,46,.5)}
        .lp .pain .who{font-size:12px;letter-spacing:.7px;text-transform:uppercase;font-weight:700;color:var(--emerald);margin-bottom:4px}
        .lp .pain.vendor .who{color:var(--champagne)}
        .lp .pain h3{font-size:25px;margin-bottom:18px}
        .lp .pain.vendor h3{color:#fff}
        .lp .prow{padding:14px 0;border-top:1px solid var(--line)}
        .lp .pain.vendor .prow{border-color:rgba(255,255,255,.14)}
        .lp .prow .bad{font-size:14px;font-weight:600;display:flex;gap:8px;align-items:flex-start;line-height:1.45}
        .lp .prow .bad:before{content:"✕";color:var(--red);font-weight:700;margin-top:1px}
        .lp .pain.vendor .prow .bad:before{color:#e7a9a3}
        .lp .prow .fix{font-size:13.5px;color:var(--muted);margin:6px 0 0 22px;line-height:1.5}
        .lp .pain.vendor .prow .fix{color:rgba(255,255,255,.78)}
        .lp .prow .fix b{color:var(--emerald);font-weight:600}
        .lp .pain.vendor .prow .fix b{color:var(--champagne)}

        /* ---------- ANIMATED DEMOS ---------- */
        .lp .demo{display:grid;grid-template-columns:.85fr 1.15fr;gap:34px;align-items:center;margin-bottom:34px}
        .lp .demo.flip .demo-stage{order:-1}
        .lp .demo h3{font-size:28px;margin-bottom:8px}
        .lp .demo .who{font-size:12px;letter-spacing:.7px;text-transform:uppercase;font-weight:700;color:var(--emerald);margin-bottom:6px}
        .lp .demo .dsub{font-size:15px;color:var(--muted);line-height:1.6;margin-bottom:18px}
        .lp .dsteps{list-style:none;padding:0;margin:0}
        .lp .dstep{font-size:14px;font-weight:500;padding:9px 12px;border-radius:10px;color:var(--muted);display:flex;gap:9px;align-items:center;transition:.3s}
        .lp .dstep b{display:grid;place-items:center;width:22px;height:22px;border-radius:6px;background:var(--line);color:var(--muted);font-size:12px;font-weight:700;flex-shrink:0}
        .lp .demo-stage{position:relative;height:340px;border-radius:18px;background:linear-gradient(160deg,#fbf9f4,#eee7d8);border:1px solid var(--line);box-shadow:0 30px 60px -30px rgba(18,60,46,.4);overflow:hidden}
        .lp .winbar{height:34px;background:#fff;border-bottom:1px solid var(--line);display:flex;align-items:center;gap:6px;padding:0 12px}
        .lp .winbar i{width:9px;height:9px;border-radius:50%;background:#dcd5c8;display:block}
        .lp .screen{position:absolute;left:0;right:0;top:34px;bottom:0;padding:20px;opacity:0}
        .lp .scn-title{font-family:'Cormorant Garamond',serif;font-size:21px;color:var(--emerald-deep);margin-bottom:14px}
        .lp .mockcard{background:#fff;border:1px solid var(--line);border-radius:10px;padding:12px 14px;margin-bottom:10px;box-shadow:0 6px 16px -12px rgba(0,0,0,.25)}
        .lp .mline{height:9px;border-radius:5px;background:#ece6d9;margin:7px 0}
        .lp .mline.s{width:55%}.lp .mline.m{width:80%}.lp .mline.g{background:var(--emerald);opacity:.85}.lp .mline.c{background:var(--champagne)}
        .lp .mrow{display:flex;justify-content:space-between;align-items:center;gap:10px}
        .lp .pill{font-size:11px;font-weight:700;padding:3px 9px;border-radius:20px;background:#e7f3ec;color:#1f7a4d}
        .lp .pill.amber{background:#fbf2dc;color:#8a6d1a}
        .lp .bars{display:flex;align-items:flex-end;gap:8px;height:90px;margin-top:8px}
        .lp .bars div{flex:1;background:var(--emerald);border-radius:6px 6px 0 0;opacity:.85}
        .lp .tl{display:flex;gap:0;margin-top:14px}
        .lp .tl .node{flex:1;text-align:center;position:relative;font-size:10px;color:var(--muted)}
        .lp .tl .node:before{content:"";display:block;height:8px;width:8px;border-radius:50%;background:var(--emerald);margin:0 auto 6px}
        .lp .tl .node:after{content:"";position:absolute;top:3px;left:50%;width:100%;height:2px;background:var(--line);z-index:-1}
        .lp .tl .node:last-child:after{display:none}

        .lp .demo.builder .screen{animation:show5 16s infinite}
        .lp .demo.builder .screen:nth-child(2){animation-delay:0s}
        .lp .demo.builder .screen:nth-child(3){animation-delay:3.2s}
        .lp .demo.builder .screen:nth-child(4){animation-delay:6.4s}
        .lp .demo.builder .screen:nth-child(5){animation-delay:9.6s}
        .lp .demo.builder .screen:nth-child(6){animation-delay:12.8s}
        .lp .demo.builder .dstep{animation:hl5 16s infinite}
        .lp .demo.builder .dstep:nth-child(1){animation-delay:0s}
        .lp .demo.builder .dstep:nth-child(2){animation-delay:3.2s}
        .lp .demo.builder .dstep:nth-child(3){animation-delay:6.4s}
        .lp .demo.builder .dstep:nth-child(4){animation-delay:9.6s}
        .lp .demo.builder .dstep:nth-child(5){animation-delay:12.8s}

        .lp .demo.vendor .screen{animation:show4 13s infinite}
        .lp .demo.vendor .screen:nth-child(2){animation-delay:0s}
        .lp .demo.vendor .screen:nth-child(3){animation-delay:3.25s}
        .lp .demo.vendor .screen:nth-child(4){animation-delay:6.5s}
        .lp .demo.vendor .screen:nth-child(5){animation-delay:9.75s}
        .lp .demo.vendor .dstep{animation:hl4 13s infinite}
        .lp .demo.vendor .dstep:nth-child(1){animation-delay:0s}
        .lp .demo.vendor .dstep:nth-child(2){animation-delay:3.25s}
        .lp .demo.vendor .dstep:nth-child(3){animation-delay:6.5s}
        .lp .demo.vendor .dstep:nth-child(4){animation-delay:9.75s}

        @keyframes show5{0%{opacity:0;transform:translateY(10px)}3%{opacity:1;transform:none}18%{opacity:1;transform:none}21%{opacity:0;transform:translateY(-10px)}100%{opacity:0}}
        @keyframes hl5{0%,21%,100%{background:transparent;color:var(--muted)}3%,18%{background:var(--ivory);color:var(--emerald-deep)}}
        @keyframes show4{0%{opacity:0;transform:translateY(10px)}4%{opacity:1;transform:none}22%{opacity:1;transform:none}26%{opacity:0;transform:translateY(-10px)}100%{opacity:0}}
        @keyframes hl4{0%,26%,100%{background:transparent;color:var(--muted)}4%,22%{background:rgba(217,204,176,.18);color:#fff}}
        .lp .demo.builder .dstep.on b{background:var(--emerald);color:#fff}

        /* ---------- FOUNDING OFFER ---------- */
        .lp .founding{background:var(--emerald-deep);border-radius:22px;padding:54px 30px;color:#fff;text-align:center;position:relative;overflow:hidden}
        .lp .founding:before{content:"";position:absolute;inset:0;background:radial-gradient(80% 120% at 50% 0%,rgba(217,204,176,.16),transparent)}
        .lp .founding h2{color:#fff}
        .lp .founding .sub{color:rgba(255,255,255,.8);max-width:560px;margin:0 auto 34px;font-size:16px;line-height:1.6;position:relative}
        .lp .offers{display:grid;grid-template-columns:1fr 1fr;gap:20px;max-width:760px;margin:0 auto;position:relative}
        .lp .offer{background:rgba(255,255,255,.06);border:1px solid rgba(217,204,176,.3);border-radius:16px;padding:28px 24px;text-align:left}
        .lp .offer .tag{display:inline-block;font-size:11px;letter-spacing:.6px;text-transform:uppercase;font-weight:700;color:var(--emerald-deep);background:var(--champagne);padding:4px 11px;border-radius:20px;margin-bottom:14px}
        .lp .offer h3{color:#fff;font-size:24px;margin-bottom:10px}
        .lp .offer .big{font-family:'Cormorant Garamond',serif;font-size:30px;color:var(--champagne);line-height:1.2;margin-bottom:6px}
        .lp .offer p{font-size:14px;color:rgba(255,255,255,.82);line-height:1.55;margin:0}
        .lp .founding .seats{margin-top:30px;font-size:13px;color:var(--champagne);letter-spacing:.4px;position:relative;font-weight:600}

        /* ---------- PAYMENTS / SCALE ---------- */
        .lp .flow{display:flex;align-items:stretch;gap:0;flex-wrap:wrap;justify-content:center;margin-bottom:38px}
        .lp .fstep{flex:1;min-width:150px;background:#fff;border:1px solid var(--line);border-radius:14px;padding:20px 16px;text-align:center;margin:6px;position:relative;animation:pulse 6s ease-in-out infinite}
        .lp .fstep:nth-child(1){animation-delay:0s}.lp .fstep:nth-child(2){animation-delay:1s}.lp .fstep:nth-child(3){animation-delay:2s}.lp .fstep:nth-child(4){animation-delay:3s}
        .lp .fstep .ic{width:40px;height:40px;border-radius:11px;background:#e7f3ec;color:var(--emerald);display:grid;place-items:center;font-size:19px;margin:0 auto 10px}
        .lp .fstep h4{font-size:15px;color:var(--emerald-deep);margin-bottom:4px;font-family:Inter;font-weight:700}
        .lp .fstep p{font-size:12.5px;color:var(--muted);line-height:1.5;margin:0}
        @keyframes pulse{0%,100%{box-shadow:0 10px 24px -18px rgba(18,60,46,.5)}50%{box-shadow:0 14px 34px -14px rgba(30,93,74,.55);transform:translateY(-3px)}}
        .lp .scale{max-width:720px;margin:0 auto;background:#fff;border:1px solid var(--line);border-radius:16px;overflow:hidden}
        .lp .scale .sh{background:var(--ivory);padding:16px 22px;font-size:13px;font-weight:700;color:var(--emerald-deep);display:flex;justify-content:space-between}
        .lp .scale .sr{padding:16px 22px;border-top:1px solid var(--line);display:flex;justify-content:space-between;align-items:center}
        .lp .scale .sr .band{font-weight:600;font-size:15px;color:var(--ink)}
        .lp .scale .sr .ex{font-size:12.5px;color:var(--muted)}
        .lp .scale .sr .pct{font-family:'Cormorant Garamond',serif;font-size:26px;font-weight:700;color:var(--emerald)}
        .lp .scale-note{text-align:center;font-size:12.5px;color:var(--muted);margin-top:14px}

        @media(max-width:780px){.lp .pains,.lp .offers,.lp .demo{grid-template-columns:1fr}.lp .demo.flip .demo-stage{order:0}}

        .lp .closer{background:var(--emerald-deep);border-radius:22px;padding:56px 28px;text-align:center;color:#fff}
        .lp .closer h2{color:#fff;font-size:38px;margin-bottom:12px}
        .lp .closer p{color:rgba(255,255,255,.82);font-size:16px;max-width:520px;margin:0 auto 26px}
        .lp .btn.gold{background:var(--champagne);border-color:var(--champagne);color:var(--emerald-deep)}
        .lp .btn.gold:hover{filter:brightness(1.05);background:var(--champagne)}
        .lp .btn.ghost{background:transparent;border-color:rgba(255,255,255,.5);color:#fff}
        .lp .btn.ghost:hover{background:rgba(255,255,255,.1);border-color:#fff}
        .lp footer{border-top:1px solid var(--line);margin-top:10px;padding:30px 0;text-align:center;color:var(--muted);font-size:13px}
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
            <a className="hidelink" onClick={() => document.getElementById('why')?.scrollIntoView({behavior:'smooth'})}>Why Divini</a>
            <a className="hidelink" onClick={() => document.getElementById('how')?.scrollIntoView({behavior:'smooth'})}>How it works</a>
            <a onClick={() => nav('/opportunities')}>Browse deals</a>
            <a onClick={() => nav('/pricing')}>Pricing</a>
            <LanguageSwitcher />
            <a onClick={go}>Log in</a>
            <button className="btn primary" onClick={go}>Get started</button>
          </div>
        </div>
      </header>

      {/* ---------------- HERO ---------------- */}
      <section className="hero">
        <div className="hero-bg" />
        <div className="hero-tiles"><span/><span/><span/><span/><span/><span/><span/><span/></div>
        {/* Drop the ComfyUI material reel at /media/hero.mp4 and it plays automatically */}
        <video className="hero-vid" autoPlay muted loop playsInline poster="/media/hero-poster.jpg">
          <source src="/media/hero.mp4" type="video/mp4" />
        </video>
        <div className="hero-scrim" />
        <div className="wrap">
          <span className="eyebrow">The verified construction procurement marketplace</span>
          <h1>Verified vendors. Competitive bids. Protected developers.</h1>
          <p className="lede">
            Developers post projects and receive more qualified bids. Vendors find real deal flow and
            win the right work. Every vendor is license and insurance verified before they reach a developer.
          </p>
          <div className="cta">
            <button className="btn gold lg" onClick={go}>Start as a developer</button>
            <button className="btn ghost lg" onClick={go}>Join as a vendor</button>
          </div>
          <div className="trust">Free to join. You only pay when you win.</div>
        </div>
      </section>

      {/* ---------------- SHOWCASE BAND ---------------- */}
      <section style={{paddingTop:46,paddingBottom:0}}>
        <div className="wrap">
          <video className="showvid" autoPlay muted loop playsInline poster="/media/showcase-poster.jpg">
            <source src="/media/showcase.mp4" type="video/mp4" />
          </video>
        </div>
      </section>

      {/* ---------------- PAIN POINTS ---------------- */}
      <section id="why">
        <div className="wrap">
          <div className="kicker">Why Divini Procure</div>
          <h2>Procurement is broken on both sides</h2>
          <p className="sectsub">Developers lose time and money to messy bidding. Vendors lose work to noise and dead ends. We fix both.</p>
          <div className="pains">
            <div className="pain">
              <div className="who">For developers</div>
              <h3>Stop guessing on bids</h3>
              <video className="painvid" autoPlay muted loop playsInline poster="/media/developer-poster.jpg">
                <source src="/media/developer.mp4" type="video/mp4" />
              </video>
              <div className="prow">
                <div className="bad">Lump-sum bids you cannot compare</div>
                <div className="fix">Vendors price your bill of quantities line by line, so every bid is <b>apples to apples</b>.</div>
              </div>
              <div className="prow">
                <div className="bad">Drawings scattered across email threads</div>
                <div className="fix">Upload CAD and documents once. Every bidder works from the <b>same source of truth</b>.</div>
              </div>
              <div className="prow">
                <div className="bad">No idea if a vendor is qualified or insured</div>
                <div className="fix">See <b>verified credentials and insurance</b> before you award, with expiry reminders.</div>
              </div>
              <div className="prow">
                <div className="bad">Projects drift after the award</div>
                <div className="fix">Manage scope, payments, and timelines <b>to completion</b> in one place.</div>
              </div>
            </div>
            <div className="pain vendor">
              <div className="who">For vendors</div>
              <h3>Win the right work</h3>
              <video className="painvid" autoPlay muted loop playsInline poster="/media/vendor-poster.jpg">
                <source src="/media/vendor.mp4" type="video/mp4" />
              </video>
              <div className="prow">
                <div className="bad">Chasing leads that go nowhere</div>
                <div className="fix">Find <b>real bid packages</b> from active developers, matched to your trade.</div>
              </div>
              <div className="prow">
                <div className="bad">Quoting blind without real plans</div>
                <div className="fix">Price from the <b>actual drawings and line items</b>, not a vague brief.</div>
              </div>
              <div className="prow">
                <div className="bad">Hours lost building quotes by hand</div>
                <div className="fix">Upload your products and pricing once and <b>generate quotes in minutes</b>.</div>
              </div>
              <div className="prow">
                <div className="bad">Work and payments spread across tools</div>
                <div className="fix">Bids, contracts, invoices, and payouts <b>managed in one place</b>.</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ---------------- ANIMATED DEMOS ---------------- */}
      <section id="how" style={{background:'var(--ivory)'}}>
        <div className="wrap">
          <div className="kicker">How it works</div>
          <h2>Built for how building actually happens</h2>
          <p className="sectsub">A guided look at both sides of the marketplace, from first upload to final payout.</p>

          {/* Builder demo */}
          <div className="demo builder">
            <div>
              <div className="who">Developers</div>
              <h3>Run procurement end to end</h3>
              <p className="dsub">Everything from drawings to delivery, in one calm workflow.</p>
              <ul className="dsteps">
                <li className="dstep"><b>1</b> Upload CAD drawings and documents</li>
                <li className="dstep"><b>2</b> Create bid packages and a bill of quantities</li>
                <li className="dstep"><b>3</b> Find and compare vendors side by side</li>
                <li className="dstep"><b>4</b> Negotiate and save your favorites</li>
                <li className="dstep"><b>5</b> Manage the project on a timeline to completion</li>
              </ul>
            </div>
            <div className="demo-stage">
              <div className="winbar"><i/><i/><i/></div>
              <div className="screen">
                <div className="scn-title">Upload drawings</div>
                <div className="mockcard"><div className="mrow"><span className="pill">DWG</span><div className="mline s" style={{flex:1,margin:0}}/></div></div>
                <div className="mockcard"><div className="mrow"><span className="pill">RVT</span><div className="mline m" style={{flex:1,margin:0}}/></div></div>
                <div className="mockcard"><div className="mrow"><span className="pill amber">PDF</span><div className="mline" style={{flex:1,margin:0}}/></div></div>
              </div>
              <div className="screen">
                <div className="scn-title">Create bid package</div>
                <div className="mockcard"><div className="mline g m"/><div className="mline s"/></div>
                <div className="mockcard"><div className="mline"/><div className="mline s"/></div>
                <div className="mockcard"><div className="mline"/><div className="mline c s"/></div>
              </div>
              <div className="screen">
                <div className="scn-title">Compare vendors</div>
                <div className="mockcard"><div className="mrow"><div className="mline m" style={{flex:1,margin:0}}/><span className="pill">Best</span></div></div>
                <div className="mockcard"><div className="mrow"><div className="mline m" style={{flex:1,margin:0}}/><span className="pill amber">2nd</span></div></div>
                <div className="mockcard"><div className="mrow"><div className="mline s" style={{flex:1,margin:0}}/><span className="pill amber">3rd</span></div></div>
              </div>
              <div className="screen">
                <div className="scn-title">Negotiate and shortlist</div>
                <div className="mockcard"><div className="mline m"/><div className="mline s"/></div>
                <div className="mockcard" style={{borderColor:'var(--emerald)'}}><div className="mrow"><div className="mline g m" style={{flex:1,margin:0}}/><span className="pill">Saved</span></div></div>
              </div>
              <div className="screen">
                <div className="scn-title">Project timeline</div>
                <div className="tl"><div className="node">Award</div><div className="node">Produce</div><div className="node">Deliver</div><div className="node">Install</div><div className="node">Done</div></div>
                <div className="bars"><div style={{height:'40%'}}/><div style={{height:'70%'}}/><div style={{height:'55%'}}/><div style={{height:'90%'}}/><div style={{height:'100%'}}/></div>
              </div>
            </div>
          </div>

          {/* Vendor demo */}
          <div className="demo vendor flip">
            <div>
              <div className="who" style={{color:'var(--emerald)'}}>Vendors</div>
              <h3>Win work and quote fast</h3>
              <p className="dsub">Less hunting, less manual quoting, everything in one place.</p>
              <ul className="dsteps">
                <li className="dstep"><b>1</b> Find bids matched to your trade</li>
                <li className="dstep"><b>2</b> Upload your products and pricing</li>
                <li className="dstep"><b>3</b> Generate a quote in minutes</li>
                <li className="dstep"><b>4</b> Submit and manage everything in one place</li>
              </ul>
            </div>
            <div className="demo-stage">
              <div className="winbar"><i/><i/><i/></div>
              <div className="screen">
                <div className="scn-title">Find bids</div>
                <div className="mockcard"><div className="mrow"><div className="mline m" style={{flex:1,margin:0}}/><span className="pill">Open</span></div></div>
                <div className="mockcard"><div className="mrow"><div className="mline s" style={{flex:1,margin:0}}/><span className="pill">Open</span></div></div>
                <div className="mockcard"><div className="mrow"><div className="mline m" style={{flex:1,margin:0}}/><span className="pill amber">Closing</span></div></div>
              </div>
              <div className="screen">
                <div className="scn-title">Upload products and pricing</div>
                <div className="mockcard"><div className="mrow"><span className="pill">Catalog</span><div className="mline s" style={{flex:1,margin:0}}/></div></div>
                <div className="mockcard"><div className="mline c m"/><div className="mline s"/></div>
              </div>
              <div className="screen">
                <div className="scn-title">Generate quote</div>
                <div className="mockcard"><div className="mrow"><div className="mline m" style={{flex:1,margin:0}}/><div className="mline g s" style={{margin:0}}/></div></div>
                <div className="mockcard"><div className="mrow"><div className="mline s" style={{flex:1,margin:0}}/><div className="mline g s" style={{margin:0}}/></div></div>
                <div className="mockcard" style={{background:'var(--emerald)'}}><div className="mrow"><div className="mline" style={{flex:1,margin:0,background:'rgba(255,255,255,.5)'}}/><div className="mline" style={{width:'30%',margin:0,background:'#fff'}}/></div></div>
              </div>
              <div className="screen">
                <div className="scn-title">Submit and manage</div>
                <div className="mockcard"><div className="mrow"><div className="mline m" style={{flex:1,margin:0}}/><span className="pill">Submitted</span></div></div>
                <div className="mockcard"><div className="mrow"><div className="mline s" style={{flex:1,margin:0}}/><span className="pill">Awarded</span></div></div>
                <div className="mockcard"><div className="mrow"><div className="mline s" style={{flex:1,margin:0}}/><span className="pill amber">Invoiced</span></div></div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ---------------- TRUST / VERIFICATION ---------------- */}
      <section>
        <div className="wrap">
          <div className="founding">
            <div className="kicker" style={{color:'var(--champagne)'}}>Built on trust</div>
            <h2>Every vendor is verified before they reach a developer</h2>
            <p className="sub">We confirm license and insurance up front, so developers only see qualified makers and trades. Vendors who go further earn higher-trust badges.</p>
            <div className="offers">
              <div className="offer">
                <span className="tag">Verified</span>
                <h3 style={{display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>Verified <VendorBadges verified /></h3>
                <p>License, insurance, and certifications confirmed before a vendor can submit a bid.</p>
              </div>
              <div className="offer">
                <span className="tag">Verified+</span>
                <h3 style={{display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>Verified+ <VendorBadges verifiedPlus /></h3>
                <p>Premium verification that adds bonding, financials, references, and background checks for the highest level of trust.</p>
              </div>
            </div>
            <div className="seats">Featured vendors earn top placement once verified.</div>
            <div className="cta" style={{marginTop:24}}>
              <button className="btn gold lg" onClick={go}>Join as a verified vendor</button>
            </div>
          </div>
        </div>
      </section>

      {/* ---------------- PRICING SUMMARY ---------------- */}
      <section id="pricing">
        <div className="wrap">
          <div className="kicker">Pricing</div>
          <h2>Free to join. You only pay when you win.</h2>
          <p className="sectsub">Developers post and award at no cost. Vendors build a profile and start bidding for free. Divini earns a small success fee only when a vendor wins.</p>
          <div className="flow">
            <div className="fstep"><div className="ic">$</div><h4>Developers</h4><p>Free. Post projects and receive bids from verified vendors.</p></div>
            <div className="fstep"><div className="ic">◷</div><h4>Vendors</h4><p>Free. Build a profile and submit up to 5 bids per quarter.</p></div>
            <div className="fstep"><div className="ic">★</div><h4>Vendor Pro</h4><p>$149 per month. Unlimited bids, project alerts, and priority matching.</p></div>
            <div className="fstep"><div className="ic">✓</div><h4>You only pay when you win</h4><p>A 2 percent success fee on the awarded contract, capped at $2,500.</p></div>
          </div>
          <div className="scale-note">No fees to browse, bid, or post. <a onClick={() => nav('/pricing')} style={{color:'var(--emerald)',fontWeight:600,cursor:'pointer'}}>See full pricing</a>.</div>
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
          <img src="/brand/logo-emerald.png" alt="Divini Group" style={{height:54,width:'auto',display:'block',margin:'0 auto 14px',opacity:.92}} />
          Divini Procure. Procurement bidding for real estate development and construction.
        </div>
      </footer>
    </div>
  );
}
