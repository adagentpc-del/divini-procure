import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import NotFound from './pages/NotFound';
import { AuthProvider, useAuth } from './lib/auth';
import { FeaturesProvider, useFeatures } from './lib/features';
import Shell from './components/Shell';
import Login from './pages/Login';
import Register from './pages/Register';
import VerifyEmail from './pages/VerifyEmail';
import ForgotPassword from './pages/ForgotPassword';
import AuthCallback from './pages/AuthCallback';
import ResetPassword from './pages/ResetPassword';
import Privacy from './pages/Privacy';
import Terms from './pages/Terms';
import Pricing from './pages/Pricing';
import PaymentPolicy from './pages/PaymentPolicy';
import NonCircumvention from './pages/NonCircumvention';
import Cookies from './pages/Cookies';
import Accessibility from './pages/Accessibility';
import CookieBanner from './components/CookieBanner';
import TrustProfile from './pages/TrustProfile';
import RefLanding from './pages/RefLanding';
import Onboarding from './pages/Onboarding';
import Dashboard from './pages/Dashboard';
import SearchBids from './pages/SearchBids';
import MyBids from './pages/MyBids';
import Projects from './pages/Projects';
import Profile from './pages/Profile';
import BuildingDetail from './pages/BuildingDetail';
import PackageDetail from './pages/PackageDetail';
import AdminFeatures from './pages/AdminFeatures';
import AdminConsole from './pages/AdminConsole';
import AdminInvites from './pages/AdminInvites';
import AdminDiscountCodes from './pages/AdminDiscountCodes';
import AdminReferralPartners from './pages/AdminReferralPartners';
import AdminRevenue from './pages/AdminRevenue';
import SuperAdminDashboard from './pages/dashboards/SuperAdminDashboard';
import Landing from './pages/Landing';
import PublicOpportunities from './pages/PublicOpportunities';
import JoinInvite from './pages/JoinInvite';
import ReferralLanding from './pages/ReferralLanding';
import QuoteComparison from './pages/QuoteComparison';
import IntelDashboard from './pages/IntelDashboard';
import RfqAssist from './pages/RfqAssist';
import Submittals from './pages/Submittals';
import DeliveryTracking from './pages/DeliveryTracking';
import Relationships from './pages/Relationships';
import AdminRelationships from './pages/AdminRelationships';
import AdminAgreements from './pages/AdminAgreements';
import Agreements from './pages/Agreements';
import AdminCampaigns from './pages/AdminCampaigns';
import CooDashboard from './pages/CooDashboard';
import DiviniScores from './pages/DiviniScores';
import WarRoom from './pages/WarRoom';
import RelationshipGraph from './pages/RelationshipGraph';
import InvestmentProfile from './pages/InvestmentProfile';
import InvestmentPrograms from './pages/InvestmentPrograms';
import InvestorOnboarding from './pages/InvestorOnboarding';
import InvestorDashboard from './pages/InvestorDashboard';
import MyIntroductions from './pages/MyIntroductions';
import AdminInvestment from './pages/AdminInvestment';
import Subscription from './pages/Subscription';
import AdminSubscriptions from './pages/AdminSubscriptions';
import AdminFeeMatrix from './pages/AdminFeeMatrix';
import VendorPricing from './pages/VendorPricing';
import AwardWorkflow from './pages/AwardWorkflow';
import ChangeOrders from './pages/ChangeOrders';
import ProductCatalog from './pages/ProductCatalog';
import VendorImport from './pages/VendorImport';
import DesignerDashboard from './pages/DesignerDashboard';
import GcDashboard from './pages/GcDashboard';
import ProjectTemplates from './pages/ProjectTemplates';
import SampleRequests from './pages/SampleRequests';
import VendorOnboardingTemplates from './pages/VendorOnboardingTemplates';
import BrokerOnboarding from './pages/BrokerOnboarding';
import AdminInvestmentCompliance from './pages/AdminInvestmentCompliance';
import OpportunityTeasers from './pages/OpportunityTeasers';
import PublicDeveloperProfile from './pages/PublicDeveloperProfile';
import ProfileCollateral from './pages/ProfileCollateral';
import EventSpaces from './pages/EventSpaces';
import AdminCRM from './pages/AdminCRM';
import AdminTasks from './pages/AdminTasks';
import AdminAudit from './pages/AdminAudit';
import Reports from './pages/Reports';
import AdminAnalytics from './pages/AdminAnalytics';
import MessagingPolicy from './pages/MessagingPolicy';
import AdminCsvImport from './pages/AdminCsvImport';
import MyInvites from './pages/MyInvites';
import PayoutSettings from './pages/PayoutSettings';
import MyPayouts from './pages/MyPayouts';
import AdminPayouts from './pages/AdminPayouts';
import COITracker from './pages/COITracker';
import RetainageDashboard from './pages/RetainageDashboard';
import LenderPortal from './pages/LenderPortal';
import DrawRequestView from './pages/DrawRequestView';
import DisputeCenter from './pages/DisputeCenter';
import InvestorWatchlist from './pages/InvestorWatchlist';
import ProgressPhotos from './pages/ProgressPhotos';

