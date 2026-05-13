/**
 * HandymanV2 — generic handyman booking landing page.
 *
 * Layout inspired by 3-column marketplace-style booking pages: sticky category
 * nav on the left, scrollable service grid in the middle, sticky cart + offers
 * + trust panel on the right. Brand and copy are our own (Jobber Green accent,
 * Nottingham handyman service, GBP pricing).
 *
 * Route: /v2  (registered in App.tsx)
 */

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import {
    Star,
    Check,
    ChevronLeft,
    ChevronRight,
    ShoppingCart,
    Percent,
    Plus,
    Minus,
    Hammer,
    Clock,
    Drill,
    Tv,
    Armchair,
    KeyRound,
    Blinds,
    Bed,
    DoorOpen,
    Frame,
    ChevronDown,
    Twitter,
    Facebook,
    Instagram,
    Linkedin,
    ShieldCheck,
    Sparkles,
    Calendar,
    CreditCard,
    ShieldCheck as Shield2,
    Menu as MenuIcon,
    X,
    type LucideIcon,
} from "lucide-react";
import {
    Accordion,
    AccordionContent,
    AccordionItem,
    AccordionTrigger,
} from "@/components/ui/accordion";
import { SiGoogle } from "react-icons/si";
import { LandingHeader } from "@/components/LandingHeader";
import { HandLogo } from "@/components/LandingShared";

// Brand asset images (real Handy Services photography from existing landing)
import slideShelf from "@assets/c2f4951d-baa5-4a9f-8b4e-233fa5fcb49c_1764687156908.webp";
import slideAfter from "@assets/cb5e8951-9d46-4023-9909-510a89d3da60_1764693845208.webp";
import slideHero from "@assets/f7550ab2-8282-4cf6-b2af-83496eef2eee_1764599750751.webp";
import slidePayIn3 from "@assets/6e08e13d-d1a3-4a91-a4cc-814b057b341d_1764693900670.webp";
import seoLocalImage from "@assets/4cc2f0fa-125e-412b-9929-4e03a055b760_1764687156909.webp";
import promoHandyman from "@assets/123d3462-a11d-42b8-9fad-fdb2d6f29b11_1764600237774.webp";
// Wall-install brand photo, used as a stopgap thumbnail for TV-mount services
// until a TV-specific brand photo is saved (see TODO at the service entries).

// ---------------------------------------------------------------------------
// Data — service catalog
// ---------------------------------------------------------------------------

/** One selectable tier inside a multi-option service (e.g. "1 hour", "1h 30min"). */
export type ServiceTier = {
    id: string;
    name: string;
    /** Per-tier rating shown on each variant card. */
    rating: number;
    reviewCount: string;
    /** EVE+10% price for this tier (£49/hr × durationMinutes/60). */
    priceCurrent: number;
    /** BUSY_PRO segment anchor for strike-through (£74/hr × durationMinutes/60). */
    priceOriginal?: number;
    durationMinutes: number;
};

export type Service = {
    id: string;
    name: string;
    rating: number;
    reviewCount: string;
    priceCurrent: number;
    priceOriginal?: number;
    durationMinutes?: number;
    startsAt?: boolean;
    bullets: string[];
    /** Emoji used as a thumbnail fallback. Only rendered when neither
     *  `thumbImage` nor `thumbIcon` is set — kept as a safety net. */
    thumbEmoji: string;
    thumbBg: string;
    /** When set, renders a real brand photo (from /assets) instead of the
     *  icon-on-gradient placeholder. Preferred for hero services that have
     *  proper photography. */
    thumbImage?: string;
    /** When set (and no `thumbImage`), renders a Lucide icon centred on the
     *  gradient tile. Used in place of emoji for a cleaner, brand-consistent
     *  look. */
    thumbIcon?: LucideIcon;
    /** When set (highest priority after image), renders a typographic
     *  two-line tile — e.g. "30 / MINS" — matching the Select-a-service nav.
     *  Used on the hourly/30-min SKUs so the thumbnail mirrors its category
     *  pill. */
    thumbText?: { primary: string; secondary: string };
    optionsCount?: number;
    promoLabel?: string;
    /** When present, "Add" opens the detail modal with a tier-picker as the first
     *  section. The user adds a specific tier rather than the base service. */
    tiers?: ServiceTier[];
    /** Optional short description shown in the detail modal under the header. */
    longDescription?: string;
};

type PromoBanner = {
    eyebrow: string;
    headline: string;
    /** Big strike-through pricing callout: "from £39  (£49)" */
    priceCurrent: number;
    priceOriginal?: number;
    /** Brand photo rendered on the right side of the banner. */
    image: string;
};

type Category = {
    id: string;
    name: string;
    /** lucide icon for the left-nav tile + section heading. */
    Icon: typeof Hammer;
    /** Optional typographic icon — renders a stacked label (e.g. "30" / "MINS")
     *  in place of the lucide Icon, mirroring the existing landing's number tiles. */
    iconText?: { primary: string; secondary: string };
    /** Optional promo banner rendered above the service cards. */
    promoBanner?: PromoBanner;
    blurb?: string;
    services: Service[];
};

