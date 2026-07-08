/**
 * Generic admin CSV Import tool (with duplicate detection).
 *
 * Admin picks an entity type (developers / investors / contacts / products),
 * pastes a CSV or uploads a .csv file (read client side), and runs Preview. The
 * server maps columns by header name and flags each row as a duplicate of an
 * existing record. The admin can toggle "skip" per row, then Commit. The server
 * re-checks duplicates and creates only the non-skipped, non-duplicate rows,
 * returning created / duplicates / errors.
 *
 * Vendors have their own dedicated import (Vendor Import) and are not offered
 * here. Developers and vendors that already live in Divini Partner can be
 * flagged exists_in_partner on the contact record for MANUAL cross-platform
 * de-dup; this generic tool does not reach across platforms automatically.
 */
import { useMemo, useState } from 'react';
import { useFeatures } from '../lib/features';
import { apiSend } from '../lib/api';

type EntityType = 'developers' | 'investors' | 'contacts' | 'products';

const ENTITIES: { value: EntityType; label: string; columns: string; sample: string }[] = [
  {
    value: 'developers',
    label: 'Developers',
    columns: 'name (required), email',
    sample: `name,email
Skyline Development Group,deals@skylinedev.com
Harbor Point Partners,info@harborpoint.com`,
  },
  {
    value: 'investors',
    label: 'Investors',
    columns: 'full_name, email (required), user_id (optional)',
    sample: `full_name,email
Jane Capital LLC,jane@janecapital.com
Northwind Family Office,contact@northwindfo.com`,
  },
  {
    value: 'contacts',
    label: 'Contacts',
    columns: 'name, email, phone, company_name, role, source',
    sample: `name,email,phone,company_name,role,source
Dana Lee,dana@acme.com,555-0100,Acme Co,Procurement Lead,tradeshow
Pat Ruiz,pat@summit.com,555-0144,Summit Inc,Owner,referral`,
  },
  {
    value: 'products',
    label: 'Products (SKUs)',
    columns: 'vendor_company_id (required), name (required), sku, category',
    sample: `vendor_company_id,name,sku,category
00000000-0000-0000-0000-000000000000,Brushed Brass Pull,BBP-204,Hardware
00000000-0000-0000-0000-000000000000,Matte Black Faucet,MBF-880,Plumbing`,
  },
];

type PreviewRow = {
  index: number;
  fields: Record<string, string>;
  duplicate: boolean;
  matchId: string | null;
  matchLabel: string | null;
};

type EditRow = PreviewRow & { skip: boolean };

type PreviewResponse = {
  entityType: EntityType;
  columnMap: Record<string, string>;
  headers: string[];
  rows: PreviewRow[];
};

type CommitResponse = {
  created: number;
  duplicates: number;
  errors: { index: number; error: string }[];
};

