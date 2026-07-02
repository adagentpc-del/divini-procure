/**
 * Divini Procure - AI COO executive dashboard.
 *
 * A signed-in company (buyer or vendor) sees:
 *   - the daily briefing (headline, top priorities, risks, revenue ops)
 *   - the business health score with per-dimension bars
 *   - the COO task list, with mark in-progress / done controls
 *   - a command-center question box with canned-question buttons
 *
 * Admins additionally see the portfolio rollup (/api/admin/coo/overview).
 *
 * DETERMINISTIC: every number comes from the backend engines; no AI runs here.
 * Uses the standard Procure styles (card, page-head, table, btn, badge, note).
 */
import { useEffect, useState, type CSSProperties } from 'react';
import { useAuth } from '../lib/auth';
import { useFeatures } from '../lib/features';
import { apiGet, apiSend } from '../lib/api';

type Task = {
  id: string;
  title: string;
  detail: string;
  category: string;
  impact: number;
  urgency: number;
  score: number;
  status: string;
  link: string;
};

type Dimension = { score: number; raw: Record<string, number> };
type Health = { score: number; dimensions: Record<string, Dimension> };

type Briefing = {
  date: string;
  headline: string;
  topPriorities: Task[];
  revenueOpportunities: string[];
  risks: string[];
  healthScore: number;
};

type CommandAnswer = { answer: string; data: Record<string, unknown> };

type AdminOverview = {
  totals: {
    companies: number;
    open_tasks: number;
    urgent_tasks: number;
    pending_relationship_reviews: number;
  };
  topTasks: (Task & { company_name: string | null })[];
  lowestHealth: { company_id: string; company_name: string | null; score: number; computed_at: string }[];
};

const CANNED = [
  { key: 'what_needs_my_attention', label: 'What needs my attention?' },
  { key: 'how_is_my_pipeline', label: 'How is my pipeline?' },
  { key: 'where_am_i_losing_money', label: 'Where am I losing money?' },
  { key: 'what_is_overdue', label: 'What is overdue?' },
  { key: 'how_healthy_is_my_business', label: 'How healthy is my business?' },
];

const DIM_LABEL: Record<string, string> = {
  pipeline: 'Pipeline',
  conversion: 'Conversion',
  revenue: 'Revenue',
  delivery: 'Delivery',
  submittals: 'Submittals',
  compliance: 'Compliance',
  relationships: 'Relationships',
};

function scoreClass(n: number): string {
  if (n >= 70) return 'b-green';
  if (n >= 45) return 'b-amber';
  return 'b-red';
}

// A small section caption (theme.css has no standalone .label rule).
const CAP: CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '.4px',
  opacity: 0.65,
  margin: '2px 0 4px',
};

function barColor(n: number): string {
  if (n >= 70) return '#10b981';
  if (n >= 45) return '#f59e0b';
  return '#ef4444';
}

