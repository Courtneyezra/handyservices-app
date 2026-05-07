/**
 * DayPackOfferPage — Module 15 (production day-pack page).
 *
 * URL: /dispatch/:packId?token=<contractor-token>
 *
 * Production version of /dispatch-preview. Visually identical to the test page
 * (DispatchPreviewPage.tsx) but every interaction is wired to a real backend:
 *   - pack data via GET /api/day-packs/:packId/public
 *   - mark-stop-complete with REQUIRED ≥1 photo upload
 *   - mark-materials-collected via POST
 *   - accept day via POST /api/contractor/day-packs/:packId/accept
 *
 * Per Module 14 §3 the test page stays untouched and resets locally; this
 * page never resets — every state change is server-persisted.
 *
 * Per Module 15 §12, when FF_DAY_PACK_PAGE_PROD is OFF the page renders a
 * "Coming soon" placeholder with a link to the test page.
 */

import { useState, useEffect, useRef } from 'react';
import { useParams } from 'wouter';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Check,
    X,
    MapPin,
    Hammer,
    Package,
    ChevronDown,
    Trophy,
    ShieldCheck,
    ExternalLink,
    Loader2,
    Camera,
} from 'lucide-react';

import { useFeatureFlags } from '@/hooks/useFeatureFlags';
import {
    useDayPack,
    useMarkStopComplete,
    useMarkMaterialsCollected,
    useAcceptDayPack,
    useDeclineDayPack,
} from '@/hooks/useDayPack';
import {
    fmt,
    fmtDate,
    bonusFromCompleted,
    progressPct,
    buildMapStaticUrl,
    buildMapDeepLink,
    type DayPackEnvelope,
} from '@/lib/dayPackTransforms';
import PhotoUpload from '@/components/contractor/PhotoUpload';

const fadeInUp = {
    initial: { opacity: 0, y: 8 },
    whileInView: { opacity: 1, y: 0 },
    viewport: { once: true },
    transition: { duration: 0.35 },
} as const;

// Read token from query string (wouter exposes /:packId; the token rides as ?token=).
function getTokenFromQuery(): string {
    if (typeof window === 'undefined') return '';
    const params = new URLSearchParams(window.location.search);
    return (params.get('token') ?? '').trim();
}

export default function DayPackOfferPage() {
    const flags = useFeatureFlags();
    const { packId = '' } = useParams<{ packId: string }>();
    const token = getTokenFromQuery();

    // ───────────────────────────────────────────────────────────────────────
    // Flag-off → "Coming soon" placeholder + link to the test page.
    // Module 15 §12 — production page is dormant until FF_DAY_PACK_PAGE_PROD on.
    // ───────────────────────────────────────────────────────────────────────
    if (!flags.day_pack_page_prod) {
        return <ComingSoon />;
    }

    if (!packId || !token) {
        return <UnavailableState message="Missing pack id or contractor token" />;
    }

    return <DayPackOfferPageInner packId={packId} token={token} />;
}

// ─── Inner component (only rendered when flag is ON + we have packId+token) ──

