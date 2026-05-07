import { ReactNode } from 'react';
import { useLocation, Link } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import {
    Calendar,
    Briefcase,
    User,
    CalendarRange,
    PoundSterling,
    ShieldCheck,
    Wrench,
} from 'lucide-react';
import { useFeatureFlags } from '@/hooks/useFeatureFlags';

type Segment = 'builder' | 'gap_filler' | 'specialist' | null;

interface ProfileResp {
    profile: { contractorSegment?: Segment } | null;
}

function getCleanToken(): string | null {
    const token = localStorage.getItem('contractorToken');
    return token?.trim().replace(/[^a-zA-Z0-9._-]/g, '') ?? null;
}

interface TabDef {
    path: string;
    label: string;
    icon: typeof Calendar;
    /** Sub-paths that should also highlight this tab (prefix match). */
    matchPrefixes?: string[];
}

const LEGACY_TABS: TabDef[] = [
    { path: '/contractor/dashboard', label: 'Calendar', icon: Calendar },
    { path: '/contractor/dashboard/jobs', label: 'My Jobs', icon: Briefcase, matchPrefixes: ['/contractor/dashboard/jobs'] },
    { path: '/contractor/dashboard/settings', label: 'Profile', icon: User },
];

const BUILDER_TABS: TabDef[] = [
    { path: '/contractor/dashboard/day-packs', label: 'Day-Packs', icon: CalendarRange },
    { path: '/contractor/dashboard', label: 'Calendar', icon: Calendar },
    { path: '/contractor/dashboard/earnings', label: 'Earnings', icon: PoundSterling },
    { path: '/contractor/dashboard/pay-protection', label: 'Pay', icon: ShieldCheck },
    { path: '/contractor/dashboard/settings', label: 'Profile', icon: User },
];

const GAP_FILLER_TABS: TabDef[] = [
    { path: '/contractor/dashboard/jobs', label: 'Jobs', icon: Briefcase, matchPrefixes: ['/contractor/dashboard/jobs'] },
    { path: '/contractor/dashboard', label: 'Calendar', icon: Calendar },
    { path: '/contractor/dashboard/earnings', label: 'Earnings', icon: PoundSterling },
    { path: '/contractor/dashboard/pay-protection', label: 'Pay', icon: ShieldCheck },
    { path: '/contractor/dashboard/settings', label: 'Profile', icon: User },
];

const SPECIALIST_TABS: TabDef[] = [
    { path: '/contractor/dashboard/specialist-queue', label: 'Queue', icon: Wrench },
    { path: '/contractor/dashboard', label: 'Calendar', icon: Calendar },
    { path: '/contractor/dashboard/earnings', label: 'Earnings', icon: PoundSterling },
    { path: '/contractor/dashboard/pay-protection', label: 'Pay', icon: ShieldCheck },
    { path: '/contractor/dashboard/settings', label: 'Profile', icon: User },
];

interface ContractorPortalLayoutProps {
    children: ReactNode;
}

export default function ContractorPortalLayout({ children }: ContractorPortalLayoutProps) {
    const [location] = useLocation();
    const flags = useFeatureFlags();

    const { data: profileData } = useQuery<ProfileResp>({
        queryKey: ['contractor-profile-segment'],
        queryFn: async () => {
            const token = getCleanToken();
            const res = await fetch('/api/contractor/me', {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (!res.ok) throw new Error('Failed');
            return res.json();
        },
        staleTime: 5 * 60_000,
        enabled: flags.contractor_app_v2,
    });

    const segment: Segment = profileData?.profile?.contractorSegment ?? null;

    let tabs: TabDef[] = LEGACY_TABS;
    if (flags.contractor_app_v2) {
        if (segment === 'builder') tabs = BUILDER_TABS;
        else if (segment === 'specialist') tabs = SPECIALIST_TABS;
        else if (segment === 'gap_filler') tabs = GAP_FILLER_TABS;
        else tabs = GAP_FILLER_TABS; // null/legacy fallback in v2 still gets the new shell
    }

    return (
        <div className="min-h-screen bg-slate-950 text-slate-100">
            {/* Main content with bottom padding for tab bar */}
            <main className="pb-24">
                {children}
            </main>

            {/* Fixed bottom tab bar */}
            <nav className="fixed bottom-0 left-0 right-0 z-50 bg-slate-950/95 backdrop-blur-lg border-t border-slate-800 safe-area-pb">
                <div className="flex items-center justify-around h-16 max-w-lg mx-auto">
                    {tabs.map((tab) => {
                        const isActive =
                            location === tab.path ||
                            (tab.matchPrefixes?.some(p => location.startsWith(p)) ?? false);
                        const Icon = tab.icon;

                        return (
                            <Link key={tab.path} href={tab.path}>
                                <button className="flex flex-col items-center gap-1 px-3 py-2 transition-colors">
                                    <Icon
                                        size={20}
                                        className={isActive ? 'text-amber-500' : 'text-slate-500'}
                                    />
                                    <span className={`text-[10px] font-semibold ${
                                        isActive ? 'text-amber-500' : 'text-slate-500'
                                    }`}>
                                        {tab.label}
                                    </span>
                                </button>
                            </Link>
                        );
                    })}
                </div>
            </nav>
        </div>
    );
}
