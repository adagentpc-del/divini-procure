/**
 * Divini Bid Studio - structured draft-build workflow for a vendor bid: line
 * items with optional upgrades, tax/discount/deposit, a payment schedule,
 * assumptions/exclusions/terms, an expiration date, versioned drafts, and
 * reusable templates. Extends the existing bids/bid_line_items tables rather
 * than replacing the simple submission path. Totals and readiness are always
 * shown with their breakdown (server/src/lib/bid-totals.ts) - never a bare
 * number, never a gate on submission beyond basic input validation.
 */
import { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth';
import { apiGet, apiSend } from '../lib/api';

type Draft = {
  id: string; package_id: string; vendor_company_id: string; status: string; is_draft: boolean;
  price: number | null; days: number | null; note: string | null; current_version: number;
  expires_at: string | null; deposit_cents: number | null; deposit_percent_basis_points: number | null;
  tax_cents: number | null; discount_cents: number | null; assumptions: string | null;
  exclusions: string[]; terms: string | null;
};
type LineItem = {
  id: string; name: string; description: string | null; category: string | null;
  qty: number; unit: string | null; unit_price: number; optional: boolean; selected: boolean; sort_order: number;
};
type Milestone = { id: string; label: string; percent_basis_points: number | null; amount_cents: number | null; due_event: string };
type Totals = { subtotalCents: number; taxCents: number; discountCents: number; totalCents: number; depositCents: number; includedLineItemCount: number };
type Readiness = { score: number; positives: string[]; missing: string[] };
type Version = { id: string; version_number: number; change_summary: string | null; created_at: string };
type Template = { id: string; name: string; category: string | null };

const money = (cents: number | null | undefined) =>
  cents == null ? '-' : `$${(Number(cents) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function BidStudio() {
  const { company } = useAuth();
  const companyId = company?.id;

  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [busy, setBusy] = useState(false);

  const [newPackageId, setNewPackageId] = useState('');
  const [showNew, setShowNew] = useState(false);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ draft: Draft; lineItems: LineItem[]; milestones: Milestone[]; versions: Version[]; totals: Totals; readiness: Readiness } | null>(null);

  const [liName, setLiName] = useState('');
  const [liQty, setLiQty] = useState('1');
  const [liUnitPrice, setLiUnitPrice] = useState('');
  const [liOptional, setLiOptional] = useState(false);

  const [msLabel, setMsLabel] = useState('');
  const [msPercent, setMsPercent] = useState('');
  const [msDueEvent, setMsDueEvent] = useState('milestone');

  async function loadList() {
    if (!companyId) return;
    setErr('');
    try {
      const [d, t] = await Promise.all([
        apiGet<{ drafts: Draft[] }>(`/bid-studio/drafts?companyId=${companyId}`),
        apiGet<{ templates: Template[] }>(`/bid-studio/templates?companyId=${companyId}`),
      ]);
      setDrafts(d.drafts);
      setTemplates(t.templates);
    } catch (e: any) {
      setErr(e.message ?? 'Could not load drafts.');
    }
  }

  useEffect(() => {
    void loadList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  async function loadDetail(id: string) {
    setErr('');
    try {
      const d = await apiGet<{ draft: Draft; lineItems: LineItem[]; milestones: Milestone[]; versions: Version[]; totals: Totals; readiness: Readiness }>(
        `/bid-studio/drafts/${id}`,
      );
      setDetail(d);
      setSelectedId(id);
      setDrafts((prev) => {
        const exists = prev.some((x) => x.id === id);
        return exists ? prev.map((x) => (x.id === id ? d.draft : x)) : [d.draft, ...prev];
      });
    } catch (e: any) {
      setErr(e.message ?? 'Could not load draft.');
    }
  }

  async function createDraft() {
    if (!companyId || !newPackageId.trim()) return;
    setBusy(true); setErr(''); setOk('');
    try {
      const created = await apiSend<{ draft: Draft }>('POST', '/bid-studio/drafts', { companyId, packageId: newPackageId.trim() });
      setNewPackageId(''); setShowNew(false);
      setOk('Draft created.');
      await loadDetail(created.draft.id);
    } catch (e: any) {
      setErr(e.message ?? 'Could not create draft.');
    } finally {
      setBusy(false);
    }
  }

  async function applyTemplate(templateId: string) {
    if (!newPackageId.trim()) { setErr('Enter a bid package ID first.'); return; }
    setBusy(true); setErr(''); setOk('');
    try {
      const created = await apiSend<{ draft: Draft }>('POST', `/bid-studio/templates/${templateId}/apply`, { packageId: newPackageId.trim() });
      setNewPackageId(''); setShowNew(false);
      setOk('Draft created from template.');
      await loadDetail(created.draft.id);
    } catch (e: any) {
      setErr(e.message ?? 'Could not apply template.');
    } finally {
      setBusy(false);
    }
  }

  async function saveDraftFields(patch: Partial<Record<string, unknown>>) {
    if (!detail) return;
    setBusy(true); setErr('');
    try {
      await apiSend('PATCH', `/bid-studio/drafts/${detail.draft.id}`, patch);
      await loadDetail(detail.draft.id);
    } catch (e: any) {
      setErr(e.message ?? 'Could not save.');
    } finally {
      setBusy(false);
    }
  }

  async function addLineItem() {
    if (!detail || !liName.trim() || !liUnitPrice) return;
    setBusy(true); setErr('');
    try {
      await apiSend('POST', `/bid-studio/drafts/${detail.draft.id}/line-items`, {
        name: liName.trim(),
        qty: Number(liQty) || 1,
        unitPrice: Number(liUnitPrice),
        optional: liOptional,
      });
      setLiName(''); setLiQty('1'); setLiUnitPrice(''); setLiOptional(false);
      await loadDetail(detail.draft.id);
    } catch (e: any) {
      setErr(e.message ?? 'Could not add line item.');
    } finally {
      setBusy(false);
    }
  }

  async function toggleSelected(li: LineItem) {
    setBusy(true); setErr('');
    try {
      await apiSend('PATCH', `/bid-studio/line-items/${li.id}`, { selected: !li.selected });
      if (detail) await loadDetail(detail.draft.id);
    } catch (e: any) {
      setErr(e.message ?? 'Could not update line item.');
    } finally {
      setBusy(false);
    }
  }

  async function removeLineItem(id: string) {
    setBusy(true); setErr('');
    try {
      await apiSend('DELETE', `/bid-studio/line-items/${id}`);
      if (detail) await loadDetail(detail.draft.id);
    } catch (e: any) {
      setErr(e.message ?? 'Could not remove line item.');
    } finally {
      setBusy(false);
    }
  }

  async function addMilestone() {
    if (!detail || !msLabel.trim()) return;
    setBusy(true); setErr('');
    try {
      await apiSend('POST', `/bid-studio/drafts/${detail.draft.id}/milestones`, {
        label: msLabel.trim(),
        percentBasisPoints: msPercent ? Math.round(Number(msPercent) * 100) : undefined,
        dueEvent: msDueEvent,
      });
      setMsLabel(''); setMsPercent('');
      await loadDetail(detail.draft.id);
    } catch (e: any) {
      setErr(e.message ?? 'Could not add milestone.');
    } finally {
      setBusy(false);
    }
  }

  async function saveVersion() {
    if (!detail) return;
    setBusy(true); setErr(''); setOk('');
    try {
      await apiSend('POST', `/bid-studio/drafts/${detail.draft.id}/save-version`, {});
      setOk('Version saved.');
      await loadDetail(detail.draft.id);
    } catch (e: any) {
      setErr(e.message ?? 'Could not save version.');
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    if (!detail) return;
    setBusy(true); setErr(''); setOk('');
    try {
      await apiSend('POST', `/bid-studio/drafts/${detail.draft.id}/submit`, {});
      setOk('Bid submitted.');
      await loadDetail(detail.draft.id);
    } catch (e: any) {
      setErr(e.message ?? 'Could not submit.');
    } finally {
      setBusy(false);
    }
  }

  async function saveAsTemplate() {
    if (!detail) return;
    const name = prompt('Template name:');
    if (!name) return;
    setBusy(true); setErr(''); setOk('');
    try {
      await apiSend('POST', `/bid-studio/drafts/${detail.draft.id}/save-as-template`, { name });
      setOk('Saved as template.');
      await loadList();
    } catch (e: any) {
      setErr(e.message ?? 'Could not save as template.');
    } finally {
      setBusy(false);
    }
  }

  if (!companyId) return <div className="card">Sign in to use Divini Bid Studio.</div>;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Divini Bid Studio</h1>
          <div className="sub">Build a structured bid: line items, optional upgrades, terms, and a payment schedule.</div>
        </div>
        <button className="btn primary" onClick={() => setShowNew((v) => !v)}>{showNew ? 'Cancel' : '+ New draft'}</button>
      </div>

      {err && <div className="err">{err}</div>}
      {ok && <div className="ok">{ok}</div>}

      {showNew && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="field"><label>Bid package ID</label><input value={newPackageId} onChange={(e) => setNewPackageId(e.target.value)} placeholder="the package you're bidding on" /></div>
          <button className="btn primary" disabled={busy || !newPackageId.trim()} onClick={createDraft} style={{ marginRight: 8 }}>Create blank draft</button>
          {templates.length > 0 && (
            <span className="note">or start from a template: {templates.map((t) => (
              <button key={t.id} className="btn" style={{ marginLeft: 6 }} disabled={busy || !newPackageId.trim()} onClick={() => applyTemplate(t.id)}>{t.name}</button>
            ))}</span>
          )}
        </div>
      )}

      {detail && (
        <div className="card">
          <div className="page-head" style={{ marginTop: 0 }}>
            <div>
              <h3 style={{ margin: 0 }}>Draft for package {detail.draft.package_id}</h3>
              <div className="sub">v{detail.draft.current_version || 0} · {detail.draft.status}</div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn" disabled={busy} onClick={saveVersion}>Save version</button>
              <button className="btn" disabled={busy} onClick={saveAsTemplate}>Save as template</button>
              {detail.draft.status === 'draft' && <button className="btn primary" disabled={busy} onClick={submit}>Submit bid</button>}
            </div>
          </div>

          <div className="two" style={{ marginBottom: 14 }}>
            <div className="card" style={{ background: 'var(--ivory)' }}>
              <div className="note" style={{ fontWeight: 700 }}>Totals</div>
              <div className="note" style={{ fontSize: 13 }}>
                <div>Subtotal: {money(detail.totals.subtotalCents)}</div>
                <div>Discount: -{money(detail.totals.discountCents)}</div>
                <div>Tax: {money(detail.totals.taxCents)}</div>
                <div style={{ fontWeight: 700 }}>Total: {money(detail.totals.totalCents)}</div>
                <div>Deposit: {money(detail.totals.depositCents)}</div>
              </div>
            </div>
            <div className="card" style={{ background: 'var(--ivory)' }}>
              <div className="note" style={{ fontWeight: 700 }}>Readiness: {detail.readiness.score}/100</div>
              <div className="note" style={{ fontSize: 12.5 }}>
                {detail.readiness.positives.map((p) => <div key={p}>+ {p}</div>)}
                {detail.readiness.missing.map((m) => <div key={m} style={{ color: 'var(--amber, #9a6a00)' }}>- {m}</div>)}
              </div>
            </div>
          </div>

          <div className="card" style={{ marginBottom: 14 }}>
            <div className="note" style={{ fontWeight: 700, marginBottom: 8 }}>Line items</div>
            <table>
              <thead><tr><th>Name</th><th>Qty</th><th>Unit price</th><th>Optional</th><th></th></tr></thead>
              <tbody>
                {detail.lineItems.map((li) => (
                  <tr key={li.id}>
                    <td>{li.name}</td>
                    <td>{li.qty}</td>
                    <td>{money(Math.round(li.unit_price * 100))}</td>
                    <td>{li.optional ? (
                      <button className="btn" style={{ padding: '2px 8px', fontSize: 11 }} onClick={() => toggleSelected(li)}>{li.selected ? 'Included' : 'Excluded'}</button>
                    ) : '-'}</td>
                    <td><button className="btn" style={{ padding: '2px 8px', fontSize: 11 }} onClick={() => removeLineItem(li.id)}>Remove</button></td>
                  </tr>
                ))}
                {detail.lineItems.length === 0 && <tr><td colSpan={5} className="note" style={{ padding: 12 }}>No line items yet.</td></tr>}
              </tbody>
            </table>
            <div className="two" style={{ marginTop: 10 }}>
              <div className="field"><label>Name</label><input value={liName} onChange={(e) => setLiName(e.target.value)} /></div>
              <div className="field"><label>Qty</label><input type="number" value={liQty} onChange={(e) => setLiQty(e.target.value)} /></div>
              <div className="field"><label>Unit price ($)</label><input type="number" value={liUnitPrice} onChange={(e) => setLiUnitPrice(e.target.value)} /></div>
              <div className="field" style={{ display: 'flex', alignItems: 'flex-end', gap: 6 }}>
                <label className="note" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <input type="checkbox" checked={liOptional} onChange={(e) => setLiOptional(e.target.checked)} /> Optional upgrade
                </label>
              </div>
            </div>
            <button className="btn" disabled={busy || !liName.trim() || !liUnitPrice} onClick={addLineItem} style={{ marginTop: 6 }}>Add line item</button>
          </div>

          <div className="card" style={{ marginBottom: 14 }}>
            <div className="note" style={{ fontWeight: 700, marginBottom: 8 }}>Terms</div>
            <div className="two">
              <div className="field"><label>Expiration date</label>
                <input type="date" value={detail.draft.expires_at ? detail.draft.expires_at.slice(0, 10) : ''} onChange={(e) => saveDraftFields({ expiresAt: e.target.value || null })} />
              </div>
              <div className="field"><label>Deposit (%)</label>
                <input type="number" defaultValue={detail.draft.deposit_percent_basis_points != null ? detail.draft.deposit_percent_basis_points / 100 : ''} onBlur={(e) => saveDraftFields({ depositPercentBasisPoints: e.target.value ? Math.round(Number(e.target.value) * 100) : null })} />
              </div>
              <div className="field"><label>Tax ($)</label>
                <input type="number" defaultValue={detail.draft.tax_cents != null ? detail.draft.tax_cents / 100 : ''} onBlur={(e) => saveDraftFields({ taxCents: e.target.value ? Math.round(Number(e.target.value) * 100) : null })} />
              </div>
              <div className="field"><label>Discount ($)</label>
                <input type="number" defaultValue={detail.draft.discount_cents != null ? detail.draft.discount_cents / 100 : ''} onBlur={(e) => saveDraftFields({ discountCents: e.target.value ? Math.round(Number(e.target.value) * 100) : null })} />
              </div>
              <div className="field" style={{ gridColumn: '1 / -1' }}><label>Assumptions</label>
                <textarea rows={2} defaultValue={detail.draft.assumptions ?? ''} onBlur={(e) => saveDraftFields({ assumptions: e.target.value })} /></div>
              <div className="field" style={{ gridColumn: '1 / -1' }}><label>Terms</label>
                <textarea rows={2} defaultValue={detail.draft.terms ?? ''} onBlur={(e) => saveDraftFields({ terms: e.target.value })} /></div>
            </div>
          </div>

          <div className="card">
            <div className="note" style={{ fontWeight: 700, marginBottom: 8 }}>Payment schedule</div>
            {detail.milestones.map((m) => (
              <div key={m.id} className="note" style={{ fontSize: 12.5 }}>
                {m.label} · {m.percent_basis_points != null ? `${m.percent_basis_points / 100}%` : money(m.amount_cents)} · {m.due_event}
              </div>
            ))}
            <div className="two" style={{ marginTop: 8 }}>
              <div className="field"><label>Label</label><input value={msLabel} onChange={(e) => setMsLabel(e.target.value)} placeholder="e.g. Deposit" /></div>
              <div className="field"><label>Percent (%)</label><input type="number" value={msPercent} onChange={(e) => setMsPercent(e.target.value)} /></div>
              <div className="field"><label>Due</label>
                <select value={msDueEvent} onChange={(e) => setMsDueEvent(e.target.value)}>
                  <option value="deposit">Deposit</option>
                  <option value="milestone">Milestone</option>
                  <option value="completion">Completion</option>
                  <option value="net_15">Net 15</option>
                  <option value="net_30">Net 30</option>
                  <option value="net_60">Net 60</option>
                  <option value="other">Other</option>
                </select>
              </div>
            </div>
            <button className="btn" disabled={busy || !msLabel.trim()} onClick={addMilestone} style={{ marginTop: 6 }}>Add milestone</button>
          </div>
        </div>
      )}

      {!detail && drafts.length > 0 && (
        <div className="card" style={{ padding: 0 }}>
          <table>
            <thead><tr><th>Package</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {drafts.map((d) => (
                <tr key={d.id}>
                  <td>{d.package_id}</td>
                  <td><span className={`badge ${d.status === 'submitted' ? 'b-green' : 'b-amber'}`}>{d.status}</span></td>
                  <td><button className="btn" onClick={() => void loadDetail(d.id)}>{selectedId === d.id ? 'Selected' : 'Open'}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
