/**
 * Party (developer / vendor) view of their agreements.
 *
 * A company member sees agreements issued by their company, opens one to read
 * the full body, and signs by typing a name + signature and affirming. Opening
 * a 'sent' agreement marks it viewed (server side). Status badges throughout.
 */
import { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth';
import { apiGet, apiSend } from '../lib/api';

type Signature = {
  id: string;
  signer_name: string | null;
  signer_email: string | null;
  signature_text: string | null;
  signed_at: string;
};

type Agreement = {
  id: string;
  template_key: string | null;
  title: string;
  kind: string | null;
  counterparty_email: string | null;
  body: string | null;
  file_url: string | null;
  status: string;
  sent_at: string | null;
  viewed_at: string | null;
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

export default function Agreements() {
  const { company, session } = useAuth();
  const [rows, setRows] = useState<Agreement[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ agreement: Agreement; signatures: Signature[] } | null>(null);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [busy, setBusy] = useState(false);

  const [signerName, setSignerName] = useState('');
  const [signatureText, setSignatureText] = useState('');
  const [affirm, setAffirm] = useState(false);

  async function load() {
    if (!company) return;
    try {
      const d = await apiGet<{ agreements: Agreement[] }>(`/agreements?companyId=${company.id}`);
      setRows(d.agreements ?? []);
    } catch (e: any) { setErr(e.message ?? 'Could not load agreements.'); }
  }
  useEffect(() => { load(); }, [company]);

  async function openDetail(id: string) {
    if (openId === id) { setOpenId(null); setDetail(null); return; }
    setOpenId(id); setErr(''); setOk('');
    try {
      const d = await apiGet<{ agreement: Agreement; signatures: Signature[] }>(`/agreements/${id}`);
      setDetail(d);
      // prefill signer name from the session email if blank
      if (!signerName && session?.user.email) setSignerName(session.user.email);
      await load();
    } catch (e: any) { setErr(e.message ?? 'Could not load agreement.'); }
  }

  async function sign(id: string) {
    setBusy(true); setErr(''); setOk('');
    try {
      await apiSend('POST', `/agreements/${id}/sign`, {
        signerName, signatureText, affirm,
        signerCompanyId: company?.id,
        signerEmail: session?.user.email ?? undefined,
      });
      setOk('Signed. Thank you.');
      setSignatureText(''); setAffirm(false);
      const d = await apiGet<{ agreement: Agreement; signatures: Signature[] }>(`/agreements/${id}`);
      setDetail(d);
      await load();
    } catch (e: any) { setErr(e.message ?? 'Could not sign.'); }
    finally { setBusy(false); }
  }

  if (!company) return <div className="note">Loading…</div>;

  return (
    <div>
      <div className="page-head">
        <h1>Agreements</h1>
        <div className="sub">Review and sign agreements issued to {company.name}.</div>
      </div>

      {err && <div className="err">{err}</div>}
      {ok && <div className="ok">{ok}</div>}

      <div className="card">
        <table className="table">
          <thead>
            <tr><th>Title</th><th>Kind</th><th>Status</th><th>Created</th><th></th></tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.id}>
                <td>{a.title}</td>
                <td>{a.kind ?? ''}</td>
                <td><span className={statusCls(a.status)}>{a.status}</span></td>
                <td>{new Date(a.created_at).toLocaleDateString()}</td>
                <td><button className="btn" onClick={() => openDetail(a.id)}>{openId === a.id ? 'Close' : 'Open'}</button></td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={5}><span className="note">No agreements yet.</span></td></tr>
            )}
          </tbody>
        </table>
      </div>

      {openId && detail && (
        <div className="card">
          <div className="page-head">
            <h1 style={{ fontSize: 20 }}>{detail.agreement.title}</h1>
            <div className="sub"><span className={statusCls(detail.agreement.status)}>{detail.agreement.status}</span></div>
          </div>

          {detail.agreement.file_url && (
            <p className="note"><a href={detail.agreement.file_url} target="_blank" rel="noreferrer">View attached document</a></p>
          )}
          {detail.agreement.body && (
            <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', background: 'transparent' }}>
              {detail.agreement.body}
            </pre>
          )}

          {detail.signatures.length > 0 && (
            <div className="note">
              Signed by {detail.signatures.map((s) => `${s.signer_name ?? ''} (${new Date(s.signed_at).toLocaleString()})`).join(', ')}.
            </div>
          )}

          {detail.agreement.status !== 'signed' &&
           detail.agreement.status !== 'cancelled' &&
           detail.agreement.status !== 'expired' && (
            <div style={{ marginTop: 14 }}>
              <h3>Sign this agreement</h3>
              <div className="field">
                <label>Your name</label>
                <input value={signerName} onChange={(e) => setSignerName(e.target.value)} placeholder="Full name" />
              </div>
              <div className="field">
                <label>Typed signature</label>
                <input value={signatureText} onChange={(e) => setSignatureText(e.target.value)} placeholder="Type your name to sign" />
              </div>
              <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <input type="checkbox" checked={affirm} onChange={(e) => setAffirm(e.target.checked)} />
                <span>I affirm that I am authorized to sign and that this typed signature is legally binding.</span>
              </label>
              <button className="btn primary" disabled={busy || !signerName || !signatureText || !affirm} onClick={() => sign(openId)}>
                Sign agreement
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
