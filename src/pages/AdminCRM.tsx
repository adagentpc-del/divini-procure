/**
 * Admin CRM / Sales Pipeline + Demo / Onboarding meeting flow.
 *
 * A kanban-style pipeline board (one column per stage) of tracked subjects
 * (developers, vendors, investors, other prospects). Create a record, open a
 * record to edit its stage / next action, advance the stage with a button, and
 * log demo / onboarding meetings (title, date, notes, requested docs, follow-up
 * tasks, assigned admin, profile completeness, outcome status).
 *
 * Admin-only. Talks to /api/admin/crm*. Zero em dashes by convention.
 */
import { useEffect, useState } from 'react';
import { useFeatures } from '../lib/features';
import { apiGet, apiSend } from '../lib/api';

type Rec = {
  id: string;
  subject_type: string;
  subject_company_id: string | null;
  subject_user_id: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  stage: string;
  source: string | null;
  owner_admin: string | null;
  notes: string | null;
  next_action: string | null;
  next_action_date: string | null;
  company_name?: string | null;
  company_kind?: string | null;
  updated_at: string;
};

type Meeting = {
  id: string;
  crm_record_id: string;
  title: string | null;
  scheduled_at: string | null;
  notes: string | null;
  requested_docs: string[] | null;
  follow_up_tasks: string[] | null;
  assigned_admin: string | null;
  profile_completeness: number | null;
  status: string;
  created_at: string;
};

const STAGES = [
  'prospect',
  'contacted',
  'demo_scheduled',
  'onboarding_started',
  'active',
  'paused',
  'lost',
] as const;

const STAGE_LABEL: Record<string, string> = {
  prospect: 'Prospect',
  contacted: 'Contacted',
  demo_scheduled: 'Demo scheduled',
  onboarding_started: 'Onboarding',
  active: 'Active',
  paused: 'Paused',
  lost: 'Lost',
};

const SUBJECT_TYPES = ['developer', 'vendor', 'investor', 'other'] as const;
const MEETING_STATUS = ['scheduled', 'completed', 'no_show', 'cancelled'] as const;

const stageBadge = (s: string) =>
  s === 'active'
    ? 'badge b-green'
    : s === 'lost'
      ? 'badge b-red'
      : s === 'paused'
        ? 'badge b-amber'
        : 'badge b-neutral';

// The next stage in the linear funnel (advance button target). Terminal /
// off-funnel stages have no auto-advance.
function nextStage(stage: string): string | null {
  const order = ['prospect', 'contacted', 'demo_scheduled', 'onboarding_started', 'active'];
  const i = order.indexOf(stage);
  if (i === -1 || i === order.length - 1) return null;
  return order[i + 1];
}

