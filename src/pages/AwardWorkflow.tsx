import { Fragment, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { apiBlob, apiGet, apiSend } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useToast } from '../lib/toast';

// ---- shapes returned by the /award API -------------------------------------
type PurchaseOrder = {
  id: string;
  bid_id: string | null;
  package_id: string | null;
  building_id: string | null;
  developer_company_id: string | null;
  vendor_company_id: string | null;
  vendor_name?: string | null;
  po_number: string | null;
  amount_cents: number | null;
  status: string;
  terms: string | null;
  notes: string | null;
  issued_at: string | null;
  created_at: string;
  updated_at: string;
  document_count?: number;
  payment_count?: number;
};
type PaymentAuth = {
  id: string;
  purchase_order_id: string;
  amount_cents: number | null;
  fee_percentage: number | null;
  fee_cents: number | null;
  payer_type: string | null;
  status: string;
  authorized_by: string | null;
  authorized_at: string | null;
  notes: string | null;
  created_at: string;
  award_cents: number | null;
  // platform fee (5% capped $25,000 standard; 2% capped $10,000 existing-relationship)
  success_fee_pct: number | null;
  success_fee_cap_cents: number | null;
  success_fee_cents: number | null;
  success_fee_grandfathered: boolean | null;
  // platform infrastructure fee (0.1% capped $1,500), always its own line item
  service_buffer_pct: number | null;
  service_buffer_cap_cents: number | null;
  service_buffer_cents: number | null;
};
type AwardDoc = {
  id: string;
  purchase_order_id: string;
  doc_kind: string;
  title: string | null;
  url: string | null;
  created_by: string | null;
  created_at: string;
};
type Invoice = {
  id: string;
  purchase_order_id: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
  gross_amount_cents: number;
  retainage_cents: number;
  approved_amount_cents: number | null;
  net_payable_cents: number | null;
  status: string;
  over_commitment: boolean;
};
type DetailResp = { purchaseOrder: PurchaseOrder; payments: PaymentAuth[]; documents: AwardDoc[] };

const PO_STATUSES = ['draft', 'issued', 'acknowledged', 'in_production', 'fulfilled', 'cancelled'];
const PAY_STATUSES = ['pending', 'authorized', 'released', 'void'];
// Mirrors server/src/routes/invoices.ts's TRANSITIONS exactly (developer-driven
// moves only; partially_paid/paid are system-derived and never offered here).
const INVOICE_TRANSITIONS: Record<string, string[]> = {
  draft: ['submitted', 'void'],
  submitted: ['under_review', 'approved', 'rejected', 'void'],
  under_review: ['approved', 'rejected', 'void'],
  approved: ['void'],
  rejected: ['void'],
  partially_paid: ['void'],
  paid: [],
  void: [],
};

