import React, { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import NotFound from './pages/NotFound';
import { AuthProvider, useAuth } from './lib/auth';
import { FeaturesProvider, useFeatures } from './lib/features';
import Shell from './components/Shell';
import CookieBanner from './components/CookieBanner';
import SuperAdminDashboard from './pages/dashboards/SuperAdminDashboard';

const Login = lazy(() => import('./pages/Login'));
const Register = lazy(() => import('./pages/Register'));
const VerifyEmail = lazy(() => import('./pages/VerifyEmail'));
const ForgotPassword = lazy(() => import('./pages/ForgotPassword'));
const AuthCallback = lazy(() => import('./pages/AuthCallback'));
const ResetPassword = lazy(() => import('./pages/ResetPassword'));
const Privacy = lazy(() => import('./pages/Privacy'));
const Terms = lazy(() => import('./pages/Terms'));
const Pricing = lazy(() => import('./pages/Pricing'));
const PaymentPolicy = lazy(() => import('./pages/PaymentPolicy'));
const NonCircumvention = lazy(() => import('./pages/NonCircumvention'));
const Cookies = lazy(() => import('./pages/Cookies'));
const Accessibility = lazy(() => import('./pages/Accessibility'));
const TrustProfile = lazy(() => import('./pages/TrustProfile'));
const RefLanding = lazy(() => import('./pages/RefLanding'));
const Onboarding = lazy(() => import('./pages/Onboarding'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const SearchBids = lazy(() => import('./pages/SearchBids'));
const MyBids = lazy(() => import('./pages/MyBids'));
const Projects = lazy(() => import('./pages/Projects'));
const Profile = lazy(() => import('./pages/Profile'));
const BuildingDetail = lazy(() => import('./pages/BuildingDetail'));
const PackageDetail = lazy(() => import('./pages/PackageDetail'));
const AdminFeatures = lazy(() => import('./pages/AdminFeatures'));
const AdminConsole = lazy(() => import('./pages/AdminConsole'));
const AdminInvites = lazy(() => import('./pages/AdminInvites'));
const AdminDiscountCodes = lazy(() => import('./pages/AdminDiscountCodes'));
const AdminReferralPartners = lazy(() => import('./pages/AdminReferralPartners'));
const AdminRevenue = lazy(() => import('./pages/AdminRevenue'));
const Landing = lazy(() => import('./pages/Landing'));
const PublicOpportunities = lazy(() => import('./pages/PublicOpportunities'));
const JoinInvite = lazy(() => import('./pages/JoinInvite'));
const ReferralLanding = lazy(() => import('./pages/ReferralLanding'));
const QuoteComparison = lazy(() => import('./pages/QuoteComparison'));
const IntelDashboard = lazy(() => import('./pages/IntelDashboard'));
const RfqAssist = lazy(() => import('./pages/RfqAssist'));
const Submittals = lazy(() => import('./pages/Submittals'));
const DeliveryTracking = lazy(() => import('./pages/DeliveryTracking'));
const Relationships = lazy(() => import('./pages/Relationships'));
const AdminRelationships = lazy(() => import('./pages/AdminRelationships'));
const AdminAgreements = lazy(() => import('./pages/AdminAgreements'));
const Agreements = lazy(() => import('./pages/Agreements'));
const AdminCampaigns = lazy(() => import('./pages/AdminCampaigns'));
const CooDashboard = lazy(() => import('./pages/CooDashboard'));
const DiviniScores = lazy(() => import('./pages/DiviniScores'));
const WarRoom = lazy(() => import('./pages/WarRoom'));
const RelationshipGraph = lazy(() => import('./pages/RelationshipGraph'));
const InvestmentProfile = lazy(() => import('./pages/InvestmentProfile'));
const InvestmentPrograms = lazy(() => import('./pages/InvestmentPrograms'));
const InvestorOnboarding = lazy(() => import('./pages/InvestorOnboarding'));
const InvestorDashboard = lazy(() => import('./pages/InvestorDashboard'));
const MyIntroductions = lazy(() => import('./pages/MyIntroductions'));
const AdminInvestment = lazy(() => import('./pages/AdminInvestment'));
const Subscription = lazy(() => import('./pages/Subscription'));
const AdminSubscriptions = lazy(() => import('./pages/AdminSubscriptions'));
const AdminFeeMatrix = lazy(() => import('./pages/AdminFeeMatrix'));
const VendorPricing = lazy(() => import('./pages/VendorPricing'));
const AwardWorkflow = lazy(() => import('./pages/AwardWorkflow'));
const ChangeOrders = lazy(() => import('./pages/ChangeOrders'));
const ProductCatalog = lazy(() => import('./pages/ProductCatalog'));
const VendorImport = lazy(() => import('./pages/VendorImport'));
const DesignerDashboard = lazy(() => import('./pages/DesignerDashboard'));
const GcDashboard = lazy(() => import('./pages/GcDashboard'));
const ProjectTemplates = lazy(() => import('./pages/ProjectTemplates'));
const SampleRequests = lazy(() => import('./pages/SampleRequests'));
const VendorOnboardingTemplates = lazy(() => import('./pages/VendorOnboardingTemplates'));
const BrokerOnboarding = lazy(() => import('./pages/BrokerOnboarding'));
const AdminInvestmentCompliance = lazy(() => import('./pages/AdminInvestmentCompliance'));
const OpportunityTeasers = lazy(() => import('./pages/OpportunityTeasers'));
const PublicDeveloperProfile = lazy(() => import('./pages/PublicDeveloperProfile'));
const ProfileCollateral = lazy(() => import('./pages/ProfileCollateral'));
const EventSpaces = lazy(() => import('./pages/EventSpaces'));
const AdminCRM = lazy(() => import('./pages/AdminCRM'));
const AdminTasks = lazy(() => import('./pages/AdminTasks'));
const AdminAudit = lazy(() => import('./pages/AdminAudit'));
const Reports = lazy(() => import('./pages/Reports'));
const AdminAnalytics = lazy(() => import('./pages/AdminAnalytics'));
const MessagingPolicy = lazy(() => import('./pages/MessagingPolicy'));
const AdminCsvImport = lazy(() => import('./pages/AdminCsvImport'));
const MyInvites = lazy(() => import('./pages/MyInvites'));
const PayoutSettings = lazy(() => import('./pages/PayoutSettings'));
const MyPayouts = lazy(() => import('./pages/MyPayouts'));
const AdminPayouts = lazy(() => import('./pages/AdminPayouts'));
const COITracker = lazy(() => import('./pages/COITracker'));
const RetainageDashboard = lazy(() => import('./pages/RetainageDashboard'));
const LenderPortal = lazy(() => import('./pages/LenderPortal'));
const DrawRequestView = lazy(() => import('./pages/DrawRequestView'));
const DisputeCenter = lazy(() => import('./pages/DisputeCenter'));
const InvestorWatchlist = lazy(() => import('./pages/InvestorWatchlist'));
const ProgressPhotos = lazy(() => import('./pages/ProgressPhotos'));
const AdminSplitTerms = lazy(() => import('./pages/AdminSplitTerms'));
const AdminVerification = lazy(() => import('./pages/AdminVerification'));

function Gate({ children }: { children: JSX.Element }) {
  const { session, company, isAdmin, loading } = useAuth();
  const location = useLocation();
  if (loading) return <div className="center"><div className="note">Loading…</div></div>;
  // Pass the intended destination so Login can redirect back after sign-in.
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (!company) return <Navigate to={isAdmin ? '/admin' : '/onboarding'} replace />;
  return <Shell>{children}</Shell>;
}

// Super-admin gate: same auth check as the user Gate but wraps the page in the
// SuperAdminDashboard nav shell (Overview / Invites / Discount Codes / Referral
// Partners / Features).
function SuperAdminGate({ children }: { children: JSX.Element }) {
  const { session, loading } = useAuth();
  const { isAdmin } = useFeatures();
  const location = useLocation();
  if (loading) return <div className="center"><div className="note">Loading…</div></div>;
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (!isAdmin) return <Navigate to="/app" replace />;
  return <SuperAdminDashboard>{children}</SuperAdminDashboard>;
}

function Routed() {
  const { session, company, isAdmin, loading } = useAuth();
  if (loading) return <div className="center"><div className="note">Loading…</div></div>;
  return (
    <Suspense fallback={<div className="center"><div className="note">Loading…</div></div>}>
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
        {/* Alias used by investor nav and dashboard CTAs */}
        <Route path="/app/deals" element={<Gate><InvestorDashboard /></Gate>} />
        {/* Alias used by buyer nav and onboarding checklist */}
        <Route path="/app/marketplace" element={<Gate><SearchBids /></Gate>} />
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
        <Route path="/admin/split-terms" element={<SuperAdminGate><AdminSplitTerms /></SuperAdminGate>} />
        <Route path="/admin/verification" element={<SuperAdminGate><AdminVerification /></SuperAdminGate>} />
        <Route path="/packages/:id/compare" element={<Gate><QuoteComparison /></Gate>} />
        <Route path="/intel" element={<Gate><IntelDashboard /></Gate>} />
        <Route path="/package/:id/intel" element={<Gate><IntelDashboard /></Gate>} />
        <Route path="/package/:id/rfq-assist" element={<Gate><RfqAssist /></Gate>} />
        <Route path="/package/:id/submittals" element={<Gate><Submittals /></Gate>} />
        <Route path="/package/:id/delivery" element={<Gate><DeliveryTracking /></Gate>} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
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
