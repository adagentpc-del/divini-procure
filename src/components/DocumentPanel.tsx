import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../lib/auth';
import { getDocuments, uploadDocument, signedUrl } from '../lib/db';

const CAD_EXT = ['dwg', 'dxf', 'rvt', 'ifc', 'step', 'stp', 'iges', 'igs', 'skp', '3dm'];
const PDF_EXT = ['pdf'];
const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp'];
// heic is excluded from inline preview: browsers cannot natively render it
// in an <img> tag, unlike the other image types here.

function icon(kind: string) {
  if (['pdf'].includes(kind)) return '▤';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'heic'].includes(kind)) return '▦';
  if (CAD_EXT.includes(kind)) return '◳';
  if (['xls', 'xlsx', 'csv'].includes(kind)) return '▥';
  return '▧';
}

/** true when the browser can render this file type inline with no conversion service - PDF and common raster images only. */
function canPreviewInline(kind: string) {
  return PDF_EXT.includes(kind) || IMAGE_EXT.includes(kind);
}

export default function DocumentPanel({ packageId, buildingId, canUpload }: { packageId?: string; buildingId?: string; canUpload: boolean }) {
  const { session, company } = useAuth();
  const [docs, setDocs] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const [previewDoc, setPreviewDoc] = useState<any>(null);
  const [previewUrl, setPreviewUrl] = useState('');

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

  async function preview(d: any) {
    if (!canPreviewInline(d.kind || '')) return;
    const url = await signedUrl(d.storage_path);
    if (!url) return;
    setPreviewUrl(url);
    setPreviewDoc(d);
  }

  return (
    <div className="card">
      {err && <div className="err">{err}</div>}
      {previewDoc && (
        <div style={{ marginBottom: 12, border: '1px solid var(--line)', borderRadius: 8, overflow: 'hidden' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', background: 'var(--ivory)' }}>
            <span style={{ fontWeight: 600, fontSize: 13 }}>{previewDoc.name}</span>
            <a className="note" style={{ cursor: 'pointer' }} onClick={() => { setPreviewDoc(null); setPreviewUrl(''); }}>Close preview ✕</a>
          </div>
          {PDF_EXT.includes(previewDoc.kind) ? (
            <iframe src={previewUrl} title={previewDoc.name} style={{ width: '100%', height: 480, border: 0, display: 'block' }} />
          ) : (
            <img src={previewUrl} alt={previewDoc.name} style={{ maxWidth: '100%', maxHeight: 480, display: 'block', margin: '0 auto' }} />
          )}
        </div>
      )}
      {canUpload && (
        <div style={{ marginBottom: docs.length ? 12 : 0 }}>
          <input ref={fileRef} type="file" multiple style={{ display: 'none' }}
            accept=".pdf,.png,.jpg,.jpeg,.gif,.webp,.heic,.dwg,.dxf,.dwf,.rvt,.ifc,.step,.stp,.iges,.igs,.skp,.3dm,.doc,.docx,.xls,.xlsx,.csv,.txt"
            onChange={e => onFiles(e.target.files)} />
          <button className="btn" disabled={busy} onClick={() => fileRef.current?.click()}>
            {busy ? 'Uploading…' : '⬆ Upload CAD / drawings / specs'}
          </button>
          <span className="note" style={{ marginLeft: 10 }}>DWG, DXF, RVT, IFC, PDF, XLSX, images</span>
        </div>
      )}
      {docs.length === 0
        ? <div className="note">{canUpload ? 'No documents yet - upload drawings, specs, or schedules.' : 'No documents shared.'}</div>
        : docs.map(d => (
          <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', borderTop: '1px solid var(--line)' }}>
            <span style={{ fontSize: 18, color: 'var(--emerald)' }}>{icon(d.kind)}</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 13.5 }}>{d.name}</div>
              <div className="note">
                {(d.kind || '').toUpperCase()}{d.size ? ` · ${Math.round(d.size / 1024)} KB` : ''}
                {!canPreviewInline(d.kind || '') && CAD_EXT.includes(d.kind || '') && ' · CAD preview requires a conversion service, not yet configured'}
              </div>
            </div>
            {canPreviewInline(d.kind || '') && (
              <button className="btn" onClick={() => preview(d)}>Preview</button>
            )}
            <button className="btn" onClick={() => open(d.storage_path)}>Open / download</button>
          </div>
        ))}
    </div>
  );
}
