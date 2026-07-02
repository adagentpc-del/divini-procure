/**
 * Opportunity Teaser Builder (developer / buyer).
 *
 * A developer turns an investment program into a PUBLIC-SAFE teaser: a headline,
 * asset class, market, the deliberately public ranges, investor type, accredited
 * / NDA flags, public highlights, and a request-style call to action. List +
 * edit existing teasers and toggle them public.
 *
 * COMPLIANCE: teasers are public-safe. They NEVER contain "invest now" language.
 * The only call to action is Request access / Request information / Request
 * introduction. Restricted program financials stay out of the teaser; only the
 * public range strings entered here are ever surfaced.
 */
import { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth';
import { apiGet, apiSend } from '../lib/api';

const REQUEST_CTAS = ['Request access', 'Request information', 'Request introduction'];

type Program = { id: string; name?: string };
type Teaser = Record<string, any> & {
  id: string;
  headline?: string;
  request_cta?: string;
  is_public?: boolean;
  public_highlights?: string[];
};

const EMPTY = {
  programId: '',
  headline: '',
  assetClass: '',
  market: '',
  targetRaiseRange: '',
  minInvestmentRange: '',
  investorType: '',
  accreditedRequired: true,
  ndaRequired: false,
  requestCta: 'Request introduction',
  isPublic: false,
};

export default function OpportunityTeasers() {
  const { company } = useAuth();
  const [teasers, setTeasers] = useState<Teaser[]>([]);
  const [programs, setPrograms] = useState<Program[]>([]);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [busy, setBusy] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const [form, setForm] = useState<Record<string, any>>({ ...EMPTY });
  const [highlightsText, setHighlightsText] = useState('');

  async function load() {
    if (!company) return;
    try {
      const r = await apiGet<{ teasers: Teaser[] }>(`/opportunity-teasers?companyId=${company.id}`);
      setTeasers(r.teasers ?? []);
    } catch (e: any) {
      setErr(e.message ?? 'Could not load teasers.');
    }
  }
  async function loadPrograms() {
    if (!company) return;
    try {
      const r = await apiGet<{ programs: Program[] }>(`/investment/programs?companyId=${company.id}`);
      setPrograms(r.programs ?? []);
    } catch {
      /* programs are optional context for the teaser */
    }
  }
  useEffect(() => {
    void load();
    void loadPrograms();
    /* eslint-disable-next-line */
  }, [company]);

  if (!company) return <div className="note">Loading…</div>;
  if (company.kind !== 'buyer') return <div className="card">This page is for developer accounts.</div>;

  const setF = (k: string, v: any) => setForm((p) => ({ ...p, [k]: v }));

  function highlightsArray(text: string): string[] {
    return text
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => s !== '');
  }

  async function create() {
    if (!company) return;
    setBusy(true);
    setErr('');
    setOk('');
    try {
      await apiSend('POST', '/opportunity-teasers', {
        companyId: company.id,
        ...form,
        programId: form.programId || undefined,
        publicHighlights: highlightsArray(highlightsText),
      });
      setForm({ ...EMPTY });
      setHighlightsText('');
      setOk('Teaser created.');
      await load();
    } catch (e: any) {
      setErr(e.message ?? 'Could not create teaser.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Opportunity teaser builder</h1>
          <div className="sub">
            Turn an investment program into a public-safe teaser. Teasers never use invest-now language. The
            only call to action is a request for access, information, or an introduction.
          </div>
        </div>
      </div>

      <div className="note" style={{ marginBottom: 12 }}>
        Public-safe: do not include restricted financials. Use the public ranges and highlights below; the exact
        program figures stay private.
      </div>

      {err && <div className="err">{err}</div>}
      {ok && <div className="ok">{ok}</div>}

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="note" style={{ fontWeight: 700, marginBottom: 10 }}>New teaser</div>
        <div className="two">
          <div className="field">
            <label>Linked program (optional)</label>
            <select value={form.programId} onChange={(e) => setF('programId', e.target.value)}>
              <option value="">None</option>
              {programs.map((p) => (
                <option key={p.id} value={p.id}>{p.name || p.id}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Headline</label>
            <input value={form.headline} onChange={(e) => setF('headline', e.target.value)} />
          </div>
          <div className="field">
            <label>Asset class</label>
            <input value={form.assetClass} onChange={(e) => setF('assetClass', e.target.value)} />
          </div>
          <div className="field">
            <label>Market</label>
            <input value={form.market} onChange={(e) => setF('market', e.target.value)} />
          </div>
          <div className="field">
            <label>Target raise range</label>
            <input
              value={form.targetRaiseRange}
              onChange={(e) => setF('targetRaiseRange', e.target.value)}
              placeholder="e.g. $5M - $10M"
            />
          </div>
          <div className="field">
            <label>Minimum investment range</label>
            <input
              value={form.minInvestmentRange}
              onChange={(e) => setF('minInvestmentRange', e.target.value)}
              placeholder="e.g. $50K - $100K"
            />
          </div>
          <div className="field">
            <label>Investor type</label>
            <input value={form.investorType} onChange={(e) => setF('investorType', e.target.value)} />
          </div>
          <div className="field">
            <label>Request CTA</label>
            <select value={form.requestCta} onChange={(e) => setF('requestCta', e.target.value)}>
              {REQUEST_CTAS.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="field">
          <label>Public highlights (one per line)</label>
          <textarea
            rows={3}
            value={highlightsText}
            onChange={(e) => setHighlightsText(e.target.value)}
            placeholder="Each line becomes a public highlight"
          />
        </div>
        <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginBottom: 10 }}>
          <label className="note">
            <input
              type="checkbox"
              checked={form.accreditedRequired}
              onChange={(e) => setF('accreditedRequired', e.target.checked)}
            />{' '}
            Accredited required
          </label>
          <label className="note">
            <input
              type="checkbox"
              checked={form.ndaRequired}
              onChange={(e) => setF('ndaRequired', e.target.checked)}
            />{' '}
            NDA required
          </label>
          <label className="note">
            <input type="checkbox" checked={form.isPublic} onChange={(e) => setF('isPublic', e.target.checked)} />{' '}
            Make public
          </label>
        </div>
        <button className="btn primary" disabled={busy} onClick={create}>
          Create teaser
        </button>
      </div>

      <div className="card" style={{ padding: 0, marginBottom: 16 }}>
        <table>
          <thead>
            <tr>
              <th>Headline</th>
              <th>Asset class</th>
              <th>Market</th>
              <th>CTA</th>
              <th>Public</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {teasers.length === 0 ? (
              <tr>
                <td colSpan={6} className="note" style={{ padding: 14 }}>No teasers yet.</td>
              </tr>
            ) : (
              teasers.map((t) => (
                <tr key={t.id}>
                  <td><strong>{t.headline || '-'}</strong></td>
                  <td className="note">{t.asset_class || '-'}</td>
                  <td className="note">{t.market || '-'}</td>
                  <td className="note">{t.request_cta || '-'}</td>
                  <td>
                    <span className={'badge ' + (t.is_public ? 'ok' : 'b-neutral')}>
                      {t.is_public ? 'Public' : 'Draft'}
                    </span>
                  </td>
                  <td>
                    <button className="btn" onClick={() => setOpenId(openId === t.id ? null : t.id)}>
                      {openId === t.id ? 'Close' : 'Edit'}
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {openId && <TeaserEdit key={openId} teaser={teasers.find((t) => t.id === openId)!} onChanged={load} />}
    </>
  );
}

function TeaserEdit({ teaser, onChanged }: { teaser: Teaser; onChanged: () => void }) {
  const [t, setT] = useState<Teaser>({ ...teaser });
  const [highlightsText, setHighlightsText] = useState((teaser.public_highlights ?? []).join('\n'));
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [busy, setBusy] = useState(false);

  const setK = (k: string, v: any) => setT((p) => ({ ...p, [k]: v }));

  async function save() {
    setBusy(true);
    setErr('');
    setOk('');
    try {
      await apiSend('PATCH', `/opportunity-teasers/${teaser.id}`, {
        headline: t.headline,
        assetClass: t.asset_class,
        market: t.market,
        targetRaiseRange: t.target_raise_range,
        minInvestmentRange: t.min_investment_range,
        investorType: t.investor_type,
        accreditedRequired: !!t.accredited_required,
        ndaRequired: !!t.nda_required,
        requestCta: t.request_cta,
        isPublic: !!t.is_public,
        publicHighlights: highlightsText
          .split('\n')
          .map((s) => s.trim())
          .filter((s) => s !== ''),
      });
      setOk('Saved.');
      onChanged();
    } catch (e: any) {
      setErr(e.message ?? 'Could not save.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="note" style={{ fontWeight: 700, marginBottom: 10 }}>Edit teaser</div>
      {err && <div className="err">{err}</div>}
      {ok && <div className="ok">{ok}</div>}
      <div className="two">
        <div className="field"><label>Headline</label><input value={t.headline ?? ''} onChange={(e) => setK('headline', e.target.value)} /></div>
        <div className="field"><label>Asset class</label><input value={t.asset_class ?? ''} onChange={(e) => setK('asset_class', e.target.value)} /></div>
        <div className="field"><label>Market</label><input value={t.market ?? ''} onChange={(e) => setK('market', e.target.value)} /></div>
        <div className="field"><label>Target raise range</label><input value={t.target_raise_range ?? ''} onChange={(e) => setK('target_raise_range', e.target.value)} /></div>
        <div className="field"><label>Minimum investment range</label><input value={t.min_investment_range ?? ''} onChange={(e) => setK('min_investment_range', e.target.value)} /></div>
        <div className="field"><label>Investor type</label><input value={t.investor_type ?? ''} onChange={(e) => setK('investor_type', e.target.value)} /></div>
        <div className="field">
          <label>Request CTA</label>
          <select value={t.request_cta ?? 'Request introduction'} onChange={(e) => setK('request_cta', e.target.value)}>
            {REQUEST_CTAS.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="field">
        <label>Public highlights (one per line)</label>
        <textarea rows={3} value={highlightsText} onChange={(e) => setHighlightsText(e.target.value)} />
      </div>
      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginBottom: 10 }}>
        <label className="note"><input type="checkbox" checked={!!t.accredited_required} onChange={(e) => setK('accredited_required', e.target.checked)} /> Accredited required</label>
        <label className="note"><input type="checkbox" checked={!!t.nda_required} onChange={(e) => setK('nda_required', e.target.checked)} /> NDA required</label>
        <label className="note"><input type="checkbox" checked={!!t.is_public} onChange={(e) => setK('is_public', e.target.checked)} /> Make public</label>
      </div>
      <button className="btn primary" disabled={busy} onClick={save}>Save changes</button>
    </div>
  );
}
