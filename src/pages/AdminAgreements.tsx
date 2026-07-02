/**
 * Admin: manage agreement templates and issue / track agreements.
 *
 * Left: the template library (built-in + custom) with an inline "add custom
 * template" form. Right: create an agreement from a template (pick template,
 * party company by id, counterparty email, optional project/relationship), and
 * a table of all agreements with status + a Send action.
 */
import { useEffect, useState } from 'react';
import { useFeatures } from '../lib/features';
import { apiGet, apiSend } from '../lib/api';

type Template = {
  key: string;
  name: string;
  kind: string | null;
  body: string | null;
  source: 'builtin' | 'custom';
};

type Agreement = {
  id: string;
  template_key: string | null;
  title: string;
  kind: string | null;
  party_company_id: string | null;
  party_company_name?: string | null;
  counterparty_email: string | null;
  project_name?: string | null;
  status: string;
  signature_count?: number | string;
  sent_at: string | null;
  signed_at: string | null;
  created_at: string;
};

const STATUS_CLS: Record<string, string> = {
  draft: 'badge b-neutral',
  sent: 'badge b-amber',
  viewed: 'badge b-amber',
  signed: 'badge b-emerald',
  needs_revision: 'badge b-red',
  expired: 'badge b-red',
  cancelled: 'badge b-red',
};
const statusCls = (s: string) => STATUS_CLS[s] ?? 'badge b-neutral';

