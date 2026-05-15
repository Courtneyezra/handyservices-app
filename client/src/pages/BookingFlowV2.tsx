/**
 * BookingFlowV2 — pages 2, 3, 4 of the booking flow.
 *
 * Step 2 (BookingDateV2): REAL date strip + slot grid, persists to localStorage
 * Step 3 (BookingAddressV2): stub — address form lands next pass
 * Step 4 (BookingReviewV2): stub — review + payment lands next pass
 *
 * All three share a `BookingShell` wrapper that renders the LandingHeader,
 * back link, title/subtitle, step indicator, and a Continue CTA (both
 * desktop in-page and mobile sticky). Children render the per-step body.
 *
 * Booking state across steps is persisted in localStorage under
 * `BOOKING_STORAGE_KEY` so a refresh or back/forward navigation preserves
 * what the user picked.
 */

import {
    useEffect,
    useMemo,
    useRef,
    useState,
    type ChangeEvent,
    type InputHTMLAttributes,
    type ReactNode,
} from "react";
import { Link, useLocation } from "wouter";
import {
    Calendar,
    CheckCircle,
    ChevronLeft,
    ChevronRight,
    Clock,
    CreditCard,
    KeyRound,
    Loader2,
    MapPin,
    Moon,
    PartyPopper,
    Pencil,
    Phone,
    Search,
    Sun,
    Sunrise,
} from "lucide-react";
import { LandingHeader } from "@/components/LandingHeader";
import { StepIndicator } from "./BasketV2";
import { ALL_SERVICES, CART_STORAGE_KEY } from "./HandymanV2";
import { trackEvent as posthogTrack } from "@/lib/posthog";

/**
 * Read variant + city the customer landed on from the in-progress booking
 * record. Lets booking-flow events stay tagged with the same variant the
 * /v2 mount captured so PostHog conversion funnels stay apples-to-apples.
 */
function readVariantContext(): { variant: string; city: string } {
    if (typeof window === "undefined")
        return { variant: "v2-nottingham", city: "nottingham" };
    try {
        const raw = window.localStorage.getItem(BOOKING_STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : {};
        return {
            variant: parsed.variant || "v2-nottingham",
            city: parsed.city || "nottingham",
        };
    } catch {
        return { variant: "v2-nottingham", city: "nottingham" };
    }
}

/** Where the in-progress booking is persisted across step navigations. */
export const BOOKING_STORAGE_KEY = "handy-v2-booking";

type BookingState = {
    date?: string; // ISO yyyy-mm-dd
    slotId?: string;
    addressLine1?: string;
    addressLine2?: string;
    town?: string;
    postcode?: string;
    contactName?: string;
    contactPhone?: string;
    contactEmail?: string;
    accessNotes?: string;
};

function readBooking(): BookingState {
    if (typeof window === "undefined") return {};
    try {
        const raw = window.localStorage.getItem(BOOKING_STORAGE_KEY);
        return raw ? JSON.parse(raw) : {};
    } catch {
        return {};
    }
}

function writeBooking(next: BookingState) {
    try {
        window.localStorage.setItem(
            BOOKING_STORAGE_KEY,
            JSON.stringify(next),
        );
    } catch {
        // Quota / private mode — silent
    }
}

// ---------------------------------------------------------------------------
// Step 2 of 4 — REAL date + time-slot picker
// ---------------------------------------------------------------------------

type SlotPeriod = "morning" | "afternoon" | "evening";
type Slot = {
    id: string;
    label: string;
    period: SlotPeriod;
    /** Flat surcharge (in £) applied on top of the basket total at /booking/review.
     *  Mirrors the segment-level after-hours premiums encoded in
     *  server/segmentation/config.ts — overtime / family-time displacement. */
    surcharge?: number;
};

const SLOTS: Slot[] = [
    { id: "m-8-10", label: "8 – 10am", period: "morning" },
    { id: "m-10-12", label: "10am – 12pm", period: "morning" },
    { id: "a-12-14", label: "12 – 2pm", period: "afternoon" },
    { id: "a-14-16", label: "2 – 4pm", period: "afternoon" },
    { id: "a-16-18", label: "4 – 6pm", period: "afternoon" },
    { id: "e-18-20", label: "6 – 8pm", period: "evening", surcharge: 25 },
];

const PERIOD_META: Record<
    SlotPeriod,
    { label: string; Icon: typeof Calendar; subtitle?: string }
> = {
    morning: { label: "Morning", Icon: Sunrise },
    afternoon: { label: "Afternoon", Icon: Sun },
    evening: { label: "Evening", Icon: Moon },
};

/** Flat surcharge applied when the booking falls on a Saturday or Sunday.
 *  Stacks on top of the evening slot surcharge. UK trades convention is
 *  weekend = +£15-£30; we use £20 to keep the math memorable. */
const WEEKEND_SURCHARGE = 20;

/** True if the given Date is a Saturday or Sunday in local time. */
function isWeekendDate(d: Date): boolean {
    const day = d.getDay();
    return day === 0 || day === 6;
}

/** Parse a yyyy-mm-dd string back into a Date at LOCAL midnight, avoiding
 *  the UTC-shift that `new Date("2026-05-13")` would introduce. */
function parseIsoLocal(iso: string): Date {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, m - 1, d);
}

/** Generate 14 days starting from today. */
function next14Days(): Date[] {
    const days: Date[] = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    for (let i = 0; i < 14; i++) {
        const d = new Date(today);
        d.setDate(today.getDate() + i);
        days.push(d);
    }
    return days;
}

/**
 * Format a Date as yyyy-mm-dd in LOCAL time. Using toISOString() instead
 * would convert to UTC and produce yesterday's date for users east of UTC
 * (BST/CET/etc.) at the start of the local day.
 */
function toIsoDate(d: Date): string {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
}

function formatWeekday(d: Date): string {
    return d.toLocaleDateString("en-GB", { weekday: "short" });
}

