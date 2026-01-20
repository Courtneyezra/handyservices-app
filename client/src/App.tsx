
import { Switch, Route, useLocation } from "wouter";
import { Suspense, lazy } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { LiveCallProvider } from "@/contexts/LiveCallContext";
import { Toaster } from "@/components/ui/toaster";
import SidebarLayout from "@/components/layout/SidebarLayout";

// Landing pages - Keep eager for instant load (public-facing, need fast LCP)
import HandymanLanding from "@/pages/HandymanLanding";
import DerbyLanding from "@/pages/DerbyLanding";

// Admin/CRM pages - Eager loaded for smooth navigation within CRM
import AudioUploadPage from "@/pages/AudioUploadPage";
import SKUPage from "@/pages/SKUPage";
import WhatsAppInbox from "@/pages/WhatsAppInbox";
import HandymanMap from "@/pages/HandymanMap";
import HandymanDashboard from "@/pages/HandymanDashboard"; // Legacy
import { ThemeProvider } from "@/components/theme-provider";
import ContractorFleetDashboard from "@/pages/ContractorFleetDashboard";
import GenerateQuoteLink from "@/pages/GenerateQuoteLink";
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
const InvoicesPage = lazy(() => import("@/pages/admin/InvoicesPage"));
const DispatchPage = lazy(() => import("@/pages/admin/DispatchPage"));
const LandingPageRender = lazy(() => import("@/pages/LandingPageRender"));
import SmartBanner from "@/components/SmartBanner";

// Public customer-facing pages - Lazy loaded (not needed for admin initial load)
const VideoQuote = lazy(() => import("@/pages/VideoQuote"));
const VideoReview = lazy(() => import("@/pages/VideoReview"));
const PersonalizedQuotePage = lazy(() => import("@/pages/PersonalizedQuotePage"));
const DiagnosticVisitPage = lazy(() => import("@/pages/DiagnosticVisitPage"));
const SeasonalMenu = lazy(() => import("@/pages/SeasonalMenu"));

// Contractor Portal - Lazy loaded (separate user flow)
const ContractorLogin = lazy(() => import("./pages/ContractorLogin"));
const ContractorRegister = lazy(() => import("./pages/ContractorRegister"));
const ContractorWelcome = lazy(() => import("./pages/ContractorWelcome"));
const ContractorPortal = lazy(() => import("./pages/ContractorPortal"));
const ContractorCalendar = lazy(() => import("./pages/ContractorCalendar"));
const ContractorProfile = lazy(() => import("./pages/ContractorProfile"));
const ContractorServiceArea = lazy(() => import("./pages/ContractorServiceArea"));

// Contractor Dashboard (Phase 3)
const ContractorDashboardHome = lazy(() => import("./pages/ContractorMobileDashboard"));
const BookingRequestsPage = lazy(() => import("./pages/contractor/dashboard/BookingRequestsPage"));
const NewQuotePage = lazy(() => import("./pages/contractor/dashboard/quotes/NewQuotePage"));
const QuotesListPage = lazy(() => import("./pages/contractor/dashboard/quotes/QuotesListPage"));
const JobsPage = lazy(() => import("./pages/contractor/dashboard/JobsPage"));
const QuoteDetailsPage = lazy(() => import("./pages/contractor/dashboard/quotes/QuoteDetailsPage"));
const JobDetailsPage = lazy(() => import("./pages/contractor/dashboard/JobDetailsPage"));
const ContractorOnboarding = lazy(() => import('./pages/ContractorOnboarding'));
const ContractorSettingsPage = lazy(() => import('./pages/contractor/dashboard/ContractorSettingsPage'));
const ContractorAppLanding = lazy(() => import('./pages/ContractorAppLanding'));
const ExpensesPage = lazy(() => import('./pages/contractor/dashboard/ExpensesPage'));
const CreateInvoicePage = lazy(() => import('./pages/contractor/invoices/CreateInvoicePage'));
const ContractorDashboardLayout = lazy(() => import('./pages/contractor/ContractorDashboardLayout'));
const PartnerOnboardingModal = lazy(() => import('./pages/PartnerOnboardingModal'));




// Auth Pages
const AdminLogin = lazy(() => import("@/pages/AdminLogin"));
const GoogleCallback = lazy(() => import("@/pages/GoogleCallback"));
import ProtectedRoute from "@/components/ProtectedRoute";

// Public Contractor Profiles
const ContractorPublicProfile = lazy(() => import("@/pages/public/ContractorPublicProfile"));

