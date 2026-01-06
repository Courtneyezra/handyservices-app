
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
import ContractorFleetDashboard from "@/pages/ContractorFleetDashboard";
import GenerateQuoteLink from "@/pages/GenerateQuoteLink";
import MainDashboard from "@/pages/MainDashboard";
import CallsPage from "@/pages/CallsPage";
import TestLab from "./pages/TestLab";
import TrainingCenter from "./pages/TrainingCenter";
import SettingsPage from "./pages/SettingsPage";

// Public customer-facing pages - Lazy loaded (not needed for admin initial load)
const VideoQuote = lazy(() => import("@/pages/VideoQuote"));
const VideoReview = lazy(() => import("@/pages/VideoReview"));
const PersonalizedQuotePage = lazy(() => import("@/pages/PersonalizedQuotePage"));
const SeasonalMenu = lazy(() => import("@/pages/SeasonalMenu"));

// Contractor Portal - Lazy loaded (separate user flow)
const ContractorLogin = lazy(() => import("./pages/ContractorLogin"));
const ContractorRegister = lazy(() => import("./pages/ContractorRegister"));
const ContractorPortal = lazy(() => import("./pages/ContractorPortal"));
const ContractorCalendar = lazy(() => import("./pages/ContractorCalendar"));
const ContractorProfile = lazy(() => import("./pages/ContractorProfile"));
const ContractorServiceArea = lazy(() => import("./pages/ContractorServiceArea"));

// Contractor Dashboard (Phase 3)
const ContractorDashboardHome = lazy(() => import("./pages/contractor/dashboard/ContractorDashboardHome"));
const BookingRequestsPage = lazy(() => import("./pages/contractor/dashboard/BookingRequestsPage"));
const NewQuotePage = lazy(() => import("./pages/contractor/dashboard/quotes/NewQuotePage"));
const QuotesListPage = lazy(() => import("./pages/contractor/dashboard/quotes/QuotesListPage"));
const JobsPage = lazy(() => import("./pages/contractor/dashboard/JobsPage"));
const QuoteDetailsPage = lazy(() => import("./pages/contractor/dashboard/quotes/QuoteDetailsPage"));
const ContractorOnboarding = lazy(() => import('./pages/ContractorOnboarding'));
const ContractorSettingsPage = lazy(() => import('./pages/contractor/dashboard/ContractorSettingsPage'));



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
            <Switch>
                {/* ============ PUBLIC ROUTES ============ */}
                {/* Landing Pages */}
                <Route path="/landing" component={HandymanLanding} />
                <Route path="/derby" component={DerbyLanding} />
                <Route path="/seasonal-guide" component={SeasonalMenu} />

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

                {/* Contractor Portal Routes (separate auth) */}
                <Route path="/contractor/login">
                    <ContractorLogin />
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
                    <ContractorDashboardHome />
                </Route>
// ... existing code

                <Route path="/contractor/dashboard/bookings">
                    <BookingRequestsPage />
                </Route>
                <Route path="/contractor/onboarding">
                    {/* Security: Should check auth inside component */}
                    <ContractorOnboarding />
                </Route>
                <Route path="/contractor/dashboard/quotes/new">
                    <NewQuotePage />
                </Route>
                <Route path="/contractor/dashboard/quotes">
                    <QuotesListPage />
                </Route>
                <Route path="/contractor/dashboard/quotes/:id">
                    <QuoteDetailsPage />
                </Route>
                <Route path="/contractor/dashboard/jobs">
                    <JobsPage />
                </Route>
                <Route path="/contractor/calendar">
                    <ContractorCalendar />
                </Route>
                <Route path="/contractor/profile">
                    <ContractorProfile />
                </Route>
                <Route path="/contractor/service-area">
                    <ContractorServiceArea />
                </Route>
                <Route path="/contractor/dashboard/settings">
                    <ContractorSettingsPage />
                </Route>

                {/* ============ ADMIN ROUTES (Protected by Cloudflare Access) ============ */}
                <Route path="/admin">
                    <SidebarLayout>
                        <MainDashboard />
                    </SidebarLayout>
                </Route>
                <Route path="/admin/audio-upload">
                    <SidebarLayout>
                        <AudioUploadPage />
                    </SidebarLayout>
                </Route>
                <Route path="/admin/live-call">
                    <SidebarLayout>
                        <AudioUploadPage />
                    </SidebarLayout>
                </Route>
                <Route path="/admin/skus">
                    <SidebarLayout>
                        <SKUPage />
                    </SidebarLayout>
                </Route>
                <Route path="/admin/whatsapp-intake">
                    <SidebarLayout>
                        <WhatsAppInbox />
                    </SidebarLayout>
                </Route>
                <Route path="/admin/handymen">
                    <SidebarLayout>
                        <HandymanMap />
                    </SidebarLayout>
                </Route>
                <Route path="/admin/handyman/dashboard">
                    <SidebarLayout>
                        <ContractorFleetDashboard />
                    </SidebarLayout>
                </Route>
                <Route path="/admin/calls">
                    <SidebarLayout>
                        <CallsPage />
                    </SidebarLayout>
                </Route>
                <Route path="/admin/generate-quote">
                    <SidebarLayout>
                        <GenerateQuoteLink />
                    </SidebarLayout>
                </Route>
                <Route path="/admin/test-lab">
                    <SidebarLayout>
                        <TestLab />
                    </SidebarLayout>
                </Route>
                <Route path="/admin/settings">
                    <SidebarLayout>
                        <SettingsPage />
                    </SidebarLayout>
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
        </Suspense>
    );
}

function App() {
    return (
        <QueryClientProvider client={queryClient}>
            <LiveCallProvider>
                <Router />
                <Toaster />
            </LiveCallProvider>
        </QueryClientProvider>
    );
}

export default App;
