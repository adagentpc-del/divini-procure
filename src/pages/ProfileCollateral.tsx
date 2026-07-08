/**
 * Profile collateral (developer / buyer AND vendor).
 *
 * Any company can:
 *   1. Upload pitch decks / marketing collateral and attach them to its profile.
 *      Uploads REUSE the standard documents pipeline (POST /api/documents), then
 *      we link the returned storage_path to a profile_decks row. Decks marked
 *      public surface on the public profile; downloads use the same signed URL.
 *   2. Publish custom programs / offerings (title, summary, details, price /
 *      terms text, a call to action) that render on its public profile when
 *      active.
 *
 * This is the owner-facing management surface. The PUBLIC rendering of decks +
 * active programs lives on the public profile page.
 */
import { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth';
import { apiGet, apiSend, apiUpload } from '../lib/api';

type Deck = {
  id: string;
  title?: string;
  description?: string;
  file_name?: string;
  storage_path?: string;
  is_public?: boolean;
  sort?: number;
  download_url?: string;
};

type Program = {
  id: string;
  title?: string;
  summary?: string;
  details?: string;
  price_terms?: string;
  cta_label?: string;
  cta_url?: string;
  active?: boolean;
  sort?: number;
};

const EMPTY_PROGRAM = {
  title: '',
  summary: '',
  details: '',
  priceTerms: '',
  ctaLabel: '',
  ctaUrl: '',
  active: true,
  sort: 0,
};

export default function ProfileCollateral() {
  const { company } = useAuth();
  const [decks, setDecks] = useState<Deck[]>([]);
  const [programs, setPrograms] = useState<Program[]>([]);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');

  // Deck upload form.
  const [file, setFile] = useState<File | null>(null);
  const [deckTitle, setDeckTitle] = useState('');
  const [deckDescription, setDeckDescription] = useState('');
  const [deckPublic, setDeckPublic] = useState(true);
  const [uploading, setUploading] = useState(false);

  // Program form.
  const [pform, setPform] = useState<Record<string, any>>({ ...EMPTY_PROGRAM });
  const [psaving, setPsaving] = useState(false);
  const [openProgram, setOpenProgram] = useState<string | null>(null);

  async function load() {
    if (!company) return;
    try {
      const [d, p] = await Promise.all([
        apiGet<{ decks: Deck[] }>(`/profile-decks?companyId=${company.id}`),
        apiGet<{ programs: Program[] }>(`/profile-programs?companyId=${company.id}`),
      ]);
      setDecks(d.decks ?? []);
      setPrograms(p.programs ?? []);
    } catch (e: any) {
      setErr(e.message ?? 'Could not load collateral.');
    }
  }
  useEffect(() => {
    void load();
    /* eslint-disable-next-line */
  }, [company]);

  if (!company) return <div className="note">Loading…</div>;

  const setPF = (k: string, v: any) => setPform((p) => ({ ...p, [k]: v }));

  async function uploadDeck() {
    if (!company || !file) return;
    setUploading(true);
    setErr('');
    setOk('');
    try {
      // 1. Upload the file through the standard documents pipeline.
      const form = new FormData();
      form.append('file', file);
      form.append('companyId', company.id);
      const doc = await apiUpload<{ storage_path: string; name: string }>('/documents', form);
      // 2. Link it as a profile deck.
      await apiSend('POST', '/profile-decks', {
        companyId: company.id,
        storagePath: doc.storage_path,
        title: deckTitle || doc.name,
        description: deckDescription,
        fileName: doc.name,
        isPublic: deckPublic,
      });
      setFile(null);
      setDeckTitle('');
      setDeckDescription('');
      setDeckPublic(true);
      setOk('Deck uploaded.');
      await load();
    } catch (e: any) {
      setErr(e.message ?? 'Could not upload deck.');
    } finally {
      setUploading(false);
    }
  }

  async function toggleDeckPublic(d: Deck) {
    try {
      await apiSend('PATCH', `/profile-decks/${d.id}`, { isPublic: !d.is_public });
      await load();
    } catch (e: any) {
      setErr(e.message ?? 'Could not update deck.');
    }
  }

  async function deleteDeck(d: Deck) {
    try {
      await apiSend('DELETE', `/profile-decks/${d.id}`);
      await load();
    } catch (e: any) {
      setErr(e.message ?? 'Could not remove deck.');
    }
  }

  async function createProgram() {
    if (!company) return;
    setPsaving(true);
    setErr('');
    setOk('');
    try {
      await apiSend('POST', '/profile-programs', { companyId: company.id, ...pform });
      setPform({ ...EMPTY_PROGRAM });
      setOk('Program created.');
      await load();
    } catch (e: any) {
      setErr(e.message ?? 'Could not create program.');
    } finally {
      setPsaving(false);
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Profile collateral</h1>
          <div className="sub">
            Upload pitch decks and marketing collateral and publish custom programs or offerings on your public
            profile. Available to {company.kind === 'vendor' ? 'vendors' : 'developers'} and buyers.
          </div>
        </div>
      </div>

      {err && <div className="err">{err}</div>}
      {ok && <div className="ok">{ok}</div>}

      {/* ---- DECKS ---- */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="note" style={{ fontWeight: 700, marginBottom: 10 }}>Upload pitch deck / collateral</div>
        <div className="two">
          <div className="field">
            <label>File</label>
            <input
              type="file"
              onChange={(e) => setFile(e.target.files && e.target.files[0] ? e.target.files[0] : null)}
            />
          </div>
          <div className="field">
            <label>Title</label>
            <input value={deckTitle} onChange={(e) => setDeckTitle(e.target.value)} placeholder="Defaults to file name" />
          </div>
        </div>
        <div className="field">
          <label>Description (optional)</label>
          <textarea rows={2} value={deckDescription} onChange={(e) => setDeckDescription(e.target.value)} />
        </div>
        <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginBottom: 10 }}>
          <label className="note">
            <input type="checkbox" checked={deckPublic} onChange={(e) => setDeckPublic(e.target.checked)} /> Show on
            public profile
          </label>
        </div>
        <button className="btn primary" disabled={uploading || !file} onClick={uploadDeck}>
          {uploading ? 'Uploading…' : 'Upload deck'}
        </button>
      </div>

      <div className="card" style={{ padding: 0, marginBottom: 16 }}>
        <table>
          <thead>
            <tr>
              <th>Title</th>
              <th>File</th>
              <th>Public</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {decks.length === 0 ? (
              <tr>
                <td colSpan={4} className="note" style={{ padding: 14 }}>No decks yet.</td>
              </tr>
            ) : (
              decks.map((d) => (
                <tr key={d.id}>
                  <td><strong>{d.title || d.file_name || '-'}</strong></td>
                  <td className="note">
                    {d.download_url ? (
                      <a href={d.download_url} target="_blank" rel="noreferrer">{d.file_name || 'Download'}</a>
                    ) : (
                      d.file_name || '-'
                    )}
                  </td>
                  <td>
                    <span className={'badge ' + (d.is_public ? 'ok' : 'b-neutral')}>
                      {d.is_public ? 'Public' : 'Hidden'}
                    </span>
                  </td>
                  <td>
                    <button className="btn" onClick={() => toggleDeckPublic(d)}>
                      {d.is_public ? 'Hide' : 'Publish'}
                    </button>{' '}
                    <button className="btn" onClick={() => deleteDeck(d)}>Remove</button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* ---- PROGRAMS ---- */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="note" style={{ fontWeight: 700, marginBottom: 10 }}>New program / offering</div>
        <div className="two">
          <div className="field">
            <label>Title</label>
            <input value={pform.title} onChange={(e) => setPF('title', e.target.value)} />
          </div>
          <div className="field">
            <label>Summary</label>
            <input value={pform.summary} onChange={(e) => setPF('summary', e.target.value)} />
          </div>
        </div>
        <div className="field">
          <label>Details</label>
          <textarea rows={3} value={pform.details} onChange={(e) => setPF('details', e.target.value)} />
        </div>
        <div className="two">
          <div className="field">
            <label>Price / terms</label>
            <input
              value={pform.priceTerms}
              onChange={(e) => setPF('priceTerms', e.target.value)}
              placeholder="e.g. From $2,500 / month"
            />
          </div>
          <div className="field">
            <label>Sort order</label>
            <input
              type="number"
              value={pform.sort}
              onChange={(e) => setPF('sort', Number(e.target.value))}
            />
          </div>
          <div className="field">
            <label>CTA label</label>
            <input value={pform.ctaLabel} onChange={(e) => setPF('ctaLabel', e.target.value)} placeholder="e.g. Contact us" />
          </div>
          <div className="field">
            <label>CTA link (optional)</label>
            <input value={pform.ctaUrl} onChange={(e) => setPF('ctaUrl', e.target.value)} placeholder="https://" />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginBottom: 10 }}>
          <label className="note">
            <input type="checkbox" checked={pform.active} onChange={(e) => setPF('active', e.target.checked)} /> Active
            (shown on public profile)
          </label>
        </div>
        <button className="btn primary" disabled={psaving} onClick={createProgram}>
          Create program
        </button>
      </div>

      <div className="card" style={{ padding: 0, marginBottom: 16 }}>
        <table>
          <thead>
            <tr>
              <th>Title</th>
              <th>Summary</th>
              <th>Price / terms</th>
              <th>Active</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {programs.length === 0 ? (
              <tr>
                <td colSpan={5} className="note" style={{ padding: 14 }}>No programs yet.</td>
              </tr>
            ) : (
              programs.map((p) => (
                <tr key={p.id}>
                  <td><strong>{p.title || '-'}</strong></td>
                  <td className="note">{p.summary || '-'}</td>
                  <td className="note">{p.price_terms || '-'}</td>
                  <td>
                    <span className={'badge ' + (p.active ? 'ok' : 'b-neutral')}>
                      {p.active ? 'Active' : 'Hidden'}
                    </span>
                  </td>
                  <td>
                    <button className="btn" onClick={() => setOpenProgram(openProgram === p.id ? null : p.id)}>
                      {openProgram === p.id ? 'Close' : 'Edit'}
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {openProgram && (
        <ProgramEdit
          key={openProgram}
          program={programs.find((p) => p.id === openProgram)!}
          onChanged={load}
        />
      )}
    </>
  );
}

function ProgramEdit({ program, onChanged }: { program: Program; onChanged: () => void }) {
  const [p, setP] = useState<Program>({ ...program });
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [busy, setBusy] = useState(false);

  const setK = (k: keyof Program, v: any) => setP((prev) => ({ ...prev, [k]: v }));

  async function save() {
    setBusy(true);
    setErr('');
    setOk('');
    try {
      await apiSend('PATCH', `/profile-programs/${program.id}`, {
        title: p.title,
        summary: p.summary,
        details: p.details,
        priceTerms: p.price_terms,
        ctaLabel: p.cta_label,
        ctaUrl: p.cta_url,
        active: !!p.active,
        sort: p.sort ?? 0,
      });
      setOk('Saved.');
      onChanged();
    } catch (e: any) {
      setErr(e.message ?? 'Could not save.');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await apiSend('DELETE', `/profile-programs/${program.id}`);
      onChanged();
    } catch (e: any) {
      setErr(e.message ?? 'Could not delete.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="note" style={{ fontWeight: 700, marginBottom: 10 }}>Edit program</div>
      {err && <div className="err">{err}</div>}
      {ok && <div className="ok">{ok}</div>}
      <div className="two">
        <div className="field"><label>Title</label><input value={p.title ?? ''} onChange={(e) => setK('title', e.target.value)} /></div>
        <div className="field"><label>Summary</label><input value={p.summary ?? ''} onChange={(e) => setK('summary', e.target.value)} /></div>
      </div>
      <div className="field"><label>Details</label><textarea rows={3} value={p.details ?? ''} onChange={(e) => setK('details', e.target.value)} /></div>
      <div className="two">
        <div className="field"><label>Price / terms</label><input value={p.price_terms ?? ''} onChange={(e) => setK('price_terms', e.target.value)} /></div>
        <div className="field"><label>Sort order</label><input type="number" value={p.sort ?? 0} onChange={(e) => setK('sort', Number(e.target.value))} /></div>
        <div className="field"><label>CTA label</label><input value={p.cta_label ?? ''} onChange={(e) => setK('cta_label', e.target.value)} /></div>
        <div className="field"><label>CTA link</label><input value={p.cta_url ?? ''} onChange={(e) => setK('cta_url', e.target.value)} /></div>
      </div>
      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginBottom: 10 }}>
        <label className="note"><input type="checkbox" checked={!!p.active} onChange={(e) => setK('active', e.target.checked)} /> Active</label>
      </div>
      <button className="btn primary" disabled={busy} onClick={save}>Save changes</button>{' '}
      <button className="btn" disabled={busy} onClick={remove}>Delete</button>
    </div>
  );
}
