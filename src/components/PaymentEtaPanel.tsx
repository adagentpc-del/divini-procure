/**
 * PaymentEtaPanel - shows payment ETA summary and list for vendors.
 */
import { useEffect, useState } from 'react';

interface PaymentSummary {
  totalPendingCents: number;
  totalOverdueCents: number;
  nextPaymentDate: string | null;
  nextPaymentCents: number;
}

interface Payment {
  id: string;
  buildingName: string;
  packageName: string;
  amountCents: number;
  estimatedPaymentDate: string;
  paymentStatus: 'on_track' | 'due_soon' | 'overdue';
  daysUntilPayment: number;
}

const dollars = (c: number) =>
  (c / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

const STATUS_LABEL: Record<string, string> = {
  on_track: 'On Track',
  due_soon: 'Due Soon',
  overdue: 'Overdue',
};

const STATUS_STYLE: Record<string, React.CSSProperties> = {
  on_track: { background: '#dcfce7', color: '#15803d' },
  due_soon: { background: '#fef3c7', color: '#b45309' },
  overdue: { background: '#fee2e2', color: '#b91c1c' },
};

export default function PaymentEtaPanel() {
  const [summary, setSummary] = useState<PaymentSummary | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [showList, setShowList] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetch('/api/me/payment-summary').then(r => r.ok ? r.json() : null),
      fetch('/api/me/payment-status').then(r => r.ok ? r.json() : null),
    ]).then(([s, p]) => {
      if (s) setSummary(s);
      if (p) setPayments(p.payments ?? []);
    }).finally(() => setLoading(false));
  }, []);

  if (loading) return (
    <div style={{ padding: '1rem' }}>
      <p style={{ color: 'var(--ink)', opacity: 0.4, fontSize: '0.85rem' }}>Loading payment info...</p>
    </div>
  );

  if (!summary || payments.length === 0) {
    return (
      <div style={{ padding: '1rem', textAlign: 'center' }}>
        <p style={{ color: 'var(--ink)', opacity: 0.55, fontSize: '0.875rem', margin: 0 }}>
          No awarded bids yet. Payments will appear here once you've been awarded a contract.
        </p>
      </div>
    );
  }

  return (
    <div>
      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.75rem', marginBottom: '1rem' }}>
        {/* Pending */}
        <div
          style={{
            padding: '0.75rem',
            borderRadius: 10,
            border: `1px solid ${summary.totalPendingCents > 0 ? '#fcd34d' : 'var(--line, #e5e7eb)'}`,
            background: summary.totalPendingCents > 0 ? '#fffbeb' : '#fafafa',
          }}
        >
          <div style={{ fontSize: '0.7rem', color: 'var(--ink)', opacity: 0.55, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Pending</div>
          <div style={{ fontWeight: 700, fontSize: '1rem', color: summary.totalPendingCents > 0 ? '#b45309' : 'var(--ink)' }}>
            {dollars(summary.totalPendingCents)}
          </div>
        </div>
        {/* Overdue */}
        <div
          style={{
            padding: '0.75rem',
            borderRadius: 10,
            border: `1px solid ${summary.totalOverdueCents > 0 ? '#fca5a5' : 'var(--line, #e5e7eb)'}`,
            background: summary.totalOverdueCents > 0 ? '#fff5f5' : '#fafafa',
          }}
        >
          <div style={{ fontSize: '0.7rem', color: 'var(--ink)', opacity: 0.55, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Overdue</div>
          <div style={{ fontWeight: 700, fontSize: '1rem', color: summary.totalOverdueCents > 0 ? '#b91c1c' : 'var(--ink)' }}>
            {dollars(summary.totalOverdueCents)}
          </div>
        </div>
        {/* Next Payment */}
        <div
          style={{
            padding: '0.75rem',
            borderRadius: 10,
            border: '1px solid #bbf7d0',
            background: '#f0fdf4',
          }}
        >
          <div style={{ fontSize: '0.7rem', color: 'var(--ink)', opacity: 0.55, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Next</div>
          {summary.nextPaymentDate ? (
            <>
              <div style={{ fontWeight: 700, fontSize: '0.9rem', color: '#15803d' }}>{dollars(summary.nextPaymentCents)}</div>
              <div style={{ fontSize: '0.7rem', color: '#15803d', opacity: 0.8 }}>{fmtDate(summary.nextPaymentDate)}</div>
            </>
          ) : (
            <div style={{ fontWeight: 600, fontSize: '0.85rem', color: '#15803d' }}>—</div>
          )}
        </div>
      </div>

      {/* Toggle list */}
      <button
        onClick={() => setShowList(v => !v)}
        style={{
          background: 'none',
          border: '1px solid var(--line, #e5e7eb)',
          borderRadius: 8,
          padding: '0.4rem 0.9rem',
          cursor: 'pointer',
          fontSize: '0.8rem',
          color: 'var(--ink)',
          width: '100%',
          marginBottom: showList ? '0.75rem' : 0,
        }}
      >
        {showList ? 'Hide payments' : `View all payments (${payments.length})`}
      </button>

      {showList && (
        <div>
          {payments.map(p => (
            <div
              key={p.id}
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr auto auto auto',
                gap: '0.5rem',
                alignItems: 'center',
                padding: '0.6rem 0',
                borderBottom: '1px solid var(--line, #f3f4f6)',
                fontSize: '0.8rem',
              }}
            >
              <span style={{ color: 'var(--ink)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {p.buildingName}
              </span>
              <span style={{ color: 'var(--ink)', opacity: 0.65, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {p.packageName}
              </span>
              <span style={{ fontWeight: 600, color: 'var(--ink)' }}>{dollars(p.amountCents)}</span>
              <span style={{ color: 'var(--ink)', opacity: 0.55, whiteSpace: 'nowrap' }}>
                {fmtDate(p.estimatedPaymentDate)}
              </span>
              <span
                style={{
                  ...STATUS_STYLE[p.paymentStatus],
                  borderRadius: 6,
                  padding: '0.15rem 0.5rem',
                  fontSize: '0.72rem',
                  fontWeight: 600,
                  whiteSpace: 'nowrap',
                }}
              >
                {STATUS_LABEL[p.paymentStatus] ?? p.paymentStatus}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
