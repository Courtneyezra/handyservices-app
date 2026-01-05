
import { useState } from "react";
import { Star, Shield, Wind, Droplets, Thermometer, ArrowRight, CheckCircle, Info, Leaf, Home } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SiWhatsapp } from "react-icons/si";

const WHATSAPP_NUMBER = "+447508744402";
const WHATSAPP_MESSAGE = encodeURIComponent("I'm interested in the Winter Protection Collection");

export default function SeasonalMenu() {
    return (
        <div className="min-h-screen bg-slate-50 font-sans text-slate-900">
            <Header />
            <Hero />
            <Philosophy />
            <WinterMenu />
            <HealthScore />
            <Membership />
            <Footer />
        </div>
    );
}

function Header() {
    return (
        <header className="sticky top-0 z-50 bg-slate-900 text-white px-6 py-4 shadow-md">
            <div className="max-w-7xl mx-auto flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <Shield className="w-8 h-8 text-amber-400" />
                    <div>
                        <h1 className="text-xl font-bold tracking-tight">The Derby Homekeeper</h1>
                        <p className="text-xs text-slate-400 uppercase tracking-widest">Seasonal Guide</p>
                    </div>
                </div>
                <a
                    href="#menu"
                    className="hidden sm:inline-block text-sm font-medium text-amber-400 hover:text-amber-300 transition-colors uppercase tracking-wide"
                >
                    View The Collection
                </a>
            </div>
        </header>
    );
}

function Hero() {
    return (
        <section className="relative bg-slate-900 text-white py-24 lg:py-32 px-6 overflow-hidden">
            {/* Background Pattern */}
            <div className="absolute inset-0 opacity-10 pointer-events-none">
                <svg className="w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none">
                    <path d="M0 100 C 20 0 50 0 100 100 Z" fill="currentColor" />
                </svg>
            </div>

            <div className="max-w-4xl mx-auto text-center relative z-10">
                <div className="inline-flex items-center gap-2 border border-amber-500/50 rounded-full px-4 py-1 mb-8 bg-amber-500/10 backdrop-blur-sm">
                    <Star className="w-3 h-3 text-amber-400 fill-amber-400" />
                    <span className="text-amber-400 text-xs font-bold tracking-widest uppercase">Winter Edition 2024</span>
                </div>

                <h2 className="text-4xl md:text-6xl lg:text-7xl font-bold mb-6 tracking-tight leading-tight">
                    The Art of <br /><span className="text-amber-400 italic font-serif">British Stewardship</span>
                </h2>

                <p className="text-lg md:text-xl text-slate-300 mb-10 max-w-2xl mx-auto font-light leading-relaxed">
                    A curated collection of essential property care services, designed to protect your home's value against the British winter.
                </p>

                <div className="flex flex-col sm:flex-row justify-center gap-4">
                    <Button className="bg-amber-400 hover:bg-amber-500 text-slate-900 font-bold rounded-full px-8 py-6 text-lg tracking-wide uppercase">
                        View The Menu
                    </Button>
                    <Button variant="outline" className="border-slate-600 text-slate-900 hover:bg-slate-800 hover:text-white rounded-full px-8 py-6 text-lg tracking-wide uppercase">
                        Check My Home Score
                    </Button>
                </div>
            </div>
        </section>
    );
}

function Philosophy() {
    return (
        <section className="py-20 px-6 bg-white">
            <div className="max-w-3xl mx-auto text-center">
                <Leaf className="w-12 h-12 text-slate-800 mx-auto mb-6" />
                <h3 className="text-2xl font-bold mb-6 text-slate-900 uppercase tracking-widest">The Philosophy</h3>
                <p className="text-xl text-slate-600 leading-relaxed font-serif italic">
                    "We believe home maintenance is not a chore, but an investment. Just as a fine suit requires a tailor, a period property requires a steward. Our seasonal collections ensure your home remains safe, warm, and valuable."
                </p>
                <div className="w-16 h-1 bg-amber-400 mx-auto mt-8"></div>
            </div>
        </section>
    );
}

