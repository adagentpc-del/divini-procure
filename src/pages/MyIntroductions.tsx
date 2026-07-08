/**
 * MyIntroductions — investor's post-approval contact exchange page.
 * Lists all introduction requests, revealing sponsor contact info once approved.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiGet } from '../lib/api';
import ComplianceDisclaimer from '../components/ComplianceDisclaimer';

interface IntroProgram {
  id: string;
  name?: string;
  asset_class?: string;
  location?: string;
  program_type?: string;
  projected_return?: number;
  hold_period?: string;
  target_raise_cents?: number;
  min_investment_cents?: number;
}

interface IntroDeveloper {
  name?: string;
  contact_name?: string | null;
  contact_email?: string | null;
  contact_phone?: string | null;
  contact_revealed: boolean;
}

interface Introduction {
  id: string;
  status: string;
  pipeline_status?: string;
  created_at: string;
  updated_at: string;
  developer_notes?: string;
  program: IntroProgram;
  developer: IntroDeveloper;
}

const dollars = (c?: number) =>
  c == null ? '—' : (Number(c) / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

function statusBadge(status: string) {
  const map: Record<string, string> = {
    requested: 'b-neutral',
    approved: 'b-green',
    intro_made: 'b-green',
    declined: 'b-red',
    info_requested: 'b-amber',
    nda_required: 'b-amber',
  };
  const labels: Record<string, string> = {
    requested: 'Requested',
    approved: 'Approved',
    intro_made: 'Intro Made',
    declined: 'Declined',
    info_requested: 'Info Requested',
    nda_required: 'NDA Required',
  };
  return (
    <span className={`badge ${map[status] ?? 'b-neutral'}`}>
      {labels[status] ?? status}
    </span>
  );
}

export default function MyIntroductions() {
  const nav = useNavigate();
  const [intros, setIntros] = useState<Introduction[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    apiGet<{ introductions: Introduction[] }>('/investor/introductions')
      .then(r => setIntros(r.introductions ?? []))
      .catch((e: any) => setErr(e.message ?? 'Could not load introductions.'))
      .finally(() => setLoaded(true));
  }, []);

  return (
    <div style={{ maxWidth: 860, margin: '0 auto', padding: '2rem 1.5rem' }}>
      <div style={{ marginBottom: '2rem' }}>
        <h1 style={{ fontSize: '1.6rem', fontWeight: 700, color: 'var(--ink)', marginBottom: '0.4rem' }}>
          My Introductions
        </h1>
        <p style={{ color: 'var(--ink)', opacity: 0.6, margin: 0 }}>
          Track your introduction requests and connect with sponsors.
        </p>
      </div>

      {err && (
        <div className="badge b-red" style={{ marginBottom: '1.5rem', padding: '0.75rem 1rem', display: 'block' }}>
          {err}
        </div>
      )}

      {!loaded && (
        <p style={{ color: 'var(--ink)', opacity: 0.5 }}>Loading…</p>
      )}

      {loaded && intros.length === 0 && (
        <div className="card" style={{ textAlign: 'center', padding: '3rem 2rem' }}>
          <p style={{ color: 'var(--ink)', opacity: 0.6, marginBottom: '1.5rem' }}>
            You haven't requested any introductions yet.
          </p>
          <button className="btn" onClick={() => nav('/opportunities')}>
            Browse Opportunities
          </button>
        </div>
      )}

      {loaded && intros.map(intro => (
        <div
          key={intro.id}
          className="card"
          style={{ marginBottom: '1.25rem', padding: '1.5rem' }}
        >
          {/* Header row */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.75rem' }}>
            <div>
              <h2 style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--ink)', margin: '0 0 0.25rem' }}>
                {intro.program.name ?? 'Unnamed Program'}
              </h2>
              <span style={{ color: 'var(--ink)', opacity: 0.55, fontSize: '0.875rem' }}>
                {intro.developer.name ?? '—'}
              </span>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
              {intro.program.asset_class && (
                <span className="badge b-neutral">{intro.program.asset_class}</span>
              )}
              {statusBadge(intro.status)}
            </div>
          </div>

          {/* Program meta */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '0.5rem 1.5rem', marginBottom: '1rem', fontSize: '0.85rem', color: 'var(--ink)', opacity: 0.75 }}>
            {intro.program.location && <span>📍 {intro.program.location}</span>}
            {intro.program.target_raise_cents != null && <span>Target: {dollars(intro.program.target_raise_cents)}</span>}
            {intro.program.min_investment_cents != null && <span>Min: {dollars(intro.program.min_investment_cents)}</span>}
            {intro.program.projected_return != null && <span>Return: {intro.program.projected_return}%</span>}
            {intro.program.hold_period && <span>Hold: {intro.program.hold_period}</span>}
          </div>

          {/* Status-specific messaging */}
          {(intro.status === 'approved' || intro.status === 'intro_made') && intro.developer.contact_revealed && (
            <div style={{
              border: '1.5px solid var(--emerald)',
              background: 'color-mix(in srgb, var(--emerald) 8%, var(--ivory))',
              borderRadius: 8,
              padding: '1rem 1.25rem',
              marginBottom: '0.75rem',
            }}>
              <p style={{ fontWeight: 700, color: 'var(--emerald)', margin: '0 0 0.5rem', fontSize: '0.875rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Contact Information Revealed
              </p>
              {intro.developer.contact_name && (
                <p style={{ margin: '0.2rem 0', fontSize: '0.95rem', color: 'var(--ink)' }}>
                  <strong>Name:</strong> {intro.developer.contact_name}
                </p>
              )}
              {intro.developer.contact_email && (
                <p style={{ margin: '0.2rem 0', fontSize: '0.95rem', color: 'var(--ink)' }}>
                  <strong>Email:</strong>{' '}
                  <a href={`mailto:${intro.developer.contact_email}`} style={{ color: 'var(--emerald)' }}>
                    {intro.developer.contact_email}
                  </a>
                </p>
              )}
              {intro.developer.contact_phone && (
                <p style={{ margin: '0.2rem 0', fontSize: '0.95rem', color: 'var(--ink)' }}>
                  <strong>Phone:</strong> {intro.developer.contact_phone}
                </p>
              )}
              {!intro.developer.contact_name && !intro.developer.contact_email && !intro.developer.contact_phone && (
                <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--ink)', opacity: 0.6 }}>
                  Contact details not yet provided by the sponsor.
                </p>
              )}
            </div>
          )}

          {intro.status === 'requested' && (
            <p style={{ fontSize: '0.875rem', color: 'var(--ink)', opacity: 0.6, margin: '0 0 0.75rem' }}>
              Awaiting sponsor review.
            </p>
          )}

          {intro.status === 'info_requested' && (
            <p style={{ fontSize: '0.875rem', color: 'var(--amber)', margin: '0 0 0.75rem' }}>
              The sponsor has requested more information. Check your email.
            </p>
          )}

          {intro.status === 'nda_required' && (
            <div style={{ marginBottom: '0.75rem' }}>
              <p style={{ fontSize: '0.875rem', color: 'var(--amber)', margin: '0 0 0.5rem' }}>
                Please sign the NDA in your investor dashboard to proceed.
              </p>
              <button className="btn" style={{ fontSize: '0.85rem', padding: '0.4rem 1rem' }} onClick={() => nav('/investor')}>
                Go to Investor Dashboard
              </button>
            </div>
          )}

          {intro.status === 'declined' && (
            <div style={{ marginBottom: '0.75rem' }}>
              <p style={{ fontSize: '0.875rem', color: 'var(--ink)', opacity: 0.6, margin: '0 0 0.5rem' }}>
                This request was not approved.{' '}
                <span
                  style={{ cursor: 'pointer', textDecoration: 'underline', color: 'var(--ink)' }}
                  onClick={() => nav('/opportunities')}
                >
                  Browse other opportunities.
                </span>
              </p>
            </div>
          )}

          {intro.developer_notes && (
            <p style={{ fontSize: '0.85rem', color: 'var(--ink)', opacity: 0.65, marginBottom: '0.75rem', fontStyle: 'italic' }}>
              Note from sponsor: {intro.developer_notes}
            </p>
          )}

          {/* Footer */}
          <p style={{ fontSize: '0.8rem', color: 'var(--ink)', opacity: 0.45, margin: 0 }}>
            Requested {fmtDate(intro.created_at)}
            {intro.updated_at !== intro.created_at && ` · Updated ${fmtDate(intro.updated_at)}`}
          </p>
        </div>
      ))}

      <div style={{ marginTop: '2.5rem' }}>
        <ComplianceDisclaimer />
      </div>
    </div>
  );
}
