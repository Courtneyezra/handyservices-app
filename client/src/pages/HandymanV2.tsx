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

import {
    Fragment,
    useEffect,
    useMemo,
    useRef,
    useState,
    type ReactNode,
} from "react";
import { Link, useLocation } from "wouter";
import type { Icon as PhosphorIcon } from "@phosphor-icons/react";
// Phosphor icons — selected per-SKU for task-specific recognisability.
// Lucide doesn't have icons for taps, toilets, faucets etc. — Phosphor's
// line-style set covers these gaps and matches Lucide's visual weight
// closely enough to mix cleanly within the same set.
import {
    Drop as PhDrop,
    Toilet,
    Shower as PhShower,
    Plug as PhPlug,
    Fan as PhFan,
    LampPendant,
    Lock as PhLock,
    Gear,
    // Wave 2 — carpentry + tile/grout
    Hammer as PhHammer,
    PencilRuler,
} from "@phosphor-icons/react";

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
    // Room-filter icons (added for the new "Browse by room" strip).
    // Bath = bathroom, Sofa = living room, ChefHat = kitchen,
    // Footprints = hallway, Trees = garden, Home = outside / exterior,
    // LayoutGrid = "All rooms".
    Bath,
    Sofa,
    ChefHat,
    Footprints,
    Trees,
    Home,
    LayoutGrid,
    // Wave 1 SKU category icons.
    //   Droplet     = silicone reseal (water-tightness)
    //   Wrench      = plumbing fixes
    //   Lightbulb   = sockets & lights (electrical minor)
    //   DoorClosed  = door fixes (distinct from DoorOpen used for Locks)
    Droplet,
    Wrench,
    Lightbulb,
    DoorClosed,
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
// Service-card thumbnail icons — Phosphor's Duotone weight gives a two-tone
// shaded look (full-strength outline + 20%-opacity fill) that reads as much
// more detailed / designed than Lucide's flat line icons. Used on the 11
// original /v2 services. Wave 1+2 SKUs continue to use Phosphor line + Lucide
// because Duotone doesn't cover those taps/sockets/door icons yet.
import {
    PiFrameCornersDuotone,
    PiSparkleDuotone,
    PiTelevisionDuotone,
    PiTelevisionSimpleDuotone,
    PiBedDuotone,
    PiArmchairDuotone,
    PiDoorOpenDuotone,
    PiKeyDuotone,
    PiWrenchDuotone,
} from "react-icons/pi";
import { LandingHeader } from "@/components/LandingHeader";
import {
    RescueToast,
    WhatsAppEscapeFooter,
} from "@/components/WhatsAppEscape";
import { AnimatedMap } from "@/components/AnimatedMap";
import { HandLogo } from "@/components/LandingShared";

// Brand asset images (real Handy Services photography from existing landing)
import slideShelf from "@assets/c2f4951d-baa5-4a9f-8b4e-233fa5fcb49c_1764687156908.webp";
import skuWallInstall from "@assets/528c52d4-f8ff-4e5b-9853-b68263a62c2f_1764694548068.webp";
import slideAfter from "@assets/cb5e8951-9d46-4023-9909-510a89d3da60_1764693845208.webp";
import slideHero from "@assets/f7550ab2-8282-4cf6-b2af-83496eef2eee_1764599750751.webp";
import slidePayIn3 from "@assets/6e08e13d-d1a3-4a91-a4cc-814b057b341d_1764693900670.webp";
import promoHandyman from "@assets/123d3462-a11d-42b8-9fad-fdb2d6f29b11_1764600237774.webp";
// City-specific local maps (used in the SEO intro block on /v2 vs /v2/derby).
// Kept as legacy fallback imports; AnimatedMap now drives the SEO block.
import nottinghamMap from "@/assets/nottingham_map.png";
import derbyMap from "@/assets/derby_map.png";
import {
    registerSuperProperties as posthogRegister,
    trackEvent as posthogTrack,
} from "@/lib/posthog";
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
    /** When set (and no `thumbImage`), renders an icon centred on the
     *  gradient tile. Accepts either a Lucide icon or a Phosphor icon —
     *  Phosphor is used for SKU-specific domain icons (taps, toilets, etc.)
     *  that Lucide doesn't have. Both render at the same stroke weight
     *  visually so they mix cleanly in the same catalog. */
    thumbIcon?: LucideIcon | PhosphorIcon;
    /** When set (highest priority after image), renders a typographic
     *  two-line tile — e.g. "30 / MINS" — matching the Select-a-service nav.
     *  Used on the hourly/30-min SKUs so the thumbnail mirrors its category
     *  pill. */
    thumbText?: { primary: string; secondary: string };
    /** Hero banner photo shown at the top of the service detail modal,
     *  above the title. Kept separate from `thumbImage` so the card grid can
     *  stay icon-only while the modal still gets a rich brand photo where
     *  one fits. */
    modalImage?: string;
    optionsCount?: number;
    promoLabel?: string;
    /** When present, "Add" opens the detail modal with a tier-picker as the first
     *  section. The user adds a specific tier rather than the base service. */
    tiers?: ServiceTier[];
    /** Optional short description shown in the detail modal under the header. */
    longDescription?: string;
    /** Optional list of `RoomId`s where this service typically applies.
     *  Used by the "Browse by room" filter strip — services with `rooms`
     *  undefined are treated as room-agnostic (always visible). Services
     *  with `rooms` set only render when no room is selected OR the selected
     *  room id is in this list. */
    rooms?: RoomId[];
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

// ---------------------------------------------------------------------------
// Rooms — secondary discovery axis ("Browse by room" strip).
//
// Service-type categories remain the primary nav (matches single-task
// customer language and competitor patterns). The room filter is a
// secondary axis: clicking a room narrows the visible services to those
// tagged with that room. Services without a `rooms` tag are treated as
// room-agnostic (e.g. "30-min handyman", "Drill & hang") and always stay
// visible. Categories with zero visible services hide themselves.
// ---------------------------------------------------------------------------

export type RoomId =
    | "kitchen"
    | "bathroom"
    | "living-room"
    | "bedroom"
    | "hallway"
    | "garden"
    | "outside";

type Room = {
    id: RoomId;
    label: string;
    Icon: typeof Hammer;
};

