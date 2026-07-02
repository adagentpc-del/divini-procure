/**
 * War Room - a ranked, deterministic health scan of a developer/vendor's
 * portfolio (and any single project). Flags surface missing documents, overdue
 * submittals, late/blocked deliveries, awarded vendors with no confirmed fee
 * relationship, fee-rule gaps, and thin bid coverage. Critical issues first.
 *
 * Default view is the portfolio (all of the company's projects). A ?projectId=
 * query (or the per-project read) drills into one project.
 */
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { apiGet } from '../lib/api';

type Level = 'low' | 'medium' | 'high' | 'critical';
type Flag = {
  level: Level;
  title: string;
  detail: string;
  link: string | null;
  building_id?: string;
  building_name?: string;
};
type PortfolioResp = {
  scope: 'portfolio';
  company_id: string;
  building_count: number;
  flags: Flag[];
};
type ProjectResp = {
  scope: 'project';
  building: { id: string; name: string } | null;
  flags: Flag[];
};

const LEVEL_CLS: Record<Level, string> = {
  critical: 'b-red',
  high: 'b-red',
  medium: 'b-amber',
  low: 'b-neutral',
};

const LEVEL_LABEL: Record<Level, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

export default function WarRoom() {
  const { company } = useAuth();
  const [params] = useSearchParams();
  const projectId = params.get('projectId') || '';
  const [flags, setFlags] = useState<Flag[]>([]);
  const [title, setTitle] = useState('');
  const [meta, setMeta] = useState('');
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!company) return;
    setLoading(true);
    setErr('');
    const path = projectId
      ? `/war-room?projectId=${projectId}`
      : `/war-room?companyId=${company.id}`;
    apiGet<PortfolioResp | ProjectResp>(path)
      .then((d) => {
        setFlags(d.flags ?? []);
        if (d.scope === 'project') {
          setTitle(d.building?.name ? `War Room - ${d.building.name}` : 'Project War Room');
          setMeta('Health scan for this project.');
        } else {
          setTitle('War Room');
          setMeta(`Health scan across ${d.building_count} project${d.building_count === 1 ? '' : 's'}.`);
        }
      })
      .catch((e) => setErr(e.message ?? 'Could not load the War Room.'))
      .finally(() => setLoading(false));
  }, [company, projectId]);

  if (!company) return <div className="note">Loading…</div>;

  const counts = flags.reduce(
    (acc, f) => {
      acc[f.level] = (acc[f.level] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{title || 'War Room'}</h1>
          <div className="sub">{meta || 'Ranked operational risks across your projects, most urgent first.'}</div>
        </div>
      </div>

      {err && <div className="err">{err}</div>}

      {!loading && (
        <div className="card" style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {(['critical', 'high', 'medium', 'low'] as Level[]).map((lv) => (
            <span key={lv} className={`badge ${LEVEL_CLS[lv]}`}>
              {LEVEL_LABEL[lv]}: {counts[lv] ?? 0}
            </span>
          ))}
          {flags.length === 0 && <span className="ok">All clear. No flags.</span>}
        </div>
      )}

      <div className="card" style={{ padding: 0, marginTop: 12 }}>
        <table>
          <thead>
            <tr>
              <th>Level</th>
              <th>Issue</th>
              {!projectId && <th>Project</th>}
              <th>Detail</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {flags.length === 0 ? (
              <tr>
                <td colSpan={projectId ? 4 : 5} className="note" style={{ padding: 14 }}>
                  {loading ? 'Scanning…' : 'No flags. Everything looks healthy.'}
                </td>
              </tr>
            ) : (
              flags.map((f, i) => (
                <tr key={i}>
                  <td>
                    <span className={`badge ${LEVEL_CLS[f.level]}`}>{LEVEL_LABEL[f.level]}</span>
                  </td>
                  <td>
                    <strong>{f.title}</strong>
                  </td>
                  {!projectId && <td className="note">{f.building_name ?? ''}</td>}
                  <td className="note">{f.detail}</td>
                  <td>
                    {f.link ? (
                      <a className="btn" href={f.link}>
                        Open
                      </a>
                    ) : null}
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
