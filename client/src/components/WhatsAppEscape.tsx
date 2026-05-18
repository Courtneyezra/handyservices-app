/**
 * WhatsAppEscape — the empathetic-path escape hatch for /v2 + booking flow.
 *
 * The /v2 funnel is tuned for decisive buyers (clean SKU grid, fast checkout,
 * full payment upfront). Customers who land unsure of what they need — or
 * with an unusual situation — get routed to the existing WhatsApp flow,
 * which is staffed by humans who can handle nuance.
 *
 * Two variants:
 *   - `<WhatsAppEscapeBlock />` — full-width primary callout, used on /v2
 *     above the service grid. Big enough to be the second-most-prominent
 *     thing on the landing page after the hero, but visually distinct from
 *     the amber transactional CTA (slate background + green WhatsApp tile).
 *   - `<WhatsAppEscapeLink step="..." />` — small inline link rendered at
 *     the bottom of each booking step (basket, date, address, review). One
 *     tap → WhatsApp deep link with a step-contextualised message.
 *
 * Both fire `v2_whatsapp_escape` PostHog event with `{ step, variant, city }`
 * so we can measure how often / from where uncertain users bail. High exit
 * rate from a particular step = friction worth designing around.
 */

import { trackEvent as posthogTrack } from "@/lib/posthog";

/** Same number used by `LandingHeader` and `HandymanLanding` — keep in sync. */
const WHATSAPP_NUMBER = "447508744402";

/** Read variant + city from the in-progress booking record so we can tag the
 *  PostHog event with the same split-test context the rest of the funnel uses. */
function readVariantContext(): { variant: string; city: string } {
    if (typeof window === "undefined")
        return { variant: "v2-nottingham", city: "nottingham" };
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

/** Step-contextualised opening messages — gives the WhatsApp agent immediate
 *  context for where the customer dropped out of the funnel. */
const STEP_MESSAGES: Record<string, string> = {
    landing:
        "Hi, I'm not sure exactly what I need — can you help me work it out?",
    "below-catalog":
        "Hi, I scrolled through the services but couldn't find what I need — can you help?",
    basket: "Hi, I've got a few things in my basket but I'd like to chat first.",
    "big-job":
        "Hi, my basket is bigger than usual — can you help me scope and lock in the booking?",
    date: "Hi, I'm picking a date for a booking and could use some advice.",
    address: "Hi, I'm at the address step of a booking and have a question.",
    review:
        "Hi, I'm about to confirm a booking but want to double-check something first.",
    generic: "Hi, I'd like to chat about what I need before booking.",
};

type Step = keyof typeof STEP_MESSAGES;

function whatsappHref(step: Step): string {
    const text = encodeURIComponent(STEP_MESSAGES[step] ?? STEP_MESSAGES.generic);
    return `https://wa.me/${WHATSAPP_NUMBER}?text=${text}`;
}

function handleClick(step: Step) {
    const ctx = readVariantContext();
    posthogTrack("v2_whatsapp_escape", { ...ctx, step });
}

/**
 * Prominent landing-page block. Sits above the service grid so undecided
 * users see it before they have to commit to picking a category. Slate-900
 * background to differentiate from the amber transactional CTAs — this is
 * a *different* kind of action.
 */
export function WhatsAppEscapeBlock() {
    return (
        <a
            href={whatsappHref("landing")}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => handleClick("landing")}
            className="group mb-6 flex items-center gap-4 rounded-2xl border border-slate-200 bg-slate-900 p-4 text-white shadow-md transition hover:bg-slate-800 active:scale-[0.99] lg:p-5"
            data-testid="v2-whatsapp-escape-block"
        >
            {/* WhatsApp green tile, matches the brand-recognisable colour */}
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[#25D366] text-white shadow-sm">
                <WhatsAppIcon className="h-6 w-6" />
            </span>
            <div className="min-w-0 flex-1">
                <p className="text-sm font-bold leading-tight lg:text-base">
                    Not sure what you need?
                </p>
                <p className="mt-1 text-xs leading-snug text-slate-300 lg:text-sm">
                    Tell us what&apos;s going on and we&apos;ll work it out
                    with you on WhatsApp — quotes back within minutes.
                </p>
            </div>
            <svg
                className="h-5 w-5 shrink-0 text-slate-400 transition group-hover:translate-x-0.5 group-hover:text-white"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
            >
                <path d="M9 18l6-6-6-6" />
            </svg>
        </a>
    );
}

/**
 * Subtle inline link rendered at the bottom of each booking step. Single line,
 * left-aligned, doesn't compete with the primary CTA. Step-aware message
 * preloads context so the WhatsApp agent doesn't have to ask "where were you?"
 */
export function WhatsAppEscapeLink({ step }: { step: Step }) {
    return (
        <div className="mt-6 flex items-center justify-center">
            <a
                href={whatsappHref(step)}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => handleClick(step)}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 underline-offset-4 transition hover:text-emerald-600 hover:underline"
                data-testid={`v2-whatsapp-escape-link-${step}`}
            >
                <WhatsAppIcon className="h-3.5 w-3.5 text-[#25D366]" />
                Stuck? Chat with us on WhatsApp
            </a>
        </div>
    );
}

