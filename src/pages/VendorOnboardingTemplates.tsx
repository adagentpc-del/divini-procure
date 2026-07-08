/**
 * Category Vendor-Onboarding Templates.
 *
 * Shows, per category (cabinetry, millwork, lighting, ...), the documents and
 * profile fields a vendor must supply to be onboarded for that category. Any
 * authed user can read; a vendor uses this to see what is required for their
 * category. An ADMIN can edit a category's required docs / fields / notes (one
 * item per line), saved via POST /admin/vendor-onboarding-templates.
 */
import { useEffect, useState } from 'react';
import { useFeatures } from '../lib/features';
import { apiGet, apiSend } from '../lib/api';

type Template = {
  id: string;
  category: string;
  required_docs: string[];
  required_fields: string[];
  notes: string | null;
  created_at: string;
};

const toLines = (xs: string[] | null | undefined) => (xs ?? []).join('\n');
const fromLines = (s: string) =>
  s.split('\n').map((x) => x.trim()).filter(Boolean);

export default function VendorOnboardingTemplates() {
  const { isAdmin } = useFeatures();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selected, setSelected] = useState<string>('');
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [busy, setBusy] = useState(false);

  // admin edit state for the selected category
  const [editDocs, setEditDocs] = useState('');
  const [editFields, setEditFields] = useState('');
  const [editNotes, setEditNotes] = useState('');

  async function load() {
    setErr('');
    try {
      const d = await apiGet<{ templates: Template[] }>('/vendor-onboarding-templates');
      setTemplates(d.templates ?? []);
      if (!selected && d.templates && d.templates.length) setSelected(d.templates[0].category);
    } catch (e: any) {
      setErr(e.message ?? 'Could not load onboarding templates.');
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const current = templates.find((t) => t.category === selected) ?? null;

  // when the selected category changes, seed the admin edit fields from it
  useEffect(() => {
    if (current) {
      setEditDocs(toLines(current.required_docs));
      setEditFields(toLines(current.required_fields));
      setEditNotes(current.notes ?? '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, templates]);

  async function save() {
    if (!current) return;
    setErr(''); setOk(''); setBusy(true);
    try {
      await apiSend('POST', '/admin/vendor-onboarding-templates', {
        category: current.category,
        requiredDocs: fromLines(editDocs),
        requiredFields: fromLines(editFields),
        notes: editNotes.trim() || null,
      });
      setOk('Category requirements saved.');
      await load();
    } catch (e: any) {
      setErr(e.message ?? 'Save failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1>Vendor Onboarding Requirements</h1>
        <p className="note">
          The documents and profile fields required to onboard a vendor for each category.
          {isAdmin ? ' As an admin you can edit a category below.' : ''}
        </p>
      </div>

      {err && <div className="note err">{err}</div>}
      {ok && <div className="note ok">{ok}</div>}

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="field">
          <label>Category</label>
          <select value={selected} onChange={(e) => setSelected(e.target.value)}>
            {templates.map((t) => (
              <option key={t.category} value={t.category}>{t.category}</option>
            ))}
          </select>
        </div>
      </div>

      {current && (
        <div className="card">
          <h3>{current.category}</h3>
          {current.notes && <p className="note">{current.notes}</p>}

          <div className="two">
            <div className="field">
              <label>Required documents</label>
              <ul>
                {(current.required_docs ?? []).map((d, i) => (
                  <li key={i}>{d}</li>
                ))}
              </ul>
            </div>
            <div className="field">
              <label>Required profile fields</label>
              <ul>
                {(current.required_fields ?? []).map((f, i) => (
                  <li key={i}>{f}</li>
                ))}
              </ul>
            </div>
          </div>

          {isAdmin && (
            <div style={{ marginTop: 16, borderTop: '1px solid var(--line, #e5e5e5)', paddingTop: 12 }}>
              <h3>Edit requirements</h3>
              <p className="note">One item per line.</p>
              <div className="two">
                <div className="field">
                  <label>Required documents</label>
                  <textarea
                    rows={8}
                    value={editDocs}
                    onChange={(e) => setEditDocs(e.target.value)}
                  />
                </div>
                <div className="field">
                  <label>Required profile fields</label>
                  <textarea
                    rows={8}
                    value={editFields}
                    onChange={(e) => setEditFields(e.target.value)}
                  />
                </div>
              </div>
              <div className="field">
                <label>Notes</label>
                <textarea
                  rows={3}
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                />
              </div>
              <button className="btn" disabled={busy} onClick={save}>
                {busy ? 'Saving…' : 'Save category'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
