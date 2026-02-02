import { useState, useEffect, useRef } from "react";
import { Link } from "wouter";
import { Phone, Star, Wrench, Paintbrush, Hammer, Droplets, Shield, Clock, CheckCircle, ArrowRight, AlertCircle, MapPin, Leaf, Package, Mic } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SiWhatsapp, SiGoogle } from "react-icons/si";
import { SocialProofSection } from "@/components/SocialProofSection";
import { IntakeHero } from "@/components/IntakeHero";
import { GoogleReviewsSection } from "@/components/GoogleReviewsSection";
import { StickyCTA } from "@/components/StickyCTA";
import { LocalTrustSection } from "@/components/AnimatedMap";
import { SegmentSwitcher } from "@/components/SegmentSwitcher";
import { PropertyManagerView } from "@/components/PropertyManagerView";
import { BusinessView } from "@/components/BusinessView";

import teamMember1 from "@assets/Untitled design (22)_1764599239600.webp";
import teamMember2 from "@assets/Untitled design (23)_1764599239600.webp";
import teamMember3 from "@assets/Untitled design (24)_1764599239599.webp";
import teamMember4 from "@assets/Untitled design (25)_1764599239599.webp";
import teamMember5 from "@assets/Untitled design (26)_1764599239599.webp";
import teamMember6 from "@assets/Untitled design (27)_1764599239595.webp";
import heroImage from "@assets/f7550ab2-8282-4cf6-b2af-83496eef2eee_1764599750751.webp";
import videoQuoteImage from "@assets/123d3462-a11d-42b8-9fad-fdb2d6f29b11_1764600237774.webp";
import handyLogo from "@assets/Copy of Copy of Add a heading-3_1764600628729.webp";
import mobileHeroImage from "@assets/f7550ab2-8282-4cf6-b2af-83496eef2eee_1764604328714.webp";
import realJobToilet from "@assets/c33e343a-3b9d-4d85-97cb-a0752ea3e80d_1764687156907.webp";
import realJobPainting from "@assets/97e1a436-81fd-44d2-8b08-ce5a374c9c4b_1764687156908.webp";
import realJobSink from "@assets/cf7cd976-8854-4abb-a7dd-391a08c63978_1764687156908.webp";
import realJobShelf from "@assets/c2f4951d-baa5-4a9f-8b4e-233fa5fcb49c_1764687156908.webp";
import realJobKitchen from "@assets/4cc2f0fa-125e-412b-9929-4e03a055b760_1764687156909.webp";
import realJobBlinds from "@assets/528c52d4-f8ff-4e5b-9853-b68263a62c2f_1764694548068.webp";
import beforeImage from "@assets/74cb4082-17d2-48b1-bd98-bf51f85bc7a5_(1)_1764694445995.webp";
import afterImage from "@assets/cb5e8951-9d46-4023-9909-510a89d3da60_1764693845208.webp";
import payIn3Image from "@assets/6e08e13d-d1a3-4a91-a4cc-814b057b341d_1764693900670.webp";
import { useLandingPage } from "@/hooks/useLandingPage";

const WHATSAPP_NUMBER = "+447508744402";
const WHATSAPP_MESSAGE = encodeURIComponent("I'm interested in Handy Services");
const PHONE_NUMBER = "+447449501762";

import { LandingHeader } from "@/components/LandingHeader";
import { GoogleReviewsBadge } from "@/components/LandingShared";



