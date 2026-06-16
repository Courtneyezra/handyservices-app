import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence, useSpring, useTransform, useMotionValue, type PanInfo } from 'framer-motion';

/**
 * /labs/animations — animations.dev-style playground.
 *
 * Self-contained sandbox demonstrating Emil Kowalski's signature techniques
 * using only framer-motion + Tailwind. Each section is independent.
 */

const EASE_OUT = [0.23, 1, 0.32, 1] as const;
const EASE_IN_OUT = [0.77, 0, 0.175, 1] as const;
const EASE_DRAWER = [0.32, 0.72, 0, 1] as const;

export default function AnimationsLab() {
    return (
        <div className="min-h-screen bg-slate-50 text-slate-900 font-sans">
            <div className="max-w-4xl mx-auto px-6 py-16 space-y-24">
                <Header />
                <SleekGuaranteeBlock />
                <EasingComparison />
                <SpringPlayground />
                <DynamicIsland />
                <StaggerMenu />
                <HoldToConfirm />
                <ToastStack />
                <DrawerDemo />
                <Footer />
            </div>
        </div>
    );
}

function Header() {
    return (
        <header className="space-y-3">
            <p className="text-xs font-mono uppercase tracking-widest text-slate-500">labs / animations</p>
            <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight">Animation playground</h1>
            <p className="text-slate-600 max-w-2xl leading-relaxed">
                Hands-on demos of Emil Kowalski-style motion techniques. Every interaction below is
                built with framer-motion + CSS — no extra deps. Tap, drag, hold, hover.
            </p>
        </header>
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// FOCAL: Money-Back Guarantee — sleek navy section, matches the brand
// ─────────────────────────────────────────────────────────────────────────────

const GUARANTEES = [
    {
        headline: 'Our quoted price is the final price.',
        trigger: 'If the final invoice exceeds the quote we issued, the difference is returned in full.',
    },
    {
        headline: 'We leave the site cleaner than we found it.',
        trigger: 'If we fail to do so, your cleanup fee is refunded — no questions asked.',
    },
    {
        headline: 'We stand by our work for thirty days.',
        trigger: 'If any fix fails within thirty days of completion, we return at no further charge.',
    },
] as const;

/** Compact shield icon for the eyebrow pill. */
function ShieldIcon({ className = 'w-3.5 h-3.5' }: { className?: string }) {
    return (
        <svg viewBox="0 0 16 16" fill="none" className={className} aria-hidden>
            <path
                d="M8 1.5 L13.5 3.5 V8 C13.5 11.3 11 13.7 8 14.5 C5 13.7 2.5 11.3 2.5 8 V3.5 L8 1.5 Z"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinejoin="round"
            />
            <path
                d="M5.5 8 L7.2 9.7 L10.7 6.2"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </svg>
    );
}

function SleekGuaranteeBlock() {
    return (
        <Section
            title="Money-Back Guarantee"
            summary="Sleek navy block matching the brand. Vertical numbered sequence with hairlines instead of identical cards. Sans-serif throughout. Brand palette only (navy / green / amber)."
        >
            <div className="relative overflow-hidden rounded-2xl bg-[#1D2D3D] px-6 py-14 sm:px-10 md:px-14 md:py-20">
                {/* Subtle radial accent in the corner — gives the navy depth without competing for attention */}
                <div
                    className="absolute -top-32 -right-32 w-96 h-96 rounded-full pointer-events-none opacity-40"
                    style={{ background: 'radial-gradient(circle, #7DB00E 0%, transparent 60%)', filter: 'blur(60px)' }}
                    aria-hidden
                />

                {/* Header */}
                <motion.div
                    initial={{ opacity: 0, y: 16 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true, margin: '50px' }}
                    transition={{ duration: 0.6, ease: EASE_OUT }}
                    className="relative max-w-2xl"
                >
                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#7DB00E]/10 border border-[#7DB00E]/30 text-[#7DB00E]">
                        <ShieldIcon />
                        <span className="text-[11px] font-bold tracking-[0.18em] uppercase">Money-Back Guarantee</span>
                    </div>
                    <h3 className="mt-6 text-[34px] sm:text-[42px] md:text-[52px] font-extrabold tracking-tight leading-[1.05] text-white">
                        If we fail on any of these,
                        <br />
                        <span className="text-[#7DB00E]">you don't pay.</span>
                    </h3>
                    <p className="mt-5 text-[15px] md:text-[17px] text-slate-400 leading-relaxed max-w-lg">
                        Three guarantees, every job, no quibbling. Backed by cash, not just words.
                    </p>
                </motion.div>

                {/* Numbered guarantees */}
                <ul className="relative mt-12 md:mt-16">
                    {GUARANTEES.map((g, i) => (
                        <motion.li
                            key={i}
                            initial={{ opacity: 0, y: 14 }}
                            whileInView={{ opacity: 1, y: 0 }}
                            viewport={{ once: true, margin: '50px' }}
                            transition={{ duration: 0.55, ease: EASE_OUT, delay: 0.25 + i * 0.07 }}
                            className={`grid grid-cols-[56px_1fr] md:grid-cols-[88px_1fr] gap-x-4 md:gap-x-8 py-6 md:py-8 ${
                                i < GUARANTEES.length - 1 ? 'border-b border-white/10' : ''
                            }`}
                        >
                            <div className="text-[28px] md:text-[36px] font-bold tabular-nums leading-none pt-1 text-[#7DB00E]/70">
                                0{i + 1}
                            </div>
                            <div>
                                <h4 className="text-[19px] md:text-[22px] font-bold leading-snug text-white">
                                    {g.headline}
                                </h4>
                                <p className="mt-2 text-[14px] md:text-[15px] text-slate-400 leading-relaxed">
                                    {g.trigger}
                                </p>
                            </div>
                        </motion.li>
                    ))}
                </ul>

                {/* Trust footer */}
                <motion.div
                    initial={{ opacity: 0 }}
                    whileInView={{ opacity: 1 }}
                    viewport={{ once: true, margin: '50px' }}
                    transition={{ duration: 0.5, ease: EASE_OUT, delay: 0.65 }}
                    className="relative mt-12 md:mt-14 pt-8 border-t border-white/10 flex flex-wrap items-center justify-center gap-x-6 gap-y-3 text-[12px] text-slate-500"
                >
                    <span className="inline-flex items-center gap-1.5">
                        <span className="w-1 h-1 rounded-full bg-[#7DB00E]" aria-hidden />
                        £2M Public Liability Insured
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                        <span className="w-1 h-1 rounded-full bg-[#7DB00E]" aria-hidden />
                        DBS Checked
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                        <span className="w-1 h-1 rounded-full bg-[#7DB00E]" aria-hidden />
                        4.9★ Google · 127 reviews
                    </span>
                </motion.div>
            </div>
        </Section>
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared section wrapper
// ─────────────────────────────────────────────────────────────────────────────

function Section({ title, summary, children }: { title: string; summary: string; children: React.ReactNode }) {
    return (
        <section className="space-y-4">
            <div className="space-y-1">
                <h2 className="text-2xl font-bold tracking-tight">{title}</h2>
                <p className="text-sm text-slate-600 leading-relaxed">{summary}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">{children}</div>
        </section>
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Easing comparison
// ─────────────────────────────────────────────────────────────────────────────

function EasingComparison() {
    const [playId, setPlayId] = useState(0);
    const curves = [
        { name: 'linear', value: 'linear' as const },
        { name: 'ease', value: 'easeInOut' as const },
        { name: 'ease-out (default)', value: 'easeOut' as const },
        { name: 'Emil ease-out', value: EASE_OUT },
    ];

    return (
        <Section
            title="Easing comparison"
            summary="Same duration, different curves. The built-in CSS easings feel weak — the custom cubic-bezier hits earlier and settles harder. Tap replay."
        >
            <div className="space-y-3">
                {curves.map((c) => (
                    <div key={c.name} className="flex items-center gap-3">
                        <div className="w-32 shrink-0 text-xs font-mono text-slate-500">{c.name}</div>
                        <div className="relative flex-1 h-10 bg-slate-100 rounded-md overflow-hidden">
                            <motion.div
                                key={`${c.name}-${playId}`}
                                initial={{ x: 0 }}
                                animate={{ x: '100%' }}
                                transition={{ duration: 0.9, ease: c.value as any }}
                                className="absolute top-1 left-1 bottom-1 w-8 bg-slate-900 rounded"
                                style={{ x: '-100%' }}
                            />
                        </div>
                    </div>
                ))}
            </div>
            <button
                type="button"
                onClick={() => setPlayId((n) => n + 1)}
                className="mt-6 px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-semibold active:scale-[0.97] transition-transform [transition-timing-function:cubic-bezier(0.23,1,0.32,1)] will-change-transform"
            >
                Replay
            </button>
        </Section>
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Spring playground
// ─────────────────────────────────────────────────────────────────────────────

function SpringPlayground() {
    const presets = [
        { name: 'snappy', stiffness: 400, damping: 30 },
        { name: 'gentle', stiffness: 100, damping: 14 },
        { name: 'bouncy', stiffness: 260, damping: 12 },
        { name: 'wobbly', stiffness: 180, damping: 8 },
    ];
    const [active, setActive] = useState(presets[0]);
    const [trigger, setTrigger] = useState(0);

    return (
        <Section
            title="Spring physics"
            summary="No fixed duration — settling time emerges from stiffness and damping. Drag the card, or pick a preset and tap fling."
        >
            <div className="flex flex-wrap gap-2 mb-6">
                {presets.map((p) => (
                    <button
                        key={p.name}
                        type="button"
                        onClick={() => setActive(p)}
                        className={`px-3 py-1.5 rounded-full text-xs font-mono active:scale-[0.97] transition-[background-color,color,transform] duration-150 [transition-timing-function:cubic-bezier(0.23,1,0.32,1)] ${active.name === p.name ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
                    >
                        {p.name}
                    </button>
                ))}
                <button
                    type="button"
                    onClick={() => setTrigger((n) => n + 1)}
                    className="px-3 py-1.5 rounded-full text-xs font-mono bg-amber-500 text-white active:scale-[0.97] transition-transform [transition-timing-function:cubic-bezier(0.23,1,0.32,1)]"
                >
                    fling →
                </button>
            </div>
            <div className="relative h-32 bg-slate-100 rounded-xl overflow-hidden">
                <motion.div
                    key={trigger}
                    drag
                    dragConstraints={{ left: 0, right: 0, top: 0, bottom: 0 }}
                    dragElastic={0.4}
                    initial={{ x: -100 }}
                    animate={{ x: trigger ? 0 : -100 }}
                    transition={{ type: 'spring', stiffness: active.stiffness, damping: active.damping }}
                    className="absolute top-1/2 left-1/2 -mt-8 -ml-8 w-16 h-16 bg-slate-900 rounded-2xl cursor-grab active:cursor-grabbing shadow-lg"
                />
            </div>
            <div className="mt-3 text-xs font-mono text-slate-500">
                stiffness={active.stiffness} · damping={active.damping}
            </div>
        </Section>
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Dynamic Island — shape-morphing pill
// ─────────────────────────────────────────────────────────────────────────────

type IslandState = 'idle' | 'call' | 'music';

function DynamicIsland() {
    const [state, setState] = useState<IslandState>('idle');

    const variants: Record<IslandState, { width: number; height: number; content: React.ReactNode }> = {
        idle: {
            width: 140,
            height: 36,
            content: <span className="text-xs font-medium text-slate-300">Tap below to cycle</span>,
        },
        call: {
            width: 320,
            height: 64,
            content: (
                <div className="flex items-center justify-between w-full px-4">
                    <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600" />
                        <div className="text-left">
                            <div className="text-xs font-semibold text-white">Alex</div>
                            <div className="text-[10px] text-slate-400">incoming · 0:04</div>
                        </div>
                    </div>
                    <div className="flex gap-2">
                        <span className="w-7 h-7 rounded-full bg-red-500" />
                        <span className="w-7 h-7 rounded-full bg-emerald-500" />
                    </div>
                </div>
            ),
        },
        music: {
            width: 280,
            height: 56,
            content: (
                <div className="flex items-center justify-between w-full px-4">
                    <div className="flex items-center gap-3">
                        <div className="w-7 h-7 rounded bg-gradient-to-br from-amber-300 to-orange-500" />
                        <div className="text-left">
                            <div className="text-xs font-semibold text-white truncate">Rite of Spring</div>
                            <div className="text-[10px] text-slate-400">Stravinsky</div>
                        </div>
                    </div>
                    <div className="flex items-end gap-0.5">
                        {[12, 18, 8, 14].map((h, i) => (
                            <motion.span
                                key={i}
                                animate={{ height: [h, h * 0.4, h] }}
                                transition={{ duration: 0.8, repeat: Infinity, delay: i * 0.12, ease: 'easeInOut' }}
                                className="w-1 bg-amber-300 rounded-full"
                                style={{ height: h }}
                            />
                        ))}
                    </div>
                </div>
            ),
        },
    };

    const next = () => {
        const order: IslandState[] = ['idle', 'call', 'music'];
        setState(order[(order.indexOf(state) + 1) % order.length]);
    };

    return (
        <Section
            title="Dynamic Island"
            summary="A single pill that morphs dimensions and swaps content. layoutId-style transition with a tuned spring; content crossfades through AnimatePresence."
        >
            <div className="flex flex-col items-center gap-6 py-6">
                <motion.div
                    layout
                    transition={{ type: 'spring', stiffness: 400, damping: 32, mass: 0.7 }}
                    style={{ width: variants[state].width, height: variants[state].height }}
                    className="bg-black rounded-full flex items-center justify-center overflow-hidden shadow-2xl"
                >
                    <AnimatePresence mode="wait">
                        <motion.div
                            key={state}
                            initial={{ opacity: 0, filter: 'blur(4px)' }}
                            animate={{ opacity: 1, filter: 'blur(0px)' }}
                            exit={{ opacity: 0, filter: 'blur(4px)' }}
                            transition={{ duration: 0.22, ease: EASE_OUT }}
                            className="w-full h-full flex items-center justify-center"
                        >
                            {variants[state].content}
                        </motion.div>
                    </AnimatePresence>
                </motion.div>

                <button
                    type="button"
                    onClick={next}
                    className="px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-semibold active:scale-[0.97] transition-transform [transition-timing-function:cubic-bezier(0.23,1,0.32,1)]"
                >
                    Cycle state ({state})
                </button>
            </div>
        </Section>
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Stagger menu
// ─────────────────────────────────────────────────────────────────────────────

function StaggerMenu() {
    const [open, setOpen] = useState(false);
    const items = ['Inbox', 'Drafts', 'Sent', 'Archive', 'Spam', 'Trash'];

    return (
        <Section
            title="Stagger reveal"
            summary="Items cascade in with 40ms between each. Strong ease-out + Y-translate makes the entrance feel intentional, not abrupt."
        >
            <div className="flex justify-center">
                <button
                    type="button"
                    onClick={() => setOpen((v) => !v)}
                    className="px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-semibold active:scale-[0.97] transition-transform [transition-timing-function:cubic-bezier(0.23,1,0.32,1)]"
                >
                    {open ? 'Close menu' : 'Open menu'}
                </button>
            </div>

            <AnimatePresence>
                {open && (
                    <motion.ul
                        initial="hidden"
                        animate="show"
                        exit="hidden"
                        variants={{
                            hidden: { transition: { staggerChildren: 0.03, staggerDirection: -1 } },
                            show: { transition: { staggerChildren: 0.04, delayChildren: 0.05 } },
                        }}
                        className="mt-6 max-w-xs mx-auto rounded-xl border border-slate-200 overflow-hidden bg-white"
                    >
                        {items.map((item) => (
                            <motion.li
                                key={item}
                                variants={{
                                    hidden: { opacity: 0, y: -8 },
                                    show: { opacity: 1, y: 0, transition: { duration: 0.3, ease: EASE_OUT } },
                                }}
                                className="px-4 py-3 text-sm border-b border-slate-100 last:border-0 hover:bg-slate-50 cursor-pointer"
                            >
                                {item}
                            </motion.li>
                        ))}
                    </motion.ul>
                )}
            </AnimatePresence>
        </Section>
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Hold-to-confirm
// ─────────────────────────────────────────────────────────────────────────────

function HoldToConfirm() {
    const [holding, setHolding] = useState(false);
    const [confirmed, setConfirmed] = useState(false);
    const timerRef = useRef<number | null>(null);

    const start = () => {
        setHolding(true);
        timerRef.current = window.setTimeout(() => {
            setConfirmed(true);
            setHolding(false);
            window.setTimeout(() => setConfirmed(false), 1800);
        }, 1500);
    };

    const cancel = () => {
        setHolding(false);
        if (timerRef.current) {
            window.clearTimeout(timerRef.current);
            timerRef.current = null;
        }
    };

    return (
        <Section
            title="Hold to confirm"
            summary="Press is slow and deliberate (1.5s linear fill). Release is snappy (200ms ease-out snap-back). Asymmetric timing: slow where you decide, fast where the system responds."
        >
            <div className="flex flex-col items-center gap-4 py-6">
                <button
                    type="button"
                    onPointerDown={start}
                    onPointerUp={cancel}
                    onPointerLeave={cancel}
                    className="relative overflow-hidden w-64 h-14 rounded-xl border border-red-500/30 text-red-600 font-semibold select-none active:scale-[0.98] transition-transform [transition-timing-function:cubic-bezier(0.23,1,0.32,1)]"
                >
                    <span
                        className="absolute inset-0 bg-red-500"
                        style={{
                            clipPath: holding ? 'inset(0 0 0 0)' : 'inset(0 100% 0 0)',
                            transition: holding ? 'clip-path 1.5s linear' : 'clip-path 0.2s cubic-bezier(0.23,1,0.32,1)',
                        }}
                    />
                    <span className="relative z-10" style={{ color: holding ? 'white' : undefined, transition: 'color 0.2s' }}>
                        {confirmed ? '✓ Deleted' : holding ? 'Keep holding…' : 'Hold to delete'}
                    </span>
                </button>
                <p className="text-xs text-slate-500">Release to cancel</p>
            </div>
        </Section>
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. Toast stack (lightweight Sonner-style)
// ─────────────────────────────────────────────────────────────────────────────

type Toast = { id: number; title: string; body?: string };

function ToastStack() {
    const [toasts, setToasts] = useState<Toast[]>([]);
    const counterRef = useRef(0);

    const add = (title: string, body?: string) => {
        const id = ++counterRef.current;
        setToasts((prev) => [...prev, { id, title, body }]);
        window.setTimeout(() => {
            setToasts((prev) => prev.filter((t) => t.id !== id));
        }, 3500);
    };

    return (
        <Section
            title="Toast stack"
            summary="Roll-your-own toast: enter from below with strong ease-out, exit with a sharper curve, stack offsets via CSS transition (interruptible). Auto-dismiss after 3.5s."
        >
            <div className="flex flex-wrap gap-3 justify-center py-4">
                <button
                    type="button"
                    onClick={() => add('Booked', 'Thursday 28th May · 9am')}
                    className="px-4 py-2 rounded-lg bg-emerald-500 text-white text-sm font-semibold active:scale-[0.97] transition-transform [transition-timing-function:cubic-bezier(0.23,1,0.32,1)]"
                >
                    Booked
                </button>
                <button
                    type="button"
                    onClick={() => add('Saved', 'Quote saved to your dashboard')}
                    className="px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-semibold active:scale-[0.97] transition-transform [transition-timing-function:cubic-bezier(0.23,1,0.32,1)]"
                >
                    Saved
                </button>
                <button
                    type="button"
                    onClick={() => add('Error', 'Payment was declined')}
                    className="px-4 py-2 rounded-lg bg-red-500 text-white text-sm font-semibold active:scale-[0.97] transition-transform [transition-timing-function:cubic-bezier(0.23,1,0.32,1)]"
                >
                    Error
                </button>
            </div>

            <div className="fixed bottom-4 right-4 z-50 flex flex-col-reverse gap-2 pointer-events-none">
                <AnimatePresence initial={false}>
                    {toasts.map((t, i) => (
                        <motion.div
                            key={t.id}
                            initial={{ opacity: 0, y: 32, scale: 0.95 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: 16, scale: 0.95, transition: { duration: 0.2, ease: EASE_OUT } }}
                            transition={{ duration: 0.35, ease: EASE_OUT }}
                            layout
                            className="pointer-events-auto w-72 bg-white border border-slate-200 rounded-xl px-4 py-3 shadow-lg"
                        >
                            <div className="text-sm font-semibold text-slate-900">{t.title}</div>
                            {t.body && <div className="text-xs text-slate-500 mt-0.5">{t.body}</div>}
                        </motion.div>
                    ))}
                </AnimatePresence>
            </div>
        </Section>
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. Bottom drawer (lightweight Vaul-style)
// ─────────────────────────────────────────────────────────────────────────────

function DrawerDemo() {
    const [open, setOpen] = useState(false);
    const y = useMotionValue(0);
    const dragStartRef = useRef<number>(0);

    const handleDragEnd = (_: any, info: PanInfo) => {
        const elapsed = Date.now() - dragStartRef.current;
        const velocity = info.offset.y / Math.max(elapsed, 1);
        if (info.offset.y > 160 || velocity > 0.5) {
            setOpen(false);
        } else {
            // animate back to 0
            y.set(0);
        }
    };

    return (
        <Section
            title="Bottom drawer"
            summary="Drag down to dismiss — momentum-based, not just threshold-based. A quick flick dismisses even without traveling far. Spring slides up with iOS-like ease-drawer curve."
        >
            <div className="flex justify-center py-4">
                <button
                    type="button"
                    onClick={() => setOpen(true)}
                    className="px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-semibold active:scale-[0.97] transition-transform [transition-timing-function:cubic-bezier(0.23,1,0.32,1)]"
                >
                    Open drawer
                </button>
            </div>

            <AnimatePresence>
                {open && (
                    <>
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.25, ease: EASE_OUT }}
                            onClick={() => setOpen(false)}
                            className="fixed inset-0 bg-black/40 z-40"
                        />
                        <motion.div
                            initial={{ y: '100%' }}
                            animate={{ y: 0 }}
                            exit={{ y: '100%' }}
                            transition={{ duration: 0.42, ease: EASE_DRAWER }}
                            drag="y"
                            dragConstraints={{ top: 0, bottom: 0 }}
                            dragElastic={{ top: 0, bottom: 0.6 }}
                            onDragStart={() => { dragStartRef.current = Date.now(); }}
                            onDragEnd={handleDragEnd}
                            style={{ y }}
                            className="fixed left-1/2 -translate-x-1/2 bottom-0 z-50 w-full max-w-md bg-white rounded-t-3xl shadow-2xl p-6 pb-10"
                        >
                            <div className="mx-auto w-12 h-1.5 bg-slate-300 rounded-full mb-6" />
                            <h3 className="text-xl font-bold mb-2">Pick a date</h3>
                            <p className="text-sm text-slate-600 mb-4">Drag down to dismiss. A fast flick works too.</p>
                            <div className="grid grid-cols-4 gap-2">
                                {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun', 'Mon'].map((d, i) => (
                                    <button
                                        key={i}
                                        type="button"
                                        className="aspect-square rounded-xl border border-slate-200 text-sm font-semibold text-slate-700 active:scale-[0.95] transition-transform [transition-timing-function:cubic-bezier(0.23,1,0.32,1)] hover:bg-slate-50"
                                    >
                                        <div className="text-xs text-slate-400">{d}</div>
                                        <div>{20 + i}</div>
                                    </button>
                                ))}
                            </div>
                        </motion.div>
                    </>
                )}
            </AnimatePresence>
        </Section>
    );
}

function Footer() {
    return (
        <footer className="text-center text-xs text-slate-500 pt-12 pb-4 space-y-1">
            <p>Inspired by <a href="https://animations.dev" target="_blank" rel="noreferrer" className="underline">animations.dev</a> by Emil Kowalski.</p>
            <p className="font-mono">/labs/animations</p>
        </footer>
    );
}
