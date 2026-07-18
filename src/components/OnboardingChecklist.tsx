/**
 * OnboardingChecklist — role-specific "Complete your profile" banner shown
 * on the Dashboard after the initial onboarding flow completes.
 *
 * Steps are persisted in localStorage keyed by company ID so they survive
 * page refreshes. The banner auto-hides once all steps are checked off, and
 * can be manually dismissed at any time.
 *
 * Three role paths:
 *   buyer    — post a project, invite a teammate, explore vendors
 *   vendor   — complete profile, upload credentials, browse open RFQs, submit a bid
 *   investor — fill investor profile, browse active deals, add first watchlist item
 */
import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth';

// ---------------------------------------------------------------------------
// Step definitions per role
// ---------------------------------------------------------------------------
type Step = {
  id: string;
  label: string;
  detail: string;
  href?: string;
  cta: string;
};

const BUYER_STEPS: Step[] = [
  {
    id: 'post_project',
    label: 'Post your first project',
    detail: 'Describe what you need and get bids from qualified vendors.',
    href: '/app/packages/new',
    cta: 'Post a project',
  },
  {
    id: 'explore_vendors',
    label: 'Browse vendors',
    detail: 'Explore the vendor directory and shortlist who you want to bid.',
    href: '/app/vendors',
    cta: 'Explore vendors',
  },
  {
    id: 'invite_team',
    label: 'Invite a teammate',
    detail: 'Collaborate with colleagues on evaluations and awards.',
    href: '/app/settings/team',
    cta: 'Invite teammate',
  },
  {
    id: 'complete_profile',
    label: 'Complete your company profile',
    detail: 'A complete profile helps vendors understand your requirements.',
    href: '/app/settings/company',
    cta: 'Complete profile',
  },
];

const VENDOR_STEPS: Step[] = [
  {
    id: 'complete_profile',
    label: 'Complete your vendor profile',
    detail: 'Add your capabilities, service areas, and a short bio.',
    href: '/app/settings/company',
    cta: 'Complete profile',
  },
  {
    id: 'upload_credentials',
    label: 'Upload credentials & insurance',
    detail: 'Buyers look for licenses, certifications, and insurance docs.',
    href: '/app/settings/documents',
    cta: 'Upload documents',
  },
  {
    id: 'browse_rfqs',
    label: 'Browse open RFQs',
    detail: 'Find projects that match your specialties.',
    href: '/app/marketplace',
    cta: 'Browse RFQs',
  },
  {
    id: 'submit_bid',
    label: 'Submit your first bid',
    detail: 'Respond to an open RFQ to start winning work.',
    href: '/app/marketplace',
    cta: 'Submit a bid',
  },
];

const INVESTOR_STEPS: Step[] = [
  {
    id: 'investor_profile',
    label: 'Fill in your investor profile',
    detail: 'Tell deal originators what you look for in an investment.',
    href: '/app/settings/company',
    cta: 'Fill profile',
  },
  {
    id: 'browse_deals',
    label: 'Browse active deals',
    detail: 'Explore current deal flow on the platform.',
    href: '/app/deals',
    cta: 'Browse deals',
  },
  {
    id: 'add_watchlist',
    label: 'Add your first watchlist item',
    detail: 'Track deals and vendors that interest you.',
    href: '/app/watchlist',
    cta: 'Add to watchlist',
  },
];

function getSteps(kind: string | undefined): Step[] {
  if (kind === 'vendor') return VENDOR_STEPS;
  if (kind === 'investor') return INVESTOR_STEPS;
  return BUYER_STEPS;
}

// ---------------------------------------------------------------------------
// Persistence helpers
// ---------------------------------------------------------------------------
function storageKey(companyId: string) {
  return `divini_checklist_${companyId}`;
}

function loadChecked(companyId: string): Set<string> {
  try {
    const raw = localStorage.getItem(storageKey(companyId));
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as string[]);
  } catch {
    return new Set();
  }
}

function saveChecked(companyId: string, checked: Set<string>): void {
  try {
    localStorage.setItem(storageKey(companyId), JSON.stringify([...checked]));
  } catch { /* storage full — ignore */ }
}

