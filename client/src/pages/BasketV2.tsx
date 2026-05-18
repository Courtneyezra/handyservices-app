/**
 * BasketV2 — real basket page reached from /v2's sticky "View basket" CTA.
 *
 * Step 1 of the 4-step booking flow:
 *   /basket          ← this page (line items + totals + Continue CTA)
 *   /booking/date    → date & time-slot picker (stub for now)
 *   /booking/address → address + contact details (stub for now)
 *   /booking/review  → review + payment (stub for now)
 *
 * Reads the cart from localStorage (same key HandymanV2 writes to) and looks
 * each entry up against the shared `ALL_SERVICES` catalog so we render
 * fresh name/price/thumb data without storing duplicates in storage.
 */

import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import {
    ChevronLeft,
    ChevronRight,
    Minus,
    Plus,
    ShoppingCart,
    Trash2,
} from "lucide-react";
import { LandingHeader } from "@/components/LandingHeader";
import {
    WhatsAppEscapeBigJob,
    WhatsAppEscapeLink,
} from "@/components/WhatsAppEscape";
import { ALL_SERVICES, CART_STORAGE_KEY } from "./HandymanV2";
import { trackEvent as posthogTrack } from "@/lib/posthog";

/**
 * Reads the variant + city the user originally landed on (written into
 * `handy-v2-booking` by the /v2 page mount). Used to tag every funnel
 * event in the basket → review steps with the same variant / city so
 * PostHog can compare conversion rates across split-test variants.
 */
function readVariantContext(): { variant: string; city: string } {
    if (typeof window === "undefined") return { variant: "v2-nottingham", city: "nottingham" };
    try {
        const raw = window.localStorage.getItem("handy-v2-booking");
        const parsed = raw ? JSON.parse(raw) : {};
        return {
            variant: parsed.variant || "v2-nottingham",
            city: parsed.city || "nottingham",
        };
    } catch {
        return { variant: "v2-nottingham", city: "nottingham" };
    }
}

/** Subtotal threshold at or above which the visit fee is waived. Below this
 *  the customer pays a flat callout charge to cover the cost of sending a
 *  tradesperson; above it the work itself covers the visit. Kept in sync
 *  with the same constants in BookingFlowV2. */
const VISIT_FEE_WAIVED_THRESHOLD = 58;
const VISIT_FEE = 15;

function readCart(): Record<string, number> {
    if (typeof window === "undefined") return {};
    try {
        const raw = window.localStorage.getItem(CART_STORAGE_KEY);
        return raw ? JSON.parse(raw) : {};
    } catch {
        return {};
    }
}

