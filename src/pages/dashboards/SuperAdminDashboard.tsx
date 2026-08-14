import { ReactNode } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../lib/auth';

// Super-admin nav shell. Procure has no DashboardShell, so this is a simple
// sidebar in the same visual language as components/Shell.tsx (sidebar / nav /
// active anchor). Each item routes to a real admin surface. "Overview" keeps the
// existing AdminConsole reachable; "Features" keeps AdminFeatures reachable.
const NAV: [string, string, string][] = [
  ['/admin', 'Overview', '◆'],
  ['/admin/invites', 'Invites', '✉'],
  ['/admin/discount-codes', 'Discount Codes', '％'],
  ['/admin/referral-partners', 'Referral Partners', '↗'],
  ['/admin/relationships', 'Relationship Fees', '⚖'],
  ['/admin/agreements', 'Agreements', '✎'],
  ['/admin/campaigns', 'Email Campaigns', '✉'],
  ['/admin/investment', 'Capital', '◈'],
  ['/admin/investment-compliance', 'Inv. Compliance', '⚖'],
  ['/admin/subscriptions', 'Subscriptions', '◫'],
  ['/admin/fee-matrix', 'Fee Matrix', '％'],
  ['/admin/revenue', 'Revenue', '＄'],
  ['/admin/payouts', 'Payouts', '⇄'],
  ['/admin/split-terms', 'Split Terms', '⌥'],
  ['/admin/verification', 'Verification', '✔'],
  ['/admin/crm', 'CRM', '☎'],
  ['/admin/tasks', 'Tasks', '☑'],
  ['/admin/audit', 'Audit', '◷'],
  ['/admin/analytics', 'Analytics', '◔'],
  ['/admin/csv-import', 'CSV Import', '⇪'],
  ['/admin/features', 'Features', '✦'],
];

export default function SuperAdminDashboard({ children }: { children?: ReactNode }) {
  const { signOut } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <img src="/brand/mark-ivory.png" alt="Divini Procure" style={{ width: 34, height: 34, objectFit: 'contain' }} />
          <div>
            <div className="nm">Divini Procure</div>
            <div className="tg">Super Admin</div>
          </div>
        </div>
        <div className="nav-label">Administration</div>
        <nav className="nav">
          {NAV.map(([path, label, icon]) => (
            <Link key={path} to={path} className={loc.pathname === path ? 'active' : ''}>
              <span>{icon}</span> {label}
            </Link>
          ))}
        </nav>
        <div className="foot">
          <button onClick={signOut} style={{ background: 'none', border: 'none', font: 'inherit', color: 'inherit', cursor: 'pointer', padding: 0 }}>Sign out</button>
        </div>
      </aside>

      <div className="main">
        <div className="topbar">
          <div className="sp" />
          <div className="note">Platform Console</div>
        </div>
        <div className="mtop">
          <span className="nm">Divini Procure</span>
          <button onClick={signOut} style={{ background: 'none', border: 'none', font: 'inherit', color: '#fff', cursor: 'pointer', fontSize: 13, padding: 0 }}>Sign out</button>
        </div>
        <div className="content">{children}</div>
        <nav className="mbottom">
          {NAV.map(([path, label, icon]) => (
            <a key={path} className={loc.pathname === path ? 'active' : ''} onClick={() => nav(path)}>
              <span style={{ fontSize: 18 }}>{icon}</span>{label.split(' ')[0]}
            </a>
          ))}
        </nav>
      </div>
    </div>
  );
}
