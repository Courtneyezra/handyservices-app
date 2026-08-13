import { motion } from "framer-motion";
import { Check, ShieldCheck, Camera, FileCheck, Star, Clock, Award, Quote } from "lucide-react";
import { WistiaFacade } from "@/components/quote/WistiaFacade";
import { resolveQuoteSkin } from "@/lib/quote-skin";

/**
 * Visit-tailored copies of the contextual quote page's Value sections.
 *
 * Deliberately self-contained — they reuse the contextual page's *look* (dark
 * navy hero, #7DB00E green, #1D2D3D guarantee band, white proof) but carry
 * visit copy and depend on nothing inside the live PersonalizedQuotePage, so
 * the revenue page is never touched. A diagnostic visit's story differs from a
 * priced job's, so divergence here is intentional.
 */

const POSTCODE_CITIES: Record<string, string> = {
    NG: "Nottingham", DE: "Derby", LE: "Leicester", S: "Sheffield", B: "Birmingham",
    M: "Manchester", L: "Liverpool", LS: "Leeds", BS: "Bristol", CV: "Coventry",
    NE: "Newcastle", OX: "Oxford", CB: "Cambridge", PE: "Peterborough", MK: "Milton Keynes",
};

function locationFrom(quote: any): string {
    const address = (quote?.address || "").toLowerCase();
    if (address.includes("nottingham")) return "Nottingham";
    if (address.includes("derby")) return "Derby";
    const area = (quote?.postcode || "").toUpperCase().match(/^[A-Z]{1,2}/)?.[0] || "";
    return POSTCODE_CITIES[area] || "your area";
}

