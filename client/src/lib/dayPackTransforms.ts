/**
 * Day-Pack transforms — pure helpers shared between the production page and
 * the test page. Mirror the test page's compute logic so the production page
 * can drop in identical UX without re-implementing derivations.
 *
 * The server is the canonical source for `earnedBonusPence` (per ADR-007).
 * These helpers exist for client-side optimistic UX between server confirms.
 */

// ───────────────────────────────────────────────────────────────────────────
// Shared types — the public envelope shape returned by
// GET /api/day-packs/:packId/public.
// ───────────────────────────────────────────────────────────────────────────

export interface DayPackJob {
    num: number;
    slug: string;
    title: string;
    addressLine?: string;
    postcode: string;
    startTime: string;
    endTime: string;
    durationHours: number;
    tier: 'specialist' | 'skilled' | 'general' | 'outdoor';
    category?: string;
    description?: string;
    materials?: string[];
    travelMinutesToNext?: number;
    coords: { lat: number; lng: number };
}

export interface MaterialsPickup {
    required: boolean;
    supplier: string;
    branchName?: string;
    postcode: string;
    openFrom?: string;
    estimatedMinutes: number;
    items: string[];
}

export type PackStatus = 'offered' | 'accepted' | 'in_progress' | 'completed';

export interface DayPackEnvelope {
    packRef: string;
    date: string;
    contractorName: string;
    area: string;
    jobs: DayPackJob[];
    dayRatePence: number;
    completionBonusPence: number;
    totalWorkHours: number;
    totalTravelMinutes: number;
    totalDistanceMiles: number;
    materialsPickup?: MaterialsPickup;
    packStatus: PackStatus;
    acceptedAt?: string;
    bookingState?: string;
    completedStops: number[];
    cancelledStops?: Array<{ sequence: number; reason: string; carveoutHonoured: boolean }>;
    materialsCollected: boolean;
    bondCaptured: boolean;
    earnedBonusPence: number;
    canEarnBonus: boolean;
    photoRequirements: Array<{ sequence: number; minPhotos: number }>;
}

// ───────────────────────────────────────────────────────────────────────────
// Formatters
// ───────────────────────────────────────────────────────────────────────────

export function fmt(p: number): string {
    return `£${Math.round(p / 100)}`;
}

export function fmtDate(iso: string): string {
    return new Date(iso).toLocaleDateString('en-GB', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
    });
}

export function tierDot(tier: string): string {
    switch (tier) {
        case 'specialist':
            return 'bg-indigo-500';
        case 'skilled':
            return 'bg-teal-500';
        case 'outdoor':
            return 'bg-amber-500';
        default:
            return 'bg-slate-400';
    }
}

// ───────────────────────────────────────────────────────────────────────────
// Bonus + progress
//
// All-or-nothing model: bonus is the full `completionBonusPence` only when
// every stop is complete AND (if required) materials are collected.
// ───────────────────────────────────────────────────────────────────────────

export function bonusFromCompleted(
    pack: Pick<DayPackEnvelope, 'jobs' | 'completionBonusPence' | 'materialsPickup'>,
    completedStops: ReadonlySet<number> | number[],
    materialsDone: boolean,
): number {
    const completedSet = completedStops instanceof Set
        ? completedStops
        : new Set(completedStops);
    const allStops = completedSet.size === pack.jobs.length && pack.jobs.length > 0;
    const pickupRequired = !!pack.materialsPickup?.required;
    const pickupOk = !pickupRequired || materialsDone;
    return allStops && pickupOk ? pack.completionBonusPence : 0;
}

export function progressPct(
    pack: Pick<DayPackEnvelope, 'jobs' | 'materialsPickup'>,
    completedStops: ReadonlySet<number> | number[],
    materialsDone: boolean,
): number {
    const completedCount = completedStops instanceof Set ? completedStops.size : completedStops.length;
    const totalStops = pack.jobs.length;
    const pickupRequired = !!pack.materialsPickup?.required;
    const totalSteps = totalStops + (pickupRequired ? 1 : 0);
    const completedSteps = completedCount + (pickupRequired && materialsDone ? 1 : 0);
    if (totalSteps === 0) return 0;
    return (completedSteps / totalSteps) * 100;
}

export function computeMaxPotential(pack: Pick<DayPackEnvelope, 'dayRatePence' | 'completionBonusPence'>): number {
    return pack.dayRatePence + pack.completionBonusPence;
}

// ───────────────────────────────────────────────────────────────────────────
// Map URL builders — same logic as the test page so both routes render
// identical Google Static maps + deep-link.
// ───────────────────────────────────────────────────────────────────────────

export function buildMapStaticUrl(pack: Pick<DayPackEnvelope, 'jobs'>, widthPx = 680, heightPx = 320): string {
    const key = (import.meta as unknown as { env?: { VITE_GOOGLE_MAPS_API_KEY?: string } }).env?.VITE_GOOGLE_MAPS_API_KEY;
    const points = pack.jobs.map((j) => `${j.coords.lat},${j.coords.lng}`);
    const markers = pack.jobs
        .map((_j, i) => `markers=color:0x1B2A4A%7Clabel:${i + 1}%7C${points[i]}`)
        .join('&');
    const pathParam = `path=color:0x1B2A4Acc%7Cweight:4%7C${points.join('%7C')}`;
    const style = [
        'feature:poi|visibility:off',
        'feature:transit|visibility:off',
        'feature:road|element:labels.icon|visibility:off',
    ]
        .map((s) => `style=${encodeURIComponent(s)}`)
        .join('&');
    return `https://maps.googleapis.com/maps/api/staticmap?size=${widthPx}x${heightPx}&scale=2&maptype=roadmap&${markers}&${pathParam}&${style}&key=${key || ''}`;
}

export function buildMapDeepLink(pack: Pick<DayPackEnvelope, 'jobs'>): string {
    if (pack.jobs.length === 0) return 'https://www.google.com/maps';
    const formatPoint = (j: DayPackJob) => `${j.coords.lat},${j.coords.lng}`;
    const origin = formatPoint(pack.jobs[0]);
    const destination = formatPoint(pack.jobs[pack.jobs.length - 1]);
    const waypoints = pack.jobs.slice(1, -1).map(formatPoint).join('|');
    const wpParam = waypoints ? `&waypoints=${encodeURIComponent(waypoints)}` : '';
    return `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}${wpParam}&travelmode=driving`;
}
