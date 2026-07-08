/**
 * Divini Score - the signed-in company's proprietary 0..100 procurement score
 * with a deterministic factor breakdown (rendered as bars). Admins additionally
 * see the cross-company leaderboard of latest scores.
 *
 * Deterministic: the score is computed server-side from real procurement
 * signals (bids, deliveries, submittals, reviews, projects, relationships).
 */
import { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth';
import { useFeatures } from '../lib/features';
import { apiGet } from '../lib/api';

type Factor = { key: string; label: string; points: number; max: number; detail: string };
type Score = {
  company_id: string;
  entity_kind: 'buyer' | 'vendor';
  score: number;
  factors: Factor[];
  computed_at: string;
};
type LeaderRow = {
  company_id: string;
  name: string;
  entity_kind: string;
  score: number;
  computed_at: string;
};

function band(score: number): { label: string; cls: string } {
  if (score >= 80) return { label: 'Excellent', cls: 'b-green' };
  if (score >= 60) return { label: 'Strong', cls: 'b-green' };
  if (score >= 40) return { label: 'Developing', cls: 'b-amber' };
  return { label: 'Needs work', cls: 'b-red' };
}

export default function DiviniScores() {
  const { company } = useAuth();
  const { isAdmin } = useFeatures();
  const [score, setScore] = useState<Score | null>(null);
  const [leaders, setLeaders] = useState<LeaderRow[]>([]);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!company) return;
    apiGet<Score>(`/divini-score/${company.id}`)
      .then(setScore)
      .catch((e) => setErr(e.message ?? 'Could not load Divini Score.'));
  }, [company]);

  useEffect(() => {
    if (!isAdmin) return;
    apiGet<{ scores: LeaderRow[] }>('/admin/divini-scores')
      .then((d) => setLeaders(d.scores ?? []))
      .catch(() => {});
  }, [isAdmin]);

  if (!company) return <div className="note">Loading…</div>;

  const b = score ? band(score.score) : null;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Divini Score</h1>
          <div className="sub">
            Your proprietary procurement health score, computed from real signals:{' '}
            {company.kind === 'vendor'
              ? 'bid win rate, on-time delivery, submittal approvals, reviews and profile completeness.'
              : 'project volume, award activity, payment reliability and relationship breadth.'}
          </div>
        </div>
      </div>

      {err && <div className="err">{err}</div>}

      {score && (
        <div className="card">
          <div className="two" style={{ alignItems: 'center', gap: 18 }}>
            <div>
              <div style={{ fontSize: 52, fontWeight: 700, lineHeight: 1 }}>{score.score}</div>
              <div className="note">out of 100</div>
            </div>
            <div>
              {b && <span className={`badge ${b.cls}`}>{b.label}</span>}
              <div className="note" style={{ marginTop: 6 }}>
                {score.entity_kind === 'vendor' ? 'Vendor' : 'Developer'} score for {company.name}
              </div>
              <div className="note">Computed {new Date(score.computed_at).toLocaleString()}</div>
            </div>
          </div>

          <div style={{ marginTop: 18, display: 'grid', gap: 14 }}>
            {score.factors.map((f) => {
              const pct = f.max > 0 ? Math.round((f.points / f.max) * 100) : 0;
              return (
                <div key={f.key}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                    <strong>{f.label}</strong>
                    <span className="note">
                      {f.points} / {f.max}
                    </span>
                  </div>
                  <div
                    style={{
                      height: 8,
                      borderRadius: 6,
                      background: 'rgba(255,255,255,0.08)',
                      overflow: 'hidden',
                      marginTop: 4,
                    }}
                  >
                    <div
                      style={{
                        width: `${pct}%`,
                        height: '100%',
                        background: 'var(--accent, #b8924a)',
                      }}
                    />
                  </div>
                  <div className="note" style={{ marginTop: 3 }}>
                    {f.detail}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {isAdmin && (
        <>
          <div className="page-head" style={{ marginTop: 22 }}>
            <div>
              <h1 style={{ fontSize: 18 }}>Score leaderboard</h1>
              <div className="sub">Latest computed Divini Score across all companies.</div>
            </div>
          </div>
          <div className="card" style={{ padding: 0 }}>
            <table>
              <thead>
                <tr>
                  <th>Company</th>
                  <th>Type</th>
                  <th>Score</th>
                  <th>Computed</th>
                </tr>
              </thead>
              <tbody>
                {leaders.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="note" style={{ padding: 14 }}>
                      No scores computed yet. Open a company's score to compute it.
                    </td>
                  </tr>
                ) : (
                  leaders.map((r) => (
                    <tr key={r.company_id}>
                      <td>
                        <strong>{r.name}</strong>
                      </td>
                      <td>
                        <span className="badge b-neutral">
                          {r.entity_kind === 'vendor' ? 'Vendor' : 'Developer'}
                        </span>
                      </td>
                      <td>
                        <span className={`badge ${band(r.score).cls}`}>{r.score}</span>
                      </td>
                      <td className="note">{new Date(r.computed_at).toLocaleDateString()}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
