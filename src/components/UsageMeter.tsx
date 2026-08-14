/**
 * Reusable usage-vs-limit bar, extracted from the inline pattern that used
 * to live only in Subscription.tsx so it can also appear on the dashboard
 * and inside feature areas as a lightweight "here's where you stand"
 * reminder - always built from the real per-key LimitCheck the entitlements
 * engine returns (GET /subscriptions/mine), never a fabricated number.
 */
import type { LimitCheck } from '../lib/tiers';
import { limitText } from '../lib/tiers';

export function UsageMeter({ label, check }: { label: string; check: LimitCheck }) {
  const unlimited = check.limit === null;
  const pct = unlimited || check.limit === 0
    ? (check.used > 0 ? 100 : 0)
    : Math.min(100, Math.round((check.used / (check.limit || 1)) * 100));
  const over = !check.allowed;
  const nearLimit = !unlimited && !over && check.limit! > 0 && check.used / check.limit! >= 0.8;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
        <strong>{label}</strong>
        <span className="note">
          {check.used} / {limitText(check.limit)}
          {!unlimited && (
            <span className={`badge ${over ? 'b-red' : nearLimit ? 'b-amber' : 'b-green'}`} style={{ marginLeft: 8 }}>
              {over ? 'At limit' : `${check.remaining} left`}
            </span>
          )}
        </span>
      </div>
      <div style={{ height: 8, borderRadius: 6, background: 'rgba(255,255,255,0.08)', overflow: 'hidden', marginTop: 4 }}>
        <div
          style={{
            width: `${unlimited ? 0 : pct}%`,
            height: '100%',
            background: over ? '#c0504d' : nearLimit ? '#c99a3a' : 'var(--accent, #b8924a)',
          }}
        />
      </div>
    </div>
  );
}

/** Renders every metered limit present on `limits`, in LIMIT_LABELS order, skipping keys the current plan doesn't meter at all. */
export function UsageMeterList({ limits, labels, order }: { limits: Record<string, LimitCheck>; labels: Record<string, string>; order: string[] }) {
  const keys = order.filter((k) => limits[k]);
  if (keys.length === 0) return <div className="note">No metered limits on this plan.</div>;
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      {keys.map((k) => <UsageMeter key={k} label={labels[k]} check={limits[k]} />)}
    </div>
  );
}
