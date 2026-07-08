/**
 * DrawRequestView -- public tokenized lender-facing view.
 * Accessed via /lender-view/:token. No auth, no navigation.
 */
import { useEffect, useState } from 'react';

interface Building {
  id: string;
  name: string;
  address?: string;
  city?: string;
  state?: string;
  developer_name?: string;
}

interface DrawRequest {
  id: string;
  draw_number: number;
  period_start?: string;
  period_end?: string;
  this_draw_cents: number;
  status: string;
  submitted_at?: string;
  percent_complete?: number;
}

interface Summary {
  totalDrawnCents: number;
  lastDrawDate: string | null;
  latestPercentComplete: number | null;
}

interface PortalData {
  building: Building;
  developer: { name: string };
  drawRequests: DrawRequest[];
  summary: Summary;
}

const dollars = (cents: number) =>
  (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

const fmtDate = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '--';

const STATUS_BADGE: Record<string, { bg: string; color: string; label: string }> = {
  draft:        { bg: '#f3f4f6', color: '#374151', label: 'Draft' },
  submitted:    { bg: '#dbeafe', color: '#1d4ed8', label: 'Submitted' },
  under_review: { bg: '#fef9c3', color: '#92400e', label: 'Under Review' },
  approved:     { bg: '#dcfce7', color: '#15803d', label: 'Approved' },
  rejected:     { bg: '#fee2e2', color: '#b91c1c', label: 'Rejected' },
  funded:       { bg: '#d1fae5', color: '#065f46', label: 'Funded' },
};

function StatusPill({ status }: { status: string }) {
  const s = STATUS_BADGE[status] ?? { bg: '#f3f4f6', color: '#374151', label: status };
  return (
    <span style={{
      display: 'inline-block',
      padding: '0.2rem 0.65rem',
      borderRadius: 999,
      fontSize: '0.8rem',
      fontWeight: 600,
      background: s.bg,
      color: s.color,
    }}>
      {s.label}
    </span>
  );
}

export default function DrawRequestView() {
  const token = window.location.pathname.split('/').filter(Boolean).pop() ?? '';
  const [data, setData] = useState<PortalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    if (!token) { setInvalid(true); setLoading(false); return; }
    fetch(`/api/lender/portal/${token}`)
      .then(r => {
        if (r.status === 404) { setInvalid(true); return null; }
        return r.json();
      })
      .then(d => { if (d) setData(d); })
      .catch(() => setInvalid(true))
      .finally(() => setLoading(false));
  }, [token]);

  const containerStyle: React.CSSProperties = {
    maxWidth: 800,
    margin: '0 auto',
    padding: '2.5rem 1.5rem',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    color: '#111827',
  };

  if (loading) {
    return (
      <div style={containerStyle}>
        <p style={{ color: '#6b7280' }}>Loading project data...</p>
      </div>
    );
  }

  if (invalid || !data) {
    return (
      <div style={containerStyle}>
        <div style={{
          border: '1px solid #fca5a5',
          background: '#fef2f2',
          borderRadius: 10,
          padding: '2rem',
          textAlign: 'center',
          marginBottom: '2rem',
        }}>
          <p style={{ fontSize: '1.1rem', fontWeight: 600, color: '#b91c1c', margin: '0 0 0.5rem' }}>
            Link Invalid or Expired
          </p>
          <p style={{ color: '#374151', margin: 0, fontSize: '0.95rem' }}>
            This link is invalid or has expired. Please contact your developer for a new link.
          </p>
        </div>
        <p style={{ textAlign: 'center', color: '#9ca3af', fontSize: '0.8rem' }}>Powered by Divini Procure</p>
      </div>
    );
  }

  const { building, developer, drawRequests, summary } = data;
  const location = [building.city, building.state].filter(Boolean).join(', ');

  return (
    <div style={containerStyle}>
      {/* Header */}
      <div style={{ marginBottom: '2rem', paddingBottom: '1.5rem', borderBottom: '1px solid #e5e7eb' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.75rem' }}>
          <div>
            <h1 style={{ fontSize: '1.75rem', fontWeight: 800, color: '#111827', margin: '0 0 0.25rem' }}>
              {building.name}
            </h1>
            {location && <p style={{ color: '#6b7280', margin: '0 0 0.25rem', fontSize: '0.95rem' }}>{location}</p>}
            <p style={{ color: '#6b7280', margin: 0, fontSize: '0.875rem' }}>
              Developer: <strong style={{ color: '#374151' }}>{developer.name ?? building.developer_name ?? '--'}</strong>
            </p>
          </div>
          <div style={{
            background: '#f0fdf4',
            border: '1px solid #bbf7d0',
            borderRadius: 8,
            padding: '0.5rem 1rem',
            fontSize: '0.8rem',
            color: '#166534',
            fontWeight: 600,
          }}>
            Lender View
          </div>
        </div>
      </div>

      {/* Summary stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
        {[
          { label: 'Total Drawn', value: dollars(summary.totalDrawnCents) },
          { label: 'Last Draw Date', value: fmtDate(summary.lastDrawDate) },
          { label: 'Overall % Complete', value: summary.latestPercentComplete != null ? `${summary.latestPercentComplete}%` : '--' },
          { label: 'Total Draws', value: String(drawRequests.length) },
        ].map(stat => (
          <div key={stat.label} style={{
            background: '#f9fafb',
            border: '1px solid #e5e7eb',
            borderRadius: 10,
            padding: '1rem 1.25rem',
          }}>
            <p style={{ margin: '0 0 0.25rem', fontSize: '0.75rem', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>
              {stat.label}
            </p>
            <p style={{ margin: 0, fontSize: '1.3rem', fontWeight: 700, color: '#111827' }}>{stat.value}</p>
          </div>
        ))}
      </div>

      {/* Draw request history */}
      <div style={{ marginBottom: '2rem' }}>
        <h2 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#111827', marginBottom: '0.75rem' }}>
          Draw Request History
        </h2>
        {drawRequests.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '2.5rem', background: '#f9fafb', borderRadius: 10, border: '1px solid #e5e7eb' }}>
            <p style={{ color: '#6b7280', margin: 0 }}>No draw requests submitted yet.</p>
          </div>
        ) : (
          <div style={{ border: '1px solid #e5e7eb', borderRadius: 10, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
              <thead>
                <tr style={{ background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                  {['Draw #', 'Period', 'Amount', 'Status', 'Date'].map(h => (
                    <th key={h} style={{ padding: '0.75rem 1rem', textAlign: 'left', color: '#6b7280', fontWeight: 600, fontSize: '0.8rem' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {drawRequests.map((dr, i) => (
                  <tr key={dr.id} style={{ borderBottom: i < drawRequests.length - 1 ? '1px solid #e5e7eb' : 'none' }}>
                    <td style={{ padding: '0.875rem 1rem', fontWeight: 700, color: '#111827' }}>#{dr.draw_number}</td>
                    <td style={{ padding: '0.875rem 1rem', color: '#374151' }}>
                      {dr.period_start || dr.period_end
                        ? `${fmtDate(dr.period_start)} -- ${fmtDate(dr.period_end)}`
                        : '--'}
                    </td>
                    <td style={{ padding: '0.875rem 1rem', color: '#111827', fontWeight: 600 }}>
                      {dollars(dr.this_draw_cents)}
                    </td>
                    <td style={{ padding: '0.875rem 1rem' }}>
                      <StatusPill status={dr.status} />
                    </td>
                    <td style={{ padding: '0.875rem 1rem', color: '#6b7280' }}>
                      {fmtDate(dr.submitted_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Footer */}
      <div style={{ paddingTop: '1.5rem', borderTop: '1px solid #e5e7eb', textAlign: 'center' }}>
        <p style={{ color: '#9ca3af', fontSize: '0.8rem', margin: 0 }}>
          Powered by{' '}
          <strong style={{ color: '#374151' }}>Divini Procure</strong>
          {' '} -- Construction Financial Intelligence
        </p>
      </div>
    </div>
  );
}
