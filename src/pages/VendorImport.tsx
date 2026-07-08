/**
 * Existing-Vendor CSV Import (developer / buyer).
 *
 * Step 1: paste or upload a vendor list (CSV). We POST it to
 * /vendor-import/preview, which matches each row to an existing vendor company
 * or flags it as a new starter profile. The developer can then mark, per row,
 * whether the relationship existed before Divini Procure (and pick the
 * relationship type + notes).
 *
 * Step 2: Commit. We POST the edited rows to /vendor-import/commit, which
 * creates starter vendor profiles, links matched vendors, and records confirmed
 * pre-existing relationships through the shared grandfathered flow (pair-scoped,
 * queued for admin review, never auto-applying the 2% fee).
 */
import { useMemo, useState } from 'react';
import { useAuth } from '../lib/auth';
import { apiSend } from '../lib/api';

const REL_TYPES: [string, string][] = [
  ['active_contract', 'We are already under contract with this vendor.'],
  ['already_working_together', 'We are already actively working with this vendor.'],
  ['active_negotiation', 'We are already in active negotiations with this vendor.'],
  ['already_selected_or_shortlisted', 'We had already selected or shortlisted this vendor.'],
  ['prior_vendor_relationship', 'We had a prior vendor relationship with this vendor.'],
  ['other', 'Other. Explain in notes.'],
];

type PreviewRow = {
  index: number;
  name: string;
  email: string;
  category: string;
  website: string;
  contact: string;
  matchedVendorCompanyId: string | null;
  matchedVendorName: string | null;
};

type EditRow = PreviewRow & {
  existedBefore: boolean;
  relationshipType: string;
  notes: string;
};

type CommitResult = {
  name: string;
  vendorCompanyId: string | null;
  created: boolean;
  grandfathered: boolean;
  error?: string;
};

type CommitResponse = {
  summary: {
    created: number;
    linked: number;
    grandfathered: number;
    errors: { name: string; error: string }[];
  };
  results: CommitResult[];
};

const SAMPLE = `name,email,category,website,contact
Acme Electrical,info@acme-electrical.com,Electrical,acme-electrical.com,Dana Lee
Summit Concrete,sales@summitconcrete.com,Concrete,summitconcrete.com,Pat Ruiz`;

