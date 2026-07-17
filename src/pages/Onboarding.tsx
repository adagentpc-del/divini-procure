/**
 * Fast-path onboarding — under 60 seconds per role.
 *
 * All roles follow the same 2-step structure:
 *   Step 1  Role + company name + category chips
 *   Step 2  Contact info (pre-filled from account email) + vendor agreement
 *
 * Documents, media, and engagements are intentionally deferred to the
 * dashboard "Complete your profile" banner so users hit the app fast.
 * All payload and API calls are identical to the original flow.
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import {
  createCompanyForUser,
  extractProfileFromUrl,
  type CompanyPayload,
} from '../lib/db';

const VENDOR_SERVICES = [
  'Millwork', 'Cabinetry', 'Doors', 'Furniture', 'Lighting',
  'Concrete', 'Steel', 'Electrical', 'Drapery', 'Security',
  'Signage', 'Windows', 'Flooring', 'Metalwork',
];
const ASSET_TYPES = [
  'Multifamily', 'Hospitality', 'Office', 'Retail',
  'Mixed-Use', 'Senior Living', 'Student Housing', 'Industrial',
];
const INVESTOR_FOCUS = [
  'Multifamily', 'Hospitality', 'Office', 'Retail',
  'Mixed-Use', 'Industrial', 'Senior Living',
];

type Kind = 'buyer' | 'vendor' | 'investor';

// ---------------------------------------------------------------------------
// Role hint utilities
// ---------------------------------------------------------------------------
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

function toggleIn(list: string[], setList: (v: string[]) => void, v: string) {
  setList(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export default function Onboarding() {
  const { session, refreshCompany } = useAuth();
  const nav = useNavigate();

  const [kind, setKind] = useState<Kind>('buyer');
  const [step, setStep] = useState(0);

  // Step 1 fields
  const [name, setName] = useState('');
  const [website, setWebsite] = useState('');
  const [assetTypes, setAssetTypes] = useState<string[]>([]);
  const [services, setServices] = useState<string[]>([]);
  const [focusAreas, setFocusAreas] = useState<string[]>([]);
  const [pulling, setPulling] = useState(false);
  const [pullMsg, setPullMsg] = useState('');

  // Step 2 fields
  const [contact, setContact] = useState('');
  const [contactTitle, setContactTitle] = useState('');
  const [email, setEmail] = useState(session?.user.email ?? '');
  const [phone, setPhone] = useState('');
  const [agreed, setAgreed] = useState(false);

  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  // Pre-select role from URL / localStorage
  useEffect(() => {
    const hint = readRoleHint();
    if (hint) {
      setKind(hint);
      setStep(0);
    }
  }, []);

  // Apply one-time prefill stashed by the invite claim page
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
    const ct = str(prefill.contact);
    if (ct) setContact(ct);

    const ats = arr(prefill.assetTypes);
    if (ats.length) setAssetTypes((prev) => Array.from(new Set([...prev, ...ats])));
    const fas = arr(prefill.focusAreas);
    if (fas.length) setFocusAreas((prev) => Array.from(new Set([...prev, ...fas])));
  }, []);

  function setKindAndReset(k: Kind) {
    setKind(k);
    setStep(0);
    setErr('');
    setAgreed(false);
  }

  async function pullFromWebsite() {
    setErr('');
    setPullMsg('');
    if (!website.trim()) { setErr('Enter a website URL first.'); return; }
    setPulling(true);
    try {
      const out = await extractProfileFromUrl(website.trim());
      if (!out.available) {
        setPullMsg('Auto-fill is not available right now.');
      } else {
        if (out.name && !name.trim()) setName(out.name);
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
        setPullMsg('Pulled from your website. Review and continue.');
      }
    } catch {
      setPullMsg('Could not read that website. Continue manually.');
    } finally {
      setPulling(false);
    }
  }

  function next() {
    setErr('');
    if (!name.trim()) { setErr('Company name is required.'); return; }
    setStep(1);
  }

  async function submit() {
    setErr('');
    if (!name.trim()) { setErr('Company name is required.'); setStep(0); return; }
    if (kind === 'vendor' && !agreed) {
      setErr('Please accept the Vendor Agreement to continue.');
      return;
    }
    setBusy(true);
    try {
      const payload: CompanyPayload = {
        kind,
        name: name.trim(),
        website: website.trim() || undefined,
        contact_name: contact.trim() || undefined,
        contact_title: contactTitle.trim() || undefined,
        email: email.trim() || session?.user.email || undefined,
        phone: phone.trim() || undefined,
        region: 'US',
      };

      if (kind === 'vendor') {
        payload.services = services;
        payload.service_categories = services;
      } else if (kind === 'investor') {
        payload.focus_areas = focusAreas;
      } else {
        payload.asset_types = assetTypes;
      }

      await createCompanyForUser(session!.user.id, payload);
      await refreshCompany();
      nav('/app');
    } catch (e: any) {
      setErr(e?.message ?? 'Could not create your company. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  // Progress bar
  const progress = useMemo(
    () => (
      <div style={{ display: 'flex', gap: 6, marginBottom: 22 }}>
        {[0, 1].map((i) => (
          <div
            key={i}
            style={{
              flex: 1,
              height: 4,
              borderRadius: 4,
              background: i <= step ? 'var(--emerald)' : 'var(--line)',
              transition: 'background 0.2s',
            }}
          />
        ))}
      </div>
    ),
    [step],
  );

  return (
    <div className="center">
      <div className="auth-card" style={{ maxWidth: 580 }}>
        {/* Header */}
        <div style={{ marginBottom: 6 }}>
          <div style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 4 }}>
            Step {step + 1} of 2
          </div>
          <h1 style={{ fontSize: 24, marginBottom: 2 }}>
            {step === 0
              ? 'Set up your organization'
              : kind === 'investor'
                ? 'Your contact details'
                : 'Your contact details'}
          </h1>
          <div className="note">
            {step === 0
              ? "Takes under a minute. You can add documents and media from your dashboard."
              : "We'll use this to personalize your account."}
          </div>
        </div>

        {progress}
        {err && <div className="err">{err}</div>}

        {/* ================================================================
            STEP 1: Role + Company + Chips
            ================================================================ */}
        {step === 0 && (
          <>
            {/* Role selector */}
            <div className="field">
              <label>I am a...</label>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {([
                  { k: 'buyer', label: 'Developer / Buyer' },
                  { k: 'vendor', label: 'Vendor / Supplier' },
                  { k: 'investor', label: 'Investor' },
                ] as { k: Kind; label: string }[]).map(({ k, label }) => (
                  <button
                    type="button"
                    key={k}
                    className={'chip' + (kind === k ? ' on' : '')}
                    onClick={() => setKindAndReset(k)}
                    style={{ flex: '1 1 28%', textAlign: 'center', padding: '10px 8px' }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Company / Firm name */}
            <div className="field">
              <label>{kind === 'investor' ? 'Firm name' : 'Company name'} *</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={kind === 'investor' ? 'Divini Capital' : 'Divini Group'}
                required
                autoFocus
              />
            </div>

            {/* Website + pull */}
            <div className="field">
              <label>Website <span style={{ color: 'var(--muted)', fontWeight: 400 }}>(optional)</span></label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                  placeholder="https://yourcompany.com"
                  style={{ flex: 1 }}
                />
                <button type="button" className="btn" onClick={pullFromWebsite} disabled={pulling}>
                  {pulling ? 'Pulling...' : 'Auto-fill'}
                </button>
              </div>
              {pullMsg && <div className="note" style={{ marginTop: 6 }}>{pullMsg}</div>}
            </div>

            {/* Category chips */}
            {kind === 'buyer' && (
              <div className="field">
                <label>Asset types <span style={{ color: 'var(--muted)', fontWeight: 400 }}>(optional)</span></label>
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
                <label>Service categories <span style={{ color: 'var(--muted)', fontWeight: 400 }}>(optional)</span></label>
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
                <label>Focus areas <span style={{ color: 'var(--muted)', fontWeight: 400 }}>(optional)</span></label>
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

            <button
              type="button"
              className="btn primary lg"
              onClick={next}
              style={{ width: '100%', marginTop: 8 }}
            >
              Continue
            </button>
          </>
        )}

        {/* ================================================================
            STEP 2: Contact + (Vendor Agreement)
            ================================================================ */}
        {step === 1 && (
          <>
            <div className="two">
              <div className="field">
                <label>Your name</label>
                <input
                  value={contact}
                  onChange={(e) => setContact(e.target.value)}
                  placeholder="Jane Doe"
                  autoFocus
                />
              </div>
              <div className="field">
                <label>Title</label>
                <input
                  value={contactTitle}
                  onChange={(e) => setContactTitle(e.target.value)}
                  placeholder={
                    kind === 'investor'
                      ? 'Principal'
                      : kind === 'vendor'
                        ? 'Owner / Estimator'
                        : 'Director of Development'
                  }
                />
              </div>
            </div>
            <div className="two">
              <div className="field">
                <label>Email</label>
                <input
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="jane@company.com"
                  type="email"
                />
              </div>
              <div className="field">
                <label>Phone <span style={{ color: 'var(--muted)', fontWeight: 400 }}>(optional)</span></label>
                <input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="(305) 555-0100"
                />
              </div>
            </div>

            {/* Vendor agreement — inlined on step 2 for velocity */}
            {kind === 'vendor' && (
              <div className="card" style={{ marginTop: 8, marginBottom: 4 }}>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>Vendor Agreement</div>
                <div className="note" style={{ marginBottom: 10, lineHeight: 1.6 }}>
                  By joining Divini Procure as a vendor you agree to: provide accurate company and
                  credential information; honor quotes and timelines submitted on the platform; maintain
                  the insurance and licenses you upload; and communicate in good faith with developers
                  and buyers. Divini Procure may verify your credentials and suspend accounts that
                  misrepresent qualifications. Joining and browsing are free. Bidding and contacting
                  developers unlock once your credentials pass verification. Free vendors get 5 bids per
                  quarter; Vendor Pro is unlimited. A 2% success fee, capped at $2,500, applies only when
                  you win work through the platform.
                </div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 14 }}>
                  <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
                  I have read and accept the Vendor Agreement.
                </label>
              </div>
            )}

            {/* Docs/media deferred callout */}
            <div
              style={{
                background: 'rgba(16,185,129,0.08)',
                border: '1px solid var(--emerald)',
                borderRadius: 8,
                padding: '10px 14px',
                marginTop: 12,
                fontSize: 13,
                color: 'var(--emerald-deep)',
              }}
            >
              {kind === 'vendor'
                ? 'After joining, upload your license and COI from your dashboard to unlock bidding.'
                : kind === 'investor'
                  ? 'After joining, add your firm deck and geographies from your dashboard.'
                  : 'After joining, add your logo, project images, and pitch deck from your dashboard.'}
            </div>

            {/* Nav */}
            <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
              <button
                type="button"
                className="btn lg"
                onClick={() => { setErr(''); setStep(0); }}
                disabled={busy}
                style={{ flex: 1 }}
              >
                Back
              </button>
              <button
                type="button"
                className="btn primary lg"
                onClick={submit}
                disabled={busy || !name.trim() || (kind === 'vendor' && !agreed)}
                style={{ flex: 2 }}
              >
                {busy ? 'Creating...' : `Create ${kind === 'investor' ? 'firm' : 'company'}`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
