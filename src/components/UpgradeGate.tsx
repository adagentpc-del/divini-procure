/**
 * Reusable "this feature is locked on your current plan" wrapper. Renders
 * children normally when unlocked; when locked, dims/blurs the content
 * behind an overlay with a lock icon, a short reason, and an Upgrade
 * button to /subscription - the "teaser" pattern requested for gated
 * features, always driven by the caller's real entitlement check
 * (never a fabricated "you're missing out" claim about content that
 * doesn't exist).
 */
import { useNavigate } from 'react-router-dom';

export function UpgradeGate({
  locked,
  featureName,
  requiredTierName,
  reason,
  children,
  compact,
}: {
  locked: boolean;
  featureName: string;
  requiredTierName?: string;
  reason?: string;
  children: React.ReactNode;
  compact?: boolean;
}) {
  const nav = useNavigate();
  if (!locked) return <>{children}</>;

  return (
    <div style={{ position: 'relative' }}>
      <div
        aria-hidden
        style={{
          filter: 'blur(3px)',
          opacity: 0.45,
          pointerEvents: 'none',
          userSelect: 'none',
        }}
      >
        {children}
      </div>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: compact ? 6 : 10,
          padding: compact ? 8 : 16,
          textAlign: 'center',
        }}
      >
        <span style={{ fontSize: compact ? 18 : 26 }}>🔒</span>
        <div style={{ fontSize: compact ? 12 : 14, fontWeight: 600 }}>
          {featureName}{requiredTierName ? ` is on ${requiredTierName}` : ' is locked on your plan'}
        </div>
        {reason && !compact && <div className="note" style={{ fontSize: 12, maxWidth: 280 }}>{reason}</div>}
        <button
          className="btn primary"
          style={compact ? { padding: '4px 10px', fontSize: 12 } : undefined}
          onClick={() => nav('/subscription')}
        >
          Upgrade to unlock
        </button>
      </div>
    </div>
  );
}

/** A small inline badge for teasing a locked feature next to a label (nav item, section header) without wrapping full content - e.g. `<span>Reporting <LockedBadge /></span>`. */
export function LockedBadge({ label = 'Upgrade' }: { label?: string }) {
  const nav = useNavigate();
  return (
    <span
      className="badge b-neutral"
      style={{ cursor: 'pointer', marginLeft: 6 }}
      onClick={(e) => { e.stopPropagation(); nav('/subscription'); }}
      title="This feature requires a higher plan"
    >
      🔒 {label}
    </span>
  );
}
