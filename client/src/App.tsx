
import { Switch, Route, Redirect, useLocation } from "wouter";
import { Suspense, lazy } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { LiveCallProvider } from "@/contexts/LiveCallContext";
import { Toaster } from "@/components/ui/toaster";
import SidebarLayout from "@/components/layout/SidebarLayout";

// Landing pages - Keep eager for instant load (public-facing, need fast LCP)
import HandymanLanding from "@/pages/HandymanLanding";
import PropertyManagerLanding from "@/pages/PropertyManagerLanding";
import BusinessLanding from "@/pages/BusinessLanding";
import DerbyLanding from "@/pages/DerbyLanding";
import CleaningLanding from "@/pages/CleaningLanding";
import { Loader2, Wrench } from "lucide-react";

// Admin/CRM pages - Eager loaded for smooth navigation within CRM
import AudioUploadPage from "@/pages/AudioUploadPage";
import SKUPage from "@/pages/SKUPage";
import WhatsAppInbox from "@/pages/WhatsAppInbox";
import HandymanMap from "@/pages/HandymanMap";
import HandymanDashboard from "@/pages/HandymanDashboard"; // Legacy
import { ThemeProvider } from "@/components/theme-provider";
import ContractorFleetDashboard from "@/pages/ContractorFleetDashboard";
import MainDashboard from "@/pages/MainDashboard";
import CallsPage from "@/pages/CallsPage";
import TestLab from "./pages/TestLab";
import TrainingCenter from "./pages/TrainingCenter";
import SettingsPage from "./pages/SettingsPage";
const AdminInboxPage = lazy(() => import("@/pages/admin/AdminInboxPage"));

// Admin Content Management
const LandingPages = lazy(() => import("@/pages/admin/LandingPages"));
const MarketingDashboard = lazy(() => import("@/pages/admin/MarketingDashboard"));
const LandingPageBuilder = lazy(() => import("@/pages/admin/LandingPageBuilder"));
const Banners = lazy(() => import("@/pages/admin/Banners"));
const LeadsPage = lazy(() => import("@/pages/admin/LeadsPage"));
const LeadReviewPage = lazy(() => import("@/pages/admin/LeadReviewPage"));
const LeadFunnelPage = lazy(() => import("@/pages/admin/LeadFunnelPage"));
const LeadPipelinePage = lazy(() => import("@/pages/admin/LeadPipelinePage"));
const LeadTubeMapPage = lazy(() => import("@/pages/admin/LeadTubeMapPage"));
const PipelineHomePage = lazy(() => import("@/pages/admin/PipelineHomePage"));
const InvoicesPage = lazy(() => import("@/pages/admin/InvoicesPage"));
const LiveCallPage = lazy(() => import("@/pages/admin/LiveCallPage"));
const LiveCallTestPage = lazy(() => import("@/pages/admin/LiveCallTestPage"));
const LiveCallCoachTestPage = lazy(() => import("@/pages/admin/LiveCallCoachTestPage"));
const CallReviewPage = lazy(() => import("@/pages/admin/CallReviewPage"));
const CallHUDTestPage = lazy(() => import("@/pages/admin/CallHUDTestPage"));
const SKUSimulatorPage = lazy(() => import("@/pages/admin/SKUSimulatorPage"));
const PricingComparePage = lazy(() => import("@/pages/admin/PricingComparePage"));
const PricingLabV2 = lazy(() => import("@/pages/admin/PricingLabV2"));
const GenerateContextualQuote = lazy(() => import("@/pages/admin/GenerateContextualQuote"));
const QuoteAnalyticsPage = lazy(() => import("@/pages/admin/QuoteAnalyticsPage"));
const QuoteTestLab = lazy(() => import("@/pages/admin/QuoteTestLab"));
const QuoteFlowDiagram = lazy(() => import("@/pages/admin/QuoteFlowDiagram"));
const ContentLibrary = lazy(() => import("@/pages/admin/ContentLibrary"));
const QuotePlatformPage = lazy(() => import("@/pages/admin/QuotePlatformPage"));
const PricingSettingsPage = lazy(() => import("@/pages/admin/PricingSettingsPage"));
const PricingEnginePage = lazy(() => import("@/pages/admin/PricingEnginePage"));
const LiveCallTestWizard = lazy(() => import("@/pages/admin/LiveCallTestWizard"));
const DispatchPage = lazy(() => import("@/pages/admin/DispatchPage"));
const DailyPlannerPage = lazy(() => import("@/pages/admin/DailyPlannerPage"));
const TestDatePicker = lazy(() => import("@/pages/admin/TestDatePicker"));
const TenantIssuesPage = lazy(() => import("@/pages/admin/TenantIssuesPage"));
const QuotesPage = lazy(() => import("@/pages/admin/QuotesPage"));
const EditQuotePage = lazy(() => import("@/pages/admin/EditQuotePage"));
const BookingVisitsPage = lazy(() => import("@/pages/admin/BookingVisitsPage"));
const MasterAvailabilityPage = lazy(() => import("@/pages/admin/MasterAvailabilityPage"));
const ContractorsPage = lazy(() => import("@/pages/admin/ContractorsPage"));
const ContractorDetailPage = lazy(() => import("@/pages/admin/ContractorDetailPage"));
const PaymentsDashboardPage = lazy(() => import("@/pages/admin/PaymentsDashboardPage"));
const DashboardPage = lazy(() => import("@/pages/admin/DashboardPage"));
const OnboardingSlideDeck = lazy(() => import("@/pages/admin/OnboardingSlideDeck"));
const VAResourcesPage = lazy(() => import("@/pages/admin/VAResourcesPage"));
const VAPerformancePage = lazy(() => import("@/pages/admin/VAPerformancePage"));
const VATrainingCenter = lazy(() => import("@/pages/admin/VATrainingCenter"));
const CareersAdmin = lazy(() => import("@/pages/admin/CareersAdmin"));
const BusinessModelDashboard = lazy(() => import("@/pages/admin/BusinessModelDashboard"));
const DisputesPage = lazy(() => import("@/pages/admin/DisputesPage"));
const WTBPRateCardPage = lazy(() => import("@/pages/admin/WTBPRateCardPage"));
const LandingPageRender = lazy(() => import("@/pages/LandingPageRender"));
import SmartBanner from "@/components/SmartBanner";

