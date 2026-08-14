/**
 * API Keys - developer platform key management (competitive gap closure,
 * docs/competitive-analysis-2026-08.md gap #11). Talks to /api/api-keys
 * (server/src/routes/api-keys.ts). A key authenticates as the company
 * member who created it - same permissions, nothing more - so it works
 * against every existing endpoint with no separate API surface to learn.
 * Zero em dashes by convention.
 */
import { useEffect, useState } from 'react';
import { apiGet, apiSend } from '../lib/api';

interface ApiKey {
  id: string;
  name: string;
  key_prefix: string;
  scopes: string[];
  last_used_at: string | null;
  created_at: string;
  revoked_at: string | null;
}

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Never';

export default function ApiKeys() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');

  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [scopeRead, setScopeRead] = useState(true);
  const [scopeWrite, setScopeWrite] = useState(false);
  const [creating, setCreating] = useState(false);

  // The raw key is shown exactly once, right after creation, then discarded from memory.
  const [revealedKey, setRevealedKey] = useState<{ name: string; rawKey: string } | null>(null);

  async function load() {
    try {
      const d = await apiGet<{ apiKeys: ApiKey[] }>('/api-keys');
      setKeys(d.apiKeys ?? []);
    } catch (e: any) {
      setErr(e.message ?? 'Could not load API keys');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function createKey() {
    if (!name.trim()) { setErr('Name your key so you can recognize it later.'); return; }
    const scopes = [...(scopeRead ? ['read'] : []), ...(scopeWrite ? ['write'] : [])];
    if (scopes.length === 0) { setErr('Select at least one scope.'); return; }
    setCreating(true);
    setErr('');
    try {
      const d = await apiSend<{ apiKey: { id: string; name: string; rawKey: string } }>('POST', '/api-keys', { name: name.trim(), scopes });
      setRevealedKey({ name: d.apiKey.name, rawKey: d.apiKey.rawKey });
      setName('');
      setScopeRead(true);
      setScopeWrite(false);
      setShowForm(false);
      await load();
    } catch (e: any) {
      setErr(e.message ?? 'Could not create API key');
    } finally {
      setCreating(false);
    }
  }

  async function revoke(id: string, keyName: string) {
    if (!window.confirm(`Revoke "${keyName}"? Any integration using it will stop working immediately.`)) return;
    try {
      await apiSend('DELETE', `/api-keys/${id}`);
      setMsg(`"${keyName}" revoked.`);
      await load();
    } catch (e: any) {
      setErr(e.message ?? 'Could not revoke key');
    }
  }

  const activeKeys = keys.filter(k => !k.revoked_at);
  const revokedKeys = keys.filter(k => k.revoked_at);

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>API Keys</h1>
          <div className="sub">Programmatic access to your Divini Procure account. A key acts exactly as you would - same visibility, same permissions - so scope it to read-only unless an integration genuinely needs to write.</div>
        </div>
        <button className="btn primary" onClick={() => setShowForm(!showForm)}>
          {showForm ? 'Cancel' : '+ Create Key'}
        </button>
      </div>

      {err && (
        <div className="err" style={{ display: 'flex', justifyContent: 'space-between' }}>
          {err}
          <button onClick={() => setErr('')} style={{ background: 'none', border: 'none', color: 'inherit', fontWeight: 700, cursor: 'pointer' }}>×</button>
        </div>
      )}
      {msg && (
        <div className="ok" style={{ display: 'flex', justifyContent: 'space-between' }}>
          {msg}
          <button onClick={() => setMsg('')} style={{ background: 'none', border: 'none', color: 'inherit', fontWeight: 700, cursor: 'pointer' }}>×</button>
        </div>
      )}

      {revealedKey && (
        <div className="card" style={{ background: 'var(--ivory)', marginBottom: 18, border: '1px solid var(--emerald)' }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>"{revealedKey.name}" created</div>
          <div className="note" style={{ marginBottom: 10 }}>
            Copy this key now - it will not be shown again. If you lose it, revoke it and create a new one.
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <code style={{ background: 'var(--card)', padding: '8px 12px', borderRadius: 6, fontSize: 13, flex: 1, wordBreak: 'break-all' }}>
              {revealedKey.rawKey}
            </code>
            <button
              className="btn"
              onClick={() => { navigator.clipboard?.writeText(revealedKey.rawKey); setMsg('Copied to clipboard.'); }}
            >
              Copy
            </button>
          </div>
          <button className="btn" style={{ marginTop: 10 }} onClick={() => setRevealedKey(null)}>Done</button>
        </div>
      )}

      {showForm && (
        <div className="card" style={{ marginBottom: 18 }}>
          <h3 style={{ fontSize: 15, marginBottom: 12 }}>New API Key</h3>
          <div className="field">
            <label>Name</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Accounting sync" />
          </div>
          <div className="field">
            <label>Scopes</label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
              <input type="checkbox" checked={scopeRead} onChange={e => setScopeRead(e.target.checked)} />
              <span>Read - can view your account's data</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input type="checkbox" checked={scopeWrite} onChange={e => setScopeWrite(e.target.checked)} />
              <span>Write - can also create/update/delete on your behalf</span>
            </label>
          </div>
          <button className="btn primary" disabled={creating} onClick={createKey}>
            {creating ? 'Creating...' : 'Create Key'}
          </button>
        </div>
      )}

      {loading && <div className="note">Loading...</div>}

      {!loading && activeKeys.length === 0 && (
        <div className="card" style={{ textAlign: 'center', padding: 32 }}>
          <p className="note">No active API keys. Create one to integrate with Divini Procure programmatically.</p>
        </div>
      )}

      {!loading && activeKeys.length > 0 && (
        <div className="card" style={{ padding: 0, marginBottom: 18 }}>
          <table>
            <thead>
              <tr><th>Name</th><th>Key</th><th>Scopes</th><th>Last used</th><th>Created</th><th></th></tr>
            </thead>
            <tbody>
              {activeKeys.map(k => (
                <tr key={k.id}>
                  <td><strong>{k.name}</strong></td>
                  <td><code style={{ fontSize: 12 }}>{k.key_prefix}...</code></td>
                  <td>{k.scopes.map(s => <span key={s} className="badge b-neutral" style={{ marginRight: 4 }}>{s}</span>)}</td>
                  <td>{fmtDate(k.last_used_at)}</td>
                  <td>{fmtDate(k.created_at)}</td>
                  <td><button className="btn" onClick={() => revoke(k.id, k.name)}>Revoke</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {revokedKeys.length > 0 && (
        <>
          <div className="sectitle">Revoked</div>
          <div className="card" style={{ padding: 0 }}>
            <table>
              <thead><tr><th>Name</th><th>Key</th><th>Revoked</th></tr></thead>
              <tbody>
                {revokedKeys.map(k => (
                  <tr key={k.id}>
                    <td className="note">{k.name}</td>
                    <td className="note"><code style={{ fontSize: 12 }}>{k.key_prefix}...</code></td>
                    <td className="note">{fmtDate(k.revoked_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <div className="note" style={{ marginTop: 24 }}>
        Send your key as <code>Authorization: Bearer &lt;key&gt;</code> on any Divini Procure API request -
        it works exactly like your own signed-in session, scoped to what you selected above.
        A read-only key is limited to GET requests; every key is limited to 120 requests/minute.
      </div>
    </div>
  );
}
