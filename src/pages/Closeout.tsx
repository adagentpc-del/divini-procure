import { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth';
import { useToast } from '../lib/toast';
import { apiGet, apiSend } from '../lib/api';
import { getBuildings, getPackages } from '../lib/db';

/**
 * Project closeout: final punch list + warranty tracking (fresh
 * competitive scan, 2026-08-17 - docs/competitive-analysis-2026-08.md gap
 * #17). Talks to server/src/routes/closeout.ts. Distinct from the purely
 * financial closeout checklist in AwardWorkflow.tsx and from
 * DeliveryTracking.tsx's per-delivery punch items. Bidirectional, same
 * dual-role shape as Rfi.tsx: the developer raises punch items/claims and
 * sets warranty terms; the vendor resolves items and works claims.
 */

type PkgOption = { package_id: string; building_id: string; building_name: string; category: string | null; has_active_award?: boolean };
type PunchItem = {
  id: string; description: string; status: 'open' | 'resolved' | 'verified';
  raised_by_email: string | null; resolved_by_email: string | null; resolved_at: string | null;
  verified_by_email: string | null; verified_at: string | null; created_at: string;
};
type WarrantyClaim = {
  id: string; description: string; status: 'open' | 'in_progress' | 'resolved' | 'denied';
  filed_by_email: string | null; resolution_notes: string | null;
  resolved_by_email: string | null; resolved_at: string | null; created_at: string;
};
type PackageWarranty = {
  id: string; warranty_start_date: string | null; warranty_months: number | null; warranty_terms: string | null;
  warranty_set_by: string | null; warranty_set_at: string | null;
  financially_closed_at: string | null; final_cost_cents: number | null;
};

const PUNCH_CLS: Record<string, string> = { open: 'badge b-amber', resolved: 'badge b-green', verified: 'badge b-neutral' };
const CLAIM_CLS: Record<string, string> = { open: 'badge b-amber', in_progress: 'badge b-amber', resolved: 'badge b-green', denied: 'badge b-red' };

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function fmtDateOnly(d: string): string {
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function warrantyEndLabel(startDate: string | null, months: number | null): string | null {
  if (!startDate || !months) return null;
  const d = new Date(startDate + 'T00:00:00');
  d.setMonth(d.getMonth() + months);
  const expired = d.getTime() < Date.now();
  return `${fmtDateOnly(d.toISOString().slice(0, 10))}${expired ? ' (expired)' : ''}`;
}

export default function Closeout() {
  const { company } = useAuth();
  const { toast } = useToast();
  const isVendor = company?.kind === 'vendor';

  const [buildings, setBuildings] = useState<any[]>([]);
  const [buildingId, setBuildingId] = useState('');
  const [devPackages, setDevPackages] = useState<any[]>([]);
  const [vendorPackages, setVendorPackages] = useState<PkgOption[]>([]);
  const [packageId, setPackageId] = useState('');
  const [loadingPackages, setLoadingPackages] = useState(true);

  const [pkg, setPkg] = useState<PackageWarranty | null>(null);
  const [punchItems, setPunchItems] = useState<PunchItem[]>([]);
  const [claims, setClaims] = useState<WarrantyClaim[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  // developer: warranty form
  const [wStart, setWStart] = useState('');
  const [wMonths, setWMonths] = useState('');
  const [wTerms, setWTerms] = useState('');
  const [savingWarranty, setSavingWarranty] = useState(false);

  // developer: new punch item / claim
  const [newPunch, setNewPunch] = useState('');
  const [newClaim, setNewClaim] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!company) return;
    setLoadingPackages(true);
    if (isVendor) {
      apiGet<{ packages: PkgOption[] }>(`/closeout/my-packages?companyId=${encodeURIComponent(company.id)}`)
        .then((d) => {
          const ps = d.packages ?? [];
          setVendorPackages(ps);
          if (ps.length === 1) setPackageId(ps[0].package_id);
        })
        .catch((e: any) => setErr(e.message ?? 'Could not load your packages.'))
        .finally(() => setLoadingPackages(false));
    } else {
      getBuildings(company.id)
        .then((bs: any) => {
          setBuildings(bs ?? []);
          if (bs && bs.length === 1) setBuildingId(bs[0].id);
        })
        .catch((e: any) => setErr(e.message ?? 'Could not load projects.'))
        .finally(() => setLoadingPackages(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [company]);

  useEffect(() => {
    if (isVendor || !buildingId) { setDevPackages([]); return; }
    getPackages(buildingId).then((ps: any) => setDevPackages(ps ?? [])).catch(() => setDevPackages([]));
    setPackageId('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildingId]);

  async function load() {
    if (!packageId) { setPkg(null); setPunchItems([]); setClaims([]); return; }
    setLoading(true); setErr('');
    try {
      const d = await apiGet<{ package: PackageWarranty; punchItems: PunchItem[]; warrantyClaims: WarrantyClaim[] }>(
        `/packages/${encodeURIComponent(packageId)}/closeout`,
      );
      setPkg(d.package);
      setPunchItems(d.punchItems ?? []);
      setClaims(d.warrantyClaims ?? []);
      setWStart(d.package?.warranty_start_date ?? '');
      setWMonths(d.package?.warranty_months != null ? String(d.package.warranty_months) : '');
      setWTerms(d.package?.warranty_terms ?? '');
    } catch (e: any) {
      setErr(e.message ?? 'Could not load closeout.');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [packageId]);

  async function saveWarranty(e: React.FormEvent) {
    e.preventDefault();
    if (!packageId) return;
    setSavingWarranty(true); setErr('');
    try {
      await apiSend('PATCH', `/packages/${encodeURIComponent(packageId)}/warranty`, {
        startDate: wStart || undefined,
        months: wMonths ? Number(wMonths) : undefined,
        terms: wTerms || undefined,
      });
      toast('Warranty terms saved.', 'success');
      await load();
    } catch (e: any) {
      setErr(e.message ?? 'Could not save warranty terms.');
    } finally {
      setSavingWarranty(false);
    }
  }

  async function addPunchItem(e: React.FormEvent) {
    e.preventDefault();
    if (!packageId || !newPunch.trim()) return;
    setBusy(true); setErr('');
    try {
      await apiSend('POST', `/packages/${encodeURIComponent(packageId)}/punch-items`, { description: newPunch.trim() });
      setNewPunch('');
      toast('Punch item added.', 'success');
      await load();
    } catch (e: any) {
      setErr(e.message ?? 'Could not add punch item.');
    } finally {
      setBusy(false);
    }
  }

  async function updatePunchItem(id: string, status: string) {
    setBusy(true); setErr('');
    try {
      await apiSend('PATCH', `/closeout/punch-items/${id}`, { status });
      await load();
    } catch (e: any) {
      setErr(e.message ?? 'Could not update the punch item.');
    } finally {
      setBusy(false);
    }
  }

  async function addClaim(e: React.FormEvent) {
    e.preventDefault();
    if (!packageId || !newClaim.trim()) return;
    setBusy(true); setErr('');
    try {
      await apiSend('POST', `/packages/${encodeURIComponent(packageId)}/warranty-claims`, { description: newClaim.trim() });
      setNewClaim('');
      toast('Warranty claim filed.', 'success');
      await load();
    } catch (e: any) {
      setErr(e.message ?? 'Could not file the claim.');
    } finally {
      setBusy(false);
    }
  }

  async function updateClaim(id: string, status: string) {
    setBusy(true); setErr('');
    try {
      await apiSend('PATCH', `/closeout/warranty-claims/${id}`, { status });
      await load();
    } catch (e: any) {
      setErr(e.message ?? 'Could not update the claim.');
    } finally {
      setBusy(false);
    }
  }

  if (!company) return null;

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Closeout</h1>
          <div className="sub">Final punch list and warranty tracking, per package.</div>
        </div>
      </div>

      {!isVendor && (
        <div className="field" style={{ maxWidth: 340 }}>
          <label>Project</label>
          <select value={buildingId} onChange={(e) => setBuildingId(e.target.value)}>
            <option value="">Select a project…</option>
            {buildings.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
      )}
      {!isVendor && buildingId && (
        <div className="field" style={{ maxWidth: 340 }}>
          <label>Package</label>
          <select value={packageId} onChange={(e) => setPackageId(e.target.value)}>
            <option value="">Select a package…</option>
            {devPackages.map((p: any) => <option key={p.id} value={p.id}>{p.category || p.name || p.id}</option>)}
          </select>
        </div>
      )}
      {isVendor && (
        <div className="field" style={{ maxWidth: 340 }}>
          <label>Package</label>
          <select value={packageId} onChange={(e) => setPackageId(e.target.value)}>
            <option value="">Select a package…</option>
            {vendorPackages.map((p) => (
              <option key={p.package_id} value={p.package_id}>{p.building_name} - {p.category || p.package_id}</option>
            ))}
          </select>
          {!loadingPackages && vendorPackages.length === 0 && <div className="note">No awarded packages yet.</div>}
        </div>
      )}

      {err && <div className="err">{err}</div>}

      {packageId && (
        <>
          {loading && <div className="note">Loading…</div>}

          {!loading && pkg && (
            <>
              <div className="sectitle">Warranty</div>
              <div className="card" style={{ marginBottom: 16 }}>
                {pkg.warranty_start_date && pkg.warranty_months ? (
                  <div className="note" style={{ marginBottom: 10 }}>
                    Starts {fmtDateOnly(pkg.warranty_start_date)} · {pkg.warranty_months} months ·
                    {' '}expires {warrantyEndLabel(pkg.warranty_start_date, pkg.warranty_months)}
                    {pkg.warranty_terms ? <div style={{ marginTop: 4 }}>{pkg.warranty_terms}</div> : null}
                  </div>
                ) : (
                  <div className="note" style={{ marginBottom: 10 }}>No warranty terms set yet.</div>
                )}
                {!isVendor && (
                  <form onSubmit={saveWarranty}>
                    <div className="two">
                      <div className="field">
                        <label>Start date</label>
                        <input type="date" value={wStart} onChange={(e) => setWStart(e.target.value)} />
                      </div>
                      <div className="field">
                        <label>Length (months)</label>
                        <input type="number" min="0" value={wMonths} onChange={(e) => setWMonths(e.target.value)} placeholder="e.g. 12" />
                      </div>
                    </div>
                    <div className="field">
                      <label>Terms (optional)</label>
                      <textarea rows={2} value={wTerms} onChange={(e) => setWTerms(e.target.value)} placeholder="What's covered" />
                    </div>
                    <button type="submit" className="btn primary" disabled={savingWarranty}>
                      {savingWarranty ? 'Saving…' : 'Save warranty terms'}
                    </button>
                  </form>
                )}
              </div>
            </>
          )}

          {!loading && (
            <>
              <div className="sectitle">Final punch list ({punchItems.filter((p) => p.status !== 'verified').length} open)</div>
              {!isVendor && (
                <div className="card" style={{ marginBottom: 12 }}>
                  <form onSubmit={addPunchItem}>
                    <div className="field">
                      <label>New punch item</label>
                      <input value={newPunch} onChange={(e) => setNewPunch(e.target.value)} placeholder="e.g. Touch up paint in stairwell B" />
                    </div>
                    <button type="submit" className="btn primary" disabled={busy || !newPunch.trim()}>Add item</button>
                  </form>
                </div>
              )}
              {punchItems.length === 0 && <div className="note">No punch items yet.</div>}
              {punchItems.map((item) => (
                <div key={item.id} className="card" style={{ marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                  <div>
                    <div>{item.description}</div>
                    <div className="note">
                      Raised {fmtDate(item.created_at)}
                      {item.resolved_at ? ` · resolved ${fmtDate(item.resolved_at)}` : ''}
                      {item.verified_at ? ` · verified ${fmtDate(item.verified_at)}` : ''}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className={PUNCH_CLS[item.status]}>{item.status}</span>
                    {isVendor && item.status === 'open' && (
                      <button className="btn" disabled={busy} onClick={() => updatePunchItem(item.id, 'resolved')}>Mark resolved</button>
                    )}
                    {!isVendor && item.status === 'resolved' && (
                      <button className="btn primary" disabled={busy} onClick={() => updatePunchItem(item.id, 'verified')}>Verify</button>
                    )}
                    {!isVendor && item.status !== 'open' && (
                      <button className="btn" disabled={busy} onClick={() => updatePunchItem(item.id, 'open')}>Reopen</button>
                    )}
                  </div>
                </div>
              ))}

              <div className="sectitle" style={{ marginTop: 18 }}>Warranty claims</div>
              {!isVendor && (
                <div className="card" style={{ marginBottom: 12 }}>
                  <form onSubmit={addClaim}>
                    <div className="field">
                      <label>New warranty claim</label>
                      <input value={newClaim} onChange={(e) => setNewClaim(e.target.value)} placeholder="e.g. Leak at the roof flashing installed under this package" />
                    </div>
                    <button type="submit" className="btn primary" disabled={busy || !newClaim.trim()}>File claim</button>
                  </form>
                </div>
              )}
              {claims.length === 0 && <div className="note">No warranty claims filed.</div>}
              {claims.map((c) => (
                <div key={c.id} className="card" style={{ marginBottom: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                    <div>
                      <div>{c.description}</div>
                      <div className="note">Filed {fmtDate(c.created_at)}{c.resolved_at ? ` · closed ${fmtDate(c.resolved_at)}` : ''}</div>
                      {c.resolution_notes && <div className="note" style={{ marginTop: 4 }}>{c.resolution_notes}</div>}
                    </div>
                    <span className={CLAIM_CLS[c.status]}>{c.status.replace('_', ' ')}</span>
                  </div>
                  {isVendor && c.status === 'open' && (
                    <button className="btn" style={{ marginTop: 8 }} disabled={busy} onClick={() => updateClaim(c.id, 'in_progress')}>Acknowledge / start work</button>
                  )}
                  {isVendor && (c.status === 'open' || c.status === 'in_progress') && (
                    <button className="btn primary" style={{ marginTop: 8, marginLeft: isVendor && c.status === 'open' ? 8 : 0 }} disabled={busy} onClick={() => updateClaim(c.id, 'resolved')}>Mark resolved</button>
                  )}
                  {!isVendor && (c.status === 'open' || c.status === 'in_progress') && (
                    <>
                      <button className="btn primary" style={{ marginTop: 8 }} disabled={busy} onClick={() => updateClaim(c.id, 'resolved')}>Mark resolved</button>
                      {' '}
                      <button className="btn" style={{ marginTop: 8 }} disabled={busy} onClick={() => updateClaim(c.id, 'denied')}>Deny</button>
                    </>
                  )}
                </div>
              ))}
            </>
          )}
        </>
      )}
    </div>
  );
}