const ROOMS: Room[] = [
    { id: "kitchen", label: "Kitchen", Icon: ChefHat },
    { id: "bathroom", label: "Bathroom", Icon: Bath },
    { id: "living-room", label: "Living room", Icon: Sofa },
    { id: "bedroom", label: "Bedroom", Icon: Bed },
    { id: "hallway", label: "Hallway", Icon: Footprints },
    { id: "garden", label: "Garden", Icon: Trees },
    { id: "outside", label: "Outside", Icon: Home },
];

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
                modalImage: promoHandyman,
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
                modalImage: promoHandyman,
                optionsCount: 5,
            },
        ],
    },
    // -----------------------------------------------------------------------
    // Wave 1 SKU categories — added based on CONTEXTUAL acceptance analysis:
    //   • Silicone reseal     — 50% historic accept (top converter)
    //   • Plumbing fixes      — 21% accept but biggest sub-£200 bail volume
    //   • Sockets & lights    — 25% accept, ~50 historic line items
    //   • Door fixes          — 41% accept, recurring single-task demand
    // All SKUs priced on the existing EVE+10% scale (£49/hr base, £74/hr
    // anchor). Materials assume customer-supplied unless noted; we bring
    // fittings and consumables. SKU codes here are /v2-internal — when the
    // backend is wired, map each to a productized_services.sku_code:
    //   silicone-bath → BATH-SILICONE-SEAL · tap-repair → PLUMB-TAP-REPAIR
    //   toilet-seat → PLUMB-TOILET-SEAT   · toilet-mechanism → PLUMB-TOILET-REPAIR
    //   shower-head → PLUMB-SHOWER-HEAD   · light-fitting-* → ELEC-LIGHT-REPLACE/MULTI
    //   socket-replace-* → ELEC-SOCKET-REPLACE · extractor-fan → ELEC-EXTRACTOR-FAN
    //   door-handle → DOOR-HANDLE-INT     · door-adjust → DOOR-ADJUST
    //   door-lock-standard → DOOR-LOCK-REPLACE
    // -----------------------------------------------------------------------
    {
        id: "silicone-reseal",
        name: "Silicone reseal",
        Icon: Droplet,
        services: [
            {
                id: "silicone-reseal-svc",
                rooms: ["bathroom", "kitchen"],
                name: "Bath / shower / sink silicone reseal",
                rating: 4.81,
                reviewCount: "880 reviews",
                priceCurrent: 37,
                startsAt: true,
                longDescription:
                    "Old silicone removed, area cleaned and prepped, fresh anti-mould silicone laid for a tight finish. Pick the area you need — bath, shower or kitchen sink — and add multiples if you want them all done in one visit.",
                tiers: [
                    {
                        id: "silicone-sink",
                        name: "Kitchen sink",
                        rating: 4.83,
                        reviewCount: "210 reviews",
                        // EVE+10% (£49/hr × 45/60) with BUSY_PRO anchor.
                        priceCurrent: 37,
                        priceOriginal: 56,
                        durationMinutes: 45,
                    },
                    {
                        id: "silicone-bath",
                        name: "Bath",
                        rating: 4.84,
                        reviewCount: "390 reviews",
                        // EVE+10% (£49/hr × 60/60).
                        priceCurrent: 49,
                        priceOriginal: 74,
                        durationMinutes: 60,
                    },
                    {
                        id: "silicone-shower",
                        name: "Shower enclosure",
                        rating: 4.79,
                        reviewCount: "280 reviews",
                        // EVE+10% (£49/hr × 75/60).
                        priceCurrent: 61,
                        priceOriginal: 93,
                        durationMinutes: 75,
                    },
                ],
                bullets: [
                    "Anti-mould silicone included — bring your own if you prefer a specific brand.",
                    "Existing sealant fully removed and surface cleaned before reapplication.",
                ],
                thumbEmoji: "💧",
                thumbIcon: Droplet,
                thumbBg: "from-sky-100 to-cyan-200",
                modalImage: promoHandyman,
                optionsCount: 3,
            },
        ],
    },
    {
        id: "plumbing-fixes",
        name: "Plumbing fixes",
        Icon: Wrench,
        services: [
            {
                id: "tap-repair",
                rooms: ["bathroom", "kitchen"],
                name: "Leaky tap repair",
                rating: 4.78,
                reviewCount: "1.1K reviews",
                // EVE+10% (£49/hr × 45/60) with BUSY_PRO anchor.
                priceCurrent: 37,
                priceOriginal: 56,
                durationMinutes: 45,
                bullets: [
                    "Washer / O-ring / cartridge replacement, full tap re-seat.",
                    "Like-for-like parts; branded replacements at trade rates with your nod first.",
                    "If no work is carried out after inspection, a visit charge of £25 applies.",
                ],
                thumbEmoji: "🚰",
                thumbIcon: PhDrop,
                thumbBg: "from-blue-100 to-sky-200",
                modalImage: promoHandyman,
            },
            {
                id: "tap-replace",
                rooms: ["bathroom", "kitchen"],
                name: "Tap replacement",
                rating: 4.76,
                reviewCount: "780 reviews",
                priceCurrent: 49,
                startsAt: true,
                longDescription:
                    "Like-for-like swap of a customer-supplied tap, or a fuller mixer-tap upgrade. We isolate the supply, fit the unit, and test for leaks before we leave.",
                tiers: [
                    {
                        id: "tap-replace-likeforlike",
                        name: "Like-for-like (you supply)",
                        rating: 4.78,
                        reviewCount: "510 reviews",
                        priceCurrent: 49,
                        priceOriginal: 74,
                        durationMinutes: 60,
                    },
                    {
                        id: "tap-replace-mixer",
                        name: "Mixer-tap upgrade",
                        rating: 4.74,
                        reviewCount: "270 reviews",
                        priceCurrent: 74,
                        priceOriginal: 111,
                        durationMinutes: 90,
                    },
                ],
                bullets: [
                    "Customer supplies the new tap; we bring fittings and PTFE tape.",
                    "If no work is carried out after inspection, a visit charge of £25 applies.",
                ],
                thumbEmoji: "🚰",
                thumbIcon: Wrench,
                thumbBg: "from-blue-100 to-cyan-200",
                modalImage: promoHandyman,
                optionsCount: 2,
            },
            {
                id: "toilet-seat",
                rooms: ["bathroom"],
                name: "Toilet seat replacement",
                rating: 4.82,
                reviewCount: "640 reviews",
                // EVE+10% (£49/hr × 30/60) — 30-min minimum booking.
                priceCurrent: 25,
                priceOriginal: 37,
                durationMinutes: 30,
                bullets: [
                    "Customer-supplied seat; we'll fit and align.",
                    "Old seat removed and disposed of on request.",
                ],
                thumbEmoji: "🚽",
                thumbIcon: Toilet,
                thumbBg: "from-slate-100 to-slate-200",
                modalImage: promoHandyman,
            },
            {
                id: "toilet-mechanism",
                rooms: ["bathroom"],
                name: "Toilet flush mechanism repair",
                rating: 4.75,
                reviewCount: "440 reviews",
                // EVE+10% (£49/hr × 60/60).
                priceCurrent: 49,
                priceOriginal: 74,
                durationMinutes: 60,
                bullets: [
                    "Fill valve, flush valve or push-button mechanism — diagnosed and replaced.",
                    "Customer-supplied parts; we bring sealing washers and tools.",
                    "If no work is carried out after inspection, a visit charge of £25 applies.",
                ],
                thumbEmoji: "🚽",
                thumbIcon: Gear,
                thumbBg: "from-cyan-100 to-blue-200",
                modalImage: promoHandyman,
            },
            {
                id: "shower-head",
                rooms: ["bathroom"],
                name: "Shower head & hose replacement",
                rating: 4.79,
                reviewCount: "310 reviews",
                // EVE+10% (£49/hr × 30/60).
                priceCurrent: 25,
                priceOriginal: 37,
                durationMinutes: 30,
                bullets: [
                    "Customer-supplied head and hose; we swap and check the seal.",
                    "Limescale build-up cleared from the connector while we're there.",
                ],
                thumbEmoji: "🚿",
                thumbIcon: PhShower,
                thumbBg: "from-sky-100 to-cyan-200",
                modalImage: promoHandyman,
            },
        ],
    },
    {
        id: "sockets-lights",
        name: "Sockets & lights",
        Icon: Lightbulb,
        services: [
            {
                id: "light-fitting",
                // No `rooms` — applies anywhere in the home.
                name: "Light fitting replacement",
                rating: 4.77,
                reviewCount: "920 reviews",
                priceCurrent: 37,
                startsAt: true,
                longDescription:
                    "Like-for-like swap of an existing ceiling or wall light fitting. We isolate the circuit, fit the new unit, and test before we leave. New circuits or consumer-unit work need a qualified electrician — we'll route those to a specialist quote.",
                tiers: [
                    {
                        id: "light-fitting-single",
                        name: "1 fitting",
                        rating: 4.79,
                        reviewCount: "560 reviews",
                        priceCurrent: 37,
                        priceOriginal: 56,
                        durationMinutes: 45,
                    },
                    {
                        id: "light-fitting-multi",
                        name: "2–4 fittings",
                        rating: 4.74,
                        reviewCount: "240 reviews",
                        priceCurrent: 74,
                        priceOriginal: 111,
                        durationMinutes: 90,
                    },
                ],
                bullets: [
                    "Customer supplies the new fitting; we bring connectors and tools.",
                    "Like-for-like swap only — no new circuits or consumer-unit work.",
                    "If no work is carried out after inspection, a visit charge of £25 applies.",
                ],
                thumbEmoji: "💡",
                thumbIcon: Lightbulb,
                thumbBg: "from-amber-100 to-yellow-200",
                modalImage: promoHandyman,
                optionsCount: 2,
            },
            {
                id: "pendant-light",
                name: "Pendant light hang",
                rating: 4.71,
                reviewCount: "180 reviews",
                // EVE+10% (£49/hr × 45/60).
                priceCurrent: 37,
                priceOriginal: 56,
                durationMinutes: 45,
                bullets: [
                    "Customer-supplied pendant; we route the cable, fit the rose plate, and level.",
                    "Like-for-like swap or hang from existing ceiling rose.",
                ],
                thumbEmoji: "💡",
                thumbIcon: LampPendant,
                thumbBg: "from-yellow-100 to-amber-200",
                modalImage: promoHandyman,
            },
            {
                id: "socket-replace",
                name: "Socket / switch faceplate replacement",
                rating: 4.81,
                reviewCount: "650 reviews",
                priceCurrent: 25,
                startsAt: true,
                longDescription:
                    "Damaged or outdated socket / switch face? We isolate the circuit, swap the plate, and test. Like-for-like replacements only — adding sockets or moving them needs a qualified electrician.",
                tiers: [
                    {
                        id: "socket-replace-single",
                        name: "1 socket / switch",
                        rating: 4.83,
                        reviewCount: "390 reviews",
                        priceCurrent: 25,
                        priceOriginal: 37,
                        durationMinutes: 30,
                    },
                    {
                        id: "socket-replace-multi",
                        name: "2–4 sockets / switches",
                        rating: 4.78,
                        reviewCount: "190 reviews",
                        priceCurrent: 49,
                        priceOriginal: 74,
                        durationMinutes: 60,
                    },
                ],
                bullets: [
                    "Like-for-like faceplate replacement only.",
                    "Customer supplies the new socket / switch; we bring backbox connectors.",
                ],
                thumbEmoji: "🔌",
                thumbIcon: PhPlug,
                thumbBg: "from-amber-100 to-orange-200",
                modalImage: promoHandyman,
                optionsCount: 2,
            },
            {
                id: "extractor-fan",
                rooms: ["bathroom", "kitchen"],
                name: "Extractor fan replacement",
                rating: 4.69,
                reviewCount: "210 reviews",
                // EVE+10% (£49/hr × 45/60).
                priceCurrent: 37,
                priceOriginal: 56,
                durationMinutes: 45,
                bullets: [
                    "Customer-supplied like-for-like extractor; we swap the unit and test.",
                    "If no work is carried out after inspection, a visit charge of £25 applies.",
                ],
                thumbEmoji: "🌬️",
                thumbIcon: PhFan,
                thumbBg: "from-cyan-100 to-sky-200",
                modalImage: promoHandyman,
            },
        ],
    },
    {
        id: "door-fixes",
        name: "Door fixes",
        Icon: DoorClosed,
        services: [
            {
                id: "door-handle",
                // No `rooms` — applies to any internal door.
                name: "Internal door handle replacement",
                rating: 4.76,
                reviewCount: "490 reviews",
                // EVE+10% (£49/hr × 30/60).
                priceCurrent: 25,
                priceOriginal: 37,
                durationMinutes: 30,
                bullets: [
                    "Customer-supplied handle; we'll swap and align.",
                    "Loose or stripped screw fixings re-set where possible.",
                ],
                thumbEmoji: "🚪",
                thumbIcon: DoorClosed,
                thumbBg: "from-stone-100 to-stone-200",
                modalImage: promoHandyman,
            },
            {
                id: "door-adjust",
                name: "Door easing / adjustment",
                rating: 4.72,
                reviewCount: "330 reviews",
                // EVE+10% (£49/hr × 45/60).
                priceCurrent: 37,
                priceOriginal: 56,
                durationMinutes: 45,
                bullets: [
                    "Sticking, dragging or rubbing internal doors — planed or shaved to clear; hinges re-set if needed.",
                    "If no work is carried out after inspection, a visit charge of £25 applies.",
                ],
                thumbEmoji: "🚪",
                thumbIcon: DoorOpen,
                thumbBg: "from-amber-100 to-yellow-100",
                modalImage: promoHandyman,
            },
            {
                id: "door-lock-standard",
                rooms: ["hallway", "outside"],
                name: "Standard door lock replacement",
                rating: 4.74,
                reviewCount: "260 reviews",
                // EVE+10% (£49/hr × 75/60).
                priceCurrent: 61,
                priceOriginal: 93,
                durationMinutes: 75,
                bullets: [
                    "Like-for-like cylinder or mortice lock replacement; customer-supplied lock.",
                    "For smart locks, see our dedicated Smart lock install service.",
                ],
                thumbEmoji: "🔑",
                thumbIcon: PhLock,
                thumbBg: "from-zinc-100 to-slate-200",
                modalImage: promoHandyman,
            },
        ],
    },
    // -----------------------------------------------------------------------
    // Wave 2 SKU categories — Carpentry repairs (35% historic accept) and
    // Tile & grout. Same EVE+10% pricing model and customer-supplied
    // materials default as Wave 1. Slots between Wave 1 (highest-converting
    // categories) and the existing service-type categories.
    //   SKU-code mapping (for future backend wiring):
    //     skirting-repair       → CARP-SKIRTING-REPAIR
    //     architrave-repair     → CARP-ARCHITRAVE-REPAIR
    //     drawer-repair         → CARP-DRAWER-REPAIR
    //     floorboard-repair     → CARP-FLOORBOARD-REPAIR
    //     gate-adjustment       → CARP-GATE-ADJUST
    //     fence-panel-repair    → CARP-FENCE-REPAIR
    //     grout-refresh-*       → TILE-GROUT-REFRESH (tiered by sqm)
    //     tile-replace-cracked  → TILE-REPLACE-FEW
    //     splashback-tile       → TILE-SPLASHBACK-SMALL
    // -----------------------------------------------------------------------
    {
        id: "carpentry-repairs",
        name: "Carpentry repairs",
        Icon: Hammer,
        services: [
            {
                id: "skirting-repair",
                // No `rooms` — skirting exists in every room.
                name: "Skirting board repair",
                rating: 4.79,
                reviewCount: "520 reviews",
                priceCurrent: 37,
                priceOriginal: 56,
                durationMinutes: 45,
                bullets: [
                    "Damaged or split skirting — section cut out, replacement piece fitted and primed flush.",
                    "Customer-supplied skirting; we bring fixings, filler and PPA glue.",
                    "If no work is carried out after inspection, a visit charge of £25 applies.",
                ],
                thumbEmoji: "🪵",
                thumbIcon: PhHammer,
                thumbBg: "from-amber-100 to-orange-200",
                modalImage: promoHandyman,
            },
            {
                id: "architrave-repair",
                name: "Door frame / architrave repair",
                rating: 4.74,
                reviewCount: "190 reviews",
                priceCurrent: 37,
                priceOriginal: 56,
                durationMinutes: 45,
                bullets: [
                    "Cracked, split or knocked-out section repaired; piece spliced in if needed.",
                    "Customer-supplied replacement architrave; we bring fixings, filler and primer.",
                    "If no work is carried out after inspection, a visit charge of £25 applies.",
                ],
                thumbEmoji: "🪟",
                thumbIcon: Frame,
                thumbBg: "from-stone-100 to-stone-200",
                modalImage: promoHandyman,
            },
            {
                id: "drawer-repair",
                rooms: ["kitchen", "bedroom"],
                name: "Drawer / cabinet runner repair",
                rating: 4.77,
                reviewCount: "340 reviews",
                // EVE+10% (£49/hr × 35/60) rounded down.
                priceCurrent: 25,
                priceOriginal: 37,
                durationMinutes: 35,
                bullets: [
                    "Sticking or fallen-off drawer — runners realigned or replaced like-for-like.",
                    "Customer-supplied runners if a like-for-like replacement is needed.",
                ],
                thumbEmoji: "🧰",
                thumbIcon: PencilRuler,
                thumbBg: "from-amber-100 to-yellow-200",
                modalImage: promoHandyman,
            },
            {
                id: "floorboard-repair",
                name: "Floorboard repair (up to 5 boards)",
                rating: 4.72,
                reviewCount: "150 reviews",
                priceCurrent: 49,
                priceOriginal: 74,
                durationMinutes: 60,
                bullets: [
                    "Loose, squeaky or split boards — re-fixed, re-nailed or sections cut and replaced.",
                    "Customer-supplied replacement boards if any need full replacement.",
                    "If no work is carried out after inspection, a visit charge of £25 applies.",
                ],
                thumbEmoji: "🪵",
                thumbIcon: Hammer,
                thumbBg: "from-amber-100 to-orange-200",
                modalImage: promoHandyman,
            },
            {
                id: "gate-adjustment",
                rooms: ["garden", "outside"],
                name: "Garden gate adjustment / repair",
                rating: 4.76,
                reviewCount: "220 reviews",
                priceCurrent: 37,
                priceOriginal: 56,
                durationMinutes: 45,
                bullets: [
                    "Dragging, sticking or sagging gate — hinge re-set, frame planed or post re-secured.",
                    "Customer-supplied replacement hardware where needed.",
                ],
                thumbEmoji: "🚪",
                thumbIcon: PhHammer,
                thumbBg: "from-green-100 to-emerald-200",
                modalImage: promoHandyman,
            },
            {
                id: "fence-panel-repair",
                rooms: ["garden", "outside"],
                name: "Fence panel repair (single panel)",
                rating: 4.71,
                reviewCount: "180 reviews",
                priceCurrent: 49,
                priceOriginal: 74,
                durationMinutes: 60,
                bullets: [
                    "Damaged or detached fence panel — re-secured to existing posts or like-for-like replacement.",
                    "Customer-supplied replacement panel where needed; we bring brackets and fixings.",
                    "If no work is carried out after inspection, a visit charge of £25 applies.",
                ],
                thumbEmoji: "🪵",
                thumbIcon: PhHammer,
                thumbBg: "from-emerald-100 to-green-200",
                modalImage: promoHandyman,
            },
        ],
    },
    {
        id: "tile-grout",
        name: "Tile & grout",
        Icon: LayoutGrid,
        services: [
            {
                id: "grout-refresh",
                rooms: ["bathroom", "kitchen"],
                name: "Grout refresh / re-grouting",
                rating: 4.78,
                reviewCount: "410 reviews",
                priceCurrent: 49,
                startsAt: true,
                longDescription:
                    "Old grout removed and a fresh layer laid for a clean, water-tight finish. Pick the area by square metre — we bring anti-mould grout and sealing tools as standard.",
                tiers: [
                    {
                        id: "grout-refresh-1sqm",
                        name: "Up to 1 sqm",
                        rating: 4.80,
                        reviewCount: "230 reviews",
                        // EVE+10% (£49/hr × 60/60).
                        priceCurrent: 49,
                        priceOriginal: 74,
                        durationMinutes: 60,
                    },
                    {
                        id: "grout-refresh-2sqm",
                        name: "Up to 2 sqm",
                        rating: 4.77,
                        reviewCount: "130 reviews",
                        priceCurrent: 74,
                        priceOriginal: 111,
                        durationMinutes: 90,
                    },
                    {
                        id: "grout-refresh-3sqm",
                        name: "Up to 3 sqm",
                        rating: 4.74,
                        reviewCount: "50 reviews",
                        priceCurrent: 98,
                        priceOriginal: 148,
                        durationMinutes: 120,
                    },
                ],
                bullets: [
                    "Anti-mould grout included — bring your own if you prefer a specific brand.",
                    "Old grout fully removed and area cleaned before re-grouting.",
                ],
                thumbEmoji: "🧱",
                thumbIcon: LayoutGrid,
                thumbBg: "from-stone-100 to-slate-200",
                modalImage: promoHandyman,
                optionsCount: 3,
            },
            {
                id: "tile-replace-cracked",
                rooms: ["bathroom", "kitchen"],
                name: "Cracked tile replacement (1-3 tiles)",
                rating: 4.72,
                reviewCount: "180 reviews",
                priceCurrent: 61,
                priceOriginal: 93,
                durationMinutes: 75,
                bullets: [
                    "Up to 3 cracked tiles removed and replaced with customer-supplied matching tiles.",
                    "Surrounding grout cleaned and refreshed where needed.",
                    "If no work is carried out after inspection, a visit charge of £25 applies.",
                ],
                thumbEmoji: "🧱",
                thumbIcon: LayoutGrid,
                thumbBg: "from-stone-100 to-slate-200",
                modalImage: promoHandyman,
            },
            {
                id: "splashback-tile",
                rooms: ["kitchen"],
                name: "Kitchen splashback tile (up to 1 sqm)",
                rating: 4.68,
                reviewCount: "90 reviews",
                priceCurrent: 98,
                priceOriginal: 148,
                durationMinutes: 120,
                bullets: [
                    "Customer-supplied tiles fitted to existing wall surface, sealed and grouted.",
                    "Area up to 1 sqm — bigger jobs need a site visit for an accurate quote.",
                    "If no work is carried out after inspection, a visit charge of £25 applies.",
                ],
                thumbEmoji: "🧱",
                thumbIcon: LayoutGrid,
                thumbBg: "from-stone-100 to-amber-100",
                modalImage: promoHandyman,
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
                // Floor tier (up to 5 holes) anchors the "Starts at" headline.
                // Price + duration are per-tier, so they live on each tier
                // entry below instead of the parent.
                priceCurrent: 20,
                startsAt: true,
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
                thumbIcon: PiWrenchDuotone,
                thumbBg: "from-slate-100 to-slate-200",
                // Drilling-action brand photo (also the mirror-shelf banner).
                // Reuse is fine — different modals are never seen side-by-side.
                modalImage: slideShelf,
                optionsCount: 3,
            },
            {
                id: "mirror-shelf",
                rooms: ["living-room", "bedroom", "hallway"],
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
                thumbIcon: PiFrameCornersDuotone,
                thumbBg: "from-blue-100 to-cyan-200",
                // Brand shelf-install photo (also used as a HeroCarousel slide)
                // — appears as a banner at the top of the detail modal only.
                modalImage: slideShelf,
                optionsCount: 2,
            },
            {
                id: "fairy-lights",
                rooms: ["living-room", "garden", "outside"],
                name: "Fairy lights installation",
                rating: 4.61,
                reviewCount: "65 reviews",
                // Floor tier (indoor run) anchors the "Starts at £25" headline.
                priceCurrent: 25,
                startsAt: true,
                longDescription:
                    "Window frames, mantelpieces, banisters, eaves, garden trees — we route the run, fix it neatly and hide cables where we can. Bring your own lights or we'll supply at trade rates.",
                tiers: [
                    {
                        id: "fairy-lights-indoor",
                        name: "Indoor run (up to 25 m)",
                        rating: 4.65,
                        reviewCount: "44 reviews",
                        // EVE+10% (£49/hr × 30/60) with BUSY_PRO anchor.
                        priceCurrent: 25,
                        priceOriginal: 37,
                        durationMinutes: 30,
                    },
                    {
                        id: "fairy-lights-outdoor",
                        name: "Outdoor run (up to 50 m)",
                        rating: 4.57,
                        reviewCount: "21 reviews",
                        // EVE+10% (£49/hr × 50/60) — longer run, weather-safe fixings.
                        priceCurrent: 41,
                        priceOriginal: 62,
                        durationMinutes: 50,
                    },
                ],
                bullets: [
                    "Up to 50 metres of lights covered — bring your own or we can supply.",
                    "Outdoor-safe fixings used on exterior runs.",
                ],
                thumbEmoji: "✨",
                thumbIcon: PiSparkleDuotone,
                thumbBg: "from-pink-100 to-rose-200",
                modalImage: promoHandyman,
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
                rooms: ["living-room", "bedroom", "kitchen"],
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
                // The drilling-at-window brand photo (skuWallInstall) fits
                // both curtain-rod and blinds-fitting — same action shot.
                modalImage: skuWallInstall,
                optionsCount: 3,
            },
            {
                id: "blinds-fitting",
                rooms: ["living-room", "bedroom", "kitchen", "bathroom"],
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
                // skuWallInstall (528c52d4) literally depicts a tradesperson
                // drilling into a window frame for blinds — perfect match.
                modalImage: skuWallInstall,
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
                rooms: ["living-room", "bedroom"],
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
                thumbIcon: PiTelevisionDuotone,
                thumbBg: "from-indigo-100 to-violet-200",
                // Generic Handy Services brand photo until a TV-specific
                // asset lands in /assets.
                modalImage: promoHandyman,
            },
            {
                id: "tv-uninstall",
                rooms: ["living-room", "bedroom"],
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
                thumbIcon: PiTelevisionSimpleDuotone,
                thumbBg: "from-violet-100 to-purple-200",
                // Generic Handy Services brand photo until a TV-specific
                // asset lands in /assets.
                modalImage: promoHandyman,
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
                rooms: ["bedroom"],
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
                thumbIcon: PiBedDuotone,
                thumbBg: "from-amber-100 to-yellow-200",
                modalImage: promoHandyman,
                optionsCount: 6,
            },
            {
                id: "dining-chair",
                rooms: ["kitchen", "living-room"],
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
                thumbIcon: PiArmchairDuotone,
                thumbBg: "from-stone-100 to-stone-200",
                modalImage: promoHandyman,
                optionsCount: 4,
            },
            {
                id: "wardrobe-assembly",
                rooms: ["bedroom"],
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
                thumbIcon: PiDoorOpenDuotone,
                thumbBg: "from-orange-100 to-amber-200",
                modalImage: promoHandyman,
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
                rooms: ["hallway", "outside"],
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
                thumbIcon: PiKeyDuotone,
                thumbBg: "from-zinc-100 to-zinc-200",
                modalImage: promoHandyman,
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
// City variants — /v2 (Nottingham, default) vs /v2/derby
//
// Drives the swappable hero span, the SEO intro headline + city name + map,
// the footer "Serving in" list, and the PostHog `variant`/`city` super-props
// so funnels can compare Nottingham and Derby treatments apples-to-apples.
// ---------------------------------------------------------------------------

/** Allowed cities (also the keys of CITY_CONTENT). */
export type V2City = "nottingham" | "derby";

/** Funnel-variant key sent to PostHog as a super-property. */
export type V2Variant = "v2-nottingham" | "v2-derby";

export type CityContent = {
    /** Amber span at the end of the hero <h1>: "Handyman <span>{heroSpan}</span>". */
    heroSpan: string;
    /** Imported map asset (legacy static fallback — AnimatedMap drives live). */
    mapImage: string;
    /** Alt text describing the map (mentions the city for a11y + SEO). */
    mapAlt: string;
    /** Used in the SEO intro paragraph: "Our {seoIntroCity} team is vetted…". */
    seoIntroCity: string;
    /** H2 above the SEO intro paragraph. */
    seoIntroHeadline: string;
    /** Pill copy overlaid on the local map. */
    seoMapPill: string;
    /** Areas listed in the footer "Serving in" accordion. */
    seoLocations: string[];
    /** Variant key persisted alongside the booking + sent as a PostHog property. */
    variant: V2Variant;
    /** PostHog `city` property. Used as a register() super-property. */
    city: V2City;
};

export const CITY_CONTENT: Record<V2City, CityContent> = {
    nottingham: {
        heroSpan: "near you",
        mapImage: nottinghamMap,
        mapAlt: "Map of Nottingham showing the Handy Services coverage area",
        seoIntroCity: "Nottingham",
        seoIntroHeadline: "Handyman near you, Nottingham",
        seoMapPill: "Serving Nottingham & surrounding areas",
        // Mirrors the "Serving in" group on /landing.
        seoLocations: [
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
        variant: "v2-nottingham",
        city: "nottingham",
    },
    derby: {
        heroSpan: "in Derby",
        mapImage: derbyMap,
        mapAlt: "Map of Derby showing the Handy Services coverage area",
        seoIntroCity: "Derby",
        seoIntroHeadline: "Handyman in Derby",
        seoMapPill: "Serving Derby & surrounding areas",
        // Common DE-postcode suburbs around Derby + Nottingham kept as a
        // cross-link so SEO juice flows between the two city pages.
        seoLocations: [
            "Derby",
            "Spondon",
            "Mickleover",
            "Littleover",
            "Allestree",
            "Chaddesden",
            "Mackworth",
            "Oakwood",
            "Nottingham",
        ],
        variant: "v2-derby",
        city: "derby",
    },
};

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

/** Where the cart is persisted across navigations to /basket. */
export const CART_STORAGE_KEY = "handy-v2-cart";

interface HandymanV2Props {
    /** Selects the CITY_CONTENT block driving copy + map. Default Nottingham
     *  for backwards compat with the original /v2 route. A `?city=derby` query
     *  param on the URL always overrides the prop (so /v2?city=derby works
     *  for ad-spend split tests without needing a fresh route push). */
    city?: V2City;
}

export default function HandymanV2({ city: cityProp = "nottingham" }: HandymanV2Props = {}) {
    const [, setLocation] = useLocation();
    // Resolve the active city: ?city=derby URL param wins over the prop, so
    // /v2?city=derby flips to the Derby variant without a route push. Anything
    // else falls back to the prop.
    const city: V2City = useMemo(() => {
        if (typeof window !== "undefined") {
            const param = new URLSearchParams(window.location.search).get("city");
            if (param === "derby" || param === "nottingham") return param;
        }
        return cityProp;
    }, [cityProp]);
    const content = CITY_CONTENT[city];

    // Register variant + city as PostHog super-properties so every subsequent
    // capture on this page automatically carries them. Also fires the
    // `landing_view` event once on mount. Re-runs when the city changes so a
    // ?city= flip stays in sync.
    useEffect(() => {
        posthogRegister({ variant: content.variant, city: content.city });
        posthogTrack("landing_view", {
            variant: content.variant,
            city: content.city,
        });
    }, [content.variant, content.city]);

    // Stamp the variant onto the in-progress booking record as soon as the
    // user lands on /v2 (or /v2/derby). Stored alongside the other booking
    // fields under `handy-v2-booking` so the variant rides along with the
    // booking POST and downstream analytics can attribute conversions.
    useEffect(() => {
        if (typeof window === "undefined") return;
        try {
            const raw = window.localStorage.getItem("handy-v2-booking");
            const prev = raw ? JSON.parse(raw) : {};
            window.localStorage.setItem(
                "handy-v2-booking",
                JSON.stringify({
                    ...prev,
                    variant: content.variant,
                    city: content.city,
                }),
            );
        } catch {
            // Storage unavailable — non-fatal, just skip the stamp.
        }
    }, [content.variant, content.city]);

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
    // Optional room filter ("" = All rooms). When set, hides any service whose
    // `rooms` list does NOT include this id; services without `rooms` (room-
    // agnostic, like 30-min handyman / hourly) always remain visible.
    const [selectedRoom, setSelectedRoom] = useState<RoomId | "">("");
    // Which service's detail modal (if any) is open. The modal mirrors the
    // source's pattern of forcing users through a details view before adding
    // to cart (more info, more upsell, fewer mis-clicks).
    const [openServiceId, setOpenServiceId] = useState<string | null>(null);

    // Increments each time addToCart fires — used as a `key` on the cart
    // total span and the bar wrapper so each one remounts and replays its
    // one-shot animation (cart-bump on the total, cart-add-pulse on the
    // bar). Provides clear feedback that the item landed in the basket.
    const [bumpTick, setBumpTick] = useState(0);
    // Tracks the most recently added service id so its ADD button can
    // render the rotating success ring overlay. Cleared after the 900ms
    // ring animation finishes so the ring doesn't linger.
    const [justAddedId, setJustAddedId] = useState<string | null>(null);

    // ---- Bounce-signal rescue toast ----
    // Surfaces a small WhatsApp escape pill above the Menu trigger when the
    // user shows uncertainty (28s dwell with no ADD, OR 2+ service modals
    // closed without an ADD). Decisive buyers never see it — they ADD long
    // before either threshold trips. Dismissible per-session via the X.
    const [showRescue, setShowRescue] = useState(false);
    const cartSizeAtModalOpenRef = useRef<number>(0);
    const modalCloseWithoutAddRef = useRef<number>(0);
    const totalCartCount = Object.values(cart).reduce((a, b) => a + b, 0);

    // Read the per-session dismiss flag once. If the user already dismissed
    // the toast earlier in this session, don't show it again.
    const rescueDismissed = useRef<boolean>(
        typeof window !== "undefined" &&
            window.sessionStorage.getItem("handy-v2-rescue-dismissed") === "1",
    );

    const dismissRescue = () => {
        setShowRescue(false);
        rescueDismissed.current = true;
        try {
            window.sessionStorage.setItem("handy-v2-rescue-dismissed", "1");
        } catch {
            // private mode quota — ignore, dismiss still works for this view
        }
    };

    // Trigger #1 — 28-second dwell on /v2 with zero ADDs yet. The decisive-
    // buyer ADD time we want to protect is well under 30s; bouncers cross
    // this threshold without committing.
    useEffect(() => {
        if (rescueDismissed.current) return;
        const t = window.setTimeout(() => {
            if (totalCartCount === 0 && !rescueDismissed.current) {
                setShowRescue(true);
            }
        }, 28_000);
        return () => window.clearTimeout(t);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // As soon as something lands in the basket, the rescue is moot — hide.
    useEffect(() => {
        if (totalCartCount > 0) setShowRescue(false);
    }, [totalCartCount]);

    // Trigger #2 — service detail modal closed twice without adding. Each
    // openServiceId transition is observed below; we snapshot the cart size
    // when the modal opens and compare it on close. A `prev` ref distinguishes
    // a real close (string → null) from the initial mount (null → null) so
    // we don't count the first render as a fake close.
    const prevOpenServiceIdRef = useRef<string | null>(null);
    useEffect(() => {
        const prev = prevOpenServiceIdRef.current;
        prevOpenServiceIdRef.current = openServiceId;

        if (openServiceId !== null) {
            // Modal just opened — snapshot the basket size at this moment.
            cartSizeAtModalOpenRef.current = totalCartCount;
            return;
        }

        // openServiceId is null. Only treat this as a "close" if the previous
        // value was a service id (i.e. we transitioned from open → closed).
        // Otherwise this is just the initial render or an already-closed
        // state — neither counts.
        if (prev === null) return;

        // Cart didn't grow during the modal's lifetime → no-add close.
        if (
            cartSizeAtModalOpenRef.current === totalCartCount &&
            !rescueDismissed.current
        ) {
            modalCloseWithoutAddRef.current += 1;
            if (modalCloseWithoutAddRef.current >= 2) {
                setShowRescue(true);
            }
        } else {
            // Cart grew during the modal — successful add, reset the streak.
            modalCloseWithoutAddRef.current = 0;
        }
        // We deliberately don't add totalCartCount as a dep — we read its
        // latest value via the ref-snapshot pattern above and the openServiceId
        // transition is the trigger.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [openServiceId]);

    const addToCart = (id: string) => {
        setCart((c) => ({ ...c, [id]: (c[id] || 0) + 1 }));
        setBumpTick((t) => t + 1);
        setJustAddedId(id);
        // Match the success-ring animation duration (900ms) + a small buffer
        // so the ring fully fades before we unmount the overlay.
        window.setTimeout(() => {
            setJustAddedId((prev) => (prev === id ? null : prev));
        }, 950);

        // Analytics — fire `v2_add_to_cart` with the looked-up service. The
        // variant + city are already registered as super-properties at the
        // page level, but we pass them explicitly too so the event is
        // self-describing in PostHog's inspector.
        const svc = ALL_SERVICES.find((s) => s.id === id);
        if (svc) {
            posthogTrack("v2_add_to_cart", {
                variant: content.variant,
                city: content.city,
                service_id: svc.id,
                service_name: svc.name,
                price: svc.priceCurrent,
            });
        }
    };

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

    // Apply the room filter. A service is visible if either:
    //   (a) no room is selected, OR
    //   (b) the service has no `rooms` tag (room-agnostic), OR
    //   (c) the selected room is included in the service's `rooms`.
    // Categories that end up with zero matching services are hidden so the
    // page doesn't render empty headers.
    const filteredCategories = useMemo(() => {
        if (!selectedRoom) return CATEGORIES;
        return CATEGORIES.map((c) => ({
            ...c,
            services: c.services.filter(
                (s) => !s.rooms || s.rooms.includes(selectedRoom),
            ),
        })).filter((c) => c.services.length > 0);
    }, [selectedRoom]);

    const cartTotal = cartItems.reduce(
        (sum, item) => sum + item.priceCurrent * item.qty,
        0,
    );
    const cartOriginalTotal = cartItems.reduce(
        (sum, item) => sum + (item.priceOriginal || item.priceCurrent) * item.qty,
        0,
    );

    return (
        <div className="min-h-screen bg-slate-50 font-sans text-slate-900">
            <LandingHeader />

            <main className="mx-auto max-w-7xl px-4 pb-12 pt-8 lg:px-8">
                {/*
                  * Unified grid:
                  *   row 1: hero/title (left col) | carousel banner (spans col 2-3)
                  *   row 2: Browse-by-room filter strip (spans col 1-3)
                  *   row 3: categories nav (left col, sticky) | services (col 2) | cart (col 3, sticky)
                  *
                  * The room filter strip lives inside the grid as a full-width
                  * row between the hero/carousel marketing area and the
                  * shopping-grid area. Sits below the H1 so the brand
                  * messaging reads first; remains the secondary discovery
                  * axis to the primary service-type category nav.
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
                        <Hero heroSpan={content.heroSpan} />
                    </div>

                    {/* Mobile DOM order #3 → Room filter strip (sits between hero
                      * and services on both viewports). Desktop: full-width row 2
                      * spanning all 3 columns — visually separates the marketing
                      * row 1 from the shopping rows below.
                      *
                      * Negative `-my-6` (24px each side) fully absorbs the
                      * surrounding grid `gap-6` (24px) so the strip sits
                      * flush against the hero/carousel above and the
                      * services below — no visible "margin" framing the
                      * card in the natural flow. The strip's stuck position
                      * (top-[64px] mobile / lg:top-[72px] desktop) is
                      * unaffected because sticky positioning measures from
                      * the viewport, not the grid track.
                      *
                      * Sticky on every viewport: pins flush against the bottom
                      * edge of the LandingHeader. The header is 64px on
                      * mobile and 72px on desktop. `z-20` keeps the strip
                      * above scrolling service cards but below modals (z-65),
                      * the mobile cart bar (z-30) and the LandingHeader (z-50). */}
                    <div className="sticky top-[64px] z-20 -my-6 lg:top-[72px] lg:col-span-3 lg:col-start-1 lg:row-start-2">
                        {/* Full-bleed inner wrapper — escapes main's
                          * `max-w-7xl px-4 lg:px-8` constraint so the
                          * strip spans the entire viewport width on every
                          * size. `left-1/2 -translate-x-1/2 w-screen` is
                          * the canonical "full-bleed within constrained
                          * container" pattern: position the centre at the
                          * parent's centre, then translate so the element's
                          * own centre matches viewport centre, then take
                          * 100vw. Works for any viewport, including >1280px
                          * where main is auto-centred. */}
                        <div className="relative left-1/2 w-screen -translate-x-1/2">
                            <RoomFilterStrip
                                selected={selectedRoom}
                                onSelect={setSelectedRoom}
                            />
                        </div>
                    </div>

                    {/* Mobile DOM order #4 → Promo chips + Category nav (sticky on desktop).
                      * Desktop: col 1 row 3 (left column below the room filter). */}
                    <aside className="space-y-4 lg:col-start-1 lg:row-start-3">
                        {/* Mobile-only: horizontally-scrolling promo offer chips */}
                        <MobilePromoChips />
                        {/* Visual category grid — shown on both mobile and desktop.
                          * Sticky on desktop at top-44 (176px) so it pins just
                          * below the room filter strip (which sits flush
                          * against the 72px header + ~100px strip height =
                          * 172px). 4px breathing gap. */}
                        <div className="lg:sticky lg:top-44">
                            <CategoryNav
                                active={activeCategory}
                                onSelect={setActiveCategory}
                                categories={filteredCategories}
                            />
                        </div>
                    </aside>

                    {/* Row 3, col 2 — Service grid */}
                    {/* `space-y-6` provides the only inter-category gap — each
                      * CategoryBlock is now a discrete white card, so the
                      * heavy `border-t-[6px]` dividers that lived inside
                      * each block are no longer needed. */}
                    <section className="min-w-0 space-y-6 lg:col-start-2 lg:row-start-3">
                        {filteredCategories.map((cat, idx) => {
                            const isTimeBased =
                                cat.id === "quick-fix" || cat.id === "hourly";
                            const prevCat = filteredCategories[idx - 1];
                            const prevIsTimeBased =
                                prevCat?.id === "quick-fix" ||
                                prevCat?.id === "hourly";
                            // Show "Flexible booking" eyebrow above the first
                            // time-based category in the visible (filtered)
                            // set. Show "Browse by service" eyebrow on the
                            // first non-time-based category that follows.
                            const showFlexibleHeading =
                                isTimeBased && (idx === 0 || !prevIsTimeBased);
                            const showServiceHeading =
                                !isTimeBased && idx > 0 && prevIsTimeBased;
                            return (
                                <Fragment key={cat.id}>
                                    {showFlexibleHeading && (
                                        <GroupHeading
                                            label="Flexible booking"
                                            tint="amber"
                                        />
                                    )}
                                    {showServiceHeading && (
                                        <GroupHeading
                                            label="Browse by service"
                                            tint="slate"
                                        />
                                    )}
                                    <CategoryBlock
                                        category={cat}
                                        index={idx}
                                        cart={cart}
                                        onAdd={addToCart}
                                        onDecrement={decrementFromCart}
                                        onOpenDetails={setOpenServiceId}
                                        justAddedId={justAddedId}
                                    />
                                </Fragment>
                            );
                        })}

                        {/* Below-catalog escape hatch — quiet footer link
                          * placed after every category. Users who reached
                          * the bottom without adding anything are the right
                          * audience for WhatsApp; decisive users have
                          * already clicked ADD by now. */}
                        <WhatsAppEscapeFooter />
                    </section>

                    {/* Row 3, col 3 — Sticky cart + offers + promise (desktop only).
                      * Pins at top-44 to clear the room filter strip above. */}
                    <aside className="hidden lg:col-start-3 lg:row-start-3 lg:block">
                        <div className="sticky top-44 space-y-4">
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

                <SeoIntroBlock content={content} />
                <ReviewsGrid />
                <LongFormSeoSection />
                <QuickLinksAccordion seoLocations={content.seoLocations} />
            </main>

            <PageFooter />

            {/* Mobile-only floating quick-jump menu */}
            <MobileQuickMenu
                onSelect={setActiveCategory}
                cartHasItems={cartItems.length > 0}
                categories={filteredCategories}
            />

            {/* Dynamic WhatsApp rescue — triggered by bounce signals
              * (28s dwell w/ no ADD, OR 2 modal closes w/o ADD). Sits above
              * the Menu pill so both rescue paths (jump-to-category vs
              * talk-to-human) co-exist; decisive buyers never see it. */}
            <RescueToast
                visible={showRescue}
                cartHasItems={cartItems.length > 0}
                onDismiss={dismissRescue}
            />

            {/* Mobile sticky cart bar — always mounted; the outer wrapper
              * slides up/down on `cartItems.length > 0` (first-item entrance
              * + last-item exit), and an inner div remounts on every add via
              * `key={bumpTick}` to replay the `cart-add-pulse` animation so
              * subsequent adds get the same clear "added!" feedback even
              * though the bar is already visible. */}
            <div
                aria-hidden={cartItems.length === 0}
                className={`fixed bottom-0 left-0 right-0 z-30 border-t border-slate-200 bg-white px-4 py-3 shadow-lg transition-transform duration-300 ease-out lg:hidden ${
                    cartItems.length > 0
                        ? "translate-y-0"
                        : "pointer-events-none translate-y-full"
                }`}
            >
                <div
                    key={bumpTick}
                    className="flex items-center justify-between animate-cart-add-pulse origin-bottom"
                >
                    <div>
                        <div className="text-xs text-slate-500">
                            {cartItems.length} item{cartItems.length === 1 ? "" : "s"}
                        </div>
                        {/* Cart total also gets its own bump (slightly bigger
                          * scale) on top of the bar-wide pulse — emphasises
                          * the value that just changed. */}
                        <div className="font-semibold">
                            <span
                                key={bumpTick}
                                className="inline-block animate-cart-bump origin-left"
                            >
                                £{cartTotal}
                            </span>
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
            {/* Fixed heights instead of `h-full min-h-[...]` — the old approach
              * let the slide grow to fill its grid cell which made it ~600px
              * on mobile (eating the entire above-the-fold viewport).
              * 300px mobile / 380px desktop accommodates the tallest slide
              * ("Workmanship guarantee on every job" wraps to 4 lines on
              * narrow screens) while still keeping the carousel compact
              * enough that Hero, room filter and first service category
              * remain above the fold. */}
            <div
                className={`relative h-[300px] overflow-hidden rounded-2xl ${slide.bgClass} ${slide.textColor} transition-all duration-500 lg:h-[380px]`}
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

function Hero({ heroSpan }: { heroSpan: string }) {
    // Warranty accordion — was a `<Link href="/warranty">` that navigated
    // away. Customers shouldn't have to leave the booking flow to read
    // a 4-bullet trust signal. Inline disclosure keeps them on /v2 with
    // the cart and category nav still visible.
    const [warrantyOpen, setWarrantyOpen] = useState(false);
    const panelId = "hero-warranty-panel";
    return (
        <section className="flex flex-col gap-4">
            <h1 className="text-3xl font-bold tracking-tight text-slate-900 md:text-5xl">
                Handyman <span className="whitespace-nowrap text-amber-500">{heroSpan}</span>
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

            <div className="mt-2 max-w-md overflow-hidden rounded-xl bg-slate-50">
                <button
                    type="button"
                    onClick={() => setWarrantyOpen((v) => !v)}
                    aria-expanded={warrantyOpen}
                    aria-controls={panelId}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-slate-100"
                >
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-400">
                        <Check className="h-4 w-4 text-slate-900" />
                    </span>
                    <span className="flex-1 text-sm font-medium">
                        How our 30-day workmanship guarantee works
                    </span>
                    <ChevronRight
                        className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${
                            warrantyOpen ? "rotate-90" : ""
                        }`}
                    />
                </button>

                {warrantyOpen && (
                    <div
                        id={panelId}
                        className="border-t border-slate-200 px-4 pb-4 pt-3 text-sm leading-relaxed text-slate-700"
                    >
                        <p>
                            Within 30 days of any visit, if anything we did isn't
                            right, we'll come back and fix it — free, no quibbles.
                        </p>
                        <dl className="mt-3 space-y-2.5">
                            <div>
                                <dt className="text-xs font-bold uppercase tracking-wider text-emerald-700">
                                    Covered
                                </dt>
                                <dd className="mt-1 text-slate-700">
                                    Defective workmanship on anything we
                                    installed, repaired or fitted. If it fails
                                    because of how we did the job, it's on us.
                                </dd>
                            </div>
                            <div>
                                <dt className="text-xs font-bold uppercase tracking-wider text-slate-500">
                                    Not covered
                                </dt>
                                <dd className="mt-1 text-slate-700">
                                    Faulty parts you supplied, accidental
                                    damage, weather, or wear over time. Work
                                    outside the original scope.
                                </dd>
                            </div>
                            <div>
                                <dt className="text-xs font-bold uppercase tracking-wider text-amber-700">
                                    How to claim
                                </dt>
                                <dd className="mt-1 text-slate-700">
                                    WhatsApp us within 30 days with a quick
                                    photo and your booking reference. We'll
                                    arrange a free re-visit — usually within
                                    48 hours.
                                </dd>
                            </div>
                        </dl>
                    </div>
                )}
            </div>
        </section>
    );
}

// ---------------------------------------------------------------------------
// "Browse by room" filter strip — secondary discovery axis above the grid.
//
// Single horizontal pill row, full-width. Pills scroll horizontally on
// narrow viewports. Selecting a pill toggles the room filter; the "All"
// pill clears it. Selected pill picks up the brand amber treatment used
// elsewhere on the page (CategoryNav, CategoryChips, promo pills) so the
// strip feels native rather than bolted on.
// ---------------------------------------------------------------------------

function RoomFilterStrip({
    selected,
    onSelect,
}: {
    selected: RoomId | "";
    onSelect: (id: RoomId | "") => void;
}) {
    return (
        <section
            aria-label="Browse by room"
            // Full-bleed (viewport-width) strip — no rounded corners or side
            // borders since the strip touches the viewport edges. `border-y`
            // gives a thin top/bottom separator; `shadow-sm` keeps a hint of
            // elevation that distinguishes it from the page bg when stuck.
            className="border-y border-slate-200 bg-white p-3 shadow-sm lg:p-4"
        >
            <div className="mb-2 flex items-center justify-between px-1">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Browse by room
                </span>
                {selected && (
                    <button
                        type="button"
                        onClick={() => onSelect("")}
                        className="text-xs font-medium text-slate-500 hover:text-slate-900"
                    >
                        Clear
                    </button>
                )}
            </div>
            {/* Relative wrapper so the right-edge fade gradient can sit
              * absolutely over the pill row. The fade is a visual cue that
              * the row is scrollable horizontally — combined with the
              * partial-pill peek (no horizontal padding on the inner
              * scroll container, so the next pill is cut wherever the
              * viewport ends), customers see immediately that more rooms
              * exist beyond the visible ones. */}
            <div className="relative">
                <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 pr-12">
                    {/* "All rooms" pill — clears the filter */}
                    <RoomPill
                        Icon={LayoutGrid}
                        label="All rooms"
                        active={selected === ""}
                        onClick={() => onSelect("")}
                    />
                    {ROOMS.map((room) => (
                        <RoomPill
                            key={room.id}
                            Icon={room.Icon}
                            label={room.label}
                            active={selected === room.id}
                            onClick={() => onSelect(room.id)}
                        />
                    ))}
                </div>
                {/* Right-edge fade-out gradient — `pointer-events-none` so
                  * it doesn't block clicks on the pill underneath. Width
                  * 12 (48px) gives a clear "fade to white" signal without
                  * obscuring too much of the partially-visible pill. */}
                <div className="pointer-events-none absolute inset-y-0 right-0 w-12 bg-gradient-to-l from-white to-transparent" />
            </div>
        </section>
    );
}

function RoomPill({
    Icon,
    label,
    active,
    onClick,
}: {
    Icon: typeof Hammer;
    label: string;
    active: boolean;
    onClick: () => void;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            aria-pressed={active}
            className={`flex shrink-0 items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition ${
                active
                    ? "border-amber-400 bg-amber-400/15 text-slate-900 shadow-sm"
                    : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50"
            }`}
        >
            <Icon className={`h-4 w-4 ${active ? "text-amber-700" : "text-slate-500"}`} />
            <span>{label}</span>
        </button>
    );
}

// ---------------------------------------------------------------------------
// Left-column category nav (desktop)
// ---------------------------------------------------------------------------

function CategoryNav({
    active,
    onSelect,
    categories,
}: {
    active: string;
    onSelect: (id: string) => void;
    /** Categories to render — passed in (rather than reading the global
     *  `CATEGORIES`) so the nav can mirror the active room filter and never
     *  list a category that has been hidden from the service grid. */
    categories: Category[];
}) {
    // Collapse to first 9 tiles (3-col × 3-row grid) by default so the nav
    // doesn't tower over the sticky strip. "See more" reveals the rest;
    // hidden when the current room filter already produces ≤ 9 categories.
    const MAX_COLLAPSED = 9;
    const [expanded, setExpanded] = useState(false);
    const showToggle = categories.length > MAX_COLLAPSED;
    const visible = expanded || !showToggle
        ? categories
        : categories.slice(0, MAX_COLLAPSED);

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
                {visible.map((cat) => {
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

            {/* "See more" / "Show less" toggle — only rendered when the
              * (possibly room-filtered) list exceeds the 9-tile cap. Keeps
              * the nav compact by default while letting power users open
              * the full set in one tap. */}
            {showToggle && (
                <button
                    type="button"
                    onClick={() => setExpanded((v) => !v)}
                    className="mt-2 flex w-full items-center justify-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                    aria-expanded={expanded}
                >
                    {expanded ? (
                        <>
                            <ChevronDown className="h-3.5 w-3.5 rotate-180" />
                            Show less
                        </>
                    ) : (
                        <>
                            <ChevronDown className="h-3.5 w-3.5" />
                            See more
                        </>
                    )}
                </button>
            )}
        </div>
    );
}

function CategoryChips({
    active,
    onSelect,
    categories,
}: {
    active: string;
    onSelect: (id: string) => void;
    /** Mirror of the same prop on CategoryNav — keeps chips in sync with
     *  the room-filtered service grid. */
    categories: Category[];
}) {
    return (
        <div className="-mx-4 overflow-x-auto px-4 pb-2">
            <div className="flex gap-2">
                {categories.map((cat) => {
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
    categories,
}: {
    onSelect: (id: string) => void;
    cartHasItems: boolean;
    /** The currently-visible category list (post room-filter). Without this
     *  the floating menu would still show every category — clicking a
     *  filtered-out tile would jump to a section that isn't in the DOM. */
    categories: Category[];
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
                                {categories.map((cat) => (
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
        id: "visit-fee",
        Icon: Percent,
        title: "Visit fee waived",
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

// Small group eyebrow rendered above the first card of each group in the
// service grid (e.g. "FLEXIBLE BOOKING" before the time-based time-block
// cards, "BROWSE BY SERVICE" before the task-specific category cards).
// Tint matches the underlying card colour so the eyebrow visually belongs
// to its group rather than floating between groups.
function GroupHeading({
    label,
    tint,
}: {
    label: string;
    tint: "amber" | "slate";
}) {
    const tintClasses =
        tint === "amber" ? "text-amber-700" : "text-slate-500";
    return (
        <div
            className={`flex items-center gap-2 px-1 pt-2 text-xs font-semibold uppercase tracking-wider ${tintClasses}`}
        >
            <span>{label}</span>
            <div className="h-px flex-1 bg-current opacity-20" />
        </div>
    );
}

function CategoryBlock({
    category,
    index,
    cart,
    onAdd,
    onDecrement,
    onOpenDetails,
    justAddedId,
}: {
    category: Category;
    index: number;
    cart: Record<string, number>;
    onAdd: (id: string) => void;
    onDecrement: (id: string) => void;
    onOpenDetails: (id: string) => void;
    /** Service id that was most recently added — surfaces the success-ring
     *  overlay on the matching card's ADD button. */
    justAddedId: string | null;
}) {
    // `index` is no longer needed for separator styling — each category is
    // its own white surface against the slate-50 page background, so the
    // section's `space-y-6` provides the only inter-block spacing.
    void index;
    // Time-based categories (30-min handyman, Hourly handyman) get a warm
    // amber tint to distinguish them from task-specific categories. Their
    // mental model is "I have multiple things / don't know exactly what"
    // vs the task-based "I have a specific problem". Same visual hierarchy,
    // different surface colour — preserves prominence without fragmenting
    // the page architecture.
    const isTimeBased = category.id === "quick-fix" || category.id === "hourly";
    return (
        <div
            id={`cat-${category.id}`}
            // Each category renders as a discrete card on the slate-50 page
            // bg. Time-based categories get amber-50 + amber-200 border;
            // task-based categories stay white + slate-200. Rounded corners
            // + subtle shadow on both keeps the visual structure consistent
            // even with the colour difference. `scroll-mt-48` (192px)
            // clears the sticky chrome (header + room filter strip).
            className={`scroll-mt-48 rounded-2xl border p-5 shadow-sm lg:p-6 ${
                isTimeBased
                    ? "border-amber-200 bg-amber-50"
                    : "border-slate-200 bg-white"
            }`}
        >
            {/* Section heading — the "N options" count badge was removed at
              * the user's request; it added visual noise without giving the
              * customer information they can't see from the list of cards
              * below. Heading is now plain text, no wrapper needed. */}
            <h2 className="mb-5 text-2xl font-bold">{category.name}</h2>

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
                        showSuccessRing={justAddedId === svc.id}
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
    parentIcon,
    parentText,
    parentBg,
}: {
    tiers: ServiceTier[];
    cart: Record<string, number>;
    onAdd: (id: string) => void;
    onDecrement: (id: string) => void;
    /** Icon/text/gradient passed down from the parent service so each tier
     *  card carries the same visual cue as the card on the grid. Both icon
     *  and text are optional; either renders, fallback is a plain tile. */
    parentIcon?: LucideIcon | PhosphorIcon;
    parentText?: { primary: string; secondary: string };
    parentBg?: string;
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
                        // JSX requires component variables to start with an
                        // uppercase letter — otherwise `<parentIcon>` is
                        // parsed as an HTML tag, not a React component.
                        const ParentIcon = parentIcon;
                        return (
                            <div
                                key={tier.id}
                                className="flex w-44 shrink-0 snap-start flex-col gap-2 rounded-xl border border-slate-200 bg-white p-3 shadow-sm"
                            >
                                {/* Icon / typographic tile mirrors the parent
                                  * service's card thumbnail so each tier card
                                  * inherits its visual identity. */}
                                {(ParentIcon || parentText) && (
                                    <div
                                        className={`flex h-14 w-14 items-center justify-center rounded-lg bg-gradient-to-br ${
                                            parentBg ??
                                            "from-slate-100 to-slate-200"
                                        }`}
                                    >
                                        {parentText ? (
                                            <div className="flex flex-col items-center leading-none text-slate-900">
                                                <span className="text-lg font-extrabold tracking-tight">
                                                    {parentText.primary}
                                                </span>
                                                <span className="mt-0.5 text-[8px] font-bold tracking-wider">
                                                    {parentText.secondary}
                                                </span>
                                            </div>
                                        ) : ParentIcon ? (
                                            <ParentIcon
                                                className="h-6 w-6 text-slate-900"
                                                strokeWidth={1.75}
                                                aria-hidden
                                            />
                                        ) : null}
                                    </div>
                                )}
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

// Service-specific bullets. These used to render on the service card itself,
// but they were too long for the card layout (customer-supplied disclaimers,
// visit-charge fine print, etc.). The card now shows only the FIRST bullet
// as a one-liner; this section in the modal surfaces the full list so the
// customer can read it on demand via "View details".
function BulletsSection({ bullets }: { bullets: string[] }) {
    if (!bullets.length) return null;
    return (
        <section className="mb-8">
            <h3 className="mb-3 text-lg font-bold text-slate-900">
                Service details
            </h3>
            <ul className="space-y-2.5">
                {bullets.map((b, i) => (
                    <li key={i} className="flex items-start gap-2.5">
                        <span className="mt-2 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400" />
                        <span className="text-sm leading-relaxed text-slate-700">
                            {b}
                        </span>
                    </li>
                ))}
            </ul>
        </section>
    );
}

function HandyPromiseSection() {
    // Compact two-up "promise" pills. Subtitles were dropped — the titles
    // themselves carry the full meaning ("30-day workmanship guarantee" /
    // "Free 7-day callback"), and the modal already has a lot of content
    // below (Overview, What's included, What's not included).
    const items = [
        { Icon: ShieldCheck, title: "30-day workmanship guarantee" },
        { Icon: Sparkles, title: "Free 7-day callback" },
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
                        className="flex items-center gap-3 rounded-xl border border-slate-100 bg-slate-50 p-3"
                    >
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white text-amber-500 shadow-sm">
                            <i.Icon className="h-5 w-5" />
                        </div>
                        <p className="text-sm font-semibold leading-tight text-slate-900">
                            {i.title}
                        </p>
                    </div>
                ))}
            </div>
        </section>
    );
}

function OverviewSection() {
    // Same compaction pattern as HandyPromiseSection — labels carry the
    // meaning; descriptive subs were buying more height than they earned
    // in the already-crowded service detail modal.
    const items = [
        { Icon: ShieldCheck, label: "DBS-checked team" },
        { Icon: Sparkles, label: "£2M public liability" },
        { Icon: Calendar, label: "Same-week service" },
    ];
    return (
        <section className="mb-8">
            <h3 className="mb-3 text-lg font-bold text-slate-900">Overview</h3>
            <div className="grid grid-cols-3 gap-3">
                {items.map((i) => (
                    <div
                        key={i.label}
                        className="flex flex-col items-center justify-center gap-2 rounded-xl border border-slate-100 bg-slate-50 p-3 text-center"
                    >
                        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-amber-400/20">
                            <i.Icon className="h-4 w-4 text-slate-900" />
                        </div>
                        <p className="text-xs font-semibold leading-tight text-slate-900">
                            {i.label}
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
                {/* Optional hero banner — only services with a relevant
                  * brand photo get this. Sits flush with the top of the
                  * modal (no top padding) so the image visually anchors
                  * the rounded-top edge. When present, the mobile drag
                  * handle overlays the image rather than pushing it down;
                  * when absent, the drag handle falls back to its standard
                  * position below. `shrink-0` keeps the banner from being
                  * compressed when the body content is tall. */}
                {service.modalImage ? (
                    <div className="relative h-36 w-full shrink-0 overflow-hidden bg-slate-100 lg:h-44">
                        <img
                            src={service.modalImage}
                            alt=""
                            loading="lazy"
                            decoding="async"
                            className="h-full w-full object-cover"
                        />
                        {/* Mobile drag handle overlaid on the image so the
                          * image extends edge-to-edge at the top of the
                          * modal. Translucent white pill stays visible on
                          * either light or dark imagery. */}
                        <div className="absolute left-1/2 top-2 h-1 w-10 -translate-x-1/2 rounded-full bg-white/70 lg:hidden" />
                        {/* Subtle bottom gradient so the white header divider
                          * feels intentional instead of abrupt. */}
                        <div className="absolute inset-x-0 bottom-0 h-12 bg-gradient-to-b from-transparent to-white/40" />
                    </div>
                ) : (
                    /* No banner image — keep the standard drag-handle bar */
                    <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-slate-200 lg:hidden" />
                )}

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
                            parentIcon={service.thumbIcon}
                            parentText={service.thumbText}
                            parentBg={service.thumbBg}
                        />
                    )}

                    {/* Full per-service bullets — moved here from the card so
                      * the card layout stays scannable. */}
                    <BulletsSection bullets={service.bullets} />

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
    showSuccessRing,
}: {
    service: Service;
    qty: number;
    onAdd: () => void;
    onDecrement: () => void;
    onOpenDetails: () => void;
    /** When true, render the emerald success-ring SVG overlay over the
     *  ADD button. Parent unmounts after the 900ms ring animation. */
    showSuccessRing?: boolean;
}) {
    return (
        <article className="flex gap-4 border-b border-slate-100 pb-6">
            <div className="min-w-0 flex-1">
                {service.promoLabel && (
                    <div className="mb-1 text-xs font-semibold tracking-wide text-amber-600">
                        {service.promoLabel}
                    </div>
                )}
                <h3 className="text-base font-semibold leading-snug">
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
                            {/* Duration removed from card — was creating
                              * pricing-clutter; customers don't compare
                              * services by minute count at the card level.
                              * Still rendered in the detail modal where the
                              * tier picker surfaces it per tier. */}
                        </>
                    )}
                </div>

                {/* Card shows the FIRST bullet only — usually the value /
                  * scope summary. The rest (customer-supplied disclaimers,
                  * visit-charge fine print) live in the detail modal so the
                  * card stays scannable. */}
                {service.bullets[0] && (
                    <p className="mt-3 line-clamp-2 text-xs leading-snug text-slate-600">
                        {service.bullets[0]}
                    </p>
                )}

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

                {/* ADD button / qty stepper, with a slow rotating success-ring
                  * overlay that fires for ~900ms when this card's item is
                  * added to the basket. Wrapped in `relative` so the SVG can
                  * absolute-position itself centred over whichever control is
                  * currently rendered. */}
                <div className="relative w-full">
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

                    {/* Rotating success ring — emerald-600 stroke that draws
                      * itself around the button's rounded-rect perimeter
                      * (rather than a circle in the middle). Uses a
                      * normalised 100x40 viewBox with `preserveAspectRatio
                      * ="none"` so the path stretches to the actual button
                      * size, and `vector-effect="non-scaling-stroke"` keeps
                      * the stroke width a uniform 3 CSS px. `pathLength=
                      * "100"` makes dasharray/dashoffset values constant. */}
                    {showSuccessRing && (
                        <svg
                            aria-hidden
                            className="pointer-events-none absolute inset-0 h-full w-full"
                            viewBox="0 0 100 40"
                            preserveAspectRatio="none"
                        >
                            <rect
                                x="1.5"
                                y="1.5"
                                width="97"
                                height="37"
                                rx="5"
                                ry="5"
                                fill="none"
                                stroke="rgb(5 150 105)"
                                strokeWidth="3"
                                strokeLinecap="round"
                                vectorEffect="non-scaling-stroke"
                                pathLength="100"
                                strokeDasharray="100"
                                strokeDashoffset="100"
                                className="animate-success-ring"
                            />
                        </svg>
                    )}
                </div>

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

function SeoIntroBlock({ content }: { content: CityContent }) {
    return (
        <section className="mt-12 grid grid-cols-1 items-center gap-8 border-t border-slate-100 pt-12 md:grid-cols-2 md:gap-12">
            {/* Animated coverage map — same component used on /landing and
              * /derby. Auto-cycles through real-feeling pin popups (service,
              * location, star rating) every 5s so the "active right now"
              * proof feels alive rather than a static graphic. Auto-switches
              * between Derby + Nottingham pin sets via the `city` prop. */}
            <div className="relative">
                <AnimatedMap location={content.city} />
                {/* Coverage caption sits below the map, since AnimatedMap
                  * uses a 3D-perspective blob that won't accept a pinned
                  * overlay cleanly. */}
                <div className="mt-3 flex items-center justify-center gap-1.5 text-xs font-semibold text-slate-700">
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                    {content.seoMapPill}
                </div>
            </div>
            <div>
                <h2 className="text-3xl font-bold tracking-tight">
                    {content.seoIntroHeadline}
                </h2>
                <p className="mt-4 text-sm leading-relaxed text-slate-600">
                    Need a local handyman you can trust? Handy is a single
                    platform for small repairs and installations around the home
                    — from drilling and curtain hanging to flat-pack assembly,
                    smart locks and TV mounting. Our {content.seoIntroCity} team is vetted,
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

function QuickLinksAccordion({ seoLocations }: { seoLocations: string[] }) {
    // Swap the "Serving in" group's links with the per-city list so the
    // footer matches the variant the user landed on. Other groups are
    // city-agnostic and rendered unchanged.
    const groups = QUICK_LINK_GROUPS.map((g) =>
        g.id === "serving" ? { ...g, links: seoLocations } : g,
    );
    return (
        <section className="mt-16 border-t border-slate-100 pt-10">
            <h2 className="mb-4 text-2xl font-bold tracking-tight">Quick Links</h2>
            <Accordion type="multiple" className="max-w-3xl">
                {groups.map((g) => (
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
