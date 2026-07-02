import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { apiGet } from '../lib/api';

type InvitePrefill = {
  description?: string;
  city?: string;
  state?: string;
  assetTypes?: string[];
  contact?: string;
  focusAreas?: string[];
};

type InviteLookup = {
  found: boolean;
  email?: string | null;
  companyKind?: string | null;
  status?: string | null;
  companyName?: string | null;
  companyWebsite?: string | null;
  prefill?: InvitePrefill | null;
};

// Map an invite's companyKind to the onboarding role the onboarding flow reads
// from localStorage ('procure_onboard_role') / ?role=. Free-text tolerant.
function onboardRoleFor(kind?: string | null): string | null {
  switch (kind) {
    case 'vendor': return 'vendor';
    case 'developer': return 'developer';
    case 'investor': return 'investor';
    // legacy 'buyer' invites map to the developer onboarding path.
    case 'buyer': return 'developer';
    default: return null;
  }
}
function persistOnboardRole(kind?: string | null) {
  const role = onboardRoleFor(kind);
  try {
    if (role) localStorage.setItem('procure_onboard_role', role);
    else localStorage.removeItem('procure_onboard_role');
  } catch { /* ignore */ }
}

// Stash the pre-fill payload (plus company name + website) so onboarding can
// populate the matching role's fields once the user signs in.
function persistPrefill(invite: InviteLookup) {
  try {
    const prefill = invite.prefill ?? {};
    const hasContent =
      invite.companyName ||
      invite.companyWebsite ||
      prefill.description ||
      prefill.city ||
      prefill.state ||
      prefill.contact ||
      (prefill.assetTypes && prefill.assetTypes.length) ||
      (prefill.focusAreas && prefill.focusAreas.length);
    if (!hasContent) {
      localStorage.removeItem('procure_onboard_prefill');
      return;
    }
    localStorage.setItem(
      'procure_onboard_prefill',
      JSON.stringify({
        ...prefill,
        companyName: invite.companyName ?? undefined,
        website: invite.companyWebsite ?? undefined,
      }),
    );
  } catch { /* ignore */ }
}

const kindLabelFor = (kind?: string | null): string | null =>
  kind === 'vendor' ? 'Vendor / Supplier'
    : kind === 'developer' ? 'Real Estate Developer'
    : kind === 'investor' ? 'Investor'
    : kind === 'buyer' ? 'Developer / Buyer' : null;

/**
 * /join/:code - public invite capture page. Looks up the invite, persists the
 * code so the post-signup hook (see lib/attribution + AuthProvider) can claim
 * it once the user is authed, and offers a sign-in CTA. When the invite carries
 * a pre-filled company profile it renders a rich CLAIM PAGE instead. Handles
 * invalid/expired/claimed codes gracefully.
 */
// Stash the invited email so the Register page can prefill it after the user
// clicks through to create their account.
function persistInviteEmail(email?: string | null) {
  try {
    if (email) localStorage.setItem('procure_invite_email', email);
    else localStorage.removeItem('procure_invite_email');
  } catch { /* ignore */ }
}

