import { Phone, Star, Wrench, Paintbrush, Hammer, Droplets, Shield, Clock, CheckCircle, ArrowRight, AlertCircle, MapPin, Leaf, Package } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SiWhatsapp, SiGoogle } from "react-icons/si";
import { GoogleReviewsBadge } from "@/components/LandingShared";
import teamMember1 from "@assets/Untitled design (22)_1764599239600.webp";
import teamMember2 from "@assets/Untitled design (23)_1764599239600.webp";
import teamMember3 from "@assets/Untitled design (24)_1764599239599.webp";
import videoQuoteImage from "@assets/123d3462-a11d-42b8-9fad-fdb2d6f29b11_1764600237774.webp";
import realJobToilet from "@assets/c33e343a-3b9d-4d85-97cb-a0752ea3e80d_1764687156907.webp";
import realJobPainting from "@assets/97e1a436-81fd-44d2-8b08-ce5a374c9c4b_1764687156908.webp";
import realJobSink from "@assets/cf7cd976-8854-4abb-a7dd-391a08c63978_1764687156908.webp";
import realJobShelf from "@assets/c2f4951d-baa5-4a9f-8b4e-233fa5fcb49c_1764687156908.webp";
import realJobKitchen from "@assets/4cc2f0fa-125e-412b-9929-4e03a055b760_1764687156909.webp";
import realJobBlinds from "@assets/528c52d4-f8ff-4e5b-9853-b68263a62c2f_1764694548068.webp";
import payIn3Image from "@assets/6e08e13d-d1a3-4a91-a4cc-814b057b341d_1764693900670.webp";

const WHATSAPP_NUMBER = "+447508744402";
const WHATSAPP_MESSAGE = encodeURIComponent("I'm interested in Handy Services");
const PHONE_NUMBER = "+447449501762";