// Public customer-facing pages - Lazy loaded (not needed for admin initial load)
const VideoQuote = lazy(() => import("@/pages/VideoQuote"));
const VideoReview = lazy(() => import("@/pages/VideoReview"));
const PersonalizedQuotePage = lazy(() => import("@/pages/PersonalizedQuotePage"));
const BookingConfirmedPage = lazy(() => import("@/pages/BookingConfirmedPage"));
const DiagnosticVisitPage = lazy(() => import("@/pages/DiagnosticVisitPage"));
const SeasonalMenu = lazy(() => import("@/pages/SeasonalMenu"));
const CareersPage = lazy(() => import("@/pages/CareersPage"));
const PartnerPage = lazy(() => import("@/pages/PartnerPage"));
const JoinPage = lazy(() => import("@/pages/JoinPage"));

// Client Portal Pages (public, token-based access)
const InvoiceView = lazy(() => import("@/pages/client/InvoiceView"));
const LeaveReview = lazy(() => import("@/pages/client/LeaveReview"));
const PaymentPage = lazy(() => import("@/pages/client/PaymentPage"));
const ClientDashboard = lazy(() => import("@/pages/client/ClientDashboard"));
const JobHistoryPage = lazy(() => import("@/pages/client/JobHistoryPage"));

// Landlord Portal Pages (public, token-based access)
const LandlordOnboardingPage = lazy(() => import("@/pages/landlord/OnboardingPage"));
const LandlordPropertiesPage = lazy(() => import("@/pages/landlord/PropertiesPage"));
const LandlordSettingsPage = lazy(() => import("@/pages/landlord/SettingsPage"));
const LandlordIssuesPage = lazy(() => import("@/pages/landlord/IssuesPage"));