function Gate({ children }: { children: JSX.Element }) {
  const { session, company, isAdmin, loading } = useAuth();
  if (loading) return <div className="center"><div className="note">Loading…</div></div>;
  if (!session) return <Navigate to="/login" replace />;
  if (!company) return <Navigate to={isAdmin ? '/admin' : '/onboarding'} replace />;
  return <Shell>{children}</Shell>;
}

// Super-admin gate: same auth check as the user Gate but wraps the page in the
// SuperAdminDashboard nav shell (Overview / Invites / Discount Codes / Referral
// Partners / Features).
function SuperAdminGate({ children }: { children: JSX.Element }) {
  const { session, loading } = useAuth();
  const { isAdmin } = useFeatures();
  if (loading) return <div className="center"><div className="note">Loading…</div></div>;
  if (!session) return <Navigate to="/login" replace />;
  if (!isAdmin) return <Navigate to="/app" replace />;
  return <SuperAdminDashboard>{children}</SuperAdminDashboard>;
}

function Routed() {
  const { session, company, isAdmin, loading } = useAuth();
  if (loading) return <div className="center"><div className="note">Loading…</div></div>;
  return (
    <Routes>
      <Route path="/login" element={session ? <Navigate to="/app" replace /> : <Login />} />
      <Route path="/register" element={session ? <Navigate to="/app" replace /> : <Register />} />
      <Route path="/verify-email" element={<VerifyEmail />} />
      <Route path="/forgot" element={session ? <Navigate to="/app" replace /> : <ForgotPassword />} />
      <Route path="/auth/callback" element={<AuthCallback />} />
      <Route path="/reset" element={<ResetPassword />} />
      <Route path="/privacy" element={<Privacy />} />
      <Route path="/terms" element={<Terms />} />
      <Route path="/pricing" element={<Pricing />} />
      <Route path="/payment-policy" element={<PaymentPolicy />} />
      <Route path="/non-circumvention" element={<NonCircumvention />} />
      <Route path="/cookies" element={<Cookies />} />
      <Route path="/accessibility" element={<Accessibility />} />
      <Route path="/onboarding" element={!session ? <Navigate to="/login" replace /> : company ? <Navigate to="/app" replace /> : isAdmin ? <Navigate to="/admin" replace /> : <Onboarding />} />
      <Route path="/" element={<Landing />} />
      <Route path="/opportunities" element={<PublicOpportunities />} />
      <Route path="/join/:code" element={<JoinInvite />} />
      <Route path="/r/:code" element={<ReferralLanding />} />
      <Route path="/ref/:code" element={<RefLanding />} />
      <Route path="/admin" element={<SuperAdminGate><AdminConsole /></SuperAdminGate>} />
      <Route path="/app" element={<Gate><Dashboard /></Gate>} />
      <Route path="/projects" element={<Gate><Projects /></Gate>} />
      <Route path="/building/:id" element={<Gate><BuildingDetail /></Gate>} />
      <Route path="/package/:id" element={<Gate><PackageDetail /></Gate>} />
      <Route path="/search" element={<Gate><SearchBids /></Gate>} />
      <Route path="/bids" element={<Gate><MyBids /></Gate>} />
      <Route path="/my-invites" element={<Gate><MyInvites /></Gate>} />
      <Route path="/payout-settings" element={<Gate><PayoutSettings /></Gate>} />
      <Route path="/my-payouts" element={<Gate><MyPayouts /></Gate>} />
      <Route path="/profile" element={<Gate><Profile /></Gate>} />
      <Route path="/relationships" element={<Gate><Relationships /></Gate>} />
      <Route path="/agreements" element={<Gate><Agreements /></Gate>} />
      <Route path="/coo" element={<Gate><CooDashboard /></Gate>} />
      <Route path="/divini-scores" element={<Gate><DiviniScores /></Gate>} />
      <Route path="/war-room" element={<Gate><WarRoom /></Gate>} />
      <Route path="/relationship-graph" element={<Gate><RelationshipGraph /></Gate>} />
      <Route path="/investment-profile" element={<Gate><InvestmentProfile /></Gate>} />
      <Route path="/investment-programs" element={<Gate><InvestmentPrograms /></Gate>} />
      <Route path="/investor-onboarding" element={<Gate><InvestorOnboarding /></Gate>} />
      <Route path="/trust-profile" element={<Gate><TrustProfile /></Gate>} />
      <Route path="/investor" element={<Gate><InvestorDashboard /></Gate>} />
      <Route path="/my-introductions" element={<Gate><MyIntroductions /></Gate>} />
      <Route path="/subscription" element={<Gate><Subscription /></Gate>} />
      <Route path="/vendor-pricing" element={<Gate><VendorPricing /></Gate>} />
      <Route path="/award" element={<Gate><AwardWorkflow /></Gate>} />
      <Route path="/change-orders" element={<Gate><ChangeOrders /></Gate>} />
      <Route path="/coi-tracker" element={<Gate><COITracker /></Gate>} />
      <Route path="/retainage" element={<Gate><RetainageDashboard /></Gate>} />
      <Route path="/lender-portal" element={<Gate><LenderPortal /></Gate>} />
      <Route path="/lender-view/:token" element={<DrawRequestView />} />
      <Route path="/dispute-center" element={<Gate><DisputeCenter /></Gate>} />
      <Route path="/investor-watchlist" element={<Gate><InvestorWatchlist /></Gate>} />
      <Route path="/progress-photos" element={<Gate><ProgressPhotos /></Gate>} />
      <Route path="/products" element={<Gate><ProductCatalog /></Gate>} />
      <Route path="/vendor-import" element={<Gate><VendorImport /></Gate>} />
      <Route path="/designer" element={<Gate><DesignerDashboard /></Gate>} />
      <Route path="/gc" element={<Gate><GcDashboard /></Gate>} />
      <Route path="/project-templates" element={<Gate><ProjectTemplates /></Gate>} />
      <Route path="/samples" element={<Gate><SampleRequests /></Gate>} />
      <Route path="/onboarding-templates" element={<Gate><VendorOnboardingTemplates /></Gate>} />
      <Route path="/broker" element={<Gate><BrokerOnboarding /></Gate>} />
      <Route path="/teasers" element={<Gate><OpportunityTeasers /></Gate>} />
      <Route path="/public-profile" element={<Gate><PublicDeveloperProfile /></Gate>} />
      <Route path="/collateral" element={<Gate><ProfileCollateral /></Gate>} />
      <Route path="/event-spaces" element={<Gate><EventSpaces /></Gate>} />
      <Route path="/reports" element={<Gate><Reports /></Gate>} />
      <Route path="/messaging-policy" element={<Gate><MessagingPolicy /></Gate>} />
      <Route path="/admin/features" element={<SuperAdminGate><AdminFeatures /></SuperAdminGate>} />
      <Route path="/admin/invites" element={<SuperAdminGate><AdminInvites /></SuperAdminGate>} />
      <Route path="/admin/discount-codes" element={<SuperAdminGate><AdminDiscountCodes /></SuperAdminGate>} />
      <Route path="/admin/referral-partners" element={<SuperAdminGate><AdminReferralPartners /></SuperAdminGate>} />
      <Route path="/admin/relationships" element={<SuperAdminGate><AdminRelationships /></SuperAdminGate>} />
      <Route path="/admin/agreements" element={<SuperAdminGate><AdminAgreements /></SuperAdminGate>} />
      <Route path="/admin/campaigns" element={<SuperAdminGate><AdminCampaigns /></SuperAdminGate>} />
      <Route path="/admin/investment" element={<SuperAdminGate><AdminInvestment /></SuperAdminGate>} />
      <Route path="/admin/subscriptions" element={<SuperAdminGate><AdminSubscriptions /></SuperAdminGate>} />
      <Route path="/admin/fee-matrix" element={<SuperAdminGate><AdminFeeMatrix /></SuperAdminGate>} />
      <Route path="/admin/revenue" element={<SuperAdminGate><AdminRevenue /></SuperAdminGate>} />
      <Route path="/admin/investment-compliance" element={<SuperAdminGate><AdminInvestmentCompliance /></SuperAdminGate>} />
      <Route path="/admin/crm" element={<SuperAdminGate><AdminCRM /></SuperAdminGate>} />
      <Route path="/admin/tasks" element={<SuperAdminGate><AdminTasks /></SuperAdminGate>} />
      <Route path="/admin/audit" element={<SuperAdminGate><AdminAudit /></SuperAdminGate>} />
      <Route path="/admin/analytics" element={<SuperAdminGate><AdminAnalytics /></SuperAdminGate>} />
      <Route path="/admin/csv-import" element={<SuperAdminGate><AdminCsvImport /></SuperAdminGate>} />
      <Route path="/admin/payouts" element={<SuperAdminGate><AdminPayouts /></SuperAdminGate>} />
      <Route path="/packages/:id/compare" element={<Gate><QuoteComparison /></Gate>} />
      <Route path="/intel" element={<Gate><IntelDashboard /></Gate>} />
      <Route path="/package/:id/intel" element={<Gate><IntelDashboard /></Gate>} />
      <Route path="/package/:id/rfq-assist" element={<Gate><RfqAssist /></Gate>} />
      <Route path="/package/:id/submittals" element={<Gate><Submittals /></Gate>} />
      <Route path="/package/:id/delivery" element={<Gate><DeliveryTracking /></Gate>} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

function SkipToContent() {
  return (
    <a
      className="skip-link"
      href="#main"
      onClick={(e) => {
        const m = document.querySelector('main');
        if (m) { e.preventDefault(); (m as HTMLElement).setAttribute('tabindex', '-1'); (m as HTMLElement).focus(); }
      }}
    >
      Skip to content
    </a>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <FeaturesProvider>
        <BrowserRouter>
          <SkipToContent />
          <Routed />
          <CookieBanner />
        </BrowserRouter>
      </FeaturesProvider>
    </AuthProvider>
  );
}
