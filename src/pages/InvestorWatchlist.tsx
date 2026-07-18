/**
 * Investor Watchlist - Deal Alerts page
 */
import { useEffect, useState } from 'react';
import { apiGet, apiSend } from '../lib/api';
import { useToast } from '../lib/toast';

interface WatchlistItem {
  id: string;
  label: string | null;
  asset_class: string | null;
  location: string | null;
  min_target_return: number | null;
  max_min_investment_cents: number | null;
  investor_type: string | null;
  notify_email: boolean;
  created_at: string;
}

interface MatchedDeal {
  id: string;
  name: string;
  developerName: string | null;
  assetClass: string | null;
  location: string | null;
  preferredReturn: number | null;
  minimumInvestmentCents: number | null;
}

const dollars = (c: number | null) =>
  c == null ? '—' : (c / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

const ASSET_CLASSES = ['multifamily', 'office', 'retail', 'industrial', 'mixed-use', 'other'];

export default function InvestorWatchlist() {
  const { toast } = useToast();
  const [items, setItems] = useState<WatchlistItem[]>([]);
  const [matches, setMatches] = useState<MatchedDeal[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    label: '',
    assetClass: '',
    location: '',
    minTargetReturn: '',
    maxMinInvestmentDollars: '',
    notifyEmail: true,
  });

  const load = async () => {
    setLoading(true);
    setLoadErr('');
    try {
      const [wData, mData] = await Promise.all([
        apiGet<{ items: WatchlistItem[] }>('/watchlist'),
        apiGet<{ matches: MatchedDeal[] }>('/watchlist/matches'),
      ]);
      setItems(wData.items ?? []);
      setMatches(mData.matches ?? []);
    } catch (e: any) {
      const msg = e?.message ?? 'Could not load watchlist. Please try again.';
      setLoadErr(msg);
      toast(msg, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleDelete = async (id: string) => {
    try {
      await apiSend('DELETE', `/watchlist/${id}`);
      setItems(prev => prev.filter(i => i.id !== id));
      toast('Alert removed.', 'success');
    } catch (e: any) {
      toast(e?.message ?? 'Could not remove alert.', 'error');
    }
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const body: Record<string, unknown> = { notifyEmail: form.notifyEmail };
      if (form.label) body.label = form.label;
      if (form.assetClass) body.assetClass = form.assetClass;
      if (form.location) body.location = form.location;
      if (form.minTargetReturn) body.minTargetReturn = Number(form.minTargetReturn);
      if (form.maxMinInvestmentDollars) body.maxMinInvestmentCents = Math.round(Number(form.maxMinInvestmentDollars) * 100);

      const d = await apiSend<{ item: WatchlistItem }>('POST', '/watchlist', body);
      setItems(prev => [d.item, ...prev]);
      setForm({ label: '', assetClass: '', location: '', minTargetReturn: '', maxMinInvestmentDollars: '', notifyEmail: true });
      setShowForm(false);
      toast('Alert saved. You\'ll be notified when matching deals are listed.', 'success');
      load(); // refresh matches
    } catch (e: any) {
      toast(e?.message ?? 'Could not save alert. Please try again.', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '2rem 1.5rem' }}>
      <div style={{ marginBottom: '2rem' }}>
        <h1 style={{ fontSize: '1.6rem', fontWeight: 700, color: 'var(--ink)', marginBottom: '0.4rem' }}>
          Deal Watchlist 🔔
        </h1>
        <p style={{ color: 'var(--ink)', opacity: 0.6, margin: 0 }}>
          Save your investment criteria and get notified when matching deals are listed.
        </p>
      </div>

      {/* Your Alerts section */}
      <section style={{ marginBottom: '2.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h2 style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--ink)', margin: 0 }}>Your Alerts</h2>
          <button className="btn" onClick={() => setShowForm(v => !v)}>
            {showForm ? 'Cancel' : '+ Add Alert'}
          </button>
        </div>

        {showForm && (
          <form className="card" onSubmit={handleAdd} style={{ padding: '1.5rem', marginBottom: '1rem' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '1rem', marginBottom: '1rem' }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.875rem', color: 'var(--ink)' }}>
                Label
                <input
                  className="input"
                  type="text"
                  placeholder="e.g. Sunbelt Multifamily"
                  value={form.label}
                  onChange={e => setForm(f => ({ ...f, label: e.target.value }))}
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.875rem', color: 'var(--ink)' }}>
                Asset Class
                <select
                  className="input"
                  value={form.assetClass}
                  onChange={e => setForm(f => ({ ...f, assetClass: e.target.value }))}
                >
                  <option value="">Any</option>
                  {ASSET_CLASSES.map(ac => (
                    <option key={ac} value={ac} style={{ textTransform: 'capitalize' }}>{ac}</option>
                  ))}
                </select>
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.875rem', color: 'var(--ink)' }}>
                Location
                <input
                  className="input"
                  type="text"
                  placeholder="City or state..."
                  value={form.location}
                  onChange={e => setForm(f => ({ ...f, location: e.target.value }))}
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.875rem', color: 'var(--ink)' }}>
                Min Target Return (%)
                <input
                  className="input"
                  type="number"
                  placeholder="e.g. 8"
                  min={0}
                  step={0.1}
                  value={form.minTargetReturn}
                  onChange={e => setForm(f => ({ ...f, minTargetReturn: e.target.value }))}
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.875rem', color: 'var(--ink)' }}>
                Max Min Investment ($)
                <input
                  className="input"
                  type="number"
                  placeholder="e.g. 50000"
                  min={0}
                  value={form.maxMinInvestmentDollars}
                  onChange={e => setForm(f => ({ ...f, maxMinInvestmentDollars: e.target.value }))}
                />
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.875rem', color: 'var(--ink)', paddingTop: 20 }}>
                <input
                  type="checkbox"
                  checked={form.notifyEmail}
                  onChange={e => setForm(f => ({ ...f, notifyEmail: e.target.checked }))}
                />
                Email Notifications
              </label>
            </div>
            <button className="btn primary" type="submit" disabled={saving}>
              {saving ? 'Saving...' : 'Save Alert'}
            </button>
          </form>
        )}

        {loading && <p style={{ color: 'var(--ink)', opacity: 0.5 }}>Loading...</p>}

        {loadErr && !loading && (
          <div className="err" style={{ marginBottom: '1rem' }}>{loadErr}</div>
        )}

        {!loading && items.length === 0 && !showForm && !loadErr && (
          <div className="card" style={{ textAlign: 'center', padding: '2.5rem' }}>
            <p style={{ color: 'var(--ink)', opacity: 0.6 }}>
              Set up your first alert to get notified when matching deals are listed.
            </p>
          </div>
        )}

        {items.map(item => (
          <div key={item.id} className="card" style={{ padding: '1.25rem', marginBottom: '0.75rem', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              {item.label && (
                <p style={{ fontWeight: 700, color: 'var(--ink)', margin: '0 0 0.4rem' }}>{item.label}</p>
              )}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', fontSize: '0.85rem', color: 'var(--ink)', opacity: 0.7 }}>
                {item.asset_class && <span className="badge b-neutral" style={{ textTransform: 'capitalize' }}>{item.asset_class}</span>}
                {item.location && <span>📍 {item.location}</span>}
                {item.min_target_return != null && <span>Min return: {item.min_target_return}%</span>}
                {item.max_min_investment_cents != null && <span>Max min investment: {dollars(item.max_min_investment_cents)}</span>}
                {item.notify_email && <span>🔔 Email on</span>}
              </div>
            </div>
            <button
              onClick={() => handleDelete(item.id)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink)', opacity: 0.4, fontSize: '1.1rem', padding: '0.25rem', lineHeight: 1 }}
              title="Delete alert"
              aria-label="Delete alert"
            >
              ×
            </button>
          </div>
        ))}
      </section>

      {/* Matching Deals section */}
      <section>
        <h2 style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--ink)', marginBottom: '1rem' }}>
          Matching Deals
        </h2>

        {matches.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', padding: '2.5rem' }}>
            <p style={{ color: 'var(--ink)', opacity: 0.6 }}>
              No matching deals right now. We'll notify you when new deals match your criteria.
            </p>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1rem' }}>
            {matches.map(deal => (
              <div key={deal.id} className="card" style={{ padding: '1.25rem' }}>
                <p style={{ fontWeight: 700, color: 'var(--ink)', margin: '0 0 0.25rem', fontSize: '1rem' }}>{deal.name}</p>
                {deal.developerName && <p style={{ color: 'var(--ink)', opacity: 0.55, fontSize: '0.85rem', margin: '0 0 0.75rem' }}>{deal.developerName}</p>}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginBottom: '0.75rem' }}>
                  {deal.assetClass && <span className="badge b-neutral" style={{ textTransform: 'capitalize' }}>{deal.assetClass}</span>}
                  {deal.location && <span className="badge b-neutral">{deal.location}</span>}
                </div>
                <div style={{ fontSize: '0.85rem', color: 'var(--ink)', opacity: 0.75, marginBottom: '0.75rem' }}>
                  {deal.preferredReturn != null && <div>Preferred return: {deal.preferredReturn}%</div>}
                  {deal.minimumInvestmentCents != null && <div>Min investment: {dollars(deal.minimumInvestmentCents)}</div>}
                </div>
                <a
                  href={`/opportunities?assetClass=${encodeURIComponent(deal.assetClass ?? '')}`}
                  className="btn"
                  style={{ display: 'block', textAlign: 'center', fontSize: '0.85rem', padding: '0.5rem', borderRadius: 8, textDecoration: 'none' }}
                >
                  View Deal
                </a>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
