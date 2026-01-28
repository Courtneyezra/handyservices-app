
import { Button } from "@/components/ui/button";
import { Store, ArrowRight, Clock, Briefcase } from "lucide-react";
import { Link } from "wouter";

export function BusinessSection() {
    return (
        <section className="bg-slate-50 px-4 lg:px-8 py-16 lg:py-24">
            <div className="max-w-7xl mx-auto">
                <div className="grid lg:grid-cols-2 gap-12 items-center">
                    <div className="text-center lg:text-left">
                        <div className="inline-flex items-center gap-2 bg-emerald-100 px-4 py-2 rounded-full mb-6">
                            <Store className="w-5 h-5 text-emerald-600" />
                            <span className="text-emerald-700 font-bold text-sm">SMALL BUSINESSES</span>
                        </div>
                        <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold text-slate-900 mb-6 leading-tight">
                            No disruption. <br />
                            <span className="text-emerald-600">Open to a finished job.</span>
                        </h2>
                        <p className="text-slate-600 text-lg mb-8 max-w-lg mx-auto lg:mx-0">
                            Keep your business running smoothly. We work around your schedule to ensure repairs are done quickly, quietly, and correctly.
                        </p>

                        <Link href="/businesses">
                            <Button
                                className="w-full sm:w-auto px-8 py-6 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-full text-lg shadow-lg shadow-emerald-600/20"
                            >
                                Business Services
                                <ArrowRight className="w-5 h-5 ml-2" />
                            </Button>
                        </Link>
                    </div>

                    <div className="order-2">
                        <div className="bg-white p-8 rounded-3xl border border-slate-200">
                            <div className="flex items-start gap-4 mb-6">
                                <div className="w-12 h-12 bg-emerald-100 rounded-xl flex items-center justify-center flex-shrink-0">
                                    <Clock className="w-6 h-6 text-emerald-600" />
                                </div>
                                <div>
                                    <h3 className="font-bold text-slate-900 text-xl mb-1">Out-of-Hours Service</h3>
                                    <p className="text-slate-600">We can work evenings and weekends to minimize downtime.</p>
                                </div>
                            </div>
                            <div className="flex items-start gap-4 mb-6">
                                <div className="w-12 h-12 bg-emerald-100 rounded-xl flex items-center justify-center flex-shrink-0">
                                    <Briefcase className="w-6 h-6 text-emerald-600" />
                                </div>
                                <div>
                                    <h3 className="font-bold text-slate-900 text-xl mb-1">Professional Conduct</h3>
                                    <p className="text-slate-600">Our team is uniformed, polite, and respects your workspace.</p>
                                </div>
                            </div>
                            <div className="flex items-start gap-4">
                                <div className="w-12 h-12 bg-emerald-100 rounded-xl flex items-center justify-center flex-shrink-0">
                                    <Store className="w-6 h-6 text-emerald-600" />
                                </div>
                                <div>
                                    <h3 className="font-bold text-slate-900 text-xl mb-1">Retail & Office</h3>
                                    <p className="text-slate-600">From shop fittings to office repairs, we handle it all.</p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </section>
    );
}
