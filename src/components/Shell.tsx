import { ReactNode } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { useFeatures } from '../lib/features';
import LanguageSwitcher from './LanguageSwitcher';
import ToastContainer from './Toast';
import { ToastProvider } from '../lib/toast';

type Item = [string, string, string]; // [path, label, icon]
type Section = { label: string; items: Item[] };

// ---------------------------------------------------------------------------
// Navigation definitions per role
// ---------------------------------------------------------------------------

// BUYER — collapsed from 35+ items into focused sections.
// "Quick Actions" surfaces the highest-value items first so a buyer can act
// without scrolling. Advanced / rarely-used tools live in later sections.
const BUYER_SECTIONS: Section[] = [
  { label: 'Quick Actions', items: [
    ['/app',      'Dashboard',        '▦'],
    ['/projects', 'Projects',         '▣'],
    ['/app/marketplace', 'Find Vendors', '⌕'],
    ['/award',    'Award & POs',      '◰'],
    ['/reports',  'Reports',          '▥'],
  ]},
  { label: 'Intelligence', items: [
    ['/coo',                'AI COO',           '✦'],
    ['/intel',              'Intelligence',     '✶'],
    ['/divini-scores',      'Divini Score',     '◈'],
    ['/war-room',           'War Room',         '⚑'],
    ['/relationship-graph', 'Relationship Map', '⊚'],
  ]},
  { label: 'Procurement', items: [
    ['/project-templates', 'Templates',         '▤'],
    ['/change-orders',     'Change Orders',     '⇄'],
    ['/products',          'Products',          '◳'],
    ['/vendor-pricing',    'Vendor Pricing',    '$'],
    ['/relationships',     'Vendor Relations',  '⚖'],
    ['/vendor-import',     'Import Vendors',    '⇪'],
    ['/samples',           'Samples',           '◌'],
  ]},
  { label: 'Project Finance', items: [
    ['/lender-portal',    'Lender Portal',   '⬙'],
    ['/retainage',        'Retainage',       '◑'],
    ['/coi-tracker',      'COI Tracker',     '◻'],
    ['/progress-photos',  'Progress Photos', '⊡'],
    ['/dispute-center',   'Disputes',        '⚖'],
  ]},
  { label: 'Project Roles', items: [
    ['/designer', 'Designer', '✑'],
    ['/gc',       'GC',       '⛏'],
  ]},
  { label: 'Investment', items: [
    ['/investment-profile',  'Investment Profile', '◇'],
    ['/investment-programs', 'Programs',           '◉'],
    ['/trust-profile',       'Trust Profile',      '✦'],
    ['/investor',            'Investor',           '⬡'],
    ['/my-introductions',    'Introductions',      '✦'],
    ['/investor-watchlist',  'Watchlist',          '◉'],
    ['/teasers',             'Teasers',            '◷'],
    ['/public-profile',      'Public Profile',     '◍'],
    ['/collateral',          'Collateral',         '◰'],
    ['/event-spaces',        'Event Spaces',       '◐'],
    ['/broker',              'Broker',             '⊞'],
  ]},
  { label: 'Account', items: [
    ['/agreements',       'Agreements',      '✎'],
    ['/subscription',     'Subscription',    '◫'],
    ['/payout-settings',  'Payout Settings', '＄'],
    ['/my-payouts',       'My Payouts',      '◫'],
    ['/messaging-policy', 'Messaging Policy','✉'],
    ['/profile',          'Company',         '⚙'],
  ]},
];

// VENDOR — focused on finding and winning work
const VENDOR_SECTIONS: Section[] = [
  { label: 'Workspace', items: [
    ['/app',     'Dashboard',  '▦'],
    ['/search',  'Search Bids','⌕'],
    ['/bids',    'My Bids',    '◧'],
    ['/my-invites','Invitations','✉'],
  ]},
  { label: 'Intelligence', items: [
    ['/coo',          'AI COO',      '✦'],
    ['/divini-scores','Divini Score','◈'],
    ['/war-room',     'War Room',    '⚑'],
  ]},
  { label: 'Profile & Catalog', items: [
    ['/products',            'Catalog',      '◳'],
    ['/vendor-pricing',      'Pricing',      '$'],
    ['/samples',             'Samples',      '◌'],
    ['/onboarding-templates','Onboarding',   '✓'],
    ['/relationships',       'Relationships','⚖'],
    ['/collateral',          'Collateral',   '◰'],
  ]},
  { label: 'Payments & Compliance', items: [
    ['/retainage',    'Retainage',   '◑'],
    ['/coi-tracker',  'Insurance (COI)','◻'],
    ['/dispute-center','Disputes',   '⚖'],
  ]},
  { label: 'Investment', items: [
    ['/investor',        'Investor',     '⬡'],
    ['/my-introductions','Introductions','✦'],
    ['/broker',          'Broker',       '⊞'],
  ]},
  { label: 'Account', items: [
    ['/agreements',      'Agreements',      '✎'],
    ['/subscription',    'Subscription',    '◫'],
    ['/payout-settings', 'Payout Settings', '＄'],
    ['/my-payouts',      'My Payouts',      '◫'],
    ['/messaging-policy','Messaging Policy','✉'],
    ['/profile',         'Profile',         '☺'],
  ]},
];

