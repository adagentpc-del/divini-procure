/**
 * DisputeCenter -- contractor dispute resolution hub.
 * File, track, and resolve non-payment, scope, and defective-work disputes.
 * Talks to /api/disputes (server/src/routes/disputes.ts). Styling matches
 * the rest of Procure (card / table / btn / badge / field / sub) - see
 * theme.css; bespoke layout (tabs, message bubbles, accordion) uses inline
 * style, matching the convention already used elsewhere (e.g. Submittals.tsx).
 * Zero em dashes by convention.
 */
import { useEffect, useState } from 'react';

const DISPUTE_TYPE_LABELS: Record<string, string> = {
  non_payment: 'Non-Payment',
  scope_disagreement: 'Scope Disagreement',
  defective_work: 'Defective Work',
  change_order: 'Change Order',
  delay: 'Delay',
  insurance: 'Insurance',
  lien: 'Lien',
  other: 'Other',
};

const STATUS_BADGE: Record<string, string> = {
  filed: 'badge b-amber',
  responded: 'badge b-amber',
  mediation: 'badge b-amber',
  escalated: 'badge b-red',
  resolved: 'badge b-green',
  closed_no_action: 'badge b-neutral',
};

const STATUS_LABELS: Record<string, string> = {
  filed: 'Filed',
  responded: 'Responded',
  mediation: 'Mediation',
  escalated: 'Escalated',
  resolved: 'Resolved',
  closed_no_action: 'Closed',
};

