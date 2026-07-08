/**
 * Subscription - the signed-in company's current plan, its usage against the
 * plan limits (rendered as bars), and the catalogue of available tiers as an
 * upgrade prompt. No payment is taken here; upgrades route through the admin /
 * sales flow. Additive surface; reads /subscriptions/mine + /subscriptions/tiers.
 */
import { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth';
import { apiGet, apiSend } from '../lib/api';

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
  const [msg, setMsg] = useState('');
  const [busyKey, setBusyKey] = useState<string | null>(null);

  function reloadMine() {
    if (!company) return;
    apiGet<Mine>(`/subscriptions/mine?companyId=${company.id}`).then(setMine).catch(() => {});
  }

  useEffect(() => {
    if (!company) return;
    apiGet<Mine>(`/subscriptions/mine?companyId=${company.id}`)
      .then(setMine)
      .catch((e) => setErr(e.message ?? 'Could not load subscription.'));
    apiGet<{ tiers: Tier[] }>('/subscriptions/tiers')
      .then((d) => setTiers(d.tiers ?? []))
      .catch(() => {});
  }, [company]);

  // Capture-on-return from PayPal approval: return_url carries ?tierKey & ?token (order id).
  useEffect(() => {
    if (!company) return;
    const p = new URLSearchParams(window.location.search);
    const tierKey = p.get('tierKey');
    const subscriptionId = p.get('subscription_id'); // recurring approval
    const orderId = p.get('token');                  // one-time order approval
    if (!tierKey || (!subscriptionId && !orderId)) return;
    (async () => {
      setBusyKey(tierKey);
      try {
        if (subscriptionId) {
          await apiSend('POST', '/subscriptions/activate', { companyId: company.id, tierKey, subscriptionId });
          setMsg('Subscription active. Your plan renews automatically each month.');
        } else {
          await apiSend('POST', '/subscriptions/capture', { companyId: company.id, tierKey, orderId });
          setMsg('Payment complete. Your plan is now active.');
        }
        reloadMine();
      } catch (e: any) { setErr(e?.message ?? 'Could not confirm payment.'); }
      finally {
        setBusyKey(null);
        window.history.replaceState({}, '', window.location.pathname);
      }
    })();
    // eslint-disable-next-line
  }, [company]);

  async function upgrade(t: Tier) {
    if (!company) return;
    setErr(''); setMsg(''); setBusyKey(t.key);
    const ret = `${window.location.origin}/subscription?tierKey=${encodeURIComponent(t.key)}`;
    try {
      // Prefer a recurring subscription (auto-renews); fall back to one-time checkout.
      try {
        const r = await apiSend<{ approveUrl?: string | null }>(
          'POST', '/subscriptions/checkout-recurring',
          { companyId: company.id, tierKey: t.key, returnUrl: ret, cancelUrl: ret },
        );
        if (r.approveUrl) { window.location.href = r.approveUrl; return; }
      } catch { /* no plan / not configured -> fall back to one-time */ }
      const r2 = await apiSend<{ recordOnly?: boolean; approveUrl?: string | null; note?: string }>(
        'POST', '/subscriptions/checkout',
        { companyId: company.id, tierKey: t.key, returnUrl: ret, cancelUrl: ret },
      );
      if (r2.approveUrl) { window.location.href = r2.approveUrl; return; }
      setMsg(r2.note ? `Plan assigned (${r2.note}).` : 'Plan assigned.');
      reloadMine();
    } catch (e: any) { setErr(e?.message ?? 'Could not start checkout.'); }
    finally { setBusyKey(null); }
  }

  async function cancelPlan() {
    if (!company) return;
    if (!window.confirm('Cancel your subscription and return to the free plan?')) return;
    setErr(''); setMsg(''); setBusyKey('__cancel__');
    try {
      await apiSend('POST', '/subscriptions/cancel-recurring', { companyId: company.id });
      setMsg('Subscription cancelled. You are back on the free plan.');
      reloadMine();
    } catch (e: any) { setErr(e?.message ?? 'Could not cancel.'); }
    finally { setBusyKey(null); }
  }

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
      {msg && <div className="ok">{msg}</div>}

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
          <div className="sub">Compare tiers and upgrade. Paid plans check out securely through PayPal; your plan activates on payment.</div>
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
                {!current && (
                  <button className="btn primary" style={{ marginTop: 12, width: '100%' }} disabled={busyKey === t.key} onClick={() => upgrade(t)}>
                    {busyKey === t.key ? 'Working…' : t.price_cents > 0 ? `Upgrade — ${money(t.price_cents)}` : 'Switch to this plan'}
                  </button>
                )}
                {current && t.price_cents > 0 && (
                  <button className="btn" style={{ marginTop: 12, width: '100%' }} disabled={busyKey === '__cancel__'} onClick={cancelPlan}>
                    {busyKey === '__cancel__' ? 'Cancelling…' : 'Cancel plan'}
                  </button>
                )}
              </div>
            );
          })
        )}
      </div>

      <div className="note" style={{ marginTop: 16 }}>
        Payments are handled by PayPal. Divini charges for platform access only and is not a party to any transaction between users.
      </div>
    </>
  );
}
