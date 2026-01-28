
import { Button } from "@/components/ui/button";
import { Building2, ArrowRight, ShieldCheck, Users } from "lucide-react";
import { Link } from "wouter";

export function PropertyManagerSection() {
    return (
        <section className="bg-slate-900 px-4 lg:px-8 py-16 lg:py-24 border-t border-slate-800">
            <div className="max-w-7xl mx-auto">
                <div className="grid lg:grid-cols-2 gap-12 items-center">
                    <div className="order-2 lg:order-1">
                        <div className="bg-slate-800 p-8 rounded-3xl shadow-xl border border-slate-700">
                            <div className="flex items-start gap-4 mb-6">
                                <div className="w-12 h-12 bg-blue-900/30 rounded-xl flex items-center justify-center flex-shrink-0">
                                    <Building2 className="w-6 h-6 text-blue-400" />
                                </div>
                                <div>
                                    <h3 className="font-bold text-white text-xl mb-1">Portfolio Management</h3>
                                    <p className="text-slate-300">Handle maintenance for 1 or 100 properties with ease.</p>
                                </div>
                            </div>
                            <div className="flex items-start gap-4 mb-6">
                                <div className="w-12 h-12 bg-blue-900/30 rounded-xl flex items-center justify-center flex-shrink-0">
                                    <ShieldCheck className="w-6 h-6 text-blue-400" />
                                </div>
                                <div>
                                    <h3 className="font-bold text-white text-xl mb-1">Compliance & Safety</h3>
                                    <p className="text-slate-300">Full audit trails, certificates, and insured works.</p>
                                </div>
                            </div>
                            <div className="flex items-start gap-4">
                                <div className="w-12 h-12 bg-blue-900/30 rounded-xl flex items-center justify-center flex-shrink-0">
                                    <Users className="w-6 h-6 text-blue-400" />
                                </div>
                                <div>
                                    <h3 className="font-bold text-white text-xl mb-1">Happy Tenants</h3>
                                    <p className="text-slate-300">Fast response times and professional communication.</p>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="order-1 lg:order-2 text-center lg:text-left">
                        <div className="inline-flex items-center gap-2 bg-blue-900/30 px-4 py-2 rounded-full mb-6">
                            <Building2 className="w-5 h-5 text-blue-400" />
                            <span className="text-blue-400 font-bold text-sm">PROPERTY MANAGERS</span>
                        </div>
                        <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold text-white mb-6 leading-tight">
                            One trusted vendor. <br />
                            <span className="text-blue-400">Your go-to for every unit.</span>
                        </h2>
                        <p className="text-slate-300 text-lg mb-8 max-w-lg mx-auto lg:mx-0">
                            Simplify your maintenance workflow. We handle everything from tenant coordination to invoice management, so you can focus on growing your portfolio.
                        </p>

                        <Link href="/property-managers">
                            <Button
                                className="w-full sm:w-auto px-8 py-6 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-full text-lg shadow-lg shadow-blue-600/20"
                            >
                                Property Manager Services
                                <ArrowRight className="w-5 h-5 ml-2" />
                            </Button>
                        </Link>
                    </div>
                </div>
            </div>
        </section>
    );
}
