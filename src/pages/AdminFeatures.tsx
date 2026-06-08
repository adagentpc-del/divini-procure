import { useFeatures } from '../lib/features';
import { supabase } from '../lib/supabase';

const AUD: Record<string, string> = { both: 'Developer + Vendor', buyer: 'Developer', vendor: 'Vendor', admin: 'Admin' };

export default function AdminFeatures() {
  const { flags, reload, isAdmin } = useFeatures();
  if (!isAdmin) return <div className="card">Admins only.</div>;

  async function toggle(key: string, enabled: boolean) {
    await supabase.from('feature_flags').update({ enabled }).eq('key', key);
    await reload();
  }
  async function setAudience(key: string, audience: string) {
    await supabase.from('feature_flags').update({ audience }).eq('key', key);
    await reload();
  }

  const cats = Array.from(new Set(flags.map(f => f.category ?? 'Other')));

  return (
    <>
      <div className="page-head"><div><h1>Features</h1>
        <div className="sub">Turn capabilities on/off and choose who sees them. Changes apply instantly across the platform.</div></div></div>

      {cats.map(cat => (
        <div key={cat}>
          <div className="sectitle">{cat}</div>
          <div className="card" style={{ padding: 0 }}>
            <table>
              <thead><tr><th>Feature</th><th>Audience</th><th style={{ width: 90 }}>Status</th></tr></thead>
              <tbody>
                {flags.filter(f => (f.category ?? 'Other') === cat).map(f => (
                  <tr key={f.key}>
                    <td>
                      <strong>{f.label}</strong>
                      <div className="note" style={{ marginTop: 2 }}>{f.description}</div>
                    </td>
                    <td>
                      <select value={f.audience} onChange={e => setAudience(f.key, e.target.value)} style={{ width: 170 }}>
                        {Object.entries(AUD).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                      </select>
                    </td>
                    <td>
                      <button className={'btn' + (f.enabled ? ' primary' : '')} onClick={() => toggle(f.key, !f.enabled)}>
                        {f.enabled ? 'On' : 'Off'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </>
  );
}