function DayPackOfferPageInner({ packId, token }: { packId: string; token: string }) {
    const { data: pack, isLoading, isError, error } = useDayPack(packId, token);
    const markStopComplete = useMarkStopComplete(packId, token);
    const markMaterialsCollected = useMarkMaterialsCollected(packId, token);
    const acceptPack = useAcceptDayPack(packId, token);
    const declinePack = useDeclineDayPack(packId, token);

    // Local UI-only state
    const [decided, setDecided] = useState<'accepted' | 'declined' | null>(null);
    const [expandedStop, setExpandedStop] = useState<number | null>(null);
    const [photoStop, setPhotoStop] = useState<number | null>(null);
    const [stopPhotos, setStopPhotos] = useState<string[]>([]);
    const [stopNotes, setStopNotes] = useState('');
    const [confettiOn, setConfettiOn] = useState(false);
    const [toast, setToast] = useState<{ id: number; msg: string; tone: 'bonus' | 'win' } | null>(null);
    const toastIdRef = useRef(0);
    const prevCanEarnRef = useRef(false);

    function showToast(msg: string, tone: 'bonus' | 'win' = 'bonus') {
        toastIdRef.current += 1;
        setToast({ id: toastIdRef.current, msg, tone });
        const myId = toastIdRef.current;
        setTimeout(() => setToast((t) => (t?.id === myId ? null : t)), 2400);
    }

    // Confetti idempotency (Module 15 §5) — fire only on observed false→true,
    // and persist across reloads so refresh doesn't re-fire.
    useEffect(() => {
        if (!pack) return;
        const localKey = `pack-${packId}-confetti-fired`;
        const alreadyFired = typeof localStorage !== 'undefined' && localStorage.getItem(localKey) === '1';
        if (pack.canEarnBonus && !prevCanEarnRef.current && !alreadyFired) {
            setConfettiOn(true);
            showToast(`Day complete · +${fmt(pack.completionBonusPence)} bonus unlocked!`, 'win');
            try {
                localStorage.setItem(localKey, '1');
            } catch {
                /* ignore */
            }
            const t = setTimeout(() => setConfettiOn(false), 4000);
            prevCanEarnRef.current = pack.canEarnBonus;
            return () => clearTimeout(t);
        }
        prevCanEarnRef.current = pack.canEarnBonus;
    }, [pack, packId]);

    // ─── Loading / error states ─────────────────────────────────────────────
    if (isLoading) return <LoadingSkeleton />;
    if (isError || !pack) {
        const status = (error as { status?: number } | null | undefined)?.status;
        if (status === 401 || status === 403) {
            return <UnavailableState message="This day-pack link isn't valid for this account." />;
        }
        if (status === 404 || status === 410) {
            return <UnavailableState message="This day-pack is no longer available." />;
        }
        return <UnavailableState message="We couldn't load this day-pack. Try again in a moment." />;
    }

    // ─── Derived values ─────────────────────────────────────────────────────
    const completedStops = new Set(pack.completedStops);
    const completedCount = completedStops.size;
    const totalStops = pack.jobs.length;
    const pickupRequired = !!pack.materialsPickup?.required;
    const materialsDone = pack.materialsCollected;
    const earnedBonusPence = pack.earnedBonusPence;
    const allComplete = pack.canEarnBonus;
    const totalSteps = totalStops + (pickupRequired ? 1 : 0);
    const completedSteps = completedCount + (pickupRequired && materialsDone ? 1 : 0);
    const progress = progressPct(pack, completedStops, materialsDone);
    const mapStaticUrl = buildMapStaticUrl(pack);
    const mapDeepLink = buildMapDeepLink(pack);
    const isAccepted = pack.packStatus === 'accepted' || pack.packStatus === 'in_progress' || pack.packStatus === 'completed';

    function toggleExpanded(num: number) {
        setExpandedStop((prev) => (prev === num ? null : num));
    }

    function openPhotoSheet(num: number) {
        setPhotoStop(num);
        setStopPhotos([]);
        setStopNotes('');
    }

    function closePhotoSheet() {
        setPhotoStop(null);
        setStopPhotos([]);
        setStopNotes('');
    }

    async function submitStop() {
        if (photoStop == null) return;
        if (stopPhotos.length < 1) return;
        try {
            await markStopComplete.mutateAsync({ stopNum: photoStop, photos: stopPhotos, notes: stopNotes || undefined });
            const remaining = totalStops - (completedCount + 1);
            const msg = remaining <= 0 ? `Stop ${photoStop} done · day complete!` : `Stop ${photoStop} done · ${remaining} to go`;
            showToast(msg, 'bonus');
            closePhotoSheet();
        } catch (err) {
            showToast(err instanceof Error ? err.message : 'Failed — try again', 'bonus');
        }
    }

    async function toggleMaterials() {
        try {
            await markMaterialsCollected.mutateAsync({ collected: !materialsDone });
            if (!materialsDone && pack.materialsPickup) {
                showToast(`Materials collected · ${pack.materialsPickup.supplier}`, 'bonus');
            }
        } catch (err) {
            showToast(err instanceof Error ? err.message : 'Failed — try again', 'bonus');
        }
    }

    async function handleAccept() {
        try {
            await acceptPack.mutateAsync();
            setDecided('accepted');
            showToast('Day-pack accepted', 'win');
        } catch (err) {
            showToast(err instanceof Error ? err.message : 'Accept failed — try again', 'bonus');
        }
    }

    async function handleDecline() {
        try {
            await declinePack.mutateAsync({});
            setDecided('declined');
        } catch (err) {
            showToast(err instanceof Error ? err.message : 'Decline failed — try again', 'bonus');
        }
    }

    return (
        <div className="min-h-screen bg-[#F7F8FC] font-['Poppins',sans-serif] text-[#111827] selection:bg-[#1B2A4A]/20 pb-32">
            {/* Brand nav bar */}
            <header className="bg-[#1B2A4A] text-white">
                <div className="max-w-[680px] mx-auto px-4 py-2.5 flex items-center gap-3">
                    <img src="/logo.png" alt="Handy" className="w-8 h-8 object-contain shrink-0" />
                    <div className="flex-1 min-w-0">
                        <p className="font-bold text-[14px] leading-tight">Handy Services</p>
                        <p className="text-[10px] leading-tight">
                            <span className="text-[#F5A623]">★★★★★</span>
                            <span className="text-white/80 ml-1">4.9 · 300+ reviews</span>
                        </p>
                    </div>
                    <a href="tel:07449501762" className="text-[12px] font-bold text-white whitespace-nowrap">
                        07449 501 762
                    </a>
                </div>
            </header>

            {/* Yellow accent strip */}
            <div className="bg-[#F5A623] text-[#1B2A4A]">
                <p className="max-w-[680px] mx-auto px-4 py-1.5 text-[11px] font-bold tracking-[0.04em] text-center">
                    DAY-PACK · {fmtDate(pack.date).toUpperCase()}
                </p>
            </div>

            <main className="max-w-[680px] mx-auto px-4 py-6 space-y-5">
                {/* HERO */}
                <motion.div {...fadeInUp}>
                    <div className="rounded-2xl p-6 sm:p-7 shadow-[0_12px_40px_rgba(27,42,74,0.18)] relative overflow-hidden bg-gradient-to-br from-[#1B2A4A] via-[#152340] to-[#0E1933]">
                        <div className="absolute -top-24 -right-24 w-80 h-80 bg-[#F5A623]/15 rounded-full blur-3xl pointer-events-none" />
                        <div className="absolute -bottom-32 -left-20 w-72 h-72 bg-[#F5A623]/10 rounded-full blur-3xl pointer-events-none" />

                        <div className="relative">
                            <p className="text-[10px] uppercase tracking-[0.12em] font-semibold text-white/60 mb-2">
                                Hi {pack.contractorName}
                            </p>
                            <p className="text-6xl sm:text-7xl font-bold text-[#F5A623] tabular-nums tracking-tight leading-none drop-shadow-[0_2px_12px_rgba(245,166,35,0.25)]">
                                <motion.span
                                    key={`hero-${pack.dayRatePence + earnedBonusPence}`}
                                    initial={{ scale: earnedBonusPence > 0 ? 1.15 : 1 }}
                                    animate={{ scale: 1 }}
                                    transition={{ type: 'spring', stiffness: 300, damping: 18 }}
                                    className="inline-block"
                                >
                                    {fmt(pack.dayRatePence + earnedBonusPence)}
                                </motion.span>
                            </p>
                            <p className="text-[11px] uppercase tracking-[0.1em] text-white/60 mt-2 font-bold">
                                {earnedBonusPence > 0
                                    ? <>+{fmt(earnedBonusPence)} earned</>
                                    : <>{pack.jobs.length} stops · finish all for +{fmt(pack.completionBonusPence)}</>}
                            </p>

                            {/* Progress bar */}
                            <div className="mt-4 pt-4 border-t border-white/10">
                                <div className="flex items-baseline justify-between mb-2">
                                    <span className="text-[10px] uppercase tracking-[0.08em] font-semibold text-white/65">
                                        Progress · {completedSteps}/{totalSteps} {pickupRequired ? 'steps' : 'stops'}
                                    </span>
                                    <motion.span
                                        key={`bonus-${earnedBonusPence}`}
                                        initial={{ scale: 1 }}
                                        animate={{ scale: completedCount > 0 ? [1.2, 1] : 1 }}
                                        transition={{ duration: 0.3 }}
                                        className={`text-[13px] font-bold tabular-nums ${earnedBonusPence > 0 ? 'text-[#F5A623]' : 'text-white/45'}`}
                                    >
                                        +{fmt(earnedBonusPence)} earned
                                    </motion.span>
                                </div>
                                <div className="h-2 rounded-full bg-white/10 overflow-hidden">
                                    <motion.div
                                        className="h-full bg-gradient-to-r from-[#F5A623] to-[#F5A623]"
                                        initial={{ width: 0 }}
                                        animate={{ width: `${progress}%` }}
                                        transition={{ duration: 0.5, ease: 'easeOut' }}
                                    />
                                </div>
                            </div>

                            <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-[13px] text-white/85">
                                <span className="inline-flex items-center gap-2">
                                    <ShieldCheck className="h-4 w-4 text-[#F5A623]" />
                                    {fmt(pack.dayRatePence)} guaranteed
                                </span>
                            </div>
                        </div>
                    </div>
                </motion.div>

                {/* MAP */}
                <motion.div {...fadeInUp}>
                    <a
                        href={mapDeepLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block bg-white rounded-2xl border border-[#D0D5E3] overflow-hidden active:scale-[0.99] transition-transform"
                    >
                        <img
                            src={mapStaticUrl}
                            alt={`Day-pack route map across ${pack.area}`}
                            className="w-full h-auto block"
                            loading="lazy"
                        />
                        <div className="flex items-center justify-center gap-1.5 p-3 text-[13px] font-semibold text-[#1B2A4A] border-t border-[#D0D5E3]">
                            Open in Google Maps
                            <ExternalLink className="h-3.5 w-3.5" />
                        </div>
                    </a>
                </motion.div>

                {/* TIMELINE */}
                <motion.div {...fadeInUp}>
                    <div className="bg-white rounded-2xl border border-[#D0D5E3] overflow-hidden">
                        <ol className="relative">
                            {/* Materials pickup row */}
                            {pickupRequired && pack.materialsPickup && (
                                <li className="relative">
                                    <span
                                        className={`absolute left-[29px] top-[44px] -bottom-4 w-[2px] transition-colors pointer-events-none z-0 ${materialsDone ? 'bg-[#1B2A4A]' : 'bg-[#D0D5E3]'}`}
                                        aria-hidden
                                    />
                                    <div className="flex items-start gap-3 p-4">
                                        <span
                                            aria-hidden
                                            className={`relative w-7 h-7 rounded-full flex items-center justify-center shrink-0 z-[1] transition-all ${
                                                materialsDone
                                                    ? 'bg-[#1B2A4A] border-2 border-[#1B2A4A]'
                                                    : 'bg-white border-2 border-[#1B2A4A]'
                                            }`}
                                        >
                                            {materialsDone
                                                ? <Check className="h-4 w-4 text-white stroke-[3]" />
                                                : <Package className="h-3.5 w-3.5 text-[#1B2A4A]" />}
                                        </span>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 mb-0.5">
                                                <span className="text-[10px] uppercase tracking-[0.08em] font-bold text-[#F5A623]">
                                                    Pickup before {pack.materialsPickup.openFrom ?? 'start'}
                                                </span>
                                            </div>
                                            <p className={`text-[15px] font-bold leading-snug transition-colors ${materialsDone ? 'text-[#6B7280] line-through decoration-[#1B2A4A]/40' : 'text-[#111827]'}`}>
                                                {pack.materialsPickup.supplier}
                                                {pack.materialsPickup.branchName ? <> · {pack.materialsPickup.branchName}</> : null}
                                            </p>
                                            <p className="text-[12px] text-[#6B7280] mt-1 leading-snug">
                                                {pack.materialsPickup.postcode} · ~{pack.materialsPickup.estimatedMinutes} min · {pack.materialsPickup.items.length} items
                                            </p>
                                            <div className="flex flex-wrap gap-1.5 mt-2">
                                                {pack.materialsPickup.items.map((m, i) => (
                                                    <span key={i} className="text-[11px] bg-[#F7F8FC] text-[#6B7280] px-2 py-0.5 rounded-md">
                                                        {m}
                                                    </span>
                                                ))}
                                            </div>
                                            <div className="mt-3 flex flex-wrap items-center gap-2">
                                                {!materialsDone ? (
                                                    <button
                                                        onClick={toggleMaterials}
                                                        disabled={!isAccepted || markMaterialsCollected.isPending}
                                                        className="inline-flex items-center gap-1.5 bg-[#1B2A4A] text-white rounded-full px-3.5 py-1.5 text-[12px] font-bold active:scale-[0.97] transition-transform disabled:opacity-50"
                                                    >
                                                        {markMaterialsCollected.isPending
                                                            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                                            : <Check className="h-3.5 w-3.5 stroke-[3]" />}
                                                        Mark collected
                                                    </button>
                                                ) : (
                                                    <button
                                                        onClick={toggleMaterials}
                                                        disabled={markMaterialsCollected.isPending}
                                                        className="inline-flex items-center gap-1.5 bg-white border border-[#1B2A4A]/30 text-[#1B2A4A] rounded-full px-3 py-1 text-[11px] font-bold active:scale-[0.97] transition-transform"
                                                    >
                                                        <Check className="h-3 w-3 stroke-[3]" />
                                                        Collected
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </li>
                            )}

                            {pack.jobs.map((job) => {
                                const isComplete = completedStops.has(job.num);
                                const isExpanded = expandedStop === job.num;
                                const hasDetails = job.description || (job.materials && job.materials.length > 0);
                                return (
                                    <li key={job.num} className="relative">
                                        <span
                                            className={`absolute left-[29px] top-[44px] -bottom-4 w-[2px] transition-colors pointer-events-none z-0 ${isComplete ? 'bg-[#1B2A4A]' : 'bg-[#D0D5E3]'}`}
                                            aria-hidden
                                        />
                                        <div className="flex items-start gap-3 p-4">
                                            <span
                                                aria-hidden
                                                className={`relative w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold tabular-nums shrink-0 z-[1] transition-all ${
                                                    isComplete
                                                        ? 'bg-[#1B2A4A] border-2 border-[#1B2A4A] text-white'
                                                        : 'bg-white border-2 border-[#1B2A4A] text-[#1B2A4A]'
                                                }`}
                                            >
                                                {isComplete ? <Check className="h-4 w-4 stroke-[3]" /> : job.num}
                                            </span>
                                            <div className="flex-1 min-w-0">
                                                <button
                                                    onClick={() => toggleExpanded(job.num)}
                                                    className="w-full text-left -my-1 py-1 -mx-1 px-1 rounded-md active:bg-[#F7F8FC] transition-colors"
                                                >
                                                    <div className="flex items-start gap-2">
                                                        <div className="flex-1 min-w-0">
                                                            <p className={`text-[15px] font-bold leading-snug transition-colors ${isComplete ? 'text-[#6B7280] line-through decoration-[#1B2A4A]/40' : 'text-[#111827]'}`}>
                                                                {job.title}
                                                            </p>
                                                            <p className="text-[12px] text-[#6B7280] mt-1 leading-snug">
                                                                {job.addressLine ? <>{job.addressLine} · </> : null}
                                                                {job.postcode}
                                                            </p>
                                                        </div>
                                                        {hasDetails && (
                                                            <ChevronDown
                                                                className={`h-4 w-4 text-[#6B7280] shrink-0 mt-1 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                                                            />
                                                        )}
                                                    </div>
                                                </button>
                                                <div className="mt-3 flex flex-wrap items-center gap-2">
                                                    {!isComplete ? (
                                                        <button
                                                            onClick={() => openPhotoSheet(job.num)}
                                                            disabled={!isAccepted}
                                                            className="inline-flex items-center gap-1.5 bg-[#1B2A4A] text-white rounded-full px-3.5 py-1.5 text-[12px] font-bold active:scale-[0.97] transition-transform disabled:opacity-50"
                                                            aria-label={`Mark stop ${job.num} complete`}
                                                        >
                                                            <Camera className="h-3.5 w-3.5 stroke-[3]" />
                                                            Mark complete
                                                        </button>
                                                    ) : (
                                                        <span className="inline-flex items-center gap-1.5 bg-white border border-[#1B2A4A]/30 text-[#1B2A4A] rounded-full px-3 py-1 text-[11px] font-bold">
                                                            <Check className="h-3 w-3 stroke-[3]" />
                                                            Done
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                        <AnimatePresence initial={false}>
                                            {isExpanded && hasDetails && (
                                                <motion.div
                                                    initial={{ height: 0, opacity: 0 }}
                                                    animate={{ height: 'auto', opacity: 1 }}
                                                    exit={{ height: 0, opacity: 0 }}
                                                    transition={{ duration: 0.2, ease: 'easeOut' }}
                                                    className="overflow-hidden"
                                                >
                                                    <div className="pl-[56px] pr-4 pb-4 space-y-2.5 text-left">
                                                        {job.description && (
                                                            <p className="text-[12px] text-[#6B7280] leading-relaxed">
                                                                {job.description}
                                                            </p>
                                                        )}
                                                        {job.materials && job.materials.length > 0 && (
                                                            <div className="flex flex-wrap gap-1.5">
                                                                {job.materials.map((m, i) => (
                                                                    <span key={i} className="text-[11px] bg-[#F7F8FC] text-[#6B7280] px-2 py-0.5 rounded-md">
                                                                        {m}
                                                                    </span>
                                                                ))}
                                                            </div>
                                                        )}
                                                        <p className="text-[10px] text-[#6B7280] font-mono pt-1">
                                                            #{job.slug}
                                                        </p>
                                                    </div>
                                                </motion.div>
                                            )}
                                        </AnimatePresence>
                                    </li>
                                );
                            })}

                            {/* Bonus unlock node */}
                            <li>
                                <motion.div
                                    animate={{ scale: allComplete ? [1.02, 1] : 1 }}
                                    transition={{ duration: 0.4 }}
                                    className={`flex items-center gap-3 p-4 transition-all ${
                                        allComplete ? 'bg-[#FFF8EC] border-l-4 border-l-[#F5A623]' : ''
                                    }`}
                                >
                                    <div
                                        className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 transition-all ${
                                            allComplete
                                                ? 'bg-[#F5A623] border-2 border-[#F5A623]'
                                                : 'bg-white border-2 border-[#D0D5E3]'
                                        }`}
                                        aria-hidden
                                    >
                                        <Trophy className={`h-4 w-4 ${allComplete ? 'text-white' : 'text-[#6B7280]'}`} />
                                    </div>
                                    <p className="flex-1 min-w-0 text-[13px] font-bold leading-tight text-[#1B2A4A] truncate">
                                        {allComplete ? 'Day complete' : 'Finish all · bonus'}
                                    </p>
                                    <span className={`text-[16px] font-bold tabular-nums shrink-0 ${allComplete ? 'text-[#92591E]' : 'text-[#F5A623]'}`}>
                                        +{fmt(pack.completionBonusPence)}
                                    </span>
                                </motion.div>
                            </li>
                        </ol>
                    </div>
                </motion.div>

                {/* PAY PROTECTION */}
                <motion.div {...fadeInUp}>
                    <details className="group bg-white rounded-2xl border border-[#D0D5E3] overflow-hidden">
                        <summary className="flex items-center gap-3 p-4 cursor-pointer hover:bg-[#F7F8FC] transition-colors list-none [&::-webkit-details-marker]:hidden">
                            <div className="w-8 h-8 rounded-lg bg-[#1B2A4A]/10 flex items-center justify-center shrink-0">
                                <ShieldCheck className="h-4 w-4 text-[#1B2A4A]" />
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="text-[13px] font-semibold text-[#111827] leading-tight">
                                    Pay protection · 6 guarantees
                                </p>
                                <p className="text-[11px] text-[#6B7280] mt-0.5">
                                    Day-rate floor · uplifts · call-outs · cancellations · materials · 48h pay
                                </p>
                            </div>
                            <ChevronDown className="h-4 w-4 text-[#6B7280] shrink-0 transition-transform group-open:rotate-180" />
                        </summary>
                        <div className="px-4 pb-4 pt-0 space-y-2 border-t border-[#D0D5E3]">
                            {[
                                { label: 'Day-rate guarantee', detail: `${fmt(pack.dayRatePence)} guaranteed even if jobs cancel` },
                                { label: 'Mis-scope auto-uplift', detail: 'If a job runs over our estimate, we pay extra' },
                                { label: 'Call-out fee', detail: '£45 if customer\'s not home or you can\'t start' },
                                { label: 'Cancellation comp', detail: 'Comp if customer cancels last-minute' },
                                { label: 'Materials reimbursement', detail: 'Receipt + 10% handling' },
                                { label: '48h pay', detail: 'Money in your account 2 days after completion' },
                            ].map((g, i) => (
                                <div key={i} className="flex items-start gap-2 pt-2">
                                    <Check className="h-3.5 w-3.5 text-[#1B2A4A] stroke-[3] shrink-0 mt-1" />
                                    <div className="flex-1 min-w-0">
                                        <p className="text-[12px] font-semibold text-[#111827] leading-tight">{g.label}</p>
                                        <p className="text-[11px] text-[#6B7280] leading-relaxed mt-0.5">{g.detail}</p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </details>
                </motion.div>
            </main>

            {/* Footer */}
            <footer className="bg-[#1B2A4A] text-white">
                <div className="max-w-[680px] mx-auto px-4 py-5 flex items-center gap-3">
                    <img src="/logo.png" alt="Handy" className="w-8 h-8 object-contain shrink-0" />
                    <div className="flex-1 min-w-0">
                        <p className="font-bold text-[13px] leading-tight">Handy Services</p>
                        <p className="text-[10px] text-[#F5A623] leading-tight mt-0.5">
                            Next-day · Fast · Fully insured
                        </p>
                    </div>
                    <div className="text-right shrink-0">
                        <p className="text-[10px] uppercase tracking-[0.06em] text-white/60 font-bold">Get in touch</p>
                        <a href="tel:07449501762" className="text-[12px] font-bold text-white block">07449 501 762</a>
                    </div>
                </div>
            </footer>

            {/* Toast */}
            <AnimatePresence>
                {toast && (
                    <motion.div
                        key={toast.id}
                        initial={{ y: -60, opacity: 0, scale: 0.95 }}
                        animate={{ y: 0, opacity: 1, scale: 1 }}
                        exit={{ y: -60, opacity: 0, scale: 0.95 }}
                        transition={{ type: 'spring', stiffness: 280, damping: 20 }}
                        className="fixed top-3 left-1/2 -translate-x-1/2 z-[55] pointer-events-none"
                    >
                        <div className={`px-4 py-2.5 rounded-full shadow-2xl font-bold text-[14px] tabular-nums ${
                            toast.tone === 'win'
                                ? 'bg-gradient-to-r from-[#F5A623] to-[#F5A623] text-white shadow-[#F5A623]/40'
                                : 'bg-[#1B2A4A] text-white shadow-[#1B2A4A]/30'
                        }`}>
                            {toast.msg}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Confetti */}
            <AnimatePresence>
                {confettiOn && (
                    <div className="fixed inset-0 pointer-events-none z-[54] overflow-hidden">
                        {Array.from({ length: 36 }).map((_, i) => {
                            const left = Math.random() * 100;
                            const delay = Math.random() * 0.4;
                            const duration = 1.8 + Math.random() * 1.6;
                            const size = 8 + Math.random() * 6;
                            const colors = ['#F5A623', '#F5A623', '#1B2A4A', '#F5A623', '#FFFFFF'];
                            const color = colors[i % colors.length];
                            const xDrift = (Math.random() - 0.5) * 200;
                            const rot = Math.random() * 720;
                            return (
                                <motion.div
                                    key={i}
                                    initial={{ y: -40, x: 0, opacity: 1, rotate: 0 }}
                                    animate={{
                                        y: typeof window !== 'undefined' ? window.innerHeight + 40 : 900,
                                        x: xDrift,
                                        opacity: [1, 1, 0],
                                        rotate: rot,
                                    }}
                                    transition={{ duration, delay, ease: 'easeIn' }}
                                    className="absolute"
                                    style={{
                                        left: `${left}%`,
                                        top: 0,
                                        width: size,
                                        height: size * 1.4,
                                        backgroundColor: color,
                                        borderRadius: 2,
                                    }}
                                />
                            );
                        })}
                    </div>
                )}
            </AnimatePresence>

            {/* Sticky CTA — only when undecided */}
            {!isAccepted && !decided && (
                <div
                    className="fixed bottom-0 left-0 right-0 z-40 border-t border-[#D0D5E3] bg-white/95 backdrop-blur-md"
                    style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
                >
                    <div className="max-w-[680px] mx-auto px-4 pt-3 pb-3">
                        <div className="flex items-center gap-3">
                            <div className="flex-1 min-w-0">
                                <p className="text-[10px] uppercase tracking-[0.08em] font-semibold text-[#6B7280] leading-none">
                                    Day rate
                                </p>
                                <p className="text-[20px] font-semibold tabular-nums text-[#111827] leading-tight mt-0.5">
                                    {fmt(pack.dayRatePence)}
                                    <span className="text-[12px] text-[#1B2A4A] font-semibold ml-1">+ bonuses</span>
                                </p>
                            </div>
                            <button
                                onClick={handleDecline}
                                disabled={declinePack.isPending}
                                className="px-4 py-3 min-h-[44px] rounded-xl font-semibold text-[14px] text-[#6B7280] hover:text-[#111827] hover:bg-[#F7F8FC] transition-colors disabled:opacity-50"
                            >
                                Pass
                            </button>
                            <button
                                onClick={handleAccept}
                                disabled={acceptPack.isPending}
                                className="px-5 py-3 min-h-[44px] rounded-xl font-semibold text-[14px] bg-[#1B2A4A] hover:bg-[#152340] text-white transition-all active:scale-[0.97] shadow-md shadow-[#1B2A4A]/20 inline-flex items-center gap-2 disabled:opacity-50"
                            >
                                {acceptPack.isPending
                                    ? <Loader2 className="h-4 w-4 animate-spin" />
                                    : <Hammer className="h-4 w-4" />}
                                Accept day
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Decline confirmation modal */}
            <AnimatePresence>
                {decided === 'declined' && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-[60] bg-[#111827]/40 backdrop-blur-sm flex items-center justify-center p-4"
                        onClick={() => setDecided(null)}
                    >
                        <motion.div
                            initial={{ scale: 0.95, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.95, opacity: 0 }}
                            className="bg-white rounded-2xl p-7 sm:p-8 max-w-sm w-full text-center shadow-2xl"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <div className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-5 bg-amber-50">
                                <X className="h-7 w-7 text-amber-600" />
                            </div>
                            <h2 className="text-xl font-semibold mb-2 text-[#111827]">Day-pack declined</h2>
                            <p className="text-[13px] text-[#6B7280]">The pack will be re-offered to other Builders.</p>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Photo upload sheet */}
            <AnimatePresence>
                {photoStop !== null && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-[60] bg-[#111827]/40 backdrop-blur-sm flex items-end sm:items-center justify-center"
                        onClick={closePhotoSheet}
                    >
                        <motion.div
                            initial={{ y: 40, opacity: 0 }}
                            animate={{ y: 0, opacity: 1 }}
                            exit={{ y: 40, opacity: 0 }}
                            className="bg-white w-full sm:max-w-md sm:rounded-2xl rounded-t-2xl p-6 shadow-2xl"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <h2 className="text-[16px] font-bold text-[#111827] mb-1">Mark stop {photoStop} complete</h2>
                            <p className="text-[12px] text-[#6B7280] mb-4">
                                Upload at least one photo as evidence. Photos protect your bonus.
                            </p>
                            <PhotoUpload
                                value={stopPhotos}
                                onChange={setStopPhotos}
                                max={6}
                                label="Job photos"
                                hint="Tap to add photos · ≥ 1 required"
                                required
                                disabled={markStopComplete.isPending}
                            />
                            <div className="mt-4">
                                <label className="text-[11px] uppercase tracking-[0.06em] font-bold text-[#1B2A4A] block mb-1">
                                    Notes (optional)
                                </label>
                                <textarea
                                    value={stopNotes}
                                    onChange={(e) => setStopNotes(e.target.value)}
                                    rows={2}
                                    className="w-full text-[13px] border border-[#D0D5E3] rounded-lg px-3 py-2 focus:outline-none focus:border-[#1B2A4A]"
                                    placeholder="Anything to flag for the office?"
                                />
                            </div>
                            <div className="mt-5 flex items-center gap-2">
                                <button
                                    onClick={closePhotoSheet}
                                    disabled={markStopComplete.isPending}
                                    className="flex-1 px-4 py-2.5 rounded-xl font-semibold text-[13px] text-[#6B7280] bg-[#F7F8FC] hover:bg-[#E9ECF3] transition-colors disabled:opacity-50"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={submitStop}
                                    disabled={stopPhotos.length < 1 || markStopComplete.isPending}
                                    className="flex-1 px-4 py-2.5 rounded-xl font-semibold text-[13px] bg-[#1B2A4A] text-white hover:bg-[#152340] transition-colors disabled:opacity-50 inline-flex items-center justify-center gap-2"
                                >
                                    {markStopComplete.isPending ? (
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                    ) : (
                                        <Check className="h-4 w-4 stroke-[3]" />
                                    )}
                                    Mark complete
                                </button>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function ComingSoon() {
    return (
        <div className="min-h-screen bg-[#F7F8FC] flex items-center justify-center p-6 font-['Poppins',sans-serif]">
            <div className="bg-white border border-[#D0D5E3] rounded-2xl max-w-sm w-full p-7 text-center shadow-md">
                <div className="w-14 h-14 rounded-full bg-[#1B2A4A]/10 flex items-center justify-center mx-auto mb-4">
                    <MapPin className="h-7 w-7 text-[#1B2A4A]" />
                </div>
                <h1 className="text-xl font-semibold text-[#111827] mb-2">Day-pack page · coming soon</h1>
                <p className="text-[13px] text-[#6B7280] mb-5">
                    Production day-pack offers are still being staged. Check the test page to see the experience.
                </p>
                <a
                    href="/dispatch-preview"
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#1B2A4A] text-white text-[13px] font-semibold hover:bg-[#152340]"
                >
                    Open test page
                    <ExternalLink className="h-3.5 w-3.5" />
                </a>
            </div>
        </div>
    );
}

function LoadingSkeleton() {
    return (
        <div className="min-h-screen bg-[#F7F8FC] font-['Poppins',sans-serif]">
            <header className="bg-[#1B2A4A] h-12" />
            <div className="bg-[#F5A623] h-7" />
            <main className="max-w-[680px] mx-auto px-4 py-6 space-y-5">
                <div className="rounded-2xl bg-white border border-[#D0D5E3] h-48 animate-pulse" />
                <div className="rounded-2xl bg-white border border-[#D0D5E3] h-44 animate-pulse" />
                <div className="rounded-2xl bg-white border border-[#D0D5E3] h-72 animate-pulse" />
            </main>
        </div>
    );
}

function UnavailableState({ message }: { message: string }) {
    return (
        <div className="min-h-screen bg-[#F7F8FC] flex items-center justify-center p-6 font-['Poppins',sans-serif]">
            <div className="bg-white border border-[#D0D5E3] rounded-2xl max-w-sm w-full p-7 text-center shadow-md">
                <div className="w-14 h-14 rounded-full bg-amber-50 flex items-center justify-center mx-auto mb-4">
                    <X className="h-7 w-7 text-amber-600" />
                </div>
                <h1 className="text-xl font-semibold text-[#111827] mb-2">Day-pack unavailable</h1>
                <p className="text-[13px] text-[#6B7280] mb-5">{message}</p>
                <a href="tel:07449501762" className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#1B2A4A] text-white text-[13px] font-semibold hover:bg-[#152340]">
                    Call dispatch · 07449 501 762
                </a>
            </div>
        </div>
    );
}

// Type-only imports for editor reference
export type { DayPackEnvelope };