// Contractor Portal - Lazy loaded (separate user flow)
const ContractorLogin = lazy(() => import("./pages/ContractorLogin"));
const ContractorRegister = lazy(() => import("./pages/ContractorRegister"));
const ContractorWelcome = lazy(() => import("./pages/ContractorWelcome"));
const ContractorOnboarding = lazy(() => import('./pages/ContractorOnboarding'));
const ContractorAppLanding = lazy(() => import('./pages/ContractorAppLanding'));

// Contractor Portal — 3-tab layout
const ContractorPortalLayout = lazy(() => import('./pages/contractor/ContractorPortalLayout'));
const CalendarTab = lazy(() => import('./pages/contractor/dashboard/CalendarTab'));
const MyJobsTab = lazy(() => import('./pages/contractor/dashboard/MyJobsTab'));
const ProfileTab = lazy(() => import('./pages/contractor/dashboard/ProfileTab'));
const JobDetailsPage = lazy(() => import("./pages/contractor/dashboard/JobDetailsPage"));
const EarningsPage = lazy(() => import("./pages/contractor/dashboard/EarningsPage"));

// Admin follow-up inbox (shares component with contractor inbox)
const FollowUpInboxPage = lazy(() => import("./pages/contractor/dashboard/InboxPage"));




// Auth Pages
const AdminLogin = lazy(() => import("@/pages/AdminLogin"));
const GoogleCallback = lazy(() => import("@/pages/GoogleCallback"));
import ProtectedRoute from "@/components/ProtectedRoute";

// Public Contractor Profiles
const ContractorPublicProfile = lazy(() => import("@/pages/public/ContractorPublicProfile"));
const InstantPricePage = lazy(() => import("@/pages/InstantPricePage"));

// Pitch/Sales Pages
const PitchIndex = lazy(() => import("@/pages/pitch/PitchIndex"));
const CustomerJourney = lazy(() => import("@/pages/pitch/CustomerJourney"));
const ROICalculator = lazy(() => import("@/pages/pitch/ROICalculator"));
const Roadmap = lazy(() => import("@/pages/pitch/Roadmap"));
const CompetitorAnalysis = lazy(() => import("@/pages/pitch/CompetitorAnalysis"));

// Loading fallback for lazy-loaded components
// Loading fallback for lazy-loaded components
function LoadingFallback() {
    return (
        <div className="flex items-center justify-center min-h-screen bg-gradient-to-b from-gray-900 to-gray-800">
            <div className="relative">
                <Wrench className="h-14 w-14 animate-spin text-[#e8b323]" strokeWidth={1.5} />
                <div className="absolute inset-0 flex items-center justify-center">
                    <div className="h-4 w-4 bg-gray-900 rounded-full" />
                </div>
            </div>
            <p className="sr-only">Loading...</p>
        </div>
    );
}

/** Redirect VA users to /admin/live-call instead of showing PipelineHome */
function AdminHomeRedirect() {
    const [, setLocation] = useLocation();
    try {
        const adminUser = JSON.parse(localStorage.getItem('adminUser') || '{}');
        if (adminUser?.role === 'va') {
            setLocation('/admin/live-call');
            return null;
        }
    } catch {}
    return (
        <Suspense fallback={<LoadingFallback />}>
            <PipelineHomePage />
        </Suspense>
    );
}