const CATEGORIES: Category[] = [
    {
        id: "quick-fix",
        name: "30-min handyman",
        Icon: Clock,
        iconText: { primary: "30", secondary: "MINS" },
        promoBanner: {
            eyebrow: "Bestseller",
            // Keep this tight — the £25 price + £37 strike-through render
            // immediately below the headline, so we don't repeat it here.
            headline: "30 min slot",
            // EVE+10% generic-page rate (£49/hr × 30/60) with BUSY_PRO anchor (£74/hr × 30/60).
            priceCurrent: 25,
            priceOriginal: 37,
            image: promoHandyman,
        },
        services: [
            {
                id: "quick-fix-30",
                name: "Book handyman for 30 mins",
                rating: 4.78,
                reviewCount: "4K reviews",
                // EVE+10% generic-page rate (£49/hr × 30/60) with BUSY_PRO segment anchor (£74/hr × 30/60).
                priceCurrent: 25,
                priceOriginal: 37,
                durationMinutes: 30,
                bullets: [
                    "Got quick fixes to make? Worry not — book a tradesperson for 30 minutes and tick them off in one visit.",
                ],
                thumbEmoji: "⏱️",
                // Matches the "30 / MINS" tile in the Select-a-service nav so
                // the SKU thumbnail visually echoes its category pill.
                thumbText: { primary: "30", secondary: "MINS" },
                thumbBg: "from-emerald-100 to-emerald-200",
            },
        ],
    },
    {
        id: "hourly",
        name: "Hourly handyman",
        Icon: Hammer,
        iconText: { primary: "60", secondary: "MINS" },
        services: [
            {
                id: "hourly-1",
                name: "Book a handyman by the hour",
                rating: 4.74,
                reviewCount: "5K reviews",
                // EVE+10% generic-page rate: £49/hr starting price.
                priceCurrent: 49,
                startsAt: true,
                longDescription:
                    "Best for jobs you can't easily scope up front — small repairs, multiple unrelated tasks, or anything where the time depends on what we find. Pick a slot below; we'll do as much as fits in the booked window and quote the rest before we leave.",
                tiers: [
                    {
                        id: "hourly-1hr",
                        name: "1 hour",
                        rating: 4.75,
                        reviewCount: "4K reviews",
                        priceCurrent: 49,
                        priceOriginal: 74,
                        durationMinutes: 60,
                    },
                    {
                        id: "hourly-1h30",
                        name: "1 hour 30 min",
                        rating: 4.71,
                        reviewCount: "1.6K reviews",
                        priceCurrent: 74,
                        priceOriginal: 111,
                        durationMinutes: 90,
                    },
                    {
                        id: "hourly-2hr",
                        name: "2 hours",
                        rating: 4.69,
                        reviewCount: "920 reviews",
                        priceCurrent: 98,
                        priceOriginal: 148,
                        durationMinutes: 120,
                    },
                    {
                        id: "hourly-2h30",
                        name: "2 hours 30 min",
                        rating: 4.66,
                        reviewCount: "340 reviews",
                        priceCurrent: 123,
                        priceOriginal: 185,
                        durationMinutes: 150,
                    },
                    {
                        id: "hourly-3hr",
                        name: "3 hours",
                        rating: 4.7,
                        reviewCount: "210 reviews",
                        priceCurrent: 147,
                        priceOriginal: 222,
                        durationMinutes: 180,
                    },
                ],
                bullets: [
                    "Not sure how long the job will take? Book hourly and our handyman stays from 1–3 hours.",
                ],
                thumbEmoji: "🛠️",
                // Matches the "60 / MINS" tile in the Select-a-service nav so
                // the SKU thumbnail visually echoes its category pill.
                thumbText: { primary: "60", secondary: "MINS" },
                thumbBg: "from-amber-100 to-orange-200",
                optionsCount: 5,
            },
        ],
    },
    {
        id: "drill-hang",
        name: "Drill & hang",
        Icon: Drill,
        services: [
            {
                id: "drill-10",
                name: "Drill & hang",
                rating: 4.84,
                reviewCount: "3K reviews",
                // EVE+10% (£49/hr × 45/60) with BUSY_PRO anchor (£74/hr × 45/60).
                priceCurrent: 37,
                priceOriginal: 56,
                durationMinutes: 45,
                // No drilling-specific brand photo in /assets yet — the
                // shelf-install shot (c2f4951d) is reserved for mirror-shelf so
                // we don't duplicate it on this neighbouring card.
                longDescription:
                    "Picture frames, mirrors, shelves, brackets, curtain poles, smoke detectors — any wall fixings. We bring the drill, bits and standard fixings; anything specialist we'll buy at trade rates with your nod first.",
                tiers: [
                    {
                        id: "drill-5",
                        name: "Up to 5 holes",
                        rating: 4.86,
                        reviewCount: "1.8K reviews",
                        priceCurrent: 20,
                        priceOriginal: 31,
                        durationMinutes: 25,
                    },
                    {
                        id: "drill-10-tier",
                        name: "Up to 10 holes",
                        rating: 4.84,
                        reviewCount: "3K reviews",
                        priceCurrent: 37,
                        priceOriginal: 56,
                        durationMinutes: 45,
                    },
                    {
                        id: "drill-20",
                        name: "Up to 20 holes",
                        rating: 4.81,
                        reviewCount: "760 reviews",
                        priceCurrent: 61,
                        priceOriginal: 93,
                        durationMinutes: 75,
                    },
                ],
                bullets: [
                    "Brackets, fixings and rawl plugs supplied — anything specialist can be bought at trade rates.",
                    "If no work is carried out after inspection, a visit charge of £25 applies.",
                ],
                thumbEmoji: "🔩",
                thumbIcon: Drill,
                thumbBg: "from-slate-100 to-slate-200",
                optionsCount: 2,
            },
            {
                id: "mirror-shelf",
                name: "Mirror or shelf installation",
                rating: 4.84,
                reviewCount: "697 reviews",
                // EVE+10% (£49/hr × 45/60) — 45-min minimum booking.
                priceCurrent: 37,
                startsAt: true,
                longDescription:
                    "Standard fixings included for plasterboard or masonry walls. Pick the option that matches the number of pieces you need mounted; we'll bring the right wall plugs and a spirit level.",
                tiers: [
                    {
                        id: "mirror-shelf-single",
                        name: "Single mirror or shelf",
                        rating: 4.86,
                        reviewCount: "540 reviews",
                        // EVE+10% (£49/hr × 45/60) with BUSY_PRO anchor.
                        priceCurrent: 37,
                        priceOriginal: 56,
                        durationMinutes: 45,
                    },
                    {
                        id: "mirror-shelf-pair",
                        name: "Pair of mirrors or shelves",
                        rating: 4.81,
                        reviewCount: "157 reviews",
                        // EVE+10% (£49/hr × 75/60) with BUSY_PRO anchor.
                        priceCurrent: 61,
                        priceOriginal: 93,
                        durationMinutes: 75,
                    },
                ],
                bullets: [
                    "Wall plugs, screws and brackets included where standard.",
                    "If no work is carried out after inspection, a visit charge of £25 applies.",
                ],
                thumbEmoji: "🪞",
                // Frame icon represents the mirror/picture-frame outcome of
                // the job. Photo thumbnail was removed for visual consistency
                // — all SKU thumbnails are now icons or typographic tiles.
                thumbIcon: Frame,
                thumbBg: "from-blue-100 to-cyan-200",
                optionsCount: 2,
            },
            {
                id: "fairy-lights",
                name: "Fairy lights installation",
                rating: 4.61,
                reviewCount: "65 reviews",
                // EVE+10% (£49/hr × 50/60) — 50-min job.
                priceCurrent: 41,
                startsAt: true,
                bullets: [
                    "Up to 50 metres of lights covered — bring your own or we can supply.",
                    "Outdoor-safe fixings used on exterior runs.",
                ],
                thumbEmoji: "✨",
                thumbIcon: Sparkles,
                thumbBg: "from-pink-100 to-rose-200",
                optionsCount: 2,
                promoLabel: "SEASONAL SPECIAL",
            },
        ],
    },
    {
        id: "curtains-blinds",
        name: "Curtains & blinds",
        Icon: Blinds,
        services: [
            {
                id: "curtain-rod",
                name: "Curtain rod installation",
                rating: 4.75,
                reviewCount: "1K reviews",
                // EVE+10% (£49/hr × 45/60) — floor price = single-rod tier.
                priceCurrent: 37,
                startsAt: true,
                longDescription:
                    "Single window, multiple windows or a bay setup — we level the bracket positions, fix to plasterboard or masonry, and hang the rod. Brackets and standard fixings supplied; specialist parts billed at trade rates.",
                tiers: [
                    {
                        id: "curtain-rod-1",
                        name: "1 curtain rod (2 brackets)",
                        rating: 4.77,
                        reviewCount: "640 reviews",
                        priceCurrent: 37,
                        priceOriginal: 56,
                        durationMinutes: 45,
                    },
                    {
                        id: "curtain-rod-2",
                        name: "2 curtain rods (4 brackets)",
                        rating: 4.73,
                        reviewCount: "290 reviews",
                        priceCurrent: 61,
                        priceOriginal: 93,
                        durationMinutes: 75,
                    },
                    {
                        id: "curtain-rod-bay",
                        name: "Bay window setup",
                        rating: 4.68,
                        reviewCount: "82 reviews",
                        priceCurrent: 74,
                        priceOriginal: 111,
                        durationMinutes: 90,
                    },
                ],
                bullets: [
                    "Brackets and standard fixings supplied; specialist parts billed at trade rates.",
                    "If no work is carried out after inspection, a visit charge of £25 applies.",
                ],
                thumbEmoji: "🪟",
                thumbIcon: Blinds,
                thumbBg: "from-teal-100 to-teal-200",
                // No curtain-rod brand photo in /assets yet — emoji tile is
                // preferred over a misleading stand-in.
                optionsCount: 3,
            },
            {
                id: "blinds-fitting",
                name: "Blinds measurement & fitting",
                rating: 4.59,
                reviewCount: "109 reviews",
                // EVE+10% (£49/hr × 60/60) — 1-hour minimum booking.
                priceCurrent: 49,
                startsAt: true,
                longDescription:
                    "Roller, Venetian, Roman or vertical — we'll measure, fit and level each window. Pick by window count; brackets and standard fixings included.",
                tiers: [
                    {
                        id: "blinds-1",
                        name: "1 window",
                        rating: 4.61,
                        reviewCount: "68 reviews",
                        priceCurrent: 49,
                        priceOriginal: 74,
                        durationMinutes: 60,
                    },
                    {
                        id: "blinds-2",
                        name: "2 windows",
                        rating: 4.58,
                        reviewCount: "29 reviews",
                        priceCurrent: 74,
                        priceOriginal: 111,
                        durationMinutes: 90,
                    },
                    {
                        id: "blinds-3plus",
                        name: "3+ windows",
                        rating: 4.55,
                        reviewCount: "12 reviews",
                        priceCurrent: 123,
                        priceOriginal: 185,
                        durationMinutes: 150,
                    },
                ],
                bullets: [
                    "Standard brackets and fixings included.",
                    "If no work is carried out after inspection, a visit charge of £25 applies.",
                ],
                thumbEmoji: "🪟",
                // Blinds icon — photo thumbnail was removed for visual
                // consistency with the other service cards.
                thumbIcon: Blinds,
                thumbBg: "from-sky-100 to-sky-200",
                optionsCount: 3,
            },
        ],
    },
    {
        id: "tv-mount",
        name: "TV installation",
        Icon: Tv,
        services: [
            {
                id: "tv-home-theatre",
                name: "TV / home-theatre wall mounting",
                rating: 4.84,
                reviewCount: "1K reviews",
                // EVE+10% (£49/hr × 45/60) with BUSY_PRO anchor (£74/hr × 45/60).
                priceCurrent: 37,
                priceOriginal: 56,
                durationMinutes: 45,
                bullets: [
                    "Mount supplied if needed (billed at trade rates).",
                    "Cable management tidied behind the unit.",
                    "If no work is carried out after inspection, a visit charge of £25 applies.",
                ],
                thumbEmoji: "📺",
                thumbIcon: Tv,
                thumbBg: "from-indigo-100 to-violet-200",
                // No TV-specific brand photo in /assets yet — emoji tile is
                // preferred over a misleading stand-in.
            },
            {
                id: "tv-uninstall",
                name: "TV uninstallation",
                rating: 4.7,
                reviewCount: "412 reviews",
                // EVE+10% (£49/hr × 30/60) — 30-min minimum booking.
                priceCurrent: 25,
                startsAt: true,
                bullets: [
                    "Safe removal and patch-up of small holes left in the wall.",
                ],
                thumbEmoji: "📺",
                thumbIcon: Tv,
                thumbBg: "from-violet-100 to-purple-200",
                // No TV-specific brand photo in /assets yet — emoji tile is
                // preferred over a misleading stand-in.
            },
        ],
    },
    {
        id: "furniture",
        name: "Furniture assembly",
        Icon: Armchair,
        services: [
            {
                id: "bed-assembly",
                name: "Bed assembly / installation",
                rating: 4.71,
                reviewCount: "262 reviews",
                // EVE+10% (£49/hr × 60/60) — Double bed is the most common
                // pick; tier pricing scales by frame size + complexity.
                priceCurrent: 49,
                startsAt: true,
                longDescription:
                    "Flat-pack or branded — we'll assemble the frame, slats and headboard, and clear the packaging on the way out. Mattress positioning included where reachable.",
                tiers: [
                    {
                        id: "bed-single",
                        name: "Single bed",
                        rating: 4.74,
                        reviewCount: "92 reviews",
                        priceCurrent: 37,
                        priceOriginal: 56,
                        durationMinutes: 45,
                    },
                    {
                        id: "bed-double",
                        name: "Double bed",
                        rating: 4.72,
                        reviewCount: "110 reviews",
                        priceCurrent: 49,
                        priceOriginal: 74,
                        durationMinutes: 60,
                    },
                    {
                        id: "bed-king",
                        name: "King-size bed",
                        rating: 4.69,
                        reviewCount: "31 reviews",
                        priceCurrent: 61,
                        priceOriginal: 93,
                        durationMinutes: 75,
                    },
                    {
                        id: "bed-superking",
                        name: "Super-king bed",
                        rating: 4.66,
                        reviewCount: "17 reviews",
                        priceCurrent: 74,
                        priceOriginal: 111,
                        durationMinutes: 90,
                    },
                    {
                        id: "bed-ottoman",
                        name: "Ottoman / storage bed",
                        rating: 4.62,
                        reviewCount: "14 reviews",
                        priceCurrent: 74,
                        priceOriginal: 111,
                        durationMinutes: 90,
                    },
                    {
                        id: "bed-bunk",
                        name: "Bunk bed",
                        rating: 4.58,
                        reviewCount: "8 reviews",
                        priceCurrent: 98,
                        priceOriginal: 148,
                        durationMinutes: 120,
                    },
                ],
                bullets: [
                    "Flat-pack or branded — single, double, king or super-king.",
                    "If no work is carried out after inspection, a visit charge of £25 applies.",
                ],
                thumbEmoji: "🛏️",
                thumbIcon: Bed,
                thumbBg: "from-amber-100 to-yellow-200",
                optionsCount: 6,
            },
            {
                id: "dining-chair",
                name: "Dining table / chair assembly",
                rating: 4.8,
                reviewCount: "93 reviews",
                // Per-item pricing pro-rated from EVE+10% (£49/hr).
                // Chair ≈ 12 min → £9, table ≈ 30 min → £25. Tier minimum
                // anchors the "Starts at" headline price on the card.
                priceCurrent: 9,
                startsAt: true,
                longDescription:
                    "Flat-pack chairs and tables — we'll assemble, level and tighten everything to spec. Pick the combination that matches what you've got; mix and match by adding multiple tiers if needed.",
                tiers: [
                    {
                        id: "dining-chair-1",
                        name: "1 chair",
                        rating: 4.82,
                        reviewCount: "37 reviews",
                        priceCurrent: 9,
                        priceOriginal: 14,
                        durationMinutes: 12,
                    },
                    {
                        id: "dining-chair-2",
                        name: "Pair of chairs",
                        rating: 4.79,
                        reviewCount: "21 reviews",
                        priceCurrent: 19,
                        priceOriginal: 28,
                        durationMinutes: 24,
                    },
                    {
                        id: "dining-chair-4",
                        name: "Set of 4 chairs",
                        rating: 4.77,
                        reviewCount: "19 reviews",
                        priceCurrent: 37,
                        priceOriginal: 56,
                        durationMinutes: 48,
                    },
                    {
                        id: "dining-table",
                        name: "Dining table",
                        rating: 4.81,
                        reviewCount: "16 reviews",
                        priceCurrent: 25,
                        priceOriginal: 37,
                        durationMinutes: 30,
                    },
                ],
                bullets: [
                    "Flat-pack chairs and tables — single items or full sets.",
                    "If no work is carried out after inspection, a visit charge of £25 applies.",
                ],
                thumbEmoji: "🪑",
                thumbIcon: Armchair,
                thumbBg: "from-stone-100 to-stone-200",
                optionsCount: 4,
            },
            {
                id: "wardrobe-assembly",
                name: "Wardrobe assembly",
                rating: 4.72,
                reviewCount: "239 reviews",
                // EVE+10% (£49/hr × 60/60) with BUSY_PRO anchor (£74/hr × 60/60).
                priceCurrent: 49,
                priceOriginal: 74,
                durationMinutes: 60,
                bullets: [
                    "Up to 3-door flat-pack covered.",
                    "If no work is carried out after inspection, a visit charge of £25 applies.",
                ],
                thumbEmoji: "🚪",
                thumbIcon: DoorOpen,
                thumbBg: "from-orange-100 to-amber-200",
            },
        ],
    },
    {
        id: "locks",
        name: "Lock installation",
        Icon: KeyRound,
        services: [
            {
                id: "smart-lock",
                name: "Smart lock installation",
                rating: 4.65,
                reviewCount: "78 reviews",
                // EVE+10% (£49/hr × 150/60) with BUSY_PRO anchor (£74/hr × 150/60).
                priceCurrent: 123,
                priceOriginal: 185,
                durationMinutes: 150,
                bullets: [
                    "Please check for any approvals that may be required from the owner or landlord.",
                ],
                thumbEmoji: "🔐",
                thumbIcon: KeyRound,
                thumbBg: "from-zinc-100 to-zinc-200",
            },
        ],
    },
];