export default function JoinInvite() {
  const { code } = useParams<{ code: string }>();
  const nav = useNavigate();
  const [state, setState] = useState<'loading' | 'ok' | 'invalid'>('loading');
  const [invite, setInvite] = useState<InviteLookup | null>(null);

  useEffect(() => {
    if (!code) { setState('invalid'); return; }
    // Persist immediately so even a direct "sign in" click attributes correctly.
    try { localStorage.setItem('procure_invite_code', code); } catch { /* ignore */ }
    let alive = true;
    apiGet<InviteLookup>(`/public/invite/${encodeURIComponent(code)}`)
      .then((r) => {
        if (!alive) return;
        if (!r.found) { setState('invalid'); try { localStorage.removeItem('procure_invite_code'); } catch { /* */ } return; }
        setInvite(r);
        // Persist the role so onboarding preselects it after sign-in.
        persistOnboardRole(r.companyKind);
        // Persist the pre-fill (if any) so onboarding starts populated.
        persistPrefill(r);
        // Persist the invited email so Register prefills it.
        persistInviteEmail(r.email);
        setState('ok');
      })
      .catch(() => { if (alive) setState('invalid'); });
    return () => { alive = false; };
  }, [code]);

  const revoked = invite?.status === 'revoked';
  const kindLabel = kindLabelFor(invite?.companyKind);

  const prefill = invite?.prefill ?? {};
  const focusChips = Array.from(
    new Set([...(prefill.assetTypes ?? []), ...(prefill.focusAreas ?? [])]),
  );
  const location = [prefill.city, prefill.state].filter(Boolean).join(', ');
  // A "claim page" is shown when the admin attached a company name (the
  // pre-filled prospect profile). Otherwise we keep the simpler invite view.
  const isClaim = state === 'ok' && !!invite?.companyName;

  function proceed() {
    // Re-persist on click to be safe, then hand off to account creation.
    persistOnboardRole(invite?.companyKind);
    if (invite) { persistPrefill(invite); persistInviteEmail(invite.email); }
    nav('/register');
  }

  // ---- Rich claim page (pre-filled prospect profile) ----
  if (isClaim && invite) {
    return (
      <div className="center">
        <div className="auth-card" style={{ maxWidth: 560 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
            <img src="/brand/mark-emerald.png" alt="Divini Procure" style={{ width: 40, height: 40, objectFit: 'contain' }} />
            <div className="note">Divini Procure &middot; Procurement marketplace</div>
          </div>

          <div className="note" style={{ marginBottom: 6 }}>A profile has been prepared for</div>
          <h1 style={{ fontSize: 28, marginBottom: 6, color: 'var(--emerald-deep)' }}>{invite.companyName}</h1>

          {kindLabel && (
            <div style={{ marginBottom: 12 }}>
              <span className="chip on">{kindLabel}</span>
            </div>
          )}

          {invite.companyWebsite && (
            <div className="note" style={{ marginBottom: 10 }}>
              <a href={invite.companyWebsite} target="_blank" rel="noreferrer" style={{ color: 'var(--emerald)', fontWeight: 600 }}>
                {invite.companyWebsite.replace(/^https?:\/\//, '')}
              </a>
            </div>
          )}

          {location && (
            <div className="note" style={{ marginBottom: 10 }}>Location: <strong>{location}</strong></div>
          )}

          {prefill.description && (
            <p style={{ lineHeight: 1.7, marginBottom: 14, color: 'var(--ink, inherit)' }}>{prefill.description}</p>
          )}

          {focusChips.length > 0 && (
            <div className="field" style={{ marginBottom: 14 }}>
              <label className="note">Focus</label>
              <div>
                {focusChips.map((c) => (
                  <span key={c} className="chip on">{c}</span>
                ))}
              </div>
            </div>
          )}

          {revoked && (
            <div className="note" style={{ marginBottom: 12 }}>
              This invitation is no longer active, but you can still claim and set up the profile below.
            </div>
          )}

          <button className="btn primary block lg" onClick={proceed}>
            Claim this profile and start onboarding
          </button>
          <p className="note" style={{ marginTop: 14, fontSize: 12.5 }}>
            You'll sign in securely, then we'll bring you straight into onboarding with these details pre-filled. Review and edit before finishing.
          </p>
        </div>
      </div>
    );
  }

  // ---- Simpler invite view (no pre-fill) ----
  return (
    <div className="center">
      <div className="auth-card" style={{ maxWidth: 480 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
          <img src="/brand/mark-emerald.png" alt="Divini Procure" style={{ width: 46, height: 46, objectFit: 'contain' }} />
          <div>
            <h1 style={{ fontSize: 24 }}>Divini Procure</h1>
            <div className="note">Procurement marketplace</div>
          </div>
        </div>

        {state === 'loading' && <div className="note">Checking your invitation…</div>}

        {state === 'invalid' && (
          <>
            <h2 style={{ fontSize: 20, marginBottom: 8 }}>Invitation not found</h2>
            <p className="note" style={{ lineHeight: 1.7, marginBottom: 18 }}>
              This invite link is invalid or has expired. You can still create an
              account and set up your company.
            </p>
            <button className="btn primary block lg" onClick={() => nav('/register')}>
              Sign in / create account
            </button>
          </>
        )}

        {state === 'ok' && (
          <>
            <h2 style={{ fontSize: 22, marginBottom: 8 }}>You've been invited to Divini Procure</h2>
            <p className="note" style={{ lineHeight: 1.7, marginBottom: 14 }}>
              {revoked
                ? 'This invitation is no longer active, but you can still create an account below.'
                : 'Accept your invitation to join the procurement marketplace.'}
            </p>
            {invite?.email && (
              <div className="note" style={{ marginBottom: 8 }}>Invited address: <strong>{invite.email}</strong></div>
            )}
            {kindLabel && (
              <div className="note" style={{ marginBottom: 18 }}>Account type: <strong>{kindLabel}</strong></div>
            )}
            <button className="btn primary block lg" onClick={proceed}>
              Sign in / create account
            </button>
            <p className="note" style={{ marginTop: 14, fontSize: 12.5 }}>
              You'll be redirected to sign in securely, then brought back to finish setup.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
