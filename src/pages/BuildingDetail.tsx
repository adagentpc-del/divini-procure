import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { useFeatures } from '../lib/features';
import { getBuilding, getPackages, createPackage } from '../lib/db';
import DocumentPanel from '../components/DocumentPanel';

const CATEGORIES = ['Concrete', 'Steel', 'Electrical', 'Plumbing', 'HVAC', 'Millwork', 'Cabinetry', 'Doors', 'Drapery', 'Flooring', 'Windows', 'Glazing', 'Lighting', 'Furniture', 'Signage', 'Security', 'Landscaping', 'Roofing', 'Elevators', 'Fire Protection'];

export default function BuildingDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { company } = useAuth();
  const { isOn } = useFeatures();
  const [b, setB] = useState<any>(null);
  const [pkgs, setPkgs] = useState<any[]>([]);
  const [adding, setAdding] = useState(false);
  const [cat, setCat] = useState(CATEGORIES[0]);
  const [deadline, setDeadline] = useState('');
  const [bmin, setBmin] = useState('');
  const [bmax, setBmax] = useState('');
  const isOwner = company && b && b.company_id === company.id;

  async function load() {
    if (!id) return;
    setB(await getBuilding(id));
    setPkgs(await getPackages(id));
  }
  useEffect(() => { load(); }, [id]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!id) return;
    await createPackage(id, {
      category: cat, status: 'open', deadline: deadline || undefined,
      budget_min: bmin ? Number(bmin) : undefined, budget_max: bmax ? Number(bmax) : undefined,
    });
    setAdding(false); setDeadline(''); setBmin(''); setBmax('');
    load();
  }

  if (!b) return <div className="note">Loading…</div>;

  return (
    <>
      <div className="page-head">
        <div>
          <a className="note" style={{ cursor: 'pointer' }} onClick={() => nav('/projects')}>← Projects</a>
          <h1>{b.name}</h1>
          <div className="sub">{b.location ?? '-'} · {b.developer ?? ''}</div>
        </div>
        {isOwner && <button className="btn primary" onClick={() => setAdding(a => !a)}>{adding ? 'Cancel' : '+ New bid package'}</button>}
      </div>

      {adding && (
        <div className="card" style={{ marginBottom: 14 }}>
          <form onSubmit={add}>
            <div className="two">
              <div className="field"><label>Trade / category</label>
                <select value={cat} onChange={e => setCat(e.target.value)}>{CATEGORIES.map(c => <option key={c}>{c}</option>)}</select></div>
              <div className="field"><label>Bid deadline</label>
                <input type="date" value={deadline} onChange={e => setDeadline(e.target.value)} /></div>
            </div>
            <div className="two">
              <div className="field"><label>Budget min ($)</label><input value={bmin} onChange={e => setBmin(e.target.value)} /></div>
              <div className="field"><label>Budget max ($)</label><input value={bmax} onChange={e => setBmax(e.target.value)} /></div>
            </div>
            <button className="btn primary">Create package</button>
          </form>
        </div>
      )}

      <div className="sectitle">Bid packages</div>
      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead><tr><th>Category</th><th>Status</th><th>Budget</th><th>Deadline</th></tr></thead>
          <tbody>
            {pkgs.length === 0 ? <tr><td colSpan={4} className="note" style={{ padding: 14 }}>No packages yet.</td></tr>
              : pkgs.map(p => (
                <tr key={p.id} className="row-click" onClick={() => nav('/package/' + p.id)}>
                  <td><strong>{p.category}</strong></td>
                  <td><span className="badge b-neutral">{p.status}</span></td>
                  <td>{p.budget_min || p.budget_max ? `$${Number(p.budget_min || 0).toLocaleString()}–$${Number(p.budget_max || 0).toLocaleString()}` : '-'}</td>
                  <td>{p.deadline ?? '-'}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {isOn('cad_documents') && (
        <>
          <div className="sectitle">Project documents &amp; CAD</div>
          <DocumentPanel buildingId={b.id} canUpload={!!isOwner} />
        </>
      )}
    </>
  );
}
