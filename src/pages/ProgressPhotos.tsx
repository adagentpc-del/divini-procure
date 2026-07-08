/**
 * Progress Photos page
 */
import { useEffect, useState } from 'react';

interface Building {
  id: string;
  name: string;
}

interface Photo {
  id: string;
  building_id: string;
  storage_path: string;
  caption: string | null;
  phase: string | null;
  taken_at: string | null;
  is_milestone: boolean;
  visible_to_investors: boolean;
  uploaded_by_email: string;
  created_at: string;
}

const PHASES = [
  { value: '', label: 'All' },
  { value: 'pre_construction', label: 'Pre-Construction' },
  { value: 'foundation', label: 'Foundation' },
  { value: 'framing', label: 'Framing' },
  { value: 'mep_rough', label: 'MEP' },
  { value: 'drywall', label: 'Drywall' },
  { value: 'finishes', label: 'Finishes' },
];

function phaseBadge(phase: string | null) {
  if (!phase) return null;
  const label = phase.replace(/_/g, ' ');
  return <span className="badge b-neutral" style={{ textTransform: 'capitalize', fontSize: '0.75rem' }}>{label}</span>;
}

function fmtDate(d: string | null) {
  if (!d) return null;
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function ProgressPhotos() {
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [selectedBuilding, setSelectedBuilding] = useState('');
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [phase, setPhase] = useState('');
  const [investorOnly, setInvestorOnly] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({
    storagePath: '',
    caption: '',
    phase: '',
    takenAt: '',
    isMilestone: false,
    visibleToInvestors: false,
  });

  useEffect(() => {
    fetch('/api/buildings')
      .then(r => r.ok ? r.json() : { buildings: [] })
      .then(d => {
        const list = d.buildings ?? [];
        setBuildings(list);
        if (list.length) setSelectedBuilding(list[0].id);
      });
  }, []);

  const loadPhotos = async () => {
    if (!selectedBuilding) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ buildingId: selectedBuilding });
      if (phase) params.set('phase', phase);
      if (investorOnly) params.set('investorView', 'true');
      const res = await fetch(`/api/progress-photos?${params}`);
      if (res.ok) {
        const d = await res.json();
        setPhotos(d.photos ?? []);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadPhotos(); }, [selectedBuilding, phase, investorOnly]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.storagePath || !selectedBuilding) return;
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        buildingId: selectedBuilding,
        storagePath: form.storagePath,
        isMilestone: form.isMilestone,
        visibleToInvestors: form.visibleToInvestors,
      };
      if (form.caption) body.caption = form.caption;
      if (form.phase) body.phase = form.phase;
      if (form.takenAt) body.takenAt = form.takenAt;

      const res = await fetch('/api/progress-photos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setForm({ storagePath: '', caption: '', phase: '', takenAt: '', isMilestone: false, visibleToInvestors: false });
        setShowForm(false);
        loadPhotos();
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this photo?')) return;
    await fetch(`/api/progress-photos/${id}`, { method: 'DELETE' });
    setPhotos(prev => prev.filter(p => p.id !== id));
  };

  const handleToggleMilestone = async (photo: Photo) => {
    await fetch(`/api/progress-photos/${photo.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isMilestone: !photo.is_milestone }),
    });
    setPhotos(prev => prev.map(p => p.id === photo.id ? { ...p, is_milestone: !p.is_milestone } : p));
  };

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '2rem 1.5rem' }}>
      <div style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: '1.6rem', fontWeight: 700, color: 'var(--ink)', marginBottom: '0.4rem' }}>
          Progress Photos 📸
        </h1>
        <p style={{ color: 'var(--ink)', opacity: 0.6, margin: 0 }}>
          Document your build's progress to keep investors and lenders informed.
        </p>
      </div>

      {/* Controls */}
      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '1.5rem' }}>
        <select
          className="input"
          value={selectedBuilding}
          onChange={e => setSelectedBuilding(e.target.value)}
          style={{ minWidth: 180 }}
        >
          {buildings.map(b => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </select>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.875rem', color: 'var(--ink)' }}>
          <input type="checkbox" checked={investorOnly} onChange={e => setInvestorOnly(e.target.checked)} />
          Investor Visible Only
        </label>
        <button className="btn primary" onClick={() => setShowForm(v => !v)} style={{ marginLeft: 'auto' }}>
          {showForm ? 'Cancel' : '+ Add Photo'}
        </button>
      </div>

      {/* Phase tabs */}
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1.5rem' }}>
        {PHASES.map(p => (
          <button
            key={p.value}
            onClick={() => setPhase(p.value)}
            style={{
              padding: '0.35rem 0.85rem',
              borderRadius: 20,
              border: '1px solid var(--line, #e5e7eb)',
              background: phase === p.value ? 'var(--emerald, #059669)' : '#fff',
              color: phase === p.value ? '#fff' : 'var(--ink)',
              fontSize: '0.85rem',
              cursor: 'pointer',
              fontWeight: phase === p.value ? 600 : 400,
            }}
          >
            {p.label}
          </button>
        ))}
        <button
          onClick={() => setPhase('is_milestone')}
          style={{
            padding: '0.35rem 0.85rem',
            borderRadius: 20,
            border: '1px solid var(--line, #e5e7eb)',
            background: phase === 'is_milestone' ? '#fbbf24' : '#fff',
            color: phase === 'is_milestone' ? '#fff' : 'var(--ink)',
            fontSize: '0.85rem',
            cursor: 'pointer',
          }}
        >
          ⭐ Milestone
        </button>
      </div>

      {/* Add Photo Form */}
      {showForm && (
        <form className="card" onSubmit={handleAdd} style={{ padding: '1.5rem', marginBottom: '1.5rem' }}>
          <h3 style={{ margin: '0 0 1rem', fontSize: '1rem', fontWeight: 700 }}>Add Photo</h3>
          <p style={{ fontSize: '0.8rem', color: 'var(--ink)', opacity: 0.6, marginBottom: '1rem' }}>
            Use the document upload to get a storage path, then enter it here.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '1rem', marginBottom: '1rem' }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.875rem', gridColumn: '1 / -1' }}>
              Storage Path *
              <input
                className="input"
                type="text"
                required
                placeholder="/uploads/project/photo.jpg"
                value={form.storagePath}
                onChange={e => setForm(f => ({ ...f, storagePath: e.target.value }))}
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.875rem' }}>
              Caption
              <input
                className="input"
                type="text"
                value={form.caption}
                onChange={e => setForm(f => ({ ...f, caption: e.target.value }))}
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.875rem' }}>
              Phase
              <select className="input" value={form.phase} onChange={e => setForm(f => ({ ...f, phase: e.target.value }))}>
                <option value="">Select phase</option>
                {PHASES.filter(p => p.value).map(p => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
                <option value="substantial_completion">Substantial Completion</option>
                <option value="final">Final</option>
                <option value="other">Other</option>
              </select>
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.875rem' }}>
              Date Taken
              <input
                className="input"
                type="date"
                value={form.takenAt}
                onChange={e => setForm(f => ({ ...f, takenAt: e.target.value }))}
              />
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.875rem', paddingTop: 20 }}>
              <input type="checkbox" checked={form.isMilestone} onChange={e => setForm(f => ({ ...f, isMilestone: e.target.checked }))} />
              Milestone ⭐
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.875rem', paddingTop: 20 }}>
              <input type="checkbox" checked={form.visibleToInvestors} onChange={e => setForm(f => ({ ...f, visibleToInvestors: e.target.checked }))} />
              Visible to Investors
            </label>
          </div>
          <button className="btn primary" type="submit" disabled={saving}>
            {saving ? 'Uploading...' : 'Add Photo'}
          </button>
        </form>
      )}

      {/* Photo Grid */}
      {loading ? (
        <p style={{ color: 'var(--ink)', opacity: 0.5 }}>Loading photos...</p>
      ) : photos.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '3rem' }}>
          <p style={{ color: 'var(--ink)', opacity: 0.6 }}>
            No progress photos yet. Document your build's progress to keep investors and lenders informed.
          </p>
        </div>
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: '1rem',
        }}>
          <style>{`
            @media (max-width: 768px) { .photo-grid { grid-template-columns: repeat(2, 1fr) !important; } }
            @media (max-width: 480px) { .photo-grid { grid-template-columns: 1fr !important; } }
          `}</style>
          {photos.map(photo => (
            <div
              key={photo.id}
              className="card"
              style={{
                overflow: 'hidden',
                padding: 0,
                ...(photo.is_milestone ? { boxShadow: '0 0 0 2px #fbbf24' } : {}),
              }}
            >
              <div style={{ position: 'relative' }}>
                <img
                  src={`/api/documents/download?path=${encodeURIComponent(photo.storage_path)}`}
                  alt={photo.caption ?? ''}
                  style={{ width: '100%', height: 192, objectFit: 'cover' }}
                  onError={e => {
                    e.currentTarget.src = '';
                    e.currentTarget.style.background = '#e2e8f0';
                  }}
                />
                {photo.is_milestone && (
                  <span style={{ position: 'absolute', top: 8, right: 8, fontSize: '1.2rem' }}>⭐</span>
                )}
              </div>
              <div style={{ padding: '0.75rem' }}>
                {photo.caption && (
                  <p style={{ margin: '0 0 0.4rem', fontWeight: 600, fontSize: '0.9rem', color: 'var(--ink)' }}>{photo.caption}</p>
                )}
                <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '0.5rem' }}>
                  {phaseBadge(photo.phase)}
                  {photo.taken_at && (
                    <span style={{ fontSize: '0.75rem', color: 'var(--ink)', opacity: 0.55 }}>{fmtDate(photo.taken_at)}</span>
                  )}
                  {photo.visible_to_investors && (
                    <span className="badge b-green" style={{ fontSize: '0.7rem' }}>Investor</span>
                  )}
                </div>
                <div style={{ display: 'flex', gap: '0.4rem' }}>
                  <button
                    onClick={() => handleToggleMilestone(photo)}
                    style={{ background: 'none', border: '1px solid var(--line, #e5e7eb)', borderRadius: 6, cursor: 'pointer', fontSize: '0.75rem', padding: '0.2rem 0.5rem', color: 'var(--ink)', opacity: 0.7 }}
                  >
                    {photo.is_milestone ? 'Unstar' : '⭐ Star'}
                  </button>
                  <button
                    onClick={() => handleDelete(photo.id)}
                    style={{ background: 'none', border: '1px solid var(--line, #e5e7eb)', borderRadius: 6, cursor: 'pointer', fontSize: '0.75rem', padding: '0.2rem 0.5rem', color: '#ef4444' }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
