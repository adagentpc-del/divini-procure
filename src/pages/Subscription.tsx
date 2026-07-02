/**
 * Subscription - the signed-in company's current plan, its usage against the
 * plan limits (rendered as bars), and the catalogue of available tiers as an
 * upgrade prompt. No payment is taken here; upgrades route through the admin /
 * sales flow. Additive surface; reads /subscriptions/mine + /subscriptions/tiers.
 */
import { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth';
import { apiGet } from '../lib/api';

type Tier = {
  key: string;
  name: string;
  audience: 'developer' | 'vendor' | 'investor';
  price_cents: number;
  ai_features: boolean;
  reporting_access: boolean;
  white_glove: boolean;
  active_project_limit: number | null;
  bid_package_limit: number | null;
  vendor_invite_limit: number | null;
  investment_program_limit: number | null;
  investor_match_limit: number | null;
  seat_limit: number | null;
};
type Entitlement = Tier & { company_id: string; tier_key: string | null; is_default: boolean };
type LimitCheck = { key: string; limit: number | null; used: number; remaining: number | null; allowed: boolean };
type Mine = {
  entitlement: Entitlement;
  usage: Record<string, number>;
  limits: Record<string, LimitCheck>;
};

const LIMIT_LABELS: Record<string, string> = {
  active_project_limit: 'Active projects',
  bid_package_limit: 'Bid packages',
  vendor_invite_limit: 'Vendor invites',
  investment_program_limit: 'Investment programs',
  investor_match_limit: 'Investor matches',
  seat_limit: 'Team seats',
};

function money(cents: number): string {
  if (!cents) return 'Free';
  return `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 0 })}/mo`;
}

function limitText(n: number | null): string {
  return n === null ? 'Unlimited' : String(n);
}

export default function Subscription() {
  const { company } = useAuth();
  const [mine, setMine] = useState<Mine | null>(null);
  const [tiers, setTiers] = useState<Tier[]>([]);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!company) return;
    apiGet<Mine>(`/subscriptions/mine?companyId=${company.id}`)
      .then(setMine)
      .catch((e) => setErr(e.message ?? 'Could not load subscription.'));
    apiGet<{ tiers: Tier[] }>('/subscriptions/tiers')
      .then((d) => setTiers(d.tiers ?? []))
      .catch(() => {});
  }, [company]);

  if (!company) return <div className="note">Loading…</div>;

  const ent = mine?.entitlement;
  const audience = ent?.audience ?? (company.kind === 'vendor' ? 'vendor' : 'developer');
  // Tiers relevant to this company: same audience, ordered by price.
  const relevant = tiers
    .filter((t) => t.audience === audience)
    .sort((a, b) => a.price_cents - b.price_cents);

  const limitOrder = Object.keys(LIMIT_LABELS).filter((k) => mine?.limits?.[k]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Subscription</h1>
          <div className="sub">Your current plan, what you have used this period, and the tiers available to you.</div>
        </div>
      </div>

      {err && <div className="err">{err}</div>}

      {ent && (
        <div className="card">
          <div className="two" style={{ alignItems: 'center', gap: 18 }}>
            <div>
              <div style={{ fontSize: 30, fontWeight: 700, lineHeight: 1.1 }}>{ent.name}</div>
              <div className="note" style={{ marginTop: 4 }}>{money(ent.price_cents)}</div>
              {ent.is_default && (
                <div className="note" style={{ marginTop: 4 }}>
                  Default plan (no paid tier assigned yet).
                </div>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-start' }}>
              <span className={`badge ${ent.ai_features ? 'b-green' : 'b-neutral'}`}>AI features</span>
              <span className={`badge ${ent.reporting_access ? 'b-green' : 'b-neutral'}`}>Reporting</span>
              <span className={`badge ${ent.white_glove ? 'b-green' : 'b-neutral'}`}>White glove</span>
            </div>
          </div>

          <div style={{ marginTop: 18, display: 'grid', gap: 14 }}>
            {limitOrder.length === 0 ? (
              <div className="note">No metered limits on this plan.</div>
            ) : (
              limitOrder.map((k) => {
                const lc = mine!.limits[k];
                const unlimited = lc.limit === null;
                const pct = unlimited || lc.limit === 0
                  ? (lc.used > 0 ? 100 : 0)
                  : Math.min(100, Math.round((lc.used / (lc.limit || 1)) * 100));
                const over = !lc.allowed;
                return (
                  <div key={k}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                      <strong>{LIMIT_LABELS[k]}</strong>
                      <span className="note">
                        {lc.used} / {limitText(lc.limit)}
                        {!unlimited && (
                          <span className={`badge ${over ? 'b-red' : 'b-green'}`} style={{ marginLeft: 8 }}>
                            {over ? 'At limit' : `${lc.remaining} left`}
                          </span>
                        )}
                      </span>
                    </div>
                    <div style={{ height: 8, borderRadius: 6, background: 'rgba(255,255,255,0.08)', overflow: 'hidden', marginTop: 4 }}>
                      <div style={{ width: `${unlimited ? 0 : pct}%`, height: '100%', background: over ? '#c0504d' : 'var(--accent, #b8924a)' }} />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      <div className="page-head" style={{ marginTop: 22 }}>
        <div>
          <h1 style={{ fontSize: 18 }}>Available plans</h1>
          <div className="sub">Compare tiers. To upgrade, contact your Divini account manager.</div>
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 14 }}>
        {relevant.length === 0 ? (
          <div className="card note">No plans available for your account type yet.</div>
        ) : (
          relevant.map((t) => {
            const current = ent?.tier_key === t.key;
            return (
              <div className="card" key={t.key} style={current ? { outline: '1px solid var(--accent, #b8924a)' } : undefined}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <strong>{t.name}</strong>
                  {current && <span className="badge b-green">Current</span>}
                </div>
                <div className="note" style={{ marginTop: 2 }}>{money(t.price_cents)}</div>
                <ul style={{ margin: '10px 0 0', paddingLeft: 16, fontSize: 13, lineHeight: 1.7 }}>
                  <li>Active projects: {limitText(t.active_project_limit)}</li>
                  <li>Bid packages: {limitText(t.bid_package_limit)}</li>
                  <li>Vendor invites: {limitText(t.vendor_invite_limit)}</li>
                  {audience === 'developer' && <li>Investment programs: {limitText(t.investment_program_limit)}</li>}
                  {audience === 'investor' && <li>Investor matches: {limitText(t.investor_match_limit)}</li>}
                  <li>Team seats: {limitText(t.seat_limit)}</li>
                </ul>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
                  {t.ai_features && <span className="badge b-neutral">AI</span>}
                  {t.reporting_access && <span className="badge b-neutral">Reporting</span>}
                  {t.white_glove && <span className="badge b-neutral">White glove</span>}
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="note" style={{ marginTop: 16 }}>
        Plan changes are applied by a Divini administrator. This page does not take payment.
      </div>
    </>
  );
}
