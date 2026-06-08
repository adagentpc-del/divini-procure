import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/auth';
import { FeaturesProvider, useFeatures } from './lib/features';
import Shell from './components/Shell';
import Login from './pages/Login';
import Onboarding from './pages/Onboarding';
import Dashboard from './pages/Dashboard';
import SearchBids from './pages/SearchBids';
import MyBids from './pages/MyBids';
import Projects from './pages/Projects';
import Profile from './pages/Profile';
import BuildingDetail from './pages/BuildingDetail';
import PackageDetail from './pages/PackageDetail';
import AdminFeatures from './pages/AdminFeatures';

function Gate({ children }: { children: JSX.Element }) {
  const { session, company, loading } = useAuth();
  if (loading) return <div className="center"><div className="note">Loading…</div></div>;
  if (!session) return <Navigate to="/login" replace />;
  if (!company) return <Navigate to="/onboarding" replace />;
  return <Shell>{children}</Shell>;
}

function AdminGate({ children }: { children: JSX.Element }) {
  const { session, loading } = useAuth();
  const { isAdmin } = useFeatures();
  if (loading) return <div className="center"><div className="note">Loading…</div></div>;
  if (!session) return <Navigate to="/login" replace />;
  if (!isAdmin) return <Navigate to="/" replace />;
  return <Shell>{children}</Shell>;
}

function Routed() {
  const { session, company, loading } = useAuth();
  if (loading) return <div className="center"><div className="note">Loading…</div></div>;
  return (
    <Routes>
      <Route path="/login" element={session ? <Navigate to="/" replace /> : <Login />} />
      <Route path="/onboarding" element={!session ? <Navigate to="/login" replace /> : company ? <Navigate to="/" replace /> : <Onboarding />} />
      <Route path="/" element={<Gate><Dashboard /></Gate>} />
      <Route path="/projects" element={<Gate><Projects /></Gate>} />
      <Route path="/building/:id" element={<Gate><BuildingDetail /></Gate>} />
      <Route path="/package/:id" element={<Gate><PackageDetail /></Gate>} />
      <Route path="/search" element={<Gate><SearchBids /></Gate>} />
      <Route path="/bids" element={<Gate><MyBids /></Gate>} />
      <Route path="/profile" element={<Gate><Profile /></Gate>} />
      <Route path="/admin/features" element={<AdminGate><AdminFeatures /></AdminGate>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <FeaturesProvider>
        <BrowserRouter>
          <Routed />
        </BrowserRouter>
      </FeaturesProvider>
    </AuthProvider>
  );
}
