import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { MessageCircle, X, ScanLine } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";

/**
 * Exit-intent "just want to chat?" popup for the landing pages.
 *
 * Adapted from the contextual-quote irresistible-offer screen (the `at_home`
 * template — warm slate-50 card, navy editorial headline with a hand-drawn
 * underline, green pill CTA). Reframed as a low-pressure off-ramp: instead of
 * pushing a quote, it offers a direct WhatsApp line to a real handyman for the
 * visitor who's about to bounce.
 *
 * Two ways into the same WhatsApp chat, so the right one is always to hand:
 *   • a scannable QR (desktop visitor scans with their phone) — the hero on wide
 *     screens, where a wa.me tap can't open the phone app
 *   • a tap-to-open button (mobile visitor opens WhatsApp directly)
 * Both encode the same wa.me URL + prefilled message.
 *
 * Trigger = exit-intent, once per session:
 *   • desktop — cursor leaves the top edge of the viewport (tab/close intent)
 *   • mobile  — a fast upward fling after scrolling down (back-button reach)
 * Armed after a short grace period so it never fires on initial load.
 */

const HS_GREEN_DARK = "#5a8209";
const HS_NAVY = "#0f172a";
const WHATSAPP_GREEN = "#25D366";
const navy = (a: number) => `rgba(15,23,42,${a})`;

// Hand-drawn underline (brand green) — same flourish as the at_home offer.
const HAND_UNDERLINE =
  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='120' height='12' viewBox='0 0 120 12'><path d='M2 8 C 30 2, 70 2, 118 7' stroke='%237DB00E' stroke-width='4' fill='none' stroke-linecap='round'/></svg>\")";

const SESSION_KEY = "hs_chat_popup_seen";

interface ChatHandymanPopupProps {
    /** WhatsApp number in wa.me format (digits only). */
    whatsappPhone?: string;
    /** Fired with a source string on open / CTA / dismiss for analytics. */
    onConversion?: (source: string) => void;
    /** Disable the popup entirely (e.g. behind a flag). */
    enabled?: boolean;
}

