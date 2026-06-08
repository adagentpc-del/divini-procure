import { ReactNode } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { useFeatures } from '../lib/features';

const NAV: Record<string, [string, string, string][]> = {
  buyer: [
    ['/app', 'Dashboard', '▦'],
    ['/projects', 'Projects', '▣'],
    ['/profile', 'Company', '⚙'],
  ],
  vendor: [
    ['/app', 'Dashboard', '▦'],
    ['/search', 'Search Bids', '⌕'],
    ['/bids', 'My Bids', '◧'],
    ['/profile', 'Profile', '☺'],
  ],
};

export default function Shell({ children }: { children: ReactNode }) {
  const { company, signOut } = useAuth();
  const { isAdmin } = useFeatures();
  const nav = useNavigate();
  const loc = useLocation();
  const role = company?.kind ?? 'buyer';
  const items: [string, string, string][] = [...NAV[role]];
  if (isAdmin) items.push(['/admin/features', 'Features', '✦']);

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
        <div className="nav-label">{role === 'vendor' ? 'Vendor' : 'Buyer Workspace'}</div>
        <nav className="nav">
          {items.map(([path, label, icon]) => (
            <a key={path} className={loc.pathname === path ? 'active' : ''} onClick={() => nav(path)}>
              <span>{icon}</span> {label}
            </a>
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
        </div>
        <div className="mtop">
          <span className="nm">Divini Procure</span>
          <a onClick={signOut} style={{ color: '#fff', cursor: 'pointer', fontSize: 13 }}>Sign out</a>
        </div>
        <div className="content">{children}</div>
        <nav className="mbottom">
          {items.map(([path, label, icon]) => (
            <a key={path} className={loc.pathname === path ? 'active' : ''} onClick={() => nav(path)}>
              <span style={{ fontSize: 18 }}>{icon}</span>{label.split(' ')[0]}
            </a>
          ))}
        </nav>
      </div>
    </div>
  );
}