function TeamSection() {
    const team = [
        { name: "Richard", role: "Lead Handyman", rating: "4.9/5", reviews: "80+ Reviews", specialty: "General Repairs", icon: <Wrench className="w-5 h-5" />, image: teamMember1 },
        { name: "Barry", role: "Senior Carpenter", rating: "4.8/5", reviews: "50+ Reviews", specialty: "Joinery & Woodwork", icon: <Hammer className="w-5 h-5" />, image: teamMember2 },
        { name: "Vinny", role: "Decorator", rating: "4.8/5", reviews: "15+ Reviews", specialty: "Painting & Finishing", icon: <Paintbrush className="w-5 h-5" />, image: teamMember3 },
    ];

    return (
        <section id="team" className="bg-slate-800 px-4 lg:px-8 py-16 lg:py-24">
            <div className="max-w-7xl mx-auto">
                <div className="text-center mb-12 lg:mb-16">
                    <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold text-white mb-4">
                        Out of Many Locals, One <span className="text-amber-400">Handy Team</span>
                    </h2>
                    <p className="text-white/60 text-lg max-w-2xl mx-auto font-medium">
                        Meet our trusted professionals who've helped hundreds of Nottingham homeowners
                    </p>
                </div>

                <div className="grid grid-cols-3 gap-2 md:gap-8 lg:gap-12 items-stretch">
                    {team.map((member, idx) => (
                        <div key={idx} className="bg-slate-700/50 rounded-xl md:rounded-3xl p-2 md:p-8 text-center hover:bg-slate-700 transition-colors h-full flex flex-col">
                            <img
                                src={member.image}
                                alt={member.name}
                                loading="lazy"
                                decoding="async"
                                className="w-16 h-16 md:w-32 md:h-32 lg:w-40 lg:h-40 mx-auto mb-2 md:mb-6 object-contain"
                            />

                            <div className="flex items-center justify-center gap-1 md:gap-2 text-amber-400 font-semibold mb-1 md:mb-2">
                                <span className="hidden md:inline">{member.icon}</span>
                                <span className="text-xs md:text-xl font-semibold">{member.name}</span>
                            </div>

                            <p className="text-white/60 text-xs md:text-base mb-2 md:mb-4">{member.role}</p>

                            <div className="bg-slate-800 rounded-lg md:rounded-xl p-2 md:p-4 mb-2 md:mb-4">
                                <p className="text-amber-400 font-bold text-sm md:text-2xl">{member.rating}</p>
                                <p className="text-white/50 text-xs">{member.reviews}</p>
                            </div>

                            <p className="text-white/70 text-xs hidden md:block">Specialty: {member.specialty}</p>
                        </div>
                    ))}
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

function VideoQuoteSection() {
    return (
        <section className="bg-amber-400 px-4 lg:px-8 py-16 lg:py-24">
            <div className="max-w-7xl mx-auto">
                <div className="grid lg:grid-cols-2 gap-12 items-center">
                    <div className="order-2 lg:order-1">
                        <div className="relative rounded-3xl overflow-hidden max-w-xl shadow-2xl">
                            <img
                                src={videoQuoteImage}
                                alt="Handy Services technician talking with customer"
                                className="w-full h-auto object-contain"
                            />
                        </div>
                    </div>

                    <div className="order-1 lg:order-2 text-center lg:text-left">
                        <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold text-slate-900 mb-6 leading-tight">
                            Don't wait in for a quote and get an instant quote
                        </h2>

                        <p className="text-slate-700 text-lg mb-8 max-w-lg mx-auto lg:mx-0 font-medium">
                            From shelves to skirting boards, send us a quick video and we'll price it up in minutes — no need to wait in for a quote.
                        </p>

                        <a href="#hero" className="scroll-smooth">
                            <Button
                                className="w-full sm:w-auto px-10 py-6 bg-slate-800 hover:bg-slate-900 text-white font-bold rounded-full text-lg"
                                data-testid="button-video-quote"
                            >
                                Get Instant Quote
                                <ArrowRight className="w-5 h-5 ml-2" />
                            </Button>
                        </a>

                        <div className="flex items-center justify-center lg:justify-start gap-2 mt-6">
                            <GoogleReviewsBadge dark />
                        </div>
                    </div>
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
                    <p className="text-slate-600 text-lg font-medium">Professional handyman services at transparent prices</p>
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
                            <div className="absolute -bottom-4 left-1/2 -translate-x-1/2 bg-red-500 text-white text-sm font-bold px-5 py-2 rounded-full shadow-lg">
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
        { name: "Sarah", area: "NG7", job: "Bathroom plumbing repair", image: realJobToilet },
        { name: "Mike", area: "NG2", job: "Kitchen painting", image: realJobPainting },
        { name: "Emily", area: "NG1", job: "Sink installation", image: realJobSink },
        { name: "Linda", area: "NG4", job: "Shelving installation", image: realJobShelf },
        { name: "Craig", area: "NG7", job: "Kitchen cabinet fitting", image: realJobKitchen },
        { name: "David", area: "NG3", job: "Blind fitting", image: realJobBlinds },
    ];

    return (
        <section className="bg-slate-800 px-4 lg:px-8 py-16 lg:py-24">
            <div className="max-w-7xl mx-auto">
                <div className="text-center mb-12 lg:mb-16">
                    <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold text-white mb-4">
                        Real Jobs. Real Customers.
                    </h2>
                    <p className="text-white/60 text-lg">See what we've done for Nottingham homeowners</p>
                </div>

                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
                    {customers.map((customer, idx) => (
                        <div key={idx} className="bg-slate-700 rounded-2xl overflow-hidden group hover:bg-slate-600 transition-colors">
                            <div className="aspect-video bg-slate-600 flex items-center justify-center overflow-hidden">
                                <img
                                    src={customer.image}
                                    alt={`${customer.job} for ${customer.name}`}
                                    className="w-full h-full object-contain bg-slate-700"
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
                        "Elle, NG5 - requested a kitchenette to be removed and a unit with a sink built. 2 days to complete and a happy customer!"
                    </p>
                </div>
            </div>
        </section>
    );
}

function PayIn3Section() {
    return (
        <section className="bg-slate-700 px-4 lg:px-8 py-16 lg:py-24">
            <div className="max-w-7xl mx-auto">
                <div className="grid lg:grid-cols-2 gap-12 items-center">
                    <div className="order-2 lg:order-1">
                        <div className="relative rounded-3xl overflow-hidden max-w-xl shadow-2xl">
                            <img
                                src={payIn3Image}
                                alt="Handy Services van with Pay in 3 badge"
                                className="w-full h-auto object-contain"
                            />
                        </div>
                    </div>

                    <div className="order-1 lg:order-2 text-center lg:text-left">
                        <div className="inline-flex items-center gap-2 bg-blue-500/20 px-4 py-2 rounded-full mb-6">
                            <span className="text-blue-400 font-bold text-sm">FLEXIBLE PAYMENTS</span>
                        </div>

                        <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold text-white mb-6 leading-tight">
                            Pay in 3 <span className="text-amber-400">Interest-Free</span> Payments
                        </h2>

                        <p className="text-white/70 text-lg mb-8 max-w-lg mx-auto lg:mx-0">
                            Spread the cost of your home improvements with our flexible payment option. No credit checks, no interest — just simple, affordable payments.
                        </p>

                        <div className="grid sm:grid-cols-3 gap-4 mb-8">
                            <div className="bg-slate-800 rounded-2xl p-4 text-center">
                                <p className="text-amber-400 font-bold text-2xl mb-1">1st</p>
                                <p className="text-white/60 text-sm">Pay deposit to book</p>
                            </div>
                            <div className="bg-slate-800 rounded-2xl p-4 text-center">
                                <p className="text-amber-400 font-bold text-2xl mb-1">2nd</p>
                                <p className="text-white/60 text-sm">Pay on job day</p>
                            </div>
                            <div className="bg-slate-800 rounded-2xl p-4 text-center">
                                <p className="text-amber-400 font-bold text-2xl mb-1">3rd</p>
                                <p className="text-white/60 text-sm">Pay 30 days later</p>
                            </div>
                        </div>

                        <a href="#hero" className="scroll-smooth">
                            <Button
                                className="w-full sm:w-auto px-10 py-6 bg-amber-400 hover:bg-amber-500 text-slate-900 font-bold rounded-full text-lg"
                                data-testid="button-payin3-quote"
                            >
                                Get Your Quote
                                <ArrowRight className="w-5 h-5 ml-2" />
                            </Button>
                        </a>
                    </div>
                </div>
            </div>
        </section>
    );
}

function TestimonialsSection() {
    const testimonials = [
        { name: "Sarah M.", area: "NG1", text: "Absolutely brilliant service. Richard was punctual, professional and did an amazing job on our bathroom. Would highly recommend!", rating: 5 },
        { name: "James T.", area: "NG5", text: "Used Handy Services for multiple jobs now. Always reliable, fair prices and great quality work. Won't go anywhere else.", rating: 5 },
        { name: "Michelle K.", area: "NG7", text: "Barry fitted our new kitchen cabinets perfectly. Clean, tidy and finished ahead of schedule. 5 stars!", rating: 5 },
    ];

    return (
        <section id="reviews" className="bg-white px-4 lg:px-8 py-16 lg:py-24">
            <div className="max-w-7xl mx-auto">
                <div className="text-center mb-12 lg:mb-16">
                    <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold text-slate-800 mb-4">
                        What Nottingham <span className="text-amber-500">Says About Us</span>
                    </h2>
                    <div className="flex items-center justify-center gap-2 mt-4">
                        <SiGoogle className="w-6 h-6 text-slate-800" />
                        <div className="flex items-center gap-0.5">
                            {[...Array(5)].map((_, i) => (
                                <Star key={i} className="w-5 h-5 fill-amber-400 text-amber-400" />
                            ))}
                        </div>
                        <span className="text-slate-800 font-bold text-lg">4.9 from 300+ Reviews</span>
                    </div>
                </div>

                <div className="grid md:grid-cols-3 gap-6 lg:gap-8">
                    {testimonials.map((testimonial, idx) => (
                        <div key={idx} className="bg-slate-50 rounded-3xl p-8 relative">
                            <div className="flex items-center gap-0.5 mb-4">
                                {[...Array(testimonial.rating)].map((_, i) => (
                                    <Star key={i} className="w-5 h-5 fill-amber-400 text-amber-400" />
                                ))}
                            </div>
                            <p className="text-slate-700 mb-6 text-lg italic">"{testimonial.text}"</p>
                            <div className="flex items-center gap-3">
                                <div className="w-12 h-12 bg-slate-300 rounded-full flex items-center justify-center">
                                    <span className="text-xl">👤</span>
                                </div>
                                <div>
                                    <p className="font-bold text-slate-800">{testimonial.name}</p>
                                    <p className="text-slate-500 text-sm">{testimonial.area}</p>
                                </div>
                            </div>
                            <SiGoogle className="absolute top-6 right-6 w-6 h-6 text-slate-300" />
                        </div>
                    ))}
                </div>
            </div>
        </section>
    );
}

function GuaranteesSection() {
    const guarantees = [
        { icon: <Clock className="w-6 h-6" />, title: "We turn up when we say we will", subtitle: "Punctuality guaranteed" },
        { icon: <Star className="w-6 h-6" />, title: "Top-rated team trusted by 70+ locals", subtitle: "Proven track record" },
        { icon: <CheckCircle className="w-6 h-6" />, title: "No hidden charges, ever", subtitle: "Transparent pricing" },
        { icon: <Shield className="w-6 h-6" />, title: "Fully insured and DBS checked", subtitle: "Peace of mind" },
    ];

    return (
        <section className="bg-slate-100 px-4 lg:px-8 py-16 lg:py-24">
            <div className="max-w-7xl mx-auto">
                <div className="text-center mb-12 lg:mb-16">
                    <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold text-slate-800 mb-4">
                        Our Guarantees
                    </h2>
                    <p className="text-slate-600 text-lg">What you can expect from Handy Services</p>
                </div>

                <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
                    {guarantees.map((guarantee, idx) => (
                        <div key={idx} className="bg-white rounded-2xl p-6 text-center shadow-sm hover:shadow-md transition-shadow">
                            <div className="w-14 h-14 bg-amber-400 rounded-2xl flex items-center justify-center mx-auto mb-4 text-slate-900">
                                {guarantee.icon}
                            </div>
                            <h3 className="font-bold text-slate-800 mb-2">{guarantee.title}</h3>
                            <p className="text-slate-500 text-sm">{guarantee.subtitle}</p>
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
                    Get your instant quote in minutes, not days. Join hundreds of satisfied Nottingham homeowners.
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
                    <span className="text-white font-medium">4.9 from 300+ Reviews</span>
                </div>

                <div className="border-t border-white/10 pt-8">
                    <p className="text-white/40 text-sm">
                        © 2024 Handy Services Nottingham. All rights reserved.
                    </p>
                </div>
            </div>
        </section>
    );
}

function RealTimeTrackingSection() {
    const trackingSteps = [
        { icon: <CheckCircle className="w-6 h-6" />, title: "Booking Confirmed", description: "Instant notification", color: "bg-green-500" },
        { icon: <Wrench className="w-6 h-6" />, title: "Handyman Assigned", description: "Meet your pro", color: "bg-blue-500" },
        { icon: <MapPin className="w-6 h-6" />, title: "On the Way", description: "Live location & ETA", color: "bg-amber-500" },
        { icon: <Clock className="w-6 h-6" />, title: "Job in Progress", description: "Photo updates", color: "bg-purple-500" },
        { icon: <Star className="w-6 h-6" />, title: "Complete", description: "Rate & review", color: "bg-pink-500" },
    ];

    return (
        <section className="bg-white px-4 lg:px-8 py-16 lg:py-24">
            <div className="max-w-7xl mx-auto">
                <div className="text-center mb-12 lg:mb-16">
                    <div className="inline-flex items-center gap-2 bg-blue-500/10 px-4 py-2 rounded-full mb-6">
                        <MapPin className="w-5 h-5 text-blue-600" />
                        <span className="text-blue-600 font-bold text-sm">TRACK EVERY STEP</span>
                    </div>
                    <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold text-slate-800 mb-4">
                        Know Exactly What's <span className="text-blue-600">Happening</span>
                    </h2>
                    <p className="text-slate-600 text-lg max-w-2xl mx-auto">
                        From booking to completion, stay informed with real-time updates via SMS and email
                    </p>
                </div>

                <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-4 lg:gap-6">
                    {trackingSteps.map((step, idx) => (
                        <div key={idx} className="relative">
                            <div className="bg-slate-50 rounded-2xl p-6 text-center hover:bg-slate-100 transition-colors">
                                <div className={`w-16 h-16 ${step.color} rounded-2xl flex items-center justify-center mx-auto mb-4 text-white shadow-lg`}>
                                    {step.icon}
                                </div>
                                <h3 className="font-bold text-slate-800 mb-2">{step.title}</h3>
                                <p className="text-slate-500 text-sm">{step.description}</p>
                            </div>
                            {idx < trackingSteps.length - 1 && (
                                <div className="hidden lg:block absolute top-1/2 -right-3 transform -translate-y-1/2">
                                    <ArrowRight className="w-6 h-6 text-slate-300" />
                                </div>
                            )}
                        </div>
                    ))}
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
                                href={`https://wa.me/${WHATSAPP_NUMBER.replace('+', '')}?text=${encodeURIComponent("I need emergency handyman service")}`}
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

function EcoFriendlySection() {
    const greenServices = [
        { icon: <Droplets className="w-6 h-6" />, title: "Water-Saving Fixtures", description: "Low-flow taps & toilets" },
        { icon: <Shield className="w-6 h-6" />, title: "Energy Efficiency", description: "LED lighting & sealing" },
        { icon: <Leaf className="w-6 h-6" />, title: "Sustainable Materials", description: "Eco-friendly products" },
        { icon: <Clock className="w-6 h-6" />, title: "Draught Proofing", description: "Reduce heat loss" },
    ];

    return (
        <section className="bg-slate-800 px-4 lg:px-8 py-16 lg:py-24">
            <div className="max-w-7xl mx-auto">
                <div className="grid lg:grid-cols-2 gap-12 items-center">
                    <div className="order-2 lg:order-1">
                        <div className="grid sm:grid-cols-2 gap-4">
                            {greenServices.map((service, idx) => (
                                <div key={idx} className="bg-slate-700 rounded-2xl p-6 hover:bg-slate-600 transition-colors">
                                    <div className="w-14 h-14 bg-green-500 rounded-2xl flex items-center justify-center mx-auto mb-4 text-white">
                                        {service.icon}
                                    </div>
                                    <h3 className="text-white font-bold text-center mb-2">{service.title}</h3>
                                    <p className="text-white/60 text-sm text-center">{service.description}</p>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="order-1 lg:order-2 text-center lg:text-left">
                        <div className="inline-flex items-center gap-2 bg-green-500/20 px-4 py-2 rounded-full mb-6">
                            <Leaf className="w-5 h-5 text-green-400" />
                            <span className="text-green-400 font-bold text-sm">ECO-FRIENDLY OPTIONS</span>
                        </div>
                        <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold text-white mb-6 leading-tight">
                            Good for Your Home. <span className="text-green-400">Great for the Planet.</span>
                        </h2>
                        <p className="text-white/70 text-lg mb-8">
                            Choose sustainable solutions that reduce your energy bills and environmental impact. From water-saving fixtures to draught-proofing, we help make your Nottingham home greener.
                        </p>

                        <div className="flex flex-col sm:flex-row gap-4 justify-center lg:justify-start">
                            <a href="#hero" className="scroll-smooth">
                                <Button
                                    className="w-full sm:w-auto px-8 py-6 bg-green-500 hover:bg-green-600 text-white font-bold rounded-full text-lg"
                                    data-testid="button-eco-quote"
                                >
                                    Get Green Quote
                                    <ArrowRight className="w-5 h-5 ml-2" />
                                </Button>
                            </a>
                        </div>

                        <div className="mt-8 p-6 bg-slate-700/50 rounded-2xl border border-green-500/20">
                            <div className="flex items-start gap-3">
                                <CheckCircle className="w-5 h-5 text-green-400 flex-shrink-0 mt-1" />
                                <div>
                                    <p className="text-white font-semibold mb-1">Available for All Jobs</p>
                                    <p className="text-white/60 text-sm">Just mention you'd like eco-friendly options when booking - no extra charge to discuss!</p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </section>
    );
}

interface HandymanLandingProps {
    headline?: string;
    subhead?: string;
}

export default function HandymanLanding({
    headline,
    subhead,
}: HandymanLandingProps) {
    const { variant, isLoading, trackConversion } = useLandingPage("landing");
    const [showSticky, setShowSticky] = useState(false);
    const [activeSegment, setActiveSegment] = useState<'residential' | 'property-manager' | 'business'>('residential');
    const contentRef = useRef<HTMLDivElement>(null);

    const handleSegmentChange = (segment: 'residential' | 'property-manager' | 'business') => {
        setActiveSegment(segment);
        // Small timeout to allow state update and render to start, then scroll
        setTimeout(() => {
            contentRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 100);
    };

    useEffect(() => {
        const handleScroll = () => {
            // ... existing scroll logic
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

    // Prevent flicker: wait for variant data to load before rendering hero
    if (isLoading) {
        return (
            <div className="min-h-screen bg-slate-900 flex items-center justify-center">
                <div className="text-white text-center">
                    <div className="w-16 h-16 border-4 border-amber-400 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
                    <p className="text-lg font-medium">Loading...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-50 font-poppins text-slate-900 font-medium">
            <LandingHeader onConversion={trackConversion} />

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
                    {/* Gradient fade at bottom to blend into next section if needed */}
                    <div className="absolute bottom-0 left-0 w-full h-32 bg-gradient-to-t from-slate-900 to-transparent"></div>
                </div>

                <div className="relative z-10">
                    <IntakeHero
                        location="Nottingham"
                        headline={finalHeadline}
                        subhead={finalSubhead}
                        ctaText={variant?.content?.ctaText || "Get Instant Quote"}
                        mobileCtaText={variant?.content?.mobileCtaText || "Call Now"}
                        desktopCtaText={variant?.content?.desktopCtaText || "Get a Price"}
                        bannerText="⚡️ Fastest growing property services team in {{location}}"
                        onConversion={trackConversion}
                        transparentBg={true}
                    />

                    <SegmentSwitcher activeSegment={activeSegment} onSegmentChange={handleSegmentChange} />

                    <LocalTrustSection location="nottingham" />
                </div>
            </div>

            <SocialProofSection location="nottingham" />

            <div ref={contentRef} key={activeSegment} className="animate-in fade-in slide-in-from-bottom-4 duration-700 scroll-mt-24">
                {activeSegment === 'residential' && (
                    <>
                        <TeamSection />
                        <EmergencyServiceSection />
                        <ProcessSection />
                        <VideoQuoteSection />
                        <ServicesSection />
                        <RealJobsSection />
                        <BeforeAfterSection />
                        <PayIn3Section />
                        <TestimonialsSection />
                        <GuaranteesSection />
                        <RealTimeTrackingSection />
                        <MultiTaskJobsSection />
                        <div className="bg-white">
                            <GoogleReviewsSection darkMode={false} />
                        </div>
                        <EcoFriendlySection />
                        <FooterCTA />
                    </>
                )}

                {activeSegment === 'property-manager' && <PropertyManagerView />}
                {activeSegment === 'business' && <BusinessView />}
            </div>

            <StickyCTA isVisible={showSticky} onConversion={trackConversion} />
        </div>
    );
}