export default function AdminAgreements() {
  const { isAdmin } = useFeatures();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [agreements, setAgreements] = useState<Agreement[]>([]);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [busy, setBusy] = useState(false);

  // new agreement form
  const [templateKey, setTemplateKey] = useState('');
  const [title, setTitle] = useState('');
  const [partyCompanyId, setPartyCompanyId] = useState('');
  const [counterpartyEmail, setCounterpartyEmail] = useState('');
  const [projectId, setProjectId] = useState('');
  const [relationshipId, setRelationshipId] = useState('');

  // new template form
  const [tKey, setTKey] = useState('');
  const [tName, setTName] = useState('');
  const [tKind, setTKind] = useState('');
  const [tBody, setTBody] = useState('');

  async function loadTemplates() {
    try {
      const d = await apiGet<{ templates: Template[] }>('/agreements/templates');
      setTemplates(d.templates ?? []);
    } catch (e: any) { setErr(e.message ?? 'Could not load templates.'); }
  }
  async function loadAgreements() {
    try {
      const d = await apiGet<{ agreements: Agreement[] }>('/admin/agreements');
      setAgreements(d.agreements ?? []);
    } catch (e: any) { setErr(e.message ?? 'Could not load agreements.'); }
  }
  useEffect(() => { if (isAdmin) { loadTemplates(); loadAgreements(); } }, [isAdmin]);

  async function createAgreement(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(''); setOk('');
    try {
      await apiSend('POST', '/agreements', {
        templateKey: templateKey || undefined,
        title: title || undefined,
        partyCompanyId,
        counterpartyEmail: counterpartyEmail || undefined,
        projectId: projectId || undefined,
        relationshipId: relationshipId || undefined,
      });
      setOk('Agreement created as draft.');
      setTitle(''); setCounterpartyEmail(''); setProjectId(''); setRelationshipId('');
      await loadAgreements();
    } catch (e: any) { setErr(e.message ?? 'Could not create agreement.'); }
    finally { setBusy(false); }
  }

  async function addTemplate(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(''); setOk('');
    try {
      await apiSend('POST', '/admin/agreement-templates', {
        key: tKey, name: tName, kind: tKind || undefined, body: tBody || undefined,
      });
      setOk('Template saved.');
      setTKey(''); setTName(''); setTKind(''); setTBody('');
      await loadTemplates();
    } catch (e: any) { setErr(e.message ?? 'Could not save template.'); }
    finally { setBusy(false); }
  }

  async function send(id: string) {
    setBusy(true); setErr(''); setOk('');
    try {
      await apiSend('POST', `/agreements/${id}/send`, {});
      setOk('Agreement sent.');
      await loadAgreements();
    } catch (e: any) { setErr(e.message ?? 'Could not send agreement.'); }
    finally { setBusy(false); }
  }

  if (!isAdmin) return <div className="note">Admins only.</div>;

  return (
    <div>
      <div className="page-head">
        <h1>Agreements</h1>
        <div className="sub">Manage templates, issue agreements, and track e-signatures.</div>
      </div>

      {err && <div className="err">{err}</div>}
      {ok && <div className="ok">{ok}</div>}

      <div className="two">
        <div className="card">
          <h3>Create an agreement</h3>
          <form onSubmit={createAgreement}>
            <div className="field">
              <label>Template</label>
              <select value={templateKey} onChange={(e) => setTemplateKey(e.target.value)}>
                <option value="">Custom (no template)</option>
                {templates.map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.name}{t.source === 'custom' ? ' (custom)' : ''}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Title {templateKey ? '(optional, defaults to template name)' : ''}</label>
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Agreement title" />
            </div>
            <div className="field">
              <label>Party company id (the issuing company)</label>
              <input value={partyCompanyId} onChange={(e) => setPartyCompanyId(e.target.value)} placeholder="company uuid" required />
            </div>
            <div className="field">
              <label>Counterparty email</label>
              <input value={counterpartyEmail} onChange={(e) => setCounterpartyEmail(e.target.value)} placeholder="signer@example.com" />
            </div>
            <div className="field">
              <label>Project id (optional)</label>
              <input value={projectId} onChange={(e) => setProjectId(e.target.value)} placeholder="building uuid" />
            </div>
            <div className="field">
              <label>Relationship id (optional)</label>
              <input value={relationshipId} onChange={(e) => setRelationshipId(e.target.value)} placeholder="developer-vendor relationship uuid" />
            </div>
            <button className="btn primary" disabled={busy} type="submit">Create draft</button>
          </form>
        </div>

        <div className="card">
          <h3>Add a custom template</h3>
          <div className="note">Use {'{{party_name}}'}, {'{{developer_name}}'}, {'{{vendor_name}}'}, {'{{project_name}}'}, {'{{counterparty}}'}, {'{{date}}'} as placeholders. Reusing a built-in key overrides it.</div>
          <form onSubmit={addTemplate}>
            <div className="field"><label>Key</label><input value={tKey} onChange={(e) => setTKey(e.target.value)} placeholder="my_custom_terms" required /></div>
            <div className="field"><label>Name</label><input value={tName} onChange={(e) => setTName(e.target.value)} placeholder="My Custom Terms" required /></div>
            <div className="field"><label>Kind</label><input value={tKind} onChange={(e) => setTKind(e.target.value)} placeholder="commercial" /></div>
            <div className="field"><label>Body</label><textarea value={tBody} onChange={(e) => setTBody(e.target.value)} rows={6} placeholder="Agreement body with {{placeholders}}" /></div>
            <button className="btn" disabled={busy} type="submit">Save template</button>
          </form>

          <h3 style={{ marginTop: 18 }}>Template library</h3>
          <table className="table">
            <thead><tr><th>Name</th><th>Key</th><th>Kind</th><th>Source</th></tr></thead>
            <tbody>
              {templates.map((t) => (
                <tr key={t.key}>
                  <td>{t.name}</td>
                  <td><code>{t.key}</code></td>
                  <td>{t.kind ?? ''}</td>
                  <td><span className={t.source === 'custom' ? 'badge b-emerald' : 'badge b-neutral'}>{t.source}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h3>All agreements</h3>
        <table className="table">
          <thead>
            <tr><th>Title</th><th>Party</th><th>Counterparty</th><th>Project</th><th>Status</th><th>Sigs</th><th></th></tr>
          </thead>
          <tbody>
            {agreements.map((a) => (
              <tr key={a.id}>
                <td>{a.title}</td>
                <td>{a.party_company_name ?? a.party_company_id ?? ''}</td>
                <td>{a.counterparty_email ?? ''}</td>
                <td>{a.project_name ?? ''}</td>
                <td><span className={statusCls(a.status)}>{a.status}</span></td>
                <td>{a.signature_count ?? 0}</td>
                <td>
                  {(a.status === 'draft' || a.status === 'needs_revision') && a.counterparty_email && (
                    <button className="btn" disabled={busy} onClick={() => send(a.id)}>Send</button>
                  )}
                </td>
              </tr>
            ))}
            {agreements.length === 0 && (
              <tr><td colSpan={7}><span className="note">No agreements yet.</span></td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