export function ChatHandymanPopup({
    whatsappPhone = "447508744402",
    onConversion,
    enabled = true,
}: ChatHandymanPopupProps) {
    const [open, setOpen] = useState(false);
    const firedRef = useRef(false);

    const waUrl = `https://wa.me/${whatsappPhone}?text=${encodeURIComponent("Hi, I just have a quick question about your handyman service")}`;

    useEffect(() => {
        if (!enabled) return;
        if (typeof window === "undefined") return;
        if (sessionStorage.getItem(SESSION_KEY)) return;

        let armed = false;
        const armTimer = window.setTimeout(() => { armed = true; }, 3000);

        const fire = () => {
            if (firedRef.current || !armed) return;
            firedRef.current = true;
            sessionStorage.setItem(SESSION_KEY, "1");
            setOpen(true);
            onConversion?.("chat_popup_shown");
            cleanup();
        };

        // Desktop: cursor exits the top edge of the viewport.
        const onMouseOut = (e: MouseEvent) => {
            if (e.clientY <= 0 && !e.relatedTarget) fire();
        };

        // Mobile: a fast upward fling (toward the back button) after the visitor
        // has scrolled into the page. Velocity-gated so ordinary scrolling
        // doesn't trip it.
        let lastY = window.scrollY;
        let lastT = Date.now();
        const onScroll = () => {
            const y = window.scrollY;
            const t = Date.now();
            const dy = y - lastY;
            const dt = t - lastT || 1;
            const velocity = dy / dt; // px per ms; negative = scrolling up
            if (y > 300 && velocity < -1.2) fire();
            lastY = y;
            lastT = t;
        };

        const cleanup = () => {
            document.removeEventListener("mouseout", onMouseOut);
            window.removeEventListener("scroll", onScroll);
            window.clearTimeout(armTimer);
        };

        document.addEventListener("mouseout", onMouseOut);
        window.addEventListener("scroll", onScroll, { passive: true });
        return cleanup;
    }, [enabled, onConversion]);

    const close = (source: string) => {
        onConversion?.(source);
        setOpen(false);
    };

    return (
        <AnimatePresence>
            {open && (
                <motion.div
                    className="fixed inset-0 z-[10000] flex items-center justify-center px-4 py-6"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.25 }}
                >
                    {/* Backdrop — tap to dismiss */}
                    <div
                        className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
                        onClick={() => close("chat_popup_backdrop")}
                        aria-hidden="true"
                    />

                    <motion.div
                        role="dialog"
                        aria-modal="true"
                        aria-label="Chat with a handyman"
                        initial={{ y: 24, opacity: 0, scale: 0.96 }}
                        animate={{ y: 0, opacity: 1, scale: 1 }}
                        exit={{ y: 24, opacity: 0, scale: 0.96 }}
                        transition={{ duration: 0.35, ease: [0.23, 1, 0.32, 1] }}
                        className="relative w-full max-w-md sm:max-w-2xl max-h-[92vh] overflow-y-auto bg-slate-50 rounded-3xl shadow-2xl font-sans antialiased"
                        style={{ color: HS_NAVY }}
                    >
                        <style>{`
                            .hs-cp-underline { background-image: ${HAND_UNDERLINE}; background-repeat: no-repeat; background-position: bottom left; background-size: 100% 10px; padding-bottom: 6px; white-space: nowrap; }
                        `}</style>

                        {/* Close */}
                        <button
                            onClick={() => close("chat_popup_close")}
                            aria-label="Close"
                            className="absolute top-4 right-4 z-10 w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-200/70 transition-colors"
                        >
                            <X className="w-5 h-5" strokeWidth={2.5} />
                        </button>

                        {/* Split layout: copy + actions on the left, QR on the right.
                            Stacks to a single column on mobile. */}
                        <div className="grid sm:grid-cols-[1fr_auto]">
                            {/* Left — copy + tap CTA */}
                            <div className="px-6 pt-7 pb-6 sm:px-8 sm:py-9">
                                {/* Ben — a real face makes "chat with a handyman" concrete */}
                                <div className="flex items-center gap-3 mb-5">
                                    <div className="relative shrink-0">
                                        <div className="w-12 h-12 rounded-full overflow-hidden border-2 border-[#7DB00E]">
                                            <img src="/assets/quote-images/ben-estimator.webp" alt="Ben" className="w-full h-full object-cover" />
                                        </div>
                                        <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-[#7DB00E] ring-2 ring-slate-50" aria-hidden="true" />
                                    </div>
                                    <div className="leading-tight">
                                        <p className="text-[15px] font-extrabold" style={{ color: HS_NAVY }}>Ben</p>
                                        <p className="text-[12px] font-semibold" style={{ color: navy(0.5) }}>Handyman · usually replies in minutes</p>
                                    </div>
                                </div>

                                <p className="text-[12px] font-bold uppercase tracking-[0.16em] mb-2" style={{ color: HS_GREEN_DARK }}>
                                    Before you go
                                </p>

                                <h2 className="text-[1.9rem] sm:text-[2.1rem] leading-[1.07] font-extrabold tracking-tight" style={{ color: HS_NAVY }}>
                                    Just want to{" "}
                                    <span className="hs-cp-underline" style={{ color: HS_GREEN_DARK }}>chat</span>{" "}
                                    with a handyman?
                                </h2>

                                <p className="mt-4 text-[15px] leading-relaxed" style={{ color: navy(0.7) }}>
                                    No forms, no commitment. Message us on WhatsApp and ask
                                    anything — we'll point you in the right direction.
                                </p>

                                <div className="mt-6 space-y-3">
                                    <a
                                        href={waUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        onClick={() => close("chat_popup_whatsapp")}
                                        className="w-full inline-flex items-center justify-center gap-2.5 rounded-full px-6 py-4 text-base font-extrabold text-white shadow-lg transition-transform active:scale-[0.98]"
                                        style={{ backgroundColor: WHATSAPP_GREEN, boxShadow: "0 10px 25px -5px rgba(37,211,102,0.4)" }}
                                    >
                                        <MessageCircle className="w-5 h-5" strokeWidth={2.6} />
                                        Chat on WhatsApp
                                    </a>
                                    <button
                                        onClick={() => close("chat_popup_decline")}
                                        className="w-full text-center text-sm font-semibold py-1 underline underline-offset-4"
                                        style={{ color: navy(0.5), textDecorationColor: navy(0.2) }}
                                    >
                                        No, I'm just looking
                                    </button>
                                </div>
                            </div>

                            {/* Right — QR panel. Brand-green wash; the QR sits on a
                                white tile for maximum scan contrast. On mobile it
                                drops below the CTA as a slim "or scan" strip. */}
                            <div
                                className="flex flex-row sm:flex-col items-center justify-center gap-4 px-6 py-5 sm:px-8 sm:py-9 border-t sm:border-t-0 sm:border-l border-slate-200"
                                style={{ backgroundColor: "rgba(125,176,14,0.06)" }}
                            >
                                <div className="rounded-2xl bg-white p-3 shadow-md border border-slate-200 shrink-0">
                                    <QRCodeSVG
                                        value={waUrl}
                                        size={132}
                                        level="M"
                                        marginSize={0}
                                        fgColor={HS_NAVY}
                                        bgColor="#ffffff"
                                        className="block w-[108px] h-[108px] sm:w-[132px] sm:h-[132px]"
                                    />
                                </div>
                                <div className="text-left sm:text-center max-w-[180px]">
                                    <div className="inline-flex items-center gap-1.5 text-[13px] font-extrabold" style={{ color: HS_NAVY }}>
                                        <ScanLine className="w-4 h-4" strokeWidth={2.5} style={{ color: HS_GREEN_DARK }} />
                                        Scan to chat
                                    </div>
                                    <p className="mt-1 text-[12px] leading-snug font-medium" style={{ color: navy(0.55) }}>
                                        Point your phone camera here to open WhatsApp
                                    </p>
                                </div>
                            </div>
                        </div>

                        {/* Trust strip — full width along the bottom */}
                        <div className="flex items-center justify-center gap-2 text-[11px] font-semibold px-6 pb-6 sm:pb-5" style={{ color: navy(0.55) }}>
                            <span>£2M insured</span>
                            <span style={{ color: navy(0.25) }}>•</span>
                            <span>4.9★ Google (127)</span>
                            <span style={{ color: navy(0.25) }}>•</span>
                            <span>12-mo guarantee</span>
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
