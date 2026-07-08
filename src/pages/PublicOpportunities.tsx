import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import LanguageSwitcher from '../components/LanguageSwitcher';

interface Program {
  id: string;
  name: string;
  asset_class: string | null;
  location: string | null;
  target_raise_cents: number | null;
  min_investment_cents: number | null;
  projected_return: number | null;
  preferred_return: number | null;
  equity_multiple: number | null;
  irr_target: number | null;
  hold_period: string | null;
  risk_level: string | null;
  accredited_only: boolean | null;
  nda_required: boolean | null;
  investor_type_accepted: string | null;
  developer_name: string | null;
}

function fmtMoney(cents: number | null): string {
  if (cents == null) return '—';
  const val = cents / 100;
  if (val >= 1_000_000) return `$${(val / 1_000_000).toFixed(1)}M`;
  if (val >= 1_000) return `$${(val / 1_000).toFixed(0)}K`;
  return val.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

function RiskBadge({ level }: { level: string | null }) {
  if (!level) return null;
  const cls =
    level === 'conservative' ? 'badge b-green' :
    level === 'moderate' ? 'badge b-amber' :
    'badge b-red';
  return <span className={cls} style={{ textTransform: 'capitalize' }}>{level}</span>;
}

export default function PublicOpportunities() {
  const [programs, setPrograms] = useState<Program[]>([]);
  const [loading, setLoading] = useState(true);
  const [assetClass, setAssetClass] = useState('');
  const [location, setLocation] = useState('');
  const [minInvestment, setMinInvestment] = useState('');
  const [investorType, setInvestorType] = useState('');

  const fetch_ = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (assetClass) params.set('assetClass', assetClass);
      if (location) params.set('location', location);
      if (minInvestment) params.set('minInvestment', minInvestment);
      if (investorType) params.set('investorType', investorType);
      const qs = params.toString();
      const res = await fetch(`/api/investment/public-opportunities${qs ? `?${qs}` : ''}`);
      if (res.ok) {
        const data = await res.json();
        setPrograms(data.programs ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, [assetClass, location, minInvestment, investorType]);

  useEffect(() => { fetch_(); }, [fetch_]);

  return (
    <div style={{ background: 'var(--bg)', color: 'var(--ink)', minHeight: '100vh' }}>
      <style>{`
        .po-header{position:sticky;top:0;z-index:30;background:rgba(243,239,230,.93);backdrop-filter:blur(8px);border-bottom:1px solid var(--line)}
        .po-bar{max-width:1080px;margin:0 auto;padding:0 22px;display:flex;align-items:center;justify-content:space-between;height:64px}
        .po-logo{display:flex;align-items:center;gap:10px;text-decoration:none}
        .po-logo-nm{font-family:'Cormorant Garamond',serif;font-size:20px;font-weight:700;color:var(--emerald-deep);line-height:1}
        .po-logo-tg{font-size:10px;letter-spacing:.6px;text-transform:uppercase;color:var(--muted)}
        .po-navlinks{display:flex;align-items:center;gap:18px}
        .po-navlinks a{font-size:14px;font-weight:500;color:var(--ink);text-decoration:none}
        .po-navlinks a:hover{color:var(--emerald)}
        .po-hero{background:linear-gradient(135deg,#1E5D4A 0%,#123c2e 100%);padding:60px 22px 48px;text-align:center;color:#fff}
        .po-hero h1{font-size:42px;margin:0 0 12px;letter-spacing:-.3px}
        .po-hero p{font-size:18px;color:rgba(255,255,255,.85);max-width:580px;margin:0 auto;line-height:1.6}
        @media(max-width:640px){.po-hero h1{font-size:30px}}
        .po-filters{max-width:1080px;margin:0 auto;padding:28px 22px 0;display:flex;gap:12px;flex-wrap:wrap}
        .po-filters select,.po-filters input{padding:9px 13px;border:1px solid var(--line);border-radius:8px;font-size:14px;background:#fff;color:var(--ink);min-width:160px}
        .po-grid{max-width:1080px;margin:28px auto 60px;padding:0 22px;display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:20px}
        .po-card{background:#fff;border:1px solid var(--line);border-radius:16px;padding:26px;display:flex;flex-direction:column;gap:10px}
        .po-card-title{font-size:18px;font-weight:700;color:var(--ink);margin:0}
        .po-card-dev{font-size:13px;color:var(--muted);margin:0}
        .po-card-badges{display:flex;flex-wrap:wrap;gap:6px}
        .po-card-row{display:flex;justify-content:space-between;font-size:13.5px;border-top:1px solid var(--line);padding-top:8px}
        .po-card-row .label{color:var(--muted)}
        .po-card-row .value{font-weight:600}
        .po-card-cta{margin-top:4px}
        .po-empty{text-align:center;color:var(--muted);padding:60px 22px;font-size:16px}
        .po-disclaimer{max-width:800px;margin:0 auto 40px;padding:0 22px;font-size:11.5px;color:var(--muted);text-align:center;line-height:1.7}
      `}</style>

      {/* Nav */}
      <header className="po-header">
        <div className="po-bar">
          <Link to="/" className="po-logo">
            <img src="/brand/mark-emerald.png" alt="Divini Procure" style={{ height: 38, width: 'auto' }} />
            <div>
              <div className="po-logo-nm">Divini Procure</div>
              <div className="po-logo-tg">Investment Marketplace</div>
            </div>
          </Link>
          <div className="po-navlinks">
            <Link to="/pricing">Pricing</Link>
            <LanguageSwitcher />
            <Link to="/login">Log in</Link>
            <Link to="/register" className="btn primary" style={{ padding: '8px 18px', borderRadius: 8, fontSize: 14 }}>Get started</Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <div className="po-hero">
        <h1>Real Estate Investment Opportunities</h1>
        <p>Browse active programs from verified developers. Create a free account to request an introduction.</p>
      </div>

      {/* Filters */}
      <div className="po-filters">
        <select value={assetClass} onChange={e => setAssetClass(e.target.value)}>
          <option value="">All asset classes</option>
          <option value="multifamily">Multifamily</option>
          <option value="commercial">Commercial</option>
          <option value="industrial">Industrial</option>
          <option value="retail">Retail</option>
          <option value="mixed_use">Mixed Use</option>
          <option value="land">Land</option>
          <option value="hospitality">Hospitality</option>
          <option value="senior_housing">Senior Housing</option>
          <option value="self_storage">Self Storage</option>
        </select>
        <input
          type="text"
          placeholder="Location..."
          value={location}
          onChange={e => setLocation(e.target.value)}
        />
        <input
          type="number"
          placeholder="Max min. investment ($)"
          value={minInvestment}
          onChange={e => setMinInvestment(e.target.value)}
          min={0}
        />
        <select value={investorType} onChange={e => setInvestorType(e.target.value)}>
          <option value="">All investor types</option>
          <option value="accredited">Accredited</option>
          <option value="non_accredited">Non-accredited</option>
          <option value="family_office">Family office</option>
        </select>
      </div>

      {/* Grid */}
      {loading ? (
        <div className="po-empty">Loading opportunities…</div>
      ) : programs.length === 0 ? (
        <div className="po-empty">No open opportunities right now. Check back soon.</div>
      ) : (
        <div className="po-grid">
          {programs.map(p => {
            const returnLabel =
              p.irr_target != null ? `${p.irr_target}% IRR target` :
              p.projected_return != null ? `${p.projected_return}% projected` :
              p.equity_multiple != null ? `${p.equity_multiple}x equity multiple` :
              null;

            return (
              <div className="po-card card" key={p.id}>
                <p className="po-card-title">{p.name}</p>
                {p.developer_name && <p className="po-card-dev">{p.developer_name}</p>}

                <div className="po-card-badges">
                  {p.asset_class && (
                    <span className="badge b-neutral" style={{ textTransform: 'capitalize' }}>
                      {p.asset_class.replace('_', ' ')}
                    </span>
                  )}
                  {p.location && <span className="badge b-neutral">{p.location}</span>}
                  <RiskBadge level={p.risk_level} />
                  {p.accredited_only && <span className="badge b-amber">Accredited only</span>}
                  {p.nda_required && <span className="badge b-neutral">NDA required</span>}
                </div>

                <div className="po-card-row">
                  <span className="label">Target raise</span>
                  <span className="value">{fmtMoney(p.target_raise_cents)}</span>
                </div>
                <div className="po-card-row">
                  <span className="label">Min. investment</span>
                  <span className="value">{fmtMoney(p.min_investment_cents)}</span>
                </div>
                {returnLabel && (
                  <div className="po-card-row">
                    <span className="label">Returns</span>
                    <span className="value">{returnLabel}</span>
                  </div>
                )}
                {p.hold_period && (
                  <div className="po-card-row">
                    <span className="label">Hold period</span>
                    <span className="value">{p.hold_period}</span>
                  </div>
                )}

                <div className="po-card-cta">
                  <Link to="/register" className="btn primary" style={{ display: 'block', textAlign: 'center', padding: '10px', borderRadius: 8, fontSize: 14, textDecoration: 'none' }}>
                    Request Introduction
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Compliance disclaimer */}
      <p className="po-disclaimer">
        Divini Procure is an introduction platform only. It is not a broker-dealer, investment advisor, or placement agent. All introductions are between parties directly. Verify all information independently. Past performance is not indicative of future results.
      </p>
    </div>
  );
}
