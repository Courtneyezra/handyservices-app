import { useState, useEffect, useRef } from "react";
import { Phone, Star, Wrench, Paintbrush, Hammer, Droplets, Shield, Clock, CheckCircle, ArrowRight, AlertCircle, Package, Play } from "lucide-react";
import { WistiaFacade } from "@/components/quote/WistiaFacade";
import { Button } from "@/components/ui/button";
import { SiWhatsapp, SiGoogle } from "react-icons/si";
import { IntakeHero } from "@/components/IntakeHero";
import { GoogleReviewsSection } from "@/components/GoogleReviewsSection";
import { StickyCTA } from "@/components/StickyCTA";
import { ChatHandymanPopup } from "@/components/ChatHandymanPopup";
import { LocalTrustSection } from "@/components/AnimatedMap";
import { SegmentSwitcher } from "@/components/SegmentSwitcher";
import { PropertyManagerView } from "@/components/PropertyManagerView";
import { BusinessView } from "@/components/BusinessView";
import { HassleComparisonSection } from "@/components/HassleComparisonSection";
import { LandingHeader } from "@/components/LandingHeader";

import heroImage from "@assets/f7550ab2-8282-4cf6-b2af-83496eef2eee_1764599750751.webp";
import realJobToilet from "@assets/c33e343a-3b9d-4d85-97cb-a0752ea3e80d_1764687156907.webp";
import realJobPainting from "@assets/97e1a436-81fd-44d2-8b08-ce5a374c9c4b_1764687156908.webp";
import realJobSink from "@assets/cf7cd976-8854-4abb-a7dd-391a08c63978_1764687156908.webp";
import realJobShelf from "@assets/c2f4951d-baa5-4a9f-8b4e-233fa5fcb49c_1764687156908.webp";
import realJobKitchen from "@assets/4cc2f0fa-125e-412b-9929-4e03a055b760_1764687156909.webp";
import realJobBlinds from "@assets/528c52d4-f8ff-4e5b-9853-b68263a62c2f_1764694548068.webp";
import beforeImage from "@assets/74cb4082-17d2-48b1-bd98-bf51f85bc7a5_(1)_1764694445995.webp";
import afterImage from "@assets/cb5e8951-9d46-4023-9909-510a89d3da60_1764693845208.webp";
import { useLandingPage } from "@/hooks/useLandingPage";
import {
    registerSuperProperties as posthogRegister,
    trackEvent as posthogTrack,
} from "@/lib/posthog";

const WHATSAPP_NUMBER = "+447508744402";
const WHATSAPP_MESSAGE = encodeURIComponent("I'm interested in Handy Services - Derby");
const PHONE_NUMBER = "+447449501762";



