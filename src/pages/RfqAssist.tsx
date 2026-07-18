import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { useToast } from '../lib/toast';
import {
  getPackage,
  getRfqDocuments, uploadRfqDocument,
  suggestRfqLines, getRfqSuggestions, applyRfqLines,
  signedUrl,
  type SuggestedLine,
} from '../lib/db';

const CATEGORY_OPTIONS: { value: string; label: string }[] = [
  { value: 'cad', label: 'CAD model' },
  { value: 'drawing', label: 'Drawing' },
  { value: 'spec', label: 'Spec document' },
  { value: 'finish_schedule', label: 'Finish schedule' },
  { value: 'other', label: 'Other' },
];

// Mirrors the server ALLOWED_EXT set.
const ACCEPT = '.pdf,.png,.jpg,.jpeg,.dwg,.dwf,.rvt,.ifc,.doc,.docx,.csv,.txt';

type Editable = SuggestedLine & { _accept: boolean };

export default function RfqAssist() {
  const { id } = useParams();
  const nav = useNavigate();
  const { company } = useAuth();
  const { toast } = useToast();

  const [p, setP] = useState<any>(null);
  const [docs, setDocs] = useState<any[]>([]);
  const [category, setCategory] = useState('spec');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const [needs, setNeeds] = useState('');
  const [specText, setSpecText] = useState('');
  const [rows, setRows] = useState<Editable[]>([]);
  const [suggesting, setSuggesting] = useState(false);
  const [applying, setApplying] = useState(false);

  const isOwner = company && p && p.building?.company_id === company.id;

  async function load() {
    if (!id) return;
    const pk = await getPackage(id); setP(pk);
    setDocs(await getRfqDocuments(id));
    try {
      const { suggestions } = await getRfqSuggestions(id);
      setRows(suggestions.filter(s => s.status !== 'applied').map(s => ({ ...s, _accept: true })));
    } catch { /* non-owner / none */ }
  }
  useEffect(() => { load(); }, [id]);

  async function onFiles(files: FileList | null) {
    if (!files || !company || !id) return;
    setBusy(true); setErr(''); setMsg('');
    try {
      for (const f of Array.from(files)) {
        await uploadRfqDocument(f, { companyId: company.id, packageId: id, category });
      }
      setDocs(await getRfqDocuments(id));
      setMsg('Files uploaded.');
      toast('Files uploaded.', 'success');
    } catch (e: any) {
      const m = e.message ?? 'Upload failed.';
      setErr(m);
      toast(m, 'error');
    }
    finally { setBusy(false); if (fileRef.current) fileRef.current.value = ''; }
  }

  async function open(path: string) {
    const url = await signedUrl(path);
    if (url) window.open(url, '_blank');
  }

  async function runSuggest() {
    if (!id) return;
    setSuggesting(true); setErr(''); setMsg('');
    try {
      const { suggestions, sourceUsedDocText } = await suggestRfqLines(id, { needs, specText });
      setRows(suggestions.map(s => ({ ...s, _accept: true })));
      const m = `Generated ${suggestions.length} suggestion${suggestions.length === 1 ? '' : 's'}${sourceUsedDocText ? ' (incl. text from spec docs)' : ''}.`;
      setMsg(m);
      toast(m, 'success');
    } catch (e: any) {
      const m = e.message ?? 'Could not generate suggestions.';
      setErr(m);
      toast(m, 'error');
    }
    finally { setSuggesting(false); }
  }

  function patchRow(i: number, patch: Partial<Editable>) {
    setRows(rs => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  async function applySelected() {
    if (!id) return;
    const selected = rows.filter(r => r._accept);
    if (!selected.length) { setErr('Select at least one line to add.'); return; }
    setApplying(true); setErr(''); setMsg('');
    try {
      // Lines with a stored id are applied by id; edited rows fall back to the
      // full payload so any text changes are honoured.
      const lineIds = selected.filter(r => r.id).map(r => r.id!) as string[];
      const lines = selected.map(r => ({
        name: r.name, description: [r.name, r.spec].filter(Boolean).join(' — '),
        qty: r.qty, unit: r.unit, notes: r.notes,
      }));
      // Prefer id-based apply (marks suggestions applied); if none have ids, send lines.
      const payload = lineIds.length ? { lineIds } : { lines };
      const { applied } = await applyRfqLines(id, payload);
      const m = `Added ${applied} line item${applied === 1 ? '' : 's'} to the RFQ.`;
      setMsg(m);
      toast(m, 'success');
      await load();
    } catch (e: any) {
      const m = e.message ?? 'Could not add lines.';
      setErr(m);
      toast(m, 'error');
    }
    finally { setApplying(false); }
  }

  if (!p) return <div className="note">Loading…</div>;

  if (!isOwner) {
    return (
      <>
        <div className="page-head">
          <div>
            <a className="note" style={{ cursor: 'pointer' }} onClick={() => nav('/package/' + p.id)}>← Back to package</a>
            <h1>RFQ assist</h1>
          </div>
        </div>
        <div className="card"><div className="note">Only the developer that owns this package can use RFQ assist.</div></div>
      </>
    );
  }

  return (
    <>
      <div className="page-head">
        <div>
          <a className="note" style={{ cursor: 'pointer' }} onClick={() => nav('/package/' + p.id)}>← Back to package</a>
          <h1>RFQ assist · {p.category}</h1>
          <div className="sub">{p.building?.name} · {p.building?.location ?? ''}</div>
        </div>
      </div>

      {err && <div className="err">{err}</div>}
      {msg && <div className="ok">{msg}</div>}

      {/* Drop CAD / spec files */}
      <div className="sectitle">Drop CAD / spec files</div>
      <div className="card">
        <div className="two">
          <div className="field"><label>File category</label>
            <select value={category} onChange={e => setCategory(e.target.value)}>
              {CATEGORY_OPTIONS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </div>
          <div className="field" style={{ display: 'flex', alignItems: 'flex-end' }}>
            <input ref={fileRef} type="file" multiple accept={ACCEPT} style={{ display: 'none' }}
              onChange={e => onFiles(e.target.files)} />
            <button className="btn" disabled={busy} onClick={() => fileRef.current?.click()}>
              {busy ? 'Uploading…' : '⬆ Drop / select files'}
            </button>
          </div>
        </div>
        <span className="note">PDF, images, DWG, DWF, RVT, IFC, DOC, DOCX, CSV, TXT · max 50 MB. Binary CAD is stored; suggestions read text from typed needs and PDF/text specs.</span>
        {docs.length > 0 && (
          <div style={{ marginTop: 12 }}>
            {docs.map(d => (
              <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderTop: '1px solid var(--line)' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 13.5 }}>{d.name}</div>
                  <div className="note">{(d.category || 'other')}{d.kind ? ` · ${String(d.kind).toUpperCase()}` : ''}{d.size ? ` · ${Math.round(d.size / 1024)} KB` : ''}</div>
                </div>
                <button className="btn" onClick={() => open(d.storage_path)}>Open</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Needs + auto-suggest */}
      <div className="sectitle">Describe the developer's needs</div>
      <div className="card">
        <div className="field">
          <label>Needs (free text)</label>
          <textarea value={needs} onChange={e => setNeeds(e.target.value)} rows={4}
            placeholder="e.g. 12 solid-core interior doors with hardware, LVT flooring throughout, paint all walls, suspended acoustic ceiling, new LED lighting, plumbing fixtures for two restrooms." />
        </div>
        <div className="field">
          <label>Paste spec text (optional)</label>
          <textarea value={specText} onChange={e => setSpecText(e.target.value)} rows={3}
            placeholder="Paste relevant sections of a spec/finish schedule, or rely on uploaded text/PDF specs." />
        </div>
        <button className="btn primary" disabled={suggesting} onClick={runSuggest}>
          {suggesting ? 'Generating…' : 'Auto-suggest line items'}
        </button>
      </div>

      {/* Editable suggestions */}
      {rows.length > 0 && (
        <>
          <div className="sectitle">Suggested line items (review &amp; edit)</div>
          <div className="card" style={{ padding: 0 }}>
            <table>
              <thead>
                <tr>
                  <th style={{ width: 44 }}>Add</th>
                  <th>Name</th>
                  <th>Category</th>
                  <th style={{ width: 80 }}>Qty</th>
                  <th style={{ width: 80 }}>Unit</th>
                  <th>Spec / notes</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.id ?? i}>
                    <td><input type="checkbox" checked={r._accept} onChange={e => patchRow(i, { _accept: e.target.checked })} /></td>
                    <td><input value={r.name} onChange={e => patchRow(i, { name: e.target.value })} /></td>
                    <td><input value={r.category ?? ''} onChange={e => patchRow(i, { category: e.target.value })} /></td>
                    <td><input value={String(r.qty ?? '')} onChange={e => patchRow(i, { qty: Number(e.target.value) || 0 })} /></td>
                    <td><input value={r.unit ?? ''} onChange={e => patchRow(i, { unit: e.target.value })} /></td>
                    <td><input value={r.spec ?? r.notes ?? ''} onChange={e => patchRow(i, { spec: e.target.value })} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ marginTop: 10 }}>
            <button className="btn primary" disabled={applying} onClick={applySelected}>
              {applying ? 'Adding…' : 'Add selected to RFQ'}
            </button>
            <span className="note" style={{ marginLeft: 10 }}>Accepted lines are inserted into the package bill of quantities.</span>
          </div>
        </>
      )}
    </>
  );
}
