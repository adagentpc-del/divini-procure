import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import OnboardingChecklist from '../components/OnboardingChecklist';
import { useToast } from '../lib/toast';
import {
  getBuildings, getOpenPackages, getMyBids, getVendorProfile,
  listEngagements, createEngagement, updateEngagement,
  type Engagement,
} from '../lib/db';
import { apiGet, apiSend } from '../lib/api';
import {
  getBidCredits, getVerification, subscribeToTier, buyFeatured,
  bidsLeftLabel, verificationLabel, verificationBadgeClass,
  VENDOR_PRO_TIER_KEY, VENDOR_PRO_PRICE_LABEL,
  SUCCESS_FEE_PCT, SUCCESS_FEE_CAP_LABEL,
  type BidCredits, type Verification,
} from '../lib/monetization';

const STATUSES = ['active', 'pending', 'won', 'on hold', 'completed', 'lost'];

function money(cents?: number | null) {
  if (cents === null || cents === undefined) return '-';
  return `$${(Number(cents) / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function CurrentWork() {
  const { toast } = useToast();
  const [rows, setRows] = useState<Engagement[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ title: '', type: '', counterparty: '', value: '', location: '' });

  async function load() {
    try {
      setRows(await listEngagements());
    } catch (e: any) { setErr(e.message ?? 'Could not load engagements.'); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function add() {
    if (!form.title.trim()) return;
    setBusy(true); setErr('');
    try {
      await createEngagement({
        title: form.title.trim(),
        type: form.type.trim() || undefined,
        counterparty: form.counterparty.trim() || undefined,
        valueCents: form.value ? Math.round(Number(form.value) * 100) : undefined,
        location: form.location.trim() || undefined,
      });
      setForm({ title: '', type: '', counterparty: '', value: '', location: '' });
      setOpen(false);
      await load();
      toast('Engagement added.', 'success');
    } catch (e: any) {
      setErr(e.message ?? 'Could not add.');
      toast(e.message ?? 'Could not add.', 'error');
    }
    finally { setBusy(false); }
  }

  async function changeStatus(id: string, status: string) {
    try {
      const updated = await updateEngagement(id, { status });
      setRows(rs => rs.map(r => (r.id === id ? updated : r)));
      toast('Status updated.', 'success');
    } catch (e: any) {
      setErr(e.message ?? 'Could not update.');
      toast(e.message ?? 'Could not update.', 'error');
    }
  }

  return (
    <>
      <div className="page-head" style={{ marginTop: 24 }}>
        <div>
          <div className="sectitle" style={{ margin: 0 }}>What you have going on</div>
          <div className="sub">Log and track the work you already have in flight.</div>
        </div>
        <button className="btn" onClick={() => setOpen(o => !o)}>{open ? 'Cancel' : '+ Add'}</button>
      </div>

      {err && <div className="err">{err}</div>}

      {open && (
        <div className="card" style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div style={{ flex: '1 1 200px' }}>
              <label className="note">Title</label>
              <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="e.g. Tower B facade package" />
            </div>
            <div>
              <label className="note">Type</label>
              <input value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))} placeholder="project, deal, contract" />
            </div>
            <div>
              <label className="note">Counterparty</label>
              <input value={form.counterparty} onChange={e => setForm(f => ({ ...f, counterparty: e.target.value }))} placeholder="who" />
            </div>
            <div>
              <label className="note">Value ($)</label>
              <input value={form.value} onChange={e => setForm(f => ({ ...f, value: e.target.value }))} placeholder="0" inputMode="decimal" />
            </div>
            <div>
              <label className="note">Location</label>
              <input value={form.location} onChange={e => setForm(f => ({ ...f, location: e.target.value }))} placeholder="city / region" />
            </div>
            <button className="btn primary" disabled={busy || !form.title.trim()} onClick={add}>Save</button>
          </div>
        </div>
      )}

      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead><tr><th>Title</th><th>Type</th><th>Status</th><th>Counterparty</th><th>Value</th><th>Location</th></tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id}>
                <td><strong>{r.title}</strong></td>
                <td>{r.type ?? '-'}</td>
                <td>
                  <select value={r.status ?? 'active'} onChange={e => changeStatus(r.id, e.target.value)}>
                    {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                    {r.status && !STATUSES.includes(r.status) && <option value={r.status}>{r.status}</option>}
                  </select>
                </td>
                <td>{r.counterparty ?? '-'}</td>
                <td>{money(r.value_cents)}</td>
                <td>{r.location ?? '-'}</td>
              </tr>
            ))}
            {!loading && !rows.length && <tr><td colSpan={6} className="note">Nothing logged yet. Use + Add to track current work.</td></tr>}
            {loading && <tr><td colSpan={6} className="note">Loading…</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}

// Success-fee summary for a vendor (owed / paid). Tolerant of a missing endpoint.
type FeeSummary = { owedCents?: number; paidCents?: number };

function VendorMonetizationTiles() {
  const nav = useNavigate();
  const [credits, setCredits] = useState<BidCredits | null>(null);
  const [verif, setVerif] = useState<Verification | null>(null);
  const [fees, setFees] = useState<FeeSummary | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [upgrading, setUpgrading] = useState(false);
  const [featuring, setFeaturing] = useState(false);
  const [msg, setMsg] = useState('');

  async function load() {
    const [c, v] = await Promise.all([getBidCredits(), getVerification()]);
    setCredits(c);
    setVerif(v);
    try {
      const f = await apiGet<FeeSummary>('/me/success-fees');
      if (f && (typeof f.owedCents === 'number' || typeof f.paidCents === 'number')) setFees(f);
    } catch { /* non-blocking */ }
    setLoaded(true);
  }
  useEffect(() => { load(); }, []);

  async function upgrade() {
    setUpgrading(true); setMsg('');
    try { await subscribeToTier(VENDOR_PRO_TIER_KEY); setMsg('You are on Vendor Pro. Bidding is unlimited.'); await load(); }
    catch (e: any) { setMsg(e?.message ?? 'Could not start your upgrade.'); }
    finally { setUpgrading(false); }
  }
  async function feature() {
    setFeaturing(true); setMsg('');
    try { await buyFeatured(); setMsg('Featured placement requested.'); }
    catch (e: any) { setMsg(e?.message ?? 'Could not buy featured placement.'); }
    finally { setFeaturing(false); }
  }

  // V2 not active for this user: render nothing (legacy dashboard unchanged).
  if (loaded && !credits && !verif) return null;

  const isPro = !!credits?.unlimited;
  const expiringSoon = (verif?.expiring?.length ?? 0) > 0;
  const money = (cents?: number) =>
    cents == null ? '$0' : `$${(cents / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

  return (
    <>
      <div className="sectitle">Your account</div>
      <div className="grid cards3 kpi">
        {/* Verification status */}
        <div className="card metric">
          <div className="k">Verification</div>
          <div className="v" style={{ fontSize: 20 }}>
            <span className={`badge ${verificationBadgeClass(verif)}`}>{verificationLabel(verif)}</span>
          </div>
          <div className="d">
            {expiringSoon
              ? <span style={{ color: 'var(--amber)', fontWeight: 600 }}>Expiring soon: {verif!.expiring.join(', ')}</span>
              : verif?.missing?.length
                ? `Needed: ${verif.missing.join(', ')}`
                : 'Required to bid and contact developers'}
          </div>
          {(verif?.status !== 'verified' && verif?.status !== 'approved' || expiringSoon) && (
            <div style={{ marginTop: 8 }}>
              <a style={{ cursor: 'pointer', color: 'var(--emerald)', fontWeight: 600, fontSize: 13 }} onClick={() => nav('/profile')}>
                Manage credentials
              </a>
            </div>
          )}
        </div>

        {/* Bids remaining this quarter */}
        <div className="card metric">
          <div className="k">Bids this quarter</div>
          <div className="v">{isPro ? '∞' : (credits?.remaining ?? 0)}</div>
          <div className="d">{isPro ? 'Unlimited (Pro)' : bidsLeftLabel(credits) || 'remaining'}</div>
        </div>

        {/* Success fees */}
        <div className="card metric">
          <div className="k">Success fees</div>
          <div className="v" style={{ fontSize: 22 }}>{money(fees?.owedCents)}</div>
          <div className="d">owed · {money(fees?.paidCents)} paid · {SUCCESS_FEE_PCT}% capped {SUCCESS_FEE_CAP_LABEL}</div>
        </div>
      </div>

      {/* Upsell cards */}
      <div className="grid cards3 kpi" style={{ marginTop: 6 }}>
        {!isPro && (
          <div className="card">
            <div style={{ fontWeight: 700, marginBottom: 4 }}>Vendor Pro · {VENDOR_PRO_PRICE_LABEL}</div>
            <div className="note" style={{ marginBottom: 10, lineHeight: 1.6 }}>
              Unlimited bids every quarter. No more 5-bid cap.
            </div>
            <button className="btn primary" onClick={upgrade} disabled={upgrading}>
              {upgrading ? 'Starting…' : `Upgrade to Pro - ${VENDOR_PRO_PRICE_LABEL}`}
            </button>
          </div>
        )}
        <div className="card">
          <div style={{ fontWeight: 700, marginBottom: 4 }}>Featured placement</div>
          <div className="note" style={{ marginBottom: 10, lineHeight: 1.6 }}>
            Get your company surfaced to developers in the marketplace.
          </div>
          <button className="btn" onClick={feature} disabled={featuring}>
            {featuring ? 'Working…' : 'Get featured'}
          </button>
        </div>
        {isPro && (
          <div className="card">
            <div style={{ fontWeight: 700, marginBottom: 4 }}>You are on Vendor Pro</div>
            <div className="note" style={{ lineHeight: 1.6 }}>Unlimited bidding is active. Thank you.</div>
          </div>
        )}
      </div>
      {msg && <div className="note" style={{ marginTop: 8 }}>{msg}</div>}
    </>
  );
}

type VerifiedVendorStats = { verifiedVendors?: number; pendingVendors?: number; expiringVendors?: number };

function DeveloperVendorTiles({ companyId }: { companyId: string }) {
  const [stats, setStats] = useState<VerifiedVendorStats | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [savingPref, setSavingPref] = useState(false);

  async function load() {
    try {
      const s = await apiGet<VerifiedVendorStats & { verifiedVendorsOnly?: boolean }>(
        `/me/vendor-verification-overview?companyId=${encodeURIComponent(companyId)}`,
      );
      if (s && typeof s.verifiedVendors === 'number') {
        setStats(s);
        if (typeof s.verifiedVendorsOnly === 'boolean') setVerifiedOnly(s.verifiedVendorsOnly);
      }
    } catch { /* non-blocking */ }
    setLoaded(true);
  }
  useEffect(() => { load(); }, [companyId]);

  async function toggleVerifiedOnly(next: boolean) {
    setVerifiedOnly(next);
    setSavingPref(true);
    try {
      await apiSend('PATCH', '/me/rfp-preferences', { companyId, verifiedVendorsOnly: next });
    } catch { /* non-blocking: keep optimistic state */ }
    finally { setSavingPref(false); }
  }

  // V2 not active for this developer: render nothing.
  if (loaded && !stats) return null;

  return (
    <>
      <div className="sectitle">Vendor credentials</div>
      <div className="grid cards3 kpi">
        <div className="card metric">
          <div className="k">Verified vendors</div>
          <div className="v">{stats?.verifiedVendors ?? '-'}</div>
          <div className="d">credentials on file</div>
        </div>
        <div className="card metric">
          <div className="k">Pending review</div>
          <div className="v">{stats?.pendingVendors ?? 0}</div>
          <div className="d">awaiting verification</div>
        </div>
        <div className="card metric">
          <div className="k">Expiring soon</div>
          <div className="v" style={{ color: (stats?.expiringVendors ?? 0) > 0 ? 'var(--amber)' : undefined }}>
            {stats?.expiringVendors ?? 0}
          </div>
          <div className="d">credentials lapsing</div>
        </div>
      </div>
      <div className="card" style={{ marginTop: 6 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 14 }}>
          <input
            type="checkbox"
            checked={verifiedOnly}
            disabled={savingPref}
            onChange={(e) => toggleVerifiedOnly(e.target.checked)}
          />
          <span>
            <strong>Verified vendors only</strong>
            <span className="note" style={{ display: 'block' }}>
              When on, only verified vendors can see and bid on your RFPs.
            </span>
          </span>
        </label>
      </div>
    </>
  );
}

export default function Dashboard() {
  const { company } = useAuth();
  const nav = useNavigate();
  const [stats, setStats] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!company) return;
    (async () => {
      if (company.kind === 'buyer') {
        const b = await getBuildings(company.id);
        setStats({ projects: b.length });
      } else {
        const prof = await getVendorProfile(company.id);
        const open = await getOpenPackages({ categories: prof?.services ?? [] });
        const bids = await getMyBids(company.id);
        setStats({ matched: open.length, bids: bids.length });
      }
      setLoading(false);
    })();
  }, [company]);

  if (!company) return null;
  const isBuyer = company.kind === 'buyer';
  const isVendor = company.kind === 'vendor';
  const isInvestor = company.kind === 'investor';

  const subLabel = isInvestor
    ? 'Your investment dashboard'
    : isBuyer
    ? 'Your procurement command center'
    : 'Your vendor workspace';

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Welcome, {company.name}</h1>
          <div className="sub">{subLabel}</div>
        </div>
        {isBuyer && <button className="btn primary" onClick={() => nav('/projects')}>+ Post a Project</button>}
        {isVendor && <button className="btn primary" onClick={() => nav('/search')}>Find bids</button>}
        {isInvestor && <button className="btn primary" onClick={() => nav('/app/deals')}>Browse deals</button>}
      </div>

      <OnboardingChecklist />

      <div className="grid cards3 kpi">
        {isBuyer ? (
          <>
            <div className="card metric"><div className="k">Active projects</div><div className="v">{loading ? '-' : stats.projects ?? 0}</div><div className="d">buildings</div></div>
            <div className="card metric"><div className="k">Open packages</div><div className="v">-</div><div className="d">across projects</div></div>
            <div className="card metric"><div className="k">Plan</div><div className="v" style={{ fontSize: 20 }}>Free</div><div className="d">beta</div></div>
          </>
        ) : (
          <>
            <div className="card metric"><div className="k">Bids matched to you</div><div className="v">{loading ? '-' : stats.matched ?? 0}</div><div className="d">open packages</div></div>
            <div className="card metric"><div className="k">My bids</div><div className="v">{loading ? '-' : stats.bids ?? 0}</div><div className="d">submitted</div></div>
            <div className="card metric"><div className="k">Plan</div><div className="v" style={{ fontSize: 20 }}>$100/mo</div><div className="d">first 2 mo 50% off</div></div>
          </>
        )}
      </div>

      {isBuyer
        ? <DeveloperVendorTiles companyId={company.id} />
        : <VendorMonetizationTiles />}

      <div className="sectitle">Getting started</div>
      <div className="card">
        <p className="note" style={{ margin: 0, lineHeight: 1.6 }}>
          {isBuyer
            ? 'Post a project to start receiving bids from verified vendors. Compare side by side, award, and pay by ACH or wire.'
            : 'Join and browse for free. Get verified to unlock bidding and to contact developers. Free vendors get 5 bids per quarter; Vendor Pro is unlimited.'}
        </p>
      </div>

      <CurrentWork />
    </>
  );
}
