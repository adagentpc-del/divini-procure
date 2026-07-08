/**
 * Admin task management. Lightweight tracker for internal platform work, with
 * optional soft links to any platform entity. Filter by status + priority,
 * create tasks, advance status inline (open -> in_progress -> done, or dismiss).
 *
 * Admin-only surface.
 */
import { useEffect, useState } from 'react';
import { useFeatures } from '../lib/features';
import { apiGet, apiSend } from '../lib/api';

type Task = {
  id: string;
  title: string;
  detail: string | null;
  linked_type: string | null;
  linked_id: string | null;
  assigned_to: string | null;
  priority: string;
  status: string;
  due_date: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

const STATUS_FILTERS = ['open', 'in_progress', 'done', 'dismissed', ''] as const;
const STATUS_LABEL: Record<string, string> = {
  open: 'Open',
  in_progress: 'In progress',
  done: 'Done',
  dismissed: 'Dismissed',
  '': 'All',
};
const PRIORITY_FILTERS = ['', 'urgent', 'high', 'medium', 'low'] as const;
const LINKED_TYPES = ['', 'account', 'project', 'vendor', 'investor', 'document', 'claim', 'bid', 'opportunity', 'program', 'other'];

const priorityCls = (p: string) =>
  p === 'urgent' ? 'badge err' : p === 'high' ? 'badge err' : p === 'low' ? 'badge' : 'badge';
const statusCls = (s: string) =>
  s === 'done' ? 'badge ok' : s === 'dismissed' ? 'badge' : s === 'in_progress' ? 'badge' : 'badge';

const NEXT_STATUS: Record<string, string> = { open: 'in_progress', in_progress: 'done' };
const NEXT_LABEL: Record<string, string> = { open: 'Start', in_progress: 'Mark done' };

export default function AdminTasks() {
  const { isAdmin } = useFeatures();
  const [rows, setRows] = useState<Task[]>([]);
  const [status, setStatus] = useState<string>('open');
  const [priority, setPriority] = useState<string>('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  // create form
  const [title, setTitle] = useState('');
  const [detail, setDetail] = useState('');
  const [linkedType, setLinkedType] = useState('');
  const [linkedId, setLinkedId] = useState('');
  const [assignedTo, setAssignedTo] = useState('');
  const [newPriority, setNewPriority] = useState('medium');
  const [dueDate, setDueDate] = useState('');

  async function load() {
    try {
      const qs = status ? `?status=${encodeURIComponent(status)}` : '';
      const d = await apiGet<{ tasks: Task[] }>(`/admin/tasks${qs}`);
      setRows(d.tasks ?? []);
    } catch (e: any) {
      setErr(e.message ?? 'Could not load tasks.');
    }
  }
  useEffect(() => {
    if (isAdmin) load();
  }, [isAdmin, status]);

  async function create() {
    if (!title.trim()) {
      setErr('Title is required.');
      return;
    }
    setBusy(true);
    setErr('');
    try {
      await apiSend('POST', '/admin/tasks', {
        title: title.trim(),
        detail: detail || undefined,
        linkedType: linkedType || undefined,
        linkedId: linkedId || undefined,
        assignedTo: assignedTo || undefined,
        priority: newPriority,
        dueDate: dueDate || undefined,
      });
      setTitle('');
      setDetail('');
      setLinkedType('');
      setLinkedId('');
      setAssignedTo('');
      setNewPriority('medium');
      setDueDate('');
      await load();
    } catch (e: any) {
      setErr(e.message ?? 'Could not create task.');
    } finally {
      setBusy(false);
    }
  }

  async function patch(id: string, body: Record<string, unknown>) {
    setBusy(true);
    setErr('');
    try {
      await apiSend('PATCH', `/admin/tasks/${id}`, body);
      await load();
    } catch (e: any) {
      setErr(e.message ?? 'Action failed.');
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setBusy(true);
    setErr('');
    try {
      await apiSend('DELETE', `/admin/tasks/${id}`);
      await load();
    } catch (e: any) {
      setErr(e.message ?? 'Could not delete task.');
    } finally {
      setBusy(false);
    }
  }

  if (!isAdmin) return <div className="card">Admins only.</div>;

  const visible = priority ? rows.filter((r) => r.priority === priority) : rows;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Admin Tasks</h1>
          <div className="sub">Internal task tracker. Optionally link a task to any platform entity. Advance status inline.</div>
        </div>
      </div>

      {err && <div className="err">{err}</div>}

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="note" style={{ marginBottom: 6 }}>New task</div>
        <div className="field">
          <label>Title</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What needs doing" />
        </div>
        <div className="field">
          <label>Detail (optional)</label>
          <input value={detail} onChange={(e) => setDetail(e.target.value)} placeholder="Context / notes" />
        </div>
        <div className="two" style={{ gap: 12 }}>
          <div className="field">
            <label>Linked type (optional)</label>
            <select value={linkedType} onChange={(e) => setLinkedType(e.target.value)}>
              {LINKED_TYPES.map((t) => (
                <option key={t || 'none'} value={t}>{t || 'None'}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Linked id (optional)</label>
            <input value={linkedId} onChange={(e) => setLinkedId(e.target.value)} placeholder="UUID of the linked record" />
          </div>
        </div>
        <div className="two" style={{ gap: 12 }}>
          <div className="field">
            <label>Assigned to (email)</label>
            <input value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} placeholder="person@example.com" />
          </div>
          <div className="field">
            <label>Priority</label>
            <select value={newPriority} onChange={(e) => setNewPriority(e.target.value)}>
              {['low', 'medium', 'high', 'urgent'].map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="field" style={{ maxWidth: 220 }}>
          <label>Due date (optional)</label>
          <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </div>
        <button className="btn primary" disabled={busy} onClick={create}>Create task</button>
      </div>

      <div className="card" style={{ marginBottom: 14, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <span className="note">Status</span>
        {STATUS_FILTERS.map((f) => (
          <button key={f || 'all'} className={`btn${status === f ? ' primary' : ''}`} onClick={() => setStatus(f)}>
            {STATUS_LABEL[f]}
          </button>
        ))}
        <span className="note" style={{ marginLeft: 12 }}>Priority</span>
        {PRIORITY_FILTERS.map((f) => (
          <button key={f || 'allp'} className={`btn${priority === f ? ' primary' : ''}`} onClick={() => setPriority(f)}>
            {f || 'All'}
          </button>
        ))}
      </div>

      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr>
              <th>Title</th>
              <th>Linked</th>
              <th>Assigned</th>
              <th>Priority</th>
              <th>Due</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr><td colSpan={7} className="note" style={{ padding: 14 }}>No tasks.</td></tr>
            ) : (
              visible.map((t) => (
                <tr key={t.id}>
                  <td>
                    <strong>{t.title}</strong>
                    {t.detail ? <div className="note" style={{ fontSize: 12 }}>{t.detail}</div> : null}
                  </td>
                  <td className="note">{t.linked_type ? `${t.linked_type}${t.linked_id ? `: ${t.linked_id.slice(0, 8)}` : ''}` : '-'}</td>
                  <td className="note">{t.assigned_to ?? '-'}</td>
                  <td><span className={priorityCls(t.priority)}>{t.priority}</span></td>
                  <td className="note">{t.due_date ? new Date(t.due_date).toLocaleDateString() : '-'}</td>
                  <td><span className={statusCls(t.status)}>{t.status}</span></td>
                  <td>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {NEXT_STATUS[t.status] && (
                        <button className="btn" disabled={busy} onClick={() => patch(t.id, { status: NEXT_STATUS[t.status] })}>
                          {NEXT_LABEL[t.status]}
                        </button>
                      )}
                      {t.status !== 'dismissed' && t.status !== 'done' && (
                        <button className="btn" disabled={busy} onClick={() => patch(t.id, { status: 'dismissed' })}>Dismiss</button>
                      )}
                      {(t.status === 'done' || t.status === 'dismissed') && (
                        <button className="btn" disabled={busy} onClick={() => patch(t.id, { status: 'open' })}>Reopen</button>
                      )}
                      <button className="btn" disabled={busy} onClick={() => remove(t.id)}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
