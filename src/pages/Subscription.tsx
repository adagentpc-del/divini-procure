/**
 * Subscription - the signed-in company's current plan, usage against plan
 * limits (rendered as bars), and the catalogue of available tiers as an upgrade
 * prompt. Paid plans redirect to a Stripe Checkout Session; the plan activates
 * on return (session verification) and via Stripe webhook for reliability.
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
type Entitlement = Tier & {
  company_id: string;
  tier_key: string | null;
  is_default: boolean;
  subscription_status: string | null;
};
type LimitCheck = {
  key: string;
  limit: number | null;
  used: number;
  remaining: number | null;
  allowed: boolean;
};
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
  return `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}/mo`;
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

  // Handle return from Stripe Checkout: ?session_id=cs_...
  useEffect(() => {
    if (!company) return;
    const p = new URLSearchParams(window.location.search);
    const sessionId = p.get('session_id');
    if (!sessionId) return;

    (async () => {
      setBusyKey('__session__');
      try {
        const r = await apiGet<{ ok: boolean; entitlement?: unknown }>(
          `/subscriptions/session?sessionId=${encodeURIComponent(sessionId)}`,
        );
        if (r.ok) {
          setMsg('Payment successful. Your plan is now active.');
          reloadMine();
        }
      } catch (e: any) {
        setErr(e?.message ?? 'Could not confirm payment. Please contact support if your plan does not activate within a few minutes.');
      } finally {
        setBusyKey(null);
        // Remove ?session_id from the URL so a refresh doesn't re-confirm.
        window.history.replaceState({}, '', window.location.pathname);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [company]);

  async function upgrade(t: Tier) {
    if (!company) return;
    setErr(''); setMsg(''); setBusyKey(t.key);
    const successUrl = `${window.location.origin}/subscription?session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${window.location.origin}/subscription`;
    try {
      const r = await apiSend<{
        recordOnly?: boolean;
        url?: string | null;
        sessionId?: string | null;
        note?: string;
        needsSync?: boolean;
      }>('POST', '/subscriptions/checkout', {
        companyId: company.id,
        tierKey: t.key,
        successUrl,
        cancelUrl,
      });

      if (r.needsSync) {
        setErr('Payment catalog not configured yet. Please contact support.');
        return;
      }
      if (r.url) {
        // Redirect to Stripe Checkout.
        window.location.href = r.url;
        return;
      }
      // Free tier or record-only (Stripe not yet configured).
      setMsg(r.note ? `Plan assigned (${r.note}).` : 'Plan assigned.');
      reloadMine();
    } catch (e: any) {
      setErr(e?.message ?? 'Could not start checkout.');
    } finally {
      setBusyKey(null);
    }
  }

  async function cancelPlan() {
    if (!company) return;
    if (!window.confirm('Cancel your subscription and return to the free plan? You will keep access until the end of your current billing period.')) return;
    setErr(''); setMsg(''); setBusyKey('__cancel__');
    try {
      await apiSend('POST', '/subscriptions/cancel', { companyId: company.id });
      setMsg('Subscription cancelled. You will keep access until the end of your current billing period, then return to the free plan.');
      reloadMine();
    } catch (e: any) {
      setErr(e?.message ?? 'Could not cancel.');
    } finally {
      setBusyKey(null);
    }
  }

  if (!company) return <div className="note">Loading...</div>;

  const ent = mine?.entitlement;
  const audience = ent?.audience ?? (company.kind === 'vendor' ? 'vendor' : 'developer');
  const relevant = tiers
    .filter((t) => t.audience === audience)
    .sort((a, b) => a.price_cents - b.price_cents);

  const limitOrder = Object.keys(LIMIT_LABELS).filter((k) => mine?.limits?.[k]);

  const isPastDue = ent?.subscription_status === 'past_due';

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Subscription</h1>
          <div className="sub">
            Your current plan, usage this period, and available tiers.
          </div>
        </div>
      </div>

      {err && <div className="err">{err}</div>}
      {msg && <div className="ok">{msg}</div>}
      {isPastDue && (
        <div className="err" style={{ marginBottom: 12 }}>
          Your last payment failed. Please update your payment method in the Stripe customer portal to avoid losing access.
        </div>
      )}

      {ent && (
        <div className="card">
          <div className="two" style={{ alignItems: 'center', gap: 18 }}>
            <div>
              <div style={{ fontSize: 30, fontWeight: 700, lineHeight: 1.1 }}>{ent.name}</div>
              <div className="note" style={{ marginTop: 4 }}>{money(ent.price_cents)}</div>
              {ent.is_default && (
                <div className="note" style={{ marginTop: 4 }}>Default plan (no paid tier assigned yet).</div>
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
                          <span
                            className={`badge ${over ? 'b-red' : 'b-green'}`}
                            style={{ marginLeft: 8 }}
                          >
                            {over ? 'At limit' : `${lc.remaining} left`}
                          </span>
                        )}
                      </span>
                    </div>
                    <div
                      style={{
                        height: 8,
                        borderRadius: 6,
                        background: 'rgba(255,255,255,0.08)',
                        overflow: 'hidden',
                        marginTop: 4,
                      }}
                    >
                      <div
                        style={{
                          width: `${unlimited ? 0 : pct}%`,
                          height: '100%',
                          background: over ? '#c0504d' : 'var(--accent, #b8924a)',
                        }}
                      />
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
          <div className="sub">
            Compare tiers and upgrade. Paid plans check out securely through Stripe.
            Your plan activates immediately on payment.
          </div>
        </div>
      </div>

      <div
        className="grid"
        style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 14 }}
      >
        {relevant.length === 0 ? (
          <div className="card note">No plans available for your account type yet.</div>
        ) : (
          relevant.map((t) => {
            const current = ent?.tier_key === t.key;
            return (
              <div
                className="card"
                key={t.key}
                style={current ? { outline: '1px solid var(--accent, #b8924a)' } : undefined}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <strong>{t.name}</strong>
                  {current && <span className="badge b-green">Current</span>}
                </div>
                <div className="note" style={{ marginTop: 2 }}>{money(t.price_cents)}</div>
                <ul style={{ margin: '10px 0 0', paddingLeft: 16, fontSize: 13, lineHeight: 1.7 }}>
                  <li>Active projects: {limitText(t.active_project_limit)}</li>
                  <li>Bid packages: {limitText(t.bid_package_limit)}</li>
                  <li>Vendor invites: {limitText(t.vendor_invite_limit)}</li>
                  {audience === 'developer' && (
                    <li>Investment programs: {limitText(t.investment_program_limit)}</li>
                  )}
                  {audience === 'investor' && (
                    <li>Investor matches: {limitText(t.investor_match_limit)}</li>
                  )}
                  <li>Team seats: {limitText(t.seat_limit)}</li>
                </ul>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
                  {t.ai_features && <span className="badge b-neutral">AI</span>}
                  {t.reporting_access && <span className="badge b-neutral">Reporting</span>}
                  {t.white_glove && <span className="badge b-neutral">White glove</span>}
                </div>
                {!current && (
                  <button
                    className="btn primary"
                    style={{ marginTop: 12, width: '100%' }}
                    disabled={!!busyKey}
                    onClick={() => upgrade(t)}
                  >
                    {busyKey === t.key
                      ? 'Working...'
                      : t.price_cents > 0
                      ? `Upgrade - ${money(t.price_cents)}`
                      : 'Switch to this plan'}
                  </button>
                )}
                {current && t.price_cents > 0 && (
                  <button
                    className="btn"
                    style={{ marginTop: 12, width: '100%' }}
                    disabled={busyKey === '__cancel__'}
                    onClick={cancelPlan}
                  >
                    {busyKey === '__cancel__' ? 'Cancelling...' : 'Cancel plan'}
                  </button>
                )}
              </div>
            );
          })
        )}
      </div>

      <div className="note" style={{ marginTop: 16 }}>
        Payments are processed securely by Stripe. Divini Procure charges for
        platform access only. Subscriptions renew monthly and can be cancelled at
        any time. Refund requests are handled within 7 days of charge; contact
        support@diviniprocure.com.
      </div>
    </>
  );
}