// ─────────────────────────────────────────────────────────────────────────────
// HERO
// ─────────────────────────────────────────────────────────────────────────────
export function VisitHero({ quote }: { quote: any }) {
    const customerFirst = (quote?.customerName || "").split(" ")[0];
    // Skin the visit page with the assigned contractor (Craig-first fallback) —
    // a real face + name + rating makes it feel handled by a person, not a form.
    // Reuses the same resolver as the contextual quote page; `quote.skin` is
    // already enriched by the shared GET endpoint. Kept compact (no full-screen
    // theatre) — the WhatsApp message already carried the "why a visit".
    const skin = resolveQuoteSkin(quote?.skin, quote?.vertical);
    const skinFirst = (skin.name || "").split(/\s+/)[0];
    return (
        <section className="bg-slate-900 px-4 pt-8 pb-4 text-center">
            {/* Contractor face */}
            <div className="relative inline-block mb-4">
                <div className="w-20 h-20 rounded-full overflow-hidden border-[3px] border-[#7DB00E] shadow-xl">
                    <img src={skin.avatarUrl} alt={skin.name} className="w-full h-full object-cover" />
                </div>
                <span className="absolute -bottom-0.5 -right-0.5 w-6 h-6 rounded-full bg-[#7DB00E] flex items-center justify-center ring-4 ring-slate-900">
                    <Check className="w-3.5 h-3.5 text-white" strokeWidth={3.5} />
                </span>
            </div>

            <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#a3d65f]">
                {skin.role || "Your handyman"}
            </div>
            <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight text-white mt-1">
                {skinFirst ? `${skinFirst}'s ready to take a look` : "Book your visit"}
                {customerFirst ? `, ${customerFirst}` : ""}
            </h1>
            <div className="mt-1.5 text-sm text-slate-300 inline-flex items-center gap-1.5">
                <span className="inline-flex items-center gap-1">
                    <Star className="w-4 h-4 text-amber-400 fill-amber-400" />
                    <b className="text-white">{skin.rating}</b>
                </span>
                <span className="text-slate-500">·</span>
                <span>{skin.jobsLabel} completed</span>
            </div>

            <p className="text-slate-400 mt-3 text-sm max-w-md mx-auto leading-relaxed">
                An expert visit, then a fixed quote in writing — your fee comes straight off the job.
            </p>
        </section>
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// GUARANTEE  (the "why a paid visit is risk-free" band)
// ─────────────────────────────────────────────────────────────────────────────
export function VisitGuarantee({ quote }: { quote: any }) {
    const fee = Math.round((quote?.basePrice || 0) / 100);
    const items = [
        { icon: Check, title: "100% credited to the job", body: `Go ahead with the work and your £${fee} comes straight off the final invoice.` },
        { icon: FileCheck, title: "Fixed price, in writing", body: "A firm quote we can legally stand by — no phone guesses, no surprises on the day." },
        { icon: Camera, title: "Photo report of findings", body: "You get a clear write-up of what's wrong and exactly what we recommend." },
        { icon: ShieldCheck, title: "£2M insured · DBS-checked", body: "A vetted, top-rated handyman on your doorstep — not a cowboy chasing a quick buck." },
    ];

    return (
        <section className="bg-[#1D2D3D] py-16 lg:py-24 px-4">
            <div className="max-w-4xl mx-auto">
                <div className="text-center mb-12">
                    <h2 className="text-3xl md:text-4xl font-bold text-white mb-3">Why pay for a quote?</h2>
                    <p className="text-slate-400 max-w-xl mx-auto">
                        Because a free phone quote is a guess. A paid visit is a promise — and it's risk-free.
                    </p>
                </div>
                <div className="grid sm:grid-cols-2 gap-5">
                    {items.map((it, i) => (
                        <motion.div
                            key={i}
                            initial={{ opacity: 0, y: 12 }}
                            whileInView={{ opacity: 1, y: 0 }}
                            viewport={{ once: true, margin: "50px" }}
                            transition={{ duration: 0.5, delay: i * 0.06 }}
                            className="flex gap-4 bg-slate-800/40 border border-slate-700/60 rounded-2xl p-5"
                        >
                            <div className="p-2.5 bg-[#7DB00E]/15 rounded-xl h-fit shrink-0">
                                <it.icon className="w-5 h-5 text-[#7DB00E]" />
                            </div>
                            <div>
                                <h3 className="text-white font-bold mb-1">{it.title}</h3>
                                <p className="text-slate-400 text-sm leading-relaxed">{it.body}</p>
                            </div>
                        </motion.div>
                    ))}
                </div>
            </div>
        </section>
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// SOCIAL PROOF
// ─────────────────────────────────────────────────────────────────────────────
export function VisitProof({ quote }: { quote: any }) {
    const location = locationFrom(quote);
    const stats = [
        { icon: Star, value: "4.9★", label: "Google rating" },
        { icon: Award, value: "2,400+", label: "jobs completed" },
        { icon: Clock, value: "12 yrs", label: "on the tools" },
    ];

    return (
        <section className="bg-white text-slate-900 py-16 lg:py-24 px-4">
            <div className="max-w-4xl mx-auto">
                <div className="text-center mb-12">
                    <div className="flex items-center justify-center gap-1.5 mb-4 text-[13px] font-semibold uppercase tracking-wider text-slate-500">
                        <Star className="w-4 h-4 fill-[#7DB00E] text-[#7DB00E]" />
                        <span><span className="text-[#1D2D3D]">4.9</span> · 300+ Google reviews</span>
                    </div>
                    <h2 className="text-3xl md:text-5xl font-bold text-[#1D2D3D] tracking-tight leading-[1.08]">
                        Trusted by {location} <span className="text-[#7DB00E]">homeowners</span>
                    </h2>
                </div>

                {/* Social-proof video — same click-to-play facade as the contextual quote page */}
                <div className="relative aspect-video rounded-2xl overflow-hidden bg-slate-900 shadow-xl mb-12 border-4 border-white/50 ring-1 ring-slate-900/10 max-w-2xl mx-auto">
                    <WistiaFacade
                        mediaId="z6vtl8u04e"
                        aspect="1.3333333333333333"
                        posterUrl="https://embed-ssl.wistia.com/deliveries/925b06d85de10fd26fe76b778fdf4fa5.jpg?image_crop_resized=1280x720"
                        previewVideoUrl="https://embed-ssl.wistia.com/deliveries/cd008e0d9fb4b1c9bcd105067c3433b0bac32310.mp4"
                    />
                </div>

                <div className="flex justify-center gap-8 md:gap-14 mb-12">
                    {stats.map((s, i) => (
                        <motion.div
                            key={i}
                            className="text-center"
                            initial={{ opacity: 0, y: 12 }}
                            whileInView={{ opacity: 1, y: 0 }}
                            viewport={{ once: true, margin: "50px" }}
                            transition={{ duration: 0.5, delay: i * 0.06 }}
                        >
                            <div className="flex justify-center mb-2">
                                <div className="p-2 bg-[#7DB00E]/10 rounded-full">
                                    <s.icon className="w-5 h-5 text-[#7DB00E]" />
                                </div>
                            </div>
                            <div className="text-2xl md:text-3xl font-black text-[#1D2D3D]">{s.value}</div>
                            <div className="text-xs text-slate-500 mt-1">{s.label}</div>
                        </motion.div>
                    ))}
                </div>

                <div className="max-w-lg mx-auto bg-slate-50 border border-slate-200 rounded-2xl p-6">
                    <Quote className="w-7 h-7 text-[#7DB00E] mb-3" />
                    <p className="text-slate-700 leading-relaxed mb-4">
                        Booked a visit because three others just quoted me blind over the phone. He turned up on time,
                        found the actual problem, and the written price didn't budge. Worth every penny.
                    </p>
                    <div className="flex items-center gap-1 text-[#7DB00E]">
                        {Array.from({ length: 5 }).map((_, i) => (
                            <Star key={i} className="w-4 h-4 fill-current" />
                        ))}
                        <span className="text-sm text-slate-500 ml-2">Verified Google review</span>
                    </div>
                </div>
            </div>
        </section>
    );
}
