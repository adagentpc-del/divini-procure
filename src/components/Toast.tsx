/**
 * Toast container — renders the active toasts from ToastProvider as a
 * visually positioned stack with dismiss buttons. Mount once inside Shell or App.
 *
 * Accessibility: the list is an ARIA live region (role="status" / role="alert")
 * so screen readers announce each message.
 */
import { useToast, type ToastKind } from '../lib/toast';

const ICONS: Record<ToastKind, string> = {
  success: '✓',
  error: '✕',
  info: 'i',
};

const COLORS: Record<ToastKind, { bg: string; border: string; icon: string }> = {
  success: { bg: '#f0fdf4', border: '#bbf7d0', icon: '#16a34a' },
  error:   { bg: '#fef2f2', border: '#fecaca', icon: '#dc2626' },
  info:    { bg: '#eff6ff', border: '#bfdbfe', icon: '#2563eb' },
};

export default function ToastContainer() {
  const { toasts, dismiss } = useToast();

  if (!toasts.length) return null;

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 24,
        right: 24,
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        maxWidth: 360,
        width: 'calc(100vw - 48px)',
      }}
      aria-label="Notifications"
    >
      {toasts.map((t) => {
        const c = COLORS[t.kind];
        return (
          <div
            key={t.id}
            role={t.kind === 'error' ? 'alert' : 'status'}
            aria-live={t.kind === 'error' ? 'assertive' : 'polite'}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 10,
              padding: '12px 14px',
              background: c.bg,
              border: `1px solid ${c.border}`,
              borderRadius: 8,
              boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
              fontSize: 14,
              lineHeight: 1.45,
              animation: 'toastIn 0.2s ease',
            }}
          >
            {/* Kind icon */}
            <span
              style={{
                flexShrink: 0,
                width: 20,
                height: 20,
                borderRadius: '50%',
                background: c.icon,
                color: '#fff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 11,
                fontWeight: 700,
                marginTop: 1,
              }}
              aria-hidden="true"
            >
              {ICONS[t.kind]}
            </span>
            {/* Message */}
            <span style={{ flex: 1, color: '#1a1a1a' }}>{t.message}</span>
            {/* Dismiss */}
            <button
              onClick={() => dismiss(t.id)}
              aria-label="Dismiss notification"
              style={{
                flexShrink: 0,
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: '#666',
                fontSize: 16,
                lineHeight: 1,
                padding: '0 2px',
                marginTop: -1,
              }}
            >
              ×
            </button>
          </div>
        );
      })}
      <style>{`
        @keyframes toastIn {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