function Router() {
    const [location] = useLocation();
    // Domain Routing Logic
    // If we are on a subdomain (e.g. richard.handy.contractors), we hijack the routing
    // and ONLY show the public profile for that slug.

    const host = window.location.host;
    const parts = host.split('.');
    let contractorSlug: string | null = null;

    // Check for dev (richard.localhost:5173) or prod (richard.handy.contractors)
    if (parts.length > 1) {
        const subdomain = parts[0];
        const reserved = ['www', 'api', 'app', 'admin', 'switchboard', 'localhost']; // localhost is reserved if it's just "localhost:5173"

        // If parts[1] is localhost, then parts[0] is the subdomain
        // If host is "localhost:5173", parts=['localhost:5173'], length=1 (split by dot might imply port separation? No, host includes port but split('.') splits IP usually)
        // Actually host "richard.localhost:5173" -> split('.') -> ["richard", "localhost:5173"]

        if (!reserved.includes(subdomain) && !host.startsWith('localhost') && !host.startsWith('127.0.0.1')) {
            contractorSlug = subdomain;
        } else if (host.includes('localhost') && parts.length > 1 && parts[0] !== 'localhost') {
            // Local dev case: richard.localhost
            contractorSlug = parts[0];
        }
    }

    // DEBUG OVERRIDE for testing without modifying /etc/hosts each time
    // if (location.startsWith('/_test_domain/')) {
    //    contractorSlug = location.split('/')[2];
    // }

    if (contractorSlug) {
        console.log(`[App] Detected Contractor Domain: ${contractorSlug}`);
        return (
            <Suspense fallback={<LoadingFallback />}>
                {/* We verify the slug exists by just rendering the component, which handles 404s internally */}
                <ContractorPublicProfile forcedSlug={contractorSlug} />
            </Suspense>
        );
    }

    console.log("Current routed path:", location);

    return (
        <Suspense fallback={<LoadingFallback />}>
            <SmartBanner />
            <Switch>
                {/* ============ PUBLIC ROUTES ============ */}
                {/* Landing Pages */}
                <Route path="/landing">
                    <HandymanLanding />
                </Route>
                <Route path="/property-managers" component={PropertyManagerLanding} />
                <Route path="/businesses" component={BusinessLanding} />
                <Route path="/app" component={ContractorAppLanding} />
                <Route path="/derby" component={DerbyLanding} />
                <Route path="/cleaning" component={CleaningLanding} />
                <Route path="/seasonal-guide" component={SeasonalMenu} />
                <Route path="/careers" component={CareersPage} />
                <Route path="/partner" component={PartnerPage} />
                <Route path="/join" component={JoinPage} />
                <Route path="/l/:slug" component={LandingPageRender} />

                {/* Customer-facing quote views - /quote is the canonical URL */}
                <Route path="/quote/:slug">
                    <PersonalizedQuotePage />
                </Route>
                {/* Legacy routes for backward compatibility */}
                <Route path="/quote-link/:slug">
                    <PersonalizedQuotePage />
                </Route>
                <Route path="/q/:slug">
                    <PersonalizedQuotePage />
                </Route>
                <Route path="/booking-confirmed/:quoteId">
                    <BookingConfirmedPage />
                </Route>
                <Route path="/video-quote">
                    <VideoQuote />
                </Route>
                <Route path="/video-review">
                    <VideoReview />
                </Route>

                {/* Paid Diagnostic Visit */}
                <Route path="/visit-link/:slug">
                    <DiagnosticVisitPage />
                </Route>

                {/* Client Portal - Token-based access */}
                <Route path="/client/:token">
                    <ClientDashboard />
                </Route>
                <Route path="/client/:token/jobs/:jobId">
                    <JobHistoryPage />
                </Route>
                <Route path="/invoice/:token">
                    <InvoiceView />
                </Route>
                <Route path="/review/:token">
                    <LeaveReview />
                </Route>
                <Route path="/pay/:shortCode">
                    <PaymentPage />
                </Route>

                {/* Landlord Onboarding - Public */}
                <Route path="/landlord">
                    <LandlordOnboardingPage />
                </Route>
                <Route path="/landlord/signup">
                    <LandlordOnboardingPage />
                </Route>
                <Route path="/for-landlords">
                    <LandlordOnboardingPage />
                </Route>

                {/* Landlord Portal - Token-based access */}
                <Route path="/landlord/:token">
                    <LandlordPropertiesPage />
                </Route>
                <Route path="/landlord/:token/properties">
                    <LandlordPropertiesPage />
                </Route>
                <Route path="/landlord/:token/settings">
                    <LandlordSettingsPage />
                </Route>
                <Route path="/landlord/:token/issues">
                    <LandlordIssuesPage />
                </Route>

                {/* Coming soon */}
                <Route path="/instant-price">
                    <InstantPricePage />
                </Route>

                {/* Training (public for now) */}
                <Route path="/training" component={TrainingCenter} />

                {/* Public Contractor Profile */}
                <Route path="/handy/:slug">
                    <ContractorPublicProfile />
                </Route>

                {/* Pitch/Sales Presentation Pages */}
                <Route path="/pitch" component={PitchIndex} />
                <Route path="/pitch/journey" component={CustomerJourney} />
                <Route path="/pitch/roi" component={ROICalculator} />
                <Route path="/pitch/roadmap" component={Roadmap} />
                <Route path="/pitch/competitors" component={CompetitorAnalysis} />


                {/* Auth Routes */}
                <Route path="/admin/login">
                    <AdminLogin />
                </Route>
                <Route path="/auth/callback">
                    <GoogleCallback />
                </Route>

                {/* Contractor Portal Routes (separate auth) */}
                <Route path="/contractor/login">
                    <ContractorLogin />
                </Route>
                <Route path="/contractor/welcome">
                    <ContractorWelcome />
                </Route>
                <Route path="/contractor/register">
                    <ContractorRegister />
                </Route>
                {/* SPA redirect — do NOT use window.location.href (causes full page reload + HMR drop) */}
                <Route path="/contractor">
                    <Redirect to="/contractor/dashboard" />
                </Route>
                {/* Contractor Portal — 3-tab layout */}
                <Route path="/contractor/dashboard">
                    <ProtectedRoute role="contractor">
                        <ContractorPortalLayout>
                            <CalendarTab />
                        </ContractorPortalLayout>
                    </ProtectedRoute>
                </Route>
                <Route path="/contractor/dashboard/jobs">
                    <ProtectedRoute role="contractor">
                        <ContractorPortalLayout>
                            <MyJobsTab />
                        </ContractorPortalLayout>
                    </ProtectedRoute>
                </Route>
                <Route path="/contractor/dashboard/jobs/:id">
                    <ProtectedRoute role="contractor">
                        <ContractorPortalLayout>
                            <JobDetailsPage />
                        </ContractorPortalLayout>
                    </ProtectedRoute>
                </Route>
                <Route path="/contractor/dashboard/settings">
                    <ProtectedRoute role="contractor">
                        <ContractorPortalLayout>
                            <ProfileTab />
                        </ContractorPortalLayout>
                    </ProtectedRoute>
                </Route>
                <Route path="/contractor/dashboard/earnings">
                    <ProtectedRoute role="contractor">
                        <EarningsPage />
                    </ProtectedRoute>
                </Route>
                <Route path="/contractor/onboarding">
                    <ProtectedRoute role="contractor">
                        <ContractorOnboarding />
                    </ProtectedRoute>
                </Route>
                <Route path="/contractor/profile">
                    {() => {
                        window.location.href = '/contractor/dashboard/settings';
                        return null;
                    }}
                </Route>

                {/* ============ ADMIN ROUTES (Protected) ============ */}
                {/* Pipeline Home - the main/only view for V6 Switchboard CRM (VAs redirect to /admin/live-call) */}
                <Route path="/admin">
                    <ProtectedRoute role="admin">
                        <AdminHomeRedirect />
                    </ProtectedRoute>
                </Route>
                <Route path="/admin/pipeline-home">
                    <ProtectedRoute role="admin">
                        <AdminHomeRedirect />
                    </ProtectedRoute>
                </Route>
                {/* Legacy Dashboard - accessed via admin sidebar */}
                <Route path="/admin/dashboard">
                    <ProtectedRoute role="admin">
                        <SidebarLayout>
                            <DashboardPage />
                        </SidebarLayout>
                    </ProtectedRoute>
                </Route>
                <Route path="/admin/audio-upload">
                    <ProtectedRoute role="admin">
                        <SidebarLayout>
                            <AudioUploadPage />
                        </SidebarLayout>
                    </ProtectedRoute>
                </Route>
                <Route path="/admin/live-call">
                    <ProtectedRoute role="admin">
                        <SidebarLayout>
                            <LiveCallPage />
                        </SidebarLayout>
                    </ProtectedRoute>
                </Route>
                <Route path="/admin/live-call-test">
                    <ProtectedRoute role="admin">
                        <LiveCallTestPage />
                    </ProtectedRoute>
                </Route>
                <Route path="/admin/live-call-coach">
                    <ProtectedRoute role="admin">
                        <LiveCallCoachTestPage />
                    </ProtectedRoute>
                </Route>
                <Route path="/admin/call-hud">
                    <ProtectedRoute role="admin">
                        <CallHUDTestPage />
                    </ProtectedRoute>
                </Route>
                <Route path="/admin/sku-simulator">
                    <ProtectedRoute role="admin">
                        <SKUSimulatorPage />
                    </ProtectedRoute>
                </Route>
                <Route path="/admin/pricing-lab">
                    <ProtectedRoute role="admin">
                        <PricingComparePage />
                    </ProtectedRoute>
                </Route>
                <Route path="/admin/pricing-lab-v2">
                    <ProtectedRoute role="admin">
                        <PricingLabV2 />
                    </ProtectedRoute>
                </Route>
                <Route path="/admin/pricing-settings">
                    <ProtectedRoute role="admin">
                        <SidebarLayout>
                            <PricingSettingsPage />
                        </SidebarLayout>
                    </ProtectedRoute>
                </Route>
                <Route path="/admin/pricing-engine">
                    <ProtectedRoute role="admin">
                        <SidebarLayout>
                            <PricingEnginePage />
                        </SidebarLayout>
                    </ProtectedRoute>
                </Route>
                <Route path="/admin/live-call-wizard">
                    <ProtectedRoute role="admin">
                        <LiveCallTestWizard />
                    </ProtectedRoute>
                </Route>
                <Route path="/admin/inbox">
                    <ProtectedRoute role="admin">
                        <SidebarLayout>
                            <AdminInboxPage />
                        </SidebarLayout>
                    </ProtectedRoute>
                </Route>
                <Route path="/admin/follow-ups">
                    <ProtectedRoute role="admin">
                        <SidebarLayout>
                            <FollowUpInboxPage />
                        </SidebarLayout>
                    </ProtectedRoute>
                </Route>
                <Route path="/admin/invoices">
                    <ProtectedRoute role="admin">
                        <SidebarLayout>
                            <InvoicesPage />
                        </SidebarLayout>
                    </ProtectedRoute>
                </Route>
                <Route path="/admin/quotes/:slug/edit">
                    <ProtectedRoute role="admin">
                        <SidebarLayout>
                            <EditQuotePage />
                        </SidebarLayout>
                    </ProtectedRoute>
                </Route>
                <Route path="/admin/quotes">
                    <ProtectedRoute role="admin">
                        <SidebarLayout>
                            <QuotesPage />
                        </SidebarLayout>
                    </ProtectedRoute>
                </Route>
                <Route path="/admin/visits">
                    <ProtectedRoute role="admin">
                        <SidebarLayout>
                            <BookingVisitsPage />
                        </SidebarLayout>
                    </ProtectedRoute>
                </Route>
                <Route path="/admin/dispatch">
                    <ProtectedRoute role="admin">
                        <SidebarLayout>
                            <DispatchPage />
                        </SidebarLayout>
                    </ProtectedRoute>
                </Route>
                <Route path="/admin/daily-planner">
                    <ProtectedRoute role="admin">
                        <SidebarLayout>
                            <DailyPlannerPage />
                        </SidebarLayout>
                    </ProtectedRoute>
                </Route>
                <Route path="/admin/test-date-picker">
                    <TestDatePicker />
                </Route>
                <Route path="/admin/tenant-issues">
                    <ProtectedRoute role="admin">
                        <SidebarLayout>
                            <TenantIssuesPage />
                        </SidebarLayout>
                    </ProtectedRoute>
                </Route>
                <Route path="/admin/availability">
                    <ProtectedRoute role="admin">
                        <SidebarLayout>
                            <MasterAvailabilityPage />
                        </SidebarLayout>
                    </ProtectedRoute>
                </Route>
                <Route path="/admin/contractors/:id">
                    <ProtectedRoute role="admin">
                        <SidebarLayout>
                            <ContractorDetailPage />
                        </SidebarLayout>
                    </ProtectedRoute>
                </Route>
                <Route path="/admin/contractors">
                    <ProtectedRoute role="admin">
                        <SidebarLayout>
                            <ContractorsPage />
                        </SidebarLayout>
                    </ProtectedRoute>
                </Route>
                <Route path="/admin/payments">
                    <ProtectedRoute role="admin">
                        <SidebarLayout>
                            <PaymentsDashboardPage />
                        </SidebarLayout>
                    </ProtectedRoute>
                </Route>
                <Route path="/admin/skus">
                    <ProtectedRoute role="admin">
                        <SidebarLayout>
                            <SKUPage />
                        </SidebarLayout>
                    </ProtectedRoute>
                </Route>
                <Route path="/admin/whatsapp-intake">
                    <ProtectedRoute role="admin">
                        <SidebarLayout>
                            <WhatsAppInbox />
                        </SidebarLayout>
                    </ProtectedRoute>
                </Route>
                <Route path="/admin/handymen">
                    <ProtectedRoute role="admin">
                        <SidebarLayout>
                            <HandymanMap />
                        </SidebarLayout>
                    </ProtectedRoute>
                </Route>
                <Route path="/admin/handyman/dashboard">
                    <ProtectedRoute role="admin">
                        <SidebarLayout>
                            <ContractorFleetDashboard />
                        </SidebarLayout>
                    </ProtectedRoute>
                </Route>
                <Route path="/admin/calls/:id/review">
                    <ProtectedRoute role="admin">
                        <SidebarLayout>
                            <CallReviewPage />
                        </SidebarLayout>
                    </ProtectedRoute>
                </Route>
                <Route path="/admin/calls">
                    <ProtectedRoute role="admin">
                        <SidebarLayout>
                            <CallsPage />
                        </SidebarLayout>
                    </ProtectedRoute>
                </Route>

                <Route path="/admin/generate-contextual-quote">
                    <ProtectedRoute role="admin">
                        <SidebarLayout>
                            <GenerateContextualQuote />
                        </SidebarLayout>
                    </ProtectedRoute>
                </Route>
                <Route path="/admin/quote-analytics">
                    <ProtectedRoute role="admin">
                        <SidebarLayout>
                            <QuoteAnalyticsPage />
                        </SidebarLayout>
                    </ProtectedRoute>
                </Route>
                <Route path="/admin/quote-test-lab">
                    <ProtectedRoute role="admin">
                        <SidebarLayout>
                            <QuoteTestLab />
                        </SidebarLayout>
                    </ProtectedRoute>
                </Route>
                <Route path="/admin/content-library">
                    <ProtectedRoute role="admin">
                        <SidebarLayout>
                            <ContentLibrary />
                        </SidebarLayout>
                    </ProtectedRoute>
                </Route>
                <Route path="/admin/quote-platform">
                    <ProtectedRoute role="admin">
                        <SidebarLayout>
                            <QuotePlatformPage />
                        </SidebarLayout>
                    </ProtectedRoute>
                </Route>
                <Route path="/admin/quote-flow">
                    <ProtectedRoute role="admin">
                        <QuoteFlowDiagram />
                    </ProtectedRoute>
                </Route>
                <Route path="/admin/test-lab">
                    <ProtectedRoute role="admin">
                        <SidebarLayout>
                            <TestLab />
                        </SidebarLayout>
                    </ProtectedRoute>
                </Route>
                <Route path="/admin/settings">
                    <ProtectedRoute role="admin">
                        <SidebarLayout>
                            <SettingsPage />
                        </SidebarLayout>
                    </ProtectedRoute>
                </Route>
                <Route path="/admin/onboarding">
                    <OnboardingSlideDeck />
                </Route>
                <Route path="/admin/resources">
                    <ProtectedRoute role="admin">
                        <SidebarLayout>
                            <VAResourcesPage />
                        </SidebarLayout>
                    </ProtectedRoute>
                </Route>
                <Route path="/admin/va-stats">
                    <ProtectedRoute role="admin">
                        <SidebarLayout>
                            <VAPerformancePage />
                        </SidebarLayout>
                    </ProtectedRoute>
                </Route>
                <Route path="/admin/training-center">
                    <ProtectedRoute role="admin">
                        <SidebarLayout>
                            <VATrainingCenter />
                        </SidebarLayout>
                    </ProtectedRoute>
                </Route>
                <Route path="/admin/careers">
                    <ProtectedRoute role="admin">
                        <SidebarLayout>
                            <CareersAdmin />
                        </SidebarLayout>
                    </ProtectedRoute>
                </Route>

                <Route path="/admin/business-model">
                    <ProtectedRoute role="admin">
                        <SidebarLayout>
                            <BusinessModelDashboard />
                        </SidebarLayout>
                    </ProtectedRoute>
                </Route>
                <Route path="/admin/disputes">
                    <ProtectedRoute role="admin">
                        <SidebarLayout>
                            <DisputesPage />
                        </SidebarLayout>
                    </ProtectedRoute>
                </Route>
                <Route path="/admin/wtbp-rates">
                    <ProtectedRoute role="admin">
                        <SidebarLayout>
                            <WTBPRateCardPage />
                        </SidebarLayout>
                    </ProtectedRoute>
                </Route>

                <Route path="/admin/marketing">
                    <ProtectedRoute role="admin">
                        <SidebarLayout>
                            <MarketingDashboard />
                        </SidebarLayout>
                    </ProtectedRoute>
                </Route>
                <Route path="/admin/leads/review">
                    <ProtectedRoute role="admin">
                        <SidebarLayout>
                            <LeadReviewPage />
                        </SidebarLayout>
                    </ProtectedRoute>
                </Route>
                <Route path="/admin/leads">
                    <ProtectedRoute role="admin">
                        <SidebarLayout>
                            <LeadsPage />
                        </SidebarLayout>
                    </ProtectedRoute>
                </Route>
                <Route path="/admin/funnel">
                    <ProtectedRoute role="admin">
                        <SidebarLayout>
                            <LeadFunnelPage />
                        </SidebarLayout>
                    </ProtectedRoute>
                </Route>
                <Route path="/admin/pipeline">
                    <ProtectedRoute role="admin">
                        <SidebarLayout>
                            <LeadPipelinePage />
                        </SidebarLayout>
                    </ProtectedRoute>
                </Route>
                <Route path="/admin/tube-map">
                    <ProtectedRoute role="admin">
                        <SidebarLayout>
                            <LeadTubeMapPage />
                        </SidebarLayout>
                    </ProtectedRoute>
                </Route>
                <Route path="/admin/landing-pages/:id">
                    <ProtectedRoute role="admin">
                        <SidebarLayout>
                            <LandingPageBuilder />
                        </SidebarLayout>
                    </ProtectedRoute>
                </Route>


                {/* SPA redirect — do NOT use window.location.href (causes full page reload + HMR drop) */}
                <Route path="/">
                    <Redirect to="/admin" />
                </Route>

                <Route>
                    <div className="p-10 text-center">
                        <h1>404 Page Not Found</h1>
                        <p className="text-gray-500 mt-2">Attempted path: {location}</p>
                    </div>
                </Route>
            </Switch>
        </Suspense >
    );
}

function App() {
    return (
        <QueryClientProvider client={queryClient}>
            <ThemeProvider defaultTheme="dark" storageKey="vite-ui-theme">
                <LiveCallProvider>
                    <Router />
                    <Toaster />
                </LiveCallProvider>
            </ThemeProvider>
        </QueryClientProvider>
    );
}

export default App;
