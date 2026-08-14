/**
 * Divini Follow-Up Desk - rules-based reminders for stale opportunities,
 * unfinished bid drafts, expiring bids, and expiring credentials. Workflows
 * and their wording are fixed (seeded defaults + org customization); nothing
 * here is generated text. Users can enroll a record, and pause/resume/stop
 * any active enrollment.
 */
import { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth';
import { apiGet, apiSend } from '../lib/api';

type Step = { id: string; step_order: number; delay_value: number; delay_unit: string; action_type: string; condition_code: string | null };
type Workflow = { id: string; workflow_key: string; name: string; context_type: string; organization_id: string | null; steps: Step[] };
type Enrollment = {
  id: string; workflow_id: string; context_type: string; context_id: string;
  status: string; current_step: number; next_action_at: string | null; stop_reason: string | null;
};
type ActionRow = { id: string; action_type: string; status: string; executed_at: string | null; failure_reason: string | null; created_at: string };

const CONTEXT_LABEL: Record<string, string> = {
  pipeline_opportunity: 'Divini Pipeline opportunity',
  bid_draft: 'Divini Bid Studio draft',
  bid_submitted: 'Submitted bid',
  scope_instance: 'Divini Scope Builder scope',
  vendor_credential: 'Vendor credential',
};

export default function FollowUpDesk() {
  const { company, isAdmin } = useAuth();
  const companyId = company?.id;

  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [busy, setBusy] = useState(false);

  const [showEnroll, setShowEnroll] = useState(false);
  const [enrollWorkflowKey, setEnrollWorkflowKey] = useState('');
  const [enrollContextId, setEnrollContextId] = useState('');

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [actions, setActions] = useState<ActionRow[]>([]);

  async function load() {
    if (!companyId) return;
    setErr('');
    try {
      const [w, e] = await Promise.all([
        apiGet<{ workflows: Workflow[] }>(`/follow-up/workflows?companyId=${companyId}`),
        apiGet<{ enrollments: Enrollment[] }>(`/follow-up/enrollments?companyId=${companyId}`),
      ]);
      setWorkflows(w.workflows);
      setEnrollments(e.enrollments);
    } catch (ex: any) {
      setErr(ex.message ?? 'Could not load follow-up data.');
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  const selectedWorkflow = workflows.find((w) => w.workflow_key === enrollWorkflowKey);

  async function enroll() {
    if (!companyId || !selectedWorkflow || !enrollContextId.trim()) return;
    setBusy(true); setErr(''); setOk('');
    try {
      await apiSend('POST', '/follow-up/enroll', {
        companyId,
        workflowKey: selectedWorkflow.workflow_key,
        contextType: selectedWorkflow.context_type,
        contextId: enrollContextId.trim(),
      });
      setEnrollContextId(''); setShowEnroll(false);
      setOk('Enrolled.');
      await load();
    } catch (e: any) {
      setErr(e.message ?? 'Could not enroll.');
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(id: string, status: 'active' | 'paused' | 'stopped') {
    setBusy(true); setErr('');
    try {
      await apiSend('PATCH', `/follow-up/enrollments/${id}`, { status });
      await load();
    } catch (e: any) {
      setErr(e.message ?? 'Could not update.');
    } finally {
      setBusy(false);
    }
  }

  async function viewActions(id: string) {
    setErr('');
    try {
      const a = await apiGet<{ actions: ActionRow[] }>(`/follow-up/actions?enrollmentId=${id}`);
      setActions(a.actions);
      setSelectedId(id);
    } catch (e: any) {
      setErr(e.message ?? 'Could not load history.');
    }
  }

  async function runDueNow() {
    setBusy(true); setErr(''); setOk('');
    try {
      const result = await apiSend<{ processed: number; sent: number; skipped: number; awaitingApproval: number; completed: number; failed: number }>(
        'POST', '/follow-up/process-due', {},
      );
      setOk(`Processed ${result.processed}: ${result.sent} sent, ${result.skipped} skipped, ${result.awaitingApproval} awaiting approval, ${result.completed} completed, ${result.failed} failed.`);
      await load();
    } catch (e: any) {
      setErr(e.message ?? 'Could not run.');
    } finally {
      setBusy(false);
    }
  }

  if (!companyId) return <div className="card">Sign in to use Divini Follow-Up Desk.</div>;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Divini Follow-Up Desk</h1>
          <div className="sub">Rules-based reminders for stale opportunities, unfinished drafts, and expiring bids or credentials.</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn" onClick={() => setShowEnroll((v) => !v)}>{showEnroll ? 'Cancel' : '+ Enroll a record'}</button>
          {isAdmin && <button className="btn primary" disabled={busy} onClick={runDueNow}>Run due now</button>}
        </div>
      </div>

      {err && <div className="err">{err}</div>}
      {ok && <div className="ok">{ok}</div>}

      {showEnroll && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="two">
            <div className="field"><label>Workflow</label>
              <select value={enrollWorkflowKey} onChange={(e) => setEnrollWorkflowKey(e.target.value)}>
                <option value="">Select…</option>
                {workflows.map((w) => <option key={w.workflow_key} value={w.workflow_key}>{w.name} ({CONTEXT_LABEL[w.context_type] ?? w.context_type})</option>)}
              </select>
            </div>
            <div className="field"><label>Record ID</label>
              <input value={enrollContextId} onChange={(e) => setEnrollContextId(e.target.value)} placeholder="opportunity / draft / scope / credential ID" />
            </div>
          </div>
          <button className="btn primary" disabled={busy || !selectedWorkflow || !enrollContextId.trim()} onClick={enroll}>Enroll</button>
        </div>
      )}

      <div className="sectitle">Available workflows</div>
      <div className="card" style={{ padding: 0, marginBottom: 16 }}>
        <table>
          <thead><tr><th>Name</th><th>Applies to</th><th>Steps</th><th>Scope</th></tr></thead>
          <tbody>
            {workflows.length === 0 ? (
              <tr><td colSpan={4} className="note" style={{ padding: 12 }}>No workflows.</td></tr>
            ) : workflows.map((w) => (
              <tr key={w.id}>
                <td>{w.name}</td>
                <td className="note">{CONTEXT_LABEL[w.context_type] ?? w.context_type}</td>
                <td className="note">{w.steps.length}</td>
                <td><span className="badge b-neutral">{w.organization_id ? 'Custom' : 'Divini default'}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="sectitle">Active &amp; recent enrollments</div>
      <div className="card" style={{ padding: 0, marginBottom: 16 }}>
        <table>
          <thead><tr><th>Record</th><th>Status</th><th>Next action</th><th>Actions</th></tr></thead>
          <tbody>
            {enrollments.length === 0 ? (
              <tr><td colSpan={4} className="note" style={{ padding: 12 }}>No enrollments yet.</td></tr>
            ) : enrollments.map((e) => (
              <tr key={e.id}>
                <td className="note">{CONTEXT_LABEL[e.context_type] ?? e.context_type}<br /><span style={{ fontSize: 11 }}>{e.context_id}</span></td>
                <td><span className={`badge ${e.status === 'active' ? 'b-green' : e.status === 'completed' ? 'b-neutral' : 'b-amber'}`}>{e.status}</span></td>
                <td className="note">{e.next_action_at ? new Date(e.next_action_at).toLocaleString() : '-'}</td>
                <td>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    <button className="btn" style={{ padding: '2px 8px', fontSize: 11 }} onClick={() => void viewActions(e.id)}>History</button>
                    {e.status === 'active' && <button className="btn" style={{ padding: '2px 8px', fontSize: 11 }} onClick={() => setStatus(e.id, 'paused')}>Pause</button>}
                    {e.status === 'paused' && <button className="btn" style={{ padding: '2px 8px', fontSize: 11 }} onClick={() => setStatus(e.id, 'active')}>Resume</button>}
                    {(e.status === 'active' || e.status === 'paused') && <button className="btn" style={{ padding: '2px 8px', fontSize: 11 }} onClick={() => setStatus(e.id, 'stopped')}>Stop</button>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selectedId && (
        <div className="card">
          <div className="note" style={{ fontWeight: 700, marginBottom: 8 }}>Action history</div>
          {actions.length === 0 ? <div className="note">No actions logged yet.</div> : actions.map((a) => (
            <div key={a.id} className="note" style={{ fontSize: 12.5 }}>
              {a.action_type} · <span className={a.status === 'sent' ? '' : a.status === 'failed' ? '' : ''}>{a.status}</span> · {new Date(a.created_at).toLocaleString()}
              {a.failure_reason && ` · ${a.failure_reason}`}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