export default function BasketV2() {
    const [, setLocation] = useLocation();
    const [cart, setCart] = useState<Record<string, number>>(readCart);
    // Persisted variant context so basket → review events stay tagged.
    const [variantCtx] = useState(readVariantContext);

    // Fire `v2_view_basket` on mount so dashboards can chart the
    // drop-off rate between cart adds and basket views.
    useEffect(() => {
        posthogTrack("v2_view_basket", variantCtx);
    }, []);

    // Mirror updates back to localStorage so /v2 and any future page stay in sync.
    useEffect(() => {
        try {
            window.localStorage.setItem(
                CART_STORAGE_KEY,
                JSON.stringify(cart),
            );
        } catch {
            // Quota or private mode — ignore, the UI still works for this session.
        }
    }, [cart]);

    const continueToDate = () => {
        posthogTrack("v2_continue_to_date", variantCtx);
        setLocation("/booking/date");
    };

    const increment = (id: string) =>
        setCart((c) => ({ ...c, [id]: (c[id] || 0) + 1 }));
    const decrement = (id: string) =>
        setCart((c) => {
            const next = { ...c, [id]: Math.max(0, (c[id] || 0) - 1) };
            if (next[id] === 0) delete next[id];
            return next;
        });
    const remove = (id: string) =>
        setCart((c) => {
            const next = { ...c };
            delete next[id];
            return next;
        });

    const items = Object.entries(cart).flatMap(([id, qty]) => {
        const svc = ALL_SERVICES.find((s) => s.id === id);
        return svc ? [{ ...svc, qty }] : [];
    });

    const subtotal = items.reduce(
        (sum, item) => sum + item.priceCurrent * item.qty,
        0,
    );
    const subtotalOriginal = items.reduce(
        (sum, item) =>
            sum + (item.priceOriginal || item.priceCurrent) * item.qty,
        0,
    );
    const visitFee =
        subtotal > 0 && subtotal < VISIT_FEE_WAIVED_THRESHOLD
            ? VISIT_FEE
            : 0;
    const total = subtotal + visitFee;
    const itemCount = items.reduce((sum, item) => sum + item.qty, 0);

    // Empty state
    if (items.length === 0) {
        return (
            <div className="min-h-screen bg-white font-sans text-slate-900">
                <LandingHeader />
                <main className="mx-auto max-w-2xl px-4 pb-16 pt-8 lg:px-8">
                    <BackLink to="/v2" label="Keep shopping" />
                    <h1 className="mt-6 text-3xl font-bold lg:text-4xl">
                        Your basket
                    </h1>
                    <div className="mt-8 rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-8 text-center">
                        <ShoppingCart className="mx-auto h-10 w-10 text-slate-300" />
                        <p className="mt-3 text-sm text-slate-500">
                            Your basket is empty
                        </p>
                        <Link
                            href="/v2"
                            className="mt-4 inline-flex items-center gap-1 rounded-full bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800"
                        >
                            Browse handyman services
                        </Link>
                    </div>
                </main>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-white pb-32 font-sans text-slate-900 lg:pb-16">
            <LandingHeader />
            <main className="mx-auto max-w-2xl px-4 pt-8 lg:px-8">
                <BackLink to="/v2" label="Keep shopping" />

                <h1 className="mt-6 text-3xl font-bold lg:text-4xl">
                    Your basket
                </h1>
                <p className="mt-2 text-sm text-slate-500">
                    {itemCount} item{itemCount === 1 ? "" : "s"} · ready to schedule
                </p>

                {/* Step indicator — first of four */}
                <StepIndicator current={1} />

                {/* Line items */}
                <div className="mt-6 space-y-3">
                    {items.map((item) => (
                        <article
                            key={item.id}
                            className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-4"
                        >
                            {item.thumbImage ? (
                                <img
                                    src={item.thumbImage}
                                    alt=""
                                    loading="lazy"
                                    decoding="async"
                                    className="h-16 w-16 shrink-0 rounded-lg object-cover"
                                />
                            ) : item.thumbIcon ? (
                                <div
                                    className={`flex h-16 w-16 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br text-slate-800 ${item.thumbBg}`}
                                >
                                    <item.thumbIcon
                                        className="h-7 w-7"
                                        strokeWidth={1.75}
                                        aria-hidden
                                    />
                                </div>
                            ) : (
                                <div
                                    className={`flex h-16 w-16 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br text-3xl ${item.thumbBg}`}
                                >
                                    {item.thumbEmoji}
                                </div>
                            )}
                            <div className="min-w-0 flex-1">
                                <p className="text-sm font-semibold leading-tight text-slate-900">
                                    {item.name}
                                </p>
                                {item.durationMinutes && (
                                    <p className="mt-0.5 text-xs text-slate-500">
                                        {item.durationMinutes} min slot
                                    </p>
                                )}
                                <div className="mt-2 flex items-center justify-between gap-3">
                                    {/* Stepper */}
                                    <div className="flex items-center rounded-lg border border-amber-400 bg-amber-400/10">
                                        <button
                                            type="button"
                                            onClick={() => decrement(item.id)}
                                            className="flex h-7 w-7 items-center justify-center rounded-l-lg text-slate-900 transition hover:bg-amber-200/50"
                                            aria-label="Decrease quantity"
                                        >
                                            <Minus className="h-3.5 w-3.5" />
                                        </button>
                                        <span className="min-w-[1.5rem] text-center text-sm font-bold">
                                            {item.qty}
                                        </span>
                                        <button
                                            type="button"
                                            onClick={() => increment(item.id)}
                                            className="flex h-7 w-7 items-center justify-center rounded-r-lg text-slate-900 transition hover:bg-amber-200/50"
                                            aria-label="Increase quantity"
                                        >
                                            <Plus className="h-3.5 w-3.5" />
                                        </button>
                                    </div>
                                    {/* Line price */}
                                    <div className="text-right">
                                        <div className="text-sm font-semibold">
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
                            <button
                                type="button"
                                onClick={() => remove(item.id)}
                                aria-label="Remove from basket"
                                className="-mr-1 -mt-1 rounded p-1 text-slate-400 transition hover:text-red-500"
                            >
                                <Trash2 className="h-4 w-4" />
                            </button>
                        </article>
                    ))}
                </div>

                {/* Totals */}
                <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-5">
                    <div className="space-y-2 text-sm">
                        <div className="flex justify-between">
                            <span className="text-slate-600">Subtotal</span>
                            <span className="font-medium">£{subtotal}</span>
                        </div>
                        {visitFee > 0 && (
                            <div className="flex justify-between text-amber-700">
                                <span className="flex items-center gap-1.5">
                                    Visit fee
                                    <span className="text-xs font-normal text-slate-500">
                                        (waived above £{VISIT_FEE_WAIVED_THRESHOLD})
                                    </span>
                                </span>
                                <span className="font-medium">
                                    £{visitFee}
                                </span>
                            </div>
                        )}
                        {subtotalOriginal > subtotal && (
                            <div className="flex justify-between text-emerald-700">
                                <span>You're saving</span>
                                <span className="font-medium">
                                    £{subtotalOriginal - subtotal}
                                </span>
                            </div>
                        )}
                    </div>
                    <div className="mt-3 flex items-baseline justify-between border-t border-slate-200 pt-3">
                        <span className="text-base font-bold">Total</span>
                        <span className="text-xl font-bold">£{total}</span>
                    </div>
                </div>

                {/* High-value basket → offer a WhatsApp chat for scoping.
                  * Disappears entirely under £150 so simple bookings aren't
                  * nagged. */}
                <WhatsAppEscapeBigJob subtotal={subtotal} />

                {/* Desktop CTA */}
                <button
                    type="button"
                    onClick={continueToDate}
                    className="mt-6 hidden w-full items-center justify-center gap-2 rounded-lg bg-amber-400 px-5 py-3.5 text-sm font-bold uppercase tracking-wide text-slate-900 shadow-md ring-1 ring-amber-500/30 transition hover:bg-amber-500 active:scale-[0.98] lg:flex"
                >
                    Continue to date &amp; time
                    <ChevronRight className="h-4 w-4" />
                </button>

                <WhatsAppEscapeLink step="basket" />
            </main>

            {/* Mobile sticky Continue */}
            <div className="fixed bottom-0 left-0 right-0 z-30 border-t border-slate-200 bg-white px-4 py-3 shadow-lg lg:hidden">
                <div className="flex items-center justify-between gap-3">
                    <div>
                        <div className="text-xs text-slate-500">Total</div>
                        <div className="text-lg font-bold">£{total}</div>
                    </div>
                    <button
                        type="button"
                        onClick={continueToDate}
                        className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-amber-400 px-4 py-3 text-sm font-bold uppercase tracking-wide text-slate-900 shadow-md ring-1 ring-amber-500/30 transition hover:bg-amber-500"
                    >
                        Continue
                        <ChevronRight className="h-4 w-4" />
                    </button>
                </div>
            </div>
        </div>
    );
}

function BackLink({ to, label }: { to: string; label: string }) {
    return (
        <Link
            href={to}
            className="inline-flex items-center gap-1 text-sm font-medium text-slate-600 transition hover:text-amber-600"
        >
            <ChevronLeft className="h-4 w-4" />
            {label}
        </Link>
    );
}

/**
 * 4-step progress strip shown on every step of the booking flow. Reused by
 * each booking-step stub via its own export. Kept inline here for now to
 * keep the file count low while the flow is being scaffolded.
 */
export function StepIndicator({ current }: { current: 1 | 2 | 3 | 4 }) {
    const steps = [
        { n: 1, label: "Basket" },
        { n: 2, label: "Date & time" },
        { n: 3, label: "Address" },
        { n: 4, label: "Review" },
    ];
    return (
        <ol className="mt-6 flex items-center gap-1.5">
            {steps.map((s, i) => {
                const isCurrent = s.n === current;
                const isDone = s.n < current;
                return (
                    <li key={s.n} className="flex flex-1 items-center gap-1.5">
                        <div
                            className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                                isDone
                                    ? "bg-amber-400 text-slate-900"
                                    : isCurrent
                                      ? "bg-slate-900 text-white"
                                      : "bg-slate-200 text-slate-500"
                            }`}
                        >
                            {s.n}
                        </div>
                        <span
                            className={`hidden text-xs font-medium sm:inline ${
                                isCurrent
                                    ? "text-slate-900"
                                    : "text-slate-500"
                            }`}
                        >
                            {s.label}
                        </span>
                        {i < steps.length - 1 && (
                            <div
                                className={`h-px flex-1 ${
                                    isDone ? "bg-amber-400" : "bg-slate-200"
                                }`}
                            />
                        )}
                    </li>
                );
            })}
        </ol>
    );
}