export default function CooDashboard() {
  const { company } = useAuth();
  const { isAdmin } = useFeatures();

  const [briefing, setBriefing] = useState<Briefing | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [answer, setAnswer] = useState<CommandAnswer | null>(null);
  const [question, setQuestion] = useState('');
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [err, setErr] = useState('');
  const [asking, setAsking] = useState(false);

  async function load() {
    if (!company) return;
    setErr('');
    try {
      const [b, hd, t] = await Promise.all([
        apiGet<{ briefing: Briefing }>(`/coo/briefing?companyId=${company.id}`),
        apiGet<Health>(`/business-health?companyId=${company.id}`),
        apiGet<{ tasks: Task[] }>(`/coo/tasks?companyId=${company.id}`),
      ]);
      setBriefing(b.briefing);
      setHealth(hd);
      setTasks(t.tasks ?? []);
    } catch (e: any) {
      setErr(e?.message ?? 'Could not load the executive dashboard.');
    }
    if (isAdmin) {
      try {
        setOverview(await apiGet<AdminOverview>('/admin/coo/overview'));
      } catch {
        /* admin rollup is optional */
      }
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [company?.id, isAdmin]);

  async function setStatus(id: string, status: string) {
    if (!company) return;
    try {
      await apiSend('PATCH', `/coo/tasks/${id}`, { companyId: company.id, status });
      setTasks((prev) =>
        prev
          .map((x) => (x.id === id ? { ...x, status } : x))
          .filter((x) => x.status !== 'dismissed'),
      );
    } catch (e: any) {
      setErr(e?.message ?? 'Could not update the task.');
    }
  }

  async function ask(key: string) {
    if (!company) return;
    setAsking(true);
    setErr('');
    try {
      const res = await apiSend<CommandAnswer>('POST', '/command-center', {
        companyId: company.id,
        question: key,
      });
      setAnswer(res);
    } catch (e: any) {
      setErr(e?.message ?? 'Could not answer that question.');
    } finally {
      setAsking(false);
    }
  }

  if (!company) return <div className="note">Loading…</div>;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>AI COO</h1>
          <div className="sub">
            Your deterministic executive cockpit: a daily briefing, business health, a ranked task feed,
            and a command center, all computed from your live procurement data.
          </div>
        </div>
      </div>

      {err && <div className="err">{err}</div>}

      {/* Daily briefing */}
      {briefing && (
        <div className="card">
          <div className="note" style={{ marginBottom: 6 }}>Daily briefing - {briefing.date}</div>
          <h2 style={{ margin: '4px 0 10px' }}>{briefing.headline}</h2>
          <div className="two">
            <div>
              <div style={CAP}>Top priorities</div>
              {briefing.topPriorities.length === 0 ? (
                <div className="note">Nothing open. You are clear.</div>
              ) : (
                <ul style={{ margin: '6px 0', paddingLeft: 18 }}>
                  {briefing.topPriorities.map((t) => (
                    <li key={t.id} style={{ marginBottom: 4 }}>
                      <strong>{t.title}</strong>{' '}
                      <span className={`badge ${scoreClass(100 - t.score * 4)}`}>score {t.score}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <div style={CAP}>Risks</div>
              {briefing.risks.length === 0 ? (
                <div className="note">No elevated risks.</div>
              ) : (
                <ul style={{ margin: '6px 0', paddingLeft: 18 }}>
                  {briefing.risks.map((r, i) => (
                    <li key={i} style={{ marginBottom: 4 }} className="note">{r}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          {briefing.revenueOpportunities.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <div style={CAP}>Revenue opportunities</div>
              <ul style={{ margin: '6px 0', paddingLeft: 18 }}>
                {briefing.revenueOpportunities.map((r, i) => (
                  <li key={i} style={{ marginBottom: 4 }} className="note">{r}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Business health */}
      {health && (
        <div className="card">
          <div className="page-head" style={{ marginBottom: 8 }}>
            <div>
              <h2 style={{ margin: 0 }}>
                Business health{' '}
                <span className={`badge ${scoreClass(health.score)}`}>{health.score}/100</span>
              </h2>
              <div className="sub">Equal-weighted across seven procurement dimensions.</div>
            </div>
          </div>
          <div style={{ display: 'grid', gap: 8 }}>
            {Object.entries(health.dimensions).map(([key, dim]) => (
              <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 120, fontSize: 13 }}>{DIM_LABEL[key] ?? key}</div>
                <div style={{ flex: 1, background: 'rgba(0,0,0,0.08)', borderRadius: 6, height: 12 }}>
                  <div
                    style={{
                      width: `${dim.score}%`,
                      background: barColor(dim.score),
                      height: 12,
                      borderRadius: 6,
                      transition: 'width .3s',
                    }}
                  />
                </div>
                <div style={{ width: 44, textAlign: 'right', fontSize: 13 }}>{dim.score}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Command center */}
      <div className="card">
        <div className="page-head" style={{ marginBottom: 8 }}>
          <div>
            <h2 style={{ margin: 0 }}>Command center</h2>
            <div className="sub">Ask a question. Answers are deterministic, built from your data.</div>
          </div>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
          {CANNED.map((c) => (
            <button key={c.key} className="btn" disabled={asking} onClick={() => ask(c.key)}>
              {c.label}
            </button>
          ))}
        </div>
        <div className="field" style={{ display: 'flex', gap: 8 }}>
          <input
            placeholder="Ask: what needs my attention?"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && question.trim()) ask(question.trim());
            }}
            style={{ flex: 1 }}
          />
          <button
            className="btn primary"
            disabled={asking || !question.trim()}
            onClick={() => question.trim() && ask(question.trim())}
          >
            Ask
          </button>
        </div>
        {answer && (
          <div className="note" style={{ marginTop: 10 }}>
            <strong>Answer:</strong> {answer.answer}
          </div>
        )}
      </div>

      {/* COO task feed */}
      <div className="card" style={{ padding: 0 }}>
        <div style={{ padding: '12px 14px 0' }}>
          <h2 style={{ margin: 0 }}>Task feed</h2>
          <div className="sub">Ranked by impact x urgency. Mark progress as you act.</div>
        </div>
        <table>
          <thead>
            <tr>
              <th>Task</th>
              <th>Category</th>
              <th>Score</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {tasks.length === 0 ? (
              <tr><td colSpan={5} className="note" style={{ padding: 14 }}>No open tasks. Nicely done.</td></tr>
            ) : (
              tasks.map((t) => (
                <tr key={t.id}>
                  <td>
                    <strong>{t.title}</strong>
                    <div className="note">{t.detail}</div>
                  </td>
                  <td><span className="badge b-neutral">{t.category}</span></td>
                  <td><span className={`badge ${scoreClass(100 - t.score * 4)}`}>{t.score}</span></td>
                  <td className="note">{t.status === 'in_progress' ? 'In progress' : t.status === 'done' ? 'Done' : 'Open'}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {t.status !== 'in_progress' && t.status !== 'done' && (
                      <button className="btn" onClick={() => setStatus(t.id, 'in_progress')}>Start</button>
                    )}{' '}
                    {t.status !== 'done' && (
                      <button className="btn" onClick={() => setStatus(t.id, 'done')}>Done</button>
                    )}{' '}
                    <button className="btn" onClick={() => setStatus(t.id, 'dismissed')}>Dismiss</button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Admin portfolio rollup (optional) */}
      {isAdmin && overview && (
        <div className="card">
          <div className="page-head" style={{ marginBottom: 8 }}>
            <div>
              <h2 style={{ margin: 0 }}>Portfolio (admin)</h2>
              <div className="sub">Rollup across all companies.</div>
            </div>
          </div>
          <div className="two" style={{ marginBottom: 12 }}>
            <div className="note">Companies: <strong>{overview.totals.companies}</strong></div>
            <div className="note">Open tasks: <strong>{overview.totals.open_tasks}</strong></div>
            <div className="note">Urgent tasks: <strong>{overview.totals.urgent_tasks}</strong></div>
            <div className="note">
              Pending relationship reviews: <strong>{overview.totals.pending_relationship_reviews}</strong>
            </div>
          </div>
          <div style={CAP}>Lowest health</div>
          <table>
            <thead><tr><th>Company</th><th>Score</th></tr></thead>
            <tbody>
              {overview.lowestHealth.length === 0 ? (
                <tr><td colSpan={2} className="note" style={{ padding: 10 }}>No health snapshots yet.</td></tr>
              ) : (
                overview.lowestHealth.map((c) => (
                  <tr key={c.company_id}>
                    <td>{c.company_name ?? c.company_id}</td>
                    <td><span className={`badge ${scoreClass(c.score)}`}>{c.score}/100</span></td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
