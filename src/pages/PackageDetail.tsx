import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { useFeatures } from '../lib/features';
import {
  getPackage, getLineItems, addLineItem, deleteLineItem,
  getBidsForPackage, submitPricedBid, getQuestions, askQuestion, answerQuestion,
} from '../lib/db';
import DocumentPanel from '../components/DocumentPanel';

export default function PackageDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { company } = useAuth();
  const { isOn } = useFeatures();
  const [p, setP] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);
  const [bids, setBids] = useState<any[]>([]);
  const [questions, setQuestions] = useState<any[]>([]);
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [lump, setLump] = useState('');
  const [days, setDays] = useState('');
  const [note, setNote] = useState('');
  const [q, setQ] = useState('');
  const [msg, setMsg] = useState('');
  // owner line-item adder
  const [desc, setDesc] = useState(''); const [qty, setQty] = useState('1'); const [unit, setUnit] = useState('');

  const isOwner = company && p && p.building?.company_id === company.id;
  const isVendor = company?.kind === 'vendor';
  const myBid = bids.find(b => b.vendor_company_id === company?.id);

  async function load() {
    if (!id) return;
    const pk = await getPackage(id); setP(pk);
    setItems(await getLineItems(id));
    if (pk) {
      setBids(await getBidsForPackage(id));
      setQuestions(await getQuestions(id));
    }
  }
  useEffect(() => { load(); }, [id]);

  const boq = isOn('boq_line_items') && items.length > 0;
  const lineTotal = (li: any) => (Number(prices[li.id] || 0) * Number(li.qty || 1)) || 0;
  const bidTotal = boq ? items.reduce((s, li) => s + lineTotal(li), 0) : Number(lump || 0);

  async function addLI(e: React.FormEvent) {
    e.preventDefault();
    if (!id || !desc) return;
    await addLineItem(id, { description: desc, qty: Number(qty) || 1, unit });
    setDesc(''); setQty('1'); setUnit('');
    setItems(await getLineItems(id));
  }

  async function submit() {
    if (!id || !company) return;
    setMsg('');
    const items_payload = boq ? items.map(li => ({
      line_item_id: li.id, unit_price: Number(prices[li.id] || 0), qty: Number(li.qty || 1),
      amount: lineTotal(li),
    })) : [];
    await submitPricedBid(id, company.id, { price: bidTotal, days: Number(days) || 0, note, items: items_payload });
    setMsg('Bid submitted.'); setLump(''); setDays(''); setNote(''); setPrices({});
    load();
  }

  async function ask() { if (id && company && q) { await askQuestion(id, company.id, q); setQ(''); setQuestions(await getQuestions(id)); } }
  async function answer(qid: string) {
    const a = window.prompt('Your answer:'); if (a) { await answerQuestion(qid, a); setQuestions(await getQuestions(id!)); }
  }

  if (!p) return <div className="note">Loading…</div>;

  return (
    <>
      <div className="page-head">
        <div>
          <a className="note" style={{ cursor: 'pointer' }} onClick={() => nav(isOwner ? '/building/' + p.building.id : '/search')}>← Back</a>
          <h1>{p.category}</h1>
          <div className="sub">{p.building?.name} · {p.building?.location ?? ''} · <span className="badge b-neutral">{p.status}</span>{p.deadline ? ` · due ${p.deadline}` : ''}</div>
        </div>
      </div>

      {/* Documents / CAD */}
      {isOn('cad_documents') && (
        <>
          <div className="sectitle">Drawings, CAD &amp; specs</div>
          <DocumentPanel packageId={p.id} canUpload={!!isOwner} />
        </>
      )}

      {/* BOQ line items */}
      {isOn('boq_line_items') && (
        <>
          <div className="sectitle">Bill of quantities {isOwner ? '(define the scope vendors will price)' : '(price each line)'}</div>
          <div className="card" style={{ padding: 0 }}>
            <table>
              <thead><tr><th>#</th><th>Description</th><th>Qty</th><th>Unit</th>{isVendor && !isOwner && <th>Unit $</th>}{isVendor && !isOwner && <th>Amount</th>}{isOwner && <th></th>}</tr></thead>
              <tbody>
                {items.length === 0 ? <tr><td colSpan={6} className="note" style={{ padding: 14 }}>No line items yet.</td></tr>
                  : items.map((li, i) => (
                    <tr key={li.id}>
                      <td>{i + 1}</td>
                      <td>{li.description}</td>
                      <td>{li.qty}</td>
                      <td>{li.unit || '—'}</td>
                      {isVendor && !isOwner && <td style={{ width: 110 }}><input value={prices[li.id] || ''} onChange={e => setPrices({ ...prices, [li.id]: e.target.value })} placeholder="0" disabled={!!myBid} /></td>}
                      {isVendor && !isOwner && <td>${lineTotal(li).toLocaleString()}</td>}
                      {isOwner && <td><a className="note" style={{ cursor: 'pointer', color: 'var(--red)' }} onClick={async () => { await deleteLineItem(li.id); setItems(await getLineItems(id!)); }}>Remove</a></td>}
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          {isOwner && (
            <form onSubmit={addLI} className="card" style={{ marginTop: 10 }}>
              <div className="two">
                <div className="field"><label>Line description</label><input value={desc} onChange={e => setDesc(e.target.value)} placeholder="e.g. Lobby millwork — walnut" /></div>
                <div className="field"><label>Unit</label><input value={unit} onChange={e => setUnit(e.target.value)} placeholder="ea / sf / lf" /></div>
              </div>
              <div className="field" style={{ maxWidth: 160 }}><label>Qty</label><input value={qty} onChange={e => setQty(e.target.value)} /></div>
              <button className="btn primary">+ Add line item</button>
            </form>
          )}
        </>
      )}

      {/* Vendor: submit bid */}
      {isVendor && !isOwner && (
        <>
          <div className="sectitle">Your bid</div>
          <div className="card">
            {myBid ? (
              <div className="ok">You submitted a bid of ${Number(myBid.price).toLocaleString()} · {myBid.days} days · status {myBid.status}.</div>
            ) : (
              <>
                {msg && <div className="ok">{msg}</div>}
                {!boq && <div className="field" style={{ maxWidth: 220 }}><label>Total price ($)</label><input value={lump} onChange={e => setLump(e.target.value)} /></div>}
                {boq && <div className="note" style={{ marginBottom: 10 }}>Bid total from line items: <strong>${bidTotal.toLocaleString()}</strong></div>}
                <div className="two">
                  <div className="field"><label>Timeline (days)</label><input value={days} onChange={e => setDays(e.target.value)} /></div>
                  <div className="field"><label>Notes</label><input value={note} onChange={e => setNote(e.target.value)} placeholder="Inclusions, lead time, terms" /></div>
                </div>
                <button className="btn primary" onClick={submit} disabled={bidTotal <= 0}>Submit bid</button>
              </>
            )}
          </div>
        </>
      )}

      {/* Owner: bids received */}
      {isOwner && (
        <>
          <div className="sectitle">Bids received ({bids.length})</div>
          <div className="card" style={{ padding: 0 }}>
            <table>
              <thead><tr><th>Vendor</th><th>Price</th><th>Timeline</th><th>Status</th></tr></thead>
              <tbody>
                {bids.length === 0 ? <tr><td colSpan={4} className="note" style={{ padding: 14 }}>No bids yet.</td></tr>
                  : bids.map(b => (
                    <tr key={b.id}>
                      <td><strong>{b.vendor?.name ?? '—'}</strong></td>
                      <td>${Number(b.price).toLocaleString()}</td>
                      <td>{b.days} days</td>
                      <td><span className="badge b-neutral">{b.status}</span></td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* RFQ Q&A */}
      {isOn('rfq_qa') && (
        <>
          <div className="sectitle">Clarifications (Q&amp;A)</div>
          <div className="card">
            {questions.length === 0 && <div className="note" style={{ marginBottom: 10 }}>No questions yet.</div>}
            {questions.map(qq => (
              <div key={qq.id} style={{ padding: '8px 0', borderTop: '1px solid var(--line)' }}>
                <div style={{ fontWeight: 600, fontSize: 13.5 }}>Q: {qq.question} <span className="note">— {qq.vendor?.name ?? 'Vendor'}</span></div>
                {qq.answer ? <div className="note">A: {qq.answer}</div>
                  : isOwner ? <a className="note" style={{ cursor: 'pointer', color: 'var(--emerald)' }} onClick={() => answer(qq.id)}>Answer</a>
                  : <div className="note">Awaiting answer</div>}
              </div>
            ))}
            {isVendor && !isOwner && (
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <input value={q} onChange={e => setQ(e.target.value)} placeholder="Ask a question about this package…" />
                <button className="btn" onClick={ask}>Ask</button>
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}
