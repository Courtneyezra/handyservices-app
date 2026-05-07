/**
 * SegmentDashboardRouter — Module 09 §2.
 *
 * Mounted at `/contractor/dashboard` index route. After auth resolves the
 * contractor's `contractor_segment` from /api/contractor/me, redirects to the
 * default landing for that segment:
 *
 *   builder    → /contractor/dashboard/day-packs
 *   gap_filler → /contractor/dashboard/jobs
 *   specialist → /contractor/dashboard/specialist-queue
 *   null       → /contractor/dashboard/calendar  (legacy default)
 *
 * Direct deep-links continue to work — this router only governs the *default*
 * landing tab. When FF_CONTRACTOR_APP_V2 is OFF, every contractor falls
 * through to the legacy CalendarTab via the rendering branch in App.tsx.
 */

import { useEffect } from 'react';
import { useLocation } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useFeatureFlags } from '@/hooks/useFeatureFlags';
import CalendarTab from '@/pages/contractor/dashboard/CalendarTab';
import AvailabilityScheduler from '@/pages/contractor/dashboard/AvailabilityScheduler';

type Segment = 'builder' | 'gap_filler' | 'specialist' | null;

interface ProfileResp {
    profile: { contractorSegment?: Segment } | null;
}

function getCleanToken(): string | null {
    const token = localStorage.getItem('contractorToken');
    return token?.trim().replace(/[^a-zA-Z0-9._-]/g, '') ?? null;
}

export default function SegmentDashboardRouter() {
    const flags = useFeatureFlags();
    const [, setLocation] = useLocation();

    // Always fetch — needed even when flag is off so we can render legacy
    // calendar without an extra round-trip when the flag flips.
    const { data, isLoading, isError } = useQuery<ProfileResp>({
        queryKey: ['contractor-profile-segment'],
        queryFn: async () => {
            const token = getCleanToken();
            const res = await fetch('/api/contractor/me', {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (!res.ok) throw new Error('Failed to fetch profile');
            return res.json();
        },
        // Cache aggressively — segment rarely changes within a session.
        staleTime: 5 * 60_000,
        // Skip the network call entirely when the flag is off — we always
        // fall through to the legacy tab in that case.
        enabled: flags.contractor_app_v2,
    });

    const segment: Segment = data?.profile?.contractorSegment ?? null;

    useEffect(() => {
        if (!flags.contractor_app_v2) return;
        if (isLoading || isError) return;
        if (segment === 'builder') {
            setLocation('/contractor/dashboard/day-packs');
        } else if (segment === 'specialist') {
            setLocation('/contractor/dashboard/specialist-queue');
        } else if (segment === 'gap_filler') {
            setLocation('/contractor/dashboard/jobs');
        }
        // null / legacy → render legacy calendar inline (handled below)
    }, [flags.contractor_app_v2, isLoading, isError, segment, setLocation]);

    // Flag OFF or legacy/null segment → render the legacy calendar inline
    // exactly as today (preserves existing /contractor/dashboard behaviour).
    if (!flags.contractor_app_v2 || (!isLoading && !segment)) {
        return <CalendarTabFallback />;
    }

    // Briefly show a spinner while the profile resolves and the redirect runs.
    return (
        <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-amber-500" />
        </div>
    );
}

function CalendarTabFallback() {
    // Mirror App.tsx CalendarTabSwitch — v2 scheduler when availability_engine
    // is on, legacy CalendarTab otherwise. Imported eagerly here so the
    // fallback path is instant.
    const { availability_engine } = useFeatureFlags();
    return availability_engine ? <AvailabilityScheduler /> : <CalendarTab />;
}