function TeamSection() {
    // Person-led brand: the SAME real handymen the quote assigns — one consistent
    // cast across the whole journey, and the same team that serves Derby.
    // ⚠️ Ratings / job counts are PLACEHOLDERS pending real profile data (C5).
    const team = [
        { name: "Craig", role: "Lead handyman", img: "/assets/quote-images/craig-banner.webp", meta: "4.9 · 214 jobs completed" },
        { name: "Joe", role: "Handyman & carpenter", img: "/assets/quote-images/joe-estimator.webp", meta: "4.9 · vetted, DBS-checked" },
    ];
    const recentWork = [
        { url: "/assets/quote-images/craig-bathroom.webp", label: "Bathroom reseal" },
        { url: "/assets/quote-images/craig-tiling.webp", label: "Tiling" },
        { url: "/assets/quote-images/craig-light.webp", label: "Light fitting" },
        { url: "/assets/quote-images/craig-flatpack.webp", label: "Flat-pack build" },
    ];

    return (
        <section id="team" className="bg-slate-800 px-4 lg:px-8 py-16 lg:py-24">
            <div className="max-w-6xl mx-auto">
                <div className="text-center mb-10 lg:mb-14">
                    <p className="text-amber-400 font-bold uppercase tracking-[0.14em] text-xs md:text-sm mb-3">Meet your handymen</p>
                    <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold text-white mb-4">
                        The people who <span className="text-amber-400">do your job</span>
                    </h2>
                    <p className="text-white/60 text-lg max-w-2xl mx-auto font-medium">
                        Not a faceless call centre. Real, vetted local pros who turn up when we say and stand behind the work.
                    </p>
                </div>

                {/* The handymen — portrait cards, one per core tech */}
                <div className="grid sm:grid-cols-2 gap-5 lg:gap-8 mb-10 lg:mb-14 max-w-3xl mx-auto">
                    {team.map((m) => (
                        <div key={m.name} className="relative rounded-3xl overflow-hidden shadow-2xl aspect-[4/5]">
                            <img src={m.img} alt={`${m.name}, your Derby handyman`} loading="lazy" decoding="async" className="w-full h-full object-cover" />
                            <div className="absolute inset-0 bg-gradient-to-t from-slate-900/90 via-slate-900/10 to-transparent" />
                            <div className="absolute bottom-0 left-0 right-0 p-5">
                                <div className="text-white text-2xl font-extrabold leading-none">{m.name}</div>
                                <div className="text-amber-400 font-semibold text-sm mt-1">{m.role} · HandyServices</div>
                                <div className="flex items-center gap-1.5 mt-2 text-white/90 text-sm">
                                    <Star className="w-4 h-4 text-amber-400 fill-amber-400" />
                                    <span className="text-white/80">{m.meta}</span>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>

                {/* Shared trust + recent work */}
                <div className="max-w-4xl mx-auto">
                    <div className="flex flex-wrap justify-center gap-2.5 mb-8">
                        {["DBS-checked", "£2M insured", "90-day guarantee"].map((b) => (
                            <span key={b} className="inline-flex items-center gap-1.5 rounded-full bg-slate-700/70 border border-slate-600 px-3.5 py-1.5 text-sm font-medium text-white/90">
                                <CheckCircle className="w-4 h-4 text-amber-400" /> {b}
                            </span>
                        ))}
                    </div>
                    <p className="text-white/50 text-xs font-bold uppercase tracking-wider mb-3 text-center">Recent work</p>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        {recentWork.map((w) => (
                            <div key={w.label} className="relative rounded-xl overflow-hidden aspect-square">
                                <img src={w.url} alt={w.label} loading="lazy" decoding="async" className="w-full h-full object-cover" />
                                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-slate-900/80 to-transparent p-2">
                                    <span className="text-white text-[11px] font-medium leading-tight">{w.label}</span>
                                </div>
                            </div>
                        ))}
                    </div>
                    <p className="text-white/40 text-sm mt-6 text-center">
                        Craig and Joe lead a growing team of vetted local pros. Bigger jobs get the right hands, always DBS-checked and insured.
                    </p>
                </div>
            </div>
        </section>
    );
}

function PainPointsSection() {
    // Customer-supplied pain points — extreme, unmistakable damage. Ties directly
    // to the video-quote mechanic: snap it, priced in minutes. A card becomes a
    // Wistia video (same WistiaFacade the quote page uses) when given a `wistiaId`.
    type MediaCard = { img: string; q?: string; label?: string; wistiaId?: string; previewVideoUrl?: string; aspect?: string };
    const problems: MediaCard[] = [
        { img: "/assets/pain-points/pain-hole.webp", q: "Hole in the wall?" },
        { img: "/assets/pain-points/pain-deck.webp", q: "Decking gone rotten?" },
        { img: "/assets/pain-points/pain-mould.webp", q: "Black mould spreading?" },
        { img: "/assets/pain-points/pain-crack.webp", q: "Cracks in the plaster?" },
        { img: "/assets/pain-points/pain-roof.webp", q: "Flat roof rotting?" },
        { img: "/assets/pain-points/pain-gutter-broken.webp", q: "Gutter hanging off?" },
    ];
    const isVideo = (w?: string) => !!w && !/^(placeholder|todo|xxxx)/i.test(w);
    return (
        <section className="bg-white px-4 lg:px-8 py-16 lg:py-24">
            <div className="max-w-6xl mx-auto">
                <div className="text-center mb-10 lg:mb-14 max-w-2xl mx-auto">
                    <p className="text-amber-500 font-bold uppercase tracking-[0.14em] text-xs md:text-sm mb-3">Send us a photo</p>
                    <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold text-slate-900 leading-[1.1] mb-4">
                        Whatever's up, <span className="text-amber-500">we've sorted it before.</span>
                    </h2>
                    <p className="text-slate-600 text-lg font-medium">
                        These are the real jobs Derby texts us every week. Snap a photo or a quick video and we'll send a fixed price back in minutes.
                    </p>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-3 gap-3 md:gap-5">
                    {problems.map((p) => {
                        const video = isVideo(p.wistiaId);
                        return (
                            <div key={p.q} className="relative rounded-2xl overflow-hidden aspect-square group">
                                {video ? (
                                    <WistiaFacade mediaId={p.wistiaId!} aspect={p.aspect ?? "0.5625"} posterUrl={p.img} previewVideoUrl={p.previewVideoUrl} />
                                ) : (
                                    <img src={p.img} alt={p.q} loading="lazy" decoding="async" className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" />
                                )}
                                <div className="pointer-events-none absolute inset-x-0 bottom-0 p-4 bg-gradient-to-t from-slate-900/85 via-slate-900/10 to-transparent z-10">
                                    <p className="text-white font-bold text-base md:text-lg leading-tight">{p.q}</p>
                                    <span className="inline-flex items-center gap-1 mt-1.5 text-[#a3d65f] text-xs font-bold uppercase tracking-wide">
                                        {video ? (<><Play className="w-3 h-3 fill-current" /> Their video</>) : (<><CheckCircle className="w-3.5 h-3.5" /> We sort it</>)}
                                    </span>
                                </div>
                            </div>
                        );
                    })}
                </div>

                {/* Our latest job — a bold navy case-study panel: the click-to-play
                    showcase reel paired with the job details + CTA. */}
                <div className="mt-14 lg:mt-20 rounded-[28px] bg-[#1D2D3D] overflow-hidden shadow-2xl">
                    <div className="grid lg:grid-cols-2 items-stretch">
                        {/* Video */}
                        <div className="relative aspect-square lg:aspect-auto lg:min-h-[460px] bg-slate-900">
                            <WistiaFacade mediaId="n3dh959arn" aspect="1" posterUrl="/assets/at-work/work-sander.webp" />
                        </div>
                        {/* Case-study copy */}
                        <div className="p-7 sm:p-10 lg:p-12 flex flex-col justify-center">
                            <p className="text-amber-400 font-bold uppercase tracking-[0.14em] text-xs md:text-sm mb-3">Our latest job</p>
                            <h3 className="text-2xl md:text-3xl lg:text-4xl font-bold text-white leading-[1.12] mb-4">
                                A tired floor, <span className="text-amber-400">brought back to life.</span>
                            </h3>
                            <p className="text-white/70 text-base md:text-lg leading-relaxed mb-6">
                                Craig, Joe and the team stripped this period floor back to bare timber and restored it in two days. Whatever your job, big or small, we sort it the same way.
                            </p>
                            <div className="flex flex-wrap gap-2.5 mb-8">
                                {[["Wrench", "Period floor restoration"], ["Clock", "2 days, start to finish"], ["Shield", "Insured & DBS-checked"]].map(([icon, label]) => (
                                    <span key={label} className="inline-flex items-center gap-1.5 rounded-full bg-white/10 border border-white/15 px-3.5 py-1.5 text-sm font-medium text-white/90">
                                        {icon === "Wrench" && <Wrench className="w-4 h-4 text-amber-400" />}
                                        {icon === "Clock" && <Clock className="w-4 h-4 text-amber-400" />}
                                        {icon === "Shield" && <Shield className="w-4 h-4 text-amber-400" />}
                                        {label}
                                    </span>
                                ))}
                            </div>
                            <a href="#hero" className="scroll-smooth">
                                <Button className="w-full sm:w-auto px-9 py-6 bg-amber-400 hover:bg-amber-500 text-slate-900 font-bold rounded-full text-lg" data-testid="button-painpoints-quote">
                                    Get your fixed price
                                    <ArrowRight className="w-5 h-5 ml-2" />
                                </Button>
                            </a>
                            <p className="text-white/40 text-sm mt-3">Photo or video. Fixed price back in minutes.</p>
                        </div>
                    </div>
                </div>
            </div>
        </section>
    );
}

function ProcessSection() {
    const steps = [
        { number: "1", title: "Instant Quote", description: "Get a price in minutes via video or photo", highlight: true },
        { number: "2", title: "Handyman Checks", description: "We confirm availability and requirements", highlight: false },
        { number: "3", title: "Online Booking", description: "Secure your slot with easy online payment", highlight: false },
    ];

    return (
        <section className="bg-slate-700 px-4 lg:px-8 py-16 lg:py-24">
            <div className="max-w-7xl mx-auto">
                <div className="text-center mb-12 lg:mb-16">
                    <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold mb-4">
                        <span className="text-amber-400">Quicker & Faster</span>{" "}
                        <span className="text-white">Handyman Services</span>
                    </h2>
                    <p className="text-white/60 text-lg font-medium">Skip the hassle. Here's how it works.</p>
                </div>

                <div className="grid md:grid-cols-3 gap-6 lg:gap-8">
                    {steps.map((step, idx) => (
                        <div
                            key={idx}
                            className={`relative p-8 lg:p-10 rounded-3xl text-center ${step.highlight ? "bg-amber-400 text-slate-900" : "bg-white text-slate-800"
                                }`}
                        >
                            <div className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-6 text-3xl font-bold ${step.highlight ? "bg-slate-800 text-amber-400" : "bg-slate-100 text-slate-800"
                                }`}>
                                {step.number}
                            </div>
                            <h3 className="text-xl lg:text-2xl font-bold mb-3">{step.title}</h3>
                            <p className={step.highlight ? "text-slate-700" : "text-slate-600"}>{step.description}</p>

                            {idx < steps.length - 1 && (
                                <div className="hidden md:block absolute top-1/2 -right-4 lg:-right-6 transform -translate-y-1/2">
                                    <ArrowRight className="w-8 h-8 text-white/30" />
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            </div>
        </section>
    );
}

function ServicesSection() {
    const services = [
        { name: "Plumbing", price: "£69", description: "Taps, toilets, leaks & more", icon: <Droplets className="w-10 h-10" />, bgColor: "bg-blue-400" },
        { name: "Joinery", price: "£79", description: "Doors, shelving, repairs", icon: <Hammer className="w-10 h-10" />, bgColor: "bg-amber-500" },
        { name: "Decorating", price: "£59", description: "Painting & finishing touches", icon: <Paintbrush className="w-10 h-10" />, bgColor: "bg-green-400" },
        { name: "Mounting", price: "£49", description: "TVs, mirrors, shelves", icon: <Wrench className="w-10 h-10" />, bgColor: "bg-purple-400" },
    ];

    return (
        <section id="services" className="bg-white px-4 lg:px-8 py-16 lg:py-24">
            <div className="max-w-7xl mx-auto">
                <div className="text-center mb-12 lg:mb-16">
                    <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold mb-4">
                        <span className="text-amber-500">Instant Quotes</span>{" "}
                        <span className="text-slate-800">For Big & Small Jobs</span>
                    </h2>
                    <p className="text-slate-600 text-lg font-medium max-w-2xl mx-auto">
                        Send a quick photo or video and we'll price it up in minutes. No waiting in, no call-out fee, a fixed price up front.
                    </p>
                </div>

                <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6 lg:gap-8">
                    {services.map((service, idx) => (
                        <div
                            key={idx}
                            className="bg-slate-800 rounded-3xl p-8 relative group hover:transform hover:scale-105 transition-all duration-300"
                        >
                            <div className={`w-20 h-20 ${service.bgColor} rounded-2xl flex items-center justify-center mx-auto mb-6 text-white shadow-lg`}>
                                {service.icon}
                            </div>
                            <h3 className="text-white font-bold text-xl text-center mb-2">{service.name}</h3>
                            <p className="text-white/60 text-center text-sm mb-4">{service.description}</p>
                            <div className="absolute -bottom-4 left-1/2 -translate-x-1/2 bg-amber-400 text-slate-900 text-sm font-bold px-5 py-2 rounded-full shadow-lg">
                                From {service.price}
                            </div>
                        </div>
                    ))}
                </div>

                <div className="text-center mt-16">
                    <a href="#hero" className="scroll-smooth">
                        <Button
                            className="px-10 py-6 bg-amber-400 hover:bg-amber-500 text-slate-900 font-bold rounded-full text-lg"
                            data-testid="button-services-quote"
                        >
                            Get Your Quote Now
                            <ArrowRight className="w-5 h-5 ml-2" />
                        </Button>
                    </a>
                </div>
            </div>
        </section>
    );
}

function RealJobsSection() {
    const customers = [
        { name: "Sarah", area: "DE1", job: "Bathroom plumbing repair", image: realJobToilet },
        { name: "Mike", area: "DE21", job: "Kitchen painting", image: realJobPainting },
        { name: "Emily", area: "DE23", job: "Sink installation", image: realJobSink },
        { name: "Linda", area: "DE22", job: "Shelving installation", image: realJobShelf },
        { name: "Tom", area: "DE24", job: "Kitchen cabinet fitting", image: realJobKitchen },
        { name: "David", area: "DE3", job: "Blind fitting", image: realJobBlinds },
    ];

    return (
        <section className="bg-slate-800 px-4 lg:px-8 py-16 lg:py-24">
            <div className="max-w-7xl mx-auto">
                <div className="text-center mb-12 lg:mb-16">
                    <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold text-white mb-4">
                        Real Jobs. Real Customers.
                    </h2>
                    <p className="text-white/60 text-lg">See what we've done for Derby homeowners</p>
                </div>

                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
                    {customers.map((customer, idx) => (
                        <div key={idx} className="bg-slate-700 rounded-2xl overflow-hidden group hover:bg-slate-600 transition-colors">
                            <div className="aspect-video bg-slate-600 overflow-hidden">
                                <img
                                    src={customer.image}
                                    alt={`${customer.job} for ${customer.name}`}
                                    loading="lazy"
                                    decoding="async"
                                    className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                                />
                            </div>
                            <div className="p-6">
                                <p className="text-white font-bold text-lg">
                                    {customer.name}, <span className="text-amber-400">{customer.area}</span>
                                </p>
                                <p className="text-white/60 text-sm">{customer.job}</p>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </section>
    );
}

function BeforeAfterSection() {
    return (
        <section className="bg-amber-500 px-4 lg:px-8 py-16 lg:py-24">
            <div className="max-w-7xl mx-auto">
                <div className="text-center mb-12 lg:mb-16">
                    <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold text-slate-900 mb-4">
                        Before & After
                    </h2>
                    <p className="text-slate-700 text-lg">The transformations speak for themselves</p>
                </div>

                <div className="grid lg:grid-cols-2 gap-8">
                    <div className="bg-white rounded-3xl overflow-hidden shadow-xl">
                        <div className="p-6">
                            <span className="inline-block bg-slate-200 text-slate-700 font-bold px-4 py-1 rounded-full text-sm mb-4">Before</span>
                            <div className="aspect-video bg-slate-100 rounded-2xl overflow-hidden">
                                <img
                                    src={beforeImage}
                                    alt="Before - old rusty tap needing replacement"
                                    className="w-full h-full object-contain"
                                />
                            </div>
                        </div>
                    </div>

                    <div className="bg-white rounded-3xl overflow-hidden shadow-xl">
                        <div className="p-6">
                            <span className="inline-block bg-amber-400 text-slate-900 font-bold px-4 py-1 rounded-full text-sm mb-4">After</span>
                            <div className="aspect-video bg-slate-100 rounded-2xl overflow-hidden">
                                <img
                                    src={afterImage}
                                    alt="After - brand new shiny tap installed"
                                    className="w-full h-full object-contain"
                                />
                            </div>
                        </div>
                    </div>
                </div>

                <div className="text-center mt-8">
                    <p className="text-slate-800 italic text-lg">
                        "Jane in DE1 asked us to strip out an old kitchenette and build a new unit with a sink. Two days start to finish, one very happy customer."
                    </p>
                </div>
            </div>
        </section>
    );
}

function GuaranteesSection() {
    const guarantees = [
        { icon: <Clock className="w-7 h-7" />, title: "We turn up when we say", sub: "Or your deposit back, no quibble." },
        { icon: <CheckCircle className="w-7 h-7" />, title: "The price we quote is the price", sub: "Agreed up front. No hidden extras." },
        { icon: <Shield className="w-7 h-7" />, title: "£2M insured, DBS-checked", sub: "A safe, vetted pro in your home." },
        { icon: <Star className="w-7 h-7" />, title: "Not right? We come back free", sub: "90-day guarantee on every job." },
    ];

    return (
        <section className="bg-slate-900 px-4 lg:px-8 py-20 lg:py-28">
            <div className="max-w-5xl mx-auto">
                <div className="mb-12 lg:mb-16 max-w-2xl">
                    <h2 className="text-4xl md:text-5xl lg:text-6xl font-bold text-white leading-[1.05] mb-4">
                        Four promises we <span className="text-amber-400">put in writing.</span>
                    </h2>
                    <p className="text-white/50 text-lg">The reasons 300+ homeowners keep calling us back.</p>
                </div>

                <div className="grid sm:grid-cols-2 gap-x-10 gap-y-10">
                    {guarantees.map((g, idx) => (
                        <div key={idx} className="flex items-start gap-4">
                            <div className="shrink-0 text-amber-400 mt-1">{g.icon}</div>
                            <div>
                                <h3 className="text-white font-bold text-xl md:text-2xl leading-tight mb-1.5">{g.title}</h3>
                                <p className="text-white/55 text-base leading-relaxed">{g.sub}</p>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </section>
    );
}

function FooterCTA() {
    return (
        <section className="bg-slate-800 px-4 lg:px-8 py-16 lg:py-24">
            <div className="max-w-4xl mx-auto text-center">
                <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold text-white mb-6">
                    Ready to get started?
                </h2>
                <p className="text-white/60 text-lg mb-10 max-w-2xl mx-auto">
                    Get your instant quote in minutes, not days. Join hundreds of satisfied Derby homeowners.
                </p>

                <div className="flex flex-col sm:flex-row gap-4 justify-center mb-12">
                    <a href="#hero" className="scroll-smooth">
                        <Button
                            className="w-full sm:w-auto px-10 py-6 bg-amber-400 hover:bg-amber-500 text-slate-900 font-bold rounded-full text-lg"
                            data-testid="button-footer-quote"
                        >
                            Get Instant Quote
                            <ArrowRight className="w-5 h-5 ml-2" />
                        </Button>
                    </a>

                    <a
                        href={`https://wa.me/${WHATSAPP_NUMBER.replace('+', '')}?text=${WHATSAPP_MESSAGE}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex lg:hidden items-center justify-center gap-2 w-full sm:w-auto px-10 py-4 bg-green-500 hover:bg-green-600 text-white font-bold rounded-full text-lg transition-colors"
                        data-testid="button-footer-whatsapp"
                    >
                        <SiWhatsapp className="w-6 h-6" />
                        Chat on WhatsApp
                    </a>

                    <a
                        href={`tel:${PHONE_NUMBER}`}
                        className="flex items-center justify-center gap-2 w-full sm:w-auto px-10 py-4 bg-transparent border-2 border-white text-white hover:bg-white hover:text-slate-900 font-bold rounded-full text-lg transition-colors"
                        data-testid="button-footer-call"
                    >
                        <Phone className="w-5 h-5" />
                        07449 501762
                    </a>
                </div>

                <div className="flex items-center justify-center gap-2 mb-8">
                    <SiGoogle className="w-5 h-5 text-white" />
                    <div className="flex items-center gap-0.5">
                        {[...Array(5)].map((_, i) => (
                            <Star key={i} className="w-4 h-4 fill-amber-400 text-amber-400" />
                        ))}
                    </div>
                    <span className="text-white font-medium">4.9 · 300+ homeowners served</span>
                </div>

                <div className="border-t border-white/10 pt-8 flex flex-col sm:flex-row items-center justify-center gap-x-6 gap-y-2">
                    <p className="text-white/40 text-sm">
                        © 2026 Handy Services Derby. All rights reserved.
                    </p>
                    <a href="/cancellation-policy" className="text-white/40 text-sm underline hover:text-white/70 transition-colors">
                        Cancellation &amp; Deposit Policy
                    </a>
                </div>
            </div>
        </section>
    );
}

function EmergencyServiceSection() {
    return (
        <section className="bg-red-500 px-4 lg:px-8 py-12 lg:py-16">
            <div className="max-w-7xl mx-auto">
                <div className="grid lg:grid-cols-2 gap-8 items-center">
                    <div className="text-center lg:text-left">
                        <div className="inline-flex items-center gap-2 bg-white/20 px-4 py-2 rounded-full mb-4">
                            <AlertCircle className="w-5 h-5 text-white" />
                            <span className="text-white font-bold text-sm">URGENT REPAIRS</span>
                        </div>
                        <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold text-white mb-4">
                            Emergency Service Available
                        </h2>
                        <p className="text-white/90 text-lg mb-6">
                            Leaks, electrical faults, or security issues? We offer same-day emergency service for urgent repairs that can't wait.
                        </p>
                        <div className="flex flex-col sm:flex-row gap-4 justify-center lg:justify-start">
                            <a
                                href={`tel:${PHONE_NUMBER}`}
                                className="flex items-center justify-center gap-2 px-8 py-4 bg-white text-red-600 hover:bg-slate-100 font-bold rounded-full text-lg transition-colors"
                                data-testid="button-emergency-call"
                            >
                                <Phone className="w-5 h-5" />
                                Call for Emergency
                            </a>
                            <a
                                href={`https://wa.me/${WHATSAPP_NUMBER.replace('+', '')}?text=${encodeURIComponent("I need emergency handyman service in Derby")}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center justify-center gap-2 px-8 py-4 bg-green-500 hover:bg-green-600 text-white font-bold rounded-full text-lg transition-colors"
                                data-testid="button-emergency-whatsapp"
                            >
                                <SiWhatsapp className="w-5 h-5" />
                                Chat Emergency
                            </a>
                        </div>
                    </div>

                    <div className="bg-white/10 backdrop-blur-sm rounded-3xl p-8 border-2 border-white/20">
                        <h3 className="text-white font-bold text-xl mb-6">Common Emergencies We Handle:</h3>
                        <div className="grid sm:grid-cols-2 gap-4">
                            <div className="flex items-start gap-3">
                                <CheckCircle className="w-5 h-5 text-white flex-shrink-0 mt-1" />
                                <div>
                                    <p className="text-white font-semibold">Water Leaks</p>
                                    <p className="text-white/70 text-sm">Burst pipes, ceiling leaks</p>
                                </div>
                            </div>
                            <div className="flex items-start gap-3">
                                <CheckCircle className="w-5 h-5 text-white flex-shrink-0 mt-1" />
                                <div>
                                    <p className="text-white font-semibold">Electrical Issues</p>
                                    <p className="text-white/70 text-sm">Power outages, faults</p>
                                </div>
                            </div>
                            <div className="flex items-start gap-3">
                                <CheckCircle className="w-5 h-5 text-white flex-shrink-0 mt-1" />
                                <div>
                                    <p className="text-white font-semibold">Security Repairs</p>
                                    <p className="text-white/70 text-sm">Broken locks, doors</p>
                                </div>
                            </div>
                            <div className="flex items-start gap-3">
                                <CheckCircle className="w-5 h-5 text-white flex-shrink-0 mt-1" />
                                <div>
                                    <p className="text-white font-semibold">Heating Failures</p>
                                    <p className="text-white/70 text-sm">Boiler issues (winter)</p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </section>
    );
}

function MultiTaskJobsSection() {
    const exampleJobs = [
        { tasks: ["Fix dripping tap", "Seal bath edge", "Replace tile"], total: "£145-190", saved: "£30" },
        { tasks: ["Mount TV", "Install shelf", "Hang mirror"], total: "£120-165", saved: "£25" },
        { tasks: ["Paint bedroom", "Fix door", "Touch up skirting"], total: "£180-240", saved: "£40" },
    ];

    return (
        <section className="bg-gradient-to-br from-amber-400 to-amber-500 px-4 lg:px-8 py-16 lg:py-24">
            <div className="max-w-7xl mx-auto">
                <div className="text-center mb-12 lg:mb-16">
                    <div className="inline-flex items-center gap-2 bg-slate-900/20 px-4 py-2 rounded-full mb-6">
                        <Package className="w-5 h-5 text-slate-900" />
                        <span className="text-slate-900 font-bold text-sm">SAVE TIME & MONEY</span>
                    </div>
                    <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold text-slate-900 mb-4">
                        Multiple Jobs? <span className="text-white">One Visit.</span>
                    </h2>
                    <p className="text-slate-800 text-lg max-w-2xl mx-auto">
                        Tell us everything you need - we'll price it all upfront and handle it in a single visit. Save on call-out fees!
                    </p>
                </div>

                <div className="grid md:grid-cols-3 gap-6 mb-12">
                    {exampleJobs.map((job, idx) => (
                        <div key={idx} className="bg-white rounded-3xl p-6 shadow-xl">
                            <div className="flex items-center gap-2 mb-4">
                                <div className="w-8 h-8 bg-amber-400 rounded-full flex items-center justify-center text-slate-900 font-bold">
                                    {job.tasks.length}
                                </div>
                                <span className="text-slate-600 font-semibold">Tasks</span>
                            </div>

                            <ul className="space-y-2 mb-6">
                                {job.tasks.map((task, taskIdx) => (
                                    <li key={taskIdx} className="flex items-start gap-2 text-slate-700">
                                        <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0 mt-1" />
                                        <span className="text-sm">{task}</span>
                                    </li>
                                ))}
                            </ul>

                            <div className="border-t border-slate-200 pt-4">
                                <div className="flex items-center justify-between mb-2">
                                    <span className="text-slate-600 text-sm">Total Price:</span>
                                    <span className="text-slate-900 font-bold text-lg">{job.total}</span>
                                </div>
                                <div className="flex items-center gap-2 text-green-600 text-sm">
                                    <CheckCircle className="w-4 h-4" />
                                    <span>Save {job.saved} vs. separate visits</span>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>

                <div className="text-center">
                    <a href="#hero" className="scroll-smooth">
                        <Button
                            className="px-10 py-6 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-full text-lg"
                            data-testid="button-multitask-quote"
                        >
                            Get Multi-Job Quote
                            <ArrowRight className="w-5 h-5 ml-2" />
                        </Button>
                    </a>
                </div>
            </div>
        </section>
    );
}



interface HandymanLandingProps {
    headline?: string;
    subhead?: string;
}

export default function DerbyLanding({
    headline,
    subhead,
}: HandymanLandingProps) {
    const { variant, isLoading, trackConversion } = useLandingPage("derby");
    const [showSticky, setShowSticky] = useState(false);
    const [activeSegment, setActiveSegment] = useState<'residential' | 'property-manager' | 'business'>('residential');
    const contentRef = useRef<HTMLDivElement>(null);

    // PostHog split-test instrumentation. Tagged as the Derby control for
    // comparison against /v2/derby treatment in PostHog funnel dashboards.
    const LANDING_VARIANT = "derby" as const;
    const LANDING_CITY = "derby" as const;
    useEffect(() => {
        posthogRegister({ variant: LANDING_VARIANT, city: LANDING_CITY });
        posthogTrack("landing_view", {
            variant: LANDING_VARIANT,
            city: LANDING_CITY,
        });
    }, []);

    // Wrap the existing `trackConversion` so every CTA-driven conversion
    // also fires `landing_cta_click` for funnel comparison with /v2/derby.
    const trackConversionWithEvent = (source?: string) => {
        posthogTrack("landing_cta_click", {
            variant: LANDING_VARIANT,
            city: LANDING_CITY,
            source: source || "unknown",
        });
        trackConversion(source);
    };

    const handleSegmentChange = (segment: 'residential' | 'property-manager' | 'business') => {
        setActiveSegment(segment);
        // Small timeout to allow state update and render to start, then scroll
        setTimeout(() => {
            contentRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 100);
    };

    useEffect(() => {
        const handleScroll = () => {
            if (window.scrollY > 600) {
                setShowSticky(true);
            } else {
                setShowSticky(false);
            }
        };

        window.addEventListener('scroll', handleScroll);
        return () => window.removeEventListener('scroll', handleScroll);
    }, []);

    // Use variant content from admin, then props, then defaults (multi-tier format with ||)
    const finalHeadline = variant?.content?.heroHeadline || headline || "{{location}}||Handyman Service||Next-day slots • Fast & reliable";
    const finalSubhead = variant?.content?.heroSubhead || subhead || "Call or WhatsApp for an instant fixed-price quote";

    return (
        <div className="min-h-screen bg-slate-50 font-poppins text-slate-900 font-medium">
            <LandingHeader onConversion={trackConversionWithEvent} />

            {/* Shared Background Container for Hero + Map */}
            <div className="relative bg-slate-900">
                {/* Global Background for this section group */}
                <div className="absolute inset-0 z-0">
                    <img
                        src={heroImage}
                        alt="Background"
                        className="w-full h-full object-cover object-top"
                        loading="eager"
                    />
                    <div className="absolute inset-0 bg-slate-900/80 backdrop-grayscale-[30%]"></div>
                    <div className="absolute inset-0 bg-gradient-to-r from-slate-900 via-slate-900/80 to-transparent"></div>
                    <div className="absolute bottom-0 left-0 w-full h-32 bg-gradient-to-t from-slate-900 to-transparent"></div>
                </div>

                <div className="relative z-10">
                    <IntakeHero
                        location="Derby"
                        headline={finalHeadline}
                        subhead={finalSubhead}
                        ctaText={variant?.content?.ctaText || "Get Instant Quote"}
                        mobileCtaText={variant?.content?.mobileCtaText || "Call Now"}
                        desktopCtaText={variant?.content?.desktopCtaText || "Get a Price"}
                        bannerText="Fixed prices agreed up front. No hourly surprises, no call-out fees."
                        onConversion={trackConversionWithEvent}
                        transparentBg={true}
                    />

                    <SegmentSwitcher activeSegment={activeSegment} onSegmentChange={handleSegmentChange} />

                    <LocalTrustSection location="derby" />
                </div>
            </div>

            <div ref={contentRef} key={activeSegment} className="animate-in fade-in slide-in-from-bottom-4 duration-700 scroll-mt-24">
                {activeSegment === 'residential' && (
                    <>
                        <TeamSection />
                        <PainPointsSection />
                        <EmergencyServiceSection />
                        <ProcessSection />
                        <HassleComparisonSection segment="BUSY_PRO" />
                        <ServicesSection />
                        <RealJobsSection />
                        <BeforeAfterSection />

                        <GuaranteesSection />

                        <MultiTaskJobsSection />
                        <div className="bg-white">
                            <GoogleReviewsSection location="derby" darkMode={false} />
                        </div>

                        <FooterCTA />
                    </>
                )}

                {activeSegment === 'property-manager' && <PropertyManagerView />}
                {activeSegment === 'business' && <BusinessView />}
            </div>

            <StickyCTA isVisible={showSticky} onConversion={trackConversionWithEvent} showContactBen />
            <ChatHandymanPopup onConversion={trackConversionWithEvent} />
        </div>
    );
}