/**
 * Quiet footer link — placed BELOW the full service catalog on /v2. Decisive
 * users scroll past it on their way to ADD; users who reached the bottom of
 * the catalog without finding their fit see a discreet escape hatch.
 *
 * Deliberately under-styled vs. the slate-900 block — by the time the user
 * has seen everything we offer, they don't need to be sold on WhatsApp, just
 * told it exists.
 */
export function WhatsAppEscapeFooter() {
    return (
        <div className="mt-8 flex flex-col items-center gap-2 border-t border-slate-100 py-8 text-center">
            <p className="text-sm font-medium text-slate-600">
                Didn&apos;t find what you need?
            </p>
            <a
                href={whatsappHref("below-catalog")}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => handleClick("below-catalog")}
                className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-900 underline-offset-4 transition hover:text-emerald-700 hover:underline"
                data-testid="v2-whatsapp-escape-footer"
            >
                <WhatsAppIcon className="h-4 w-4 text-[#25D366]" />
                Tell us what you need on WhatsApp
                <span aria-hidden>→</span>
            </a>
        </div>
    );
}

/**
 * Threshold-triggered "Big job?" banner — only renders when the basket
 * subtotal crosses £150. High-value baskets are where the cost of letting
 * the customer self-serve a wrong configuration outweighs the cost of a
 * human conversation: bigger jobs need more scoping, more material lead
 * time, and the customer hesitation is real.
 *
 * Below the threshold, returns null and disappears from the DOM entirely —
 * we don't want every £25 30-min booking to see "talk to us instead?".
 */
const BIG_JOB_THRESHOLD = 150;

export function WhatsAppEscapeBigJob({ subtotal }: { subtotal: number }) {
    if (subtotal < BIG_JOB_THRESHOLD) return null;
    return (
        <a
            href={whatsappHref("big-job")}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => handleClick("big-job")}
            className="group mt-4 flex items-start gap-3 rounded-2xl border-2 border-amber-400/40 bg-amber-50 p-4 transition hover:border-amber-400/70 hover:bg-amber-100/60 active:scale-[0.99] lg:p-5"
            data-testid="v2-whatsapp-escape-big-job"
        >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#25D366] text-white shadow-sm">
                <WhatsAppIcon className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
                <p className="text-sm font-bold leading-tight text-slate-900">
                    Bigger job?
                </p>
                <p className="mt-1 text-xs leading-snug text-slate-700 lg:text-sm">
                    Orders this size are often easier to scope over a quick
                    chat — we&apos;ll confirm scheduling, materials, and a
                    fixed price before you commit.{" "}
                    <span className="font-semibold text-emerald-700 underline-offset-2 group-hover:underline">
                        Chat on WhatsApp →
                    </span>
                </p>
            </div>
        </a>
    );
}

/** Inline SVG WhatsApp glyph — avoids adding the react-icons dep to this file. */
function WhatsAppIcon({ className }: { className?: string }) {
    return (
        <svg
            className={className}
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden
        >
            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893A11.821 11.821 0 0020.464 3.488" />
        </svg>
    );
}
