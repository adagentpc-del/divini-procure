/**
 * General Contractor (GC) workspace for Divini Procure.
 *
 * A GC (or the developer / owner of a project) picks a project from the list of
 * projects they can access (GET /my-projects), then sees that project's field /
 * construction items grouped by kind: install requirements, logistics,
 * dimensions, delivery coordination, licenses, insurance, and field conflicts.
 * They can create a new item and advance its status (open -> in_progress ->
 * resolved | blocked | closed). Backend lives at /api/projects/:projectId/gc-items.
 */
import { useEffect, useState } from 'react';
import { apiGet, apiSend } from '../lib/api';

type Project = { id: string; name: string; role: string };

type Item = {
  id: string;
  project_id: string;
  kind: string;
  title: string;
  detail: string | null;
  status: string;
  created_by: string | null;
  created_at: string;
};

const KINDS: [string, string][] = [
  ['install_requirement', 'Install Requirements'],
  ['logistics', 'Logistics'],
  ['dimension', 'Dimensions'],
  ['delivery_coordination', 'Delivery Coordination'],
  ['license', 'Licenses'],
  ['insurance', 'Insurance'],
  ['field_conflict', 'Field Conflicts'],
];

const STATUSES = ['open', 'in_progress', 'resolved', 'blocked', 'closed'];

const STATUS_CLS: Record<string, string> = {
  open: 'badge b-neutral',
  in_progress: 'badge b-amber',
  resolved: 'badge b-green',
  blocked: 'badge b-red',
  closed: 'badge b-neutral',
};
const statusCls = (s: string) => STATUS_CLS[s] ?? 'badge b-neutral';

export default function GcDashboard() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState('');
  const [items, setItems] = useState<Item[]>([]);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [busy, setBusy] = useState(false);

  // create form
  const [kind, setKind] = useState<string>('install_requirement');
  const [title, setTitle] = useState('');
  const [detail, setDetail] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const d = await apiGet<{ projects: Project[] }>('/my-projects');
        setProjects(d.projects ?? []);
        if (d.projects && d.projects.length) setProjectId((p) => p || d.projects[0].id);
      } catch (e: any) {
        setErr(e.message ?? 'Could not load projects.');
      }
    })();
  }, []);

  async function load() {
    if (!projectId) {
      setItems([]);
      return;
    }
    try {
      const d = await apiGet<{ items: Item[] }>(
        `/projects/${encodeURIComponent(projectId)}/gc-items`,
      );
      setItems(d.items ?? []);
      setErr('');
    } catch (e: any) {
      setErr(e.message ?? 'Could not load items.');
      setItems([]);
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!projectId || !title.trim()) return;
    setBusy(true);
    setErr('');
    setOk('');
    try {
      await apiSend('POST', `/projects/${encodeURIComponent(projectId)}/gc-items`, {
        kind,
        title: title.trim(),
        detail: detail.trim() || undefined,
      });
      setTitle('');
      setDetail('');
      setOk('Item added.');
      await load();
    } catch (e: any) {
      setErr(e.message ?? 'Could not add item.');
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(id: string, status: string) {
    setBusy(true);
    setErr('');
    setOk('');
    try {
      await apiSend('PATCH', `/gc-items/${encodeURIComponent(id)}`, { status });
      await load();
    } catch (e: any) {
      setErr(e.message ?? 'Could not update status.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1>General Contractor Workspace</h1>
        <p className="note">
          Track install requirements, logistics, dimensions, delivery coordination, licenses,
          insurance, and field conflicts for a project.
        </p>
      </div>

      {err && <div className="err">{err}</div>}
      {ok && <div className="ok">{ok}</div>}

      <div className="card">
        <label className="field">
          <span>Project</span>
          <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            {projects.length === 0 && <option value="">No projects available</option>}
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.role})
              </option>
            ))}
          </select>
        </label>
      </div>

      {projectId && (
        <div className="card">
          <h3>Add item</h3>
          <form onSubmit={create}>
            <div className="two">
              <label className="field">
                <span>Kind</span>
                <select value={kind} onChange={(e) => setKind(e.target.value)}>
                  {KINDS.map(([k, label]) => (
                    <option key={k} value={k}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Title</span>
                <input value={title} onChange={(e) => setTitle(e.target.value)} required />
              </label>
            </div>
            <label className="field">
              <span>Detail</span>
              <textarea value={detail} onChange={(e) => setDetail(e.target.value)} rows={2} />
            </label>
            <button className="btn" type="submit" disabled={busy || !title.trim()}>
              Add item
            </button>
          </form>
        </div>
      )}

      {projectId &&
        KINDS.map(([k, label]) => {
          const group = items.filter((it) => it.kind === k);
          return (
            <div className="card" key={k}>
              <h3>
                {label} <span className="note">({group.length})</span>
              </h3>
              {group.length === 0 ? (
                <p className="note">None yet.</p>
              ) : (
                <table className="table">
                  <thead>
                    <tr>
                      <th>Title</th>
                      <th>Detail</th>
                      <th>Status</th>
                      <th>Advance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.map((it) => (
                      <tr key={it.id}>
                        <td>{it.title}</td>
                        <td>{it.detail}</td>
                        <td>
                          <span className={statusCls(it.status)}>{it.status}</span>
                        </td>
                        <td>
                          <select
                            value={it.status}
                            disabled={busy}
                            onChange={(e) => setStatus(it.id, e.target.value)}
                          >
                            {STATUSES.map((s) => (
                              <option key={s} value={s}>
                                {s}
                              </option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          );
        })}
    </div>
  );
}
