/**
 * Required existing-relationship checkbox + attestation flow.
 *
 * Renders anywhere a developer adds / invites / awards / routes payment to a
 * vendor. When checked, the developer must pick the relationship type, may add
 * notes + a supporting document link, and must affirm the confirmation
 * statement before submitting. On submit it posts the attestation; the pair is
 * then queued for admin confirmation. The 2% rate only takes effect once an
 * admin approves (never automatically).
 *
 * Props identify the specific developer-vendor pair (and optional project).
 */
import { useState } from 'react';
import { apiSend } from '../lib/api';
import FeeBadge, { type FeeInfo } from './FeeBadge';

const TYPES: [string, string][] = [
  ['active_contract', 'We are already under contract with this vendor.'],
  ['already_working_together', 'We are already actively working with this vendor.'],
  ['active_negotiation', 'We are already in active negotiations with this vendor.'],
  ['already_selected_or_shortlisted', 'We had already selected or shortlisted this vendor before adding them to Divini Procure.'],
  ['other', 'Other. Explain below.'],
];

export default function ExistingRelationshipCheckbox({
  developerCompanyId,
  vendorCompanyId,
  vendorName,
  projectId,
  onConfirmed,
}: {
  developerCompanyId: string;
  vendorCompanyId: string;
  vendorName?: string;
  projectId?: string | null;
  onConfirmed?: (relationship: any, fee: FeeInfo) => void;
}) {
  const [checked, setChecked] = useState(false);
  const [type, setType] = useState('');
  const [notes, setNotes] = useState('');
  const [docUrl, setDocUrl] = useState('');
  const [affirmed, setAffirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState<FeeInfo | null>(null);

  async function submit() {
    setErr('');
    if (!type) { setErr('Select what best describes the existing relationship.'); return; }
    if (!affirmed) { setErr('Please affirm the confirmation statement.'); return; }
    setBusy(true);
    try {
      const r = await apiSend<{ relationship: any; fee: FeeInfo }>('POST', '/relationships/confirm-existing', {
        developerCompanyId,
        vendorCompanyId,
        projectId: projectId ?? undefined,
        relationshipType: type,
        notes: notes || undefined,
        supportingDocumentUrl: docUrl || undefined,
        confirmed: true,
      });
      setDone(r.fee);
      onConfirmed?.(r.relationship, r.fee);
    } catch (e: any) {
      setErr(e.message ?? 'Could not record the relationship.');
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="card" style={{ borderColor: 'var(--emerald)' }}>
        <div className="ok" style={{ marginBottom: 8 }}>
          Existing relationship recorded{vendorName ? ` with ${vendorName}` : ''}. Sent for admin confirmation.
        </div>
        <FeeBadge fee={done} audience="developer" />
      </div>
    );
  }

  return (
    <div className="card" style={{ background: 'var(--panel, #fafafa)' }}>
      <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => setChecked(e.target.checked)}
          style={{ marginTop: 3 }}
        />
        <span>
          <strong>This developer/vendor relationship existed before Divini Procure.</strong>
          <div className="note" style={{ marginTop: 4 }}>
            Check this only if you were already under contract, already working together, already in active
            negotiations, or had already selected/shortlisted this vendor before adding them to Divini Procure.
            If confirmed, this specific developer-vendor relationship will be grandfathered into a 2% payment
            authorization/platform processing fee forever.
          </div>
        </span>
      </label>

      {checked && (
        <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="field">
            <label>What best describes the existing relationship?</label>
            <select value={type} onChange={(e) => setType(e.target.value)}>
              <option value="">Select one…</option>
              {TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>

          <div className="field">
            <label>Notes {type === 'other' ? '(required to explain)' : '(optional)'}</label>
            <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Context for this existing relationship" />
          </div>

          <div className="field">
            <label>Supporting document link (optional)</label>
            <input value={docUrl} onChange={(e) => setDocUrl(e.target.value)} placeholder="Link to contract, email thread, proposal, LOI, or quote" />
            <div className="note" style={{ fontSize: 12, marginTop: 4 }}>
              You can also upload the document in the project Documents section and paste its link here.
            </div>
          </div>

          <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13.5 }}>
            <input type="checkbox" checked={affirmed} onChange={(e) => setAffirmed(e.target.checked)} style={{ marginTop: 3 }} />
            <span>
              I confirm this vendor relationship existed before being added to Divini Procure, and I understand
              this applies only to this specific developer-vendor relationship.
            </span>
          </label>

          {err && <div className="err">{err}</div>}

          <div>
            <button className="btn primary" disabled={busy} onClick={submit}>
              {busy ? 'Saving…' : 'Confirm existing relationship'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
