/**
 * Investor onboarding — progressive. To JOIN we ask for the few fields matching
 * actually needs (name, asset classes, check-size range); everything else is an
 * optional "complete your profile" section that raises a completeness meter and,
 * later, unlocks warm intros / earns intro credits. Sensitive qualification data
 * (accreditation, KYC, proof of funds) is optional here and is really collected
 * at the moment an investor requests an intro to a specific deal.
 *
 * The POST payload is unchanged: every field still posts if filled; empties post
 * as undefined. Money shown in dollars, sent as integer cents.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiSend } from '../lib/api';
import ComplianceDisclaimer from '../components/ComplianceDisclaimer';

const d2c = (s: string) => (s === '' || s == null ? undefined : Math.round(Number(s) * 100));
const csv = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);

type Result = {
  profile?: any;
  preferences?: any;
  qualification?: any;
  accessLevel?: string;
};

export default function InvestorOnboarding() {
  const nav = useNavigate();
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [showMore, setShowMore] = useState(false);
  const [quietMode, setQuietMode] = useState(false);

  // basic
  const [fullName, setFullName] = useState('');
  const [entityName, setEntityName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [location, setLocation] = useState('');
  const [investorType, setInvestorType] = useState('individual');
  const [accreditationStatus, setAccreditationStatus] = useState('unverified');
  const [entityType, setEntityType] = useState('');
  const [website, setWebsite] = useState('');
  const [preferredContact, setPreferredContact] = useState('email');

  // preferences
  const [assetClasses, setAssetClasses] = useState('');
  const [markets, setMarkets] = useState('');
  const [minInv, setMinInv] = useState('');
  const [maxInv, setMaxInv] = useState('');
  const [totalAllocation, setTotalAllocation] = useState('');
  const [preferredDealSize, setPreferredDealSize] = useState('');
  const [preferredHold, setPreferredHold] = useState('');
  const [targetReturn, setTargetReturn] = useState('');
  const [riskTolerance, setRiskTolerance] = useState('moderate');
  const [incomeVsGrowth, setIncomeVsGrowth] = useState('');
  const [liquidityPreference, setLiquidityPreference] = useState('');
  const [preferredStructure, setPreferredStructure] = useState('');
  const [dealTypes, setDealTypes] = useState('');

  // qualification
  const [accredited, setAccredited] = useState(false);
  const [nonAccredited, setNonAccredited] = useState(false);
  const [qualifiedPurchaser, setQualifiedPurchaser] = useState(false);
  const [familyOffice, setFamilyOffice] = useState(false);
  const [proofOfFunds, setProofOfFunds] = useState(false);
  const [kycCompleted, setKycCompleted] = useState(false);
  const [ndaWilling, setNdaWilling] = useState(false);
  const [canReviewPrivate, setCanReviewPrivate] = useState(false);
  const [educationInterest, setEducationInterest] = useState(false);
  const [investmentExperience, setInvestmentExperience] = useState('');
  const [jurisdiction, setJurisdiction] = useState('');
  const [suitabilityNotes, setSuitabilityNotes] = useState('');

  // Profile-completeness signal (drives the meter + the "unlock warm intros" nudge).
  const checks = [
    !!fullName.trim(), !!email.trim(), !!location.trim(),
    !!assetClasses.trim(), !!markets.trim(), !!minInv || !!maxInv,
    !!targetReturn.trim(), !!preferredHold.trim(), !!dealTypes.trim(),
    !!preferredStructure.trim(), accreditationStatus !== 'unverified',
    accredited || nonAccredited || qualifiedPurchaser || familyOffice,
    proofOfFunds, kycCompleted, ndaWilling, !!investmentExperience.trim(),
  ];
  const completion = Math.round((checks.filter(Boolean).length / checks.length) * 100);

  async function submit() {
    setErr('');
    // Only the essentials matching actually needs are required to join.
    if (!fullName.trim()) { setErr('Please add your name so sponsors know who they are meeting.'); return; }
    if (!assetClasses.trim()) { setErr('Add at least one asset class so we can match you.'); return; }
    if (!minInv && !maxInv) { setErr('Add a check-size range (a minimum or a maximum) so we match your deals.'); return; }
    setBusy(true);
    try {
      const r = await apiSend<Result>('POST', '/investor/onboard', {
        full_name: fullName,
        entity_name: entityName,
        email,
        phone,
        location,
        investor_type: investorType,
        accreditation_status: accreditationStatus,
        entity_type: entityType,
        website,
        preferred_contact: preferredContact,
        quiet_mode: quietMode,
        visibility: quietMode ? 'private' : 'discoverable',
        preferences: {
          asset_classes: csv(assetClasses),
          markets: csv(markets),
          min_investment_cents: d2c(minInv),
          max_investment_cents: d2c(maxInv),
          total_allocation_cents: d2c(totalAllocation),
          preferred_deal_size_cents: d2c(preferredDealSize),
          preferred_hold_period: preferredHold,
          target_return: targetReturn,
          risk_tolerance: riskTolerance,
          income_vs_growth: incomeVsGrowth,
          liquidity_preference: liquidityPreference,
          preferred_structure: preferredStructure,
          deal_types: csv(dealTypes),
        },
        qualification: {
          accredited,
          non_accredited: nonAccredited,
          qualified_purchaser: qualifiedPurchaser,
          family_office: familyOffice,
          proof_of_funds: proofOfFunds,
          kyc_completed: kycCompleted,
          nda_willing: ndaWilling,
          can_review_private: canReviewPrivate,
          education_interest: educationInterest,
          investment_experience: investmentExperience,
          jurisdiction,
          suitability_notes: suitabilityNotes,
        },
      });
      setResult(r);
    } catch (e: any) { setErr(e.message ?? 'Could not submit onboarding.'); }
    finally { setBusy(false); }
  }

  if (result) {
    const isNonAccredited = nonAccredited && !accredited;
    return (
      <>
        <div className="page-head"><div>
          <h1>You're in</h1>
          <div className="sub">Your profile is live and we're matching you now. Qualification and access are determined by the platform and verified by sponsors.</div>
        </div></div>
        <div className="card" style={{ marginBottom: 14 }}>
          <div className="note" style={{ fontWeight: 700, marginBottom: 8 }}>Qualification status</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <span className="badge b-neutral">Access level: {(result.accessLevel ?? 'pending').replace(/_/g, ' ')}</span>
            {result.qualification?.status && <span className="badge b-amber">{String(result.qualification.status).replace(/_/g, ' ')}</span>}
            {accredited && <span className="badge b-green">Accredited (self-reported)</span>}
            {isNonAccredited && <span className="badge b-neutral">Non-accredited</span>}
          </div>
          {completion < 100 && (
            <div className="note" style={{ marginTop: 12 }}>
              Your profile is <strong>{completion}% complete</strong>. Completing it unlocks warmer introductions and better matches — you can finish it any time from your dashboard.
            </div>
          )}
          {isNonAccredited && (
            <div className="note" style={{ marginTop: 12 }}>
              As a non-accredited investor you may initially be limited to educational content and publicly available
              information. You will be able to access more opportunities as your qualification is verified.
            </div>
          )}
        </div>
        <button className="btn primary" onClick={() => nav('/investor')}>Go to investor dashboard</button>
        <ComplianceDisclaimer />
      </>
    );
  }

  return (
    <>
      <div className="page-head"><div>
        <h1>Join as an investor</h1>
        <div className="sub">Takes about 30 seconds. Tell us what you invest in and your check size — that's all we need to start matching you. You can complete your profile any time.</div>
      </div></div>

      {err && <div className="err">{err}</div>}

      {/* Completeness meter */}
      <div className="card" style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
          <div className="note" style={{ fontWeight: 700 }}>Profile completeness</div>
          <div className="note" style={{ fontWeight: 700, color: 'var(--emerald)' }}>{completion}%</div>
        </div>
        <div style={{ height: 8, borderRadius: 6, background: 'var(--line)', overflow: 'hidden' }}
          role="progressbar" aria-valuenow={completion} aria-valuemin={0} aria-valuemax={100} aria-label="Profile completeness">
          <div style={{ width: `${completion}%`, height: '100%', background: 'var(--emerald)', transition: 'width .2s ease' }} />
        </div>
        <div className="note" style={{ marginTop: 8 }}>
          A complete profile unlocks warmer introductions, better-matched deals, and intro credits. You only need the essentials below to join.
        </div>
      </div>

      {/* Essentials — all that's required to join */}
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="note" style={{ fontWeight: 700, marginBottom: 10 }}>Essentials</div>
        <div className="two">
          <div className="field"><label>Full name</label><input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Jane Investor" /></div>
          <div className="field"><label>Email</label><input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@fund.com" /></div>
          <div className="field"><label>Asset classes you invest in (comma-separated)</label><input value={assetClasses} onChange={(e) => setAssetClasses(e.target.value)} placeholder="multifamily, industrial, retail" /></div>
          <div className="field"><label>Markets (comma-separated, optional)</label><input value={markets} onChange={(e) => setMarkets(e.target.value)} placeholder="Southeast, Texas" /></div>
          <div className="field"><label>Minimum check ($)</label><input type="number" value={minInv} onChange={(e) => setMinInv(e.target.value)} placeholder="50000" /></div>
          <div className="field"><label>Maximum check ($)</label><input type="number" value={maxInv} onChange={(e) => setMaxInv(e.target.value)} placeholder="1000000" /></div>
        </div>
        <label className="note" style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 6 }}>
          <input type="checkbox" style={{ width: 'auto', marginTop: 3 }} checked={quietMode} onChange={(e) => setQuietMode(e.target.checked)} />
          <span>Keep me private (family-office mode). Stay invisible and receive matches as a periodic digest instead of being listed. You can change this any time.</span>
        </label>
      </div>

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
        <button className="btn primary" disabled={busy} onClick={submit}>{busy ? 'Joining…' : 'Join & see matches'}</button>
        <button type="button" className="btn" onClick={() => setShowMore((v) => !v)} aria-expanded={showMore}>
          {showMore ? 'Hide profile details' : 'Complete your profile (unlock warm intros)'}
        </button>
      </div>

      {showMore && (
        <>
          <div className="card" style={{ marginBottom: 14 }}>
            <div className="note" style={{ fontWeight: 700, marginBottom: 10 }}>About you</div>
            <div className="two">
              <div className="field"><label>Entity name (optional)</label><input value={entityName} onChange={(e) => setEntityName(e.target.value)} /></div>
              <div className="field"><label>Phone</label><input value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
              <div className="field"><label>Location</label><input value={location} onChange={(e) => setLocation(e.target.value)} /></div>
              <div className="field"><label>Investor type</label>
                <select value={investorType} onChange={(e) => setInvestorType(e.target.value)}>
                  <option value="individual">Individual</option>
                  <option value="entity">Entity</option>
                  <option value="family_office">Family office</option>
                  <option value="institutional">Institutional</option>
                </select>
              </div>
              <div className="field"><label>Entity type</label><input value={entityType} onChange={(e) => setEntityType(e.target.value)} placeholder="LLC, trust, fund…" /></div>
              <div className="field"><label>Website</label><input value={website} onChange={(e) => setWebsite(e.target.value)} /></div>
              <div className="field"><label>Preferred contact</label>
                <select value={preferredContact} onChange={(e) => setPreferredContact(e.target.value)}>
                  <option value="email">Email</option>
                  <option value="phone">Phone</option>
                </select>
              </div>
            </div>
          </div>

          <div className="card" style={{ marginBottom: 14 }}>
            <div className="note" style={{ fontWeight: 700, marginBottom: 10 }}>Investment preferences</div>
            <div className="two">
              <div className="field"><label>Total allocation ($)</label><input type="number" value={totalAllocation} onChange={(e) => setTotalAllocation(e.target.value)} /></div>
              <div className="field"><label>Preferred deal size ($)</label><input type="number" value={preferredDealSize} onChange={(e) => setPreferredDealSize(e.target.value)} /></div>
              <div className="field"><label>Preferred hold period</label><input value={preferredHold} onChange={(e) => setPreferredHold(e.target.value)} /></div>
              <div className="field"><label>Target return</label><input value={targetReturn} onChange={(e) => setTargetReturn(e.target.value)} /></div>
              <div className="field"><label>Risk tolerance</label>
                <select value={riskTolerance} onChange={(e) => setRiskTolerance(e.target.value)}>
                  <option value="conservative">Conservative</option>
                  <option value="moderate">Moderate</option>
                  <option value="aggressive">Aggressive</option>
                </select>
              </div>
              <div className="field"><label>Income vs growth</label><input value={incomeVsGrowth} onChange={(e) => setIncomeVsGrowth(e.target.value)} placeholder="income, growth, balanced" /></div>
              <div className="field"><label>Liquidity preference</label><input value={liquidityPreference} onChange={(e) => setLiquidityPreference(e.target.value)} /></div>
              <div className="field"><label>Preferred structure</label><input value={preferredStructure} onChange={(e) => setPreferredStructure(e.target.value)} placeholder="equity, debt, preferred…" /></div>
              <div className="field"><label>Deal types (comma-separated)</label><input value={dealTypes} onChange={(e) => setDealTypes(e.target.value)} /></div>
            </div>
          </div>

          <div className="card" style={{ marginBottom: 14 }}>
            <div className="note" style={{ fontWeight: 700, marginBottom: 4 }}>Qualification</div>
            <div className="note" style={{ marginBottom: 10 }}>
              Optional now — you'll confirm these when you request an introduction to a specific deal.
            </div>
            <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginBottom: 10 }}>
              <label className="note"><input type="checkbox" checked={accredited} onChange={(e) => setAccredited(e.target.checked)} /> Accredited</label>
              <label className="note"><input type="checkbox" checked={nonAccredited} onChange={(e) => setNonAccredited(e.target.checked)} /> Non-accredited</label>
              <label className="note"><input type="checkbox" checked={qualifiedPurchaser} onChange={(e) => setQualifiedPurchaser(e.target.checked)} /> Qualified purchaser</label>
              <label className="note"><input type="checkbox" checked={familyOffice} onChange={(e) => setFamilyOffice(e.target.checked)} /> Family office</label>
              <label className="note"><input type="checkbox" checked={proofOfFunds} onChange={(e) => setProofOfFunds(e.target.checked)} /> Proof of funds available</label>
              <label className="note"><input type="checkbox" checked={kycCompleted} onChange={(e) => setKycCompleted(e.target.checked)} /> KYC completed</label>
              <label className="note"><input type="checkbox" checked={ndaWilling} onChange={(e) => setNdaWilling(e.target.checked)} /> Willing to sign NDA</label>
              <label className="note"><input type="checkbox" checked={canReviewPrivate} onChange={(e) => setCanReviewPrivate(e.target.checked)} /> Can review private offerings</label>
              <label className="note"><input type="checkbox" checked={educationInterest} onChange={(e) => setEducationInterest(e.target.checked)} /> Interested in education track</label>
            </div>
            <div className="two">
              <div className="field"><label>Investment experience</label><input value={investmentExperience} onChange={(e) => setInvestmentExperience(e.target.value)} /></div>
              <div className="field"><label>Jurisdiction</label><input value={jurisdiction} onChange={(e) => setJurisdiction(e.target.value)} /></div>
            </div>
            <div className="field"><label>Suitability notes</label><textarea rows={2} value={suitabilityNotes} onChange={(e) => setSuitabilityNotes(e.target.value)} /></div>
          </div>

          <button className="btn primary" disabled={busy} onClick={submit}>{busy ? 'Joining…' : 'Join & see matches'}</button>
        </>
      )}

      <ComplianceDisclaimer />
    </>
  );
}
