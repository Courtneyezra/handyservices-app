
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

// Lazy load all CRM/admin pages (not needed on initial landing page load)
const AudioUploadPage = lazy(() => import("@/pages/AudioUploadPage"));
const SKUPage = lazy(() => import("@/pages/SKUPage"));
const WhatsAppInbox = lazy(() => import("@/pages/WhatsAppInbox"));
const HandymanMap = lazy(() => import("@/pages/HandymanMap"));
const HandymanDashboard = lazy(() => import("@/pages/HandymanDashboard"));
const GenerateQuoteLink = lazy(() => import("@/pages/GenerateQuoteLink"));
const VideoQuote = lazy(() => import("@/pages/VideoQuote"));
const MainDashboard = lazy(() => import("@/pages/MainDashboard"));
const VideoReview = lazy(() => import("@/pages/VideoReview"));
const PersonalizedQuotePage = lazy(() => import("@/pages/PersonalizedQuotePage"));
const CallsPage = lazy(() => import("@/pages/CallsPage"));
const TestLab = lazy(() => import("./pages/TestLab"));
const TrainingCenter = lazy(() => import("./pages/TrainingCenter"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));

// Contractor Portal - lazy loaded
const ContractorLogin = lazy(() => import("./pages/ContractorLogin"));
const ContractorRegister = lazy(() => import("./pages/ContractorRegister"));
const ContractorPortal = lazy(() => import("./pages/ContractorPortal"));
const ContractorCalendar = lazy(() => import("./pages/ContractorCalendar"));
const ContractorProfile = lazy(() => import("./pages/ContractorProfile"));
const ContractorServiceArea = lazy(() => import("./pages/ContractorServiceArea"));

// Loading fallback for lazy-loaded components
function LoadingFallback() {
    return (
        <div className="flex items-center justify-center min-h-[400px]">
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
                <Route path="/">
                    <SidebarLayout>
                        <MainDashboard />
                    </SidebarLayout>
                </Route>
                <Route path="/audio-upload">
                    <SidebarLayout>
                        <AudioUploadPage />
                    </SidebarLayout>
                </Route>
                <Route path="/live-call">
                    <SidebarLayout>
                        <AudioUploadPage />
                    </SidebarLayout>
                </Route>
                <Route path="/skus">
                    <SidebarLayout>
                        <SKUPage />
                    </SidebarLayout>
                </Route>
                <Route path="/test-lab" component={TestLab} />
                <Route path="/training" component={TrainingCenter} />
                <Route path="/landing" component={HandymanLanding} />
                <Route path="/derby" component={DerbyLanding} />
                <Route path="/whatsapp-intake">
                    <SidebarLayout>
                        <WhatsAppInbox />
                    </SidebarLayout>
                </Route>
                <Route path="/handymen">
                    <SidebarLayout>
                        <HandymanMap />
                    </SidebarLayout>
                </Route>
                <Route path="/handyman/dashboard">
                    <SidebarLayout>
                        <HandymanDashboard />
                    </SidebarLayout>
                </Route>
                <Route path="/calls">
                    <SidebarLayout>
                        <CallsPage />
                    </SidebarLayout>
                </Route>

                {/* Quote Flow Routes */}
                <Route path="/generate-quote">
                    <SidebarLayout>
                        <GenerateQuoteLink />
                    </SidebarLayout>
                </Route>

                {/* Customer facing quote view (Public) */}
                <Route path="/quote-link/:slug">
                    <PersonalizedQuotePage />
                </Route>
                <Route path="/video-quote">
                    <VideoQuote />
                </Route>

                {/* NEW: Video Review Page */}
                <Route path="/video-review">
                    <VideoReview />
                </Route>

                {/* Test Lab */}
                <Route path="/test-lab">
                    <SidebarLayout>
                        <TestLab />
                    </SidebarLayout>
                </Route>

                {/* Settings */}
                <Route path="/settings">
                    <SidebarLayout>
                        <SettingsPage />
                    </SidebarLayout>
                </Route>

                {/* Add stub routes for future flow */}
                <Route path="/instant-price">
                    <div className="p-10 text-center"><h1>Instant Price Page (Coming Soon)</h1></div>
                </Route>

                {/* Contractor Portal Routes */}
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