function dismissedKey(companyId: string) {
  return `divini_checklist_dismissed_${companyId}`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function OnboardingChecklist() {
  const { company } = useAuth();
  const steps = getSteps(company?.kind);

  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [dismissed, setDismissed] = useState(false);
  const [open, setOpen] = useState(true); // collapsed vs expanded

  useEffect(() => {
    if (!company?.id) return;
    setChecked(loadChecked(company.id));
    setDismissed(localStorage.getItem(dismissedKey(company.id)) === '1');
  }, [company?.id]);

  const toggle = useCallback(
    (id: string) => {
      if (!company?.id) return;
      setChecked((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id); else next.add(id);
        saveChecked(company.id, next);
        return next;
      });
    },
    [company?.id],
  );

  const dismiss = useCallback(() => {
    if (!company?.id) return;
    try { localStorage.setItem(dismissedKey(company.id), '1'); } catch { /* */ }
    setDismissed(true);
  }, [company?.id]);

  if (!company?.id || dismissed) return null;

  const doneCount = steps.filter((s) => checked.has(s.id)).length;
  const allDone = doneCount === steps.length;

  // Auto-dismiss 2 s after all steps complete
  useEffect(() => {
    if (!allDone) return;
    const t = setTimeout(dismiss, 2000);
    return () => clearTimeout(t);
  }, [allDone, dismiss]);

  const roleLabel =
    company.kind === 'vendor' ? 'vendor'
    : company.kind === 'investor' ? 'investor'
    : 'buyer';

  return (
    <div
      style={{
        background: '#fff',
        border: '1px solid #e2e8f0',
        borderRadius: 12,
        marginBottom: 24,
        overflow: 'hidden',
        boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
      }}
      aria-label="Getting started checklist"
    >
      {/* Header row */}
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '14px 18px',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          textAlign: 'left',
        }}
        aria-expanded={open}
      >
        {/* Progress ring — simple SVG */}
        <ProgressRing done={doneCount} total={steps.length} />
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 15, color: '#0f172a' }}>
            {allDone ? '🎉 You\'re all set!' : `Get started as a ${roleLabel}`}
          </div>
          <div style={{ fontSize: 13, color: '#64748b', marginTop: 1 }}>
            {allDone
              ? 'Your profile is complete. This banner will close shortly.'
              : `${doneCount} of ${steps.length} steps complete`}
          </div>
        </div>
        {/* Progress bar */}
        <div
          style={{
            width: 80,
            height: 6,
            background: '#e2e8f0',
            borderRadius: 99,
            overflow: 'hidden',
            flexShrink: 0,
          }}
          aria-hidden="true"
        >
          <div
            style={{
              width: `${(doneCount / steps.length) * 100}%`,
              height: '100%',
              background: 'var(--emerald, #10b981)',
              borderRadius: 99,
              transition: 'width 0.3s ease',
            }}
          />
        </div>
        <span style={{ fontSize: 12, color: '#94a3b8', marginLeft: 4 }} aria-hidden="true">
          {open ? '▲' : '▼'}
        </span>
      </button>

      {/* Step list */}
      {open && (
        <div style={{ padding: '0 18px 16px' }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
              gap: 10,
            }}
          >
            {steps.map((step) => {
              const done = checked.has(step.id);
              return (
                <div
                  key={step.id}
                  style={{
                    border: `1px solid ${done ? '#bbf7d0' : '#e2e8f0'}`,
                    borderRadius: 8,
                    padding: '12px 14px',
                    background: done ? '#f0fdf4' : '#f8fafc',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                    transition: 'background 0.2s',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                    {/* Manual checkbox */}
                    <button
                      onClick={() => toggle(step.id)}
                      aria-label={done ? `Mark "${step.label}" as incomplete` : `Mark "${step.label}" as complete`}
                      aria-pressed={done}
                      style={{
                        flexShrink: 0,
                        width: 18,
                        height: 18,
                        borderRadius: 4,
                        border: `2px solid ${done ? '#16a34a' : '#cbd5e1'}`,
                        background: done ? '#16a34a' : '#fff',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        marginTop: 2,
                        transition: 'all 0.15s',
                        padding: 0,
                      }}
                    >
                      {done && (
                        <svg width="10" height="8" viewBox="0 0 10 8" fill="none" aria-hidden="true">
                          <path d="M1 4l2.5 2.5L9 1" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </button>
                    <span
                      style={{
                        fontWeight: 600,
                        fontSize: 13,
                        color: done ? '#16a34a' : '#0f172a',
                        textDecoration: done ? 'line-through' : 'none',
                      }}
                    >
                      {step.label}
                    </span>
                  </div>
                  <p style={{ fontSize: 12, color: '#64748b', margin: 0, paddingLeft: 26, lineHeight: 1.4 }}>
                    {step.detail}
                  </p>
                  {!done && step.href && (
                    <div style={{ paddingLeft: 26 }}>
                      <Link
                        to={step.href}
                        style={{
                          display: 'inline-block',
                          fontSize: 12,
                          fontWeight: 600,
                          color: 'var(--emerald, #10b981)',
                          textDecoration: 'none',
                          marginTop: 2,
                        }}
                      >
                        {step.cta} →
                      </Link>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {/* Dismiss link */}
          <div style={{ marginTop: 12, textAlign: 'right' }}>
            <button
              onClick={dismiss}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                fontSize: 12,
                color: '#94a3b8',
                textDecoration: 'underline',
              }}
            >
              Dismiss checklist
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tiny SVG progress ring
// ---------------------------------------------------------------------------
function ProgressRing({ done, total }: { done: number; total: number }) {
  const r = 14;
  const circ = 2 * Math.PI * r;
  const fill = total > 0 ? (done / total) * circ : 0;
  return (
    <svg width={34} height={34} viewBox="0 0 34 34" aria-hidden="true" style={{ flexShrink: 0 }}>
      <circle cx={17} cy={17} r={r} fill="none" stroke="#e2e8f0" strokeWidth={3} />
      <circle
        cx={17} cy={17} r={r}
        fill="none"
        stroke="var(--emerald, #10b981)"
        strokeWidth={3}
        strokeDasharray={`${fill} ${circ - fill}`}
        strokeLinecap="round"
        transform="rotate(-90 17 17)"
        style={{ transition: 'stroke-dasharray 0.3s ease' }}
      />
      <text x={17} y={21} textAnchor="middle" fontSize={10} fontWeight={700} fill="#0f172a">
        {done}/{total}
      </text>
    </svg>
  );
}