export default function AdminCsvImport() {
  const { isAdmin } = useFeatures();
  const [entityType, setEntityType] = useState<EntityType>('developers');
  const [csvText, setCsvText] = useState('');
  const [ownerCompanyId, setOwnerCompanyId] = useState('');
  const [columnMap, setColumnMap] = useState<Record<string, string>>({});
  const [fieldCols, setFieldCols] = useState<string[]>([]);
  const [rows, setRows] = useState<EditRow[]>([]);
  const [previewed, setPreviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [result, setResult] = useState<CommitResponse | null>(null);

  const entity = useMemo(() => ENTITIES.find((e) => e.value === entityType)!, [entityType]);
  const dupCount = useMemo(() => rows.filter((r) => r.duplicate).length, [rows]);
  const toImport = useMemo(() => rows.filter((r) => !r.skip && !r.duplicate).length, [rows]);

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setCsvText(String(reader.result ?? ''));
    reader.readAsText(file);
  }

  function changeEntity(v: EntityType) {
    setEntityType(v);
    setPreviewed(false);
    setRows([]);
    setResult(null);
    setErr('');
  }

  async function runPreview() {
    setErr('');
    setResult(null);
    if (!csvText.trim()) {
      setErr('Paste a CSV or upload a .csv file first.');
      return;
    }
    setBusy(true);
    try {
      const r = await apiSend<PreviewResponse>('POST', '/csv-import/preview', {
        entityType,
        csvText,
      });
      setColumnMap(r.columnMap ?? {});
      // Stable union of mapped field keys (in config order) for the table.
      const cols = Array.from(
        new Set((r.rows ?? []).flatMap((row) => Object.keys(row.fields))),
      );
      setFieldCols(cols);
      setRows(
        (r.rows ?? []).map((row) => ({ ...row, skip: row.duplicate })),
      );
      setPreviewed(true);
    } catch (e: any) {
      setErr(e.message ?? 'Could not preview the CSV.');
    } finally {
      setBusy(false);
    }
  }

  function toggleSkip(index: number, skip: boolean) {
    setRows((prev) => prev.map((r) => (r.index === index ? { ...r, skip } : r)));
  }

  async function commit() {
    setErr('');
    setBusy(true);
    try {
      const payload: Record<string, unknown> = {
        entityType,
        ownerCompanyId: entityType === 'contacts' && ownerCompanyId.trim() ? ownerCompanyId.trim() : undefined,
        rows: rows.map((r) => ({ fields: r.fields, skip: r.skip, duplicate: r.duplicate })),
      };
      const r = await apiSend<CommitResponse>('POST', '/csv-import/commit', payload);
      setResult(r);
    } catch (e: any) {
      setErr(e.message ?? 'Could not import the CSV.');
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setCsvText('');
    setRows([]);
    setPreviewed(false);
    setResult(null);
    setErr('');
  }

  if (!isAdmin) return <div className="card">Admins only.</div>;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>CSV Import</h1>
          <div className="sub">
            Bulk-import developers, investors, contacts, or products from a CSV. Each row is checked for
            duplicates against existing records before anything is written.
          </div>
        </div>
      </div>

      {err && <div className="err">{err}</div>}

      {result ? (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Import complete</h2>
          <ul style={{ lineHeight: 1.8 }}>
            <li>Created <strong>{result.created}</strong> new {entity.label.toLowerCase()}.</li>
            <li>Skipped <strong>{result.duplicates}</strong> duplicate{result.duplicates === 1 ? '' : 's'}.</li>
            <li>Errors: <strong>{result.errors.length}</strong>.</li>
          </ul>
          {result.errors.length > 0 && (
            <div className="card" style={{ marginTop: 10 }}>
              <h3 style={{ marginTop: 0 }}>Rows that did not import</h3>
              <table>
                <thead><tr><th>Row #</th><th>Error</th></tr></thead>
                <tbody>
                  {result.errors.map((e) => (
                    <tr key={e.index}><td>{e.index + 1}</td><td className="err">{e.error}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div style={{ marginTop: 14 }}>
            <button className="btn" onClick={reset}>Import another file</button>
          </div>
        </div>
      ) : !previewed ? (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Step 1: Choose a type and paste or upload a CSV</h2>

          <div className="two" style={{ gap: 12 }}>
            <div className="field">
              <label>Entity type</label>
              <select value={entityType} onChange={(e) => changeEntity(e.target.value as EntityType)}>
                {ENTITIES.map((e) => (
                  <option key={e.value} value={e.value}>{e.label}</option>
                ))}
              </select>
            </div>
            {entityType === 'contacts' && (
              <div className="field">
                <label>Owner company id (optional)</label>
                <input
                  value={ownerCompanyId}
                  onChange={(e) => setOwnerCompanyId(e.target.value)}
                  placeholder="UUID of the owning developer org"
                />
              </div>
            )}
          </div>

          <div className="note" style={{ marginBottom: 10 }}>
            CSV with a header row. Recognized columns for {entity.label}: {entity.columns}.
          </div>

          <div className="field">
            <label>CSV</label>
            <textarea
              rows={10}
              value={csvText}
              onChange={(e) => setCsvText(e.target.value)}
              placeholder={entity.sample}
              style={{ width: '100%', fontFamily: 'monospace', fontSize: 13 }}
            />
          </div>

          <div className="two" style={{ alignItems: 'center', gap: 12 }}>
            <div className="field">
              <label>Or upload a .csv file</label>
              <input type="file" accept=".csv,text/csv" onChange={onFile} />
            </div>
            <div>
              <button className="btn primary" disabled={busy} onClick={runPreview}>
                {busy ? 'Reading…' : 'Preview'}
              </button>
            </div>
          </div>

          <div className="note" style={{ marginTop: 12 }}>
            Developers and vendors that already exist in Divini Partner can be flagged
            <span className="badge b-neutral" style={{ margin: '0 4px' }}>exists_in_partner</span>
            on the contact record for manual cross-platform de-dup. Vendors have their own dedicated
            Vendor Import flow and are not imported here.
          </div>
        </div>
      ) : (
        <>
          <div className="card" style={{ marginBottom: 12, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <span className="badge b-neutral">{rows.length} rows</span>
            <span className="badge b-green">{toImport} to import</span>
            <span className="badge b-amber">{dupCount} duplicate{dupCount === 1 ? '' : 's'}</span>
            <span className="note">
              Mapped columns:{' '}
              {Object.keys(columnMap).length
                ? Object.entries(columnMap).map(([f, hdr]) => `${f} = ${hdr}`).join(', ')
                : 'none detected'}
            </span>
          </div>

          <div className="card" style={{ padding: 0 }}>
            <table>
              <thead>
                <tr>
                  <th>Skip</th>
                  {fieldCols.map((c) => <th key={c}>{c}</th>)}
                  <th>Duplicate</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr><td colSpan={fieldCols.length + 2} className="note" style={{ padding: 14 }}>No rows found.</td></tr>
                ) : (
                  rows.map((r) => (
                    <tr key={r.index} style={r.skip ? { opacity: 0.5 } : undefined}>
                      <td>
                        <input
                          type="checkbox"
                          checked={r.skip}
                          onChange={(e) => toggleSkip(r.index, e.target.checked)}
                        />
                      </td>
                      {fieldCols.map((c) => (
                        <td key={c} className="note">{r.fields[c] || '-'}</td>
                      ))}
                      <td>
                        {r.duplicate ? (
                          <span className="badge b-amber">Dup: {r.matchLabel ?? 'match'}</span>
                        ) : (
                          <span className="badge b-green">New</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="note" style={{ marginTop: 12 }}>
            Duplicate rows are pre-skipped. Uncheck a row to import it anyway (the server re-checks and will
            still skip a confirmed duplicate). Nothing is written until you commit.
          </div>

          <div style={{ marginTop: 14, display: 'flex', gap: 10, alignItems: 'center' }}>
            <button className="btn primary" disabled={busy || toImport === 0} onClick={commit}>
              {busy ? 'Importing…' : `Import ${toImport} ${entity.label.toLowerCase()}`}
            </button>
            <button className="btn" disabled={busy} onClick={reset}>Start over</button>
          </div>
        </>
      )}
    </>
  );
}
