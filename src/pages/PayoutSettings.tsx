/**
 * Payout Settings - the signed-in company's Stripe Connect onboarding state.
 *
 * "Connect bank account (Stripe)" opens a Stripe-hosted onboarding link; we show
 * the resulting payouts-enabled flag and the masked bank last4 that Stripe
 * returns. Banking is handled entirely by Stripe; Divini Procure NEVER stores
 * account or routing numbers. No money moves on this page.
 */
import { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth';
import { apiGet, apiSend } from '../lib/api';

type ConnectAccount = {
  id: string;
  stripe_account_id: string | null;
  status: string;
  charges_enabled: boolean;
  payouts_enabled: boolean;
  details_submitted: boolean;
  bank_last4: string | null;
  country: string | null;
  default_currency: string | null;
};

const STATUS_BADGE: Record<string, string> = {
  not_started: 'b-neutral',
  onboarding: 'b-amber',
  restricted: 'b-amber',
  enabled: 'b-green',
  disabled: 'b-red',
};

export default function PayoutSettings() {
  const { company } = useAuth();
  const [account, setAccount] = useState<ConnectAccount | null>(null);
  const [configured, setConfigured] = useState(true);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    if (!company) return;
    try {
      const d = await apiGet<{ configured: boolean; account: ConnectAccount | null }>(
        `/payouts/connect/status?companyId=${company.id}`,
      );
      setAccount(d.account);
      setConfigured(d.configured);
    } catch (e: any) {
      setErr(e.message ?? 'Could not load payout status.');
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [company]);

  if (!company) return <div className="card">Sign in with a company to manage payouts.</div>;

  async function connect() {
    setBusy(true);
    setErr('');
    setMsg('');
    try {
      const d = await apiSend<{ configured: boolean; url?: string; message?: string }>(
        'POST',
        '/payouts/connect/start',
        { ownerKind: 'company', companyId: company!.id },
      );
      if (d.configured && d.url) {
        window.open(d.url, '_blank', 'noopener');
        setMsg('Stripe onboarding opened in a new tab. Finish there, then refresh status.');
      } else {
        setConfigured(false);
        setMsg(d.message ?? 'Stripe is not connected yet.');
      }
    } catch (e: any) {
      setErr(e.message ?? 'Could not start Stripe onboarding.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Payout Settings</h1>
          <div className="sub">
            Connect a bank account to receive payouts (referral revenue share, agreed splits, and
            disbursements) by direct deposit.
          </div>
        </div>
      </div>

      <div className="note badge b-neutral" style={{ marginBottom: 14, display: 'inline-block' }}>
        Banking is handled by Stripe. Divini Procure never stores your bank account or routing
        numbers. You enter them on Stripe's secure pages; we only keep your Stripe account id and the
        last 4 digits Stripe returns.
      </div>

      {err && <div className="err">{err}</div>}
      {msg && <div className="note" style={{ marginBottom: 12 }}>{msg}</div>}

      {!configured && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="note">
            Stripe payouts are not enabled on this environment yet. Once the platform connects Stripe,
            you will be able to onboard a bank account here.
          </div>
        </div>
      )}

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="two" style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div className="note">Status</div>
            <div style={{ marginTop: 4 }}>
              <span className={'badge ' + (STATUS_BADGE[account?.status ?? 'not_started'] ?? 'b-neutral')}>
                {account?.status ?? 'not started'}
              </span>
            </div>
          </div>
          <div style={{ flex: 1, minWidth: 160 }}>
            <div className="note">Payouts enabled</div>
            <div style={{ marginTop: 4 }}>
              <span className={'badge ' + (account?.payouts_enabled ? 'b-green' : 'b-amber')}>
                {account?.payouts_enabled ? 'Yes' : 'Not yet'}
              </span>
            </div>
          </div>
          <div style={{ flex: 1, minWidth: 160 }}>
            <div className="note">Bank on file</div>
            <div style={{ marginTop: 4, fontWeight: 600 }}>
              {account?.bank_last4 ? `•••• ${account.bank_last4}` : '-'}
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button className="btn primary" disabled={busy} onClick={connect}>
            {account?.stripe_account_id ? 'Continue Stripe onboarding' : 'Connect bank account (Stripe)'}
          </button>
          <button className="btn" disabled={busy} onClick={load}>
            Refresh status
          </button>
        </div>
        <div className="note" style={{ marginTop: 10 }}>
          Onboarding opens on Stripe. When you finish, return here and refresh to see payouts enabled.
        </div>
      </div>
    </>
  );
}