const pretty = (s: string | null | undefined) => (s || '').replace(/_/g, ' ');
const money = (cents: number | null | undefined) =>
  cents == null ? '-' : `$${(Number(cents) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const statusBadge = (s: string) => {
  if (s === 'fulfilled' || s === 'released' || s === 'authorized' || s === 'approved' || s === 'paid') return 'b-green';
  if (s === 'cancelled' || s === 'void' || s === 'rejected') return 'b-red';
  if (s === 'draft' || s === 'pending') return 'b-neutral';
  return 'b-amber';
};

export default function AwardWorkflow() {
  const { toast } = useToast();
  const { company } = useAuth();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();

  const [list, setList] = useState<PurchaseOrder[]>([]);
  const [detail, setDetail] = useState<DetailResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');

  // confirm-from-bid input
  const [bidId, setBidId] = useState('');

  // PO edit drafts
  const [poNumber, setPoNumber] = useState('');
  const [terms, setTerms] = useState('');
  const [poNotes, setPoNotes] = useState('');

  // invoices
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [invNumber, setInvNumber] = useState('');
  const [invDate, setInvDate] = useState('');
  const [invAmount, setInvAmount] = useState('');

  // payment auth form
  const [payAmount, setPayAmount] = useState('');
  const [payFee, setPayFee] = useState('');
  const [payerType, setPayerType] = useState('developer');
  const [expandedPayId, setExpandedPayId] = useState<string | null>(null);

  // document form
  const [docKind, setDocKind] = useState('closeout');
  const [docTitle, setDocTitle] = useState('');
  const [docUrl, setDocUrl] = useState('');

  const selectedId = params.get('po') || '';

  async function loadList() {
    if (!company) return;
    setErr(''); setLoading(true);
    try {
      const rows = await apiGet<PurchaseOrder[]>(`/award/purchase-orders?companyId=${encodeURIComponent(company.id)}`);
      setList(rows);
      if (selectedId) await openPo(selectedId);
      else if (rows.length > 0) await openPo(rows[0].id);
      else setDetail(null);
    } catch (e: any) {
      setErr(e?.message || 'Failed to load purchase orders.');
    } finally {
      setLoading(false);
    }
  }

  async function openPo(id: string) {
    setErr('');
    try {
      const r = await apiGet<DetailResp>(`/award/purchase-orders/${encodeURIComponent(id)}`);
      setDetail(r);
      setPoNumber(r.purchaseOrder.po_number ?? '');
      setTerms(r.purchaseOrder.terms ?? '');
      setPoNotes(r.purchaseOrder.notes ?? '');
      setPayAmount(r.purchaseOrder.amount_cents != null ? String((Number(r.purchaseOrder.amount_cents) / 100)) : '');
      const next = new URLSearchParams(params);
      next.set('po', id);
      setParams(next, { replace: true });
      try {
        const invRes = await apiGet<{ invoices: Invoice[] }>(`/invoices?purchaseOrderId=${encodeURIComponent(id)}`);
        setInvoices(invRes.invoices);
      } catch {
        setInvoices([]);
      }
    } catch (e: any) {
      setErr(e?.message || 'Failed to load purchase order.');
    }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadList(); }, [company?.id]);

  async function confirmAward() {
    if (!bidId.trim()) return;
    setBusy(true); setErr(''); setOk('');
    try {
      const r = await apiSend<{ purchaseOrder: PurchaseOrder }>('POST', '/award/confirm', { bidId: bidId.trim() });
      setBidId('');
      setOk('Award confirmed. Draft purchase order created.');
      toast('Award confirmed. Draft PO created.', 'success');
      await loadList();
      await openPo(r.purchaseOrder.id);
    } catch (e: any) {
      const msg = e?.message || 'Failed to confirm award.';
      setErr(msg);
      toast(msg, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function patchPo(patch: Record<string, unknown>) {
    if (!detail) return;
    setBusy(true); setErr(''); setOk('');
    try {
      await apiSend('PATCH', `/award/purchase-orders/${encodeURIComponent(detail.purchaseOrder.id)}`, patch);
      await openPo(detail.purchaseOrder.id);
      setList(await apiGet<PurchaseOrder[]>(`/award/purchase-orders?companyId=${encodeURIComponent(company!.id)}`));
    } catch (e: any) {
      setErr(e?.message || 'Failed to update purchase order.');
    } finally {
      setBusy(false);
    }
  }

  async function createInvoice() {
    if (!detail?.purchaseOrder.building_id || !detail?.purchaseOrder.vendor_company_id) return;
    const grossAmountCents = invAmount.trim() ? Math.round(Number(invAmount) * 100) : NaN;
    if (!Number.isFinite(grossAmountCents) || grossAmountCents < 0) {
      setErr('Enter a valid invoice amount.');
      return;
    }
    setBusy(true); setErr(''); setOk('');
    try {
      await apiSend('POST', '/invoices', {
        buildingId: detail.purchaseOrder.building_id,
        vendorCompanyId: detail.purchaseOrder.vendor_company_id,
        purchaseOrderId: detail.purchaseOrder.id,
        invoiceNumber: invNumber.trim() || undefined,
        invoiceDate: invDate || undefined,
        grossAmountCents,
      });
      setInvNumber(''); setInvDate(''); setInvAmount('');
      setOk('Invoice submitted.');
      toast('Invoice submitted.', 'success');
      await openPo(detail.purchaseOrder.id);
    } catch (e: any) {
      const msg = e?.message || 'Failed to submit invoice.';
      setErr(msg);
      toast(msg, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function setInvoiceStatus(invId: string, status: string) {
    setBusy(true); setErr(''); setOk('');
    try {
      await apiSend('PATCH', `/invoices/${encodeURIComponent(invId)}/status`, { status });
      if (detail) await openPo(detail.purchaseOrder.id);
    } catch (e: any) {
      setErr(e?.message || 'Failed to update invoice.');
    } finally {
      setBusy(false);
    }
  }

  async function downloadInvoicesCsv() {
    const buildingId = detail?.purchaseOrder.building_id;
    if (!buildingId) return;
    setErr('');
    try {
      const blob = await apiBlob(`/reports/invoices/${encodeURIComponent(buildingId)}.csv`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `invoices-${buildingId}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setErr(e?.message || 'Failed to download invoices CSV.');
    }
  }

  async function recordPaymentAuth() {
    if (!detail) return;
    setBusy(true); setErr(''); setOk('');
    try {
      const amountCents = payAmount.trim() ? Math.round(Number(payAmount) * 100) : undefined;
      await apiSend('POST', `/award/purchase-orders/${encodeURIComponent(detail.purchaseOrder.id)}/payment-auth`, {
        amountCents,
        feePercentage: payFee.trim() ? Number(payFee) : undefined,
        payerType,
      });
      setPayFee('');
      setOk('Payment authorization recorded. No funds were moved.');
      await openPo(detail.purchaseOrder.id);
    } catch (e: any) {
      setErr(e?.message || 'Failed to record payment authorization.');
    } finally {
      setBusy(false);
    }
  }

  async function setPayStatus(payId: string, status: string) {
    setBusy(true); setErr(''); setOk('');
    try {
      await apiSend('PATCH', `/award/payment-auth/${encodeURIComponent(payId)}`, { status });
      if (detail) await openPo(detail.purchaseOrder.id);
    } catch (e: any) {
      setErr(e?.message || 'Failed to update authorization.');
    } finally {
      setBusy(false);
    }
  }

  async function addDocument() {
    if (!detail || !docTitle.trim()) return;
    setBusy(true); setErr(''); setOk('');
    try {
      await apiSend('POST', `/award/purchase-orders/${encodeURIComponent(detail.purchaseOrder.id)}/documents`, {
        docKind, title: docTitle.trim(), url: docUrl.trim() || undefined,
      });
      setDocTitle(''); setDocUrl('');
      setOk('Document attached.');
      await openPo(detail.purchaseOrder.id);
    } catch (e: any) {
      setErr(e?.message || 'Failed to attach document.');
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <div className="note">Loading award workflow…</div>;

  const po = detail?.purchaseOrder ?? null;
  const docs = detail?.documents ?? [];
  const payments = detail?.payments ?? [];

  // ---- closeout checklist ----
  const poIssued = !!po && po.status !== 'draft';
  const paymentAuthorized = payments.some((p) => p.status === 'authorized' || p.status === 'released');
  const hasCloseout = docs.some((d) => d.doc_kind === 'closeout');
  const hasWarranty = docs.some((d) => d.doc_kind === 'warranty');
  const checklist: { label: string; done: boolean; hint?: string }[] = [
    { label: 'Purchase order issued', done: poIssued },
    { label: 'Payment authorization recorded', done: paymentAuthorized, hint: 'record only' },
    { label: 'Submittals tracked', done: false, hint: 'separate system' },
    { label: 'Delivery / install tracked', done: false, hint: 'separate system' },
    { label: 'Closeout document uploaded', done: hasCloseout },
    { label: 'Warranty document uploaded', done: hasWarranty },
  ];

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Award &amp; Purchase Orders</h1>
          <div className="sub">
            Confirm an award, manage the purchase order, record payment authorizations,
            and attach closeout and warranty documents.
          </div>
        </div>
      </div>

      {err && <div className="card"><div className="err">{err}</div></div>}
      {ok && <div className="card"><div className="ok">{ok}</div></div>}

      {/* ---- confirm award from a bid ---- */}
      <div className="sectitle">Confirm an award</div>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="note" style={{ marginBottom: 10 }}>
          Paste the awarded bid id to confirm the award and draft a purchase order. The bid is
          marked awarded and a draft PO is created from its price.
        </div>
        <div className="two">
          <div className="field">
            <label>Bid id</label>
            <input value={bidId} onChange={(e) => setBidId(e.target.value)} placeholder="bid uuid" />
          </div>
          <div className="field" style={{ display: 'flex', alignItems: 'flex-end' }}>
            <button className="btn primary" onClick={confirmAward} disabled={busy || !bidId.trim()}>
              Confirm award &amp; draft PO
            </button>
          </div>
        </div>
      </div>

      {/* ---- PO selector ---- */}
      <div className="sectitle">Purchase orders ({list.length})</div>
      <div className="card" style={{ marginBottom: 16 }}>
        {list.length === 0 ? (
          <div className="note">No purchase orders yet. Confirm an award above to create one.</div>
        ) : (
          <div className="field">
            <label>Open purchase order</label>
            <select value={po?.id ?? ''} onChange={(e) => openPo(e.target.value)}>
              {list.map((r) => (
                <option key={r.id} value={r.id}>
                  {(r.po_number || 'PO ' + r.id.slice(0, 8))} · {r.vendor_name || 'Vendor'} · {pretty(r.status)} · {money(r.amount_cents)}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {po && (
        <>
          {/* ---- closeout checklist ---- */}
          <div className="sectitle">Procurement checklist</div>
          <div className="card" style={{ marginBottom: 16 }}>
            {checklist.map((c) => (
              <div key={c.label} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0' }}>
                <span className={`badge ${c.done ? 'b-green' : 'b-neutral'}`}>{c.done ? 'done' : 'open'}</span>
                <span style={{ flex: 1 }}>{c.label}</span>
                {c.hint && <span className="note" style={{ fontSize: 11.5 }}>{c.hint}</span>}
              </div>
            ))}
            <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
              {po.package_id && (
                <>
                  <button className="btn" onClick={() => nav(`/package/${po.package_id}/submittals`)}>Open submittals →</button>
                  <button className="btn" onClick={() => nav(`/package/${po.package_id}/delivery`)}>Open delivery / install →</button>
                </>
              )}
            </div>
          </div>

          {/* ---- purchase order ---- */}
          <div className="sectitle">Purchase order</div>
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="two">
              <div className="field">
                <label>Status</label>
                <select value={po.status} onChange={(e) => patchPo({ status: e.target.value })} disabled={busy}>
                  {PO_STATUSES.map((s) => <option key={s} value={s}>{pretty(s)}</option>)}
                </select>
              </div>
              <div className="field">
                <label>Amount</label>
                <input value={money(po.amount_cents)} readOnly />
              </div>
            </div>
            <div className="two">
              <div className="field">
                <label>PO number</label>
                <input value={poNumber} onChange={(e) => setPoNumber(e.target.value)}
                  onBlur={() => { if (poNumber !== (po.po_number ?? '')) patchPo({ po_number: poNumber }); }}
                  placeholder="e.g. PO-2026-0142" />
              </div>
              <div className="field">
                <label>Vendor</label>
                <input value={po.vendor_name || 'Not assigned'} readOnly />
              </div>
            </div>
            <div className="field">
              <label>Terms</label>
              <textarea rows={2} value={terms} onChange={(e) => setTerms(e.target.value)}
                onBlur={() => { if (terms !== (po.terms ?? '')) patchPo({ terms }); }}
                placeholder="Payment terms, lead time, milestones…" />
            </div>
            <div className="field">
              <label>Notes</label>
              <textarea rows={2} value={poNotes} onChange={(e) => setPoNotes(e.target.value)}
                onBlur={() => { if (poNotes !== (po.notes ?? '')) patchPo({ notes: poNotes }); }} />
            </div>
            <div className="note" style={{ fontSize: 11.5 }}>
              {po.issued_at ? `Issued ${new Date(po.issued_at).toLocaleString()}` : 'Not yet issued. Set status to issued to stamp the issue date.'}
            </div>
          </div>

          {/* ---- invoices ---- */}
          <div className="sectitle">Invoices</div>
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="two">
              <div className="field">
                <label>Invoice number</label>
                <input value={invNumber} onChange={(e) => setInvNumber(e.target.value)} placeholder="e.g. INV-1042" />
              </div>
              <div className="field">
                <label>Invoice date</label>
                <input type="date" value={invDate} onChange={(e) => setInvDate(e.target.value)} />
              </div>
            </div>
            <div className="two">
              <div className="field">
                <label>Amount ($)</label>
                <input value={invAmount} onChange={(e) => setInvAmount(e.target.value)} placeholder="0.00" />
              </div>
              <div className="field" style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
                <button className="btn primary" onClick={createInvoice} disabled={busy || !invAmount.trim()}>
                  Submit invoice
                </button>
                {po.building_id && (
                  <button className="btn" onClick={downloadInvoicesCsv}>Download invoices.csv</button>
                )}
              </div>
            </div>

            {invoices.length === 0 ? (
              <div className="note" style={{ marginTop: 12 }}>No invoices yet.</div>
            ) : (
              <table style={{ marginTop: 12 }}>
                <thead>
                  <tr><th>Number</th><th>Date</th><th>Gross</th><th>Retainage</th><th>Net payable</th><th>Status</th><th>Actions</th></tr>
                </thead>
                <tbody>
                  {invoices.map((inv) => (
                    <tr key={inv.id}>
                      <td>{inv.invoice_number || '-'}</td>
                      <td className="note">{inv.invoice_date ? new Date(inv.invoice_date).toLocaleDateString() : '-'}</td>
                      <td>{money(inv.gross_amount_cents)}</td>
                      <td className="note">{money(inv.retainage_cents)}</td>
                      <td>{inv.net_payable_cents != null ? money(inv.net_payable_cents) : '-'}</td>
                      <td>
                        <span className={`badge ${statusBadge(inv.status)}`}>{pretty(inv.status)}</span>
                        {inv.over_commitment && <span className="badge b-red" style={{ marginLeft: 4 }}>over commitment</span>}
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                          {(INVOICE_TRANSITIONS[inv.status] ?? []).map((s) => (
                            <button key={s} className="btn" style={{ padding: '2px 8px', fontSize: 12 }}
                              onClick={() => setInvoiceStatus(inv.id, s)} disabled={busy}>{pretty(s)}</button>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* ---- payment authorizations (record only) ---- */}
          <div className="sectitle">Payment authorizations</div>
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="note" style={{ marginBottom: 10, color: 'var(--amber, #9a6a00)' }}>
              <strong>Record only.</strong> This is a procurement record of authorization. No funds are moved by this system.
            </div>
            <div className="two">
              <div className="field">
                <label>Amount ($)</label>
                <input value={payAmount} onChange={(e) => setPayAmount(e.target.value)} placeholder="0.00" />
              </div>
              <div className="field">
                <label>Fee (%)</label>
                <input value={payFee} onChange={(e) => setPayFee(e.target.value)} placeholder="optional" />
              </div>
            </div>
            <div className="two">
              <div className="field">
                <label>Payer</label>
                <select value={payerType} onChange={(e) => setPayerType(e.target.value)}>
                  <option value="developer">developer</option>
                  <option value="owner">owner</option>
                  <option value="other">other</option>
                </select>
              </div>
              <div className="field" style={{ display: 'flex', alignItems: 'flex-end' }}>
                <button className="btn" onClick={recordPaymentAuth} disabled={busy}>Record authorization</button>
              </div>
            </div>

            {payments.length === 0 ? (
              <div className="note" style={{ marginTop: 12 }}>No payment authorizations recorded.</div>
            ) : (
              <table style={{ marginTop: 12 }}>
                <thead><tr><th>When</th><th>Amount</th><th>Fee</th><th>Payer</th><th>Status</th><th>Actions</th></tr></thead>
                <tbody>
                  {payments.map((p) => {
                    const processingFeeCents = null as number | null; // pass-through; not computed until a processor charge occurs
                    const totalCents =
                      (p.amount_cents ?? 0) + (p.success_fee_cents ?? p.fee_cents ?? 0) + (p.service_buffer_cents ?? 0);
                    const netPayoutCents =
                      (p.amount_cents ?? 0) - (p.success_fee_cents ?? p.fee_cents ?? 0) - (p.service_buffer_cents ?? 0);
                    return (
                      <Fragment key={p.id}>
                        <tr>
                          <td className="note">{new Date(p.created_at).toLocaleDateString()}</td>
                          <td>{money(p.amount_cents)}</td>
                          <td className="note">{p.fee_percentage != null ? `${p.fee_percentage}% · ${money(p.fee_cents)}` : '-'}</td>
                          <td className="note">{p.payer_type || '-'}</td>
                          <td><span className={`badge ${statusBadge(p.status)}`}>{pretty(p.status)}</span></td>
                          <td>
                            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                              <button className="btn" style={{ padding: '2px 8px', fontSize: 12 }}
                                onClick={() => setExpandedPayId(expandedPayId === p.id ? null : p.id)}>
                                {expandedPayId === p.id ? 'Hide breakdown' : 'View breakdown'}
                              </button>
                              {PAY_STATUSES.filter((s) => s !== p.status).map((s) => (
                                <button key={s} className="btn" style={{ padding: '2px 8px', fontSize: 12 }}
                                  onClick={() => setPayStatus(p.id, s)} disabled={busy}>{s}</button>
                              ))}
                            </div>
                          </td>
                        </tr>
                        {expandedPayId === p.id && (
                          <tr>
                            <td colSpan={6}>
                              <div className="two" style={{ gap: 24 }}>
                                <div>
                                  <div className="note" style={{ fontWeight: 600, marginBottom: 4 }}>Invoice</div>
                                  <table>
                                    <tbody>
                                      <tr><td>Project amount</td><td style={{ textAlign: 'right' }}>{money(p.amount_cents)}</td></tr>
                                      <tr>
                                        <td>Platform fee{p.success_fee_grandfathered ? ' (existing relationship)' : ''}
                                          {p.success_fee_pct != null && ` (${p.success_fee_pct}%${p.success_fee_cap_cents ? `, capped ${money(p.success_fee_cap_cents)}` : ''})`}
                                        </td>
                                        <td style={{ textAlign: 'right' }}>{money(p.success_fee_cents ?? p.fee_cents)}</td>
                                      </tr>
                                      <tr>
                                        <td>Platform infrastructure fee
                                          {p.service_buffer_pct != null && ` (${p.service_buffer_pct}%${p.service_buffer_cap_cents ? `, capped ${money(p.service_buffer_cap_cents)}` : ''})`}
                                        </td>
                                        <td style={{ textAlign: 'right' }}>{money(p.service_buffer_cents)}</td>
                                      </tr>
                                      <tr><td>Payment processing fee</td><td style={{ textAlign: 'right' }} className="note">{processingFeeCents == null ? 'Passed through at charge time' : money(processingFeeCents)}</td></tr>
                                      <tr><td>Taxes</td><td style={{ textAlign: 'right' }} className="note">Not applicable</td></tr>
                                      <tr style={{ fontWeight: 600 }}><td>Total</td><td style={{ textAlign: 'right' }}>{money(totalCents)}</td></tr>
                                    </tbody>
                                  </table>
                                </div>
                                <div>
                                  <div className="note" style={{ fontWeight: 600, marginBottom: 4 }}>Vendor payout</div>
                                  <table>
                                    <tbody>
                                      <tr><td>Gross amount</td><td style={{ textAlign: 'right' }}>{money(p.amount_cents)}</td></tr>
                                      <tr><td>Platform fee</td><td style={{ textAlign: 'right' }}>-{money(p.success_fee_cents ?? p.fee_cents)}</td></tr>
                                      <tr><td>Processing allocation</td><td style={{ textAlign: 'right' }} className="note">Passed through at charge time</td></tr>
                                      <tr><td>Infrastructure fee allocation</td><td style={{ textAlign: 'right' }}>-{money(p.service_buffer_cents)}</td></tr>
                                      <tr style={{ fontWeight: 600 }}><td>Net payout</td><td style={{ textAlign: 'right' }}>{money(netPayoutCents)}</td></tr>
                                    </tbody>
                                  </table>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {/* ---- closeout / warranty documents ---- */}
          <div className="sectitle">Closeout &amp; warranty documents</div>
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="two">
              <div className="field">
                <label>Type</label>
                <select value={docKind} onChange={(e) => setDocKind(e.target.value)}>
                  <option value="closeout">closeout</option>
                  <option value="warranty">warranty</option>
                  <option value="po">po</option>
                  <option value="other">other</option>
                </select>
              </div>
              <div className="field">
                <label>Title</label>
                <input value={docTitle} onChange={(e) => setDocTitle(e.target.value)} placeholder="e.g. Final closeout package" />
              </div>
            </div>
            <div className="field">
              <label>URL (optional)</label>
              <input value={docUrl} onChange={(e) => setDocUrl(e.target.value)} placeholder="https://…" />
            </div>
            <button className="btn" onClick={addDocument} disabled={busy || !docTitle.trim()}>Attach document</button>

            {docs.length === 0 ? (
              <div className="note" style={{ marginTop: 12 }}>No documents attached.</div>
            ) : (
              <table style={{ marginTop: 12 }}>
                <thead><tr><th>Type</th><th>Title</th><th>Link</th><th>Added</th></tr></thead>
                <tbody>
                  {docs.map((d) => (
                    <tr key={d.id}>
                      <td><span className="badge b-neutral">{d.doc_kind}</span></td>
                      <td>{d.title}</td>
                      <td>{d.url ? <a href={d.url} target="_blank" rel="noreferrer">open</a> : <span className="note">-</span>}</td>
                      <td className="note">{new Date(d.created_at).toLocaleDateString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </>
  );
}
