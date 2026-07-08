/**
 * Messaging Boundaries policy page.
 *
 * Renders the who-can-message-whom matrix for any signed-in user. The matrix is
 * served from GET /admin/messaging-policy (a public-to-authed read). Three
 * statuses: allowed (open), conditional (needs an approval/permission), and
 * blocked (no channel). Admins can always message everyone; developer <->
 * investor needs an approved introduction.
 */
import { useEffect, useState } from 'react';
import { apiGet } from '../lib/api';

type Row = {
  from: string;
  to: string;
  status: 'allowed' | 'conditional' | 'blocked';
  rule: string;
};

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const badgeCls = (s: string) =>
  s === 'allowed' ? 'badge b-green' : s === 'blocked' ? 'badge b-red' : 'badge b-amber';

const badgeLabel = (s: string) =>
  s === 'allowed' ? 'Allowed' : s === 'blocked' ? 'Blocked' : 'Conditional';

export default function MessagingPolicy() {
  const [rows, setRows] = useState<Row[]>([]);
  const [err, setErr] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const d = await apiGet<{ matrix: Row[] }>('/admin/messaging-policy');
        setRows(d.matrix ?? []);
      } catch (e: any) {
        setErr(e.message ?? 'Could not load the messaging policy.');
      }
    })();
  }, []);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Messaging Boundaries</h1>
          <div className="sub">
            Who may message whom on Divini Procure. These boundaries keep the platform the broker
            of record. Admins may always message everyone. Developer and investor messaging opens
            only after an introduction is approved, and a designer or general contractor may reach a
            vendor only when permissioned on the project.
          </div>
        </div>
      </div>

      {err && <div className="err">{err}</div>}

      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr>
              <th>From</th>
              <th>To</th>
              <th>Status</th>
              <th>Rule</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={4} className="note" style={{ padding: 14 }}>
                  No policy rows.
                </td>
              </tr>
            ) : (
              rows.map((r, i) => (
                <tr key={i}>
                  <td>
                    <strong>{cap(r.from)}</strong>
                  </td>
                  <td>{cap(r.to)}</td>
                  <td>
                    <span className={badgeCls(r.status)}>{badgeLabel(r.status)}</span>
                  </td>
                  <td className="note">{r.rule}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="note" style={{ marginTop: 12 }}>
        Pairs are direction-agnostic: if a row allows A to message B, B may reply to A. Any pair not
        listed here is denied by default.
      </div>
    </>
  );
}
