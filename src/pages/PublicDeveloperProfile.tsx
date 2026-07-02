/**
 * Public vs Private Developer Profile (developer / buyer).
 *
 * A developer edits the PUBLIC face of their company: bio, markets, asset
 * classes, completed projects, a public-opportunities toggle, and an is_public
 * toggle. They can also preview exactly what the public view returns.
 *
 * PUBLIC vs PRIVATE: this page only controls the public profile. The PRIVATE
 * side of the company (subscription, internal fees, deal pipeline, investor
 * financials, relationships) lives in its own areas and is never shown or
 * exposed here.
 */
import { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth';
import { apiGet, apiSend } from '../lib/api';

type Profile = {
  company_id?: string;
  bio?: string;
  markets?: string[];
  asset_classes?: string[];
  completed_projects?: string;
  public_opportunities?: boolean;
  is_public?: boolean;
  company_name?: string;
};

type PublicDeck = {
  id: string;
  title?: string;
  description?: string;
  file_name?: string;
  download_url?: string;
};

type PublicProgram = {
  id: string;
  title?: string;
  summary?: string;
  details?: string;
  price_terms?: string;
  cta_label?: string;
  cta_url?: string;
};

const csv = (arr?: string[]) => (arr ?? []).join(', ');
const toArray = (s: string) =>
  s
    .split(',')
    .map((x) => x.trim())
    .filter((x) => x !== '');

export default function PublicDeveloperProfile() {
  const { company } = useAuth();
  const [bio, setBio] = useState('');
  const [markets, setMarkets] = useState('');
  const [assetClasses, setAssetClasses] = useState('');
  const [completedProjects, setCompletedProjects] = useState('');
  const [publicOpportunities, setPublicOpportunities] = useState(true);
  const [isPublic, setIsPublic] = useState(true);

  const [preview, setPreview] = useState<Profile | null>(null);
  const [decks, setDecks] = useState<PublicDeck[]>([]);
  const [programs, setPrograms] = useState<PublicProgram[]>([]);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [busy, setBusy] = useState(false);

  async function loadPreview() {
    if (!company) return;
    try {
      const r = await apiGet<{ profile: Profile }>(`/developers/${company.id}/public`);
      setPreview(r.profile);
      // Seed the editor from the saved profile.
      setBio(r.profile.bio ?? '');
      setMarkets(csv(r.profile.markets));
      setAssetClasses(csv(r.profile.asset_classes));
      setCompletedProjects(r.profile.completed_projects ?? '');
      setPublicOpportunities(r.profile.public_opportunities ?? true);
      setIsPublic(r.profile.is_public ?? true);
    } catch {
      // 404 when no profile exists yet, or when it is not public. Leave the
      // editor in its default state; preview stays empty.
      setPreview(null);
    }
  }

  async function loadCollateral() {
    if (!company) return;
    try {
      const [d, p] = await Promise.all([
        apiGet<{ decks: PublicDeck[] }>(`/profiles/${company.id}/decks`),
        apiGet<{ programs: PublicProgram[] }>(`/profiles/${company.id}/programs`),
      ]);
      setDecks(d.decks ?? []);
      setPrograms(p.programs ?? []);
    } catch {
      setDecks([]);
      setPrograms([]);
    }
  }

  useEffect(() => {
    void loadPreview();
    void loadCollateral();
    /* eslint-disable-next-line */
  }, [company]);

  if (!company) return <div className="note">Loading…</div>;
  if (company.kind !== 'buyer') return <div className="card">This page is for developer accounts.</div>;

  async function save() {
    if (!company) return;
    setBusy(true);
    setErr('');
    setOk('');
    try {
      await apiSend('PUT', '/developer-public-profile', {
        companyId: company.id,
        bio,
        markets: toArray(markets),
        assetClasses: toArray(assetClasses),
        completedProjects,
        publicOpportunities,
        isPublic,
      });
      setOk('Public profile saved.');
      await loadPreview();
    } catch (e: any) {
      setErr(e.message ?? 'Could not save profile.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Public developer profile</h1>
          <div className="sub">
            Control what the marketplace sees about {company.name}. Public means visible to other authenticated
            members.
          </div>
        </div>
      </div>

      <div className="note" style={{ marginBottom: 12 }}>
        Public vs private: this page only edits your public profile. Your private posture (subscription, fees,
        deal pipeline, investor financials, relationships) is never shown here and is never exposed publicly.
      </div>

      {err && <div className="err">{err}</div>}
      {ok && <div className="ok">{ok}</div>}

      <div className="two">
        <div className="card">
          <div className="note" style={{ fontWeight: 700, marginBottom: 10 }}>Edit public profile</div>
          <div className="field">
            <label>Bio</label>
            <textarea rows={4} value={bio} onChange={(e) => setBio(e.target.value)} />
          </div>
          <div className="field">
            <label>Markets (comma separated)</label>
            <input value={markets} onChange={(e) => setMarkets(e.target.value)} placeholder="e.g. Austin, Dallas" />
          </div>
          <div className="field">
            <label>Asset classes (comma separated)</label>
            <input
              value={assetClasses}
              onChange={(e) => setAssetClasses(e.target.value)}
              placeholder="e.g. Multifamily, Hospitality"
            />
          </div>
          <div className="field">
            <label>Completed projects</label>
            <textarea
              rows={3}
              value={completedProjects}
              onChange={(e) => setCompletedProjects(e.target.value)}
            />
          </div>
          <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginBottom: 10 }}>
            <label className="note">
              <input
                type="checkbox"
                checked={publicOpportunities}
                onChange={(e) => setPublicOpportunities(e.target.checked)}
              />{' '}
              Show public opportunities
            </label>
            <label className="note">
              <input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} /> Profile is
              public
            </label>
          </div>
          <button className="btn primary" disabled={busy} onClick={save}>
            Save public profile
          </button>
        </div>

        <div className="card">
          <div className="note" style={{ fontWeight: 700, marginBottom: 10 }}>Public preview</div>
          {!isPublic && (
            <div className="note" style={{ marginBottom: 10 }}>
              Profile is currently set to private, so it will not appear publicly. Save with "Profile is public"
              checked to publish.
            </div>
          )}
          {preview ? (
            <>
              <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 6 }}>
                {preview.company_name || company.name}
              </div>
              <p className="note" style={{ whiteSpace: 'pre-wrap' }}>{preview.bio || 'No bio yet.'}</p>
              <div style={{ marginTop: 8 }}>
                <span className="note">Markets:</span> {csv(preview.markets) || '-'}
              </div>
              <div>
                <span className="note">Asset classes:</span> {csv(preview.asset_classes) || '-'}
              </div>
              <div style={{ marginTop: 8 }}>
                <span className="note">Completed projects:</span>
                <div style={{ whiteSpace: 'pre-wrap' }}>{preview.completed_projects || '-'}</div>
              </div>
              <div style={{ marginTop: 8 }}>
                <span className={'badge ' + (preview.public_opportunities ? 'ok' : 'b-neutral')}>
                  {preview.public_opportunities ? 'Open to opportunities' : 'Opportunities hidden'}
                </span>
              </div>
            </>
          ) : (
            <div className="note">
              No public profile is published yet. Fill in the form and save with "Profile is public" checked to
              see the preview.
            </div>
          )}

          {/* Public pitch decks / collateral. Managed on the Collateral page. */}
          <div style={{ marginTop: 16 }}>
            <div className="note" style={{ fontWeight: 700, marginBottom: 6 }}>Pitch decks and collateral</div>
            {decks.length === 0 ? (
              <div className="note">No public decks. Add them on the Collateral page.</div>
            ) : (
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {decks.map((d) => (
                  <li key={d.id} style={{ marginBottom: 4 }}>
                    {d.download_url ? (
                      <a href={d.download_url} target="_blank" rel="noreferrer">{d.title || d.file_name || 'Deck'}</a>
                    ) : (
                      d.title || d.file_name || 'Deck'
                    )}
                    {d.description ? <span className="note"> {d.description}</span> : null}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Active custom programs / offerings. Managed on the Collateral page. */}
          <div style={{ marginTop: 16 }}>
            <div className="note" style={{ fontWeight: 700, marginBottom: 6 }}>Programs and offerings</div>
            {programs.length === 0 ? (
              <div className="note">No active programs. Add them on the Collateral page.</div>
            ) : (
              programs.map((p) => (
                <div key={p.id} style={{ marginBottom: 10 }}>
                  <div style={{ fontWeight: 700 }}>{p.title || 'Program'}</div>
                  {p.summary ? <div className="note">{p.summary}</div> : null}
                  {p.details ? <div style={{ whiteSpace: 'pre-wrap' }}>{p.details}</div> : null}
                  {p.price_terms ? (
                    <div className="note" style={{ marginTop: 2 }}>Price / terms: {p.price_terms}</div>
                  ) : null}
                  {p.cta_label ? (
                    p.cta_url ? (
                      <a href={p.cta_url} target="_blank" rel="noreferrer" className="btn" style={{ marginTop: 4, display: 'inline-block' }}>
                        {p.cta_label}
                      </a>
                    ) : (
                      <span className="badge b-neutral" style={{ marginTop: 4, display: 'inline-block' }}>{p.cta_label}</span>
                    )
                  ) : null}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </>
  );
}
