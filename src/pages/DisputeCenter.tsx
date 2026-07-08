/**
 * DisputeCenter -- contractor dispute resolution hub.
 * File, track, and resolve non-payment, scope, and defective-work disputes.
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

const DISPUTE_TYPE_COLORS: Record<string, string> = {
  non_payment: 'bg-red-100 text-red-800',
  scope_disagreement: 'bg-orange-100 text-orange-800',
  defective_work: 'bg-amber-100 text-amber-800',
  change_order: 'bg-yellow-100 text-yellow-800',
  delay: 'bg-blue-100 text-blue-800',
  insurance: 'bg-indigo-100 text-indigo-800',
  lien: 'bg-pink-100 text-pink-800',
  other: 'bg-gray-100 text-gray-700',
};

const STATUS_COLORS: Record<string, string> = {
  filed: 'bg-yellow-100 text-yellow-800',
  responded: 'bg-blue-100 text-blue-800',
  mediation: 'bg-purple-100 text-purple-800',
  escalated: 'bg-orange-100 text-orange-800',
  resolved: 'bg-green-100 text-green-800',
  closed_no_action: 'bg-gray-100 text-gray-600',
};

const STATUS_LABELS: Record<string, string> = {
  filed: 'Filed',
  responded: 'Responded',
  mediation: 'Mediation',
  escalated: 'Escalated',
  resolved: 'Resolved',
  closed_no_action: 'Closed',
};

const MSG_TYPE_COLORS: Record<string, string> = {
  evidence: 'bg-blue-100 text-blue-800',
  offer: 'bg-emerald-100 text-emerald-800',
  counter_offer: 'bg-teal-100 text-teal-800',
  admin_note: 'bg-gray-200 text-gray-700',
  platform_decision: 'bg-purple-100 text-purple-800',
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

  const myCompanyId = me?.companyId;

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Dispute Center ⚖️</h1>
        <p className="text-gray-500 mt-1 text-sm">
          Resolve contractor conflicts -- non-payment, scope disputes, and defective work.
        </p>
      </div>

      {/* Tab bar */}
      <div className="flex gap-2 mb-6 border-b border-gray-200">
        <button
          onClick={() => { setTab('list'); setSelectedDispute(null); }}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${tab === 'list' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
        >
          My Disputes
        </button>
        <button
          onClick={() => { setTab('file'); setSelectedDispute(null); }}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${tab === 'file' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
        >
          File a Dispute
        </button>
      </div>

      {/* MY DISPUTES TAB */}
      {tab === 'list' && !selectedDispute && (
        <div>
          {/* Stats row */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
            <div className="bg-red-50 rounded-lg p-4">
              <p className="text-xs text-red-600 font-medium uppercase tracking-wide">Open</p>
              <p className="text-2xl font-bold text-red-700 mt-1">{openCount}</p>
            </div>
            <div className="bg-purple-50 rounded-lg p-4">
              <p className="text-xs text-purple-600 font-medium uppercase tracking-wide">In Mediation</p>
              <p className="text-2xl font-bold text-purple-700 mt-1">{mediationCount}</p>
            </div>
            <div className="bg-green-50 rounded-lg p-4">
              <p className="text-xs text-green-600 font-medium uppercase tracking-wide">Resolved</p>
              <p className="text-2xl font-bold text-green-700 mt-1">{resolvedCount}</p>
            </div>
            <div className="bg-gray-50 rounded-lg p-4">
              <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">Total in Dispute</p>
              <p className="text-2xl font-bold text-gray-800 mt-1">{dollars(totalDisputed)}</p>
            </div>
          </div>

          {loading && (
            <p className="text-gray-400 text-sm">Loading disputes...</p>
          )}

          {!loading && disputes.length === 0 && (
            <div className="text-center py-12 bg-gray-50 rounded-lg">
              <p className="text-gray-500 mb-4">No disputes found.</p>
              <button
                onClick={() => setTab('file')}
                className="bg-indigo-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-indigo-700"
              >
                File a Dispute
              </button>
            </div>
          )}

          {!loading && disputes.map(d => {
            const isFiledByMe = d.filed_by_company_id === myCompanyId;
            return (
              <div key={d.id} className="bg-white border border-gray-200 rounded-lg p-4 mb-3 hover:border-gray-300 transition-colors">
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-gray-900 truncate">{d.title}</h3>
                  </div>
                  <div className="flex gap-2 flex-shrink-0 flex-wrap">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${DISPUTE_TYPE_COLORS[d.dispute_type] ?? 'bg-gray-100 text-gray-700'}`}>
                      {DISPUTE_TYPE_LABELS[d.dispute_type] ?? d.dispute_type}
                    </span>
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_COLORS[d.status] ?? 'bg-gray-100 text-gray-700'}`}>
                      {STATUS_LABELS[d.status] ?? d.status}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-3 text-sm text-gray-500 mb-3 flex-wrap">
                  <span>
                    {isFiledByMe
                      ? <><span className="bg-red-100 text-red-700 text-xs px-1.5 py-0.5 rounded font-medium mr-1">Filed by me</span> vs {d.against_name ?? 'Unknown'}</>
                      : <><span className="bg-amber-100 text-amber-700 text-xs px-1.5 py-0.5 rounded font-medium mr-1">Against me</span> by {d.filed_by_name ?? 'Unknown'}</>
                    }
                  </span>
                  {Number(d.amount_in_dispute_cents) > 0 && (
                    <span className="font-medium text-gray-700">{dollars(d.amount_in_dispute_cents)}</span>
                  )}
                  <span className="text-xs text-gray-400">{fmtDate(d.created_at)}</span>
                </div>

                <button
                  onClick={() => selectDispute(d)}
                  className="text-sm text-indigo-600 hover:text-indigo-800 font-medium"
                >
                  View &rarr;
                </button>
              </div>
            );
          })}

          {/* How it works accordion */}
          <div className="mt-8 border border-gray-200 rounded-lg overflow-hidden">
            <button
              onClick={() => setHowItWorksOpen(o => !o)}
              className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
            >
              <span>How the dispute process works</span>
              <span className="text-gray-400">{howItWorksOpen ? '▲' : '▼'}</span>
            </button>
            {howItWorksOpen && (
              <div className="px-4 pb-4 bg-gray-50">
                <p className="text-sm font-semibold text-gray-700 mb-3 mt-2">Three-tier resolution process</p>
                <ol className="space-y-3">
                  <li className="flex gap-3">
                    <span className="flex-shrink-0 w-6 h-6 bg-indigo-100 text-indigo-700 rounded-full text-xs font-bold flex items-center justify-center">1</span>
                    <div>
                      <p className="text-sm font-medium text-gray-800">Direct negotiation</p>
                      <p className="text-xs text-gray-500 mt-0.5">The opposing party has 7 days to respond. Use the message thread to exchange evidence, offers, and counter-offers.</p>
                    </div>
                  </li>
                  <li className="flex gap-3">
                    <span className="flex-shrink-0 w-6 h-6 bg-purple-100 text-purple-700 rounded-full text-xs font-bold flex items-center justify-center">2</span>
                    <div>
                      <p className="text-sm font-medium text-gray-800">Platform mediation</p>
                      <p className="text-xs text-gray-500 mt-0.5">If direct negotiation fails, request platform mediation. A Divini team member will review the evidence and suggest a resolution.</p>
                    </div>
                  </li>
                  <li className="flex gap-3">
                    <span className="flex-shrink-0 w-6 h-6 bg-orange-100 text-orange-700 rounded-full text-xs font-bold flex items-center justify-center">3</span>
                    <div>
                      <p className="text-sm font-medium text-gray-800">Third-party arbitration referral</p>
                      <p className="text-xs text-gray-500 mt-0.5">For unresolved cases, Divini can refer you to a licensed arbitration service. This is binding and typically faster than litigation.</p>
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
          <button
            onClick={() => setSelectedDispute(null)}
            className="text-sm text-indigo-600 hover:text-indigo-800 font-medium mb-4 flex items-center gap-1"
          >
            &larr; Back to disputes
          </button>

          {/* Detail header */}
          <div className="bg-white border border-gray-200 rounded-lg p-4 mb-4">
            <div className="flex items-start justify-between gap-3 flex-wrap mb-2">
              <h2 className="text-lg font-bold text-gray-900">{selectedDispute.title}</h2>
              <div className="flex gap-2 flex-wrap">
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${DISPUTE_TYPE_COLORS[selectedDispute.dispute_type] ?? 'bg-gray-100 text-gray-700'}`}>
                  {DISPUTE_TYPE_LABELS[selectedDispute.dispute_type] ?? selectedDispute.dispute_type}
                </span>
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_COLORS[selectedDispute.status] ?? 'bg-gray-100 text-gray-700'}`}>
                  {STATUS_LABELS[selectedDispute.status] ?? selectedDispute.status}
                </span>
              </div>
            </div>
            {Number(selectedDispute.amount_in_dispute_cents) > 0 && (
              <p className="text-sm text-gray-600 mb-1">Amount in dispute: <span className="font-semibold text-gray-900">{dollars(selectedDispute.amount_in_dispute_cents)}</span></p>
            )}
            <p className="text-sm text-gray-500">
              Filed by <span className="font-medium">{selectedDispute.filed_by_name ?? 'Unknown'}</span> against <span className="font-medium">{selectedDispute.against_name ?? 'Unknown'}</span> on {fmtDate(selectedDispute.created_at)}
            </p>
            {selectedDispute.description && (
              <p className="text-sm text-gray-700 mt-2 border-t border-gray-100 pt-2">{selectedDispute.description}</p>
            )}

            {/* Request mediation button */}
            {selectedDispute.status === 'responded' &&
             (selectedDispute.filed_by_company_id === myCompanyId || selectedDispute.against_company_id === myCompanyId) && (
              <button
                onClick={requestMediation}
                className="mt-3 bg-purple-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-purple-700 transition-colors"
              >
                Request Platform Mediation
              </button>
            )}
          </div>

          {/* Message thread */}
          <div className="bg-gray-50 border border-gray-200 rounded-lg mb-4 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-200 bg-white">
              <h3 className="text-sm font-semibold text-gray-700">Messages</h3>
            </div>
            <div className="p-4 space-y-3 max-h-96 overflow-y-auto">
              {messages.length === 0 && (
                <p className="text-sm text-gray-400 text-center py-4">No messages yet. Start the conversation below.</p>
              )}
              {messages.map((m: any) => {
                const isFromFiledBy = m.author_company_id === selectedDispute.filed_by_company_id;
                return (
                  <div
                    key={m.id}
                    className={`flex flex-col max-w-[80%] ${isFromFiledBy ? 'ml-auto items-end' : 'items-start'}`}
                  >
                    <div className={`rounded-lg px-3 py-2 text-sm ${isFromFiledBy ? 'bg-emerald-100 text-emerald-900' : 'bg-slate-200 text-slate-900'}`}>
                      {m.message_type !== 'message' && (
                        <span className={`text-xs font-medium px-1.5 py-0.5 rounded mr-1 inline-block mb-1 ${MSG_TYPE_COLORS[m.message_type] ?? 'bg-gray-200 text-gray-700'}`}>
                          {m.message_type.replace('_', ' ')}
                        </span>
                      )}
                      {(m.message_type === 'offer' || m.message_type === 'counter_offer') && m.amount_offered_cents && (
                        <span className="block text-xs font-semibold mb-1">{dollars(m.amount_offered_cents)}</span>
                      )}
                      <p>{m.message}</p>
                    </div>
                    <p className="text-xs text-gray-400 mt-0.5">{m.author_email} &middot; {fmtTime(m.created_at)}</p>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Compose area */}
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <div className="flex gap-3 mb-3">
              <div className="flex-1">
                <label className="text-xs text-gray-500 font-medium mb-1 block">Message type</label>
                <select
                  value={messageType}
                  onChange={e => setMessageType(e.target.value)}
                  className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="message">Message</option>
                  <option value="evidence">Submit Evidence</option>
                  <option value="offer">Make Offer</option>
                  <option value="counter_offer">Counter Offer</option>
                </select>
              </div>
              {(messageType === 'offer' || messageType === 'counter_offer') && (
                <div>
                  <label className="text-xs text-gray-500 font-medium mb-1 block">Amount ($)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="0.00"
                    value={offerAmount}
                    onChange={e => setOfferAmount(e.target.value)}
                    className="w-32 border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              )}
            </div>
            <textarea
              rows={3}
              placeholder="Write your message..."
              value={newMessage}
              onChange={e => setNewMessage(e.target.value)}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none mb-3"
            />
            <button
              onClick={sendMessage}
              disabled={sendingMessage || !newMessage.trim()}
              className="bg-indigo-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {sendingMessage ? 'Sending...' : 'Send'}
            </button>
          </div>
        </div>
      )}

      {/* FILE A DISPUTE TAB */}
      {tab === 'file' && (
        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <h2 className="text-lg font-bold text-gray-900 mb-1">File a New Dispute</h2>
          <p className="text-sm text-gray-500 mb-5">
            After filing, the opposing party has 7 days to respond. If unresolved, you can request platform mediation.
          </p>

          {fileError && (
            <div className="bg-red-50 border border-red-200 text-red-700 rounded-md px-4 py-3 text-sm mb-4">
              {fileError}
            </div>
          )}

          <form onSubmit={fileDispute} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Against Company ID (company's Divini ID) <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                placeholder="e.g. 3f7a1b2c-..."
                value={fileForm.againstCompanyId}
                onChange={e => setFileForm(f => ({ ...f, againstCompanyId: e.target.value }))}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Dispute Type <span className="text-red-500">*</span>
              </label>
              <select
                value={fileForm.disputeType}
                onChange={e => setFileForm(f => ({ ...f, disputeType: e.target.value }))}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
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

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Title <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                placeholder="Brief description of the dispute"
                value={fileForm.title}
                onChange={e => setFileForm(f => ({ ...f, title: e.target.value }))}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Description <span className="text-red-500">*</span>
              </label>
              <textarea
                rows={4}
                placeholder="Describe the dispute in detail -- what happened, when, and what outcome you are seeking."
                value={fileForm.description}
                onChange={e => setFileForm(f => ({ ...f, description: e.target.value }))}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Amount in Dispute ($)
              </label>
              <input
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                value={fileForm.amountInDisputeCents}
                onChange={e => setFileForm(f => ({ ...f, amountInDisputeCents: e.target.value }))}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <button
              type="submit"
              disabled={filing}
              className="w-full bg-red-600 text-white px-4 py-2.5 rounded-md text-sm font-semibold hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {filing ? 'Filing Dispute...' : 'File Dispute'}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