export default function VendorImport() {
  const { company } = useAuth();
  const [csvText, setCsvText] = useState('');
  const [rows, setRows] = useState<EditRow[]>([]);
  const [previewed, setPreviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [result, setResult] = useState<CommitResponse | null>(null);

  const isDeveloper = company?.kind === 'buyer';

  const grandfatheredPending = useMemo(
    () => rows.filter((r) => r.existedBefore && r.relationshipType).length,
    [rows],
  );

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setCsvText(String(reader.result ?? ''));
    reader.readAsText(file);
  }

  async function runPreview() {
    setErr('');
    setResult(null);
    if (!csvText.trim()) {
      setErr('Paste a vendor list or upload a .csv file first.');
      return;
    }
    setBusy(true);
    try {
      const r = await apiSend<{ rows: PreviewRow[] }>('POST', '/vendor-import/preview', { csvText });
      setRows(
        (r.rows ?? []).map((row) => ({
          ...row,
          existedBefore: false,
          relationshipType: '',
          notes: '',
        })),
      );
      setPreviewed(true);
    } catch (e: any) {
      setErr(e.message ?? 'Could not preview the vendor list.');
    } finally {
      setBusy(false);
    }
  }

  function patchRow(index: number, patch: Partial<EditRow>) {
    setRows((prev) => prev.map((r) => (r.index === index ? { ...r, ...patch } : r)));
  }

  async function commit() {
    setErr('');
    if (!company) return;
    setBusy(true);
    try {
      const payload = {
        developerCompanyId: company.id,
        rows: rows.map((r) => ({
          name: r.name,
          email: r.email,
          category: r.category,
          website: r.website,
          contact: r.contact,
          vendorCompanyId: r.matchedVendorCompanyId ?? undefined,
          existedBefore: r.existedBefore,
          relationshipType: r.existedBefore ? r.relationshipType || undefined : undefined,
          notes: r.notes || undefined,
        })),
      };
      const r = await apiSend<CommitResponse>('POST', '/vendor-import/commit', payload);
      setResult(r);
    } catch (e: any) {
      setErr(e.message ?? 'Could not import the vendor list.');
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

  if (!company) return <div className="note">Loading…</div>;
  if (!isDeveloper) {
    return (
      <>
        <div className="page-head">
          <h1>Import vendors</h1>
        </div>
        <div className="note">Vendor import is available to developer (buyer) accounts.</div>
      </>
    );
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Import vendors</h1>
          <div className="sub">
            Bring in your existing vendor list. We match each vendor to an existing company or create a
            starter profile, and let you confirm whether the relationship existed before Divini Procure.
          </div>
        </div>
      </div>

      {err && <div className="err">{err}</div>}

      {result ? (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Import complete</h2>
          <ul style={{ lineHeight: 1.8 }}>
            <li>Created <strong>{result.summary.created}</strong> starter vendor profiles.</li>
            <li>Linked <strong>{result.summary.linked}</strong> rows to existing vendors.</li>
            <li>
              Grandfathered <strong>{result.summary.grandfathered}</strong> relationships, pending admin
              confirmation.
            </li>
            <li>Errors: <strong>{result.summary.errors.length}</strong>.</li>
          </ul>

          {result.summary.errors.length > 0 && (
            <div className="card" style={{ marginTop: 10 }}>
              <h3 style={{ marginTop: 0 }}>Rows that did not import</h3>
              <table>
                <thead><tr><th>Vendor</th><th>Error</th></tr></thead>
                <tbody>
                  {result.summary.errors.map((e, i) => (
                    <tr key={i}><td>{e.name}</td><td className="err">{e.error}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="note" style={{ marginTop: 12 }}>
            Each confirmed pre-existing relationship has been queued for admin review and applies only to that
            specific developer-vendor pair. The grandfathered 2% fee takes effect only after an admin confirms
            the relationship; it is never applied automatically.
          </div>

          <div style={{ marginTop: 14 }}>
            <button className="btn" onClick={reset}>Import another list</button>
          </div>
        </div>
      ) : !previewed ? (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Step 1: Paste or upload your vendor list</h2>
          <div className="note" style={{ marginBottom: 10 }}>
            CSV with an optional header row. Recognized columns: name, email, category, website, contact. If
            there is no header, columns are read in that order.
          </div>
          <div className="field">
            <label>Vendor list (CSV)</label>
            <textarea
              rows={10}
              value={csvText}
              onChange={(e) => setCsvText(e.target.value)}
              placeholder={SAMPLE}
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
        </div>
      ) : (
        <>
          <div className="card" style={{ padding: 0 }}>
            <table>
              <thead>
                <tr>
                  <th>Vendor</th>
                  <th>Email</th>
                  <th>Category</th>
                  <th>Match</th>
                  <th>Existed before Divini Procure?</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr><td colSpan={5} className="note" style={{ padding: 14 }}>No vendor rows found.</td></tr>
                ) : (
                  rows.map((r) => (
                    <tr key={r.index}>
                      <td><strong>{r.name || '(no name)'}</strong>{r.contact ? <div className="note">{r.contact}</div> : null}</td>
                      <td className="note">{r.email || '-'}</td>
                      <td className="note">{r.category || '-'}</td>
                      <td>
                        {r.matchedVendorCompanyId ? (
                          <span className="badge ok">Existing: {r.matchedVendorName}</span>
                        ) : (
                          <span className="badge">New starter profile</span>
                        )}
                      </td>
                      <td>
                        <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                          <input
                            type="checkbox"
                            checked={r.existedBefore}
                            onChange={(e) => patchRow(r.index, { existedBefore: e.target.checked })}
                          />
                          <span className="note">Yes, grandfather this relationship</span>
                        </label>
                        {r.existedBefore && (
                          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                            <select
                              value={r.relationshipType}
                              onChange={(e) => patchRow(r.index, { relationshipType: e.target.value })}
                            >
                              <option value="">Select relationship type…</option>
                              {REL_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                            </select>
                            <input
                              value={r.notes}
                              onChange={(e) => patchRow(r.index, { notes: e.target.value })}
                              placeholder="Notes (optional; required to explain 'Other')"
                            />
                          </div>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="note" style={{ marginTop: 12 }}>
            Confirming a pre-existing relationship queues it for admin review and applies only to that specific
            developer-vendor pair. The grandfathered 2% fee takes effect only after an admin confirms it; nothing
            is applied automatically.
          </div>

          <div style={{ marginTop: 14, display: 'flex', gap: 10, alignItems: 'center' }}>
            <button className="btn primary" disabled={busy} onClick={commit}>
              {busy
                ? 'Importing…'
                : `Import ${rows.length} vendor${rows.length === 1 ? '' : 's'}` +
                  (grandfatheredPending ? ` (${grandfatheredPending} grandfathered)` : '')}
            </button>
            <button className="btn" disabled={busy} onClick={reset}>Start over</button>
          </div>
        </>
      )}
    </>
  );
}
