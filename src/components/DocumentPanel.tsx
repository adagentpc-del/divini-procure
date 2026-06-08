import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../lib/auth';
import { getDocuments, uploadDocument, signedUrl } from '../lib/db';

const CAD_EXT = ['dwg', 'dxf', 'rvt', 'ifc', 'step', 'stp', 'iges', 'igs', 'skp', '3dm'];

function icon(kind: string) {
  if (['pdf'].includes(kind)) return '▤';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'heic'].includes(kind)) return '▦';
  if (CAD_EXT.includes(kind)) return '◳';
  if (['xls', 'xlsx', 'csv'].includes(kind)) return '▥';
  return '▧';
}

export default function DocumentPanel({ packageId, buildingId, canUpload }: { packageId?: string; buildingId?: string; canUpload: boolean }) {
  const { session, company } = useAuth();
  const [docs, setDocs] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  async function load() { setDocs(await getDocuments({ packageId, buildingId })); }
  useEffect(() => { load(); }, [packageId, buildingId]);

  async function onFiles(files: FileList | null) {
    if (!files || !company || !session) return;
    setBusy(true); setErr('');
    try {
      for (const f of Array.from(files)) {
        await uploadDocument(f, { companyId: company.id, userId: session.user.id, buildingId, packageId });
      }
      await load();
    } catch (e: any) { setErr(e.message ?? 'Upload failed.'); }
    finally { setBusy(false); if (fileRef.current) fileRef.current.value = ''; }
  }

  async function open(path: string) {
    const url = await signedUrl(path);
    if (url) window.open(url, '_blank');
  }

  return (
    <div className="card">
      {err && <div className="err">{err}</div>}
      {canUpload && (
        <div style={{ marginBottom: docs.length ? 12 : 0 }}>
          <input ref={fileRef} type="file" multiple style={{ display: 'none' }}
            onChange={e => onFiles(e.target.files)} />
          <button className="btn" disabled={busy} onClick={() => fileRef.current?.click()}>
            {busy ? 'Uploading…' : '⬆ Upload CAD / drawings / specs'}
          </button>
          <span className="note" style={{ marginLeft: 10 }}>DWG, DXF, RVT, IFC, PDF, XLSX, images</span>
        </div>
      )}
      {docs.length === 0
        ? <div className="note">{canUpload ? 'No documents yet — upload drawings, specs, or schedules.' : 'No documents shared.'}</div>
        : docs.map(d => (
          <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', borderTop: '1px solid var(--line)' }}>
            <span style={{ fontSize: 18, color: 'var(--emerald)' }}>{icon(d.kind)}</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 13.5 }}>{d.name}</div>
              <div className="note">{(d.kind || '').toUpperCase()}{d.size ? ` · ${Math.round(d.size / 1024)} KB` : ''}</div>
            </div>
            <button className="btn" onClick={() => open(d.storage_path)}>Open / download</button>
          </div>
        ))}
    </div>
  );
}
