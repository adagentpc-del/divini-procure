import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { apiGet } from '../lib/api';

type ReferralLookup = { found: boolean; partnerName?: string };

/**
 * /r/:code - public referral landing page. Looks up the referral partner,
 * persists the code so the post-signup hook attributes the new user to the
 * partner once authed, and offers a sign-up CTA.
 */
export default function ReferralLanding() {
  const { code } = useParams<{ code: string }>();
  const nav = useNavigate();
  const [state, setState] = useState<'loading' | 'ok' | 'invalid'>('loading');
  const [partnerName, setPartnerName] = useState<string | null>(null);

  useEffect(() => {
    if (!code) { setState('invalid'); return; }
    try { localStorage.setItem('procure_ref_code', code); } catch { /* ignore */ }
    let alive = true;
    apiGet<ReferralLookup>(`/public/referral/${encodeURIComponent(code)}`)
      .then((r) => {
        if (!alive) return;
        if (!r.found) { setState('invalid'); try { localStorage.removeItem('procure_ref_code'); } catch { /* */ } return; }
        setPartnerName(r.partnerName ?? null);
        setState('ok');
      })
      .catch(() => { if (alive) setState('invalid'); });
    return () => { alive = false; };
  }, [code]);

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

        {state === 'loading' && <div className="note">Loading…</div>}

        {state === 'invalid' && (
          <>
            <h2 style={{ fontSize: 20, marginBottom: 8 }}>Join Divini Procure</h2>
            <p className="note" style={{ lineHeight: 1.7, marginBottom: 18 }}>
              This referral link is no longer active, but you can still create an
              account and set up your company.
            </p>
            <button className="btn primary block lg" onClick={() => nav('/register')}>
              Sign up
            </button>
          </>
        )}

        {state === 'ok' && (
          <>
            <h2 style={{ fontSize: 22, marginBottom: 8 }}>
              Referred by {partnerName} - join Divini Procure
            </h2>
            <p className="note" style={{ lineHeight: 1.7, marginBottom: 18 }}>
              {partnerName} invited you to the procurement marketplace. Create your
              account to get started.
            </p>
            <button className="btn primary block lg" onClick={() => nav('/register')}>
              Sign up
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
