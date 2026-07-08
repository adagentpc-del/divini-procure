import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import {
  createCompanyForUser,
  extractProfileFromUrl,
  uploadCompanyMedia,
  type CompanyPayload,
  type MediaCategory,
} from '../lib/db';
import { apiSend } from '../lib/api';

const VENDOR_SERVICES = ['Millwork', 'Cabinetry', 'Doors', 'Furniture', 'Lighting', 'Concrete', 'Steel', 'Electrical', 'Drapery', 'Security', 'Signage', 'Windows', 'Flooring', 'Metalwork'];
const VENDOR_CAPABILITIES = ['Manufacturing', 'Distribution', 'Installation', 'Logistics', 'Warehousing', 'Service', 'Maintenance'];
const ASSET_TYPES = ['Multifamily', 'Hospitality', 'Office', 'Retail', 'Mixed-Use', 'Senior Living', 'Student Housing', 'Industrial'];
const INVESTOR_FOCUS = ['Multifamily', 'Hospitality', 'Office', 'Retail', 'Mixed-Use', 'Industrial', 'Senior Living'];

type Kind = 'buyer' | 'vendor' | 'investor';
type StagedMedia = { file: File; category: MediaCategory };

// Verify-first credentials a vendor stages during onboarding. Each carries an
// optional expiry date so the platform can warn before it lapses. Workers comp
// is conditional (only if the vendor has employees). These are posted
// best-effort to /me/verification/documents after the company is created; a
// missing endpoint never blocks onboarding.
type CredentialKind = 'license' | 'insurance' | 'workers_comp' | 'certification';
type StagedCredential = {
  kind: CredentialKind;
  file: File;
  expiry: string; // yyyy-mm-dd, optional
  label?: string; // free-text for certifications (e.g. trade / issuer)
};

// A current job / bid / position the user has going on now. Best-effort POST to
// the shared engagements tracker; non-blocking so it never stops finishing.
type EngageType = 'job' | 'bid' | 'position' | 'deal';
type EngageDraft = {
  title: string;
  type: EngageType;
  counterparty: string;
  value: string;
  location: string;
  notes: string;
};

const DEV_STEPS = ['Company', 'Details', 'Contact', 'Brand & materials', 'Review'];
const VENDOR_STEPS = ['Company', 'Coverage', 'Contact', 'Documents', 'Agreement', 'Review'];
const INVESTOR_STEPS = ['Firm', 'Geographies', 'Contact', 'Materials', 'Review'];

function emptyEngagement(type: EngageType): EngageDraft {
  return { title: '', type, counterparty: '', value: '', location: '', notes: '' };
}

function readRoleHint(): Kind | null {
  try {
    const q = new URLSearchParams(window.location.search).get('role');
    const fromQuery = normalizeRole(q);
    if (fromQuery) return fromQuery;
    const stored = localStorage.getItem('procure_onboard_role');
    return normalizeRole(stored);
  } catch {
    return null;
  }
}

function normalizeRole(v: string | null | undefined): Kind | null {
  const r = (v ?? '').toLowerCase().trim();
  if (r === 'vendor' || r === 'supplier') return 'vendor';
  if (r === 'investor') return 'investor';
  if (r === 'developer' || r === 'buyer') return 'buyer';
  return null;
}