/**
 * Cart keys can be either a top-level service id or a tier id, so we flatten
 * tier variants into the lookup table as synthesized Service entries. Each
 * synthesized entry inherits its parent's thumbnail and bullets but overrides
 * price/duration/rating with the tier's values so the cart line + per-tier
 * stepper render correctly without any special-case code in CartCard.
 */
/**
 * Exported so the basket page and any other downstream consumer can do
 * service-by-id lookups (line item rendering, price totals, etc.). Tiered
 * services are flattened in too, so a cart key like "hourly-2hr" still
 * resolves to a complete service record without special casing.
 */
export const ALL_SERVICES: Service[] = CATEGORIES.flatMap((c) => c.services).flatMap(
    (svc) => {
        if (!svc.tiers) return [svc];
        const tierEntries: Service[] = svc.tiers.map((tier) => ({
            ...svc,
            id: tier.id,
            name: `${svc.name} · ${tier.name}`,
            rating: tier.rating,
            reviewCount: tier.reviewCount,
            priceCurrent: tier.priceCurrent,
            priceOriginal: tier.priceOriginal,
            durationMinutes: tier.durationMinutes,
            startsAt: false,
            tiers: undefined,
        }));
        return [svc, ...tierEntries];
    },
);

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

/** Where the cart is persisted across navigations to /basket. */
export const CART_STORAGE_KEY = "handy-v2-cart";

export default function HandymanV2() {
    const [, setLocation] = useLocation();
    const [cart, setCart] = useState<Record<string, number>>(() => {
        if (typeof window === "undefined") return {};
        try {
            const raw = window.localStorage.getItem(CART_STORAGE_KEY);
            return raw ? JSON.parse(raw) : {};
        } catch {
            return {};
        }
    });

    useEffect(() => {
        try {
            window.localStorage.setItem(
                CART_STORAGE_KEY,
                JSON.stringify(cart),
            );
        } catch {
            // localStorage unavailable (e.g. private mode quota) — silently skip
        }
    }, [cart]);
    // No default selection — the active highlight only appears once the user picks a tile
    // or scrolls to a category section. Was defaulting to "quick-fix" which made it look
    // pre-selected.
    const [activeCategory, setActiveCategory] = useState<string>("");
    // Which service's detail modal (if any) is open. The modal mirrors the
    // source's pattern of forcing users through a details view before adding
    // to cart (more info, more upsell, fewer mis-clicks).
    const [openServiceId, setOpenServiceId] = useState<string | null>(null);

    const addToCart = (id: string) =>
        setCart((c) => ({ ...c, [id]: (c[id] || 0) + 1 }));

    const decrementFromCart = (id: string) =>
        setCart((c) => {
            const next = { ...c, [id]: Math.max(0, (c[id] || 0) - 1) };
            if (next[id] === 0) delete next[id];
            return next;
        });

    const cartItems = useMemo(
        () =>
            Object.entries(cart).flatMap(([id, qty]) => {
                const svc = ALL_SERVICES.find((s) => s.id === id);
                return svc ? [{ ...svc, qty }] : [];
            }),
        [cart],
    );

    const cartTotal = cartItems.reduce(
        (sum, item) => sum + item.priceCurrent * item.qty,
        0,
    );
    const cartOriginalTotal = cartItems.reduce(
        (sum, item) => sum + (item.priceOriginal || item.priceCurrent) * item.qty,
        0,
    );

    return (
        <div className="min-h-screen bg-white font-sans text-slate-900">
            <LandingHeader />

            <main className="mx-auto max-w-7xl px-4 pb-12 pt-8 lg:px-8">
                {/*
                  * Unified grid:
                  *   row 1: hero/title (left col) | carousel banner (spans col 2-3)
                  *   row 2: categories nav (left col, sticky) | services (col 2) | cart (col 3, sticky)
                  *
                  * Left column visually contains hero stacked above categories nav; both share
                  * the same 260px column but live in different grid rows. Carousel is strictly
                  * in row 1 of cols 2+3, so it never overlaps the left column.
                  */}
                <div className="grid grid-cols-1 gap-6 lg:grid-cols-[260px_1fr_320px]">
                    {/* Mobile DOM order #1 → carousel renders first (matches source's
                      * banner-first mobile hierarchy). On desktop, grid placement pins
                      * it to row 1 cols 2-3 so the visual layout stays the same. */}
                    <div className="lg:col-span-2 lg:col-start-2 lg:row-start-1">
                        <HeroCarousel />
                    </div>

                    {/* Mobile DOM order #2 → Hero (title + rating + warranty).
                      * Desktop: col 1 row 1, top-aligned. */}
                    <div className="lg:col-start-1 lg:row-start-1 lg:self-start">
                        <Hero />
                    </div>

                    {/* Mobile DOM order #3 → Promo chips + Category nav (sticky on desktop).
                      * Desktop: col 1 row 2 (left column below Hero). */}
                    <aside className="space-y-4 lg:col-start-1 lg:row-start-2">
                        {/* Mobile-only: horizontally-scrolling promo offer chips */}
                        <MobilePromoChips />
                        {/* Visual category grid — shown on both mobile and desktop (sticky on desktop) */}
                        <div className="lg:sticky lg:top-24">
                            <CategoryNav
                                active={activeCategory}
                                onSelect={setActiveCategory}
                            />
                        </div>
                    </aside>

                    {/* Row 2, col 2 — Service grid */}
                    <section className="min-w-0 lg:col-start-2 lg:row-start-2">
                        {CATEGORIES.map((cat, idx) => (
                            <CategoryBlock
                                key={cat.id}
                                category={cat}
                                index={idx}
                                cart={cart}
                                onAdd={addToCart}
                                onDecrement={decrementFromCart}
                                onOpenDetails={setOpenServiceId}
                            />
                        ))}
                    </section>

                    {/* Row 2, col 3 — Sticky cart + offers + promise (desktop only) */}
                    <aside className="hidden lg:col-start-3 lg:row-start-2 lg:block">
                        <div className="sticky top-24 space-y-4">
                            <CartCard
                                items={cartItems}
                                total={cartTotal}
                                originalTotal={cartOriginalTotal}
                                onAdd={addToCart}
                                onDecrement={decrementFromCart}
                            />
                            <OfferCard />
                            <PromiseCard />
                        </div>
                    </aside>
                </div>

                <SeoIntroBlock />
                <ReviewsGrid />
                <LongFormSeoSection />
                <QuickLinksAccordion />
            </main>

            <PageFooter />

            {/* Mobile-only floating quick-jump menu */}
            <MobileQuickMenu
                onSelect={setActiveCategory}
                cartHasItems={cartItems.length > 0}
            />

            {/* Mobile sticky cart bar */}
            {cartItems.length > 0 && (
                <div className="fixed bottom-0 left-0 right-0 z-30 border-t border-slate-200 bg-white px-4 py-3 shadow-lg lg:hidden">
                    <div className="flex items-center justify-between">
                        <div>
                            <div className="text-xs text-slate-500">
                                {cartItems.length} item{cartItems.length === 1 ? "" : "s"}
                            </div>
                            <div className="font-semibold">
                                £{cartTotal}
                                {cartOriginalTotal > cartTotal && (
                                    <span className="ml-2 text-sm font-normal text-slate-400 line-through">
                                        £{cartOriginalTotal}
                                    </span>
                                )}
                            </div>
                        </div>
                        <button
                            type="button"
                            onClick={() => setLocation("/basket")}
                            className="rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800"
                        >
                            View basket
                        </button>
                    </div>
                </div>
            )}

            {/* Service detail modal — opens when a card's Add or View details
              * is tapped. Same modal shell handles both single-option and
              * tiered services; tiered services force a tier pick before add. */}
            {openServiceId &&
                (() => {
                    const svc = ALL_SERVICES.find(
                        (s) => s.id === openServiceId,
                    );
                    if (!svc) return null;
                    return (
                        <ServiceDetailModal
                            service={svc}
                            qty={cart[svc.id] || 0}
                            cart={cart}
                            onClose={() => setOpenServiceId(null)}
                            onAdd={addToCart}
                            onDecrement={decrementFromCart}
                        />
                    );
                })()}
        </div>
    );
}

// ---------------------------------------------------------------------------
// Hero carousel — auto-advancing promo banners
// ---------------------------------------------------------------------------

type Slide = {
    eyebrow: string;
    headline: ReactNode;
    subhead: string;
    bgClass: string;
    textColor: string;
    Icon: typeof Sparkles;
    eyebrowChip: string;
    /** Brand asset image rendered on the right side of the slide. */
    image: string;
    /** Tailwind classes for the gradient overlay that fades the image into the bg. */
    overlay: string;
};

const SLIDES: Slide[] = [
    {
        eyebrow: "Quick-fix tier",
        headline: (
            <>
                30-minute visits{" "}
                <span className="whitespace-nowrap">from £25</span>
            </>
        ),
        subhead: "Three small jobs, one short visit — sorted.",
        bgClass: "bg-gradient-to-r from-amber-300 to-amber-400",
        textColor: "text-slate-900",
        Icon: Clock,
        eyebrowChip: "bg-slate-900 text-amber-300",
        image: slideShelf,
        overlay: "from-amber-300 via-amber-300/80 to-transparent",
    },
    {
        eyebrow: "30-day guarantee",
        headline: <>Workmanship guarantee on every job</>,
        subhead: "Not happy? We come back free, no quibbles, within 30 days.",
        bgClass: "bg-slate-900",
        textColor: "text-white",
        Icon: Shield2,
        eyebrowChip: "bg-amber-400 text-slate-900",
        image: slideAfter,
        overlay: "from-slate-900 via-slate-900/80 to-transparent",
    },
    {
        eyebrow: "Same-week scheduling",
        headline: <>95% of jobs booked inside the week</>,
        subhead: "Most quotes are fulfilled within 3 working days.",
        bgClass: "bg-slate-800",
        textColor: "text-white",
        Icon: Calendar,
        eyebrowChip: "bg-amber-400 text-slate-900",
        image: slideHero,
        overlay: "from-slate-800 via-slate-800/80 to-transparent",
    },
    {
        eyebrow: "Flexible payments",
        headline: <>Pay in 3 with Klarna — no fees</>,
        subhead: "Spread the cost across 3 months on jobs over £150.",
        bgClass: "bg-gradient-to-r from-slate-800 to-slate-900",
        textColor: "text-white",
        Icon: CreditCard,
        eyebrowChip: "bg-amber-400 text-slate-900",
        image: slidePayIn3,
        overlay: "from-slate-800 via-slate-800/80 to-transparent",
    },
];

