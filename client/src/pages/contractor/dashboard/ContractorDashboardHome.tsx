import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Calendar, Clock, DollarSign, ArrowRight, CheckCircle2, Sparkles } from "lucide-react";
import ContractorDashboardLayout from "../ContractorDashboardLayout";

export default function ContractorDashboardHome() {
    // Stub data for now
    const stats = [
        { label: "Pending Requests", value: "3", icon: Calendar, color: "text-amber-600", bg: "bg-amber-100" },
        { label: "Active Jobs", value: "1", icon: Clock, color: "text-blue-600", bg: "bg-blue-100" },
        { label: "Revenue (mtd)", value: "£450", icon: DollarSign, color: "text-emerald-600", bg: "bg-emerald-100" },
    ];

    return (
        <ContractorDashboardLayout>
            <div className="max-w-5xl mx-auto space-y-8">

                {/* Welcome Section */}
                <div>
                    <h1 className="text-2xl font-bold text-slate-900">Welcome back!</h1>
                    <p className="text-slate-500">Here's what's happening today.</p>
                </div>

                {/* Stats Grid */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {stats.map((stat) => (
                        <div key={stat.label} className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm flex items-center gap-4">
                            <div className={`w-12 h-12 rounded-full ${stat.bg} flex items-center justify-center`}>
                                <stat.icon className={`w-6 h-6 ${stat.color}`} />
                            </div>
                            <div>
                                <p className="text-sm font-medium text-slate-500">{stat.label}</p>
                                <p className="text-2xl font-bold text-slate-900">{stat.value}</p>
                            </div>
                        </div>
                    ))}
                </div>

                {/* Action Cards */}
                <div className="grid md:grid-cols-2 gap-6">
                    {/* Booking Requests */}
                    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
                        <div className="flex items-center justify-between mb-6">
                            <h2 className="text-lg font-bold text-slate-900">Recent Requests</h2>
                            <Link href="/contractor/dashboard/bookings">
                                <a className="text-sm font-medium text-amber-600 hover:text-amber-700 flex items-center gap-1">
                                    View All <ArrowRight className="w-4 h-4" />
                                </a>
                            </Link>
                        </div>

                        <div className="space-y-4">
                            {[1].map((i) => (
                                <div key={i} className="flex items-center justify-between p-4 bg-slate-50 rounded-lg border border-slate-100">
                                    <div>
                                        <p className="font-bold text-slate-800">New Booking Inquiry</p>
                                        <p className="text-sm text-slate-500">Mon, 12th Jan • 09:00</p>
                                    </div>
                                    <span className="px-2 py-1 bg-amber-100 text-amber-700 text-xs font-bold rounded-full">
                                        Pending
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Smart Tools (New) */}
                    <div className="bg-gradient-to-br from-slate-900 to-slate-800 rounded-xl border border-slate-700 shadow-sm p-6 text-white">
                        <div className="flex items-start justify-between mb-4">
                            <div>
                                <h2 className="text-lg font-bold flex items-center gap-2">
                                    <Sparkles className="w-5 h-5 text-amber-400" />
                                    Smart Quoting
                                </h2>
                                <p className="text-sm text-slate-400 mt-1">
                                    Generate professional "Good / Better / Best" options for your private jobs in seconds.
                                </p>
                            </div>
                        </div>

                        <Link href="/contractor/dashboard/quotes/new">
                            <button className="w-full py-3 bg-amber-500 hover:bg-amber-600 text-white rounded-lg font-bold transition-all shadow-lg hover:shadow-amber-500/20 flex items-center justify-center gap-2">
                                <Sparkles className="w-4 h-4" />
                                Create "Magic" Quote
                            </button>
                        </Link>
                    </div>

                    {/* Quick Profile Status */}
                    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
                        <h2 className="text-lg font-bold text-slate-900 mb-6">Profile Status</h2>
                        <div className="flex items-center gap-3 p-4 bg-emerald-50 rounded-lg border border-emerald-100 mb-4">
                            <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                            <div>
                                <p className="font-bold text-emerald-900">Your profile is live</p>
                                <p className="text-sm text-emerald-700">Service area: 10 miles</p>
                            </div>
                        </div>
                        <Link href="/contractor/profile">
                            <button className="w-full py-2 bg-slate-900 text-white rounded-lg font-medium hover:bg-slate-800 transition-colors">
                                Edit Profile
                            </button>
                        </Link>
                    </div>
                </div>

            </div>
        </ContractorDashboardLayout>
    );
}