// INVESTOR — dedicated nav focused on deals, watchlists, and introductions
const INVESTOR_SECTIONS: Section[] = [
  { label: 'Workspace', items: [
    ['/app',              'Dashboard',    '▦'],
    ['/investor',         'Investor Hub', '⬡'],
    ['/investor-watchlist','Watchlist',   '◉'],
    ['/opportunities',    'Browse Deals', '◷'],
  ]},
  { label: 'Sourcing', items: [
    ['/my-introductions',    'Introductions',    '✦'],
    ['/investment-programs', 'Programs',         '◉'],
    ['/public-profile',      'Public Profile',   '◍'],
    ['/trust-profile',       'Trust Profile',    '✦'],
    ['/relationship-graph',  'Relationship Map', '⊚'],
  ]},
  { label: 'Intelligence', items: [
    ['/coo',          'AI COO',     '✦'],
    ['/intel',        'Intel',      '✶'],
    ['/divini-scores','Divini Score','◈'],
    ['/war-room',     'War Room',   '⚑'],
  ]},
  { label: 'Profile', items: [
    ['/investment-profile','Investment Profile','◇'],
    ['/collateral',        'Collateral',        '◰'],
    ['/event-spaces',      'Event Spaces',      '◐'],
    ['/broker',            'Broker',            '⊞'],
  ]},
  { label: 'Account', items: [
    ['/agreements',      'Agreements',      '✎'],
    ['/subscription',    'Subscription',    '◫'],
    ['/payout-settings', 'Payout Settings', '＄'],
    ['/my-payouts',      'My Payouts',      '◫'],
    ['/messaging-policy','Messaging Policy','✉'],
    ['/profile',         'Profile',         '⚙'],
  ]},
];

const SECTIONS: Record<string, Section[]> = {
  buyer:    BUYER_SECTIONS,
  vendor:   VENDOR_SECTIONS,
  investor: INVESTOR_SECTIONS,
};

// ---------------------------------------------------------------------------
// Mobile bottom bar — role-appropriate 5 items
// ---------------------------------------------------------------------------
const MOBILE: Record<string, Item[]> = {
  buyer: [
    ['/app',              'Home',     '▦'],
    ['/projects',         'Projects', '▣'],
    ['/app/marketplace',  'Vendors',  '⌕'],
    ['/award',            'Award',    '◰'],
    ['/profile',          'Account',  '⚙'],
  ],
  vendor: [
    ['/app',    'Home',    '▦'],
    ['/search', 'Search',  '⌕'],
    ['/bids',   'My Bids', '◧'],
    ['/my-invites','Invites','✉'],
    ['/profile','Account', '☺'],
  ],
  investor: [
    ['/app',               'Home',     '▦'],
    ['/investor',          'Hub',      '⬡'],
    ['/investor-watchlist','Watchlist','◉'],
    ['/opportunities',     'Deals',    '◷'],
    ['/profile',           'Account',  '⚙'],
  ],
};

// ---------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------
export default function Shell({ children }: { children: ReactNode }) {
  const { company, signOut } = useAuth();
  const { isAdmin } = useFeatures();
  const nav = useNavigate();
  const loc = useLocation();

  async function handleSignOut() {
    await signOut();
    nav('/login', { replace: true });
  }

  // Determine role — fall back to 'buyer' for undefined kinds
  const role: 'buyer' | 'vendor' | 'investor' =
    company?.kind === 'vendor' ? 'vendor'
    : company?.kind === 'investor' ? 'investor'
    : 'buyer';

  const sections: Section[] = [];
  if (isAdmin) {
    sections.push({ label: 'Admin', items: [
      ['/admin',          'Admin Console', '◆'],
      ['/admin/features', 'Features',      '✦'],
    ]});
  }
  if (company) sections.push(...SECTIONS[role]);

  const mobileItems: Item[] =
    company ? MOBILE[role] : (isAdmin ? [['/admin', 'Admin', '◆']] as Item[] : []);

  return (
    <ToastProvider>
      <div className="app">
        <aside className="sidebar">
          <div className="brand">
            <img
              src="/brand/mark-ivory.png"
              alt="Divini Procure"
              style={{ width: 34, height: 34, objectFit: 'contain' }}
            />
            <div>
              <div className="nm">Divini Procure</div>
              <div className="tg" style={{ textTransform: 'capitalize' }}>
                {role}
              </div>
            </div>
          </div>
          <nav className="nav">
            {sections.map((sec) => (
              <div key={sec.label}>
                <div className="nav-label">{sec.label}</div>
                {sec.items.map(([path, label, icon]) => (
                  <a
                    key={path}
                    href={path}
                    className={loc.pathname === path ? 'active' : ''}
                    onClick={(e) => { e.preventDefault(); nav(path); }}
                  >
                    <span>{icon}</span> {label}
                  </a>
                ))}
              </div>
            ))}
          </nav>
          <div className="foot">
            <a
              href="/login"
              onClick={(e) => { e.preventDefault(); handleSignOut(); }}
              style={{ cursor: 'pointer' }}
            >
              Sign out
            </a>
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
            <a
              href="/login"
              onClick={(e) => { e.preventDefault(); handleSignOut(); }}
              style={{ color: '#fff', cursor: 'pointer', fontSize: 13 }}
            >
              Sign out
            </a>
          </div>
          <div className="content">{children}</div>
          <nav className="mbottom">
            {mobileItems.map(([path, label, icon]) => (
              <a
                key={path}
                href={path}
                className={loc.pathname === path ? 'active' : ''}
                onClick={(e) => { e.preventDefault(); nav(path); }}
              >
                <span style={{ fontSize: 18 }}>{icon}</span>{label}
              </a>
            ))}
          </nav>
        </div>
      </div>

      {/* Global toast stack */}
      <ToastContainer />
    </ToastProvider>
  );
}
