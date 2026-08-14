/**
 * Divini Pipeline - the user-facing sales/procurement CRM. A vendor tracks
 * bid opportunities they are pursuing; a developer tracks their own
 * vendor-sourcing funnel for a package. Board grouped by stage, plus a
 * detail panel with activities, tasks, and tags. The readiness score is
 * fully deterministic (server/src/lib/pipeline-score.ts) and always shown
 * with its factor breakdown, never as a bare number.
 */
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../lib/auth';
import { apiGet, apiSend } from '../lib/api';

type Stage = { id: string; stage_key: string; label: string; sort_order: number; is_won: boolean; is_lost: boolean };
type ReadinessFactor = { code: string; label: string; missingLabel: string; points: number; met: boolean };
type Readiness = { score: number; positives: string[]; missing: string[]; factors: ReadinessFactor[] };
type Opportunity = {
  id: string;
  organization_id: string;
  profile_type: 'vendor' | 'developer';
  name: string;
  client_company_id: string | null;
  client_name: string | null;
  client_email: string | null;
  package_id: string | null;
  bid_id: string | null;
  category: string | null;
  source: string | null;
  estimated_value_cents: number | null;
  stage_key: string;
  status: 'open' | 'won' | 'lost';
  owner_user_id: string | null;
  next_action: string | null;
  next_action_date: string | null;
  expected_close_date: string | null;
  last_activity_at: string | null;
  loss_reason_id: string | null;
  notes: string | null;
  updated_at: string;
  readiness: Readiness;
};
type Activity = { id: string; activity_type: string; body: string | null; created_by: string | null; created_at: string };
type PTask = { id: string; title: string; due_at: string | null; status: string; assigned_to: string | null };
type Tag = { id: string; label: string };
type LossReason = { id: string; label: string };
type Source = { id: string; label: string };