function WinterMenu() {
    const mainCourses = [
        {
            title: "The Exterior Shell Defence",
            description: "A comprehensive clearance of guttering and downpipes to prevent damp ingress, coupled with a drone roof inspection.",
            price: "From £129",
            icon: <Droplets className="w-6 h-6 text-blue-500" />,
            tag: "Essential"
        },
        {
            title: "The Radiator Revival",
            description: "Full system bleed and chemical inhibitor check to ensure your boiler runs at peak efficiency during the freeze.",
            price: "From £89",
            icon: <Thermometer className="w-6 h-6 text-red-500" />,
            tag: "Popular"
        },
        {
            title: "The Draft Sealant Suite",
            description: "Identification and silicone sealing of window frames and door jambs to lock in heat and lower energy bills.",
            price: "From £99",
            icon: <Wind className="w-6 h-6 text-slate-500" />,
            tag: "Energy Saving"
        }
    ];

    return (
        <section id="menu" className="py-20 px-6 bg-slate-50">
            <div className="max-w-5xl mx-auto">
                <div className="text-center mb-16">
                    <h3 className="text-3xl font-bold text-slate-900 uppercase tracking-widest mb-4">The Winter Menu</h3>
                    <p className="text-slate-500">Curated for January - March</p>
                </div>

                <div className="grid md:grid-cols-1 gap-8">
                    {mainCourses.map((item, idx) => (
                        <div key={idx} className="bg-white p-8 rounded-none border-l-4 border-amber-400 shadow-sm hover:shadow-md transition-shadow flex flex-col md:flex-row justify-between items-center gap-6">
                            <div className="flex-1">
                                <div className="flex items-center gap-3 mb-2">
                                    {item.icon}
                                    <h4 className="text-xl font-bold text-slate-900">{item.title}</h4>
                                    {item.tag && (
                                        <span className="bg-slate-100 text-slate-600 text-xs px-2 py-1 rounded-full font-medium tracking-wide">
                                            {item.tag}
                                        </span>
                                    )}
                                </div>
                                <p className="text-slate-600 max-w-2xl">{item.description}</p>
                            </div>
                            <div className="flex flex-col items-end gap-3 min-w-[140px]">
                                <span className="text-lg font-bold text-slate-900">{item.price}</span>
                                <Button className="bg-slate-900 hover:bg-slate-800 text-white rounded-full px-6 w-full">
                                    Book Now
                                </Button>
                            </div>
                        </div>
                    ))}
                </div>

                <div className="mt-12 text-center">
                    <p className="text-sm text-slate-500 italic mb-6">* All services include our standard 12-month workmanship guarantee.</p>
                    <Button variant="outline" className="border-slate-800 text-slate-900 hover:bg-slate-100 rounded-full px-8 py-6 uppercase tracking-widest">
                        Download Full Menu (PDF)
                    </Button>
                </div>
            </div>
        </section>
    );
}

