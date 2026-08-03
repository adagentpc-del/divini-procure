import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiGet, apiSend } from '../lib/api';
import { useToast } from '../lib/toast';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type OnboardingStatus = {
  isPartner: boolean;
  partner?: { id: string; name: string; onboardingStatus: string };
  hasSigned: boolean;
  hasBanking: boolean;
  bankingVerified: boolean;
  step: 'sign_agreement' | 'submit_banking' | 'complete';
};

type AgreementData = {
  agreementBody: string;
  partnerName: string;
  commissionSummary: string;
  alreadySigned: boolean;
  signedAt: string | null;
  signedName: string | null;
};

type BankingData = {
  banking: Record<string, string | boolean | null> | null;
};

type PayoutMethod = 'wire' | 'ach' | 'check' | 'zelle' | 'paypal';

// ---------------------------------------------------------------------------
// Step 1 — Agreement
// ---------------------------------------------------------------------------
function AgreementStep({ onSigned }: { onSigned: () => void }) {
  const { toast } = useToast();
  const [data, setData] = useState<AgreementData | null>(null);
  const [loading, setLoading] = useState(true);
  const [signedName, setSignedName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    apiGet<AgreementData>('/partner/onboarding/agreement')
      .then(setData)
      .catch(() => toast('Could not load agreement.', 'error'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="note">Loading agreement…</div>;
  if (!data) return <div className="note">Unable to load agreement.</div>;

  if (data.alreadySigned) {
    return (
      <div style={{ padding: '24px 0' }}>
        <div style={{ color: '#2a7a4b', fontWeight: 600, marginBottom: 8 }}>
          Agreement signed on {new Date(data.signedAt!).toLocaleDateString()}
        </div>
        <div className="note">Signed by: {data.signedName}</div>
        <button className="btn-primary" style={{ marginTop: 20 }} onClick={onSigned}>
          Continue to Banking Setup
        </button>
      </div>
    );
  }

  const handleSign = async () => {
    if (!signedName.trim()) {
      toast('Please type your full legal name to sign.', 'error');
      return;
    }
    if (!scrolled) {
      toast('Please scroll through the full agreement before signing.', 'error');
      return;
    }
    setSubmitting(true);
    try {
      await apiSend('POST', '/partner/onboarding/agreement/sign', { signedName });
      toast('Agreement signed. Thank you!', 'success');
      onSigned();
    } catch (e: unknown) {
      toast((e as Error).message ?? 'Could not sign agreement.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>Referral Partner Agreement</h2>
      <p className="note" style={{ marginBottom: 16 }}>
        Commission: <strong>{data.commissionSummary}</strong>. Please read the full agreement and sign below.
      </p>

      {/* Scrollable agreement body */}
      <div
        onScroll={(e) => {
          const el = e.currentTarget;
          if (el.scrollTop + el.clientHeight >= el.scrollHeight - 40) setScrolled(true);
        }}
        style={{
          border: '1px solid #d6d0c8',
          borderRadius: 8,
          padding: '20px 24px',
          maxHeight: 360,
          overflowY: 'auto',
          fontFamily: 'Georgia, serif',
          fontSize: 13,
          lineHeight: 1.8,
          background: '#fafaf8',
          marginBottom: 20,
          whiteSpace: 'pre-wrap',
          color: '#2c2a26',
        }}
      >
        {data.agreementBody}
      </div>

      {!scrolled && (
        <p className="note" style={{ color: '#b45309', marginBottom: 12, fontSize: 13 }}>
          Scroll to the bottom of the agreement to enable signing.
        </p>
      )}

      <div style={{ marginBottom: 16 }}>
        <label style={{ display: 'block', fontWeight: 600, marginBottom: 6, fontSize: 14 }}>
          Type your full legal name to sign
        </label>
        <input
          type="text"
          className="input"
          placeholder="Full legal name"
          value={signedName}
          onChange={(e) => setSignedName(e.target.value)}
          disabled={!scrolled}
          style={{ maxWidth: 340 }}
        />
        <div className="note" style={{ marginTop: 4, fontSize: 12 }}>
          By typing your name above you are providing an electronic signature and agree to be bound by this Agreement.
        </div>
      </div>

      <button
        className="btn-primary"
        onClick={handleSign}
        disabled={submitting || !scrolled || !signedName.trim()}
      >
        {submitting ? 'Signing…' : 'Sign Agreement'}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 2 — Banking
// ---------------------------------------------------------------------------
function BankingStep({ onSubmitted }: { onSubmitted: () => void }) {
  const { toast } = useToast();
  const [existing, setExisting] = useState<Record<string, string | boolean | null> | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const [method, setMethod] = useState<PayoutMethod>('wire');
  const [beneficiaryName, setBeneficiaryName] = useState('');
  const [bankName, setBankName] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [routingNumber, setRoutingNumber] = useState('');
  const [accountType, setAccountType] = useState<'checking' | 'savings'>('checking');
  const [swiftCode, setSwiftCode] = useState('');
  const [iban, setIban] = useState('');
  const [bankAddress, setBankAddress] = useState('');
  const [zelleEmail, setZelleEmail] = useState('');
  const [paypalEmail, setPaypalEmail] = useState('');
  const [checkPayableTo, setCheckPayableTo] = useState('');
  const [checkAddress, setCheckAddress] = useState('');

  useEffect(() => {
    apiGet<BankingData>('/partner/onboarding/banking')
      .then((d) => {
        if (d.banking) {
          const b = d.banking;
          setExisting(b);
          setMethod((b.payout_method as PayoutMethod) ?? 'wire');
          setBeneficiaryName((b.beneficiary_name as string) ?? '');
          setBankName((b.bank_name as string) ?? '');
          // account_number is masked — don't pre-fill
          setRoutingNumber('');
          setAccountType((b.account_type as 'checking' | 'savings') ?? 'checking');
          setSwiftCode((b.swift_code as string) ?? '');
          setIban((b.iban as string) ?? '');
          setBankAddress((b.bank_address as string) ?? '');
          setZelleEmail((b.zelle_email as string) ?? '');
          setPaypalEmail((b.paypal_email as string) ?? '');
          setCheckPayableTo((b.check_payable_to as string) ?? '');
          setCheckAddress((b.check_address as string) ?? '');
        }
      })
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, []);

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      await apiSend('POST', '/partner/onboarding/banking', {
        payoutMethod: method,
        beneficiaryName,
        bankName,
        accountNumber,
        routingNumber,
        accountType,
        swiftCode,
        iban,
        bankAddress,
        zelleEmail,
        paypalEmail,
        checkPayableTo,
        checkAddress,
      });
      toast('Banking information submitted. We will verify and notify you.', 'success');
      onSubmitted();
    } catch (e: unknown) {
      toast((e as Error).message ?? 'Could not submit banking info.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <div className="note">Loading…</div>;

  return (
    <div>
      <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>Banking & Payout Information</h2>
      <p className="note" style={{ marginBottom: 20 }}>
        This information is used to pay your referral fees. All details are kept secure and are only accessible to Divini Procure staff.
        {existing && (
          <span style={{ color: '#2a7a4b', marginLeft: 6 }}>You have existing banking info on file. Update any fields below and resubmit.</span>
        )}
      </p>

      {/* Payout method */}
      <div style={{ marginBottom: 18 }}>
        <label style={{ display: 'block', fontWeight: 600, marginBottom: 6, fontSize: 14 }}>Payout Method</label>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {(['wire', 'ach', 'check', 'zelle', 'paypal'] as PayoutMethod[]).map((m) => (
            <button
              key={m}
              onClick={() => setMethod(m)}
              style={{
                padding: '7px 16px',
                borderRadius: 6,
                border: method === m ? '2px solid #123c2e' : '1px solid #d6d0c8',
                background: method === m ? '#123c2e' : '#fff',
                color: method === m ? '#fff' : '#2c2a26',
                fontWeight: method === m ? 700 : 400,
                cursor: 'pointer',
                fontSize: 14,
              }}
            >
              {m === 'wire' ? 'Wire Transfer' : m === 'ach' ? 'ACH / Direct Deposit' : m.charAt(0).toUpperCase() + m.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Beneficiary name — always shown */}
      <Field label="Beneficiary / Account Holder Name" required>
        <input className="input" value={beneficiaryName} onChange={(e) => setBeneficiaryName(e.target.value)} placeholder="Legal name on bank account" />
      </Field>

      {/* Wire / ACH fields */}
      {(method === 'wire' || method === 'ach') && (
        <>
          <Field label="Bank Name">
            <input className="input" value={bankName} onChange={(e) => setBankName(e.target.value)} placeholder="e.g. Chase, Bank of America" />
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
            <Field label="Account Number" required hint={existing?.account_number ? `Currently: ${existing.account_number}` : undefined}>
              <input className="input" value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} placeholder={existing?.account_number ? 'Enter to update' : 'Account number'} type="password" autoComplete="off" />
            </Field>
            <Field label="Routing Number (ABA)" required hint={existing?.routing_number ? `Currently: ${existing.routing_number}` : undefined}>
              <input className="input" value={routingNumber} onChange={(e) => setRoutingNumber(e.target.value)} placeholder={existing?.routing_number ? 'Enter to update' : '9-digit routing number'} />
            </Field>
          </div>
          <Field label="Account Type">
            <select className="input" value={accountType} onChange={(e) => setAccountType(e.target.value as 'checking' | 'savings')} style={{ maxWidth: 200 }}>
              <option value="checking">Checking</option>
              <option value="savings">Savings</option>
            </select>
          </Field>
          {method === 'wire' && (
            <>
              <Field label="SWIFT / BIC Code" hint="Required for international wire transfers">
                <input className="input" value={swiftCode} onChange={(e) => setSwiftCode(e.target.value)} placeholder="e.g. CHASUS33" style={{ maxWidth: 220 }} />
              </Field>
              <Field label="IBAN" hint="Required for some international recipients">
                <input className="input" value={iban} onChange={(e) => setIban(e.target.value)} placeholder="e.g. GB29 NWBK..." />
              </Field>
              <Field label="Bank Address">
                <textarea className="input" rows={2} value={bankAddress} onChange={(e) => setBankAddress(e.target.value)} placeholder="Full bank branch address" />
              </Field>
            </>
          )}
        </>
      )}

      {/* Zelle */}
      {method === 'zelle' && (
        <Field label="Zelle Email or Phone" required>
          <input className="input" value={zelleEmail} onChange={(e) => setZelleEmail(e.target.value)} placeholder="Email or phone registered with Zelle" />
        </Field>
      )}

      {/* PayPal */}
      {method === 'paypal' && (
        <Field label="PayPal Email" required>
          <input className="input" value={paypalEmail} onChange={(e) => setPaypalEmail(e.target.value)} placeholder="PayPal account email" />
        </Field>
      )}

      {/* Check */}
      {method === 'check' && (
        <>
          <Field label="Make Check Payable To" required>
            <input className="input" value={checkPayableTo} onChange={(e) => setCheckPayableTo(e.target.value)} placeholder="Full legal name or business name" />
          </Field>
          <Field label="Mailing Address" required>
            <textarea className="input" rows={3} value={checkAddress} onChange={(e) => setCheckAddress(e.target.value)} placeholder="Street address, City, State, ZIP" />
          </Field>
        </>
      )}

      <div style={{ marginTop: 24 }}>
        <button className="btn-primary" onClick={handleSubmit} disabled={submitting || !beneficiaryName.trim()}>
          {submitting ? 'Submitting…' : existing ? 'Update Banking Info' : 'Submit Banking Info'}
        </button>
        <p className="note" style={{ marginTop: 8, fontSize: 12 }}>
          Your banking information is stored securely. Divini Procure will verify your details before issuing your first payment.
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Field helper
// ---------------------------------------------------------------------------
function Field({ label, required, hint, children }: {
  label: string; required?: boolean; hint?: string; children: React.ReactNode;
}) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: 'block', fontWeight: 600, marginBottom: 5, fontSize: 14 }}>
        {label}{required && <span style={{ color: '#c0392b', marginLeft: 3 }}>*</span>}
      </label>
      {children}
      {hint && <div className="note" style={{ marginTop: 3, fontSize: 12 }}>{hint}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Complete state
// ---------------------------------------------------------------------------
function CompleteStep({ verified }: { verified: boolean }) {
  const nav = useNavigate();
  return (
    <div style={{ padding: '24px 0', textAlign: 'center' }}>
      <div style={{ fontSize: 48, marginBottom: 12 }}>🎉</div>
      <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>You are all set!</h2>
      <p className="note" style={{ marginBottom: 16, maxWidth: 420, margin: '0 auto 20px' }}>
        Your Referral Partner Agreement is signed and your banking information has been submitted.
        {verified
          ? ' Your banking details have been verified — you are ready to receive referral payments.'
          : ' Our team will verify your banking details before your first payment is issued.'}
      </p>
      <button className="btn-primary" onClick={() => nav('/dashboard')}>
        Go to Dashboard
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------
export default function PartnerOnboarding() {
  const [status, setStatus] = useState<OnboardingStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();
  const nav = useNavigate();

  const load = () => {
    setLoading(true);
    apiGet<OnboardingStatus>('/partner/onboarding/status')
      .then(setStatus)
      .catch(() => toast('Could not load onboarding status.', 'error'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  if (loading) {
    return (
      <div className="center" style={{ padding: 40 }}>
        <div className="note">Loading your partner portal…</div>
      </div>
    );
  }

  if (!status?.isPartner) {
    return (
      <div className="center" style={{ maxWidth: 480, padding: 40 }}>
        <h1 style={{ fontSize: 22, marginBottom: 8 }}>Partner Portal</h1>
        <p className="note">Your account is not currently set up as a referral partner. If you believe this is an error, please contact your Divini Procure representative.</p>
        <button className="btn-secondary" style={{ marginTop: 16 }} onClick={() => nav('/dashboard')}>Back to Dashboard</button>
      </div>
    );
  }

  const steps = [
    { key: 'sign_agreement', label: 'Sign Agreement', done: status.hasSigned },
    { key: 'submit_banking', label: 'Banking Info', done: status.hasBanking },
    { key: 'complete', label: 'Complete', done: status.step === 'complete' },
  ];

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '32px 24px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 28 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>Referral Partner Setup</h1>
          <div className="note" style={{ marginTop: 2 }}>Welcome, {status.partner?.name}. Complete the steps below to activate your partner account.</div>
        </div>
      </div>

      {/* Progress steps */}
      <div style={{ display: 'flex', gap: 0, marginBottom: 32 }}>
        {steps.map((s, i) => (
          <div key={s.key} style={{ flex: 1, display: 'flex', alignItems: 'center' }}>
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              flex: 1,
            }}>
              <div style={{
                width: 32, height: 32, borderRadius: '50%',
                background: s.done ? '#123c2e' : status.step === s.key ? '#2a7a4b' : '#e7e1d6',
                color: s.done || status.step === s.key ? '#fff' : '#7d776c',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontWeight: 700, fontSize: 14,
              }}>
                {s.done ? '✓' : i + 1}
              </div>
              <div style={{ marginTop: 6, fontSize: 12, fontWeight: status.step === s.key ? 700 : 400, color: '#2c2a26' }}>{s.label}</div>
            </div>
            {i < steps.length - 1 && (
              <div style={{ height: 2, background: s.done ? '#123c2e' : '#e7e1d6', width: 40, marginBottom: 20 }} />
            )}
          </div>
        ))}
      </div>

      {/* Active step content */}
      <div style={{ background: '#fff', border: '1px solid #e7e1d6', borderRadius: 10, padding: '28px 28px' }}>
        {status.step === 'sign_agreement' && (
          <AgreementStep onSigned={() => { load(); }} />
        )}
        {status.step === 'submit_banking' && (
          <BankingStep onSubmitted={() => { load(); }} />
        )}
        {status.step === 'complete' && (
          <CompleteStep verified={status.bankingVerified} />
        )}
      </div>

      {/* Already have banking but want to update */}
      {status.step === 'complete' && (
        <div style={{ marginTop: 16, textAlign: 'center' }}>
          <button
            className="btn-secondary"
            onClick={() => setStatus({ ...status, step: 'submit_banking' })}
          >
            Update Banking Info
          </button>
        </div>
      )}
    </div>
  );
}