function dollars(cents: number | string | null | undefined): string {
  if (cents == null) return '$0';
  const n = Number(cents);
  return (n / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export default function DisputeCenter() {
  const [disputes, setDisputes] = useState<any[]>([]);
  const [selectedDispute, setSelectedDispute] = useState<any | null>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'list' | 'file'>('list');
  const [newMessage, setNewMessage] = useState('');
  const [messageType, setMessageType] = useState('message');
  const [offerAmount, setOfferAmount] = useState('');
  const [fileForm, setFileForm] = useState({
    againstCompanyId: '',
    disputeType: 'non_payment',
    title: '',
    description: '',
    amountInDisputeCents: '',
  });
  const [filing, setFiling] = useState(false);
  const [me, setMe] = useState<any>(null);
  const [sendingMessage, setSendingMessage] = useState(false);
  const [howItWorksOpen, setHowItWorksOpen] = useState(false);
  const [fileError, setFileError] = useState('');

  useEffect(() => {
    fetch('/api/me')
      .then(r => r.json())
      .then(data => setMe(data))
      .catch(() => {});
  }, []);

  const fetchDisputes = () => {
    setLoading(true);
    fetch('/api/disputes')
      .then(r => r.json())
      .then(data => setDisputes(data.disputes ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchDisputes();
  }, []);

  const selectDispute = async (d: any) => {
    setSelectedDispute(d);
    try {
      const r = await fetch(`/api/disputes/${d.id}`);
      const data = await r.json();
      setSelectedDispute(data.dispute ?? d);
      setMessages(data.messages ?? []);
    } catch {
      setMessages([]);
    }
  };

  const sendMessage = async () => {
    if (!newMessage.trim() || !selectedDispute) return;
    setSendingMessage(true);
    try {
      const body: any = { message: newMessage, messageType };
      if ((messageType === 'offer' || messageType === 'counter_offer') && offerAmount) {
        body.amountOfferedCents = Math.round(parseFloat(offerAmount) * 100);
      }
      await fetch(`/api/disputes/${selectedDispute.id}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      setNewMessage('');
      setOfferAmount('');
      setMessageType('message');
      // Refresh messages
      const r = await fetch(`/api/disputes/${selectedDispute.id}`);
      const data = await r.json();
      setMessages(data.messages ?? []);
    } catch {
      // silently fail
    } finally {
      setSendingMessage(false);
    }
  };

  const requestMediation = async () => {
    if (!selectedDispute) return;
    try {
      const r = await fetch(`/api/disputes/${selectedDispute.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'mediation' }),
      });
      const data = await r.json();
      setSelectedDispute(data.dispute);
      fetchDisputes();
    } catch {
      // silently fail
    }
  };

  const fileDispute = async (e: React.FormEvent) => {
    e.preventDefault();
    setFileError('');
    if (!fileForm.againstCompanyId.trim() || !fileForm.title.trim() || !fileForm.description.trim()) {
      setFileError('Please fill in all required fields.');
      return;
    }
    setFiling(true);
    try {
      const body: any = {
        againstCompanyId: fileForm.againstCompanyId.trim(),
        disputeType: fileForm.disputeType,
        title: fileForm.title.trim(),
        description: fileForm.description.trim(),
      };
      if (fileForm.amountInDisputeCents) {
        body.amountInDisputeCents = Math.round(parseFloat(fileForm.amountInDisputeCents) * 100);
      }
      const r = await fetch('/api/disputes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const err = await r.json();
        setFileError(err.error ?? 'Failed to file dispute.');
        return;
      }
      setFileForm({ againstCompanyId: '', disputeType: 'non_payment', title: '', description: '', amountInDisputeCents: '' });
      setTab('list');
      fetchDisputes();
    } catch {
      setFileError('Failed to file dispute. Please try again.');
    } finally {
      setFiling(false);
    }
  };

  // Stats
  const openCount = disputes.filter(d => ['filed', 'responded', 'escalated'].includes(d.status)).length;
  const mediationCount = disputes.filter(d => d.status === 'mediation').length;
  const resolvedCount = disputes.filter(d => d.status === 'resolved').length;
  const totalDisputed = disputes.reduce((sum, d) => sum + (Number(d.amount_in_dispute_cents) || 0), 0);

  const myCompanyId = me?.company?.id;

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Dispute Center</h1>
          <div className="sub">Resolve contractor conflicts: non-payment, scope disputes, and defective work.</div>
        </div>
      </div>

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 18, borderBottom: '1px solid var(--line)' }}>
        <button
          onClick={() => { setTab('list'); setSelectedDispute(null); }}
          className="btn"
          style={{
            border: 'none',
            borderBottom: tab === 'list' ? '2px solid var(--emerald)' : '2px solid transparent',
            borderRadius: 0,
            background: 'transparent',
            color: tab === 'list' ? 'var(--emerald-deep)' : 'var(--muted)',
          }}
        >
          My Disputes
        </button>
        <button
          onClick={() => { setTab('file'); setSelectedDispute(null); }}
          className="btn"
          style={{
            border: 'none',
            borderBottom: tab === 'file' ? '2px solid var(--emerald)' : '2px solid transparent',
            borderRadius: 0,
            background: 'transparent',
            color: tab === 'file' ? 'var(--emerald-deep)' : 'var(--muted)',
          }}
        >
          File a Dispute
        </button>
      </div>

      {/* MY DISPUTES TAB */}
      {tab === 'list' && !selectedDispute && (
        <div>
          <div className="grid cards3" style={{ gridTemplateColumns: 'repeat(4,1fr)', marginBottom: 18 }}>
            <div className="card metric">
              <div className="k">Open</div>
              <div className="v">{openCount}</div>
            </div>
            <div className="card metric">
              <div className="k">In Mediation</div>
              <div className="v">{mediationCount}</div>
            </div>
            <div className="card metric">
              <div className="k">Resolved</div>
              <div className="v">{resolvedCount}</div>
            </div>
            <div className="card metric">
              <div className="k">Total in Dispute</div>
              <div className="v">{dollars(totalDisputed)}</div>
            </div>
          </div>

          {loading && <div className="note">Loading disputes...</div>}

          {!loading && disputes.length === 0 && (
            <div className="card" style={{ textAlign: 'center', padding: 40 }}>
              <p className="note" style={{ marginBottom: 14 }}>No disputes found.</p>
              <button className="btn primary" onClick={() => setTab('file')}>File a Dispute</button>
            </div>
          )}

          {!loading && disputes.map(d => {
            const isFiledByMe = d.filed_by_company_id === myCompanyId;
            return (
              <div key={d.id} className="card" style={{ marginBottom: 10 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
                  <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>{d.title}</h3>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <span className="badge b-neutral">{DISPUTE_TYPE_LABELS[d.dispute_type] ?? d.dispute_type}</span>
                    <span className={STATUS_BADGE[d.status] ?? 'badge b-neutral'}>{STATUS_LABELS[d.status] ?? d.status}</span>
                  </div>
                </div>

                <div className="sub" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
                  <span>
                    {isFiledByMe
                      ? <><span className="badge b-red" style={{ marginRight: 4 }}>Filed by me</span> vs {d.against_name ?? 'Unknown'}</>
                      : <><span className="badge b-amber" style={{ marginRight: 4 }}>Against me</span> by {d.filed_by_name ?? 'Unknown'}</>
                    }
                  </span>
                  {Number(d.amount_in_dispute_cents) > 0 && (
                    <span style={{ fontWeight: 600, color: 'var(--ink)' }}>{dollars(d.amount_in_dispute_cents)}</span>
                  )}
                  <span>{fmtDate(d.created_at)}</span>
                </div>

                <button className="btn" onClick={() => selectDispute(d)}>View →</button>
              </div>
            );
          })}

          {/* How it works accordion */}
          <div className="card" style={{ marginTop: 24, padding: 0 }}>
            <button
              onClick={() => setHowItWorksOpen(o => !o)}
              className="btn"
              style={{ width: '100%', border: 'none', borderRadius: 0, justifyContent: 'space-between' }}
            >
              <span>How the dispute process works</span>
              <span className="note">{howItWorksOpen ? '▲' : '▼'}</span>
            </button>
            {howItWorksOpen && (
              <div style={{ padding: '0 18px 18px' }}>
                <div className="sectitle" style={{ margin: '10px 0' }}>Three-tier resolution process</div>
                <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <li style={{ display: 'flex', gap: 12 }}>
                    <span className="badge b-neutral" style={{ flexShrink: 0 }}>1</span>
                    <div>
                      <div style={{ fontSize: 13.5, fontWeight: 600 }}>Direct negotiation</div>
                      <div className="note">The opposing party has 7 days to respond. Use the message thread to exchange evidence, offers, and counter-offers.</div>
                    </div>
                  </li>
                  <li style={{ display: 'flex', gap: 12 }}>
                    <span className="badge b-neutral" style={{ flexShrink: 0 }}>2</span>
                    <div>
                      <div style={{ fontSize: 13.5, fontWeight: 600 }}>Platform mediation</div>
                      <div className="note">If direct negotiation fails, request platform mediation. A Divini team member will review the evidence and suggest a resolution.</div>
                    </div>
                  </li>
                  <li style={{ display: 'flex', gap: 12 }}>
                    <span className="badge b-neutral" style={{ flexShrink: 0 }}>3</span>
                    <div>
                      <div style={{ fontSize: 13.5, fontWeight: 600 }}>Third-party arbitration referral</div>
                      <div className="note">For unresolved cases, Divini can refer you to a licensed arbitration service. This is binding and typically faster than litigation.</div>
                    </div>
                  </li>
                </ol>
              </div>
            )}
          </div>
        </div>
      )}

      {/* DISPUTE DETAIL */}
      {tab === 'list' && selectedDispute && (
        <div>
          <a className="note" style={{ cursor: 'pointer', display: 'inline-block', marginBottom: 14 }} onClick={() => setSelectedDispute(null)}>
            ← Back to disputes
          </a>

          <div className="card" style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
              <h2 style={{ fontSize: 18, margin: 0 }}>{selectedDispute.title}</h2>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <span className="badge b-neutral">{DISPUTE_TYPE_LABELS[selectedDispute.dispute_type] ?? selectedDispute.dispute_type}</span>
                <span className={STATUS_BADGE[selectedDispute.status] ?? 'badge b-neutral'}>{STATUS_LABELS[selectedDispute.status] ?? selectedDispute.status}</span>
              </div>
            </div>
            {Number(selectedDispute.amount_in_dispute_cents) > 0 && (
              <p style={{ fontSize: 13.5, margin: '0 0 4px' }}>Amount in dispute: <strong>{dollars(selectedDispute.amount_in_dispute_cents)}</strong></p>
            )}
            <p className="sub">
              Filed by <strong>{selectedDispute.filed_by_name ?? 'Unknown'}</strong> against <strong>{selectedDispute.against_name ?? 'Unknown'}</strong> on {fmtDate(selectedDispute.created_at)}
            </p>
            {selectedDispute.description && (
              <p style={{ fontSize: 13.5, marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--line)' }}>{selectedDispute.description}</p>
            )}

            {selectedDispute.status === 'responded' &&
             (selectedDispute.filed_by_company_id === myCompanyId || selectedDispute.against_company_id === myCompanyId) && (
              <button onClick={requestMediation} className="btn primary" style={{ marginTop: 12 }}>
                Request Platform Mediation
              </button>
            )}
          </div>

          {/* Message thread */}
          <div className="card" style={{ marginBottom: 14, padding: 0 }}>
            <div style={{ padding: '12px 18px', borderBottom: '1px solid var(--line)' }}>
              <div className="sectitle" style={{ margin: 0 }}>Messages</div>
            </div>
            <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 384, overflowY: 'auto' }}>
              {messages.length === 0 && (
                <p className="note" style={{ textAlign: 'center', padding: 16 }}>No messages yet. Start the conversation below.</p>
              )}
              {messages.map((m: any) => {
                const isFromFiledBy = m.author_company_id === selectedDispute.filed_by_company_id;
                return (
                  <div
                    key={m.id}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      maxWidth: '80%',
                      marginLeft: isFromFiledBy ? 'auto' : 0,
                      alignItems: isFromFiledBy ? 'flex-end' : 'flex-start',
                    }}
                  >
                    <div
                      style={{
                        borderRadius: 10,
                        padding: '8px 12px',
                        fontSize: 13.5,
                        background: isFromFiledBy ? '#e7f3ec' : 'var(--ivory)',
                        color: 'var(--ink)',
                      }}
                    >
                      {m.message_type !== 'message' && (
                        <span className="badge b-neutral" style={{ marginBottom: 4, display: 'inline-block' }}>
                          {m.message_type.replace('_', ' ')}
                        </span>
                      )}
                      {(m.message_type === 'offer' || m.message_type === 'counter_offer') && m.amount_offered_cents && (
                        <span style={{ display: 'block', fontSize: 12, fontWeight: 700, marginBottom: 4 }}>{dollars(m.amount_offered_cents)}</span>
                      )}
                      <p style={{ margin: 0 }}>{m.message}</p>
                    </div>
                    <p className="note" style={{ marginTop: 2 }}>{m.author_email} · {fmtTime(m.created_at)}</p>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Compose area */}
          <div className="card">
            <div className="two" style={{ marginBottom: 12, gridTemplateColumns: '1fr auto' }}>
              <div className="field" style={{ margin: 0 }}>
                <label>Message type</label>
                <select value={messageType} onChange={e => setMessageType(e.target.value)}>
                  <option value="message">Message</option>
                  <option value="evidence">Submit Evidence</option>
                  <option value="offer">Make Offer</option>
                  <option value="counter_offer">Counter Offer</option>
                </select>
              </div>
              {(messageType === 'offer' || messageType === 'counter_offer') && (
                <div className="field" style={{ margin: 0, width: 140 }}>
                  <label>Amount ($)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="0.00"
                    value={offerAmount}
                    onChange={e => setOfferAmount(e.target.value)}
                  />
                </div>
              )}
            </div>
            <div className="field">
              <textarea
                rows={3}
                placeholder="Write your message..."
                value={newMessage}
                onChange={e => setNewMessage(e.target.value)}
              />
            </div>
            <button onClick={sendMessage} disabled={sendingMessage || !newMessage.trim()} className="btn primary">
              {sendingMessage ? 'Sending...' : 'Send'}
            </button>
          </div>
        </div>
      )}

      {/* FILE A DISPUTE TAB */}
      {tab === 'file' && (
        <div className="card">
          <h2 style={{ fontSize: 18, marginBottom: 4 }}>File a New Dispute</h2>
          <p className="sub" style={{ marginBottom: 18 }}>
            After filing, the opposing party has 7 days to respond. If unresolved, you can request platform mediation.
          </p>

          {fileError && <div className="err">{fileError}</div>}

          <form onSubmit={fileDispute}>
            <div className="field">
              <label>Against Company ID (company's Divini ID) *</label>
              <input
                type="text"
                placeholder="e.g. 3f7a1b2c-..."
                value={fileForm.againstCompanyId}
                onChange={e => setFileForm(f => ({ ...f, againstCompanyId: e.target.value }))}
                required
              />
            </div>

            <div className="field">
              <label>Dispute Type *</label>
              <select
                value={fileForm.disputeType}
                onChange={e => setFileForm(f => ({ ...f, disputeType: e.target.value }))}
              >
                <option value="non_payment">Non-Payment</option>
                <option value="scope_disagreement">Scope Disagreement</option>
                <option value="defective_work">Defective Work</option>
                <option value="change_order">Change Order</option>
                <option value="delay">Delay</option>
                <option value="insurance">Insurance</option>
                <option value="lien">Lien</option>
                <option value="other">Other</option>
              </select>
            </div>

            <div className="field">
              <label>Title *</label>
              <input
                type="text"
                placeholder="Brief description of the dispute"
                value={fileForm.title}
                onChange={e => setFileForm(f => ({ ...f, title: e.target.value }))}
                required
              />
            </div>

            <div className="field">
              <label>Description *</label>
              <textarea
                rows={4}
                placeholder="Describe the dispute in detail: what happened, when, and what outcome you are seeking."
                value={fileForm.description}
                onChange={e => setFileForm(f => ({ ...f, description: e.target.value }))}
                required
              />
            </div>

            <div className="field">
              <label>Amount in Dispute ($)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                value={fileForm.amountInDisputeCents}
                onChange={e => setFileForm(f => ({ ...f, amountInDisputeCents: e.target.value }))}
              />
            </div>

            <button type="submit" disabled={filing} className="btn primary block lg">
              {filing ? 'Filing Dispute...' : 'File Dispute'}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