const money = (cents: number | null | undefined) =>
  cents == null ? '-' : `$${(Number(cents) / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

export default function Pipeline() {
  const { company } = useAuth();
  const profileType: 'vendor' | 'developer' = company?.kind === 'vendor' ? 'vendor' : 'developer';
  const companyId = company?.id;

  const [stages, setStages] = useState<Stage[]>([]);
  const [opps, setOpps] = useState<Opportunity[]>([]);
  const [lossReasons, setLossReasons] = useState<LossReason[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [busy, setBusy] = useState(false);

  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState('');
  const [newCategory, setNewCategory] = useState('');
  const [newValue, setNewValue] = useState('');
  const [newSource, setNewSource] = useState('');
  const [newClientName, setNewClientName] = useState('');

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ opportunity: Opportunity; activities: Activity[]; tasks: PTask[]; tags: Tag[] } | null>(null);
  const [activityBody, setActivityBody] = useState('');
  const [taskTitle, setTaskTitle] = useState('');
  const [taskDue, setTaskDue] = useState('');

  async function loadBoard() {
    if (!companyId) return;
    setErr('');
    try {
      const [s, o, lr, src] = await Promise.all([
        apiGet<{ stages: Stage[] }>(`/pipeline/stages?companyId=${companyId}&profileType=${profileType}`),
        apiGet<{ opportunities: Opportunity[] }>(`/pipeline/opportunities?companyId=${companyId}&profileType=${profileType}`),
        apiGet<{ lossReasons: LossReason[] }>(`/pipeline/loss-reasons?companyId=${companyId}`),
        apiGet<{ sources: Source[] }>(`/pipeline/sources?companyId=${companyId}`),
      ]);
      setStages(s.stages.sort((a, b) => a.sort_order - b.sort_order));
      setOpps(o.opportunities);
      setLossReasons(lr.lossReasons);
      setSources(src.sources);
    } catch (e: any) {
      setErr(e.message ?? 'Could not load pipeline.');
    }
  }

  useEffect(() => {
    void loadBoard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, profileType]);

  async function loadDetail(id: string) {
    setErr('');
    try {
      const d = await apiGet<{ opportunity: Opportunity; activities: Activity[]; tasks: PTask[]; tags: Tag[] }>(
        `/pipeline/opportunities/${id}`,
      );
      setDetail(d);
      setSelectedId(id);
    } catch (e: any) {
      setErr(e.message ?? 'Could not load opportunity.');
    }
  }

  async function createOpportunity() {
    if (!companyId || !newName.trim()) return;
    setBusy(true); setErr(''); setOk('');
    try {
      await apiSend('POST', '/pipeline/opportunities', {
        companyId,
        profileType,
        name: newName.trim(),
        category: newCategory || undefined,
        estimatedValueCents: newValue ? Math.round(Number(newValue) * 100) : undefined,
        source: newSource || undefined,
        clientName: newClientName || undefined,
      });
      setNewName(''); setNewCategory(''); setNewValue(''); setNewSource(''); setNewClientName('');
      setShowNew(false);
      setOk('Opportunity created.');
      await loadBoard();
    } catch (e: any) {
      setErr(e.message ?? 'Could not create opportunity.');
    } finally {
      setBusy(false);
    }
  }

  async function moveStage(id: string, stageKey: string, lossReasonId?: string) {
    setBusy(true); setErr('');
    try {
      await apiSend('PATCH', `/pipeline/opportunities/${id}`, { stageKey, lossReasonId });
      await loadBoard();
      if (selectedId === id) await loadDetail(id);
    } catch (e: any) {
      setErr(e.message ?? 'Could not move stage.');
    } finally {
      setBusy(false);
    }
  }

  async function addActivity() {
    if (!selectedId || !activityBody.trim()) return;
    setBusy(true); setErr('');
    try {
      await apiSend('POST', `/pipeline/opportunities/${selectedId}/activities`, {
        activityType: 'note',
        body: activityBody.trim(),
      });
      setActivityBody('');
      await loadDetail(selectedId);
      await loadBoard();
    } catch (e: any) {
      setErr(e.message ?? 'Could not add activity.');
    } finally {
      setBusy(false);
    }
  }

  async function addTask() {
    if (!selectedId || !taskTitle.trim()) return;
    setBusy(true); setErr('');
    try {
      await apiSend('POST', `/pipeline/opportunities/${selectedId}/tasks`, {
        title: taskTitle.trim(),
        dueAt: taskDue || undefined,
      });
      setTaskTitle(''); setTaskDue('');
      await loadDetail(selectedId);
    } catch (e: any) {
      setErr(e.message ?? 'Could not add task.');
    } finally {
      setBusy(false);
    }
  }

  async function completeTask(taskId: string) {
    if (!selectedId) return;
    setBusy(true); setErr('');
    try {
      await apiSend('PATCH', `/pipeline/tasks/${taskId}`, { status: 'completed' });
      await loadDetail(selectedId);
    } catch (e: any) {
      setErr(e.message ?? 'Could not complete task.');
    } finally {
      setBusy(false);
    }
  }

  const byStage = useMemo(() => {
    const m = new Map<string, Opportunity[]>();
    for (const o of opps) {
      if (o.status !== 'open') continue;
      if (!m.has(o.stage_key)) m.set(o.stage_key, []);
      m.get(o.stage_key)!.push(o);
    }
    return m;
  }, [opps]);

  if (!companyId) return <div className="card">Sign in to use Divini Pipeline.</div>;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Divini Pipeline</h1>
          <div className="sub">
            {profileType === 'vendor'
              ? 'Track bid opportunities from first contact through award or loss.'
              : 'Track your vendor-sourcing funnel for upcoming and open packages.'}
          </div>
        </div>
        <button className="btn primary" onClick={() => setShowNew((v) => !v)}>
          {showNew ? 'Cancel' : '+ New opportunity'}
        </button>
      </div>

      {err && <div className="err">{err}</div>}
      {ok && <div className="ok">{ok}</div>}

      {showNew && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="two">
            <div className="field"><label>Name</label><input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Lakeside Tower - electrical" /></div>
            <div className="field"><label>Client name</label><input value={newClientName} onChange={(e) => setNewClientName(e.target.value)} /></div>
            <div className="field"><label>Category</label><input value={newCategory} onChange={(e) => setNewCategory(e.target.value)} placeholder="e.g. electrical" /></div>
            <div className="field"><label>Estimated value ($)</label><input type="number" value={newValue} onChange={(e) => setNewValue(e.target.value)} /></div>
            <div className="field"><label>Source</label>
              <select value={newSource} onChange={(e) => setNewSource(e.target.value)}>
                <option value="">Select…</option>
                {sources.map((s) => <option key={s.id} value={s.label}>{s.label}</option>)}
              </select>
            </div>
          </div>
          <button className="btn primary" disabled={busy || !newName.trim()} onClick={createOpportunity}>Create</button>
        </div>
      )}

      <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 12 }}>
        {stages.map((s) => {
          const list = byStage.get(s.stage_key) ?? [];
          const total = list.reduce((sum, o) => sum + (o.estimated_value_cents ?? 0), 0);
          return (
            <div key={s.stage_key} className="card" style={{ minWidth: 260, flex: '0 0 260px' }}>
              <div style={{ fontWeight: 700, marginBottom: 2 }}>{s.label}</div>
              <div className="note" style={{ marginBottom: 10 }}>{list.length} · {money(total)}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {list.map((o) => (
                  <div
                    key={o.id}
                    className="card"
                    style={{ padding: 10, cursor: 'pointer', borderColor: selectedId === o.id ? 'var(--emerald)' : undefined }}
                    onClick={() => void loadDetail(o.id)}
                  >
                    <div style={{ fontWeight: 600, fontSize: 13.5 }}>{o.name}</div>
                    <div className="note" style={{ fontSize: 12 }}>{o.client_name || '-'} · {money(o.estimated_value_cents)}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
                      <span className={`badge ${o.readiness.score >= 70 ? 'b-green' : o.readiness.score >= 40 ? 'b-amber' : 'b-neutral'}`} style={{ fontSize: 11 }}>
                        Readiness {o.readiness.score}
                      </span>
                      {o.next_action_date && <span className="note" style={{ fontSize: 11 }}>Due {o.next_action_date}</span>}
                    </div>
                  </div>
                ))}
                {list.length === 0 && <div className="note" style={{ fontSize: 12 }}>Empty</div>}
              </div>
            </div>
          );
        })}
      </div>

      {detail && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="page-head" style={{ marginTop: 0 }}>
            <div>
              <h3 style={{ margin: 0 }}>{detail.opportunity.name}</h3>
              <div className="sub">{detail.opportunity.client_name || detail.opportunity.client_email || 'No client on file'}</div>
            </div>
            <button className="btn" onClick={() => { setSelectedId(null); setDetail(null); }}>Close</button>
          </div>

          <div className="two" style={{ marginBottom: 14 }}>
            <div>
              <div className="note" style={{ fontWeight: 700, marginBottom: 6 }}>Stage</div>
              <select
                value={detail.opportunity.stage_key}
                onChange={(e) => {
                  const stage = stages.find((s) => s.stage_key === e.target.value);
                  if (stage?.is_lost) {
                    const reasonId = prompt(
                      `Loss reason (${lossReasons.map((r) => r.label).join(', ')}) - paste an id or leave blank:`,
                    );
                    void moveStage(detail.opportunity.id, e.target.value, reasonId || undefined);
                  } else {
                    void moveStage(detail.opportunity.id, e.target.value);
                  }
                }}
                disabled={busy}
              >
                {stages.map((s) => <option key={s.stage_key} value={s.stage_key}>{s.label}</option>)}
              </select>
            </div>
            <div>
              <div className="note" style={{ fontWeight: 700, marginBottom: 6 }}>
                Readiness: {detail.opportunity.readiness.score}/100
              </div>
              <div className="note" style={{ fontSize: 12.5 }}>
                {detail.opportunity.readiness.positives.map((p) => <div key={p}>+ {p}</div>)}
                {detail.opportunity.readiness.missing.map((m) => <div key={m} style={{ color: 'var(--amber, #9a6a00)' }}>- {m}</div>)}
              </div>
            </div>
          </div>

          <div className="two" style={{ marginBottom: 14 }}>
            <div>
              <div className="note" style={{ fontWeight: 700, marginBottom: 6 }}>Activity</div>
              <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                <input value={activityBody} onChange={(e) => setActivityBody(e.target.value)} placeholder="Log a call, note, or update…" style={{ flex: 1 }} />
                <button className="btn" disabled={busy || !activityBody.trim()} onClick={addActivity}>Add</button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 220, overflowY: 'auto' }}>
                {detail.activities.length === 0 && <div className="note">No activity logged yet.</div>}
                {detail.activities.map((a) => (
                  <div key={a.id} className="note" style={{ fontSize: 12.5 }}>
                    <strong>{a.activity_type}</strong> · {new Date(a.created_at).toLocaleString()}
                    {a.body && <div>{a.body}</div>}
                  </div>
                ))}
              </div>
            </div>
            <div>
              <div className="note" style={{ fontWeight: 700, marginBottom: 6 }}>Tasks</div>
              <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                <input value={taskTitle} onChange={(e) => setTaskTitle(e.target.value)} placeholder="Next action…" style={{ flex: 1 }} />
                <input type="date" value={taskDue} onChange={(e) => setTaskDue(e.target.value)} />
                <button className="btn" disabled={busy || !taskTitle.trim()} onClick={addTask}>Add</button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 220, overflowY: 'auto' }}>
                {detail.tasks.length === 0 && <div className="note">No tasks yet.</div>}
                {detail.tasks.map((t) => (
                  <div key={t.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12.5 }}>
                    <span className={t.status === 'completed' ? 'note' : ''} style={{ textDecoration: t.status === 'completed' ? 'line-through' : undefined }}>
                      {t.title}{t.due_at && ` · due ${new Date(t.due_at).toLocaleDateString()}`}
                    </span>
                    {t.status === 'open' && (
                      <button className="btn" style={{ padding: '2px 8px', fontSize: 11 }} onClick={() => completeTask(t.id)}>Done</button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
