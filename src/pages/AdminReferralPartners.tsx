import { useEffect, useState } from 'react';
import { useFeatures } from '../lib/features';
import { apiGet, apiSend } from '../lib/api';
import {
  getPartnerRev, addPartnerCommission, patchPartnerCommission,
  computePartnerPayout, patchPartnerPayout,
  type PartnerRevView, type PartnerCommission, type PartnerPayout,
} from '../lib/db';

type Partner = {
  id: string; name: string; partner_email?: string;
  referral_code: string; referral_link?: string;
  commission_type: string; revenue_share_pct?: number; flat_fee_cents?: number;
  applies_to?: string; status: string; created_at: string;
};

const money = (cents?: number | null) =>
  cents == null ? '-' : `$${(Number(cents) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const COMMISSION_STATUSES = ['pending', 'approved', 'paid', 'held', 'disputed'];
const PAYOUT_STATUSES = ['pending', 'approved', 'scheduled', 'paid', 'held', 'disputed', 'cancelled'];
const SOURCES = ['subscription', 'transaction', 'setup', 'enterprise', 'manual_adjustment'];

export default function AdminReferralPartners() {
  const { isAdmin } = useFeatures();
  const [rows, setRows] = useState<Partner[]>([]);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [commissionType, setCommissionType] = useState('percent');
  const [share, setShare] = useState('');
  const [flatFee, setFlatFee] = useState('');
  const [appliesTo, setAppliesTo] = useState('');
  const [created, setCreated] = useState<Partner | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  async function load() {
    try {
      const d = await apiGet<{ partners: Partner[] }>('/admin/referral-partners');
      setRows(d.partners ?? []);
    } catch (e: any) { setErr(e.message ?? 'Could not load partners.'); }
  }
  useEffect(() => { if (isAdmin) load(); }, [isAdmin]);

  if (!isAdmin) return <div className="card">Admins only.</div>;

  async function create() {
    setBusy(true); setErr(''); setCreated(null);
    try {
      const d = await apiSend<{ partner: Partner }>('POST', '/admin/referral-partners', {
        name,
        partnerEmail: email || undefined,
        commissionType,
        revenueSharePct: commissionType === 'percent' && share !== '' ? Number(share) : undefined,
        flatFeeCents: commissionType === 'flat' && flatFee !== '' ? Math.round(Number(flatFee) * 100) : undefined,
        appliesTo: appliesTo || undefined,
      });
      setCreated(d.partner);
      setName(''); setEmail(''); setShare(''); setFlatFee(''); setAppliesTo('');
      await load();
    } catch (e: any) { setErr(e.message ?? 'Could not create partner.'); }
    finally { setBusy(false); }
  }

  async function patchPartner(p: Partner, patch: Record<string, unknown>) {
    try { await apiSend('PATCH', `/admin/referral-partners/${p.id}`, patch); await load(); }
    catch (e: any) { setErr(e.message ?? 'Could not update.'); }
  }
  async function toggle(p: Partner) {
    await patchPartner(p, { status: p.status === 'active' ? 'disabled' : 'active' });
  }

  return (
    <>
      <div className="page-head"><div>
        <h1>Referral Partners</h1>
        <div className="sub">Create revenue-share partners. Each gets a unique referral code and link. Revenue share is editable any time. Open a partner to manage the profit-based commission ledger and payouts.</div>
      </div></div>

      {err && <div className="err">{err}</div>}

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div><label className="note">Name</label><input value={name} onChange={e => setName(e.target.value)} placeholder="Partner name" /></div>
          <div><label className="note">Email</label><input value={email} onChange={e => setEmail(e.target.value)} placeholder="partner@example.com" /></div>
          <div><label className="note">Commission type</label>
            <select value={commissionType} onChange={e => setCommissionType(e.target.value)}>
              <option value="percent">Revenue share (%)</option>
              <option value="flat">Flat fee ($)</option>
            </select>
          </div>
          {commissionType === 'percent'
            ? <div><label className="note">Revenue share %</label><input value={share} onChange={e => setShare(e.target.value)} type="number" placeholder="10" style={{ width: 100 }} /></div>
            : <div><label className="note">Flat fee ($)</label><input value={flatFee} onChange={e => setFlatFee(e.target.value)} type="number" placeholder="100" style={{ width: 100 }} /></div>}
          <div><label className="note">Applies to</label><input value={appliesTo} onChange={e => setAppliesTo(e.target.value)} placeholder="subscription" /></div>
          <button className="btn primary" disabled={busy || !name} onClick={create}>Create partner</button>
        </div>
        <div className="note" style={{ marginTop: 8 }}>
          Commission is profit-based: a share of (platform fee minus processing cost), never the gross invoice.
        </div>
        {created?.referral_link && (
          <div className="note" style={{ marginTop: 12 }}>
            Referral link for <strong>{created.name}</strong>: <code>{created.referral_link}</code>{' '}
            <button className="btn" onClick={() => navigator.clipboard?.writeText(created.referral_link!)}>Copy</button>
          </div>
        )}
      </div>

      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead><tr><th></th><th>Name</th><th>Email</th><th>Code</th><th>Type</th><th>Revenue share</th><th>Applies to</th><th>Status</th></tr></thead>
          <tbody>
            {rows.map(p => (
              <>
                <tr key={p.id}>
                  <td>
                    <button className="btn" onClick={() => setOpenId(openId === p.id ? null : p.id)}>
                      {openId === p.id ? '▾' : '▸'}
                    </button>
                  </td>
                  <td><strong>{p.name}</strong></td>
                  <td>{p.partner_email ?? '-'}</td>
                  <td><code>{p.referral_code}</code></td>
                  <td>
                    <select defaultValue={p.commission_type} onChange={e => patchPartner(p, { commissionType: e.target.value })}>
                      <option value="percent">percent</option>
                      <option value="flat">flat</option>
                    </select>
                  </td>
                  <td>
                    {p.commission_type === 'percent'
                      ? <input defaultValue={p.revenue_share_pct ?? ''} type="number" style={{ width: 70 }}
                          onBlur={e => patchPartner(p, { revenueSharePct: e.target.value === '' ? null : Number(e.target.value) })} />
                      : <input defaultValue={p.flat_fee_cents != null ? (p.flat_fee_cents / 100) : ''} type="number" style={{ width: 80 }}
                          onBlur={e => patchPartner(p, { flatFeeCents: e.target.value === '' ? null : Math.round(Number(e.target.value) * 100) })} />}
                  </td>
                  <td>
                    <input defaultValue={p.applies_to ?? ''} style={{ width: 110 }}
                      onBlur={e => patchPartner(p, { appliesTo: e.target.value })} placeholder="subscription" />
                  </td>
                  <td><button className={'btn' + (p.status === 'active' ? ' primary' : '')} onClick={() => toggle(p)}>{p.status === 'active' ? 'Active' : 'Disabled'}</button></td>
                </tr>
                {openId === p.id && (
                  <tr key={p.id + '-rev'}>
                    <td colSpan={8} style={{ background: 'rgba(0,0,0,0.02)' }}>
                      <PartnerRevenuePanel partnerId={p.id} />
                    </td>
                  </tr>
                )}
              </>
            ))}
            {!rows.length && <tr><td colSpan={8} className="note">No referral partners yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}

function PartnerRevenuePanel({ partnerId }: { partnerId: string }) {
  const [view, setView] = useState<PartnerRevView | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  // add-commission form
  const [source, setSource] = useState('subscription');
  const [gross, setGross] = useState('');
  const [platformFee, setPlatformFee] = useState('');
  const [processingCost, setProcessingCost] = useState('');

  // compute-payout form
  const [period, setPeriod] = useState(new Date().toISOString().slice(0, 7)); // YYYY-MM

  async function load() {
    try { setView(await getPartnerRev(partnerId)); }
    catch (e: any) { setErr(e.message ?? 'Could not load revenue.'); }
  }
  useEffect(() => { load(); }, [partnerId]);

  async function addCommission() {
    setBusy(true); setErr('');
    try {
      await addPartnerCommission(partnerId, {
        source,
        grossCents: gross === '' ? 0 : Math.round(Number(gross) * 100),
        platformFeeCents: platformFee === '' ? 0 : Math.round(Number(platformFee) * 100),
        processingCostCents: processingCost === '' ? 0 : Math.round(Number(processingCost) * 100),
      });
      setGross(''); setPlatformFee(''); setProcessingCost('');
      await load();
    } catch (e: any) { setErr(e.message ?? 'Could not add commission.'); }
    finally { setBusy(false); }
  }

  async function setCommissionStatus(c: PartnerCommission, status: string) {
    try { await patchPartnerCommission(c.id, { status }); await load(); }
    catch (e: any) { setErr(e.message ?? 'Could not update.'); }
  }
  async function toggleExcluded(c: PartnerCommission) {
    try { await patchPartnerCommission(c.id, { excluded: !c.excluded }); await load(); }
    catch (e: any) { setErr(e.message ?? 'Could not update.'); }
  }

  async function compute() {
    setBusy(true); setErr('');
    try { await computePartnerPayout(partnerId, period); await load(); }
    catch (e: any) { setErr(e.message ?? 'Could not compute payout.'); }
    finally { setBusy(false); }
  }
  async function setPayoutStatus(p: PartnerPayout, status: string) {
    try { await patchPartnerPayout(p.id, { status }); await load(); }
    catch (e: any) { setErr(e.message ?? 'Could not update.'); }
  }
  async function setAdjustment(p: PartnerPayout, dollars: string) {
    try { await patchPartnerPayout(p.id, { manual_adjustment_cents: dollars === '' ? 0 : Math.round(Number(dollars) * 100) }); await load(); }
    catch (e: any) { setErr(e.message ?? 'Could not update.'); }
  }
  async function setPaid(p: PartnerPayout, dollars: string) {
    try { await patchPartnerPayout(p.id, { commission_paid_cents: dollars === '' ? 0 : Math.round(Number(dollars) * 100) }); await load(); }
    catch (e: any) { setErr(e.message ?? 'Could not update.'); }
  }

  if (!view) return <div className="note" style={{ padding: 12 }}>{err || 'Loading revenue...'}</div>;
  const t = view.totals;

  return (
    <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 14 }}>
      {err && <div className="err">{err}</div>}

      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
        <div><div className="note">Net profit</div><strong>{money(t.netProfitCents)}</strong></div>
        <div><div className="note">Commission earned</div><strong>{money(t.commissionCents)}</strong></div>
        <div><div className="note">Pending</div><strong>{money(t.pendingCommissionCents)}</strong></div>
        <div><div className="note">Paid (commissions)</div><strong>{money(t.paidCommissionCents)}</strong></div>
        <div><div className="note">Payout owed</div><strong>{money(t.payoutOwedCents)}</strong></div>
        <div><div className="note">Payout paid</div><strong>{money(t.payoutPaidCents)}</strong></div>
      </div>

      {/* Add a commission (profit-based) */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div><label className="note">Source</label>
          <select value={source} onChange={e => setSource(e.target.value)}>
            {SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div><label className="note">Gross ($)</label><input value={gross} onChange={e => setGross(e.target.value)} type="number" style={{ width: 110 }} placeholder="100000" /></div>
        <div><label className="note">Platform fee ($)</label><input value={platformFee} onChange={e => setPlatformFee(e.target.value)} type="number" style={{ width: 110 }} placeholder="2500" /></div>
        <div><label className="note">Processing cost ($)</label><input value={processingCost} onChange={e => setProcessingCost(e.target.value)} type="number" style={{ width: 120 }} placeholder="600" /></div>
        <button className="btn primary" disabled={busy} onClick={addCommission}>Add commission</button>
      </div>

      {/* Commission ledger */}
      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead><tr><th>Date</th><th>Source</th><th>Gross</th><th>Platform fee</th><th>Proc. cost</th><th>Net profit</th><th>Commission</th><th>Status</th><th>Excl?</th></tr></thead>
          <tbody>
            {view.commissions.map(c => (
              <tr key={c.id} style={c.excluded ? { opacity: 0.5 } : undefined}>
                <td>{new Date(c.created_at).toLocaleDateString()}</td>
                <td>{c.source}</td>
                <td>{money(c.gross_cents)}</td>
                <td>{money(c.platform_fee_cents)}</td>
                <td>{money(c.processing_cost_cents)}</td>
                <td>{money(c.net_profit_cents)}</td>
                <td><strong>{money(c.commission_cents)}</strong></td>
                <td>
                  <select value={c.status} onChange={e => setCommissionStatus(c, e.target.value)}>
                    {COMMISSION_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </td>
                <td><button className={'btn' + (c.excluded ? ' primary' : '')} onClick={() => toggleExcluded(c)}>{c.excluded ? 'Excluded' : 'Include'}</button></td>
              </tr>
            ))}
            {!view.commissions.length && <tr><td colSpan={9} className="note">No commissions yet.</td></tr>}
          </tbody>
        </table>
      </div>

      {/* Compute payout */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div><label className="note">Period (YYYY-MM or YYYY-MM-DD)</label><input value={period} onChange={e => setPeriod(e.target.value)} placeholder="2026-06" style={{ width: 160 }} /></div>
        <button className="btn primary" disabled={busy} onClick={compute}>Compute payout for period</button>
      </div>

      {/* Payout list */}
      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead><tr><th>Period</th><th>Net profit</th><th>Commission %</th><th>Owed</th><th>Manual adj.</th><th>Paid</th><th>Status</th></tr></thead>
          <tbody>
            {view.payouts.map(p => (
              <tr key={p.id}>
                <td><strong>{p.period}</strong></td>
                <td>{money(p.net_profit_cents)}</td>
                <td>{p.commission_pct != null ? `${p.commission_pct}%` : '-'}</td>
                <td><strong>{money(p.commission_owed_cents)}</strong></td>
                <td><input defaultValue={p.manual_adjustment_cents ? (p.manual_adjustment_cents / 100) : ''} type="number" style={{ width: 90 }} onBlur={e => setAdjustment(p, e.target.value)} /></td>
                <td><input defaultValue={p.commission_paid_cents ? (p.commission_paid_cents / 100) : ''} type="number" style={{ width: 90 }} onBlur={e => setPaid(p, e.target.value)} /></td>
                <td>
                  <select value={p.status} onChange={e => setPayoutStatus(p, e.target.value)}>
                    {PAYOUT_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </td>
              </tr>
            ))}
            {!view.payouts.length && <tr><td colSpan={7} className="note">No payouts computed yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
