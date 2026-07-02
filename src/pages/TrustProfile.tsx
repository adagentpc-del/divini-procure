/**
 * Developer / sponsor TRUST PROFILE editor. This is the reputational surface a
 * passive investor vets before requesting an introduction: verification, track
 * record, team, and alignment (co-invest, rate caps, true preferred return). It
 * pre-answers the red-flag checklist LPs use. It is reputational only — it never
 * describes a specific offering or promises a return, so it stays public-safe.
 */
import { useEffect, useState } from 'react';
import { getMyTrust, saveTrust, type TrustResult } from '../lib/db';

const csv = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);

function ScoreBar({ f }: { f: { label: string; points: number; max: number } }) {
  const pct = f.max > 0 ? Math.round((f.points / f.max) * 100) : 0;
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
        <span>{f.label}</span>
        <span className="note">{f.points}/{f.max}</span>
      </div>
      <div style={{ height: 7, borderRadius: 5, background: 'var(--line)', overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: 'var(--emerald)' }} />
      </div>
    </div>
  );
}

export default function TrustProfile() {
  const [trust, setTrust] = useState<TrustResult | null>(null);
  const [noCompany, setNoCompany] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const [years, setYears] = useState('');
  const [projects, setProjects] = useState('');
  const [totalValue, setTotalValue] = useState('');
  const [team, setTeam] = useState('');
  const [markets, setMarkets] = useState('');
  const [fullCycle, setFullCycle] = useState(false);
  const [fullCycleDetail, setFullCycleDetail] = useState('');
  const [coInvests, setCoInvests] = useState(false);
  const [rateCaps, setRateCaps] = useState(false);
  const [prefStructure, setPrefStructure] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const r = await getMyTrust();
        if (!r.trust) { setNoCompany(true); return; }
        setTrust(r.trust);
        const p = r.trust.profile || {};
        setYears(p.years_operating != null ? String(p.years_operating) : '');
        setProjects(p.projects_completed != null ? String(p.projects_completed) : '');
        setTotalValue(p.total_value_cents != null ? String(Math.round(Number(p.total_value_cents) / 100)) : '');
        setTeam(p.team_size != null ? String(p.team_size) : '');
        setMarkets(Array.isArray(p.markets) ? p.markets.join(', ') : '');
        setFullCycle(!!p.full_cycle_track_record);
        setFullCycleDetail(p.full_cycle_detail || '');
        setCoInvests(!!p.co_invests);
        setRateCaps(!!p.uses_rate_caps);
        setPrefStructure(p.preferred_return_structure || '');
      } catch (e: any) { setErr(e?.message ?? 'Could not load your trust profile.'); }
    })();
  }, []);

  async function save() {
    setBusy(true); setErr(''); setMsg('');
    try {
      const r = await saveTrust({
        years_operating: years === '' ? null : Number(years),
        projects_completed: projects === '' ? null : Number(projects),
        total_value_cents: totalValue === '' ? null : Math.round(Number(totalValue) * 100),
        team_size: team === '' ? null : Number(team),
        markets: csv(markets),
        full_cycle_track_record: fullCycle,
        full_cycle_detail: fullCycleDetail,
        co_invests: coInvests,
        uses_rate_caps: rateCaps,
        preferred_return_structure: prefStructure,
      });
      setTrust(r.trust);
      setMsg('Saved. Your trust profile is what investors see before requesting an introduction.');
    } catch (e: any) { setErr(e?.message ?? 'Could not save.'); }
    finally { setBusy(false); }
  }

  if (noCompany) {
    return (
      <>
        <div className="page-head"><div><h1>Trust profile</h1></div></div>
        <div className="card"><div className="note">Create your company profile first — the trust profile attaches to your company.</div></div>
      </>
    );
  }

  return (
    <>
      <div className="page-head"><div>
        <h1>Trust profile</h1>
        <div className="sub">This is what investors see before they request an introduction. Only ~38% of sponsors share a full-cycle track record — the ones who do stand out. Reputational only; never describe a specific offering here.</div>
      </div></div>

      {err && <div className="err">{err}</div>}
      {msg && <div className="ok">{msg}</div>}

      <div className="grid cards2">
        <div className="card">
          <h3 style={{ fontSize: 18, marginBottom: 12 }}>Your record</h3>
          <div className="two">
            <div className="field"><label>Years operating</label><input type="number" value={years} onChange={(e) => setYears(e.target.value)} /></div>
            <div className="field"><label>Projects completed</label><input type="number" value={projects} onChange={(e) => setProjects(e.target.value)} /></div>
            <div className="field"><label>Total value delivered ($)</label><input type="number" value={totalValue} onChange={(e) => setTotalValue(e.target.value)} /></div>
            <div className="field"><label>Team size (2+ is a trust signal)</label><input type="number" value={team} onChange={(e) => setTeam(e.target.value)} /></div>
            <div className="field"><label>Markets (comma-separated)</label><input value={markets} onChange={(e) => setMarkets(e.target.value)} placeholder="Southeast, Texas" /></div>
          </div>

          <label className="note" style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
            <input type="checkbox" style={{ width: 'auto' }} checked={fullCycle} onChange={(e) => setFullCycle(e.target.checked)} />
            I share a full-cycle track record (deals taken start to finish)
          </label>
          {fullCycle && (
            <div className="field" style={{ marginTop: 8 }}><label>Full-cycle detail</label><textarea rows={2} value={fullCycleDetail} onChange={(e) => setFullCycleDetail(e.target.value)} placeholder="e.g. 4 deals full-cycle 2016–2024, avg hold 3.1 yrs" /></div>
          )}

          <h3 style={{ fontSize: 16, margin: '16px 0 8px' }}>Alignment</h3>
          <div className="note" style={{ marginBottom: 8 }}>These pre-answer the questions investors ask first.</div>
          <label className="note" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="checkbox" style={{ width: 'auto' }} checked={coInvests} onChange={(e) => setCoInvests(e.target.checked)} />
            I co-invest my own capital alongside investors
          </label>
          <label className="note" style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6 }}>
            <input type="checkbox" style={{ width: 'auto' }} checked={rateCaps} onChange={(e) => setRateCaps(e.target.checked)} />
            I use interest-rate caps on floating-rate debt
          </label>
          <div className="field" style={{ marginTop: 8 }}><label>Preferred return structure</label><input value={prefStructure} onChange={(e) => setPrefStructure(e.target.value)} placeholder="e.g. true preferred return, no GP catch-up" /></div>

          <button className="btn primary" style={{ marginTop: 12 }} disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save trust profile'}</button>
        </div>

        <div className="card">
          <h3 style={{ fontSize: 18, marginBottom: 4 }}>Divini Trust Score</h3>
          <div style={{ fontSize: 40, fontWeight: 800, color: 'var(--emerald)', lineHeight: 1.1 }}>{trust ? Math.round(trust.score) : '—'}</div>
          <div className="note" style={{ textTransform: 'capitalize', marginBottom: 14 }}>{trust?.band ?? ''}</div>
          {trust?.factors?.map((f) => <ScoreBar key={f.label} f={f} />)}
          <div className="note" style={{ marginTop: 10 }}>
            Higher score means better placement in investor matches and a trust badge on your card. This scores your transparency and credibility as an operator — never any investment or expected return.
          </div>
        </div>
      </div>
    </>
  );
}
