import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { useFeatures } from '../lib/features';
import {
  getPackage, getLineItems, addLineItem, deleteLineItem,
  getBidsForPackage, submitPricedBid, getQuestions, askQuestion, answerQuestion,
} from '../lib/db';
import DocumentPanel from '../components/DocumentPanel';
import FeeBadge from '../components/FeeBadge';
import ExistingRelationshipCheckbox from '../components/ExistingRelationshipCheckbox';
import { apiGet } from '../lib/api';
import {
  getBidCredits, getVerification, subscribeToTier,
  canBid, isVerified, bidsLeftLabel, verificationLabel,
  VENDOR_PRO_TIER_KEY, VENDOR_PRO_PRICE_LABEL,
  type BidCredits, type Verification,
} from '../lib/monetization';

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
  // grandfathered existing-relationship fee state (keyed by vendor_company_id)
  const [rels, setRels] = useState<Record<string, any>>({});
  const [relOpen, setRelOpen] = useState<string | null>(null);
  // monetization V2: bid credits + verification gating (null = gate off)
  const [credits, setCredits] = useState<BidCredits | null>(null);
  const [verif, setVerif] = useState<Verification | null>(null);
  const [upgrading, setUpgrading] = useState(false);
  const [upgradeMsg, setUpgradeMsg] = useState('');

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
      // developer (owner) view: load grandfathered relationship/fee status per vendor
      const devCompanyId = pk.building?.company_id;
      if (devCompanyId && company?.id === devCompanyId) {
        try {
          const d = await apiGet<{ relationships: any[] }>(`/relationships/mine?companyId=${devCompanyId}`);
          const map: Record<string, any> = {};
          (d.relationships ?? []).forEach((r) => { map[r.vendor_company_id] = r; });
          setRels(map);
        } catch { /* non-fatal */ }
      }
    }
  }
  useEffect(() => { load(); }, [id]);

  // Vendor-only: load bid credits + verification status (tolerate absence).
  async function loadEntitlements() {
    if (company?.kind !== 'vendor') return;
    const [c, v] = await Promise.all([getBidCredits(), getVerification()]);
    setCredits(c);
    setVerif(v);
  }
  useEffect(() => { loadEntitlements(); /* eslint-disable-next-line */ }, [company?.id]);

  async function upgradeToPro() {
    setUpgrading(true); setUpgradeMsg('');
    try {
      await subscribeToTier(VENDOR_PRO_TIER_KEY);
      setUpgradeMsg('You are now on Vendor Pro. Bidding is unlimited.');
      await loadEntitlements();
    } catch (e: any) {
      setUpgradeMsg(e?.message ?? 'Could not start your upgrade. Please try again.');
    } finally {
      setUpgrading(false);
    }
  }

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
    loadEntitlements(); // a bid consumes a quarterly credit; refresh the count
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
        {isOwner && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn" onClick={() => nav('/packages/' + p.id + '/compare')}>Compare quotes</button>
            <button className="btn" onClick={() => nav('/package/' + p.id + '/intel')}>Intelligence</button>
            <button className="btn" onClick={() => nav('/package/' + p.id + '/submittals')}>Submittals</button>
            <button className="btn" onClick={() => nav('/package/' + p.id + '/delivery')}>Delivery</button>
            <button className="btn primary" onClick={() => nav('/package/' + p.id + '/rfq-assist')}>RFQ assist</button>
          </div>
        )}
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
                      <td>{li.unit || '-'}</td>
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
                <div className="field"><label>Line description</label><input value={desc} onChange={e => setDesc(e.target.value)} placeholder="e.g. Lobby millwork - walnut" /></div>
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
            ) : !isVerified(verif) ? (
              /* Verify-first gate: cannot bid or contact developers until verified */
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <span className="badge b-amber">{verificationLabel(verif)}</span>
                </div>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>Get verified to start bidding</div>
                <div className="note" style={{ marginBottom: 12, lineHeight: 1.6 }}>
                  You can browse every project freely. To submit a bid or contact this developer, your
                  account must pass verification.
                  {verif?.missing?.length ? ` Still needed: ${verif.missing.join(', ')}.` : ''}
                </div>
                <button className="btn primary" onClick={() => nav('/profile')}>Complete verification</button>
              </div>
            ) : !canBid(credits) ? (
              /* Out of quarterly credits: upgrade to Pro */
              <div>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>You have used all 5 bids this quarter</div>
                <div className="note" style={{ marginBottom: 12, lineHeight: 1.6 }}>
                  Free vendors get 5 bids per quarter with no rollover. Upgrade to Vendor Pro for
                  unlimited bidding.
                </div>
                {upgradeMsg && <div className="note" style={{ marginBottom: 10 }}>{upgradeMsg}</div>}
                <button className="btn primary" onClick={upgradeToPro} disabled={upgrading}>
                  {upgrading ? 'Starting…' : `Upgrade to Pro - ${VENDOR_PRO_PRICE_LABEL}`}
                </button>
              </div>
            ) : (
              <>
                {credits && (
                  <div style={{ marginBottom: 10 }}>
                    <span className={`badge ${credits.unlimited ? 'b-green' : 'b-neutral'}`}>
                      {bidsLeftLabel(credits)}
                    </span>
                  </div>
                )}
                {msg && <div className="ok">{msg}</div>}
                {!boq && <div className="field" style={{ maxWidth: 220 }}><label>Total price ($)</label><input value={lump} onChange={e => setLump(e.target.value)} /></div>}
                {boq && <div className="note" style={{ marginBottom: 10 }}>Bid total from line items: <strong>${bidTotal.toLocaleString()}</strong></div>}
                <div className="two">
                  <div className="field"><label>Timeline (days)</label><input value={days} onChange={e => setDays(e.target.value)} /></div>
                  <div className="field"><label>Notes</label><input value={note} onChange={e => setNote(e.target.value)} placeholder="Inclusions, lead time, terms" /></div>
                </div>
                <button className="btn primary" onClick={submit} disabled={bidTotal <= 0}>Submit bid</button>
                {!credits?.unlimited && credits && (
                  <div className="note" style={{ marginTop: 8 }}>
                    Need more than 5 bids a quarter?{' '}
                    <a style={{ cursor: 'pointer', color: 'var(--emerald)', fontWeight: 600 }} onClick={() => nav('/subscription')}>
                      See Vendor Pro ({VENDOR_PRO_PRICE_LABEL})
                    </a>
                  </div>
                )}
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
              <thead><tr><th>Vendor</th><th>Price</th><th>Timeline</th><th>Status</th><th>Fee rule</th><th></th></tr></thead>
              <tbody>
                {bids.length === 0 ? <tr><td colSpan={6} className="note" style={{ padding: 14 }}>No bids yet.</td></tr>
                  : bids.map(b => {
                    const rel = rels[b.vendor_company_id];
                    return (
                      <>
                        <tr key={b.id}>
                          <td><strong>{b.vendor?.name ?? '-'}</strong></td>
                          <td>${Number(b.price).toLocaleString()}</td>
                          <td>{b.days} days</td>
                          <td><span className="badge b-neutral">{b.status}</span></td>
                          <td><FeeBadge fee={rel?.fee} relationship={rel} audience="developer" /></td>
                          <td>
                            {!rel && (
                              <a className="note" style={{ cursor: 'pointer', color: 'var(--emerald)' }}
                                 onClick={() => setRelOpen(relOpen === b.vendor_company_id ? null : b.vendor_company_id)}>
                                {relOpen === b.vendor_company_id ? 'Cancel' : 'Mark existing relationship'}
                              </a>
                            )}
                          </td>
                        </tr>
                        {relOpen === b.vendor_company_id && !rel && (
                          <tr key={b.id + '-rel'}>
                            <td colSpan={6}>
                              <ExistingRelationshipCheckbox
                                developerCompanyId={p.building.company_id}
                                vendorCompanyId={b.vendor_company_id}
                                vendorName={b.vendor?.name}
                                projectId={p.building.id}
                                onConfirmed={() => { setRelOpen(null); load(); }}
                              />
                            </td>
                          </tr>
                        )}
                      </>
                    );
                  })}
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
                <div style={{ fontWeight: 600, fontSize: 13.5 }}>Q: {qq.question} <span className="note">- {qq.vendor?.name ?? 'Vendor'}</span></div>
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
