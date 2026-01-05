
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
import HandymanDashboard from "@/pages/HandymanDashboard";
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

                {/* Contractor Portal Routes (separate auth) */}
                <Route path="/contractor/login">
                    <ContractorLogin />
                </Route>
                <Route path="/contractor/register">
                    <ContractorRegister />
                </Route>
                <Route path="/contractor">
                    <ContractorPortal />
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
                        <HandymanDashboard />
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