// Loading fallback for lazy-loaded components
function LoadingFallback() {
    return (
        <div className="flex items-center justify-center min-h-screen bg-gray-900">
            <div className="flex flex-col items-center gap-4">
                <div className="w-10 h-10 border-4 border-amber-400 border-t-transparent rounded-full animate-spin" />
                <p className="text-slate-400 text-sm">Loading...</p>
            </div>
        </div>
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
                <Route path="/landing" component={HandymanLanding} />
                <Route path="/app" component={ContractorAppLanding} />
                <Route path="/derby" component={DerbyLanding} />
                <Route path="/seasonal-guide" component={SeasonalMenu} />
                <Route path="/l/:slug" component={LandingPageRender} />

                {/* Customer-facing quote views */}
                <Route path="/quote-link/:slug">
                    <PersonalizedQuotePage />
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

                {/* Coming soon */}
                <Route path="/instant-price">
                    <div className="p-10 text-center"><h1>Instant Price Page (Coming Soon)</h1></div>
                </Route>

                {/* Training (public for now) */}
                <Route path="/training" component={TrainingCenter} />

                {/* Public Contractor Profile */}
                <Route path="/handy/:slug">
                    <ContractorPublicProfile />
                </Route>


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
                <Route path="/contractor">
                    {() => {
                        window.location.href = '/contractor/dashboard';
                        return null;
                    }}
                </Route>
                <Route path="/contractor/dashboard">
                    <ProtectedRoute role="contractor">
                        <ContractorDashboardHome />
                    </ProtectedRoute>
                </Route>
                <Route path="/contractor/dashboard/bookings">
                    <ProtectedRoute role="contractor">
                        <BookingRequestsPage />
                    </ProtectedRoute>
                </Route>
                <Route path="/contractor/onboarding">
                    <ProtectedRoute role="contractor">
                        <ContractorOnboarding />
                    </ProtectedRoute>
                </Route>
                <Route path="/contractor/partner-onboarding">
                    <ProtectedRoute role="contractor">
                        <PartnerOnboardingModal />
                    </ProtectedRoute>
                </Route>
                <Route path="/contractor/dashboard/quotes/new">
                    <ProtectedRoute role="contractor">
                        <NewQuotePage />
                    </ProtectedRoute>
                </Route>
                <Route path="/contractor/dashboard/quotes">
                    <ProtectedRoute role="contractor">
                        <QuotesListPage />
                    </ProtectedRoute>
                </Route>
                <Route path="/contractor/dashboard/quotes/:id">
                    <ProtectedRoute role="contractor">
                        <QuoteDetailsPage />
                    </ProtectedRoute>
                </Route>
                <Route path="/contractor/dashboard/jobs">
                    <ProtectedRoute role="contractor">
                        <JobsPage />
                    </ProtectedRoute>
                </Route>
                <Route path="/contractor/dashboard/jobs/:id">
                    <ProtectedRoute role="contractor">
                        <JobDetailsPage />
                    </ProtectedRoute>
                </Route>
                <Route path="/contractor/financials">
                    <ProtectedRoute role="contractor">
                        <ExpensesPage />
                    </ProtectedRoute>
                </Route>
                <Route path="/contractor/create-invoice">
                    <ProtectedRoute role="contractor">
                        <CreateInvoicePage />
                    </ProtectedRoute>
                </Route>
                <Route path="/contractor/calendar">
                    <ProtectedRoute role="contractor">
                        <ContractorCalendar />
                    </ProtectedRoute>
                </Route>
                <Route path="/contractor/profile">
                    {() => {
                        window.location.href = '/contractor/dashboard/settings';
                        return null;
                    }}
                </Route>
                <Route path="/contractor/service-area">
                    <ProtectedRoute role="contractor">
                        <ContractorServiceArea />
                    </ProtectedRoute>
                </Route>
                <Route path="/contractor/dashboard/settings">
                    <ProtectedRoute role="contractor">
                        <ContractorSettingsPage />
                    </ProtectedRoute>
                </Route>

                {/* ============ ADMIN ROUTES (Protected) ============ */}
                <Route path="/admin">
                    <ProtectedRoute role="admin">
                        <SidebarLayout>
                            <MainDashboard />
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
                            <AudioUploadPage />
                        </SidebarLayout>
                    </ProtectedRoute>
                </Route>
                <Route path="/admin/inbox">
                    <ProtectedRoute role="admin">
                        <SidebarLayout>
                            <AdminInboxPage />
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
                <Route path="/admin/dispatch">
                    <ProtectedRoute role="admin">
                        <SidebarLayout>
                            <DispatchPage />
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
                <Route path="/admin/calls">
                    <ProtectedRoute role="admin">
                        <SidebarLayout>
                            <CallsPage />
                        </SidebarLayout>
                    </ProtectedRoute>
                </Route>
                <Route path="/admin/generate-quote">
                    <ProtectedRoute role="admin">
                        <SidebarLayout>
                            <GenerateQuoteLink />
                        </SidebarLayout>
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

                <Route path="/admin/marketing">
                    <ProtectedRoute role="admin">
                        <SidebarLayout>
                            <MarketingDashboard />
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
                <Route path="/admin/landing-pages/:id">
                    <ProtectedRoute role="admin">
                        <SidebarLayout>
                            <LandingPageBuilder />
                        </SidebarLayout>
                    </ProtectedRoute>
                </Route>


                {/* Redirect root to admin dashboard */}
                <Route path="/">
                    {() => {
                        window.location.href = '/admin';
                        return null;
                    }}
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
