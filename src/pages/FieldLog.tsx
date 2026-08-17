import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../lib/auth';
import { useToast } from '../lib/toast';
import { apiGet, apiSend } from '../lib/api';

/**
 * Field Log: daily logs + a time clock for a vendor's field crew
 * (competitive gap closure - docs/competitive-analysis-2026-08.md gap #10:
 * "Mobile-first field execution app (daily logs, time clock, photos, punch
 * lists)"). Progress photos (ProgressPhotos.tsx) and punch lists
 * (DeliveryTracking.tsx) already exist; this adds the two missing pieces.
 * Talks to server/src/routes/field-log.ts. Vendor-only - a developer does
 * not create entries here (see the route file's own header).
 */

type Site = { id: string; name: string; location: string | null };
type DailyLog = {
  id: string; building_id: string; vendor_company_id: string; logged_by_email: string | null;
  log_date: string; work_performed: string; crew_count: number | null; weather: string | null;
  delays: string | null; created_at: string;
};
type TimeEntry = {
  id: string; building_id: string; vendor_company_id: string; logged_by_email: string | null;
  clock_in: string; clock_out: string | null; notes: string | null;
};

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
function fmtDate(d: string): string {
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function durationLabel(clockIn: string, clockOut: string | null): string {
  const end = clockOut ? new Date(clockOut) : new Date();
  const ms = end.getTime() - new Date(clockIn).getTime();
  const hours = ms / 3_600_000;
  return `${hours.toFixed(1)}h`;
}
/** Today's date in the crew's own local timezone, not the server's - a
 * crew logging work in the evening must not have it recorded as tomorrow
 * just because the database session runs in a different timezone. */
function todayLocalDate(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export default function FieldLog() {
  const { company } = useAuth();
  const { toast } = useToast();

  const [sites, setSites] = useState<Site[]>([]);
  const [siteId, setSiteId] = useState('');
  const [sitesLoading, setSitesLoading] = useState(true);
  // Guards against a stale response from a previously-selected site
  // overwriting state after the user has already switched to a different
  // site - without this, quickly picking site A then site B could apply
  // site A's (still in-flight) openEntry to the now-selected site B, and a
  // "Clock out" tap would then close the wrong site's shift.
  const requestedSiteRef = useRef('');

  const [openEntry, setOpenEntry] = useState<TimeEntry | null>(null);
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [clockBusy, setClockBusy] = useState(false);

  const [logs, setLogs] = useState<DailyLog[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [showLogForm, setShowLogForm] = useState(false);
  const [logSubmitting, setLogSubmitting] = useState(false);
  const [workPerformed, setWorkPerformed] = useState('');
  const [crewCount, setCrewCount] = useState('');
  const [weather, setWeather] = useState('');
  const [delays, setDelays] = useState('');

  const [err, setErr] = useState('');

  useEffect(() => {
    if (!company) return;
    setSitesLoading(true);
    apiGet<{ sites: Site[] }>(`/field-log/my-sites?companyId=${encodeURIComponent(company.id)}`)
      .then((d) => {
        const s = d.sites ?? [];
        setSites(s);
        if (s.length === 1) setSiteId(s[0].id);
      })
      .catch((e) => setErr(e.message ?? 'Could not load your sites.'))
      .finally(() => setSitesLoading(false));
  }, [company]);

  async function loadSiteData() {
    if (!company || !siteId) return;
    const requestedSite = siteId;
    requestedSiteRef.current = requestedSite;
    setErr('');
    setLogsLoading(true);
    try {
      const [openRes, entriesRes, logsRes] = await Promise.all([
        apiGet<{ entry: TimeEntry | null }>(`/field-log/time-entries/open?buildingId=${requestedSite}&vendorCompanyId=${company.id}`),
        apiGet<{ entries: TimeEntry[] }>(`/field-log/time-entries?buildingId=${requestedSite}`),
        apiGet<{ logs: DailyLog[] }>(`/field-log/daily-logs?buildingId=${requestedSite}`),
      ]);
      // The user may have switched to a different site while these requests
      // were in flight - discard a now-stale response rather than applying
      // it to the currently-selected site.
      if (requestedSiteRef.current !== requestedSite) return;
      setOpenEntry(openRes.entry);
      setEntries(entriesRes.entries ?? []);
      setLogs(logsRes.logs ?? []);
    } catch (e: any) {
      if (requestedSiteRef.current !== requestedSite) return;
      setErr(e.message ?? 'Could not load this site.');
    } finally {
      if (requestedSiteRef.current === requestedSite) setLogsLoading(false);
    }
  }
  useEffect(() => { loadSiteData(); /* eslint-disable-next-line */ }, [siteId, company]);

  async function clockIn() {
    if (!company || !siteId) return;
    setClockBusy(true); setErr('');
    try {
      await apiSend('POST', '/field-log/time-entries/clock-in', { buildingId: siteId, vendorCompanyId: company.id });
      toast('Clocked in.', 'success');
      await loadSiteData();
    } catch (e: any) {
      setErr(e.message ?? 'Could not clock in.');
    } finally {
      setClockBusy(false);
    }
  }

  async function clockOut() {
    if (!openEntry) return;
    setClockBusy(true); setErr('');
    try {
      await apiSend('PATCH', `/field-log/time-entries/${openEntry.id}/clock-out`, {});
      toast('Clocked out.', 'success');
      await loadSiteData();
    } catch (e: any) {
      setErr(e.message ?? 'Could not clock out.');
    } finally {
      setClockBusy(false);
    }
  }

  async function submitLog(e: React.FormEvent) {
    e.preventDefault();
    if (!company || !siteId || !workPerformed.trim()) return;
    setLogSubmitting(true); setErr('');
    try {
      await apiSend('POST', '/field-log/daily-logs', {
        buildingId: siteId,
        vendorCompanyId: company.id,
        workPerformed: workPerformed.trim(),
        crewCount: crewCount ? Number(crewCount) : undefined,
        weather: weather || undefined,
        delays: delays || undefined,
        logDate: todayLocalDate(),
      });
      toast('Daily log saved.', 'success');
      setWorkPerformed(''); setCrewCount(''); setWeather(''); setDelays(''); setShowLogForm(false);
      await loadSiteData();
    } catch (e: any) {
      setErr(e.message ?? 'Could not save the log.');
    } finally {
      setLogSubmitting(false);
    }
  }

  if (!company) return null;
  const isVendor = company.kind === 'vendor';

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Field Log</h1>
          <div className="sub">Clock in and log today's work at a job site where you hold an active award.</div>
        </div>
      </div>

      {!isVendor && <div className="note card">Field Log is a vendor feature - developers see progress photos and punch lists on each project instead.</div>}

      {isVendor && (
        <>
          {sitesLoading && <div className="note">Loading your sites…</div>}
          {!sitesLoading && sites.length === 0 && (
            <div className="card" style={{ textAlign: 'center', padding: 40 }}>
              <p className="note">No active job sites yet. This appears once a developer awards you a package.</p>
            </div>
          )}

          {!sitesLoading && sites.length > 0 && (
            <>
              {sites.length > 1 && (
                <div className="field" style={{ maxWidth: 340 }}>
                  <label>Job site</label>
                  <select value={siteId} onChange={(e) => setSiteId(e.target.value)}>
                    <option value="">Select a site…</option>
                    {sites.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}{s.location ? ` - ${s.location}` : ''}</option>
                    ))}
                  </select>
                </div>
              )}

              {err && <div className="err">{err}</div>}

              {siteId && (
                <>
                  <div className="card">
                    <h3 style={{ fontSize: 18, marginBottom: 10 }}>Time clock</h3>
                    {openEntry ? (
                      <>
                        <div className="note" style={{ marginBottom: 10 }}>
                          Clocked in since <strong>{fmtDateTime(openEntry.clock_in)}</strong> ({durationLabel(openEntry.clock_in, null)} so far)
                        </div>
                        <button className="btn primary" disabled={clockBusy} onClick={clockOut}>
                          {clockBusy ? 'Clocking out…' : 'Clock out'}
                        </button>
                      </>
                    ) : (
                      <button className="btn primary" disabled={clockBusy} onClick={clockIn}>
                        {clockBusy ? 'Clocking in…' : 'Clock in'}
                      </button>
                    )}
                  </div>

                  <div className="page-head" style={{ marginTop: 18 }}>
                    <div className="sectitle" style={{ margin: 0 }}>Daily logs</div>
                    <button className="btn" onClick={() => setShowLogForm(!showLogForm)}>
                      {showLogForm ? 'Cancel' : '+ Add today\'s log'}
                    </button>
                  </div>

                  {showLogForm && (
                    <div className="card">
                      <form onSubmit={submitLog}>
                        <div className="field">
                          <label>Work performed *</label>
                          <textarea value={workPerformed} onChange={(e) => setWorkPerformed(e.target.value)} rows={3} required placeholder="What did the crew do today?" />
                        </div>
                        <div className="two">
                          <div className="field">
                            <label>Crew count</label>
                            <input type="number" min="0" value={crewCount} onChange={(e) => setCrewCount(e.target.value)} placeholder="e.g. 6" />
                          </div>
                          <div className="field">
                            <label>Weather</label>
                            <input type="text" value={weather} onChange={(e) => setWeather(e.target.value)} placeholder="e.g. Clear, 68F" />
                          </div>
                        </div>
                        <div className="field">
                          <label>Delays / issues</label>
                          <input type="text" value={delays} onChange={(e) => setDelays(e.target.value)} placeholder="Optional" />
                        </div>
                        <button type="submit" className="btn primary" disabled={logSubmitting}>
                          {logSubmitting ? 'Saving…' : 'Save log'}
                        </button>
                      </form>
                    </div>
                  )}

                  {logsLoading && <div className="note">Loading…</div>}
                  {!logsLoading && logs.length === 0 && !showLogForm && (
                    <div className="note">No daily logs yet for this site.</div>
                  )}
                  {!logsLoading && logs.length > 0 && (
                    <div className="card" style={{ padding: 0, marginBottom: 18 }}>
                      <table>
                        <thead><tr><th>Date</th><th>Work performed</th><th>Crew</th><th>Weather</th><th>Delays</th></tr></thead>
                        <tbody>
                          {logs.map((l) => (
                            <tr key={l.id}>
                              <td>{fmtDate(l.log_date)}</td>
                              <td>{l.work_performed}</td>
                              <td>{l.crew_count ?? <span className="note">-</span>}</td>
                              <td>{l.weather ?? <span className="note">-</span>}</td>
                              <td>{l.delays ?? <span className="note">-</span>}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  <div className="sectitle">Time entries</div>
                  {!logsLoading && entries.length === 0 && <div className="note">No time entries yet for this site.</div>}
                  {!logsLoading && entries.length > 0 && (
                    <div className="card" style={{ padding: 0 }}>
                      <table>
                        <thead><tr><th>Clock in</th><th>Clock out</th><th>Duration</th><th>Notes</th></tr></thead>
                        <tbody>
                          {entries.map((t) => (
                            <tr key={t.id}>
                              <td>{fmtDateTime(t.clock_in)}</td>
                              <td>{t.clock_out ? fmtDateTime(t.clock_out) : <span className="badge b-amber">Open</span>}</td>
                              <td>{durationLabel(t.clock_in, t.clock_out)}</td>
                              <td>{t.notes ?? <span className="note">-</span>}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