function HeroCarousel() {
    const [index, setIndex] = useState(0);

    useEffect(() => {
        const id = window.setInterval(
            () => setIndex((i) => (i + 1) % SLIDES.length),
            6000,
        );
        return () => window.clearInterval(id);
    }, []);

    const slide = SLIDES[index];

    return (
        <section className="h-full">
            <div
                className={`relative h-full min-h-[280px] overflow-hidden rounded-2xl ${slide.bgClass} ${slide.textColor} transition-all duration-500 lg:min-h-[420px]`}
            >
                {/* Real brand photo filling the right side, behind the gradient overlay.
                  * Narrower on mobile (45%) so headlines/subheads have room to breathe;
                  * wider (60%) on desktop. */}
                <img
                    src={slide.image}
                    alt=""
                    aria-hidden="true"
                    className="absolute inset-y-0 right-0 h-full w-[45%] object-cover lg:w-3/5"
                />
                {/* Gradient overlay fades the slide bg color into transparency on the right.
                  * On mobile we keep the overlay opaque longer so text stays readable. */}
                <div
                    className={`absolute inset-0 bg-gradient-to-r ${slide.overlay}`}
                />

                {/* Slide content sits over the overlay */}
                <div className="relative flex h-full flex-col justify-between p-6 lg:p-8">
                    <div className="max-w-md">
                        <div
                            className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-wider ${slide.eyebrowChip}`}
                        >
                            <slide.Icon className="h-3.5 w-3.5" />
                            {slide.eyebrow}
                        </div>
                        <h2 className="mt-4 max-w-[55%] text-xl font-bold leading-tight sm:max-w-none sm:text-2xl md:text-3xl lg:text-4xl">
                            {slide.headline}
                        </h2>
                        <p className="mt-3 max-w-[55%] text-xs leading-relaxed opacity-90 sm:max-w-sm sm:text-sm md:text-base">
                            {slide.subhead}
                        </p>
                    </div>

                    <div className="flex items-end justify-between gap-4 pt-6">
                        {/* "Book now" scrolls the user down to the start of
                          * the service grid (#cat-quick-fix). Same behaviour
                          * on every slide — the slide is the hook, the grid
                          * is the conversion surface. CategoryBlock has
                          * `scroll-mt-24` so the sticky header is respected. */}
                        <button
                            type="button"
                            onClick={() =>
                                document
                                    .getElementById("cat-quick-fix")
                                    ?.scrollIntoView({
                                        behavior: "smooth",
                                        block: "start",
                                    })
                            }
                            className="rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-slate-900 shadow-sm transition hover:bg-slate-100 active:scale-[0.97]"
                        >
                            Book now →
                        </button>

                        {/* Dot pagination */}
                        <div className="flex items-center gap-1.5">
                            {SLIDES.map((_, i) => (
                                <button
                                    key={i}
                                    aria-label={`Go to slide ${i + 1}`}
                                    onClick={() => setIndex(i)}
                                    className={`h-1.5 rounded-full transition-all ${
                                        i === index
                                            ? "w-6 bg-amber-400"
                                            : "w-1.5 bg-current opacity-30 hover:opacity-50"
                                    }`}
                                />
                            ))}
                        </div>
                    </div>
                </div>

                {/* Slide controls removed — carousel auto-advances; dot indicators
                  * (rendered above) are the only manual control. Keeps the slide
                  * artwork unobstructed on mobile. */}
            </div>
        </section>
    );
}

// ---------------------------------------------------------------------------
// Hero
// ---------------------------------------------------------------------------

function Hero() {
    return (
        <section className="flex flex-col gap-4">
            <h1 className="text-3xl font-bold tracking-tight text-slate-900 md:text-5xl">
                Handyman <span className="whitespace-nowrap text-amber-500">near you</span>
            </h1>
            <div className="flex items-center gap-2 self-start rounded-full border border-amber-400/40 bg-white px-3 py-1.5 text-slate-900 shadow-sm">
                <SiGoogle className="h-4 w-4" />
                <div className="flex items-center gap-0.5">
                    {[...Array(5)].map((_, i) => (
                        <Star
                            key={i}
                            className="h-3.5 w-3.5 fill-amber-400 text-amber-400"
                        />
                    ))}
                </div>
                <span className="text-sm font-semibold">4.9</span>
                <span className="text-sm text-slate-500">
                    · 300+ Google reviews
                </span>
            </div>

            <Link
                href="/warranty"
                className="mt-2 flex max-w-md items-center gap-3 rounded-xl bg-slate-50 px-4 py-3 transition hover:bg-slate-100"
            >
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-amber-400">
                    <Check className="h-4 w-4 text-slate-900" />
                </span>
                <span className="flex-1 text-sm font-medium">
                    How our 30-day workmanship guarantee works
                </span>
                <ChevronRight className="h-4 w-4 text-slate-400" />
            </Link>
        </section>
    );
}

// ---------------------------------------------------------------------------
// Left-column category nav (desktop)
// ---------------------------------------------------------------------------

function CategoryNav({
    active,
    onSelect,
}: {
    active: string;
    onSelect: (id: string) => void;
}) {
    return (
        <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="mb-3 flex items-center gap-2">
                <div className="h-px flex-1 bg-slate-200" />
                <span className="px-2 text-xs font-medium uppercase tracking-wide text-slate-500">
                    Select a service
                </span>
                <div className="h-px flex-1 bg-slate-200" />
            </div>
            <div className="grid grid-cols-3 gap-2">
                {CATEGORIES.map((cat) => {
                    const isActive = active === cat.id;
                    return (
                        <button
                            key={cat.id}
                            onClick={() => {
                                onSelect(cat.id);
                                const el = document.getElementById(`cat-${cat.id}`);
                                if (el)
                                    el.scrollIntoView({
                                        behavior: "smooth",
                                        block: "start",
                                    });
                            }}
                            className={`flex flex-col items-center gap-1.5 rounded-lg border p-3 text-center transition ${
                                isActive
                                    ? "border-amber-400 bg-amber-400/15"
                                    : "border-transparent hover:bg-slate-50"
                            }`}
                        >
                            <div
                                className={`flex h-12 w-12 items-center justify-center rounded-lg ${
                                    isActive
                                        ? "bg-amber-400/20"
                                        : "bg-slate-100"
                                }`}
                            >
                                {cat.iconText ? (
                                    <div className="flex flex-col items-center leading-none">
                                        <span
                                            className={`text-xl font-extrabold tracking-tight ${
                                                isActive
                                                    ? "text-amber-700"
                                                    : "text-slate-900"
                                            }`}
                                        >
                                            {cat.iconText.primary}
                                        </span>
                                        <span
                                            className={`mt-0.5 text-[8px] font-bold tracking-wider ${
                                                isActive
                                                    ? "text-amber-700"
                                                    : "text-slate-900"
                                            }`}
                                        >
                                            {cat.iconText.secondary}
                                        </span>
                                    </div>
                                ) : (
                                    <cat.Icon
                                        className={`h-6 w-6 ${
                                            isActive ? "text-amber-600" : "text-slate-900"
                                        }`}
                                    />
                                )}
                            </div>
                            <span className="text-[11px] font-medium leading-tight">
                                {cat.name}
                            </span>
                        </button>
                    );
                })}
            </div>
        </div>
    );
}

function CategoryChips({
    active,
    onSelect,
}: {
    active: string;
    onSelect: (id: string) => void;
}) {
    return (
        <div className="-mx-4 overflow-x-auto px-4 pb-2">
            <div className="flex gap-2">
                {CATEGORIES.map((cat) => {
                    const isActive = active === cat.id;
                    return (
                        <button
                            key={cat.id}
                            onClick={() => {
                                onSelect(cat.id);
                                const el = document.getElementById(`cat-${cat.id}`);
                                if (el)
                                    el.scrollIntoView({
                                        behavior: "smooth",
                                        block: "start",
                                    });
                            }}
                            className={`flex shrink-0 items-center gap-2 rounded-full border px-3 py-2 text-xs font-medium transition ${
                                isActive
                                    ? "border-amber-400 bg-amber-400/15 text-slate-900"
                                    : "border-slate-200 bg-white text-slate-600"
                            }`}
                        >
                            {cat.iconText ? (
                                <span className="text-xs font-extrabold tracking-tight">
                                    {cat.iconText.primary}
                                </span>
                            ) : (
                                <cat.Icon className="h-4 w-4" />
                            )}
                            {cat.name}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Mobile-only floating quick-jump menu.
// Once the user has scrolled deep into the services, the category grid at the
// top is off-screen. This pill stays fixed near the bottom and opens a
// bottom-sheet with every category for a single-tap jump.
// ---------------------------------------------------------------------------

function MobileQuickMenu({
    onSelect,
    cartHasItems,
}: {
    onSelect: (id: string) => void;
    cartHasItems: boolean;
}) {
    // `open` controls mount/unmount. `visible` drives the slide-up + fade
    // transitions: we toggle it one frame after mount so the entrance animation
    // plays, and one tick before unmount so the exit animation plays.
    const [open, setOpen] = useState(false);
    const [visible, setVisible] = useState(false);
    // Tracks whether the floating Menu trigger pill has played its entrance
    // animation yet. Starts false on mount, flips true ~one frame later so the
    // button softly fades + lifts + scales into place rather than just popping
    // in. A small delay lets the surrounding page render first so the eye is
    // drawn to the FAB after settling.
    const [triggerReady, setTriggerReady] = useState(false);
    useEffect(() => {
        const id = window.setTimeout(() => setTriggerReady(true), 250);
        return () => window.clearTimeout(id);
    }, []);

    // Schedule the entrance animation on the frame after we mount the sheet
    // (so the browser has a chance to paint the off-screen state first).
    useEffect(() => {
        if (!open) return;
        const id = window.requestAnimationFrame(() => setVisible(true));
        return () => window.cancelAnimationFrame(id);
    }, [open]);

    // Lock body scroll while the sheet is open so the dim backdrop doesn't
    // let the page scroll behind it.
    useEffect(() => {
        if (!open) return;
        const previous = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        return () => {
            document.body.style.overflow = previous;
        };
    }, [open]);

    const close = () => {
        setVisible(false);
        // Wait for the slide-down transition to finish before unmounting,
        // otherwise it would just disappear instantly.
        window.setTimeout(() => setOpen(false), 280);
    };

    const pick = (id: string) => {
        onSelect(id);
        const el = document.getElementById(`cat-${id}`);
        if (el)
            el.scrollIntoView({ behavior: "smooth", block: "start" });
        close();
    };

    // Lift the floating button above the sticky cart bar when items are in the cart.
    const buttonBottom = cartHasItems ? "bottom-24" : "bottom-6";

    return (
        <>
            {/* Floating trigger pill (mobile only) — fades + lifts + scales
              * in on first paint via `triggerReady` so it lands softly rather
              * than just appearing. Composes with `-translate-x-1/2` for
              * horizontal centring (Tailwind transforms merge into one CSS
              * value, so the entrance translate stacks correctly). */}
            <button
                type="button"
                onClick={() => setOpen(true)}
                aria-label="Open category menu"
                aria-haspopup="dialog"
                aria-expanded={open}
                className={`fixed ${buttonBottom} left-1/2 z-30 flex -translate-x-1/2 items-center gap-2 rounded-full bg-slate-900 px-5 py-3 text-sm font-semibold text-white shadow-lg ring-1 ring-white/10 transition-all duration-500 ease-out hover:bg-slate-800 active:scale-[0.97] lg:hidden ${
                    triggerReady
                        ? "translate-y-0 scale-100 opacity-100"
                        : "translate-y-6 scale-90 opacity-0"
                }`}
            >
                <MenuIcon className="h-4 w-4" />
                Menu
            </button>

            {/* Centred popup modal — fades + scales into the middle of the
              * viewport rather than rising from the bottom edge. Backdrop
              * fades independently so the popup gets a clean scale-in feel. */}
            {open && (
                <div
                    role="dialog"
                    aria-modal="true"
                    aria-label="Jump to a service category"
                    className="lg:hidden"
                >
                    {/* Backdrop — fades in/out */}
                    <div
                        onClick={close}
                        className={`fixed inset-0 z-40 bg-black/60 backdrop-blur-sm transition-opacity duration-300 ease-out ${
                            visible ? "opacity-100" : "opacity-0"
                        }`}
                    />

                    {/* Centering wrapper — covers the viewport so the modal can
                      * be flex-centred. `pointer-events-none` lets clicks pass
                      * through to the backdrop except where the modal itself
                      * sits (which re-enables them). */}
                    <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center p-4">
                        {/* Popup card — scales + fades in from 95% */}
                        <div
                            className={`pointer-events-auto w-full max-w-sm overflow-y-auto rounded-3xl bg-white p-5 shadow-2xl transition-all duration-300 ease-out max-h-[85vh] ${
                                visible
                                    ? "scale-100 opacity-100"
                                    : "scale-95 opacity-0"
                            }`}
                        >
                            {/* Close X — pinned to the top-right of the
                              * popup. No title needed; the grid speaks for
                              * itself. */}
                            <div className="mb-3 flex justify-end">
                                <button
                                    type="button"
                                    onClick={close}
                                    aria-label="Close menu"
                                    className="-mr-1 -mt-1 flex h-9 w-9 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
                                >
                                    <X className="h-5 w-5" />
                                </button>
                            </div>

                            {/* 3-column square tile grid — each tile mirrors
                              * the page's category nav: gradient/slate tile
                              * with either a typographic "30/MINS" stack or a
                              * Lucide icon, with the category name beneath. */}
                            <div className="grid grid-cols-3 gap-3">
                                {CATEGORIES.map((cat) => (
                                    <button
                                        key={cat.id}
                                        type="button"
                                        onClick={() => pick(cat.id)}
                                        className="group flex flex-col items-center gap-2 rounded-xl p-1 text-left transition active:scale-[0.95]"
                                    >
                                        <div className="flex aspect-square w-full items-center justify-center rounded-2xl bg-slate-100 transition group-hover:bg-amber-100 group-active:bg-amber-100">
                                            {cat.iconText ? (
                                                <div className="flex flex-col items-center leading-none text-slate-900">
                                                    <span className="text-2xl font-extrabold tracking-tight">
                                                        {cat.iconText.primary}
                                                    </span>
                                                    <span className="mt-0.5 text-[9px] font-bold tracking-wider">
                                                        {cat.iconText.secondary}
                                                    </span>
                                                </div>
                                            ) : (
                                                <cat.Icon
                                                    className="h-8 w-8 text-slate-900"
                                                    strokeWidth={1.75}
                                                />
                                            )}
                                        </div>
                                        <span className="line-clamp-2 w-full text-center text-[11px] font-medium leading-tight text-slate-900">
                                            {cat.name}
                                        </span>
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}

// ---------------------------------------------------------------------------
// Mobile-only promo chips — horizontally-scrolling row above the category grid.
// Mirrors the source's pattern of pulling cart-sidebar offers into the body
// where they're more discoverable on small screens.
// ---------------------------------------------------------------------------

const MOBILE_PROMOS: {
    id: string;
    Icon: typeof Percent;
    title: string;
    subtitle: string;
}[] = [
    {
        id: "small-order",
        Icon: Percent,
        title: "Small-order fee waived",
        subtitle: "On bookings above £58",
    },
    {
        id: "first-booking",
        Icon: Sparkles,
        title: "£10 off your first booking",
        subtitle: "Use code WELCOME10",
    },
    {
        id: "klarna",
        Icon: CreditCard,
        title: "Pay in 3 with Klarna",
        subtitle: "On jobs over £150 — no fees",
    },
];

function MobilePromoChips() {
    return (
        <div className="-mx-4 overflow-x-auto px-4 pb-1 pt-2 lg:hidden">
            <div className="flex snap-x snap-mandatory gap-3">
                {MOBILE_PROMOS.map((promo) => (
                    <div
                        key={promo.id}
                        className="flex min-w-[260px] shrink-0 snap-start items-start gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm"
                    >
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-400 text-slate-900">
                            <promo.Icon className="h-4 w-4" />
                        </div>
                        <div className="min-w-0">
                            <p className="text-sm font-semibold leading-tight text-slate-900">
                                {promo.title}
                            </p>
                            <p className="mt-0.5 text-xs text-slate-500">
                                {promo.subtitle}
                            </p>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Service grid (middle column)
// ---------------------------------------------------------------------------

function CategoryBlock({
    category,
    index,
    cart,
    onAdd,
    onDecrement,
    onOpenDetails,
}: {
    category: Category;
    index: number;
    cart: Record<string, number>;
    onAdd: (id: string) => void;
    onDecrement: (id: string) => void;
    onOpenDetails: (id: string) => void;
}) {
    const isFirst = index === 0;
    return (
        <div
            id={`cat-${category.id}`}
            className={`scroll-mt-24 ${
                isFirst
                    ? "pb-10"
                    : "border-t-[6px] border-slate-100 pb-10 pt-10"
            }`}
        >
            {/* Section heading row with count badge — icon chip removed for a
              * cleaner, more text-forward look in the service grid. */}
            <div className="mb-5 flex items-center gap-3">
                <h2 className="text-2xl font-bold">{category.name}</h2>
                <span className="ml-auto rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600">
                    {category.services.length} option
                    {category.services.length === 1 ? "" : "s"}
                </span>
            </div>

            {category.promoBanner && (
                <PromoBannerCard banner={category.promoBanner} />
            )}

            <div className="space-y-4">
                {category.services.map((svc) => (
                    <ServiceCard
                        key={svc.id}
                        service={svc}
                        qty={cart[svc.id] || 0}
                        onAdd={() => onAdd(svc.id)}
                        onDecrement={() => onDecrement(svc.id)}
                        onOpenDetails={() => onOpenDetails(svc.id)}
                    />
                ))}
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Modal body sections — variant picker, the Handy Promise, overview tiles,
// what's included / excluded. Each is a self-contained section rendered
// inside ServiceDetailModal's scrollable body.
// ---------------------------------------------------------------------------

function VariantPicker({
    tiers,
    cart,
    onAdd,
    onDecrement,
}: {
    tiers: ServiceTier[];
    cart: Record<string, number>;
    onAdd: (id: string) => void;
    onDecrement: (id: string) => void;
}) {
    return (
        <section className="mb-8">
            <h3 className="mb-3 text-lg font-bold text-slate-900">
                Choose an option
            </h3>
            <div className="-mx-5 overflow-x-auto px-5 pb-2 lg:-mx-7 lg:px-7">
                <div className="flex snap-x snap-mandatory gap-3">
                    {tiers.map((tier) => {
                        const qty = cart[tier.id] || 0;
                        return (
                            <div
                                key={tier.id}
                                className="flex w-44 shrink-0 snap-start flex-col gap-2 rounded-xl border border-slate-200 bg-white p-3 shadow-sm"
                            >
                                <div>
                                    <h4 className="text-sm font-semibold leading-tight text-slate-900">
                                        {tier.name}
                                    </h4>
                                    <div className="mt-1 flex items-center gap-1 text-xs">
                                        <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                                        <span className="font-medium underline decoration-dotted underline-offset-2">
                                            {tier.rating}
                                        </span>
                                        <span className="text-slate-500">
                                            ({tier.reviewCount})
                                        </span>
                                    </div>
                                </div>
                                <div className="flex items-baseline gap-1.5">
                                    <span className="text-sm font-semibold">
                                        £{tier.priceCurrent}
                                    </span>
                                    {tier.priceOriginal && (
                                        <span className="text-xs text-slate-400 line-through">
                                            £{tier.priceOriginal}
                                        </span>
                                    )}
                                    <span className="text-xs text-slate-500">
                                        · {tier.durationMinutes} min
                                    </span>
                                </div>
                                {qty === 0 ? (
                                    <button
                                        type="button"
                                        onClick={() => onAdd(tier.id)}
                                        className="mt-auto inline-flex w-full items-center justify-center gap-1 rounded-lg bg-amber-400 px-3 py-2 text-xs font-bold uppercase tracking-wide text-slate-900 shadow-sm ring-1 ring-amber-500/30 transition hover:bg-amber-500 active:scale-[0.97]"
                                    >
                                        <Plus className="h-3.5 w-3.5" />
                                        Add
                                    </button>
                                ) : (
                                    <div className="mt-auto flex items-center justify-between rounded-lg bg-amber-400 px-1.5 py-1 shadow-sm ring-1 ring-amber-500/30">
                                        <button
                                            type="button"
                                            onClick={() => onDecrement(tier.id)}
                                            className="flex h-6 w-6 items-center justify-center rounded-md text-slate-900 transition hover:bg-amber-500"
                                            aria-label="Decrease"
                                        >
                                            <Minus className="h-3.5 w-3.5" />
                                        </button>
                                        <span className="text-xs font-bold text-slate-900">
                                            {qty}
                                        </span>
                                        <button
                                            type="button"
                                            onClick={() => onAdd(tier.id)}
                                            className="flex h-6 w-6 items-center justify-center rounded-md text-slate-900 transition hover:bg-amber-500"
                                            aria-label="Increase"
                                        >
                                            <Plus className="h-3.5 w-3.5" />
                                        </button>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>
        </section>
    );
}

function HandyPromiseSection() {
    const items = [
        {
            Icon: ShieldCheck,
            title: "30-day workmanship guarantee",
            subtitle:
                "Not happy with the work? We come back free, no quibbles, within 30 days.",
        },
        {
            Icon: Sparkles,
            title: "Free callback",
            subtitle:
                "Spot something we missed? We return within 7 days at no extra cost.",
        },
    ];
    return (
        <section className="mb-8">
            <h3 className="mb-3 text-lg font-bold text-slate-900">
                The Handy Promise
            </h3>
            <div className="grid grid-cols-2 gap-3">
                {items.map((i) => (
                    <div
                        key={i.title}
                        className="rounded-xl border border-slate-100 bg-slate-50 p-4"
                    >
                        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white text-amber-500 shadow-sm">
                            <i.Icon className="h-5 w-5" />
                        </div>
                        <p className="mt-3 text-sm font-semibold text-slate-900">
                            {i.title}
                        </p>
                        <p className="mt-1 text-xs leading-relaxed text-slate-500">
                            {i.subtitle}
                        </p>
                    </div>
                ))}
            </div>
        </section>
    );
}

function OverviewSection() {
    const items = [
        {
            Icon: ShieldCheck,
            label: "DBS-checked team",
            sub: "Every tradesperson background-checked, rated 4.6★+",
        },
        {
            Icon: Sparkles,
            label: "£2M public liability",
            sub: "Cover you can actually call on if something goes wrong",
        },
        {
            Icon: Calendar,
            label: "Same-week service",
            sub: "95% of bookings done within 3 working days",
        },
    ];
    return (
        <section className="mb-8">
            <h3 className="mb-3 text-lg font-bold text-slate-900">Overview</h3>
            <div className="grid grid-cols-3 gap-3">
                {items.map((i) => (
                    <div
                        key={i.label}
                        className="rounded-xl border border-slate-100 bg-slate-50 p-3 text-center"
                    >
                        <div className="mx-auto flex h-9 w-9 items-center justify-center rounded-full bg-amber-400/20">
                            <i.Icon className="h-4 w-4 text-slate-900" />
                        </div>
                        <p className="mt-2 text-xs font-semibold leading-tight text-slate-900">
                            {i.label}
                        </p>
                        <p className="mt-1 text-[10px] leading-tight text-slate-500">
                            {i.sub}
                        </p>
                    </div>
                ))}
            </div>
        </section>
    );
}

function IncludedSection() {
    const included = [
        "Arrival within 15 min of your booked slot",
        "Standard screws, wall plugs and brackets supplied",
        "Tidy-up and debris removal after we finish",
        "30-day workmanship guarantee on every job",
    ];
    const excluded = [
        "Cost of specialist parts (we'll quote before purchase)",
        "Notifiable work that needs a registered plumber or electrician",
        "Moving furniture or appliances away from the work area",
    ];
    return (
        <section className="mb-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div>
                <h3 className="mb-3 text-lg font-bold text-slate-900">
                    What's included
                </h3>
                <ul className="space-y-2.5">
                    {included.map((item) => (
                        <li key={item} className="flex items-start gap-2.5">
                            <Check className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                            <span className="text-sm text-slate-700">{item}</span>
                        </li>
                    ))}
                </ul>
            </div>
            <div>
                <h3 className="mb-3 text-lg font-bold text-slate-900">
                    What's not included
                </h3>
                <ul className="space-y-2.5">
                    {excluded.map((item) => (
                        <li key={item} className="flex items-start gap-2.5">
                            <X className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                            <span className="text-sm text-slate-700">{item}</span>
                        </li>
                    ))}
                </ul>
            </div>
        </section>
    );
}

// ---------------------------------------------------------------------------
// ServiceDetailModal — opens when a user taps "Add" or "View details" on a
// service card. Renders as a centered modal on desktop (≥ lg) and a
// bottom-sheet on mobile. Sticky header carries the service name/price/Add
// (for single-option services). Tiered services show a variant picker in the
// body and force the user to pick a tier before adding to cart.
// ---------------------------------------------------------------------------

function ServiceDetailModal({
    service,
    qty,
    cart,
    onClose,
    onAdd,
    onDecrement,
}: {
    service: Service;
    qty: number;
    cart: Record<string, number>;
    onClose: () => void;
    onAdd: (id: string) => void;
    onDecrement: (id: string) => void;
}) {
    // ESC key closes the modal
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [onClose]);

    // Lock body scroll while the modal is open
    useEffect(() => {
        const prev = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        return () => {
            document.body.style.overflow = prev;
        };
    }, []);

    // Slide-up transition: mount in the off-screen state, then flip to visible
    // on the next animation frame so the transform actually animates.
    const [visible, setVisible] = useState(false);
    useEffect(() => {
        const id = requestAnimationFrame(() => setVisible(true));
        return () => cancelAnimationFrame(id);
    }, []);

    const isTiered = !!service.tiers?.length;

    return (
        <div
            role="dialog"
            aria-modal="true"
            aria-label={`${service.name} details`}
        >
            {/* Backdrop — fades in */}
            <div
                onClick={onClose}
                className={`fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm transition-opacity duration-300 ${
                    visible ? "opacity-100" : "opacity-0"
                }`}
            />

            {/* Close X — sits OUTSIDE the modal on the backdrop (top-right of viewport) */}
            <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className={`fixed right-4 top-4 z-[70] flex h-9 w-9 items-center justify-center rounded-full bg-white text-slate-900 shadow-md transition-all duration-300 hover:bg-slate-100 lg:right-8 lg:top-8 lg:h-10 lg:w-10 ${
                    visible ? "opacity-100" : "opacity-0"
                }`}
            >
                <X className="h-5 w-5" />
            </button>

            {/*
              * Container: mobile bottom-sheet (slides up from below on mount),
              * desktop centered card (fades + scales in). The translate-y-full
              * starts the modal off-screen below the viewport; flipping `visible`
              * to true on the next animation frame triggers the slide-up.
              */}
            <div
                className={`fixed inset-x-0 bottom-0 z-[65] flex max-h-[92vh] flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl transition-all duration-300 ease-out lg:inset-auto lg:left-1/2 lg:top-1/2 lg:h-auto lg:max-h-[88vh] lg:w-[min(720px,calc(100vw-2rem))] lg:-translate-x-1/2 lg:-translate-y-1/2 lg:rounded-2xl ${
                    visible
                        ? "translate-y-0 opacity-100 lg:scale-100"
                        : "translate-y-full opacity-0 lg:translate-y-[-50%] lg:scale-95"
                }`}
            >
                {/* Mobile drag handle */}
                <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-slate-200 lg:hidden" />

                {/* Sticky header */}
                <header className="shrink-0 border-b border-slate-100 bg-white px-5 py-4 lg:px-7 lg:py-5">
                    <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0 flex-1">
                            <h2 className="text-xl font-bold leading-tight text-slate-900 lg:text-2xl">
                                {service.name}
                            </h2>
                            <div className="mt-1.5 flex items-center gap-1.5 text-sm">
                                <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                                <span className="font-medium underline decoration-dotted underline-offset-2">
                                    {service.rating}{" "}
                                    <span className="text-slate-500">
                                        ({service.reviewCount})
                                    </span>
                                </span>
                            </div>
                            <div className="mt-1.5 flex items-baseline gap-2 text-sm">
                                {service.startsAt || isTiered ? (
                                    <span className="font-semibold">
                                        Starts at £{service.priceCurrent}
                                    </span>
                                ) : (
                                    <>
                                        <span className="font-semibold">
                                            £{service.priceCurrent}
                                        </span>
                                        {service.priceOriginal && (
                                            <span className="text-slate-400 line-through">
                                                £{service.priceOriginal}
                                            </span>
                                        )}
                                        {service.durationMinutes && (
                                            <span className="text-slate-500">
                                                · {service.durationMinutes} mins
                                            </span>
                                        )}
                                    </>
                                )}
                            </div>
                        </div>

                        {/* In-modal Add/stepper (single-option services only;
                          * tiered services force the user to pick a variant) */}
                        {!isTiered && (
                            <div className="shrink-0">
                                {qty === 0 ? (
                                    <button
                                        type="button"
                                        onClick={() => onAdd(service.id)}
                                        className="inline-flex items-center gap-1.5 rounded-lg bg-amber-400 px-4 py-2.5 text-sm font-bold uppercase tracking-wide text-slate-900 shadow-md ring-1 ring-amber-500/30 transition hover:bg-amber-500 active:scale-[0.97]"
                                    >
                                        <Plus className="h-4 w-4" />
                                        Add
                                    </button>
                                ) : (
                                    <div className="flex items-center gap-1 rounded-lg bg-amber-400 px-1.5 py-1 shadow-md ring-1 ring-amber-500/30">
                                        <button
                                            type="button"
                                            onClick={() =>
                                                onDecrement(service.id)
                                            }
                                            className="flex h-7 w-7 items-center justify-center rounded-md text-slate-900 transition hover:bg-amber-500"
                                            aria-label="Decrease quantity"
                                        >
                                            <Minus className="h-4 w-4" />
                                        </button>
                                        <span className="min-w-[1.5rem] text-center text-sm font-bold text-slate-900">
                                            {qty}
                                        </span>
                                        <button
                                            type="button"
                                            onClick={() => onAdd(service.id)}
                                            className="flex h-7 w-7 items-center justify-center rounded-md text-slate-900 transition hover:bg-amber-500"
                                            aria-label="Increase quantity"
                                        >
                                            <Plus className="h-4 w-4" />
                                        </button>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </header>

                {/* Scrollable body */}
                <div className="flex-1 overflow-y-auto px-5 py-5 lg:px-7 lg:py-6">
                    {service.longDescription && (
                        <p className="mb-6 text-sm leading-relaxed text-slate-600 lg:text-base">
                            {service.longDescription}
                        </p>
                    )}

                    {/* Variant picker — only for tiered services */}
                    {isTiered && service.tiers && (
                        <VariantPicker
                            tiers={service.tiers}
                            cart={cart}
                            onAdd={onAdd}
                            onDecrement={onDecrement}
                        />
                    )}

                    <HandyPromiseSection />
                    <OverviewSection />
                    <IncludedSection />
                </div>
            </div>
        </div>
    );
}

function PromoBannerCard({ banner }: { banner: PromoBanner }) {
    return (
        <div className="relative mb-5 overflow-hidden rounded-2xl bg-slate-900 text-white shadow-md">
            {/* Brand photo on the right side — narrower on mobile so headline/price stay readable */}
            <img
                src={banner.image}
                alt=""
                aria-hidden="true"
                loading="lazy"
                decoding="async"
                className="absolute inset-y-0 right-0 h-full w-[42%] object-cover sm:w-1/2"
            />
            {/* Gradient overlay fades the slate-900 bg into the photo */}
            <div className="absolute inset-0 bg-gradient-to-r from-slate-900 via-slate-900/90 to-slate-900/10 sm:via-slate-900/85 sm:to-transparent" />

            {/* Content sits on top of overlay */}
            <div className="relative max-w-md p-6 lg:p-7">
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-400 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-slate-900 shadow-sm">
                    {banner.eyebrow}
                </span>
                <h3 className="mt-3 text-2xl font-bold leading-tight md:text-3xl">
                    {banner.headline}
                </h3>
                <div className="mt-3 flex items-baseline gap-2">
                    <span className="text-3xl font-extrabold text-amber-400 md:text-4xl">
                        £{banner.priceCurrent}
                    </span>
                    {banner.priceOriginal && (
                        <span className="text-lg text-white/50 line-through">
                            £{banner.priceOriginal}
                        </span>
                    )}
                </div>
            </div>
        </div>
    );
}

function ServiceCard({
    service,
    qty,
    onAdd,
    onDecrement,
    onOpenDetails,
}: {
    service: Service;
    qty: number;
    onAdd: () => void;
    onDecrement: () => void;
    onOpenDetails: () => void;
}) {
    return (
        <article className="flex gap-4 border-b border-slate-100 pb-6">
            <div className="min-w-0 flex-1">
                {service.promoLabel && (
                    <div className="mb-1 text-xs font-semibold tracking-wide text-amber-600">
                        {service.promoLabel}
                    </div>
                )}
                <h3 className="truncate text-base font-semibold">
                    {service.name}
                </h3>

                <div className="mt-1 flex items-center gap-1.5">
                    <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-amber-400">
                        <Star className="h-2.5 w-2.5 fill-white text-white" />
                    </span>
                    <span className="text-sm font-medium underline decoration-dotted underline-offset-2">
                        {service.rating}{" "}
                        <span className="text-slate-500">
                            ({service.reviewCount})
                        </span>
                    </span>
                </div>

                <div className="mt-1 flex items-center gap-2 text-sm">
                    {service.startsAt ? (
                        <span className="font-semibold">
                            Starts at £{service.priceCurrent}
                        </span>
                    ) : (
                        <>
                            <span className="font-semibold">
                                £{service.priceCurrent}
                            </span>
                            {service.priceOriginal && (
                                <span className="text-slate-400 line-through">
                                    £{service.priceOriginal}
                                </span>
                            )}
                            {service.durationMinutes && (
                                <span className="text-slate-500">
                                    • {service.durationMinutes} mins
                                </span>
                            )}
                        </>
                    )}
                </div>

                <ul className="mt-3 space-y-1 text-xs leading-snug text-slate-600">
                    {service.bullets.map((b, i) => (
                        <li key={i} className="flex gap-2">
                            <span className="mt-1.5 inline-block h-1 w-1 shrink-0 rounded-full bg-slate-400" />
                            <span>{b}</span>
                        </li>
                    ))}
                </ul>

                <button
                    type="button"
                    onClick={onOpenDetails}
                    className="mt-3 text-sm font-medium text-amber-600 hover:underline"
                >
                    View details
                </button>
            </div>

            <div className="flex w-24 shrink-0 flex-col items-center gap-2 sm:w-28 lg:w-32">
                {service.thumbImage ? (
                    <img
                        src={service.thumbImage}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        className="h-24 w-24 rounded-xl object-cover shadow-sm sm:h-28 sm:w-28 lg:h-32 lg:w-32"
                    />
                ) : service.thumbText ? (
                    <div
                        className={`flex h-24 w-24 items-center justify-center rounded-xl bg-gradient-to-br sm:h-28 sm:w-28 lg:h-32 lg:w-32 ${service.thumbBg}`}
                    >
                        <div className="flex flex-col items-center leading-none text-slate-900">
                            <span className="text-4xl font-extrabold tracking-tight sm:text-5xl lg:text-6xl">
                                {service.thumbText.primary}
                            </span>
                            <span className="mt-1 text-[10px] font-bold tracking-wider sm:text-xs lg:text-sm">
                                {service.thumbText.secondary}
                            </span>
                        </div>
                    </div>
                ) : service.thumbIcon ? (
                    <div
                        className={`flex h-24 w-24 items-center justify-center rounded-xl bg-gradient-to-br text-slate-800 sm:h-28 sm:w-28 lg:h-32 lg:w-32 ${service.thumbBg}`}
                    >
                        <service.thumbIcon
                            className="h-10 w-10 sm:h-12 sm:w-12 lg:h-14 lg:w-14"
                            strokeWidth={1.75}
                            aria-hidden
                        />
                    </div>
                ) : (
                    <div
                        className={`flex h-24 w-24 items-center justify-center rounded-xl bg-gradient-to-br text-4xl sm:h-28 sm:w-28 sm:text-5xl lg:h-32 lg:w-32 ${service.thumbBg}`}
                    >
                        {service.thumbEmoji}
                    </div>
                )}

                {qty === 0 ? (
                    <button
                        type="button"
                        onClick={
                            service.tiers && service.tiers.length > 0
                                ? onOpenDetails
                                : onAdd
                        }
                        className="group inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-amber-400 px-3 py-2.5 text-sm font-bold uppercase tracking-wide text-slate-900 shadow-md ring-1 ring-amber-500/30 transition hover:bg-amber-500 hover:shadow-lg active:scale-[0.97]"
                    >
                        <Plus className="h-4 w-4 transition-transform group-hover:rotate-90" />
                        Add
                    </button>
                ) : (
                    <div className="flex w-full items-center justify-between rounded-lg bg-amber-400 px-2 py-1.5 shadow-md ring-1 ring-amber-500/30">
                        <button
                            onClick={onDecrement}
                            className="flex h-6 w-6 items-center justify-center rounded-md text-slate-900 transition hover:bg-amber-500"
                            aria-label="Decrease quantity"
                        >
                            <Minus className="h-3.5 w-3.5" />
                        </button>
                        <span className="text-sm font-bold text-slate-900">
                            {qty}
                        </span>
                        <button
                            onClick={onAdd}
                            className="flex h-6 w-6 items-center justify-center rounded-md text-slate-900 transition hover:bg-amber-500"
                            aria-label="Increase quantity"
                        >
                            <Plus className="h-3.5 w-3.5" />
                        </button>
                    </div>
                )}

                {service.optionsCount && (
                    <span className="text-xs text-slate-500">
                        {service.optionsCount} options
                    </span>
                )}
            </div>
        </article>
    );
}

// ---------------------------------------------------------------------------
// Right column — cart, offers, promise
// ---------------------------------------------------------------------------

function CartCard({
    items,
    total,
    originalTotal,
    onAdd,
    onDecrement,
}: {
    items: (Service & { qty: number })[];
    total: number;
    originalTotal: number;
    onAdd: (id: string) => void;
    onDecrement: (id: string) => void;
}) {
    return (
        <div className="rounded-xl border border-slate-200 bg-white">
            <div className="border-b border-slate-100 px-4 py-3">
                <h3 className="text-lg font-bold">Cart</h3>
            </div>

            {items.length === 0 ? (
                <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
                    <ShoppingCart className="h-10 w-10 text-slate-300" />
                    <p className="text-sm text-slate-500">No items in your cart</p>
                </div>
            ) : (
                <>
                    <div className="divide-y divide-slate-100">
                        {items.map((item) => (
                            <div key={item.id} className="flex items-start gap-3 px-4 py-3">
                                <div className="min-w-0 flex-1">
                                    <p className="line-clamp-2 text-sm font-medium">
                                        {item.name}
                                    </p>
                                </div>
                                <div className="flex shrink-0 flex-col items-end gap-1">
                                    <div className="flex items-center gap-1 rounded-md border border-amber-400 bg-amber-400/15 px-1 py-0.5">
                                        <button
                                            onClick={() => onDecrement(item.id)}
                                            className="flex h-5 w-5 items-center justify-center text-amber-600"
                                            aria-label="Decrease quantity"
                                        >
                                            <Minus className="h-3 w-3" />
                                        </button>
                                        <span className="min-w-[1ch] text-center text-xs font-semibold">
                                            {item.qty}
                                        </span>
                                        <button
                                            onClick={() => onAdd(item.id)}
                                            className="flex h-5 w-5 items-center justify-center text-amber-600"
                                            aria-label="Increase quantity"
                                        >
                                            <Plus className="h-3 w-3" />
                                        </button>
                                    </div>
                                    <div className="text-right text-sm">
                                        <div className="font-semibold">
                                            £{item.priceCurrent * item.qty}
                                        </div>
                                        {item.priceOriginal && (
                                            <div className="text-xs text-slate-400 line-through">
                                                £{item.priceOriginal * item.qty}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>

                    <div className="border-t border-slate-100 p-3">
                        <button className="flex w-full items-center justify-between rounded-lg bg-slate-900 px-4 py-3 text-white shadow-sm transition hover:bg-slate-800">
                            <span className="text-sm font-semibold">
                                £{total}
                                {originalTotal > total && (
                                    <span className="ml-2 text-xs font-normal text-white/60 line-through">
                                        £{originalTotal}
                                    </span>
                                )}
                            </span>
                            <span className="text-sm font-semibold text-amber-400">
                                View Cart →
                            </span>
                        </button>
                    </div>
                </>
            )}
        </div>
    );
}

function OfferCard() {
    // Reuses the same MOBILE_PROMOS catalog the mobile-only chip scroller
    // uses, so the offer list is shared across viewports. Collapsed state
    // surfaces the first offer; expanded state shows all three with the
    // toggle flipping its label/chevron.
    const [expanded, setExpanded] = useState(false);
    const visible = expanded ? MOBILE_PROMOS : MOBILE_PROMOS.slice(0, 1);

    return (
        <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="space-y-3">
                {visible.map((promo) => (
                    <div
                        key={promo.id}
                        className="flex items-start gap-3"
                    >
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-400 text-slate-900">
                            <promo.Icon className="h-4 w-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                            <p className="text-sm font-semibold text-slate-900">
                                {promo.title}
                            </p>
                            <p className="text-xs text-slate-500">
                                {promo.subtitle}
                            </p>
                        </div>
                    </div>
                ))}
            </div>

            {MOBILE_PROMOS.length > 1 && (
                <button
                    type="button"
                    onClick={() => setExpanded((v) => !v)}
                    aria-expanded={expanded}
                    className="mt-3 flex w-full items-center justify-between rounded-md text-sm font-medium text-amber-600 transition hover:text-amber-700"
                >
                    <span>
                        {expanded
                            ? "View less offers"
                            : `View ${MOBILE_PROMOS.length - 1} more offer${MOBILE_PROMOS.length - 1 === 1 ? "" : "s"}`}
                    </span>
                    <ChevronDown
                        className={`h-4 w-4 transition-transform ${expanded ? "rotate-180" : ""}`}
                    />
                </button>
            )}
        </div>
    );
}

function PromiseCard() {
    return (
        <div className="relative overflow-hidden rounded-xl border border-slate-200 bg-white p-4">
            <h3 className="mb-3 text-base font-bold">The Handy Promise</h3>
            <ul className="space-y-2 text-sm">
                {[
                    "Vetted, DBS-checked tradespeople",
                    "Hassle-free online booking",
                    "Transparent up-front pricing",
                ].map((item) => (
                    <li key={item} className="flex items-center gap-2">
                        <Check className="h-4 w-4 shrink-0 text-amber-600" />
                        <span>{item}</span>
                    </li>
                ))}
            </ul>
            <div className="absolute -right-4 -top-4 flex h-24 w-24 items-center justify-center rounded-full border-4 border-dashed border-amber-400/40 bg-white">
                <div className="flex h-16 w-16 flex-col items-center justify-center rounded-full bg-amber-400/20 text-center text-[8px] font-bold leading-tight text-slate-900">
                    <ShieldCheck className="mb-0.5 h-5 w-5 text-amber-600" />
                    <span>QUALITY</span>
                    <span>ASSURED</span>
                </div>
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// SEO + content blocks
// ---------------------------------------------------------------------------

function SeoIntroBlock() {
    return (
        <section className="mt-12 grid grid-cols-1 items-center gap-8 border-t border-slate-100 pt-12 md:grid-cols-2 md:gap-12">
            <div className="relative aspect-square overflow-hidden rounded-2xl md:aspect-[5/4]">
                <img
                    src={seoLocalImage}
                    alt="A Handy Services tradesperson at a customer's home in Nottingham"
                    loading="lazy"
                    decoding="async"
                    className="h-full w-full object-cover"
                />
                {/* Subtle bottom gradient for image-as-card polish */}
                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-slate-900/30 to-transparent" />
                {/* Small location pill on the photo */}
                <div className="absolute bottom-4 left-4 inline-flex items-center gap-1.5 rounded-full bg-white/95 px-3 py-1.5 text-xs font-semibold text-slate-900 shadow-sm">
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                    Serving Nottingham &amp; surrounding areas
                </div>
            </div>
            <div>
                <h2 className="text-3xl font-bold tracking-tight">
                    Handyman near you, Nottingham
                </h2>
                <p className="mt-4 text-sm leading-relaxed text-slate-600">
                    Need a local handyman you can trust? Handy is a single
                    platform for small repairs and installations around the home
                    — from drilling and curtain hanging to flat-pack assembly,
                    smart locks and TV mounting. Our Nottingham team is vetted,
                    DBS-checked and insured. Every job is fixed-price up front,
                    booked online in under a minute, and backed by our 30-day
                    workmanship warranty.
                </p>
                <nav className="mt-6 text-sm font-semibold">
                    <span className="block text-2xl font-bold">You are here</span>
                    <span className="mt-2 inline-block text-slate-500">
                        <Link href="/" className="hover:underline">
                            Home
                        </Link>{" "}
                        / <span className="text-slate-900">Handyman</span>
                    </span>
                </nav>
            </div>
        </section>
    );
}

const REVIEWS = [
    {
        name: "Daniel G.",
        date: "May 2026",
        rating: 5,
        text: "Brilliant service from start to finish. Tradesperson arrived on time, sorted three jobs in under an hour and tidied up properly.",
    },
    {
        name: "Verified customer",
        date: "May 2026",
        rating: 5,
        text: "Fast, friendly and very good at the job. Will definitely use again.",
    },
    {
        name: "Abhi M.",
        date: "May 2026",
        rating: 5,
        text: "Excellent — mounted my TV beautifully and tidied the cable run behind the unit. Money well spent.",
    },
    {
        name: "Verified customer",
        date: "May 2026",
        rating: 5,
        text: "Very professional and finished well within the estimated time.",
    },
    {
        name: "Home (Lenton)",
        date: "May 2026",
        rating: 5,
        text: "Great, quick service and a really polite tradesperson — thank you.",
    },
    {
        name: "Eldhose K.",
        date: "May 2026",
        rating: 5,
        text: "Booked Friday afternoon, sorted by Saturday morning. Highly recommended.",
    },
    {
        name: "Lana W.",
        date: "May 2026",
        rating: 5,
        text: "Quick and excellent work — assembled a wardrobe that defeated me for a week.",
    },
    {
        name: "Verified customer",
        date: "Apr 2026",
        rating: 5,
        text: "Tanveer was outstanding. Nothing was too much trouble — would request him again.",
    },
];

function ReviewsGrid() {
    return (
        <section className="mt-16 border-t border-slate-100 pt-12">
            <h2 className="text-3xl font-bold tracking-tight">Customer reviews</h2>
            <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
                {REVIEWS.map((r, i) => (
                    <div
                        key={i}
                        className="rounded-xl border border-slate-100 bg-white p-4"
                    >
                        <div className="flex items-start justify-between">
                            <div className="flex items-center gap-3">
                                <div className="flex h-10 w-10 items-center justify-center rounded-md bg-slate-100">
                                    <span className="text-sm font-semibold text-slate-500">
                                        {r.name.charAt(0)}
                                    </span>
                                </div>
                                <div>
                                    <div className="text-sm font-semibold">
                                        {r.name}
                                    </div>
                                    <div className="text-xs text-slate-500">
                                        {r.date}
                                    </div>
                                </div>
                            </div>
                            <div className="flex items-center gap-1 text-sm">
                                <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                                <span className="font-medium">{r.rating}</span>
                            </div>
                        </div>
                        <p className="mt-3 text-sm leading-relaxed text-slate-700">
                            {r.text}
                        </p>
                    </div>
                ))}
            </div>
        </section>
    );
}

function LongFormSeoSection() {
    return (
        <section className="mt-16 space-y-10 border-t border-slate-100 pt-12 text-slate-700">
            <div>
                <h2 className="text-2xl font-bold text-slate-900">
                    Four reasons to book a local handyman
                </h2>
                <p className="mt-3 text-sm leading-relaxed">
                    DIY is rewarding when it goes right and miserable when it
                    doesn't. Below are the most common reasons our customers
                    book a Handy tradesperson instead of taking on a small job
                    themselves.
                </p>
                <ol className="mt-4 space-y-3 text-sm">
                    <li>
                        <strong className="text-slate-900">Save money.</strong>{" "}
                        A professional finishes the job once, with the right
                        tools, and won't damage what they're installing. No
                        spending £80 on a drill, brackets and rawl plugs you'll
                        only use once.
                    </li>
                    <li>
                        <strong className="text-slate-900">Save time.</strong>{" "}
                        Most of our 30-min and hourly bookings cover what would
                        take a homeowner a Saturday afternoon — and our team
                        cleans up after themselves.
                    </li>
                    <li>
                        <strong className="text-slate-900">
                            Eliminate stress.
                        </strong>{" "}
                        No half-finished jobs sitting on the to-do list for
                        weeks. Book a slot, get a text the morning of the visit,
                        get it done.
                    </li>
                    <li>
                        <strong className="text-slate-900">Minimise risk.</strong>{" "}
                        Drilling into walls, mounting heavy TVs, fitting locks —
                        small jobs that go wrong can be expensive. Every Handy
                        tradesperson is insured and DBS-checked.
                    </li>
                </ol>
            </div>

            <div>
                <h2 className="text-2xl font-bold text-slate-900">
                    What does a handyman cover?
                </h2>
                <p className="mt-3 text-sm leading-relaxed">
                    The Handy team covers small home-repair and installation
                    work. If a job is too large for one visit we'll tell you up
                    front and quote separately.
                </p>
                <ol className="mt-4 space-y-3 text-sm">
                    <li>
                        <strong className="text-slate-900">
                            Drilling and wall-mounting.
                        </strong>{" "}
                        Pictures, mirrors, shelves, brackets, TVs, blinds and
                        curtain poles — fixings included where standard.
                    </li>
                    <li>
                        <strong className="text-slate-900">
                            Flat-pack assembly.
                        </strong>{" "}
                        IKEA, Made.com, Argos, John Lewis — beds, wardrobes,
                        dressers, dining sets and office furniture.
                    </li>
                    <li>
                        <strong className="text-slate-900">
                            Door &amp; lock work.
                        </strong>{" "}
                        Smart locks, deadbolts, latch replacements, door
                        adjustments and weather stripping.
                    </li>
                    <li>
                        <strong className="text-slate-900">
                            Small plumbing fixes.
                        </strong>{" "}
                        Taps, toilet seats, leaky waste traps, isolating valves.
                        Anything notifiable goes to a registered plumber.
                    </li>
                    <li>
                        <strong className="text-slate-900">
                            Touch-ups &amp; finishing.
                        </strong>{" "}
                        Filling, caulking, silicone replacement, door-frame
                        paint touch-ups.
                    </li>
                </ol>
            </div>

            <div>
                <h2 className="text-2xl font-bold text-slate-900">
                    Why book through Handy
                </h2>
                <ol className="mt-3 space-y-3 text-sm">
                    <li>
                        <strong className="text-slate-900">
                            Fixed-price up front.
                        </strong>{" "}
                        You see the price before you book. If extras come up,
                        we'll quote on the spot — never billed after the fact.
                    </li>
                    <li>
                        <strong className="text-slate-900">
                            Vetted tradespeople only.
                        </strong>{" "}
                        Every Handy pro is DBS-checked, insured to £2M, and
                        rated by previous customers. Anyone below 4.6 stars
                        leaves the platform.
                    </li>
                    <li>
                        <strong className="text-slate-900">
                            Backed by a 30-day warranty.
                        </strong>{" "}
                        Not happy with the work? We'll return and put it right,
                        free, within 30 days. No quibbles.
                    </li>
                </ol>
            </div>
        </section>
    );
}

// ---------------------------------------------------------------------------
// Quick links accordion + footer
// ---------------------------------------------------------------------------

const QUICK_LINK_GROUPS = [
    {
        id: "community",
        title: "Join our community",
        links: [
            "Customer forum",
            "Help centre",
            "Cancellation policy",
            "Trust & safety",
        ],
    },
    {
        id: "new",
        title: "Newly launched at-home services",
        links: [
            "Smart-lock installation",
            "Loft hatch installation",
            "Outdoor lighting fitting",
            "Bathroom silicone replacement",
        ],
    },
    {
        id: "categories",
        title: "All categories",
        links: [
            "Handyman",
            "Plumbing",
            "Electrical",
            "Painting & decorating",
            "Carpet cleaning",
            "Locksmith",
            "Pest control",
            "Gardening",
        ],
    },
    {
        id: "serving",
        title: "Serving in",
        links: [
            "Nottingham",
            "West Bridgford",
            "Beeston",
            "Mapperley",
            "Wollaton",
            "Long Eaton",
            "Carlton",
            "Arnold",
            "Derby",
        ],
    },
    {
        id: "other",
        title: "Other services we provide",
        links: [
            "End-of-tenancy cleaning",
            "Deep cleaning",
            "Office cleaning",
            "Window cleaning",
            "Oven cleaning",
        ],
    },
    {
        id: "near-me",
        title: "Services near me",
        links: [
            "Handyman near me",
            "Plumber near me",
            "Electrician near me",
            "Locksmith near me",
            "Cleaner near me",
        ],
    },
];

function QuickLinksAccordion() {
    return (
        <section className="mt-16 border-t border-slate-100 pt-10">
            <h2 className="mb-4 text-2xl font-bold tracking-tight">Quick Links</h2>
            <Accordion type="multiple" className="max-w-3xl">
                {QUICK_LINK_GROUPS.map((g) => (
                    <AccordionItem key={g.id} value={g.id} className="border-b">
                        <AccordionTrigger className="text-base font-semibold">
                            {g.title}
                        </AccordionTrigger>
                        <AccordionContent>
                            <ul className="grid grid-cols-1 gap-2 pt-2 text-sm text-slate-600 sm:grid-cols-2 md:grid-cols-3">
                                {g.links.map((l) => (
                                    <li key={l}>
                                        <a
                                            href="#"
                                            className="hover:text-amber-600 hover:underline"
                                        >
                                            {l}
                                        </a>
                                    </li>
                                ))}
                            </ul>
                        </AccordionContent>
                    </AccordionItem>
                ))}
            </Accordion>
        </section>
    );
}

function PageFooter() {
    return (
        <footer className="mt-16 border-t border-slate-100 bg-slate-800 text-white">
            <div className="mx-auto max-w-7xl px-4 py-12 lg:px-8">
                <div className="mb-8 flex items-center gap-3">
                    <HandLogo className="h-10 w-10" />
                    <span className="text-lg font-bold tracking-tight text-white">
                        Handy Services
                    </span>
                </div>

                <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-4">
                    <FooterColumn
                        heading="Company"
                        links={[
                            "About us",
                            "Investor relations",
                            "Terms & conditions",
                            "Privacy policy",
                            "Anti-discrimination policy",
                            "Careers",
                        ]}
                    />
                    <FooterColumn
                        heading="For customers"
                        links={[
                            "Customer reviews",
                            "Categories near you",
                            "Contact us",
                        ]}
                    />
                    <FooterColumn
                        heading="For tradespeople"
                        links={["Register as a pro"]}
                    />
                    <div>
                        <h3 className="text-sm font-bold text-white">Social</h3>
                        <div className="mt-3 flex gap-3">
                            {[Twitter, Facebook, Instagram, Linkedin].map(
                                (Icon, i) => (
                                    <a
                                        key={i}
                                        href="#"
                                        className="flex h-9 w-9 items-center justify-center rounded-full border border-white/20 bg-white/5 text-white/80 transition hover:border-amber-400 hover:text-amber-400"
                                    >
                                        <Icon className="h-4 w-4" />
                                    </a>
                                ),
                            )}
                        </div>
                        <div className="mt-5 space-y-2">
                            <a
                                href="#"
                                className="block h-12 rounded-md bg-[#1D2D3D] px-3 text-white"
                            >
                                <div className="flex h-full items-center gap-2">
                                    <div className="text-2xl">🍎</div>
                                    <div className="flex flex-col text-left leading-tight">
                                        <span className="text-[10px]">
                                            Download on the
                                        </span>
                                        <span className="text-sm font-semibold">
                                            App Store
                                        </span>
                                    </div>
                                </div>
                            </a>
                            <a
                                href="#"
                                className="block h-12 rounded-md bg-[#1D2D3D] px-3 text-white"
                            >
                                <div className="flex h-full items-center gap-2">
                                    <div className="text-2xl">▶️</div>
                                    <div className="flex flex-col text-left leading-tight">
                                        <span className="text-[10px]">Get it on</span>
                                        <span className="text-sm font-semibold">
                                            Google Play
                                        </span>
                                    </div>
                                </div>
                            </a>
                        </div>
                    </div>
                </div>

                <div className="mt-10 border-t border-white/10 pt-6 text-xs text-white/50">
                    <p>* Prices accurate as of May 2026.</p>
                    <p className="mt-1">
                        © {new Date().getFullYear()} Handy Services Ltd. All
                        rights reserved.
                    </p>
                </div>
            </div>
        </footer>
    );
}

function FooterColumn({
    heading,
    links,
}: {
    heading: string;
    links: string[];
}) {
    return (
        <div>
            <h3 className="text-sm font-bold text-white">{heading}</h3>
            <ul className="mt-3 space-y-2 text-sm text-white/70">
                {links.map((l) => (
                    <li key={l}>
                        <a
                            href="#"
                            className="hover:text-amber-400 hover:underline"
                        >
                            {l}
                        </a>
                    </li>
                ))}
            </ul>
        </div>
    );
}