export default function Onboarding() {
  const { session, refreshCompany } = useAuth();
  const nav = useNavigate();

  const [kind, setKind] = useState<Kind>('buyer');
  const [step, setStep] = useState(0);

  // Step 1 / shared
  const [name, setName] = useState('');
  const [website, setWebsite] = useState('');
  const [assetTypes, setAssetTypes] = useState<string[]>([]);
  const [services, setServices] = useState<string[]>([]); // vendor service categories
  const [capabilities, setCapabilities] = useState<string[]>([]);
  const [coverageAreas, setCoverageAreas] = useState<string[]>([]);
  const [coverageInput, setCoverageInput] = useState('');
  const [focusAreas, setFocusAreas] = useState<string[]>([]); // investor asset classes
  const [geographies, setGeographies] = useState<string[]>([]);
  const [geoInput, setGeoInput] = useState('');

  // Details (developer)
  const [description, setDescription] = useState('');
  const [descFromAi, setDescFromAi] = useState(false);
  const [street, setStreet] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [ownershipGroup, setOwnershipGroup] = useState('');
  const [developmentTeam, setDevelopmentTeam] = useState('');

  // Contact
  const [contact, setContact] = useState('');
  const [title, setTitle] = useState('');
  const [email, setEmail] = useState(session?.user.email ?? '');
  const [phone, setPhone] = useState('');

  // Media
  const [staged, setStaged] = useState<StagedMedia[]>([]);

  // Verify-first credentials (vendor)
  const [credentials, setCredentials] = useState<StagedCredential[]>([]);
  const [hasEmployees, setHasEmployees] = useState(false);

  // Vendor agreement
  const [agreed, setAgreed] = useState(false);

  // "What do you have going on now" engagements
  const [engagements, setEngagements] = useState<EngageDraft[]>([]);

  const [pulling, setPulling] = useState(false);
  const [pullMsg, setPullMsg] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  // Preselect role from URL query / localStorage hint (set by invite/join flow).
  useEffect(() => {
    const hint = readRoleHint();
    if (hint) {
      setKind(hint);
      setStep(0);
    }
  }, []);

  // Apply a one-time pre-fill stashed by the claim page (JoinInvite). Populates
  // company name/website/description/location and the role's focus chips, then
  // clears the key so it only ever applies once. Best-effort; never throws.
  useEffect(() => {
    let prefill: Record<string, unknown> | null = null;
    try {
      const raw = localStorage.getItem('procure_onboard_prefill');
      if (raw) prefill = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      prefill = null;
    }
    if (!prefill) return;
    try { localStorage.removeItem('procure_onboard_prefill'); } catch { /* ignore */ }

    const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : '');
    const arr = (v: unknown) =>
      Array.isArray(v) ? v.map((x) => (typeof x === 'string' ? x.trim() : '')).filter(Boolean) : [];

    const cn = str(prefill.companyName) || str((prefill as { name?: unknown }).name);
    if (cn) setName(cn);
    const ws = str(prefill.website);
    if (ws) setWebsite(ws);
    const desc = str(prefill.description);
    if (desc) { setDescription(desc); setDescFromAi(false); }
    const ct = str(prefill.contact);
    if (ct) setContact(ct);
    const ci = str(prefill.city);
    if (ci) setCity(ci);
    const st = str(prefill.state);
    if (st) setState(st);

    const assetTypes = arr(prefill.assetTypes);
    if (assetTypes.length) setAssetTypes((prev) => Array.from(new Set([...prev, ...assetTypes])));
    const focusAreas = arr(prefill.focusAreas);
    if (focusAreas.length) setFocusAreas((prev) => Array.from(new Set([...prev, ...focusAreas])));
  }, []);

  const steps = kind === 'vendor' ? VENDOR_STEPS : kind === 'investor' ? INVESTOR_STEPS : DEV_STEPS;
  const lastStep = steps.length - 1;

  // The default engagement type label per role.
  const engageType: EngageType = kind === 'vendor' ? 'job' : kind === 'investor' ? 'position' : 'job';

  function toggleIn(list: string[], setList: (v: string[]) => void, v: string) {
    setList(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  }

  function setKindAndReset(k: Kind) {
    setKind(k);
    setStep(0);
    setErr('');
  }

  function addChipFromInput(
    raw: string,
    list: string[],
    setList: (v: string[]) => void,
    clear: () => void,
  ) {
    const v = raw.trim();
    if (!v) return;
    if (!list.includes(v)) setList([...list, v]);
    clear();
  }

  async function pullFromWebsite() {
    setErr('');
    setPullMsg('');
    if (!website.trim()) {
      setErr('Enter a website URL first.');
      return;
    }
    setPulling(true);
    try {
      const out = await extractProfileFromUrl(website.trim());
      if (!out.available) {
        setPullMsg('Auto-fill is not available right now. You can write the description yourself.');
      } else {
        if (out.name && !name.trim()) setName(out.name);
        if (out.description) {
          setDescription(out.description);
          setDescFromAi(true);
        }
        // Map any returned tags into the role-appropriate chip set.
        const tags = out.tags ?? [];
        const matches = (pool: string[]) =>
          pool.filter((a) => tags.some((t) => a.toLowerCase().includes(t) || t.includes(a.toLowerCase())));
        if (kind === 'buyer') {
          const m = matches(ASSET_TYPES);
          if (m.length) setAssetTypes((prev) => Array.from(new Set([...prev, ...m])));
        } else if (kind === 'vendor') {
          const m = matches(VENDOR_SERVICES);
          if (m.length) setServices((prev) => Array.from(new Set([...prev, ...m])));
        } else {
          const m = matches(INVESTOR_FOCUS);
          if (m.length) setFocusAreas((prev) => Array.from(new Set([...prev, ...m])));
        }
        setPullMsg('Pulled a draft from your website. Please review and edit before continuing.');
      }
    } catch {
      setPullMsg('Could not read that website. You can write the description yourself.');
    } finally {
      setPulling(false);
    }
  }

  function addMedia(files: FileList | null, category: MediaCategory) {
    if (!files) return;
    const next: StagedMedia[] = [];
    for (let i = 0; i < files.length; i++) next.push({ file: files[i], category });
    setStaged((prev) => [...prev, ...next]);
  }

  function removeMedia(idx: number) {
    setStaged((prev) => prev.filter((_, i) => i !== idx));
  }

  // ---- verify-first credential staging ----
  function setCredentialFile(kind: CredentialKind, files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    setCredentials((prev) => {
      // single-file kinds (license / insurance / workers comp) replace; certs append
      if (kind === 'certification') {
        return [...prev, { kind, file, expiry: '', label: '' }];
      }
      const without = prev.filter((c) => c.kind !== kind);
      const existing = prev.find((c) => c.kind === kind);
      return [...without, { kind, file, expiry: existing?.expiry ?? '', label: existing?.label }];
    });
  }
  function setCredentialExpiry(kind: CredentialKind, idx: number, expiry: string) {
    setCredentials((prev) =>
      prev.map((c, i) => (c.kind === kind && i === idx ? { ...c, expiry } : c)),
    );
  }
  function setCredentialLabel(idx: number, label: string) {
    setCredentials((prev) => prev.map((c, i) => (i === idx ? { ...c, label } : c)));
  }
  function removeCredential(idx: number) {
    setCredentials((prev) => prev.filter((_, i) => i !== idx));
  }

  // Best-effort: upload each credential as company media (so the file lands in
  // storage) and register its type + expiry on the verification queue. Both
  // calls are guarded so a missing/parallel endpoint never blocks onboarding.
  async function postCredentials(companyId: string) {
    const CATEGORY: Record<CredentialKind, MediaCategory> = {
      license: 'license',
      insurance: 'insurance',
      workers_comp: 'insurance',
      certification: 'cert',
    };
    for (const c of credentials) {
      let mediaId: string | undefined;
      try {
        const up = await uploadCompanyMedia(c.file, { companyId, category: CATEGORY[c.kind] });
        mediaId = up?.id;
      } catch {
        /* media upload is non-blocking */
      }
      try {
        await apiSend('POST', '/me/verification/documents', {
          companyId,
          kind: c.kind,
          label: c.label?.trim() || undefined,
          expiry: c.expiry || undefined,
          mediaId,
          fileName: c.file.name,
        });
      } catch {
        /* verification endpoint may not exist yet: non-blocking */
      }
    }
    if (credentials.length) {
      try {
        await apiSend('POST', '/me/verification/submit', { companyId, hasEmployees });
      } catch {
        /* non-blocking */
      }
    }
  }

  function addEngagement() {
    setEngagements((prev) => [...prev, emptyEngagement(engageType)]);
  }
  function updateEngagement(idx: number, patch: Partial<EngageDraft>) {
    setEngagements((prev) => prev.map((e, i) => (i === idx ? { ...e, ...patch } : e)));
  }
  function removeEngagement(idx: number) {
    setEngagements((prev) => prev.filter((_, i) => i !== idx));
  }

  // Best-effort POST of current engagements. Each failure is swallowed so a
  // missing/parallel endpoint never blocks onboarding completion.
  async function postEngagements() {
    for (const e of engagements) {
      if (!e.title.trim()) continue;
      const valueCents = (() => {
        const n = Number(String(e.value).replace(/[^0-9.]/g, ''));
        return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : undefined;
      })();
      try {
        await apiSend('POST', '/engagements', {
          title: e.title.trim(),
          type: e.type,
          status: 'active',
          counterparty: e.counterparty.trim() || undefined,
          valueCents,
          location: e.location.trim() || undefined,
          notes: e.notes.trim() || undefined,
        });
      } catch {
        /* ignore: engagements tracker is non-blocking */
      }
    }
  }

  function next() {
    setErr('');
    if (step === 0 && !name.trim()) {
      setErr('Company name is required.');
      return;
    }
    // Vendor agreement gate: cannot pass the Agreement step without accepting.
    if (kind === 'vendor' && steps[step] === 'Agreement' && !agreed) {
      setErr('Please accept the vendor agreement to continue.');
      return;
    }
    setStep((s) => Math.min(s + 1, lastStep));
  }
  function back() {
    setErr('');
    setStep((s) => Math.max(s - 1, 0));
  }

  async function submit() {
    setErr('');
    if (!name.trim()) {
      setErr('Company name is required.');
      setStep(0);
      return;
    }
    if (kind === 'vendor' && !agreed) {
      setErr('Please accept the vendor agreement to continue.');
      return;
    }
    setBusy(true);
    try {
      const payload: CompanyPayload = {
        kind,
        name: name.trim(),
        contact_name: contact || undefined,
        contact_title: title || undefined,
        email: email || session?.user.email || undefined,
        phone: phone || undefined,
        region: 'US',
      };

      if (kind === 'vendor') {
        payload.website = website || undefined;
        payload.description = description || undefined;
        payload.services = services;
        payload.service_categories = services;
        payload.capabilities = capabilities;
        payload.coverage_areas = coverageAreas;
      } else if (kind === 'investor') {
        payload.website = website || undefined;
        payload.description = description || undefined;
        payload.focus_areas = focusAreas;
        payload.geographies = geographies;
      } else {
        payload.website = website || undefined;
        payload.description = description || undefined;
        payload.street = street || undefined;
        payload.city = city || undefined;
        payload.state = state || undefined;
        payload.ownership_group = ownershipGroup || undefined;
        payload.development_team = developmentTeam || undefined;
        payload.asset_types = assetTypes;
        payload.headquarters = street || undefined;
      }

      const company = await createCompanyForUser(session!.user.id, payload);

      // Upload any staged media tied to the new company id (best-effort:
      // a media failure must not block onboarding completion).
      if (company?.id && staged.length) {
        for (const m of staged) {
          try {
            await uploadCompanyMedia(m.file, { companyId: company.id, category: m.category });
          } catch {
            /* keep going; media is non-blocking */
          }
        }
      }

      // Register verify-first credentials on the verification queue (best-effort).
      if (company?.id && kind === 'vendor' && credentials.length) {
        await postCredentials(company.id);
      }

      // Record any current jobs / bids / positions (best-effort).
      await postEngagements();

      await refreshCompany();
      nav('/app');
    } catch (e: any) {
      setErr(e?.message ?? 'Could not create your company.');
    } finally {
      setBusy(false);
    }
  }

  const progress = useMemo(
    () => (
      <div style={{ display: 'flex', gap: 8, marginBottom: 18, flexWrap: 'wrap' }}>
        {steps.map((label, i) => (
          <div
            key={label}
            style={{
              flex: '1 1 auto',
              minWidth: 60,
              textAlign: 'center',
              fontSize: 11,
              fontWeight: 600,
              color: i === step ? 'var(--emerald)' : i < step ? 'var(--emerald-deep)' : 'var(--muted)',
            }}
          >
            <div
              style={{
                height: 4,
                borderRadius: 4,
                marginBottom: 6,
                background: i <= step ? 'var(--emerald)' : 'var(--line)',
              }}
            />
            {i + 1}. {label}
          </div>
        ))}
      </div>
    ),
    [steps, step],
  );

  const stepName = steps[step];

  return (
    <div className="center">
      <div className="auth-card" style={{ maxWidth: 640 }}>
        <h1 style={{ fontSize: 26, marginBottom: 4 }}>Set up your company</h1>
        <div className="note" style={{ marginBottom: 18 }}>
          This creates your organization on Divini Procure.
        </div>

        {progress}
        {err && <div className="err">{err}</div>}

        {/* ============================================================ */}
        {/* STEP 1: Company / Firm                                       */}
        {/* ============================================================ */}
        {step === 0 && (
          <>
            <div className="field">
              <label>I am a...</label>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {(['buyer', 'vendor', 'investor'] as const).map((k) => (
                  <button
                    type="button"
                    key={k}
                    className={'chip' + (kind === k ? ' on' : '')}
                    onClick={() => setKindAndReset(k)}
                    style={{ flex: '1 1 30%', textAlign: 'center', padding: '10px' }}
                  >
                    {k === 'buyer' ? 'Developer / Buyer' : k === 'vendor' ? 'Vendor / Supplier' : 'Investor'}
                  </button>
                ))}
              </div>
            </div>

            <div className="field">
              <label>{kind === 'investor' ? 'Firm name' : 'Company name'}</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                placeholder={kind === 'investor' ? 'Divini Capital' : 'Divini Group'}
              />
            </div>

            {/* Website + pull-from-website for every role */}
            <div className="field">
              <label>Website</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                  placeholder="https://yourcompany.com"
                  style={{ flex: 1 }}
                />
                <button type="button" className="btn" onClick={pullFromWebsite} disabled={pulling}>
                  {pulling ? 'Pulling...' : 'Pull from website'}
                </button>
              </div>
              {pullMsg && (
                <div className="note" style={{ marginTop: 6 }}>
                  {pullMsg}
                </div>
              )}
            </div>

            {kind === 'buyer' && (
              <div className="field">
                <label>Asset types you develop</label>
                <div>
                  {ASSET_TYPES.map((a) => (
                    <span
                      key={a}
                      className={'chip' + (assetTypes.includes(a) ? ' on' : '')}
                      onClick={() => toggleIn(assetTypes, setAssetTypes, a)}
                    >
                      {a}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {kind === 'vendor' && (
              <div className="field">
                <label>Industry / service categories</label>
                <div>
                  {VENDOR_SERVICES.map((s) => (
                    <span
                      key={s}
                      className={'chip' + (services.includes(s) ? ' on' : '')}
                      onClick={() => toggleIn(services, setServices, s)}
                    >
                      {s}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {kind === 'investor' && (
              <div className="field">
                <label>Focus / asset classes</label>
                <div>
                  {INVESTOR_FOCUS.map((f) => (
                    <span
                      key={f}
                      className={'chip' + (focusAreas.includes(f) ? ' on' : '')}
                      onClick={() => toggleIn(focusAreas, setFocusAreas, f)}
                    >
                      {f}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {/* ============================================================ */}
        {/* DEVELOPER: Details                                           */}
        {/* ============================================================ */}
        {kind === 'buyer' && stepName === 'Details' && (
          <>
            <div className="field">
              <label>
                Company description{' '}
                {descFromAi && (
                  <span style={{ color: 'var(--emerald)', fontWeight: 600 }}>(AI draft, please review)</span>
                )}
              </label>
              <textarea
                value={description}
                onChange={(e) => {
                  setDescription(e.target.value);
                  setDescFromAi(false);
                }}
                rows={5}
                placeholder="What your firm builds, where, and what makes it distinct."
                style={{ width: '100%', resize: 'vertical' }}
              />
            </div>
            <div className="field">
              <label>Headquarters / street</label>
              <input value={street} onChange={(e) => setStreet(e.target.value)} placeholder="123 Main St" />
            </div>
            <div className="two">
              <div className="field">
                <label>City</label>
                <input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Miami" />
              </div>
              <div className="field">
                <label>State</label>
                <input value={state} onChange={(e) => setState(e.target.value)} placeholder="FL" />
              </div>
            </div>
            <div className="field">
              <label>Ownership group</label>
              <input
                value={ownershipGroup}
                onChange={(e) => setOwnershipGroup(e.target.value)}
                placeholder="Parent / holding entity"
              />
            </div>
            <div className="field">
              <label>Development team</label>
              <input
                value={developmentTeam}
                onChange={(e) => setDevelopmentTeam(e.target.value)}
                placeholder="Key partners, in-house team, JV partners"
              />
            </div>
          </>
        )}

        {/* ============================================================ */}
        {/* VENDOR: Coverage & capabilities                              */}
        {/* ============================================================ */}
        {kind === 'vendor' && stepName === 'Coverage' && (
          <>
            <div className="field">
              <label>
                Company description{' '}
                {descFromAi && (
                  <span style={{ color: 'var(--emerald)', fontWeight: 600 }}>(AI draft, please review)</span>
                )}
              </label>
              <textarea
                value={description}
                onChange={(e) => {
                  setDescription(e.target.value);
                  setDescFromAi(false);
                }}
                rows={4}
                placeholder="What you supply or build, and what sets your shop apart."
                style={{ width: '100%', resize: 'vertical' }}
              />
            </div>
            <div className="field">
              <label>Coverage areas / territories</label>
              <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                <input
                  value={coverageInput}
                  onChange={(e) => setCoverageInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addChipFromInput(coverageInput, coverageAreas, setCoverageAreas, () => setCoverageInput(''));
                    }
                  }}
                  placeholder="e.g. Florida, Southeast US, National"
                  style={{ flex: 1 }}
                />
                <button
                  type="button"
                  className="btn"
                  onClick={() => addChipFromInput(coverageInput, coverageAreas, setCoverageAreas, () => setCoverageInput(''))}
                >
                  Add
                </button>
              </div>
              <div>
                {coverageAreas.map((c) => (
                  <span key={c} className="chip on" onClick={() => toggleIn(coverageAreas, setCoverageAreas, c)}>
                    {c} &times;
                  </span>
                ))}
              </div>
            </div>
            <div className="field">
              <label>Capabilities</label>
              <div>
                {VENDOR_CAPABILITIES.map((c) => (
                  <span
                    key={c}
                    className={'chip' + (capabilities.includes(c) ? ' on' : '')}
                    onClick={() => toggleIn(capabilities, setCapabilities, c)}
                  >
                    {c}
                  </span>
                ))}
              </div>
            </div>
          </>
        )}

        {/* ============================================================ */}
        {/* INVESTOR: Geographies + description                          */}
        {/* ============================================================ */}
        {kind === 'investor' && stepName === 'Geographies' && (
          <>
            <div className="field">
              <label>Target geographies</label>
              <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                <input
                  value={geoInput}
                  onChange={(e) => setGeoInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addChipFromInput(geoInput, geographies, setGeographies, () => setGeoInput(''));
                    }
                  }}
                  placeholder="e.g. Sun Belt, Texas, Southeast US"
                  style={{ flex: 1 }}
                />
                <button
                  type="button"
                  className="btn"
                  onClick={() => addChipFromInput(geoInput, geographies, setGeographies, () => setGeoInput(''))}
                >
                  Add
                </button>
              </div>
              <div>
                {geographies.map((g) => (
                  <span key={g} className="chip on" onClick={() => toggleIn(geographies, setGeographies, g)}>
                    {g} &times;
                  </span>
                ))}
              </div>
            </div>
            <div className="field">
              <label>
                Firm description{' '}
                {descFromAi && (
                  <span style={{ color: 'var(--emerald)', fontWeight: 600 }}>(AI draft, please review)</span>
                )}
              </label>
              <textarea
                value={description}
                onChange={(e) => {
                  setDescription(e.target.value);
                  setDescFromAi(false);
                }}
                rows={5}
                placeholder="Your investment thesis, check size, and what you look for in a deal."
                style={{ width: '100%', resize: 'vertical' }}
              />
            </div>
          </>
        )}

        {/* ============================================================ */}
        {/* Contact (all roles)                                          */}
        {/* ============================================================ */}
        {stepName === 'Contact' && (
          <>
            <div className="two">
              <div className="field">
                <label>Contact name</label>
                <input value={contact} onChange={(e) => setContact(e.target.value)} placeholder="Jane Doe" />
              </div>
              <div className="field">
                <label>Title</label>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={kind === 'investor' ? 'Principal' : kind === 'vendor' ? 'Owner / Estimator' : 'Director of Development'}
                />
              </div>
            </div>
            <div className="two">
              <div className="field">
                <label>Email</label>
                <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="jane@company.com" />
              </div>
              <div className="field">
                <label>Phone</label>
                <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(305) 555-0100" />
              </div>
            </div>
          </>
        )}

        {/* ============================================================ */}
        {/* DEVELOPER: Brand & materials                                 */}
        {/* ============================================================ */}
        {kind === 'buyer' && stepName === 'Brand & materials' && (
          <>
            <div className="note" style={{ marginBottom: 12 }}>
              Add a logo, project images, and a pitch deck or brochure. Files upload after your company is
              created. Accepted: png, jpg, jpeg, webp, svg, pdf.
            </div>
            <div className="field">
              <label>Logo (image)</label>
              <input type="file" accept=".png,.jpg,.jpeg,.webp,.svg" onChange={(e) => addMedia(e.target.files, 'logo')} />
            </div>
            <div className="field">
              <label>Additional images</label>
              <input type="file" multiple accept=".png,.jpg,.jpeg,.webp" onChange={(e) => addMedia(e.target.files, 'image')} />
            </div>
            <div className="field">
              <label>Pitch deck / brochure (pdf)</label>
              <input type="file" accept=".pdf" onChange={(e) => addMedia(e.target.files, 'brochure')} />
            </div>
            <StagedList staged={staged} onRemove={removeMedia} />
          </>
        )}

        {/* ============================================================ */}
        {/* VENDOR: Verification documents & portfolio                   */}
        {/* ============================================================ */}
        {kind === 'vendor' && stepName === 'Documents' && (
          <>
            <div
              className="card"
              style={{ marginBottom: 14, borderLeft: '3px solid var(--amber)' }}
            >
              <div style={{ fontWeight: 700, marginBottom: 4 }}>Get verified to start bidding</div>
              <div className="note" style={{ lineHeight: 1.6 }}>
                You can join, build your profile, and browse projects right away. To bid on work or
                contact developers, your account must pass verification. Upload your credentials below
                with expiry dates. Our team reviews them, then your bidding unlocks. You can finish
                onboarding now and add or update documents later.
              </div>
            </div>

            <div className="sectitle" style={{ marginTop: 0 }}>Credentials for verification</div>
            <div className="note" style={{ marginBottom: 12 }}>
              Accepted: pdf, png, jpg, jpeg. Add the expiry date so we can warn you before it lapses.
            </div>

            <CredentialUpload
              title="Business / trade license"
              kind="license"
              credentials={credentials}
              onFile={setCredentialFile}
              onExpiry={setCredentialExpiry}
              onRemove={removeCredential}
            />
            <CredentialUpload
              title="General liability insurance (COI)"
              kind="insurance"
              credentials={credentials}
              onFile={setCredentialFile}
              onExpiry={setCredentialExpiry}
              onRemove={removeCredential}
            />

            <div className="field" style={{ marginTop: 6 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={hasEmployees}
                  onChange={(e) => setHasEmployees(e.target.checked)}
                />
                We have employees (workers compensation required)
              </label>
            </div>
            {hasEmployees && (
              <CredentialUpload
                title="Workers compensation insurance"
                kind="workers_comp"
                credentials={credentials}
                onFile={setCredentialFile}
                onExpiry={setCredentialExpiry}
                onRemove={removeCredential}
              />
            )}

            <div className="field" style={{ marginTop: 6 }}>
              <label>Trade certifications</label>
              <div className="note" style={{ marginBottom: 6 }}>
                Add each certification, its issuer/trade, and its expiry date.
              </div>
              <input
                type="file"
                accept=".pdf,.png,.jpg,.jpeg"
                onChange={(e) => { setCredentialFile('certification', e.target.files); e.target.value = ''; }}
              />
            </div>
            {credentials.map((c, i) =>
              c.kind === 'certification' ? (
                <div
                  key={i}
                  className="card"
                  style={{ marginBottom: 8, padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}
                >
                  <div style={{ fontSize: 13 }}>
                    <strong>{c.file.name}</strong>
                  </div>
                  <div className="two">
                    <div className="field" style={{ margin: 0 }}>
                      <label>Issuer / trade</label>
                      <input
                        value={c.label ?? ''}
                        onChange={(e) => setCredentialLabel(i, e.target.value)}
                        placeholder="e.g. OSHA 30, AWS, state HVAC"
                      />
                    </div>
                    <div className="field" style={{ margin: 0 }}>
                      <label>Expiry date</label>
                      <input
                        type="date"
                        value={c.expiry}
                        onChange={(e) => setCredentialExpiry('certification', i, e.target.value)}
                      />
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => removeCredential(i)}
                    style={{ alignSelf: 'flex-start', padding: '4px 10px' }}
                  >
                    Remove
                  </button>
                </div>
              ) : null,
            )}

            <hr style={{ border: 0, borderTop: '1px solid var(--line)', margin: '16px 0' }} />

            <div className="sectitle" style={{ marginTop: 0 }}>Other documents &amp; portfolio (optional)</div>
            <div className="two">
              <div className="field">
                <label>W9</label>
                <input type="file" accept=".pdf,.png,.jpg,.jpeg" onChange={(e) => addMedia(e.target.files, 'w9')} />
              </div>
              <div className="field">
                <label>Safety document</label>
                <input type="file" accept=".pdf,.png,.jpg,.jpeg" onChange={(e) => addMedia(e.target.files, 'doc')} />
              </div>
            </div>
            <div className="field">
              <label>Portfolio images</label>
              <input type="file" multiple accept=".png,.jpg,.jpeg,.webp" onChange={(e) => addMedia(e.target.files, 'image')} />
            </div>
            <div className="field">
              <label>Pitch / brochure (pdf)</label>
              <input type="file" accept=".pdf" onChange={(e) => addMedia(e.target.files, 'deck')} />
            </div>
            <StagedList staged={staged} onRemove={removeMedia} />
          </>
        )}

        {/* ============================================================ */}
        {/* INVESTOR: Materials                                          */}
        {/* ============================================================ */}
        {kind === 'investor' && stepName === 'Materials' && (
          <>
            <div className="note" style={{ marginBottom: 12 }}>
              Optional: add a firm deck or one-pager. Files upload after your firm is created. Accepted: pdf,
              png, jpg, jpeg, webp.
            </div>
            <div className="field">
              <label>Firm deck / one-pager (pdf)</label>
              <input type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" onChange={(e) => addMedia(e.target.files, 'deck')} />
            </div>
            <StagedList staged={staged} onRemove={removeMedia} />

            <hr style={{ border: 0, borderTop: '1px solid var(--line)', margin: '16px 0' }} />
            <EngagementSection
              kind={kind}
              engagements={engagements}
              onAdd={addEngagement}
              onUpdate={updateEngagement}
              onRemove={removeEngagement}
            />
          </>
        )}

        {/* ============================================================ */}
        {/* VENDOR: Agreement + current jobs                             */}
        {/* ============================================================ */}
        {kind === 'vendor' && stepName === 'Agreement' && (
          <>
            <div className="card" style={{ marginBottom: 14 }}>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>Vendor Agreement</div>
              <div className="note" style={{ marginBottom: 8 }}>
                By joining Divini Procure as a vendor you agree to: provide accurate company and credential
                information; honor quotes and timelines submitted on the platform; maintain the insurance and
                licenses you upload; and communicate in good faith with developers and buyers. Divini Procure may
                verify your credentials and suspend accounts that misrepresent qualifications. Joining and browsing
                are free. Bidding and contacting developers unlock once your credentials pass verification. Free
                vendors get 5 bids per quarter; Vendor Pro is unlimited. A 2 percent success fee, capped at $2,500,
                applies only when you win work through the platform.
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, cursor: 'pointer' }}>
                <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
                I have read and accept the Vendor Agreement.
              </label>
            </div>

            <EngagementSection
              kind={kind}
              engagements={engagements}
              onAdd={addEngagement}
              onUpdate={updateEngagement}
              onRemove={removeEngagement}
            />
          </>
        )}

        {/* ============================================================ */}
        {/* Review (all roles)                                           */}
        {/* ============================================================ */}
        {step === lastStep && (
          <div className="card" style={{ marginBottom: 14 }}>
            <div className="note" style={{ marginBottom: 10 }}>Review before creating your company.</div>
            <ReviewRow k="Type" v={kind === 'buyer' ? 'Developer / Buyer' : kind === 'vendor' ? 'Vendor / Supplier' : 'Investor'} />
            <ReviewRow k="Name" v={name || '(required)'} />
            {website && <ReviewRow k="Website" v={website} />}

            {kind === 'buyer' && (
              <>
                {assetTypes.length > 0 && <ReviewRow k="Asset types" v={assetTypes.join(', ')} />}
                {description && <ReviewRow k="Description" v={description} />}
                {(street || city || state) && (
                  <ReviewRow k="Location" v={[street, city, state].filter(Boolean).join(', ')} />
                )}
                {ownershipGroup && <ReviewRow k="Ownership group" v={ownershipGroup} />}
                {developmentTeam && <ReviewRow k="Development team" v={developmentTeam} />}
              </>
            )}

            {kind === 'vendor' && (
              <>
                {services.length > 0 && <ReviewRow k="Service categories" v={services.join(', ')} />}
                {capabilities.length > 0 && <ReviewRow k="Capabilities" v={capabilities.join(', ')} />}
                {coverageAreas.length > 0 && <ReviewRow k="Coverage" v={coverageAreas.join(', ')} />}
                {description && <ReviewRow k="Description" v={description} />}
                <ReviewRow
                  k="Credentials"
                  v={
                    credentials.length
                      ? `${credentials.length} staged for verification`
                      : 'None yet (add before bidding)'
                  }
                />
                <ReviewRow k="Bidding" v="Unlocks after verification (free: 5 bids/quarter)" />
                <ReviewRow k="Agreement" v={agreed ? 'Accepted' : 'Not accepted'} />
              </>
            )}

            {kind === 'investor' && (
              <>
                {focusAreas.length > 0 && <ReviewRow k="Focus" v={focusAreas.join(', ')} />}
                {geographies.length > 0 && <ReviewRow k="Geographies" v={geographies.join(', ')} />}
                {description && <ReviewRow k="Description" v={description} />}
              </>
            )}

            {(contact || title) && <ReviewRow k="Contact" v={[contact, title].filter(Boolean).join(', ')} />}
            {(email || phone) && <ReviewRow k="Reach" v={[email, phone].filter(Boolean).join(' / ')} />}
            {staged.length > 0 && (
              <ReviewRow k="Files" v={`${staged.length} staged (${staged.map((s) => s.category).join(', ')})`} />
            )}
            {engagements.filter((e) => e.title.trim()).length > 0 && (
              <ReviewRow
                k="Going on now"
                v={engagements.filter((e) => e.title.trim()).map((e) => e.title.trim()).join(', ')}
              />
            )}
          </div>
        )}

        {/* ---------------- Nav ---------------- */}
        <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
          {step > 0 && (
            <button type="button" className="btn lg" onClick={back} disabled={busy} style={{ flex: 1 }}>
              Back
            </button>
          )}
          {step < lastStep ? (
            <button type="button" className="btn primary lg" onClick={next} style={{ flex: 2 }}>
              Next
            </button>
          ) : (
            <button
              type="button"
              className="btn primary lg"
              onClick={submit}
              disabled={busy || !name.trim() || (kind === 'vendor' && !agreed)}
              style={{ flex: 2 }}
            >
              {busy ? 'Creating...' : 'Create company'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function CredentialUpload({
  title,
  kind,
  credentials,
  onFile,
  onExpiry,
  onRemove,
}: {
  title: string;
  kind: CredentialKind;
  credentials: StagedCredential[];
  onFile: (kind: CredentialKind, files: FileList | null) => void;
  onExpiry: (kind: CredentialKind, idx: number, expiry: string) => void;
  onRemove: (idx: number) => void;
}) {
  const idx = credentials.findIndex((c) => c.kind === kind);
  const cred = idx >= 0 ? credentials[idx] : null;
  return (
    <div className="field">
      <label>{title}</label>
      {cred ? (
        <div
          className="card"
          style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}
        >
          <div style={{ fontSize: 13, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <strong>{cred.file.name}</strong>
            <button
              type="button"
              className="btn"
              onClick={() => onRemove(idx)}
              style={{ padding: '4px 10px' }}
            >
              Remove
            </button>
          </div>
          <div className="field" style={{ margin: 0, maxWidth: 220 }}>
            <label>Expiry date</label>
            <input
              type="date"
              value={cred.expiry}
              onChange={(e) => onExpiry(kind, idx, e.target.value)}
            />
          </div>
        </div>
      ) : (
        <input
          type="file"
          accept=".pdf,.png,.jpg,.jpeg"
          onChange={(e) => { onFile(kind, e.target.files); e.target.value = ''; }}
        />
      )}
    </div>
  );
}

function StagedList({ staged, onRemove }: { staged: StagedMedia[]; onRemove: (i: number) => void }) {
  if (staged.length === 0) return null;
  return (
    <div className="field">
      <label>Staged files</label>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {staged.map((m, i) => (
          <div
            key={i}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              border: '1px solid var(--line)',
              borderRadius: 8,
              padding: '6px 10px',
              fontSize: 13,
            }}
          >
            <span>
              <strong style={{ textTransform: 'capitalize' }}>{m.category}</strong> &middot; {m.file.name}
            </span>
            <button type="button" className="btn" onClick={() => onRemove(i)} style={{ padding: '4px 10px' }}>
              Remove
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function EngagementSection({
  kind,
  engagements,
  onAdd,
  onUpdate,
  onRemove,
}: {
  kind: Kind;
  engagements: EngageDraft[];
  onAdd: () => void;
  onUpdate: (i: number, patch: Partial<EngageDraft>) => void;
  onRemove: (i: number) => void;
}) {
  const heading =
    kind === 'vendor'
      ? 'What do you have going on now? (current jobs / bids)'
      : kind === 'investor'
        ? 'What do you have going on now? (current positions / deals)'
        : 'What do you have going on now?';
  const placeholder =
    kind === 'vendor' ? 'Lobby millwork at 200 Brickell' : 'Acquisition: 180-unit Sun Belt multifamily';
  return (
    <div>
      <div style={{ fontWeight: 700, marginBottom: 4 }}>{heading}</div>
      <div className="note" style={{ marginBottom: 10 }}>
        Optional. These seed your activity tracker. You can add more later.
      </div>
      {engagements.map((e, i) => (
        <div
          key={i}
          className="card"
          style={{ marginBottom: 10, padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}
        >
          <div className="two">
            <div className="field" style={{ margin: 0 }}>
              <label>Title</label>
              <input value={e.title} onChange={(ev) => onUpdate(i, { title: ev.target.value })} placeholder={placeholder} />
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label>Type</label>
              <select
                value={e.type}
                onChange={(ev) => onUpdate(i, { type: ev.target.value as EngageType })}
                style={{ width: '100%' }}
              >
                {kind === 'investor' ? (
                  <>
                    <option value="position">Position</option>
                    <option value="deal">Deal</option>
                  </>
                ) : (
                  <>
                    <option value="job">Job</option>
                    <option value="bid">Bid</option>
                  </>
                )}
              </select>
            </div>
          </div>
          <div className="two">
            <div className="field" style={{ margin: 0 }}>
              <label>Counterparty</label>
              <input
                value={e.counterparty}
                onChange={(ev) => onUpdate(i, { counterparty: ev.target.value })}
                placeholder="Developer / sponsor"
              />
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label>Value (USD)</label>
              <input value={e.value} onChange={(ev) => onUpdate(i, { value: ev.target.value })} placeholder="250000" />
            </div>
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>Location</label>
            <input value={e.location} onChange={(ev) => onUpdate(i, { location: ev.target.value })} placeholder="Miami, FL" />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>Notes</label>
            <input value={e.notes} onChange={(ev) => onUpdate(i, { notes: ev.target.value })} placeholder="Anything useful" />
          </div>
          <button type="button" className="btn" onClick={() => onRemove(i)} style={{ alignSelf: 'flex-start', padding: '4px 10px' }}>
            Remove
          </button>
        </div>
      ))}
      <button type="button" className="btn" onClick={onAdd}>
        + Add {kind === 'investor' ? 'a position' : 'a job'}
      </button>
    </div>
  );
}

function ReviewRow({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ display: 'flex', gap: 10, padding: '4px 0', fontSize: 13.5 }}>
      <div style={{ width: 130, color: 'var(--muted)', fontWeight: 600, flexShrink: 0 }}>{k}</div>
      <div style={{ flex: 1 }}>{v}</div>
    </div>
  );
}
