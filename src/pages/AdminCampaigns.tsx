import { useEffect, useState } from 'react';
import { useFeatures } from '../lib/features';
import { apiGet, apiSend } from '../lib/api';

type Campaign = {
  id: string;
  name: string;
  subject: string;
  body_html: string;
  segment: string;
  status: 'draft' | 'test_sent' | 'approved' | 'sending' | 'sent' | 'cancelled';
  test_sent_to?: string | null;
  test_sent_at?: string | null;
  approved_by?: string | null;
  approved_at?: string | null;
  recipient_count: number;
  sent_count: number;
  failed_count: number;
  created_by?: string | null;
  created_at: string;
};

const SEGMENTS: [string, string][] = [
  ['developers', 'Developers (buyer companies)'],
  ['vendors', 'Vendors'],
  ['investors', 'Investors'],
  ['claim_prospects', 'Claim prospects (invites)'],
  ['referral_partners', 'Referral partners'],
  ['all_companies', 'All companies'],
];
const segLabel = (s: string) => SEGMENTS.find(([v]) => v === s)?.[1] ?? s;

const STATUS_BADGE: Record<Campaign['status'], string> = {
  draft: 'b-neutral',
  test_sent: 'b-amber',
  approved: 'b-amber',
  sending: 'b-amber',
  sent: 'b-emerald',
  cancelled: 'b-red',
};

const date = (s?: string | null) => (s ? new Date(s).toLocaleString() : '-');

