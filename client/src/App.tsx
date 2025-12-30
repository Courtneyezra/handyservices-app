
import { Switch, Route, useLocation } from "wouter";
import AudioUploadPage from "@/pages/AudioUploadPage";
import SKUPage from "@/pages/SKUPage";
import HandymanLanding from "@/pages/HandymanLanding";
import WhatsAppInbox from "@/pages/WhatsAppInbox";
import HandymanMap from "@/pages/HandymanMap";
import HandymanDashboard from "@/pages/HandymanDashboard";
import SidebarLayout from "@/components/layout/SidebarLayout";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { LiveCallProvider } from "@/contexts/LiveCallContext";
import GenerateQuoteLink from "@/pages/GenerateQuoteLink";
import VideoQuote from "@/pages/VideoQuote";
import MainDashboard from "@/pages/MainDashboard";
import VideoReview from "@/pages/VideoReview";
import PersonalizedQuotePage from "@/pages/PersonalizedQuotePage";
import CallsPage from "@/pages/CallsPage";
import TestLab from './pages/TestLab';
import TrainingCenter from './pages/TrainingCenter';
import SettingsPage from './pages/SettingsPage';
import ContractorLogin from './pages/ContractorLogin';
import ContractorRegister from './pages/ContractorRegister';
import ContractorPortal from './pages/ContractorPortal';
import ContractorCalendar from './pages/ContractorCalendar';
import ContractorProfile from './pages/ContractorProfile';
import ContractorServiceArea from './pages/ContractorServiceArea';
import { Toaster } from "@/components/ui/toaster";

function Router() {
    const [location] = useLocation();
    console.log("Current routed path:", location);

    return (
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
