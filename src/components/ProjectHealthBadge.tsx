/**
 * ProjectHealthBadge - shows a health score for a building, with optional breakdown.
 */
import { useEffect, useState } from 'react';

interface HealthSnapshot {
  score: number;
  budget_score: number | null;
  schedule_score: number | null;
  vendor_score: number | null;
  documentation_score: number | null;
  computed_at: string;
}

interface Props {
  buildingId: string;
  showDetails?: boolean;
}

function ScoreBar({ label, value }: { label: string; value: number | null }) {
  const pct = value != null ? (value / 25) * 100 : 0;
  return (
    <div style={{ marginBottom: '0.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--ink)', marginBottom: 2 }}>
        <span>{label}</span>
        <span>{value ?? 0}/25</span>
      </div>
      <div style={{ background: '#e5e7eb', borderRadius: 4, height: 6 }}>
        <div style={{ width: `${pct}%`, background: 'var(--emerald, #059669)', borderRadius: 4, height: 6, transition: 'width 0.3s' }} />
      </div>
    </div>
  );
}

export default function ProjectHealthBadge({ buildingId, showDetails = false }: Props) {
  const [snapshot, setSnapshot] = useState<HealthSnapshot | null | undefined>(undefined);
  const [expanded, setExpanded] = useState(showDetails);
  const [computing, setComputing] = useState(false);

  const load = async () => {
    const res = await fetch(`/api/project-health/${buildingId}`);
    if (res.ok) {
      const d = await res.json();
      setSnapshot(d.snapshot);
    }
  };

  useEffect(() => { load(); }, [buildingId]);

  const handleCompute = async () => {
    setComputing(true);
    try {
      const res = await fetch(`/api/project-health/${buildingId}/compute`, { method: 'POST' });
      if (res.ok) {
        await load();
        setExpanded(true);
      }
    } finally {
      setComputing(false);
    }
  };

  if (snapshot === undefined) {
    return <span style={{ fontSize: '0.8rem', color: 'var(--ink)', opacity: 0.4 }}>...</span>;
  }

  if (snapshot === null) {
    return (
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
        <span style={{ fontSize: '0.85rem', color: 'var(--ink)', opacity: 0.4 }}>—</span>
        <button
          className="btn"
          style={{ fontSize: '0.75rem', padding: '0.25rem 0.6rem' }}
          onClick={handleCompute}
          disabled={computing}
        >
          {computing ? '...' : 'Compute'}
        </button>
      </div>
    );
  }

  const { score } = snapshot;
  const colorClass =
    score >= 80
      ? 'bg-green-100 text-green-700 ring-1 ring-green-600/20'
      : score >= 60
      ? 'bg-amber-100 text-amber-700 ring-1 ring-amber-600/20'
      : 'bg-red-100 text-red-700 ring-1 ring-red-600/20';

  const inlineColor =
    score >= 80
      ? { background: '#dcfce7', color: '#15803d', boxShadow: '0 0 0 1px rgba(22,163,74,0.2)' }
      : score >= 60
      ? { background: '#fef3c7', color: '#b45309', boxShadow: '0 0 0 1px rgba(217,119,6,0.2)' }
      : { background: '#fee2e2', color: '#b91c1c', boxShadow: '0 0 0 1px rgba(220,38,38,0.2)' };

  return (
    <div style={{ display: 'inline-block' }}>
      <button
        onClick={() => setExpanded(v => !v)}
        className={colorClass}
        style={{
          ...inlineColor,
          borderRadius: '50%',
          width: 44,
          height: 44,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontWeight: 700,
          fontSize: '0.85rem',
          border: 'none',
          cursor: 'pointer',
        }}
        title={`Health score: ${score}/100`}
      >
        {score}
      </button>

      {expanded && (
        <div style={{ marginTop: '0.5rem', width: 180, background: '#fff', border: '1px solid var(--line, #e5e7eb)', borderRadius: 8, padding: '0.75rem', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}>
          <ScoreBar label="Budget" value={snapshot.budget_score} />
          <ScoreBar label="Schedule" value={snapshot.schedule_score} />
          <ScoreBar label="Vendors" value={snapshot.vendor_score} />
          <ScoreBar label="Docs" value={snapshot.documentation_score} />
          <button
            className="btn"
            style={{ width: '100%', fontSize: '0.75rem', padding: '0.3rem', marginTop: '0.5rem' }}
            onClick={handleCompute}
            disabled={computing}
          >
            {computing ? 'Computing...' : 'Recompute'}
          </button>
        </div>
      )}
    </div>
  );
}
