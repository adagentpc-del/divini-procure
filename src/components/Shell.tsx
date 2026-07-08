import { ReactNode } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { useFeatures } from '../lib/features';
import LanguageSwitcher from './LanguageSwitcher';

type Item = [string, string, string]; // [path, label, icon]
type Section = { label: string; items: Item[] };

// Grouped navigation. Each role gets labeled sections so the (large) feature
// set stays scannable instead of one long flat list.
const SECTIONS: Record<string, Section[]> = {
  buyer: [
    { label: 'Workspace', items: [
      ['/app', 'Dashboard', '▦'],
      ['/projects', 'Projects', '▣'],
      ['/reports', 'Reports', '▥'],
    ]},
    { label: 'Intelligence', items: [
      ['/coo', 'AI COO', '✦'],
      ['/intel', 'Intelligence', '✶'],
      ['/divini-scores', 'Divini Score', '◈'],
      ['/war-room', 'War Room', '⚑'],
      ['/relationship-graph', 'Relationship Graph', '⊚'],
    ]},
    { label: 'Procurement', items: [
      ['/project-templates', 'Project Templates', '▤'],
      ['/award', 'Award & POs', '◰'],
      ['/change-orders', 'Change Orders', '⇄'],
      ['/products', 'Products', '◳'],
      ['/vendor-pricing', 'Vendor Pricing', '$'],
      ['/relationships', 'Vendor Relationships', '⚖'],
      ['/vendor-import', 'Import Vendors', '⇪'],
      ['/samples', 'Samples', '◌'],
    ]},
    { label: 'Project Roles', items: [
      ['/designer', 'Designer', '✑'],
      ['/gc', 'GC', '⛏'],
    ]},
    { label: 'Investment', items: [
      ['/investment-profile', 'Investment Profile', '◇'],
      ['/investment-programs', 'Programs', '◉'],
      ['/trust-profile', 'Trust Profile', '✦'],
      ['/investor', 'Investor', '⬡'],
      ['/my-introductions', 'Introductions', '✦'],
      ['/teasers', 'Teasers', '◷'],
      ['/public-profile', 'Public Profile', '◍'],
      ['/collateral', 'Collateral', '◰'],
      ['/event-spaces', 'Event Spaces', '◐'],
      ['/broker', 'Broker', '⊞'],
    ]},
    { label: 'Account', items: [
      ['/agreements', 'Agreements', '✎'],
      ['/subscription', 'Subscription', '◫'],
      ['/payout-settings', 'Payout Settings', '＄'],
      ['/my-payouts', 'My Payouts', '◫'],
      ['/messaging-policy', 'Messaging Policy', '✉'],
      ['/profile', 'Company', '⚙'],
    ]},
  ],
  vendor: [
    { label: 'Workspace', items: [
      ['/app', 'Dashboard', '▦'],
      ['/search', 'Search Bids', '⌕'],
      ['/bids', 'My Bids', '◧'],
      ['/my-invites', 'Invitations', '✉'],
    ]},
    { label: 'Intelligence', items: [
      ['/coo', 'AI COO', '✦'],
      ['/divini-scores', 'Divini Score', '◈'],
      ['/war-room', 'War Room', '⚑'],
    ]},
    { label: 'Catalog & Vendor', items: [
      ['/products', 'Catalog', '◳'],
      ['/vendor-pricing', 'Pricing', '$'],
      ['/samples', 'Samples', '◌'],
      ['/onboarding-templates', 'Onboarding', '✓'],
      ['/relationships', 'Relationships', '⚖'],
      ['/collateral', 'Collateral', '◰'],
    ]},
    { label: 'Investment', items: [
      ['/investor', 'Investor', '⬡'],
      ['/my-introductions', 'Introductions', '✦'],
      ['/broker', 'Broker', '⊞'],
    ]},
    { label: 'Account', items: [
      ['/agreements', 'Agreements', '✎'],
      ['/subscription', 'Subscription', '◫'],
      ['/payout-settings', 'Payout Settings', '＄'],
      ['/my-payouts', 'My Payouts', '◫'],
      ['/messaging-policy', 'Messaging Policy', '✉'],
      ['/profile', 'Profile', '☺'],
    ]},
  ],
};

// Compact mobile bottom bar: a few key destinations only (the full set lives in
// the sidebar / is reachable on desktop).
const MOBILE: Record<string, Item[]> = {
  buyer: [
    ['/app', 'Home', '▦'],
    ['/projects', 'Projects', '▣'],
    ['/reports', 'Reports', '▥'],
    ['/investor', 'Investor', '⬡'],
    ['/profile', 'Account', '⚙'],
  ],
  vendor: [
    ['/app', 'Home', '▦'],
    ['/search', 'Search', '⌕'],
    ['/bids', 'Bids', '◧'],
    ['/investor', 'Investor', '⬡'],
    ['/profile', 'Account', '☺'],
  ],
};

export default function Shell({ children }: { children: ReactNode }) {
  const { company, signOut } = useAuth();
  const { isAdmin } = useFeatures();
  const nav = useNavigate();
  const loc = useLocation();
  const role = company?.kind === 'vendor' ? 'vendor' : 'buyer';

  const sections: Section[] = [];
  if (isAdmin) {
    sections.push({ label: 'Admin', items: [
      ['/admin', 'Admin Console', '◆'],
      ['/admin/features', 'Features', '✦'],
    ]});
  }
  if (company) sections.push(...SECTIONS[role]);

  const mobileItems: Item[] = company ? MOBILE[role] : (isAdmin ? [['/admin', 'Admin', '◆']] : []);

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <img src="/brand/mark-ivory.png" alt="Divini Procure" style={{ width: 34, height: 34, objectFit: 'contain' }} />
          <div>
            <div className="nm">Divini Procure</div>
            <div className="tg">Procurement</div>
          </div>
        </div>
        <nav className="nav">
          {sections.map((sec) => (
            <div key={sec.label}>
              <div className="nav-label">{sec.label}</div>
              {sec.items.map(([path, label, icon]) => (
                <a key={path} className={loc.pathname === path ? 'active' : ''} onClick={() => nav(path)}>
                  <span>{icon}</span> {label}
                </a>
              ))}
            </div>
          ))}
        </nav>
        <div className="foot">
          <a onClick={signOut} style={{ cursor: 'pointer' }}>Sign out</a>
        </div>
      </aside>

      <div className="main">
        <div className="topbar">
          <div className="sp" />
          <div className="note">{company?.name}</div>
          <LanguageSwitcher />
        </div>
        <div className="mtop">
          <span className="nm">Divini Procure</span>
          <a onClick={signOut} style={{ color: '#fff', cursor: 'pointer', fontSize: 13 }}>Sign out</a>
        </div>
        <div className="content">{children}</div>
        <nav className="mbottom">
          {mobileItems.map(([path, label, icon]) => (
            <a key={path} className={loc.pathname === path ? 'active' : ''} onClick={() => nav(path)}>
              <span style={{ fontSize: 18 }}>{icon}</span>{label}
            </a>
          ))}
        </nav>
      </div>
    </div>
  );
}