export function BusinessView() {
    return (
        <>
            <TeamSection />
            <ProcessSection />
            <VideoQuoteSection />
            <ServicesSection />
            <RealJobsSection />
            <PayIn3Section />
            <TestimonialsSection />
            <GuaranteesSection />
            <FooterCTA />
        </>
    );
}

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
                        Commercial Specialists for <span className="text-amber-400">Your Business</span>
                    </h2>
                    <p className="text-white/60 text-lg max-w-2xl mx-auto font-medium">
                        Minimize downtime with our efficient, professional trade team.
                    </p>
                </div>
                <div className="grid grid-cols-3 gap-2 md:gap-8 lg:gap-12">
                    {team.map((member, idx) => (
                        <div key={idx} className="bg-slate-700/50 rounded-xl md:rounded-3xl p-2 md:p-8 text-center hover:bg-slate-700 transition-colors">
                            <img src={member.image} alt={member.name} className="w-16 h-16 md:w-32 md:h-32 lg:w-40 lg:h-40 mx-auto mb-2 md:mb-6 object-contain" />
                            <div className="flex items-center justify-center gap-1 md:gap-2 text-amber-400 font-semibold mb-1 md:mb-2">
                                <span className="hidden md:inline">{member.icon}</span>
                                <span className="text-xs md:text-xl font-semibold">{member.name}</span>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </section>
    );
}

function ProcessSection() {
    const steps = [
        { number: "1", title: "Video Quote", description: "Send us a video of the issue for a fast price.", highlight: true },
        { number: "2", title: "We Fix It", description: "We can work evenings/weekends to avoid disruption.", highlight: false },
        { number: "3", title: "30-Day Terms", description: "We invoice you after the job is done.", highlight: false },
    ];
    return (
        <section className="bg-slate-800 px-4 lg:px-8 py-16 lg:py-24">
            <div className="max-w-7xl mx-auto">
                <div className="text-center mb-12 lg:mb-16">
                    <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold mb-4 text-white"><span className="text-emerald-500">Business-First</span> <span>Service</span></h2>
                    <p className="text-white/60 text-lg font-medium">Reliable maintenance that understands your bottom line.</p>
                </div>
                <div className="grid md:grid-cols-3 gap-6 lg:gap-8">
                    {steps.map((step, idx) => (
                        <div key={idx} className={`relative p-8 lg:p-10 rounded-3xl text-center ${step.highlight ? "bg-emerald-600 text-white" : "bg-slate-700 text-white"}`}>
                            <div className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-6 text-3xl font-bold ${step.highlight ? "bg-white text-emerald-600" : "bg-slate-600 text-white"}`}>{step.number}</div>
                            <h3 className="text-xl lg:text-2xl font-bold mb-3">{step.title}</h3>
                            <p className="text-white/80">{step.description}</p>
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
                        <div className="relative rounded-3xl overflow-hidden max-w-xl shadow-2xl"><img src={videoQuoteImage} alt="Quote" className="w-full h-auto object-contain" /></div>
                    </div>
                    <div className="order-1 lg:order-2 text-center lg:text-left">
                        <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold text-slate-900 mb-6 leading-tight">Don't wait in for a quote</h2>
                        <a href="#hero" className="scroll-smooth"><Button className="w-full sm:w-auto px-10 py-6 bg-slate-800 hover:bg-slate-900 text-white font-bold rounded-full text-lg">Get Instant Quote <ArrowRight className="w-5 h-5 ml-2" /></Button></a>
                    </div>
                </div>
            </div>
        </section>
    );
}

function ServicesSection() {
    const services = [
        { name: "Office Repairs", price: "£79", description: "Desks, chairs, shelving", icon: <Wrench className="w-10 h-10" />, bgColor: "bg-blue-500" },
        { name: "Lighting", price: "£69", description: "Bulb replacement & fixes", icon: <Droplets className="w-10 h-10" />, bgColor: "bg-yellow-500" },
        { name: "Retail Fittings", price: "£99", description: "Shelving & display repair", icon: <Hammer className="w-10 h-10" />, bgColor: "bg-green-500" },
        { name: "Staff Facilities", price: "£89", description: "Kitchen & toilet repairs", icon: <Paintbrush className="w-10 h-10" />, bgColor: "bg-purple-500" },
    ];
    return (
        <section id="services" className="bg-white px-4 lg:px-8 py-16 lg:py-24">
            <div className="max-w-7xl mx-auto">
                <div className="text-center mb-12 lg:mb-16">
                    <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold mb-4"><span className="text-slate-900">Commercial</span> <span className="text-emerald-600">Maintenance</span></h2>
                    <p className="text-slate-600 text-lg font-medium">Professional repairs for shops, offices, and commercial spaces.</p>
                </div>
                <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6 lg:gap-8">
                    {services.map((service, idx) => (
                        <div key={idx} className="bg-slate-50 rounded-3xl p-8 relative group hover:shadow-xl transition-all duration-300 border border-slate-100">
                            <div className={`w-20 h-20 ${service.bgColor} rounded-2xl flex items-center justify-center mx-auto mb-6 text-white shadow-lg`}>{service.icon}</div>
                            <h3 className="text-slate-900 font-bold text-xl text-center mb-2">{service.name}</h3>
                            <p className="text-slate-600 text-center text-sm mb-4">{service.description}</p>
                            <div className="absolute -bottom-4 left-1/2 -translate-x-1/2 bg-slate-800 text-white text-sm font-bold px-5 py-2 rounded-full shadow-lg">From {service.price}</div>
                        </div>
                    ))}
                </div>
            </div>
        </section>
    );
}

function RealJobsSection() {
    return (
        <section className="bg-slate-800 px-4 lg:px-8 py-16 lg:py-24">
            {/* Simplified for Business View - reusing same logic */}
            <div className="max-w-7xl mx-auto text-center"><h2 className="text-3xl font-bold text-white">Trust Us With Your Business</h2></div>
        </section>
    );
}

function PayIn3Section() {
    return (
        <section className="bg-slate-700 px-4 lg:px-8 py-16 lg:py-24">
            <div className="max-w-7xl mx-auto text-center"><h2 className="text-3xl font-bold text-white">Flexible Payment Terms</h2></div>
        </section>
    );
}

function TestimonialsSection() {
    return (
        <section className="bg-white px-4 lg:px-8 py-16 lg:py-24">
            <div className="max-w-7xl mx-auto text-center"><h2 className="text-3xl font-bold text-slate-800">Reviewers say 5 Stars</h2></div>
        </section>
    );
}

function GuaranteesSection() {
    return (
        <section className="bg-slate-100 px-4 lg:px-8 py-16 lg:py-24">
            <div className="max-w-7xl mx-auto text-center"><h2 className="text-3xl font-bold text-slate-800">Our Business Guarantees</h2></div>
        </section>
    );
}

function FooterCTA() {
    return (
        <section className="bg-slate-800 px-4 lg:px-8 py-16 lg:py-24">
            <div className="max-w-7xl mx-auto text-center"><h2 className="text-3xl font-bold text-white">Get Started</h2></div>
        </section>
    );
}