export default function AdminCampaigns() {
  const { isAdmin } = useFeatures();
  const [rows, setRows] = useState<Campaign[]>([]);
  const [name, setName] = useState('');
  const [subject, setSubject] = useState('');
  const [bodyHtml, setBodyHtml] = useState('');
  const [segment, setSegment] = useState('developers');
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [busy, setBusy] = useState(false);
  const [actingId, setActingId] = useState<string | null>(null);

  async function load() {
    try {
      const d = await apiGet<{ campaigns: Campaign[] }>('/admin/campaigns');
      setRows(d.campaigns ?? []);
    } catch (e: any) {
      setErr(e.message ?? 'Could not load campaigns.');
    }
  }
  useEffect(() => {
    if (isAdmin) load();
  }, [isAdmin]);

  if (!isAdmin) return <div className="card">Admins only.</div>;

  async function create() {
    if (!name.trim() || !subject.trim()) {
      setErr('Name and subject are required.');
      return;
    }
    setBusy(true);
    setErr('');
    setOk('');
    try {
      await apiSend('POST', '/admin/campaigns', { name, subject, bodyHtml, segment });
      setName('');
      setSubject('');
      setBodyHtml('');
      setOk('Draft created. Send a test, then approve and push.');
      await load();
    } catch (e: any) {
      setErr(e.message ?? 'Could not create campaign.');
    } finally {
      setBusy(false);
    }
  }

  async function sendTest(c: Campaign) {
    setActingId(c.id);
    setErr('');
    setOk('');
    try {
      const r = await apiSend<{ sent: boolean; skipped: boolean; to: string }>(
        'POST',
        `/admin/campaigns/${c.id}/test`,
        {},
      );
      setOk(
        r.skipped
          ? `Test queued to ${r.to} (email is disabled in this environment, but the gate is now open).`
          : `Test sent to ${r.to}. Review it, then approve and push.`,
      );
      await load();
    } catch (e: any) {
      setErr(e.message ?? 'Could not send test.');
    } finally {
      setActingId(null);
    }
  }

  async function approveAndSend(c: Campaign) {
    if (
      !confirm(
        `Broadcast "${c.name}" to the ${segLabel(c.segment)} segment? This emails every recipient and cannot be undone.`,
      )
    )
      return;
    setActingId(c.id);
    setErr('');
    setOk('');
    try {
      const r = await apiSend<{ recipient_count: number; sent_count: number; failed_count: number }>(
        'POST',
        `/admin/campaigns/${c.id}/approve-and-send`,
        {},
      );
      setOk(`Broadcast complete: ${r.sent_count} sent, ${r.failed_count} failed of ${r.recipient_count}.`);
      await load();
    } catch (e: any) {
      setErr(e.message ?? 'Could not send campaign.');
    } finally {
      setActingId(null);
    }
  }

  async function cancel(c: Campaign) {
    if (!confirm(`Cancel "${c.name}"?`)) return;
    setActingId(c.id);
    setErr('');
    try {
      await apiSend('PATCH', `/admin/campaigns/${c.id}`, { status: 'cancelled' });
      await load();
    } catch (e: any) {
      setErr(e.message ?? 'Could not cancel.');
    } finally {
      setActingId(null);
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Email Campaigns</h1>
          <div className="sub">
            Draft a broadcast, send a test to yourself, then approve and push to the whole segment.
            Approve and push only unlocks after a test send.
          </div>
        </div>
      </div>

      {err && <div className="err">{err}</div>}
      {ok && <div className="ok">{ok}</div>}

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="two" style={{ marginBottom: 10 }}>
          <div className="field">
            <label>Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Q3 developer outreach" />
          </div>
          <div className="field">
            <label>Segment</label>
            <select value={segment} onChange={(e) => setSegment(e.target.value)}>
              {SEGMENTS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="field" style={{ marginBottom: 10 }}>
          <label>Subject</label>
          <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="A faster way to source vendors" />
        </div>
        <div className="field" style={{ marginBottom: 10 }}>
          <label>Body (HTML)</label>
          <textarea
            value={bodyHtml}
            onChange={(e) => setBodyHtml(e.target.value)}
            rows={8}
            placeholder="<p>Hi there,</p><p>...</p>"
            style={{ width: '100%', fontFamily: 'monospace', fontSize: 13 }}
          />
        </div>
        <button className="btn primary" disabled={busy} onClick={create}>
          {busy ? 'Creating...' : 'Create draft'}
        </button>
      </div>

      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Segment</th>
              <th>Status</th>
              <th>Test</th>
              <th>Recipients</th>
              <th>Sent / Failed</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => {
              const tested = c.status === 'test_sent';
              const acting = actingId === c.id;
              const done = c.status === 'sent' || c.status === 'sending' || c.status === 'cancelled';
              return (
                <tr key={c.id}>
                  <td>
                    <strong>{c.name}</strong>
                    <div className="note" style={{ fontSize: 12 }}>{c.subject}</div>
                  </td>
                  <td>{segLabel(c.segment)}</td>
                  <td>
                    <span className={'badge ' + STATUS_BADGE[c.status]}>{c.status.replace('_', ' ')}</span>
                  </td>
                  <td>
                    {c.test_sent_at ? (
                      <span className="note" style={{ fontSize: 12 }}>
                        {c.test_sent_to}
                        <br />
                        {date(c.test_sent_at)}
                      </span>
                    ) : (
                      <span className="note">-</span>
                    )}
                  </td>
                  <td>{c.status === 'sent' ? c.recipient_count : '-'}</td>
                  <td>{c.status === 'sent' ? `${c.sent_count} / ${c.failed_count}` : '-'}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {!done && (
                      <button className="btn" disabled={acting} onClick={() => sendTest(c)} style={{ marginRight: 6 }}>
                        {acting ? '...' : tested ? 'Resend test' : 'Send test'}
                      </button>
                    )}
                    {!done && (
                      <button
                        className={'btn' + (tested ? ' primary' : '')}
                        disabled={acting || !tested}
                        title={tested ? 'Broadcast to the whole segment' : 'Send a test first'}
                        onClick={() => approveAndSend(c)}
                        style={{ marginRight: 6 }}
                      >
                        Approve &amp; push
                      </button>
                    )}
                    {!done && (
                      <button className="btn" disabled={acting} onClick={() => cancel(c)}>
                        Cancel
                      </button>
                    )}
                    {done && <span className="note" style={{ fontSize: 12 }}>{date(c.created_at)}</span>}
                  </td>
                </tr>
              );
            })}
            {!rows.length && (
              <tr>
                <td colSpan={7} className="note">
                  No campaigns yet. Create a draft above.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
