/**
 * Relationship Graph - the signed-in company's procurement neighborhood, built
 * deterministically from real signals (bids, awards, grandfathered/standard fee
 * relationships, current engagements). Renders a compact inline SVG spoke layout
 * plus a grouped table of counterparts by edge type.
 *
 * Edges are directed developer -> vendor (the developer owns the relationship),
 * but the graph for a company shows connections in either direction.
 */
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../lib/auth';
import { apiGet } from '../lib/api';

type Node = { id: string; name: string; kind: string };
type Edge = { from: string; to: string; type: string; weight: number; detail?: Record<string, unknown> | null };
type Graph = { company_id: string; nodes: Node[]; edges: Edge[] };

const EDGE_LABEL: Record<string, string> = {
  bid: 'Bidding',
  awarded: 'Awarded work',
  grandfathered: 'Grandfathered relationship',
  relationship: 'Tracked relationship',
  engagement: 'Current engagement',
  referral: 'Referral',
};

const EDGE_CLS: Record<string, string> = {
  bid: 'b-neutral',
  awarded: 'b-green',
  grandfathered: 'b-green',
  relationship: 'b-amber',
  engagement: 'b-neutral',
  referral: 'b-amber',
};

export default function RelationshipGraph() {
  const { company } = useAuth();
  const [graph, setGraph] = useState<Graph | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!company) return;
    apiGet<Graph>(`/relationship/graph?companyId=${company.id}`)
      .then(setGraph)
      .catch((e) => setErr(e.message ?? 'Could not load the relationship graph.'));
  }, [company]);

  const nameOf = useMemo(() => {
    const m = new Map<string, Node>();
    (graph?.nodes ?? []).forEach((n) => m.set(n.id, n));
    return m;
  }, [graph]);

  // Group edges by type, resolving the counterpart (the node that is not self).
  const grouped = useMemo(() => {
    const out: Record<string, Array<{ counterpart: Node | undefined; weight: number; direction: string }>> = {};
    if (!graph || !company) return out;
    for (const e of graph.edges) {
      const counterpartId = e.from === company.id ? e.to : e.from;
      const direction = e.from === company.id ? 'outgoing' : 'incoming';
      (out[e.type] ??= []).push({ counterpart: nameOf.get(counterpartId), weight: e.weight, direction });
    }
    return out;
  }, [graph, company, nameOf]);

  if (!company) return <div className="note">Loading…</div>;

  // Build a simple force-free spoke layout: self in the center, counterparts
  // arranged on a circle around it.
  const neighbors = (graph?.nodes ?? []).filter((n) => n.id !== company.id);
  const W = 520;
  const Hsvg = 320;
  const cx = W / 2;
  const cy = Hsvg / 2;
  const R = 110;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Relationship Graph</h1>
          <div className="sub">
            Your procurement network: companies you connect to through bids, awards, tracked relationships and
            current engagements. Computed deterministically from real activity.
          </div>
        </div>
      </div>

      {err && <div className="err">{err}</div>}

      {graph && neighbors.length > 0 && (
        <div className="card">
          <svg viewBox={`0 0 ${W} ${Hsvg}`} width="100%" style={{ maxWidth: W }}>
            {neighbors.map((n, i) => {
              const angle = (2 * Math.PI * i) / neighbors.length - Math.PI / 2;
              const x = cx + R * Math.cos(angle);
              const y = cy + R * Math.sin(angle);
              return (
                <line
                  key={`l-${n.id}`}
                  x1={cx}
                  y1={cy}
                  x2={x}
                  y2={y}
                  stroke="rgba(255,255,255,0.18)"
                  strokeWidth={1.2}
                />
              );
            })}
            {neighbors.map((n, i) => {
              const angle = (2 * Math.PI * i) / neighbors.length - Math.PI / 2;
              const x = cx + R * Math.cos(angle);
              const y = cy + R * Math.sin(angle);
              return (
                <g key={`n-${n.id}`}>
                  <circle cx={x} cy={y} r={7} fill={n.kind === 'vendor' ? '#b8924a' : '#5b8def'} />
                  <text x={x} y={y - 11} textAnchor="middle" fontSize={10} fill="currentColor">
                    {n.name.length > 18 ? n.name.slice(0, 17) + '…' : n.name}
                  </text>
                </g>
              );
            })}
            <circle cx={cx} cy={cy} r={11} fill="#fff" />
            <text x={cx} y={cy + 26} textAnchor="middle" fontSize={11} fill="currentColor">
              {company.name}
            </text>
          </svg>
        </div>
      )}

      {Object.keys(grouped).length === 0 ? (
        <div className="card">
          <div className="note">
            No relationships yet. Once you bid, award or record engagements, your network appears here. An admin can
            rebuild the graph from the latest activity.
          </div>
        </div>
      ) : (
        Object.entries(grouped).map(([type, rows]) => (
          <div key={type} style={{ marginTop: 12 }}>
            <div className="page-head">
              <div>
                <h1 style={{ fontSize: 16 }}>
                  <span className={`badge ${EDGE_CLS[type] ?? 'b-neutral'}`}>{EDGE_LABEL[type] ?? type}</span>{' '}
                  <span className="note">({rows.length})</span>
                </h1>
              </div>
            </div>
            <div className="card" style={{ padding: 0 }}>
              <table>
                <thead>
                  <tr>
                    <th>Counterpart</th>
                    <th>Type</th>
                    <th>Direction</th>
                    <th>Weight</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i}>
                      <td>
                        <strong>{r.counterpart?.name ?? 'Unknown'}</strong>
                      </td>
                      <td>
                        <span className="badge b-neutral">
                          {r.counterpart?.kind === 'vendor' ? 'Vendor' : 'Developer'}
                        </span>
                      </td>
                      <td className="note">{r.direction}</td>
                      <td>{r.weight}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))
      )}
    </>
  );
}