export default function AdminCRM() {
  const { isAdmin } = useFeatures();
  const [board, setBoard] = useState<Record<string, Rec[]>>({});
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Record<string, { record: Rec; meetings: Meeting[] }>>({});
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [showNew, setShowNew] = useState(false);

  async function load() {
    try {
      const d = await apiGet<{ stages: string[]; board: Record<string, Rec[]> }>('/admin/crm/board');
      setBoard(d.board ?? {});
    } catch (e: any) {
      setErr(e.message ?? 'Could not load pipeline.');
    }
  }
  useEffect(() => {
    if (isAdmin) load();
  }, [isAdmin]);

  async function openDetail(id: string) {
    if (openId === id) {
      setOpenId(null);
      return;
    }
    setOpenId(id);
    try {
      const d = await apiGet<{ record: Rec; meetings: Meeting[] }>(`/admin/crm/${id}`);
      setDetail((m) => ({ ...m, [id]: d }));
    } catch (e: any) {
      setErr(e.message ?? 'Could not load record.');
    }
  }

  async function refreshDetail(id: string) {
    const d = await apiGet<{ record: Rec; meetings: Meeting[] }>(`/admin/crm/${id}`);
    setDetail((m) => ({ ...m, [id]: d }));
  }

  async function patchRecord(id: string, body: Record<string, unknown>) {
    setBusy(true);
    setErr('');
    try {
      await apiSend('PATCH', `/admin/crm/${id}`, body);
      await load();
      if (openId === id) await refreshDetail(id);
    } catch (e: any) {
      setErr(e.message ?? 'Update failed.');
    } finally {
      setBusy(false);
    }
  }

  async function deleteRecord(id: string) {
    setBusy(true);
    setErr('');
    try {
      await apiSend('DELETE', `/admin/crm/${id}`);
      if (openId === id) setOpenId(null);
      await load();
    } catch (e: any) {
      setErr(e.message ?? 'Delete failed.');
    } finally {
      setBusy(false);
    }
  }

  if (!isAdmin) return <div className="card">Admins only.</div>;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Sales Pipeline / CRM</h1>
          <div className="sub">
            Track developers, vendors, and investors from first contact through demo, onboarding,
            and active. Open a record to advance its stage, set the next action, and log
            demo / onboarding meetings.
          </div>
        </div>
        <button className="btn primary" onClick={() => setShowNew((v) => !v)}>
          {showNew ? 'Close' : 'New record'}
        </button>
      </div>

      {err && <div className="err">{err}</div>}

      {showNew && (
        <NewRecordForm
          busy={busy}
          onCreate={async (body) => {
            setBusy(true);
            setErr('');
            try {
              await apiSend('POST', '/admin/crm', body);
              setShowNew(false);
              await load();
            } catch (e: any) {
              setErr(e.message ?? 'Could not create record.');
            } finally {
              setBusy(false);
            }
          }}
        />
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${STAGES.length}, minmax(200px, 1fr))`,
          gap: 10,
          overflowX: 'auto',
          marginTop: 14,
        }}
      >
        {STAGES.map((stage) => {
          const cards = board[stage] ?? [];
          return (
            <div key={stage} className="card" style={{ padding: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <strong>{STAGE_LABEL[stage]}</strong>
                <span className="badge b-neutral">{cards.length}</span>
              </div>
              {cards.length === 0 ? (
                <div className="note" style={{ fontSize: 12 }}>
                  None.
                </div>
              ) : (
                cards.map((r) => (
                  <div
                    key={r.id}
                    onClick={() => openDetail(r.id)}
                    style={{
                      border: '1px solid var(--line)',
                      borderRadius: 8,
                      padding: 8,
                      marginBottom: 8,
                      cursor: 'pointer',
                    }}
                  >
                    <div style={{ fontWeight: 600, fontSize: 13 }}>
                      {r.name || r.company_name || r.email || 'Untitled'}
                    </div>
                    <div className="note" style={{ fontSize: 11 }}>
                      {r.subject_type}
                      {r.owner_admin ? ` · ${r.owner_admin}` : ''}
                    </div>
                    {r.next_action && (
                      <div className="note" style={{ fontSize: 11, marginTop: 4 }}>
                        ▸ {r.next_action}
                        {r.next_action_date ? ` (${r.next_action_date})` : ''}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          );
        })}
      </div>

      {openId && detail[openId] && (
        <RecordDetail
          key={openId}
          data={detail[openId]}
          busy={busy}
          onClose={() => setOpenId(null)}
          onPatch={(body) => patchRecord(openId, body)}
          onDelete={() => deleteRecord(openId)}
          onMeetingChanged={() => refreshDetail(openId)}
        />
      )}
    </>
  );
}

function NewRecordForm({
  busy,
  onCreate,
}: {
  busy: boolean;
  onCreate: (body: Record<string, unknown>) => void;
}) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [subjectType, setSubjectType] = useState<string>('developer');
  const [stage, setStage] = useState<string>('prospect');
  const [source, setSource] = useState('');
  const [ownerAdmin, setOwnerAdmin] = useState('');
  const [notes, setNotes] = useState('');

  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <div className="two">
        <div className="field">
          <label>Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Contact or company" />
        </div>
        <div className="field">
          <label>Email</label>
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" />
        </div>
      </div>
      <div className="two">
        <div className="field">
          <label>Phone</label>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
        <div className="field">
          <label>Subject type</label>
          <select value={subjectType} onChange={(e) => setSubjectType(e.target.value)}>
            {SUBJECT_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="two">
        <div className="field">
          <label>Stage</label>
          <select value={stage} onChange={(e) => setStage(e.target.value)}>
            {STAGES.map((s) => (
              <option key={s} value={s}>
                {STAGE_LABEL[s]}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Source</label>
          <input value={source} onChange={(e) => setSource(e.target.value)} placeholder="Referral, inbound, event" />
        </div>
      </div>
      <div className="two">
        <div className="field">
          <label>Owner (admin)</label>
          <input value={ownerAdmin} onChange={(e) => setOwnerAdmin(e.target.value)} />
        </div>
        <div className="field">
          <label>Notes</label>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
      </div>
      <button
        className="btn primary"
        disabled={busy || (!name.trim() && !email.trim())}
        onClick={() =>
          onCreate({
            name,
            email,
            phone,
            subjectType,
            stage,
            source,
            ownerAdmin,
            notes,
          })
        }
      >
        Create record
      </button>
    </div>
  );
}

function RecordDetail({
  data,
  busy,
  onClose,
  onPatch,
  onDelete,
  onMeetingChanged,
}: {
  data: { record: Rec; meetings: Meeting[] };
  busy: boolean;
  onClose: () => void;
  onPatch: (body: Record<string, unknown>) => void;
  onDelete: () => void;
  onMeetingChanged: () => void;
}) {
  const { record: r, meetings } = data;
  const [stage, setStage] = useState(r.stage);
  const [nextAction, setNextAction] = useState(r.next_action ?? '');
  const [nextActionDate, setNextActionDate] = useState(r.next_action_date ?? '');
  const [recNotes, setRecNotes] = useState(r.notes ?? '');
  const adv = nextStage(r.stage);

  useEffect(() => {
    setStage(r.stage);
    setNextAction(r.next_action ?? '');
    setNextActionDate(r.next_action_date ?? '');
    setRecNotes(r.notes ?? '');
  }, [r.id, r.stage, r.next_action, r.next_action_date, r.notes]);

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="page-head">
        <div>
          <h1 style={{ fontSize: 20 }}>{r.name || r.company_name || r.email || 'Record'}</h1>
          <div className="note">
            <span className={stageBadge(r.stage)}>{STAGE_LABEL[r.stage] ?? r.stage}</span>
            {' · '}
            {r.subject_type}
            {r.email ? ` · ${r.email}` : ''}
            {r.phone ? ` · ${r.phone}` : ''}
          </div>
        </div>
        <button className="btn" onClick={onClose}>
          Close
        </button>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div className="field" style={{ minWidth: 180 }}>
          <label>Stage</label>
          <select value={stage} onChange={(e) => setStage(e.target.value)}>
            {STAGES.map((s) => (
              <option key={s} value={s}>
                {STAGE_LABEL[s]}
              </option>
            ))}
          </select>
        </div>
        <button className="btn" disabled={busy || stage === r.stage} onClick={() => onPatch({ stage })}>
          Save stage
        </button>
        {adv && (
          <button className="btn primary" disabled={busy} onClick={() => onPatch({ stage: adv })}>
            Advance to {STAGE_LABEL[adv]}
          </button>
        )}
      </div>

      <div className="two" style={{ marginTop: 10 }}>
        <div className="field">
          <label>Next action</label>
          <input value={nextAction} onChange={(e) => setNextAction(e.target.value)} />
        </div>
        <div className="field">
          <label>Next action date</label>
          <input type="date" value={nextActionDate ?? ''} onChange={(e) => setNextActionDate(e.target.value)} />
        </div>
      </div>
      <div className="field">
        <label>Notes</label>
        <textarea value={recNotes} onChange={(e) => setRecNotes(e.target.value)} rows={2} />
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button
          className="btn"
          disabled={busy}
          onClick={() => onPatch({ nextAction, nextActionDate: nextActionDate || null, notes: recNotes })}
        >
          Save details
        </button>
        <button className="btn b-red" disabled={busy} onClick={onDelete}>
          Delete record
        </button>
      </div>

      <hr style={{ border: 'none', borderTop: '1px solid var(--line)', margin: '16px 0' }} />

      <h1 style={{ fontSize: 16 }}>Demo / Onboarding meetings</h1>
      <MeetingForm recordId={r.id} busy={busy} onSaved={onMeetingChanged} />

      {meetings.length === 0 ? (
        <div className="note" style={{ marginTop: 8 }}>
          No meetings logged yet.
        </div>
      ) : (
        <div style={{ marginTop: 10 }}>
          {meetings.map((m) => (
            <MeetingRow key={m.id} m={m} busy={busy} onSaved={onMeetingChanged} />
          ))}
        </div>
      )}
    </div>
  );
}

function MeetingForm({
  recordId,
  busy,
  onSaved,
}: {
  recordId: string;
  busy: boolean;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState('');
  const [scheduledAt, setScheduledAt] = useState('');
  const [notes, setNotes] = useState('');
  const [requestedDocs, setRequestedDocs] = useState('');
  const [followUpTasks, setFollowUpTasks] = useState('');
  const [assignedAdmin, setAssignedAdmin] = useState('');
  const [profileCompleteness, setProfileCompleteness] = useState('');
  const [status, setStatus] = useState<string>('scheduled');
  const [localBusy, setLocalBusy] = useState(false);
  const [localErr, setLocalErr] = useState('');

  function splitLines(s: string): string[] {
    return s
      .split(/[\n,]/)
      .map((x) => x.trim())
      .filter(Boolean);
  }

  async function save() {
    setLocalBusy(true);
    setLocalErr('');
    try {
      await apiSend('POST', `/admin/crm/${recordId}/meetings`, {
        title,
        scheduledAt: scheduledAt || null,
        notes,
        requestedDocs: splitLines(requestedDocs),
        followUpTasks: splitLines(followUpTasks),
        assignedAdmin,
        profileCompleteness: profileCompleteness === '' ? null : Number(profileCompleteness),
        status,
      });
      setTitle('');
      setScheduledAt('');
      setNotes('');
      setRequestedDocs('');
      setFollowUpTasks('');
      setAssignedAdmin('');
      setProfileCompleteness('');
      setStatus('scheduled');
      onSaved();
    } catch (e: any) {
      setLocalErr(e.message ?? 'Could not log meeting.');
    } finally {
      setLocalBusy(false);
    }
  }

  return (
    <div className="card" style={{ marginTop: 10, background: 'transparent' }}>
      {localErr && <div className="err">{localErr}</div>}
      <div className="two">
        <div className="field">
          <label>Title</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Demo call, onboarding kickoff" />
        </div>
        <div className="field">
          <label>Scheduled at</label>
          <input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} />
        </div>
      </div>
      <div className="two">
        <div className="field">
          <label>Assigned admin</label>
          <input value={assignedAdmin} onChange={(e) => setAssignedAdmin(e.target.value)} />
        </div>
        <div className="field">
          <label>Status</label>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            {MEETING_STATUS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="two">
        <div className="field">
          <label>Requested docs (one per line or comma)</label>
          <textarea value={requestedDocs} onChange={(e) => setRequestedDocs(e.target.value)} rows={2} />
        </div>
        <div className="field">
          <label>Follow-up tasks (one per line or comma)</label>
          <textarea value={followUpTasks} onChange={(e) => setFollowUpTasks(e.target.value)} rows={2} />
        </div>
      </div>
      <div className="two">
        <div className="field" style={{ maxWidth: 160 }}>
          <label>Profile completeness %</label>
          <input
            type="number"
            min={0}
            max={100}
            value={profileCompleteness}
            onChange={(e) => setProfileCompleteness(e.target.value)}
          />
        </div>
        <div className="field">
          <label>Notes</label>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
      </div>
      <button className="btn primary" disabled={busy || localBusy} onClick={save}>
        Log meeting
      </button>
    </div>
  );
}

function MeetingRow({ m, busy, onSaved }: { m: Meeting; busy: boolean; onSaved: () => void }) {
  const [status, setStatus] = useState(m.status);
  const [localBusy, setLocalBusy] = useState(false);

  async function updateStatus(s: string) {
    setStatus(s);
    setLocalBusy(true);
    try {
      await apiSend('PATCH', `/admin/meetings/${m.id}`, { status: s });
      onSaved();
    } catch {
      /* surfaced on next load */
    } finally {
      setLocalBusy(false);
    }
  }

  const statusBadge =
    m.status === 'completed'
      ? 'badge b-green'
      : m.status === 'cancelled' || m.status === 'no_show'
        ? 'badge b-red'
        : 'badge b-amber';

  return (
    <div style={{ borderTop: '1px solid var(--line)', padding: '8px 0' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <div>
          <strong>{m.title || 'Meeting'}</strong>
          <span className={statusBadge} style={{ marginLeft: 8 }}>
            {m.status}
          </span>
          <div className="note" style={{ fontSize: 12 }}>
            {m.scheduled_at ? new Date(m.scheduled_at).toLocaleString() : 'No date'}
            {m.assigned_admin ? ` · ${m.assigned_admin}` : ''}
            {m.profile_completeness != null ? ` · profile ${m.profile_completeness}%` : ''}
          </div>
        </div>
        <select value={status} disabled={busy || localBusy} onChange={(e) => updateStatus(e.target.value)}>
          {MEETING_STATUS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>
      {m.notes && (
        <div className="note" style={{ fontSize: 12, marginTop: 4 }}>
          {m.notes}
        </div>
      )}
      {m.requested_docs && m.requested_docs.length > 0 && (
        <div className="note" style={{ fontSize: 12, marginTop: 4 }}>
          Requested docs: {m.requested_docs.join(', ')}
        </div>
      )}
      {m.follow_up_tasks && m.follow_up_tasks.length > 0 && (
        <div className="note" style={{ fontSize: 12, marginTop: 4 }}>
          Follow-ups: {m.follow_up_tasks.join(', ')}
        </div>
      )}
    </div>
  );
}