function formatMonth(d: Date): string {
    return d.toLocaleDateString("en-GB", { month: "short" });
}

/**
 * Stubbed availability — deterministic pseudo-random based on day-of-year
 * so the badge stays stable across renders. Today shows fewer slots than
 * future days (mirrors a real "Today's getting full" pattern). Wire this
 * to a real API later.
 */
function slotsLeftForDate(d: Date): number {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const daysAway = Math.round(
        (d.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
    );
    if (daysAway === 0) return 2;
    if (daysAway === 1) return 4;
    const seed = d.getDate() + d.getMonth();
    return 6 + (seed % 5); // 6–10 slots
}

export function BookingDateV2() {
    const [, setLocation] = useLocation();
    const initial = readBooking();
    const [date, setDate] = useState<string>(initial.date || "");
    const [slotId, setSlotId] = useState<string>(initial.slotId || "");

    const days = useMemo(next14Days, []);

    // Persist on change
    useEffect(() => {
        writeBooking({ ...readBooking(), date, slotId });
    }, [date, slotId]);

    const canContinue = !!date && !!slotId;

    return (
        <BookingShell
            backTo="/basket"
            backLabel="Back to basket"
            stepNumber={2}
            title="Pick a date & time"
            subtitle="When works for you? We usually fit jobs within 3 working days."
            primaryLabel="Continue to address"
            primaryDisabled={!canContinue}
            primaryDisabledHint="Pick a date and a slot to continue"
            onContinue={() => {
                posthogTrack("v2_continue_to_address", readVariantContext());
                setLocation("/booking/address");
            }}
        >
            {/* Date strip */}
            <section className="mt-8">
                <h2 className="mb-3 text-base font-bold text-slate-900">
                    Pick a date
                </h2>
                <div className="-mx-4 overflow-x-auto px-4 pb-2 lg:-mx-0 lg:px-0">
                    <div className="flex snap-x snap-mandatory gap-2">
                        {days.map((d, idx) => {
                            const iso = toIsoDate(d);
                            const isSelected = date === iso;
                            const isToday = idx === 0;
                            const isWeekend = isWeekendDate(d);
                            const slotsLeft = slotsLeftForDate(d);
                            return (
                                <button
                                    key={iso}
                                    type="button"
                                    onClick={() => setDate(iso)}
                                    aria-pressed={isSelected}
                                    className={`flex w-[76px] shrink-0 snap-start flex-col items-center gap-0.5 rounded-xl border px-2 py-3 text-center transition active:scale-[0.97] ${
                                        isSelected
                                            ? "border-amber-400 bg-amber-400 text-slate-900 shadow-md ring-1 ring-amber-500/30"
                                            : "border-slate-200 bg-white text-slate-900 hover:border-amber-400"
                                    }`}
                                >
                                    <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                                        {isToday ? "Today" : formatWeekday(d)}
                                    </span>
                                    <span className="text-xl font-extrabold leading-none">
                                        {d.getDate()}
                                    </span>
                                    <span className="text-[10px] font-medium text-slate-500">
                                        {formatMonth(d)}
                                    </span>
                                    <span
                                        className={`mt-1 rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider ${
                                            isSelected
                                                ? "bg-slate-900 text-amber-400"
                                                : "bg-slate-100 text-slate-600"
                                        }`}
                                    >
                                        {slotsLeft} left
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                </div>
            </section>

            {/* Slot grid — only shows once a date is picked */}
            {date ? (
                <section className="mt-8">
                    <h2 className="mb-3 text-base font-bold text-slate-900">
                        Pick a time slot
                    </h2>
                    {(["morning", "afternoon", "evening"] as SlotPeriod[]).map(
                        (period) => {
                            const slots = SLOTS.filter(
                                (s) => s.period === period,
                            );
                            const meta = PERIOD_META[period];
                            const Icon = meta.Icon;
                            return (
                                <div key={period} className="mt-4">
                                    <div className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-slate-700">
                                        <Icon className="h-4 w-4 text-amber-500" />
                                        {meta.label}
                                    </div>
                                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                                        {slots.map((s) => {
                                            const isSelected = slotId === s.id;
                                            return (
                                                <button
                                                    key={s.id}
                                                    type="button"
                                                    onClick={() =>
                                                        setSlotId(s.id)
                                                    }
                                                    aria-pressed={isSelected}
                                                    className={`relative rounded-lg border px-3 py-2.5 text-sm font-medium transition active:scale-[0.98] ${
                                                        isSelected
                                                            ? "border-amber-400 bg-amber-400 text-slate-900 shadow-md ring-1 ring-amber-500/30"
                                                            : "border-slate-200 bg-white text-slate-700 hover:border-amber-400"
                                                    }`}
                                                >
                                                    {s.label}
                                                    {s.surcharge && (
                                                        <span
                                                            className={`absolute -right-1 -top-1 rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none shadow-sm ring-2 ring-white ${
                                                                isSelected
                                                                    ? "bg-slate-900 text-amber-400"
                                                                    : "bg-amber-400 text-slate-900"
                                                            }`}
                                                        >
                                                            +£{s.surcharge}
                                                        </span>
                                                    )}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            );
                        },
                    )}
                </section>
            ) : (
                <section className="mt-8 rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-500">
                    Pick a date above and we'll show you the available slots.
                </section>
            )}
        </BookingShell>
    );
}

// ---------------------------------------------------------------------------
// Google Places script loader (singleton + UK-only autocomplete helpers)
// ---------------------------------------------------------------------------

type GooglePlace = {
    formatted_address?: string;
    address_components?: Array<{
        long_name: string;
        short_name: string;
        types: string[];
    }>;
};
type GoogleAutocomplete = {
    addListener(event: "place_changed", handler: () => void): void;
    getPlace(): GooglePlace;
};
type GooglePlacesAPI = {
    Autocomplete: new (
        input: HTMLInputElement,
        options?: {
            componentRestrictions?: { country: string | string[] };
            fields?: string[];
            types?: string[];
        },
    ) => GoogleAutocomplete;
};

function getPlacesAPI(): GooglePlacesAPI | undefined {
    return (
        window as {
            google?: { maps?: { places?: GooglePlacesAPI } };
        }
    ).google?.maps?.places;
}

const GOOGLE_PLACES_SCRIPT_ID = "google-places-script";
// Accept either env name — Maps and Places share the same Google Cloud key in
// most setups, and the existing live-call AddressInput reads the Places one
// while .env only has the Maps one. Take whichever is set.
const GOOGLE_PLACES_KEY =
    (import.meta.env as Record<string, string | undefined>)
        .VITE_GOOGLE_PLACES_API_KEY ||
    (import.meta.env as Record<string, string | undefined>)
        .VITE_GOOGLE_MAPS_API_KEY;

let placesLoader: Promise<boolean> | null = null;

function loadGooglePlaces(): Promise<boolean> {
    if (placesLoader) return placesLoader;
    if (typeof window === "undefined") return Promise.resolve(false);
    if (getPlacesAPI()) return Promise.resolve(true);
    if (!GOOGLE_PLACES_KEY) {
        console.warn(
            "[BookingAddress] No Google Places API key set — falling back to manual entry only",
        );
        return Promise.resolve(false);
    }
    if (document.getElementById(GOOGLE_PLACES_SCRIPT_ID)) {
        placesLoader = new Promise((resolve) => {
            const id = window.setInterval(() => {
                if (getPlacesAPI()) {
                    window.clearInterval(id);
                    resolve(true);
                }
            }, 100);
            window.setTimeout(() => {
                window.clearInterval(id);
                resolve(false);
            }, 10000);
        });
        return placesLoader;
    }
    placesLoader = new Promise((resolve) => {
        const s = document.createElement("script");
        s.id = GOOGLE_PLACES_SCRIPT_ID;
        s.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_PLACES_KEY}&libraries=places`;
        s.async = true;
        s.defer = true;
        s.onload = () => resolve(true);
        s.onerror = () => resolve(false);
        document.head.appendChild(s);
    });
    return placesLoader;
}

/** Parse a Place into the fields we need for our form. */
function extractAddressFields(place: GooglePlace): {
    line1: string;
    line2: string;
    town: string;
    postcode: string;
} {
    const comps = place.address_components || [];
    const pick = (type: string) =>
        comps.find((c) => c.types.includes(type))?.long_name || "";
    const streetNumber = pick("street_number");
    const route = pick("route");
    return {
        line1: [streetNumber, route].filter(Boolean).join(" "),
        line2: pick("subpremise"),
        town: pick("postal_town") || pick("locality"),
        postcode: pick("postal_code"),
    };
}

/** Light-theme `.pac-container` styles. Injected as a global stylesheet
 *  while the address form is mounted, removed on unmount. */
const PAC_LIGHT_STYLES = `
.pac-container {
    background-color: white;
    border: 1px solid rgb(226 232 240);
    border-radius: 12px;
    margin-top: 4px;
    font-family: inherit;
    z-index: 10000;
    box-shadow: 0 8px 16px rgba(0,0,0,0.08);
    overflow: hidden;
}
.pac-item {
    background-color: white;
    color: rgb(15 23 42);
    padding: 10px 14px;
    border-top: 1px solid rgb(241 245 249);
    cursor: pointer;
}
.pac-item:first-child { border-top: none; }
.pac-item:hover, .pac-item-selected {
    background-color: rgba(251, 191, 36, 0.12);
}
.pac-item-query {
    color: rgb(15 23 42);
    font-size: 14px;
}
.pac-matched { font-weight: 600; }
.pac-icon { opacity: 0.55; }
.pac-logo::after { display: none !important; }
`;

// ---------------------------------------------------------------------------
// Step 3 of 4 — REAL address & contact form
// ---------------------------------------------------------------------------

/** UK postcode shape — lenient: NG1 5AA / ng1-5aa / NG15AA all match. */
const UK_POSTCODE = /^[A-Z]{1,2}[0-9][A-Z0-9]?\s*[0-9][A-Z]{2}$/i;
/** UK phone shape after stripping spaces/dashes/parens. */
const UK_PHONE = /^(?:\+44|0)\d{9,10}$/;

function isValidPostcode(s: string): boolean {
    return UK_POSTCODE.test(s.trim());
}
function isValidPhone(s: string): boolean {
    return UK_PHONE.test(s.replace(/[\s\-()]/g, ""));
}
function isValidEmail(s: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
}

type AddressFormState = {
    line1: string;
    line2: string;
    town: string;
    postcode: string;
    name: string;
    phone: string;
    email: string;
    accessNotes: string;
};

export function BookingAddressV2() {
    const [, setLocation] = useLocation();

    const [form, setForm] = useState<AddressFormState>(() => {
        const stored = readBooking();
        return {
            line1: stored.addressLine1 || "",
            line2: stored.addressLine2 || "",
            town: stored.town || "Nottingham",
            postcode: stored.postcode || "",
            name: stored.contactName || "",
            phone: stored.contactPhone || "",
            email: stored.contactEmail || "",
            accessNotes: stored.accessNotes || "",
        };
    });
    const [touched, setTouched] = useState<Record<string, boolean>>({});

    // Google Places autocomplete — UK-only, fills line1/line2/town/postcode on
    // selection. Manual fields below stay editable for overrides + corrections.
    const placesInputRef = useRef<HTMLInputElement>(null);
    const [placesStatus, setPlacesStatus] = useState<
        "loading" | "ready" | "unavailable"
    >("loading");

    // Load the script + init autocomplete on mount
    useEffect(() => {
        let cancelled = false;

        loadGooglePlaces().then((ok) => {
            if (cancelled) return;
            setPlacesStatus(ok ? "ready" : "unavailable");
        });

        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        if (placesStatus !== "ready" || !placesInputRef.current) return;
        const api = getPlacesAPI();
        if (!api) return;

        const auto = new api.Autocomplete(placesInputRef.current, {
            componentRestrictions: { country: "gb" },
            fields: ["formatted_address", "address_components"],
            types: ["address"],
        });

        auto.addListener("place_changed", () => {
            const place = auto.getPlace();
            if (!place.address_components) return;
            const parsed = extractAddressFields(place);
            setForm((f) => ({
                ...f,
                line1: parsed.line1 || f.line1,
                line2: parsed.line2 || f.line2,
                town: parsed.town || f.town,
                postcode: parsed.postcode || f.postcode,
            }));
            // Mark touched so any existing red-error styling clears immediately.
            setTouched((t) => ({
                ...t,
                line1: true,
                town: true,
                postcode: true,
            }));
            // Clear the search input so it's obvious the address moved down
            // into the manual fields where it can be edited.
            if (placesInputRef.current) placesInputRef.current.value = "";
        });

        // Inject light-theme styles for `.pac-container`
        const style = document.createElement("style");
        style.textContent = PAC_LIGHT_STYLES;
        document.head.appendChild(style);

        return () => {
            style.remove();
        };
    }, [placesStatus]);

    // Persist on every change so back-button doesn't lose work
    useEffect(() => {
        const current = readBooking();
        writeBooking({
            ...current,
            addressLine1: form.line1,
            addressLine2: form.line2,
            town: form.town,
            postcode: form.postcode,
            contactName: form.name,
            contactPhone: form.phone,
            contactEmail: form.email,
            accessNotes: form.accessNotes,
        });
    }, [form]);

    const errors = useMemo(() => {
        return {
            line1: form.line1.trim() ? null : "Required",
            town: form.town.trim() ? null : "Required",
            postcode: form.postcode.trim()
                ? isValidPostcode(form.postcode)
                    ? null
                    : "Enter a UK postcode (e.g. NG1 5AA)"
                : "Required",
            name: form.name.trim() ? null : "Required",
            phone: form.phone.trim()
                ? isValidPhone(form.phone)
                    ? null
                    : "Enter a UK mobile or landline"
                : "Required",
            email:
                form.email.trim() === "" || isValidEmail(form.email)
                    ? null
                    : "Enter a valid email address",
        };
    }, [form]);

    const canContinue = Object.values(errors).every((e) => e === null);

    const onField = (key: keyof AddressFormState) => (
        e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
    ) => setForm((f) => ({ ...f, [key]: e.target.value }));

    const onBlur = (key: string) => () =>
        setTouched((t) => ({ ...t, [key]: true }));

    const showErr = (key: keyof typeof errors) =>
        touched[key] ? errors[key] : null;

    return (
        <BookingShell
            backTo="/booking/date"
            backLabel="Back to date"
            stepNumber={3}
            title="Where are we coming?"
            subtitle="We cover Nottingham + surrounding suburbs — NG1–NG18 and Derby DE postcodes."
            primaryLabel="Continue to review"
            primaryDisabled={!canContinue}
            primaryDisabledHint="Fill in the required fields to continue"
            onContinue={() => {
                posthogTrack("v2_continue_to_review", readVariantContext());
                setLocation("/booking/review");
            }}
        >
            <div className="mt-8 space-y-7">
                {/* Address section */}
                <section>
                    <h2 className="mb-3 flex items-center gap-1.5 text-sm font-bold uppercase tracking-wider text-slate-500">
                        <MapPin className="h-3.5 w-3.5" />
                        Address
                    </h2>

                    {/* Google Places search — only shown when API loads. Hidden
                      * cleanly when key missing so the manual fields are
                      * always the dependable fallback. */}
                    {placesStatus !== "unavailable" && (
                        <div className="mb-4">
                            <label
                                htmlFor="places-search"
                                className="block text-xs font-medium text-slate-600"
                            >
                                Quick search
                            </label>
                            <div className="relative mt-1">
                                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                                <input
                                    ref={placesInputRef}
                                    id="places-search"
                                    type="text"
                                    autoComplete="off"
                                    spellCheck={false}
                                    disabled={placesStatus === "loading"}
                                    placeholder={
                                        placesStatus === "loading"
                                            ? "Loading address search…"
                                            : "Start typing — e.g. 42 Bracket Street"
                                    }
                                    className="w-full rounded-lg border border-slate-200 bg-white py-2.5 pl-9 pr-9 text-sm shadow-sm transition focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-400/40 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400"
                                />
                                {placesStatus === "loading" && (
                                    <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-slate-400" />
                                )}
                            </div>
                            <p className="mt-1 text-xs text-slate-400">
                                Pick from the suggestions to auto-fill — or
                                enter manually below.
                            </p>
                        </div>
                    )}

                    <div className="space-y-3">
                        <Field
                            label="Address line 1"
                            id="line1"
                            value={form.line1}
                            onChange={onField("line1")}
                            onBlur={onBlur("line1")}
                            error={showErr("line1")}
                            required
                            autoComplete="address-line1"
                            placeholder="42 Bracket Street"
                        />
                        <Field
                            label="Address line 2"
                            id="line2"
                            value={form.line2}
                            onChange={onField("line2")}
                            autoComplete="address-line2"
                            placeholder="Flat 3 / Building name (optional)"
                        />
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_140px]">
                            <Field
                                label="Town"
                                id="town"
                                value={form.town}
                                onChange={onField("town")}
                                onBlur={onBlur("town")}
                                error={showErr("town")}
                                required
                                autoComplete="address-level2"
                            />
                            <Field
                                label="Postcode"
                                id="postcode"
                                value={form.postcode}
                                onChange={onField("postcode")}
                                onBlur={onBlur("postcode")}
                                error={showErr("postcode")}
                                required
                                autoComplete="postal-code"
                                placeholder="NG1 5AA"
                                spellCheck={false}
                            />
                        </div>
                    </div>
                </section>

                {/* Contact section */}
                <section>
                    <h2 className="mb-3 flex items-center gap-1.5 text-sm font-bold uppercase tracking-wider text-slate-500">
                        <Phone className="h-3.5 w-3.5" />
                        Contact
                    </h2>
                    <div className="space-y-3">
                        <Field
                            label="Your name"
                            id="name"
                            value={form.name}
                            onChange={onField("name")}
                            onBlur={onBlur("name")}
                            error={showErr("name")}
                            required
                            autoComplete="name"
                            placeholder="Jane Smith"
                        />
                        <Field
                            label="Phone"
                            id="phone"
                            type="tel"
                            value={form.phone}
                            onChange={onField("phone")}
                            onBlur={onBlur("phone")}
                            error={showErr("phone")}
                            required
                            autoComplete="tel"
                            placeholder="07123 456789"
                        />
                        <Field
                            label="Email"
                            id="email"
                            type="email"
                            value={form.email}
                            onChange={onField("email")}
                            onBlur={onBlur("email")}
                            error={showErr("email")}
                            autoComplete="email"
                            placeholder="jane@example.com"
                        />
                    </div>
                </section>

                {/* Access notes */}
                <section>
                    <h2 className="mb-3 flex items-center gap-1.5 text-sm font-bold uppercase tracking-wider text-slate-500">
                        <KeyRound className="h-3.5 w-3.5" />
                        How do we get in?
                    </h2>
                    <label
                        htmlFor="accessNotes"
                        className="sr-only"
                    >
                        Access notes
                    </label>
                    <textarea
                        id="accessNotes"
                        rows={3}
                        value={form.accessNotes}
                        onChange={onField("accessNotes")}
                        placeholder="Key safe code, buzzer number, parking notes, dog at home — anything to help our tradesperson find you and start on time."
                        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm shadow-sm transition focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-400/40"
                    />
                    <p className="mt-1 text-xs text-slate-400">
                        Optional but helpful — saves a phone call on the day.
                    </p>
                </section>
            </div>
        </BookingShell>
    );
}

function Field({
    label,
    id,
    error,
    required,
    type = "text",
    ...rest
}: {
    label: string;
    id: string;
    error?: string | null;
    required?: boolean;
    type?: string;
} & Omit<InputHTMLAttributes<HTMLInputElement>, "id" | "type">) {
    return (
        <div>
            <label
                htmlFor={id}
                className="block text-xs font-medium text-slate-600"
            >
                {label}
                {!required && (
                    <span className="ml-1 text-slate-400">(optional)</span>
                )}
            </label>
            <input
                id={id}
                type={type}
                aria-invalid={!!error}
                aria-describedby={error ? `${id}-error` : undefined}
                className={`mt-1 w-full rounded-lg border px-3 py-2.5 text-sm shadow-sm transition focus:outline-none focus:ring-2 focus:ring-amber-400/40 ${
                    error
                        ? "border-red-300 bg-red-50 focus:border-red-400"
                        : "border-slate-200 bg-white focus:border-amber-400"
                }`}
                {...rest}
            />
            {error && (
                <p
                    id={`${id}-error`}
                    className="mt-1 text-xs font-medium text-red-600"
                >
                    {error}
                </p>
            )}
        </div>
    );
}

// ---------------------------------------------------------------------------
// Step 4 of 4 — REAL review, payment picker, confirm
// ---------------------------------------------------------------------------

/** Same thresholds as BasketV2 — keep in sync if the visit fee moves. */
const REVIEW_VISIT_FEE_WAIVED_THRESHOLD = 58;
const REVIEW_VISIT_FEE = 15;

type PaymentMethod = "pay-on-completion" | "card" | "klarna";

/** Generate a short booking reference shown on the confirmation page. */
function generateBookingRef(): string {
    const year = new Date().getFullYear();
    const rand = Math.random()
        .toString(36)
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "")
        .slice(0, 6);
    return `HS-${year}-${rand}`;
}

function readCart(): Record<string, number> {
    if (typeof window === "undefined") return {};
    try {
        const raw = window.localStorage.getItem(CART_STORAGE_KEY);
        return raw ? JSON.parse(raw) : {};
    } catch {
        return {};
    }
}

function formatHumanDate(iso: string): string {
    const d = parseIsoLocal(iso);
    return d.toLocaleDateString("en-GB", {
        weekday: "long",
        day: "numeric",
        month: "long",
    });
}

export function BookingReviewV2() {
    const [, setLocation] = useLocation();
    const [cart] = useState(readCart);
    const [booking] = useState(readBooking);
    const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(
        "pay-on-completion",
    );
    const [confirmation, setConfirmation] = useState<{
        reference: string;
        when: string;
        address: string;
    } | null>(null);

    // Guard: bounce back to whichever step is missing
    useEffect(() => {
        if (Object.keys(cart).length === 0) {
            setLocation("/v2");
            return;
        }
        if (!booking.date || !booking.slotId) {
            setLocation("/booking/date");
            return;
        }
        if (
            !booking.addressLine1 ||
            !booking.postcode ||
            !booking.contactName ||
            !booking.contactPhone
        ) {
            setLocation("/booking/address");
            return;
        }
    }, [cart, booking, setLocation]);

    const items = useMemo(
        () =>
            Object.entries(cart).flatMap(([id, qty]) => {
                const svc = ALL_SERVICES.find((s) => s.id === id);
                return svc ? [{ ...svc, qty }] : [];
            }),
        [cart],
    );

    const subtotal = items.reduce(
        (sum, item) => sum + item.priceCurrent * item.qty,
        0,
    );
    const visitFee =
        subtotal > 0 && subtotal < REVIEW_VISIT_FEE_WAIVED_THRESHOLD
            ? REVIEW_VISIT_FEE
            : 0;

    const isWeekend = booking.date
        ? isWeekendDate(parseIsoLocal(booking.date))
        : false;
    const weekendSurcharge = isWeekend ? WEEKEND_SURCHARGE : 0;

    const slot = SLOTS.find((s) => s.id === booking.slotId);
    const eveningSurcharge = slot?.surcharge ?? 0;

    const total =
        subtotal + visitFee + weekendSurcharge + eveningSurcharge;

    // Klarna minimum is typically £30 in the UK; show it only when applicable.
    const klarnaAvailable = total >= 30;

    const handleConfirm = () => {
        if (!booking.date || !slot) return;
        const reference = generateBookingRef();
        const when = `${formatHumanDate(booking.date)} · ${slot.label}`;
        const address = [
            booking.addressLine1,
            booking.addressLine2,
            booking.town,
            booking.postcode,
        ]
            .filter(Boolean)
            .join(", ");

        // Fire `v2_confirm_booking` BEFORE any API write so we can compute
        // confirm→confirmed funnel drop-off (eg. API failures).
        const variantCtx = readVariantContext();
        posthogTrack("v2_confirm_booking", variantCtx);

        // Stash a snapshot of the confirmed booking for support reference
        try {
            window.localStorage.setItem(
                "handy-v2-confirmed",
                JSON.stringify({
                    reference,
                    when,
                    address,
                    paymentMethod,
                    total,
                    items: items.map((i) => ({
                        id: i.id,
                        name: i.name,
                        qty: i.qty,
                        priceCurrent: i.priceCurrent,
                    })),
                    contactName: booking.contactName,
                    contactPhone: booking.contactPhone,
                    contactEmail: booking.contactEmail,
                    confirmedAt: new Date().toISOString(),
                }),
            );
            // Clear the in-progress cart + booking so a refresh doesn't
            // re-book the same order.
            window.localStorage.removeItem(CART_STORAGE_KEY);
            window.localStorage.removeItem(BOOKING_STORAGE_KEY);
        } catch {
            // Storage unavailable — confirmation still shows in-memory.
        }

        // After the storage write succeeds we treat the booking as confirmed
        // (no real API yet — booking creation lives behind a flag and is
        // currently localStorage-only). Include the booking_reference so we
        // can correlate booking events with the eventual server record.
        posthogTrack("v2_booking_confirmed", {
            ...variantCtx,
            booking_reference: reference,
        });

        setConfirmation({ reference, when, address });
        window.scrollTo({ top: 0, behavior: "smooth" });
    };

    // ─── Success state ──────────────────────────────────────────────────────
    if (confirmation) {
        return <BookingConfirmation {...confirmation} />;
    }

    // Guards may have triggered a redirect — render nothing in that case
    if (
        Object.keys(cart).length === 0 ||
        !booking.date ||
        !booking.slotId ||
        !booking.addressLine1
    ) {
        return null;
    }

    return (
        <BookingShell
            backTo="/booking/address"
            backLabel="Back to address"
            stepNumber={4}
            title="Review & confirm"
            subtitle="One last look before we lock in your slot."
            primaryLabel="Confirm booking"
            onContinue={handleConfirm}
        >
            <div className="mt-8 space-y-5">
                {/* Date & time card */}
                <SummaryCard
                    Icon={Calendar}
                    title="Date & time"
                    editTo="/booking/date"
                >
                    <p className="text-sm font-medium text-slate-900">
                        {formatHumanDate(booking.date!)}
                    </p>
                    <p className="text-sm text-slate-600">
                        {slot?.label} ·{" "}
                        {slot?.period
                            ? slot.period.charAt(0).toUpperCase() +
                              slot.period.slice(1)
                            : ""}
                    </p>
                    {(isWeekend || eveningSurcharge > 0) && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                            {isWeekend && (
                                <span className="rounded-full bg-amber-400 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-900">
                                    Weekend +£{WEEKEND_SURCHARGE}
                                </span>
                            )}
                            {eveningSurcharge > 0 && (
                                <span className="rounded-full bg-amber-400 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-900">
                                    Evening +£{eveningSurcharge}
                                </span>
                            )}
                        </div>
                    )}
                </SummaryCard>

                {/* Address & contact card */}
                <SummaryCard
                    Icon={MapPin}
                    title="Address & contact"
                    editTo="/booking/address"
                >
                    <p className="text-sm font-medium text-slate-900">
                        {booking.addressLine1}
                        {booking.addressLine2 && `, ${booking.addressLine2}`}
                    </p>
                    <p className="text-sm text-slate-600">
                        {booking.town}, {booking.postcode}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600">
                        <span className="font-medium">
                            {booking.contactName}
                        </span>
                        <span>·</span>
                        <span>{booking.contactPhone}</span>
                        {booking.contactEmail && (
                            <>
                                <span>·</span>
                                <span>{booking.contactEmail}</span>
                            </>
                        )}
                    </div>
                    {booking.accessNotes && (
                        <p className="mt-2 rounded-md bg-slate-100 px-2.5 py-1.5 text-xs text-slate-600">
                            <KeyRound className="mr-1 inline-block h-3 w-3 align-text-bottom" />
                            {booking.accessNotes}
                        </p>
                    )}
                </SummaryCard>

                {/* Items card */}
                <SummaryCard
                    Icon={Clock}
                    title={`Your basket (${items.reduce((s, i) => s + i.qty, 0)} item${items.reduce((s, i) => s + i.qty, 0) === 1 ? "" : "s"})`}
                    editTo="/basket"
                >
                    <ul className="-my-1 divide-y divide-slate-100">
                        {items.map((item) => (
                            <li
                                key={item.id}
                                className="flex items-center justify-between gap-3 py-2 text-sm"
                            >
                                <div className="flex min-w-0 items-center gap-3">
                                    {item.thumbImage ? (
                                        <img
                                            src={item.thumbImage}
                                            alt=""
                                            loading="lazy"
                                            decoding="async"
                                            className="h-9 w-9 shrink-0 rounded-md object-cover"
                                        />
                                    ) : item.thumbIcon ? (
                                        <div
                                            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-gradient-to-br text-slate-800 ${item.thumbBg}`}
                                        >
                                            <item.thumbIcon
                                                className="h-4 w-4"
                                                strokeWidth={1.75}
                                                aria-hidden
                                            />
                                        </div>
                                    ) : (
                                        <div
                                            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-gradient-to-br text-base ${item.thumbBg}`}
                                        >
                                            {item.thumbEmoji}
                                        </div>
                                    )}
                                    <div className="min-w-0">
                                        <p className="truncate font-medium text-slate-900">
                                            {item.name}
                                        </p>
                                        <p className="text-xs text-slate-500">
                                            Qty {item.qty}
                                        </p>
                                    </div>
                                </div>
                                <span className="shrink-0 font-semibold text-slate-900">
                                    £{item.priceCurrent * item.qty}
                                </span>
                            </li>
                        ))}
                    </ul>
                </SummaryCard>

                {/* Totals */}
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                    <h3 className="mb-3 text-sm font-bold uppercase tracking-wider text-slate-500">
                        Total
                    </h3>
                    <div className="space-y-1.5 text-sm">
                        <div className="flex justify-between">
                            <span className="text-slate-600">Subtotal</span>
                            <span className="font-medium">£{subtotal}</span>
                        </div>
                        {visitFee > 0 && (
                            <div className="flex justify-between text-amber-700">
                                <span>Visit fee</span>
                                <span className="font-medium">
                                    £{visitFee}
                                </span>
                            </div>
                        )}
                        {weekendSurcharge > 0 && (
                            <div className="flex justify-between text-amber-700">
                                <span>Weekend surcharge</span>
                                <span className="font-medium">
                                    £{weekendSurcharge}
                                </span>
                            </div>
                        )}
                        {eveningSurcharge > 0 && (
                            <div className="flex justify-between text-amber-700">
                                <span>Evening surcharge</span>
                                <span className="font-medium">
                                    £{eveningSurcharge}
                                </span>
                            </div>
                        )}
                    </div>
                    <div className="mt-3 flex items-baseline justify-between border-t border-slate-200 pt-3">
                        <span className="text-base font-bold">Total</span>
                        <span className="text-2xl font-bold">£{total}</span>
                    </div>
                </div>

                {/* Payment method picker */}
                <section>
                    <h3 className="mb-3 flex items-center gap-1.5 text-sm font-bold uppercase tracking-wider text-slate-500">
                        <CreditCard className="h-3.5 w-3.5" />
                        How would you like to pay?
                    </h3>
                    <div className="space-y-2">
                        <PaymentOption
                            id="pay-on-completion"
                            checked={paymentMethod === "pay-on-completion"}
                            onChange={() =>
                                setPaymentMethod("pay-on-completion")
                            }
                            label="Pay on completion"
                            subtitle="Pay your tradesperson by card or bank transfer when the job's done — most popular."
                            recommended
                        />
                        <PaymentOption
                            id="card"
                            checked={paymentMethod === "card"}
                            onChange={() => setPaymentMethod("card")}
                            label="Pay now by card"
                            subtitle="Secure card payment via Stripe — we'll send a receipt straight away."
                        />
                        {klarnaAvailable && (
                            <PaymentOption
                                id="klarna"
                                checked={paymentMethod === "klarna"}
                                onChange={() => setPaymentMethod("klarna")}
                                label="Pay in 3 with Klarna"
                                subtitle={`Three interest-free payments of £${Math.ceil(total / 3)} — no fees, no fuss.`}
                            />
                        )}
                    </div>
                </section>

                <p className="text-xs text-slate-400">
                    By confirming you agree to our 30-day workmanship
                    guarantee. We'll send a confirmation to{" "}
                    {booking.contactEmail || "your phone"} within a few
                    minutes.
                </p>
            </div>
        </BookingShell>
    );
}

function SummaryCard({
    Icon,
    title,
    editTo,
    children,
}: {
    Icon: typeof Calendar;
    title: string;
    editTo: string;
    children: ReactNode;
}) {
    return (
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <div className="mb-3 flex items-center justify-between gap-3">
                <h3 className="flex items-center gap-1.5 text-sm font-bold uppercase tracking-wider text-slate-500">
                    <Icon className="h-3.5 w-3.5" />
                    {title}
                </h3>
                <Link
                    href={editTo}
                    className="inline-flex items-center gap-1 rounded-md text-xs font-medium text-amber-600 transition hover:text-amber-700"
                >
                    <Pencil className="h-3 w-3" />
                    Edit
                </Link>
            </div>
            {children}
        </div>
    );
}

function PaymentOption({
    id,
    checked,
    onChange,
    label,
    subtitle,
    recommended,
}: {
    id: string;
    checked: boolean;
    onChange: () => void;
    label: string;
    subtitle: string;
    recommended?: boolean;
}) {
    return (
        <label
            htmlFor={`pay-${id}`}
            className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition ${
                checked
                    ? "border-amber-400 bg-amber-400/10 ring-1 ring-amber-400/40"
                    : "border-slate-200 bg-white hover:border-slate-300"
            }`}
        >
            <input
                id={`pay-${id}`}
                type="radio"
                name="payment-method"
                checked={checked}
                onChange={onChange}
                className="mt-0.5 h-4 w-4 shrink-0 accent-amber-500"
            />
            <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-slate-900">
                        {label}
                    </span>
                    {recommended && (
                        <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-700">
                            Recommended
                        </span>
                    )}
                </div>
                <p className="mt-0.5 text-xs leading-relaxed text-slate-500">
                    {subtitle}
                </p>
            </div>
        </label>
    );
}

function BookingConfirmation({
    reference,
    when,
    address,
}: {
    reference: string;
    when: string;
    address: string;
}) {
    return (
        <div className="min-h-screen bg-white font-sans text-slate-900">
            <LandingHeader />
            <main className="mx-auto max-w-2xl px-4 pb-16 pt-8 lg:px-8">
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6 lg:p-8">
                    <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500 text-white">
                        <PartyPopper className="h-7 w-7" />
                    </div>
                    <h1 className="mt-4 text-2xl font-bold text-slate-900 lg:text-3xl">
                        Booking confirmed
                    </h1>
                    <p className="mt-1 text-sm text-slate-600">
                        We've sent a confirmation your way. Your tradesperson
                        will be in touch the day before with a 1-hour arrival
                        window.
                    </p>
                    <dl className="mt-5 space-y-3 rounded-lg border border-emerald-200 bg-white p-4 text-sm">
                        <div>
                            <dt className="text-xs font-bold uppercase tracking-wider text-slate-500">
                                Reference
                            </dt>
                            <dd className="mt-0.5 font-mono text-base font-bold tracking-tight text-slate-900">
                                {reference}
                            </dd>
                        </div>
                        <div>
                            <dt className="text-xs font-bold uppercase tracking-wider text-slate-500">
                                When
                            </dt>
                            <dd className="mt-0.5 text-slate-900">{when}</dd>
                        </div>
                        <div>
                            <dt className="text-xs font-bold uppercase tracking-wider text-slate-500">
                                Where
                            </dt>
                            <dd className="mt-0.5 text-slate-900">{address}</dd>
                        </div>
                    </dl>
                </div>

                <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                    <Link
                        href="/v2"
                        className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-slate-900 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800"
                    >
                        Book another job
                    </Link>
                    <a
                        href="https://wa.me/447508744402"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-900 transition hover:border-slate-300"
                    >
                        Message us on WhatsApp
                    </a>
                </div>

                <p className="mt-8 text-center text-xs text-slate-400">
                    Need to make a change? Reply to the confirmation message
                    or WhatsApp us with reference{" "}
                    <span className="font-mono">{reference}</span>.
                </p>
            </main>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Shared shell for every booking step
// ---------------------------------------------------------------------------

function BookingShell({
    backTo,
    backLabel,
    stepNumber,
    title,
    subtitle,
    primaryLabel,
    primaryDisabled,
    primaryDisabledHint,
    onContinue,
    children,
}: {
    backTo: string;
    backLabel: string;
    stepNumber: 2 | 3 | 4;
    title: string;
    subtitle: string;
    primaryLabel: string;
    primaryDisabled?: boolean;
    primaryDisabledHint?: string;
    onContinue: () => void;
    children: ReactNode;
}) {
    return (
        <div className="min-h-screen bg-white pb-32 font-sans text-slate-900 lg:pb-16">
            <LandingHeader />
            <main className="mx-auto max-w-2xl px-4 pt-8 lg:px-8">
                <Link
                    href={backTo}
                    className="inline-flex items-center gap-1 text-sm font-medium text-slate-600 transition hover:text-amber-600"
                >
                    <ChevronLeft className="h-4 w-4" />
                    {backLabel}
                </Link>

                <h1 className="mt-6 text-3xl font-bold lg:text-4xl">{title}</h1>
                <p className="mt-2 text-sm text-slate-500">{subtitle}</p>

                <StepIndicator current={stepNumber} />

                {children}

                {/* Desktop CTA */}
                <button
                    type="button"
                    onClick={onContinue}
                    disabled={primaryDisabled}
                    className="mt-8 hidden w-full items-center justify-center gap-2 rounded-lg bg-amber-400 px-5 py-3.5 text-sm font-bold uppercase tracking-wide text-slate-900 shadow-md ring-1 ring-amber-500/30 transition hover:bg-amber-500 active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none disabled:ring-0 lg:flex"
                >
                    {primaryLabel}
                    <ChevronRight className="h-4 w-4" />
                </button>
                {primaryDisabled && primaryDisabledHint && (
                    <p className="mt-2 hidden text-center text-xs text-slate-400 lg:block">
                        {primaryDisabledHint}
                    </p>
                )}
            </main>

            {/* Mobile sticky CTA */}
            <div className="fixed bottom-0 left-0 right-0 z-30 border-t border-slate-200 bg-white px-4 py-3 shadow-lg lg:hidden">
                <button
                    type="button"
                    onClick={onContinue}
                    disabled={primaryDisabled}
                    className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-amber-400 px-4 py-3 text-sm font-bold uppercase tracking-wide text-slate-900 shadow-md ring-1 ring-amber-500/30 transition hover:bg-amber-500 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none disabled:ring-0"
                >
                    {primaryLabel}
                    <ChevronRight className="h-4 w-4" />
                </button>
                {primaryDisabled && primaryDisabledHint && (
                    <p className="mt-1.5 text-center text-[11px] text-slate-400">
                        {primaryDisabledHint}
                    </p>
                )}
            </div>
        </div>
    );
}

function StubPanel({
    Icon,
    heading,
    body,
    stepNumber,
}: {
    Icon: typeof Calendar;
    heading: string;
    body: string;
    stepNumber: number;
}) {
    return (
        <div className="mt-8 rounded-2xl border border-slate-200 bg-slate-50 p-6 lg:p-8">
            <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-amber-400/20">
                <Icon className="h-7 w-7 text-amber-500" />
            </div>
            <h2 className="mt-4 text-lg font-bold">{heading}</h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">
                {body}
            </p>
            <div className="mt-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                <CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                <p>
                    <span className="font-semibold">
                        Step {stepNumber} of 4.
                    </span>{" "}
                    Continue still works — it takes you to the next step
                    placeholder so we can validate the navigation end-to-end.
                </p>
            </div>
        </div>
    );
}
