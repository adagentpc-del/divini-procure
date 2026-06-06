import { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { getBuildings } from '../lib/db';

export default function Projects() {
  const { company } = useAuth();
  const [rows, setRows] = useState<any[]>([]);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [location, setLocation] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    if (company) setRows(await getBuildings(company.id));
  }
  useEffect(() => { load(); }, [company]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!company) return;
    setBusy(true);
    await supabase.from('buildings').insert({
      company_id: company.id, name, location, developer: company.name, progress: 0,
    });
    setName(''); setLocation(''); setAdding(false); setBusy(false);
    load();
  }

  return (
    <>
      <div className="page-head">
        <div><h1>Projects</h1><div className="sub">Your developments &amp; bid packages</div></div>
        <button className="btn primary" onClick={() => setAdding(a => !a)}>{adding ? 'Cancel' : '+ New project'}</button>
      </div>

      {adding && (
        <div className="card" style={{ marginBottom: 14 }}>
          <form onSubmit={create}>
            <div className="two">
              <div className="field"><label>Project / building name</label>
                <input value={name} onChange={e => setName(e.target.value)} required placeholder="Building 1" /></div>
              <div className="field"><label>Location</label>
                <input value={location} onChange={e => setLocation(e.target.value)} placeholder="Miami, FL" /></div>
            </div>
            <button className="btn primary" disabled={busy || !name}>{busy ? 'Saving…' : 'Create project'}</button>
          </form>
        </div>
      )}

      <div className="card">
        <table>
          <thead><tr><th>Project</th><th>Location</th><th>Progress</th></tr></thead>
          <tbody>
            {rows.length === 0
              ? <tr><td colSpan={3} className="note">No projects yet — create your first one.</td></tr>
              : rows.map(b => (
                <tr key={b.id} className="row-click">
                  <td><strong>{b.name}</strong></td>
                  <td>{b.location ?? '—'}</td>
                  <td>{b.progress ?? 0}%</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