function HealthScore() {
    const [score, setScore] = useState(0);
    const [checkedState, setCheckedState] = useState(new Array(5).fill(false));
    const [showResults, setShowResults] = useState(false);

    const inputs = [
        "I have cleared my gutters in the last 6 months",
        "My boiler has been serviced in the last 12 months",
        "None of my taps drip",
        "I have checked my external brickwork for pointing gaps",
        "My radiators are hot from top to bottom"
    ];

    const handleCheck = (position: number) => {
        const updatedCheckedState = checkedState.map((item, index) =>
            index === position ? !item : item
        );
        setCheckedState(updatedCheckedState);
        setScore(updatedCheckedState.filter(Boolean).length * 20);
    };

    return (
        <section className="py-20 px-6 bg-slate-900 text-white">
            <div className="max-w-4xl mx-auto">
                <div className="grid md:grid-cols-2 gap-12 items-center">
                    <div>
                        <h3 className="text-3xl font-bold mb-4 uppercase tracking-widest">Home Health Score</h3>
                        <p className="text-slate-400 mb-8 max-w-md">
                            A neglected home loses value. Take this 30-second audit to see if your property is "Winter Ready".
                        </p>

                        <div className="space-y-4">
                            {inputs.map((text, index) => (
                                <div key={index} className="flex items-center gap-3">
                                    <div
                                        className={`w-6 h-6 rounded-full border-2 border-slate-500 flex items-center justify-center cursor-pointer transition-colors ${checkedState[index] ? "bg-amber-400 border-amber-400" : "hover:border-amber-400"}`}
                                        onClick={() => handleCheck(index)}
                                    >
                                        {checkedState[index] && <CheckCircle className="w-4 h-4 text-slate-900" />}
                                    </div>
                                    <span className="text-slate-300 cursor-pointer" onClick={() => handleCheck(index)}>{text}</span>
                                </div>
                            ))}
                        </div>

                        {!showResults && (
                            <Button
                                onClick={() => setShowResults(true)}
                                className="mt-8 bg-amber-400 hover:bg-amber-500 text-slate-900 font-bold rounded-full px-8 py-4"
                            >
                                Calculate Score
                            </Button>
                        )}
                    </div>

                    <div className="bg-slate-800 rounded-3xl p-10 text-center relative overflow-hidden">
                        {!showResults ? (
                            <div className="flex flex-col items-center justify-center h-64">
                                <Shield className="w-24 h-24 text-slate-700 mb-4" />
                                <p className="text-slate-500 font-bold uppercase tracking-widest">Awaiting Data</p>
                            </div>
                        ) : (
                            <div className="animate-in fade-in zoom-in duration-500">
                                <span className="block text-slate-400 text-sm uppercase tracking-widest mb-2">Your Home Score</span>
                                <div className="text-8xl font-bold text-white mb-4 font-serif">{score}</div>
                                <div className="text-amber-400 font-bold text-xl uppercase tracking-wide mb-6">
                                    {score === 100 ? "Gold Standard" : score > 60 ? "Solid, but needs care" : "At Risk"}
                                </div>
                                <p className="text-slate-400 text-sm mb-8">
                                    {score < 100
                                        ? "Your property has gaps in its defense. Our 'Winter Bundle' fixes 80% of these issues in one visit."
                                        : "Excellent. You are preserving your asset perfectly."}
                                </p>
                                {score < 100 && (
                                    <Button className="w-full bg-white text-slate-900 hover:bg-slate-200 font-bold rounded-full">
                                        Fix My Gaps
                                    </Button>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </section>
    );
}

function Membership() {
    return (
        <section className="py-20 px-6 bg-amber-50">
            <div className="max-w-4xl mx-auto text-center border-2 border-amber-200 p-8 md:p-12 rounded-none md:rounded-3xl bg-white shadow-xl">
                <div className="inline-block bg-slate-900 text-amber-400 px-4 py-1 rounded-full text-xs font-bold uppercase tracking-widest mb-6">
                    Invitation Only
                </div>
                <h3 className="text-3xl md:text-5xl font-bold text-slate-900 mb-6 font-serif">The Stewardship Club</h3>
                <p className="text-lg text-slate-600 max-w-2xl mx-auto mb-8">
                    Join a select group of Derby homeowners who automate their property care. For just £20/month, comprehensive seasonal maintenance is handled for you, automatically.
                </p>
                <div className="grid sm:grid-cols-3 gap-6 max-w-2xl mx-auto mb-10 text-left">
                    <div className="flex items-center gap-3">
                        <CheckCircle className="w-5 h-5 text-amber-500" />
                        <span className="text-slate-700 font-medium">Priority Booking</span>
                    </div>
                    <div className="flex items-center gap-3">
                        <CheckCircle className="w-5 h-5 text-amber-500" />
                        <span className="text-slate-700 font-medium">5% Off All Quotes</span>
                    </div>
                    <div className="flex items-center gap-3">
                        <CheckCircle className="w-5 h-5 text-amber-500" />
                        <span className="text-slate-700 font-medium">Annual Boiler Check</span>
                    </div>
                </div>
                <Button className="bg-slate-900 hover:bg-slate-800 text-white px-10 py-6 rounded-full text-lg tracking-wide shadow-2xl shadow-slate-900/20">
                    Request Invitation
                </Button>
            </div>
        </section>
    );
}

function Footer() {
    return (
        <footer className="bg-slate-900 text-slate-400 py-12 px-6 text-center border-t border-slate-800">
            <div className="max-w-7xl mx-auto flex flex-col items-center gap-6">
                <div className="flex items-center gap-2 text-white font-bold text-lg">
                    <Shield className="w-6 h-6 text-amber-400" />
                    <span>Handy Services: The Guide</span>
                </div>
                <p className="max-w-md text-sm">
                    Reimagining property maintenance for the modern homeowner.
                    <br />Based in Derby, United Kingdom.
                </p>
                <p className="text-xs opacity-50">
                    © 2024 Handy Services. All rights reserved.
                </p>
            </div>
        </footer>
    );
}
