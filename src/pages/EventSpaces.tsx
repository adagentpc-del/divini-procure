/**
 * Event-Space / Venue bridge profiles (developer / buyer).
 *
 * A developer manages event-space / venue profiles tied to a project: name,
 * capacity, photo URLs, a venue profile link out to Divini Partners, preferred
 * vendors, procurement needs, and sponsorship opportunities. List + edit, with
 * an availability toggle.
 *
 * This bridges Divini Procure to Divini Partners: the venue profile link points
 * at the corresponding Divini Partners venue, where venue booking and
 * sponsorship workflows live.
 */
import { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth';
import { apiGet, apiSend } from '../lib/api';

type Project = { id: string; name?: string };
type EventSpace = Record<string, any> & {
  id: string;
  name?: string;
  capacity?: number;
  event_space_available?: boolean;
  photos?: string[];
  preferred_vendors?: string[];
};

const lines = (arr?: string[]) => (arr ?? []).join('\n');
const toLines = (s: string) =>
  s
    .split('\n')
    .map((x) => x.trim())
    .filter((x) => x !== '');

const EMPTY = {
  projectId: '',
  name: '',
  capacity: '',
  venueProfileLink: '',
  procurementNeeds: '',
  sponsorshipOpportunities: '',
  eventSpaceAvailable: true,
};

export default function EventSpaces() {
  const { company } = useAuth();
  const [spaces, setSpaces] = useState<EventSpace[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [busy, setBusy] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const [form, setForm] = useState<Record<string, any>>({ ...EMPTY });
  const [photosText, setPhotosText] = useState('');
  const [vendorsText, setVendorsText] = useState('');

  async function load() {
    if (!company) return;
    try {
      const r = await apiGet<{ eventSpaces: EventSpace[] }>(`/event-spaces?companyId=${company.id}`);
      setSpaces(r.eventSpaces ?? []);
    } catch (e: any) {
      setErr(e.message ?? 'Could not load event spaces.');
    }
  }
  async function loadProjects() {
    if (!company) return;
    try {
      const r = await apiGet<Project[]>(`/buildings?companyId=${company.id}`);
      setProjects(Array.isArray(r) ? r : []);
    } catch {
      /* projects are optional context */
    }
  }
  useEffect(() => {
    void load();
    void loadProjects();
    /* eslint-disable-next-line */
  }, [company]);

  if (!company) return <div className="note">Loading…</div>;
  if (company.kind !== 'buyer') return <div className="card">This page is for developer accounts.</div>;

  const setF = (k: string, v: any) => setForm((p) => ({ ...p, [k]: v }));

  async function create() {
    if (!company) return;
    setBusy(true);
    setErr('');
    setOk('');
    try {
      await apiSend('POST', '/event-spaces', {
        companyId: company.id,
        ...form,
        projectId: form.projectId || undefined,
        capacity: form.capacity === '' ? undefined : Number(form.capacity),
        photos: toLines(photosText),
        preferredVendors: toLines(vendorsText),
      });
      setForm({ ...EMPTY });
      setPhotosText('');
      setVendorsText('');
      setOk('Event space created.');
      await load();
    } catch (e: any) {
      setErr(e.message ?? 'Could not create event space.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Event spaces & venues</h1>
          <div className="sub">
            Surface event-space and venue profiles for your projects. These bridge to Divini Partners for venue
            booking and sponsorship.
          </div>
        </div>
      </div>

      <div className="note" style={{ marginBottom: 12 }}>
        Bridges to Divini Partners: use the venue profile link to point at the matching Divini Partners venue,
        where sponsorship and booking workflows live.
      </div>

      {err && <div className="err">{err}</div>}
      {ok && <div className="ok">{ok}</div>}

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="note" style={{ fontWeight: 700, marginBottom: 10 }}>New event space</div>
        <div className="two">
          <div className="field">
            <label>Project (optional)</label>
            <select value={form.projectId} onChange={(e) => setF('projectId', e.target.value)}>
              <option value="">None</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name || p.id}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Name</label>
            <input value={form.name} onChange={(e) => setF('name', e.target.value)} />
          </div>
          <div className="field">
            <label>Capacity</label>
            <input type="number" value={form.capacity} onChange={(e) => setF('capacity', e.target.value)} />
          </div>
          <div className="field">
            <label>Venue profile link (Divini Partners)</label>
            <input
              value={form.venueProfileLink}
              onChange={(e) => setF('venueProfileLink', e.target.value)}
              placeholder="https://divinipartners.com/venue/…"
            />
          </div>
        </div>
        <div className="field">
          <label>Photo URLs (one per line)</label>
          <textarea rows={2} value={photosText} onChange={(e) => setPhotosText(e.target.value)} />
        </div>
        <div className="field">
          <label>Preferred vendors (one per line)</label>
          <textarea rows={2} value={vendorsText} onChange={(e) => setVendorsText(e.target.value)} />
        </div>
        <div className="field">
          <label>Procurement needs</label>
          <textarea
            rows={2}
            value={form.procurementNeeds}
            onChange={(e) => setF('procurementNeeds', e.target.value)}
          />
        </div>
        <div className="field">
          <label>Sponsorship opportunities</label>
          <textarea
            rows={2}
            value={form.sponsorshipOpportunities}
            onChange={(e) => setF('sponsorshipOpportunities', e.target.value)}
          />
        </div>
        <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginBottom: 10 }}>
          <label className="note">
            <input
              type="checkbox"
              checked={form.eventSpaceAvailable}
              onChange={(e) => setF('eventSpaceAvailable', e.target.checked)}
            />{' '}
            Event space available
          </label>
        </div>
        <button className="btn primary" disabled={busy} onClick={create}>
          Create event space
        </button>
      </div>

      <div className="card" style={{ padding: 0, marginBottom: 16 }}>
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Project</th>
              <th>Capacity</th>
              <th>Available</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {spaces.length === 0 ? (
              <tr>
                <td colSpan={5} className="note" style={{ padding: 14 }}>No event spaces yet.</td>
              </tr>
            ) : (
              spaces.map((s) => (
                <tr key={s.id}>
                  <td><strong>{s.name || '-'}</strong></td>
                  <td className="note">{s.project_name || '-'}</td>
                  <td>{s.capacity ?? '-'}</td>
                  <td>
                    <span className={'badge ' + (s.event_space_available ? 'ok' : 'b-neutral')}>
                      {s.event_space_available ? 'Available' : 'Unavailable'}
                    </span>
                  </td>
                  <td>
                    <button className="btn" onClick={() => setOpenId(openId === s.id ? null : s.id)}>
                      {openId === s.id ? 'Close' : 'Edit'}
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {openId && <SpaceEdit key={openId} space={spaces.find((s) => s.id === openId)!} onChanged={load} />}
    </>
  );
}

function SpaceEdit({ space, onChanged }: { space: EventSpace; onChanged: () => void }) {
  const [s, setS] = useState<EventSpace>({ ...space });
  const [photosText, setPhotosText] = useState(lines(space.photos));
  const [vendorsText, setVendorsText] = useState(lines(space.preferred_vendors));
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [busy, setBusy] = useState(false);

  const setK = (k: string, v: any) => setS((p) => ({ ...p, [k]: v }));

  async function save() {
    setBusy(true);
    setErr('');
    setOk('');
    try {
      await apiSend('PATCH', `/event-spaces/${space.id}`, {
        name: s.name,
        capacity: s.capacity == null || String(s.capacity) === '' ? null : Number(s.capacity),
        eventSpaceAvailable: !!s.event_space_available,
        venueProfileLink: s.venue_profile_link,
        procurementNeeds: s.procurement_needs,
        sponsorshipOpportunities: s.sponsorship_opportunities,
        photos: toLines(photosText),
        preferredVendors: toLines(vendorsText),
      });
      setOk('Saved.');
      onChanged();
    } catch (e: any) {
      setErr(e.message ?? 'Could not save.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="note" style={{ fontWeight: 700, marginBottom: 10 }}>Edit event space</div>
      {err && <div className="err">{err}</div>}
      {ok && <div className="ok">{ok}</div>}
      <div className="two">
        <div className="field"><label>Name</label><input value={s.name ?? ''} onChange={(e) => setK('name', e.target.value)} /></div>
        <div className="field"><label>Capacity</label><input type="number" value={s.capacity ?? ''} onChange={(e) => setK('capacity', e.target.value)} /></div>
        <div className="field"><label>Venue profile link (Divini Partners)</label><input value={s.venue_profile_link ?? ''} onChange={(e) => setK('venue_profile_link', e.target.value)} /></div>
      </div>
      <div className="field"><label>Photo URLs (one per line)</label><textarea rows={2} value={photosText} onChange={(e) => setPhotosText(e.target.value)} /></div>
      <div className="field"><label>Preferred vendors (one per line)</label><textarea rows={2} value={vendorsText} onChange={(e) => setVendorsText(e.target.value)} /></div>
      <div className="field"><label>Procurement needs</label><textarea rows={2} value={s.procurement_needs ?? ''} onChange={(e) => setK('procurement_needs', e.target.value)} /></div>
      <div className="field"><label>Sponsorship opportunities</label><textarea rows={2} value={s.sponsorship_opportunities ?? ''} onChange={(e) => setK('sponsorship_opportunities', e.target.value)} /></div>
      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginBottom: 10 }}>
        <label className="note"><input type="checkbox" checked={!!s.event_space_available} onChange={(e) => setK('event_space_available', e.target.checked)} /> Event space available</label>
      </div>
      <button className="btn primary" disabled={busy} onClick={save}>Save changes</button>
    </div>
  );
}
