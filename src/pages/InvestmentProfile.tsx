/**
 * Developer (buyer) investment profile editor. A developer declares whether they
 * are open to investors and the parameters of their capital raising, then submits
 * the profile for admin review. Money fields are shown in dollars and sent as
 * integer cents.
 */
import { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth';
import { apiGet, apiSend } from '../lib/api';
import ComplianceDisclaimer from '../components/ComplianceDisclaimer';

type Profile = {
  id?: string;
  status?: string;
  admin_review_status?: string;
  investment_contact_name?: string;
  investment_contact_email?: string;
  investment_contact_phone?: string;
  capital_raising_status?: string;
  open_to_investors?: boolean;
  accredited_accepted?: boolean;
  non_accredited_accepted?: boolean;
  min_investment_cents?: number;
  max_investment_cents?: number;
  target_raise_cents?: number;
  preferred_investor_type?: string;
  offering_type?: string;
  investment_structure?: string;
  target_returns?: string;
  hold_period?: string;
  distribution_schedule?: string;
  risk_level?: string;
  markets?: string[];
  asset_classes?: string[];
  track_record?: string;
  nda_required?: boolean;
  accreditation_required?: boolean;
  kyc_required?: boolean;
  qualification_requirements?: string;
  compliance_notes?: string;
};

const dollarsToCents = (s: string): number | undefined =>
  s === '' || s == null ? undefined : Math.round(Number(s) * 100);
const centsToDollars = (c?: number): string =>
  c == null ? '' : String(Number(c) / 100);

export default function InvestmentProfile() {
  const { company } = useAuth();
  const [p, setP] = useState<Profile>({});
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    if (!company) return;
    try {
      const d = await apiGet<{ investmentProfile: Profile | null }>(`/dev-org?companyId=${company.id}`);
      setP(d.investmentProfile ?? {});
    } catch (e: any) { setErr(e.message ?? 'Could not load profile.'); }
  }
  useEffect(() => { void load(); /* eslint-disable-next-line */ }, [company]);

  if (!company) return <div className="note">Loading…</div>;
  if (company.kind !== 'buyer') return <div className="card">This page is for developer accounts.</div>;

  function set<K extends keyof Profile>(k: K, v: Profile[K]) { setP((prev) => ({ ...prev, [k]: v })); }
  const csv = (arr?: string[]) => (arr ?? []).join(', ');
  const fromCsv = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);

  async function save() {
    if (!company) return;
    setBusy(true); setErr(''); setOk('');
    try {
      const d = await apiSend<{ investmentProfile: Profile }>('POST', '/dev-org/investment-profile', {
        companyId: company.id,
        investment_contact_name: p.investment_contact_name,
        investment_contact_email: p.investment_contact_email,
        investment_contact_phone: p.investment_contact_phone,
        capital_raising_status: p.capital_raising_status,
        open_to_investors: !!p.open_to_investors,
        accredited_accepted: !!p.accredited_accepted,
        non_accredited_accepted: !!p.non_accredited_accepted,
        min_investment_cents: p.min_investment_cents,
        max_investment_cents: p.max_investment_cents,
        target_raise_cents: p.target_raise_cents,
        preferred_investor_type: p.preferred_investor_type,
        offering_type: p.offering_type,
        investment_structure: p.investment_structure,
        target_returns: p.target_returns,
        hold_period: p.hold_period,
        distribution_schedule: p.distribution_schedule,
        risk_level: p.risk_level,
        markets: p.markets ?? [],
        asset_classes: p.asset_classes ?? [],
        track_record: p.track_record,
        nda_required: !!p.nda_required,
        accreditation_required: !!p.accreditation_required,
        kyc_required: !!p.kyc_required,
        qualification_requirements: p.qualification_requirements,
        compliance_notes: p.compliance_notes,
      });
      setP(d.investmentProfile);
      setOk('Investment profile saved.');
    } catch (e: any) { setErr(e.message ?? 'Could not save profile.'); }
    finally { setBusy(false); }
  }

  async function submit() {
    if (!company) return;
    setBusy(true); setErr(''); setOk('');
    try {
      const d = await apiSend<{ investmentProfile: Profile }>('POST', '/dev-org/investment-profile/submit', { companyId: company.id });
      setP(d.investmentProfile);
      setOk('Submitted for review.');
    } catch (e: any) { setErr(e.message ?? 'Could not submit.'); }
    finally { setBusy(false); }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Investment profile</h1>
          <div className="sub">Declare whether you are open to investors and the terms of your capital raise. Submitted profiles are reviewed before any matching occurs.</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {p.status && <span className="badge b-neutral">Status: {p.status.replace(/_/g, ' ')}</span>}
          {p.admin_review_status && <span className="badge b-amber">Review: {p.admin_review_status.replace(/_/g, ' ')}</span>}
        </div>
      </div>

      {err && <div className="err">{err}</div>}
      {ok && <div className="ok">{ok}</div>}

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="two">
          <div className="field"><label>Investment contact name</label><input value={p.investment_contact_name ?? ''} onChange={(e) => set('investment_contact_name', e.target.value)} /></div>
          <div className="field"><label>Investment contact email</label><input value={p.investment_contact_email ?? ''} onChange={(e) => set('investment_contact_email', e.target.value)} /></div>
          <div className="field"><label>Investment contact phone</label><input value={p.investment_contact_phone ?? ''} onChange={(e) => set('investment_contact_phone', e.target.value)} /></div>
          <div className="field"><label>Capital raising status</label>
            <select value={p.capital_raising_status ?? ''} onChange={(e) => set('capital_raising_status', e.target.value)}>
              <option value="">Select…</option>
              <option value="not_raising">Not currently raising</option>
              <option value="planning">Planning a raise</option>
              <option value="actively_raising">Actively raising</option>
              <option value="closed">Closed</option>
            </select>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginTop: 6 }}>
          <label className="note"><input type="checkbox" checked={!!p.open_to_investors} onChange={(e) => set('open_to_investors', e.target.checked)} /> Open to investors</label>
          <label className="note"><input type="checkbox" checked={!!p.accredited_accepted} onChange={(e) => set('accredited_accepted', e.target.checked)} /> Accept accredited investors</label>
          <label className="note"><input type="checkbox" checked={!!p.non_accredited_accepted} onChange={(e) => set('non_accredited_accepted', e.target.checked)} /> Accept non-accredited investors</label>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="note" style={{ fontWeight: 700, marginBottom: 10 }}>Raise parameters</div>
        <div className="two">
          <div className="field"><label>Target raise ($)</label><input type="number" value={centsToDollars(p.target_raise_cents)} onChange={(e) => set('target_raise_cents', dollarsToCents(e.target.value))} /></div>
          <div className="field"><label>Offering type</label><input value={p.offering_type ?? ''} onChange={(e) => set('offering_type', e.target.value)} placeholder="506(b), 506(c), Reg A+…" /></div>
          <div className="field"><label>Minimum investment ($)</label><input type="number" value={centsToDollars(p.min_investment_cents)} onChange={(e) => set('min_investment_cents', dollarsToCents(e.target.value))} /></div>
          <div className="field"><label>Maximum investment ($)</label><input type="number" value={centsToDollars(p.max_investment_cents)} onChange={(e) => set('max_investment_cents', dollarsToCents(e.target.value))} /></div>
          <div className="field"><label>Preferred investor type</label><input value={p.preferred_investor_type ?? ''} onChange={(e) => set('preferred_investor_type', e.target.value)} placeholder="individual, family office, institutional…" /></div>
          <div className="field"><label>Investment structure</label><input value={p.investment_structure ?? ''} onChange={(e) => set('investment_structure', e.target.value)} placeholder="equity, preferred equity, debt…" /></div>
          <div className="field"><label>Target returns</label><input value={p.target_returns ?? ''} onChange={(e) => set('target_returns', e.target.value)} placeholder="e.g. 15-18% IRR" /></div>
          <div className="field"><label>Hold period</label><input value={p.hold_period ?? ''} onChange={(e) => set('hold_period', e.target.value)} placeholder="e.g. 5-7 years" /></div>
          <div className="field"><label>Distribution schedule</label><input value={p.distribution_schedule ?? ''} onChange={(e) => set('distribution_schedule', e.target.value)} placeholder="quarterly, annual…" /></div>
          <div className="field"><label>Risk level</label>
            <select value={p.risk_level ?? ''} onChange={(e) => set('risk_level', e.target.value)}>
              <option value="">Select…</option>
              <option value="conservative">Conservative</option>
              <option value="moderate">Moderate</option>
              <option value="aggressive">Aggressive</option>
            </select>
          </div>
          <div className="field"><label>Markets (comma-separated)</label><input value={csv(p.markets)} onChange={(e) => set('markets', fromCsv(e.target.value))} /></div>
          <div className="field"><label>Asset classes (comma-separated)</label><input value={csv(p.asset_classes)} onChange={(e) => set('asset_classes', fromCsv(e.target.value))} /></div>
        </div>
        <div className="field"><label>Track record</label><textarea rows={3} value={p.track_record ?? ''} onChange={(e) => set('track_record', e.target.value)} /></div>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="note" style={{ fontWeight: 700, marginBottom: 10 }}>Compliance &amp; qualification</div>
        <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginBottom: 10 }}>
          <label className="note"><input type="checkbox" checked={!!p.nda_required} onChange={(e) => set('nda_required', e.target.checked)} /> NDA required</label>
          <label className="note"><input type="checkbox" checked={!!p.accreditation_required} onChange={(e) => set('accreditation_required', e.target.checked)} /> Accreditation required</label>
          <label className="note"><input type="checkbox" checked={!!p.kyc_required} onChange={(e) => set('kyc_required', e.target.checked)} /> KYC required</label>
        </div>
        <div className="field"><label>Qualification requirements</label><textarea rows={2} value={p.qualification_requirements ?? ''} onChange={(e) => set('qualification_requirements', e.target.value)} /></div>
        <div className="field"><label>Compliance notes</label><textarea rows={2} value={p.compliance_notes ?? ''} onChange={(e) => set('compliance_notes', e.target.value)} /></div>
      </div>

      <div style={{ display: 'flex', gap: 10 }}>
        <button className="btn primary" disabled={busy} onClick={save}>Save profile</button>
        <button className="btn" disabled={busy} onClick={submit}>Submit for review</button>
      </div>

      <ComplianceDisclaimer />
    </>
  );
}
